"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");

test("restart serves retained forces and outcome prices before a blocked history replay, with honest freshness", () => {
  const script = String.raw`
import datetime as dt, json, sys, tempfile, threading
sys.path.insert(0,'tools')
from strip_service import StripService
from strip_model import DAY, HOUR
NOW=1792944000000
def iso(t):return dt.datetime.fromtimestamp(t/1000,dt.UTC).isoformat().replace('+00:00','Z')
class BlockedReader:
    def __init__(self):self.entered=threading.Event();self.release=threading.Event()
    def history(self,*a,**kw):
        self.entered.set();self.release.wait(10);raise SystemExit
with tempfile.TemporaryDirectory() as root:
    path=root+'/strip.sqlite'
    s=StripService(None,path,clock=lambda:NOW/1000)
    rows=[{'id':str(i),'observed_at':iso(NOW-(400-i)*DAY),'values':{'series':'DGS2','value':2+i%13/100}}
          for i in range(400)]
    s.model.ingest('fred_macro_daily','macro',rows,{},iso(NOW),NOW,DAY)
    s.publication={'id':'a'*64,'publishedAt':NOW,'scheduledFor':NOW,'requests':1}
    s.manifest_states={'fred_macro_daily':{'status':'ok','last_checked_at':iso(NOW),'collection_interval_seconds':300}}
    s.prices.hourly={NOW-i*HOUR:1000-i/10 for i in range(90*24)}
    s.prices.fine={NOW-i*HOUR//4:1000-i/40 for i in range(30*24*4)}
    s.prices.cutoff=NOW
    s.rebuild()
    args={'from':[str(NOW-60*DAY)],'to':[str(NOW)],'step':[str(HOUR)]}
    code,body=s.answer(args);assert code==200
    before=json.loads(body)
    assert sum(v is not None for v in before['grid']['forces']['macro'])>1000
    assert sum(v is not None for v in before['grid']['next24h'])>1000
    assert abs(before['grid']['next24h'][0]-0.2804)<0.0001
    s.store.db.close()
    reader=BlockedReader();restored=StripService(reader,path,clock=lambda:NOW/1000)
    restored.start();assert reader.entered.wait(3),'worker did not reach replay'
    code,body=restored.answer(args)
    assert code==200 and json.loads(body)==before,'restart lost or changed retained readings'
    reader.release.set();restored.thread.join(3)
    assert not restored.thread.is_alive()
    aged=StripService(None,path,clock=lambda:(NOW+2*HOUR)/1000)
    assert aged.resume()
    after=json.loads(aged.answer(args)[1])
    assert after['snapshot']==before['snapshot'] and after['cutoff']==before['cutoff']
    assert after['grid']==before['grid'],'restart must preserve outcome support'
    assert after['sources']['fred_macro_daily']['state']=='stale'
    assert after['sources']['fred_macro_daily']['checkedAt']==NOW
    aged.store.db.execute("UPDATE strip_resume SET body=?",(json.dumps({'schema':'obsolete','model':'obsolete'}),))
    incompatible=StripService(None,path)
    assert not incompatible.resume() and incompatible.state is None
print('retained grid and outcomes served while replay blocked; old cutoff and freshness preserved')
`;
  const run = spawnSync("python3", ["-c", script], { encoding: "utf8", timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
});
