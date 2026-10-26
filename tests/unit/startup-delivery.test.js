"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");

test("live delivery keeps measured startup cells, defers archives and caches exact application bytes",()=>{
  const script=String.raw`
import base64,gzip,hashlib,http.client,json,re,struct,sys,tempfile,threading,time
from pathlib import Path
sys.path.insert(0,'tools')
import cube_bridge as c

# The partial parent at the left is excluded. The open parent at the cutoff
# retains just its actual trades. All four quantities have independent values.
cols=[3,16,17,31,32];rows=[9,10,10,11,10]
values=[[99,1,2,4,8],[98,.5,1,2,4],[97,3,5,7,11],[96,1,2,3,5]]
raw=struct.pack('<4sBBHIII12x',b'MSC2',0,0,0,3,33,5)
raw+=b''.join(struct.pack('<5d',*v) for v in values)
raw+=struct.pack('<5I',*cols)+struct.pack('<5I',*rows)
encoded=base64.b64encode(gzip.compress(raw,mtime=0)).decode()
boot=c.startup_block(encoded,3,32.5)
assert (boot['n'],boot['m'],boot['b0'],boot['b1'],boot['count'])==(4,0,16,32.5,3)
out=gzip.decompress(base64.b64decode(boot['gzip_base64']))
expected=[[3,4,8],[1.5,2,4],[8,7,11],[3,3,5]]
for field,values in enumerate(expected):assert struct.unpack_from('<3d',out,32+field*24)==tuple(values)
assert struct.unpack_from('<6I',out,128)==(1,1,2,10,11,10)

with tempfile.TemporaryDirectory() as directory:
    page=Path(directory)/'index.html'
    (page.parent/'vendor').mkdir()
    (page.parent/'vendor'/'d3.min.js').write_text('window.vendorReady=true;')
    page.write_text('<html><head><style>body {color:green}</style></head><body><script src="vendor/d3.min.js"></script><script type="application/json" id="origo-lens-data">{}</script><script>window.first=1;</script><script>window.second=window.first+1;</script></body></html>')
    e=object.__new__(c.Explorer);e.page=page;e.lock=threading.Lock()
    e.asset_store=page.parent/'assets'
    e.pack={'state_token':'held','cutoff':'2026-10-16T12:00:00Z','blocks':{name:{'b0':3,'b1':32.5,'gzip_base64':encoded} for name in ('recent','overview','reference')}}
    e.packed_at=time.monotonic();e.advanced_at=time.time();e.stale=False;e.version='test'
    e.current_pack=lambda:(_ for _ in ()).throw(AssertionError('HTML read the cube'))
    html=e.html().decode();data=json.loads(re.search(r'id="origo-lens-data">(.*?)</script>',html).group(1))
    assert encoded not in html and data['startup']==boot
    script_path=re.search(r'<script defer src="([^"]+)"',html).group(1)
    assert gzip.decompress(e.asset(script_path)[1])==b'window.vendorReady=true;\n;\nwindow.first=1;\n;\nwindow.second=window.first+1;'
    assert '<script src="vendor/d3.min.js">' not in html
    assert page.read_text().count('<script>')==2 # portable page remains intact
    archive=data['blocks']['recent']['url']
    assert gzip.decompress(e.asset(archive)[1])==raw
    assert e.asset('/assets/../index.html') is None
    class H(c.Handler):
        explorer=e
        def log_message(self,*args):pass
    server=c.ThreadingHTTPServer(('127.0.0.1',0),H)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    try:
        connection=http.client.HTTPConnection(*server.server_address)
        for encoding,compressed in [('gzip',True),('gzip;q=0',False),('identity',False)]:
            for method in ('GET','HEAD'):
                connection.request(method,archive,headers={'Accept-Encoding':encoding})
                response=connection.getresponse();body=response.read()
                assert response.status==200 and response.getheader('Cache-Control')=='private, max-age=31536000, immutable'
                assert (response.getheader('Content-Encoding')=='gzip')==compressed
                assert response.getheader('Vary')=='Accept-Encoding'
                if method=='GET':assert (gzip.decompress(body) if compressed else body)==raw
                else:assert body==b''
        connection.request('GET',script_path,headers={'Accept-Encoding':'gzip'})
        response=connection.getresponse();assert response.status==200
        etag=response.getheader('ETag')
        assert gzip.decompress(response.read())==gzip.decompress(e.asset(script_path)[1])
        connection.request('GET',script_path,headers={'Accept-Encoding':'gzip','If-None-Match':etag})
        response=connection.getresponse();assert response.status==304 and response.read()==b''
        assert response.getheader('Content-Length') is None
        connection.request('GET',script_path,headers={'Accept-Encoding':'identity','If-None-Match':etag})
        response=connection.getresponse();assert response.status==200
        assert response.read()==gzip.decompress(e.asset(script_path)[1])

        # A replacement process knows only its own current document. The old
        # content address must still return the old exact bytes from the volume.
        original_script=gzip.decompress(e.asset(script_path)[1])
        page.write_text(page.read_text().replace('window.first=1;','window.first=10;'))
        replacement=object.__new__(c.Explorer);replacement.page=page;replacement.lock=threading.Lock();replacement.asset_store=e.asset_store
        H.explorer=replacement
        connection.request('GET',script_path,headers={'Accept-Encoding':'gzip'})
        response=connection.getresponse();assert response.status==200 and gzip.decompress(response.read())==original_script
        assert script_path not in replacement.document[1]
        connection.request('GET',archive,headers={'Accept-Encoding':'gzip'})
        response=connection.getresponse();assert response.status==200 and gzip.decompress(response.read())==raw

        # Data churn cannot evict deployment code. Each namespace is bounded.
        latest=[]
        for i in range(20):
            assets={}
            for suffix,kind in [('js','application/javascript'),('css','text/css')]:
                source=(suffix+str(i)).encode();address='/assets/'+hashlib.sha256(source).hexdigest()+'.'+suffix
                assets[address]=(kind,gzip.compress(source,mtime=0))
            replacement.store_assets(assets);latest=list(assets)
        assert len(list(e.asset_store.glob('*.js.gz')))+len(list(e.asset_store.glob('*.css.gz')))==c.APPLICATION_ASSETS_HELD
        assert replacement.asset(script_path) is None
        for address in latest:assert replacement.asset(address) is not None
        for i in range(50):
            body=gzip.compress(bytes([i]),mtime=0);address='/assets/'+hashlib.sha256(body).hexdigest()+'.msc'
            replacement.store_assets({address:('application/octet-stream',body)},archive=True)
        assert len(list(e.asset_store.glob('*.msc.gz')))==3*c.PACKS_HELD
        for address in latest:assert replacement.asset(address) is not None
    finally:server.shutdown();server.server_close();worker.join()
print('startup sums, support, deferred archives, exact assets, encoding and HEAD passed')
`;
  const result=spawnSync("python3",["-c",script],{cwd:require("node:path").resolve(__dirname,"../.."),encoding:"utf8",timeout:20000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.match(result.stdout,/encoding and HEAD passed/);
});
