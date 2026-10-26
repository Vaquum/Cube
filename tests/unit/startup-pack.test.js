"use strict";
// Oracle: a hand-authored consistent pack, real production Explorer methods,
// and event-controlled rebuilds. No live cube or timing benchmark is required.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("production HTML paints held packs without waiting for expiry, invalidation or a concurrent refresh", () => {
  const script = String.raw`
import base64,gzip,json,re,struct,sys,tempfile,threading,time
from pathlib import Path
sys.path.insert(0,'tools')
import cube_bridge as c

def pack(token):
    encoded=base64.b64encode(gzip.compress(struct.pack('<4sBBHIII12x',b'MSC2',0,0,0,0,100,0))).decode()
    return {'state_token':token,'cutoff':'2026-10-16T12:00:00+00:00',
            'data_cutoff':'2026-10-16T12:00:00+00:00','canonical_through':None,
            'cutoffBase':100,'blocks':{name:{'count':0,'b0':0,'b1':100,'gzip_base64':encoded}
                                     for name in ('recent','overview','reference')}}

def explorer(page, held=True):
    e=object.__new__(c.Explorer)
    e.page=page;e.lock=threading.Lock();e.building=threading.Lock()
    e.pack=pack('old') if held else None;e.stale=False;e.held={}
    e.packed_at=time.monotonic()-120;e.advanced_at=time.time()-300
    e.data_cutoff='2026-10-16T12:00:00+00:00';e.version='test-version'
    if held:e.held['old']={'pins':{'day':'old'},'tiers':{},'cutoff':100,'state':{}}
    return e

def payload(e):
    html=e.html().decode()
    return json.loads(re.search(r'id="origo-lens-data">(.*?)</script>',html,re.S).group(1))

with tempfile.TemporaryDirectory() as directory:
    page=Path(directory)/'index.html'
    page.write_text('<script type="application/json" id="origo-lens-data">{}</script>')
    for age,invalidated,expected_next in [(10,False,51),(120,False,1),(10,True,1)]:
        e=explorer(page);e.packed_at=time.monotonic()-age;e.stale=invalidated
        e.current_pack=lambda:(_ for _ in ()).throw(AssertionError('HTML started a rebuild'))
        body=payload(e)
        assert body['state_token']=='old'
        assert all('gzip_base64' not in block and block['url'].startswith('/assets/') for block in body['blocks'].values())
        assert body['startup']['n']==4 and body['startup']['b1']==100
        assert age<=body['age']<age+1 and body['quiet']>=300
        assert body['next']==expected_next and body['page']=='test-version'

    # Publish a refresh immediately after the snapshot lock is released. The
    # old invalidated token must retain its own quiet time and immediate poll.
    e=explorer(page);e.packed_at=time.monotonic()-10;e.stale=True
    class PublishOnUnlock:
        def __init__(self):self.native=threading.Lock();self.published=False
        def __enter__(self):self.native.acquire();return self
        def __exit__(self,*args):
            self.native.release()
            if not self.published:
                self.published=True;e.pack=pack('new');e.stale=False
                e.packed_at=time.monotonic();e.advanced_at=time.time()
    e.lock=PublishOnUnlock()
    body=payload(e)
    assert e.pack['state_token']=='new' and not e.stale
    assert body['state_token']=='old' and 10<=body['age']<11
    assert body['next']==1 and body['quiet']>=300

    # A rebuild holds the actual building lock. HTML must finish before it is released.
    e=explorer(page);started=threading.Event();release=threading.Event();painted=threading.Event()
    failure=[];shown=[]
    def build():
        started.set()
        if not release.wait(10):raise AssertionError('test did not release rebuild')
        new=pack('new')
        return new,{'day':'new'},{key:{} for key in new['blocks']}
    c.pack=build
    def refresh():
        try:e.current_pack()
        except BaseException as error:failure.append(error)
    worker=threading.Thread(target=refresh,daemon=True);worker.start()
    assert started.wait(5)
    def paint():
        try:shown.append(payload(e))
        except BaseException as error:failure.append(error)
        finally:painted.set()
    reader=threading.Thread(target=paint,daemon=True);reader.start()
    try:
        assert painted.wait(2),'HTML waited behind the pack build'
        assert shown[0]['state_token']=='old' and shown[0]['age']>=120
        assert shown[0]['next']==1 and e.pack['state_token']=='old'
    finally:
        release.set();worker.join(5);reader.join(5)
    assert not failure,failure
    assert e.pack['state_token']=='new' and e.holding('old')['pins']=={'day':'old'}
    assert payload(e)['state_token']=='new'
    # A client without a held token receives the new complete snapshot.
    # Numerical tail calculation is covered separately with its array runtime.
    update=e.update('not-held')
    assert update['status']=='pack' and update['pack']['state_token']=='new'

    # An empty server must build real data once; no invented empty snapshot.
    e=explorer(page,held=False);calls=[]
    def cold():
        calls.append(1);new=pack('cold')
        return new,{}, {key:{} for key in new['blocks']}
    c.pack=cold
    assert payload(e)['state_token']=='cold' and len(calls)==1
    assert payload(e)['state_token']=='cold' and len(calls)==1

    # A failed refresh preserves the held snapshot and its honest age.
    e=explorer(page)
    def broken():raise RuntimeError('cube unavailable')
    c.pack=broken
    try:e.current_pack()
    except RuntimeError:pass
    else:raise AssertionError('refresh failure was hidden')
    body=payload(e)
    assert body['state_token']=='old' and body['age']>=120 and body['next']==1
print('held snapshot, freshness, concurrent refresh, cold start, failure: passed')
`;
  const result = spawnSync("python3", ["-c", script], {
    cwd: require("node:path").resolve(__dirname, "../.."), encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /failure: passed/);
});
