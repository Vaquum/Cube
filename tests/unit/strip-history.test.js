"use strict";
// Complete native replay over HTTP, including a cache created by the old 300-version bootstrap.
const {test} = require("node:test"), assert = require("node:assert/strict"), {spawnSync} = require("node:child_process"), path = require("node:path");

const SCRIPT = String.raw`
import datetime as dt, hashlib, json, sys, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, 'tools')
from field_data import FieldDataReader, FieldDataError
from strip_service import StripService

NOW = 1792843200000
def iso(ms): return dt.datetime.fromtimestamp(ms / 1000, dt.UTC).isoformat(timespec='milliseconds').replace('+00:00','Z')
def identity(text): return hashlib.sha256(text.encode()).hexdigest()
PIN, LATEST, NATIVE = 'a'*64, 'b'*64, 'f'*64
seen, limit_mode, fail_once, truncate = [], 'reader', {50}, False
large = [{'id':str(i),'kind':'observation','observed_at':(dt.date(2022,1,1)+dt.timedelta(days=i)).isoformat(),
          'time_precision':'day','values':{'series':'DGS2','value':i/100,'padding':'x'*5000}} for i in range(1201)]
versions = [{'dataset_id':identity('dataset'+str(i)), 'first_snapshot_id':identity('snapshot'+str(i)),
             'first_published_at':iso(NOW-(400-i)*3600000)} for i in range(351)]
by_pin = {v['first_snapshot_id']:i for i,v in enumerate(versions)}
def funding(i):
    return {'records':[{'id':'funding:'+str(i),'kind':'funding','observed_at':iso(NOW-(401-i)*3600000),
        'values':{'interest_1h':0.000001+i*0.000000001}}], 'meta':{},
        'received_at':versions[i]['first_published_at'],'projection_version':'native/1'}

class API(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,status,body):
        raw=json.dumps(body).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        url=urllib.parse.urlsplit(self.path);q={k:v[0] for k,v in urllib.parse.parse_qs(url.query).items()};seen.append([url.path,q])
        if url.path=='/v1/snapshots/latest':
            return self.send(200,{'snapshot_id':PIN if q.get('as_of') else LATEST,'published_at':iso(NOW), 'datasets':{}})
        source=url.path.rsplit('/',1)[-1]
        if url.path.startswith('/v1/history/'):
            if q.get('include_data')!='0':return self.send(413,{'error':'response_too_large'})
            if source=='fred_macro_daily':return self.send(200,{'versions':[{'dataset_id':NATIVE,'first_snapshot_id':PIN,'first_published_at':iso(NOW-60000)}]})
            batch=list(reversed(versions)) if source=='deribit_funding' else []
            if q.get('before'):batch=[v for v in batch if (v['first_published_at'],v['dataset_id'])<(q['before'],q['before_id'])]
            limit=int(q.get('limit',100));selected=batch[:limit];more=len(batch)>limit
            return self.send(200,{'versions':selected,'next_before':selected[-1]['first_published_at'] if more else None,
                                 'next_before_id':selected[-1]['dataset_id'] if more else None})
        pin=q['snapshot_id'];limit=int(q['limit']);offset=int(q['offset'])
        if source=='fred_macro_daily':
            if limit_mode=='service' and limit>250:return self.send(413,{'error':'response_too_large'})
            records,dataset=large,NATIVE
            data={'meta':{},'received_at':iso(NOW-60000),'projection_version':'native/1'}
            if truncate:return self.send(200,{'source':source,'snapshot_id':pin,'dataset_id':dataset,
                'data':{**data,'records':records[:1]},'page':{'total':len(records),'next_offset':None}})
        else:
            i=by_pin[pin]
            if i in fail_once:
                fail_once.remove(i);return self.send(503,{'error':'storage_unavailable'})
            data=funding(i);records=data['records'];dataset=versions[i]['dataset_id']
        return self.send(200,{'source':source,'snapshot_id':pin,'dataset_id':dataset,'state':{'status':'ok'},
            'data':{**data,'records':records[offset:offset+limit]},
            'page':{'total':len(records),'next_offset':offset+limit if offset+limit<len(records) else None}})

server=ThreadingHTTPServer(('127.0.0.1',0),API)
threading.Thread(target=server.serve_forever,daemon=True).start()
reader=FieldDataReader('http://127.0.0.1:'+str(server.server_address[1]))
out={}
version=reader.history('fred_macro_daily')['versions'][0]
data=reader.version('fred_macro_daily',version)
out['large']={'records':len(data.records),'padding':sum(len(r['values']['padding']) for r in data.records),
              'pins':sorted({q['snapshot_id'] for p,q in seen if p.startswith('/v1/data/')}),
              'limits':[int(q['limit']) for p,q in seen if p.startswith('/v1/data/')]}
limit_mode='service';seen.clear()
out['serviceLimit']=len(reader.version('fred_macro_daily',version).records)
out['serviceLimits']=[int(q['limit']) for p,q in seen if p.startswith('/v1/data/')]
legacy={k:v for k,v in version.items() if k!='first_snapshot_id'}
seen.clear();out['legacy']=len(reader.version('fred_macro_daily',legacy).records)
out['legacyAsOf']=[q.get('as_of') for p,q in seen if p=='/v1/snapshots/latest']
try:reader.version('fred_macro_daily',{**legacy,'dataset_id':'e'*64})
except FieldDataError as error:out['mismatch']=error.code
truncate=True
try:reader.version('fred_macro_daily',version)
except FieldDataError as error:out['truncated']=error.code
truncate=False

service=StripService(reader,':memory:',clock=lambda:NOW/1000)
for i in range(51,351):
    d=funding(i);service.model.ingest('deribit_funding',versions[i]['dataset_id'],d['records'],{},d['received_at'],
                                    NOW-(400-i)*3600000,3600000)
seen.clear();service.bootstrap(('deribit_funding',))
out['firstScan']={'datasets':service.store.db.execute('SELECT count(*) FROM datasets').fetchone()[0],
    'complete':service.store.history_complete('deribit_funding'),'errors':dict(service.history_errors),
    'dataReads':len([1 for p,q in seen if p.startswith('/v1/data/')]),
    'metadataPages':len([1 for p,q in seen if p.startswith('/v1/history/')])}
seen.clear();service.bootstrap(('deribit_funding',))
out['recovered']={'datasets':service.store.db.execute('SELECT count(*) FROM datasets').fetchone()[0],
    'complete':service.store.history_complete('deribit_funding'),'errors':dict(service.history_errors),
    'dataReads':len([1 for p,q in seen if p.startswith('/v1/data/')])}
seen.clear();service.bootstrap(('deribit_funding',))
out['repeat']={'requests':len(seen),'dataReads':len([1 for p,q in seen if p.startswith('/v1/data/')])}
server.shutdown();print(json.dumps(out))
`;

test("native replay paginates pinned bodies and repairs a truncated cache without hiding a failed version", {timeout:30000}, () => {
  const run=spawnSync("python3",["-c",SCRIPT],{cwd:path.resolve(__dirname,"../.."),encoding:"utf8",timeout:25000});
  assert.equal(run.status,0,run.stderr);const out=JSON.parse(run.stdout);
  assert.equal(out.large.records,1201);assert.equal(out.large.padding,1201*5000);
  assert.deepEqual(out.large.pins,["a".repeat(64)]);
  assert.deepEqual(out.large.limits,[500,250,250,250,250,250]);
  assert.equal(out.serviceLimit,1201);assert.deepEqual(out.serviceLimits,[500,250,250,250,250,250]);
  assert.equal(out.legacy,1201);assert.equal(out.legacyAsOf.length,1);assert.ok(out.legacyAsOf[0]);
  assert.equal(out.mismatch,"history_dataset_mismatch");
  assert.equal(out.truncated,"incomplete_dataset");
  assert.equal(out.firstScan.datasets,300);assert.equal(out.firstScan.complete,false);
  assert.match(out.firstScan.errors.deribit_funding,/503/);assert.equal(out.firstScan.dataReads,51);assert.equal(out.firstScan.metadataPages,4);
  assert.equal(out.recovered.datasets,351);assert.equal(out.recovered.complete,true);assert.deepEqual(out.recovered.errors,{});assert.equal(out.recovered.dataReads,351);
  assert.deepEqual(out.repeat,{requests:1,dataReads:0});
});

test("failed replay survives restart, blocks live overtaking, and reconstructs first-seen values and withdrawals", () => {
  const script=String.raw`
import datetime as dt, json, sys, tempfile
sys.path.insert(0,'tools')
from field_data import Dataset, FieldDataError, Publication
from strip_service import StripService
from strip_model import HOUR
NOW=1792843200000
def iso(t):return dt.datetime.fromtimestamp(t/1000,dt.UTC).isoformat().replace('+00:00','Z')
def funding(i):return [{'id':'shared' if i>1 else 'first','kind':'funding','observed_at':iso(NOW),
                        'values':{'interest_1h':i/100000}}]
event={'id':'event','kind':'event','values':{'title':'CPI','category':'inflation','status':'scheduled',
       'schedule':{'kind':'instant','at':iso(NOW+10*HOUR)},'schedule_certainty':'confirmed',
       'context':{'importance':'high'}},'metadata':{'revision_id':'r1'}}
class Reader:
    def __init__(self,source):self.source=source;self.latest=1;self.fail=set();self.requests=0
    def history(self,source,**kw):
        return {'versions':[{'dataset_id':str(i),'first_published_at':iso(NOW+i*HOUR)} for i in range(self.latest,0,-1)]}
    def version(self,source,v):
        i=int(v['dataset_id'])
        if i in self.fail:raise FieldDataError('temporary',503)
        rows=([event] if i<3 else []) if source=='calendar' else funding(i)
        return Dataset(source,str(i),iso(NOW+i*HOUR),rows,{}, {},'ok')
    def publication(self,*a,**kw):
        data=self.version(self.source,{'dataset_id':str(self.latest)})
        return Publication('a'*64,iso(NOW+self.latest*HOUR),None,{},
                           datasets={} if self.source=='calendar' else {self.source:data},
                           calendar=data if self.source=='calendar' else None)
with tempfile.TemporaryDirectory() as root:
    r=Reader('deribit_funding');path=root+'/strip.sqlite'
    s=StripService(r,path);s.bootstrap((r.source,));assert s.store.history_complete(r.source)
    r.latest=3;r.fail={2};s.bootstrap((r.source,))
    assert not s.store.history_complete(r.source)
    s.update();assert not s.store.has_dataset(r.source,'3')
    assert len(s.store.rows('funding:deribit'))==1
    s.store.db.close()
    s=StripService(r,path);s.bootstrap((r.source,));s.update()
    assert r.source in s.history_errors and not s.store.has_dataset(r.source,'3')
    r.fail.clear();s.bootstrap((r.source,))
    row=s.store.db.execute("SELECT known_ms,value FROM obs WHERE obs_id='shared'").fetchone()
    assert row[0]==NOW+2*HOUR and abs(row[1]-17.52)<1e-10,row
    assert s.store.has_dataset(r.source,'2') and s.store.has_dataset(r.source,'3')
    assert not s.history_errors and s.store.history_complete(r.source)
    # A former capped cache already holds the newer, empty calendar.
    c=Reader('calendar');c.latest=3;c.fail={1}
    s=StripService(c,':memory:');s.model.ingest_calendar('3',[],NOW+3*HOUR)
    s.bootstrap(('calendar',));assert len(s.store.calendar_rows())==0
    c.fail.clear();s.bootstrap(('calendar',))
    rows=s.store.calendar_rows();assert len(rows)==2,rows
    assert rows[-1][2]==NOW+3*HOUR and json.loads(rows[-1][3])['status']=='withdrawn',rows
    print(json.dumps({'knownAt':row[0],'calendarRevisions':len(rows),'pendingAfterRestart':True}))
`;
  const run=spawnSync("python3",["-c",script],{cwd:path.resolve(__dirname,"../.."),encoding:"utf8",timeout:25000});
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).calendarRevisions,2);
});
