"use strict";
const {test}=require('node:test'), assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const E=require('../../src/etf.js');
const want={from:100,to:500,as_of:450};
const report=(knownAt,net=5)=>({knownAt,date:'2026-10-27',complete:true,inflow:10,outflow:10-net,net,magnitude:20-net,normal:null,normalReports:0,reported:2,expected:2,funds:[{ticker:'A',net:10},{ticker:'B',net:net-10}]});
const body=()=>({schema:'cube-etf@1',source:{state:'ok'},snapshot:{id:'a'.repeat(64)},scaleUsd:1e9,from:100,to:500,asOf:450,states:[report(99),report(300)]});
test('ETF parser rejects mismatched ranges, future knowledge, duplicate funds and inconsistent totals',()=>{
 assert.equal(E.parse(body(),want).states.length,2);
 for(const corrupt of [b=>b.to++,b=>b.states[1].knownAt=450,b=>b.states[1].knownAt=99,b=>b.states[1].funds[1].ticker='A',b=>b.states[1].net=6,b=>b.states[1].funds[0].net=500,b=>b.states[1].complete=false]){const b=body();corrupt(b);assert.throws(()=>E.parse(b,want));}
});
test('ETF replay excludes knowledge at the edge and does not reconstruct earlier dates',()=>{
 const b=body();assert.equal(E.at(b,98),null);assert.equal(E.at(b,200).knownAt,99);assert.equal(E.at(b,300,300),null);assert.equal(E.at(b,299,300).knownAt,99);
 assert.deepEqual(E.spans(b,100,500,300).map(s=>[s.from,s.to,s.report.knownAt]),[[100,300,99]]);
 assert.equal(E.y(0,22,19),22);assert.equal(E.y(2e9,22,19),3);assert.equal(E.y(-2e9,22,19),41);
});
test('ETF cached states never cover a different window or unrequested publication edge',()=>{
 const b=body();
 for(const t of [99,450,499,500,800])assert.equal(E.at(b,t),null);
 assert.equal(E.covers(b,{from:100,to:400,as_of:450}),true);
 assert.equal(E.covers(b,{from:500,to:800,as_of:900}),false);
 assert.equal(E.covers(b,{from:100,to:500,as_of:500}),false);
 assert.deepEqual(E.spans(b,0,600,600).map(s=>[s.from,s.to,s.report?.knownAt??null]),[[0,100,null],[100,300,99],[300,450,300],[450,600,null]]);
 assert.deepEqual(E.spans(b,500,800,900).map(s=>s.report),[null]);
});
test('ETF plots all retained flow dates and selects revisions only known by the replay edge',()=>{
 const day=86400000,start=Date.parse('2026-10-22T00:00:00Z'),published=start+6*day;
 const version=(offset,knownAt,net)=>({...report(knownAt,net),date:new Date(start+offset*day).toISOString().slice(0,10),universe:'same'});
 const b={...body(),from:start,to:start+8*day,asOf:start+8*day,reports:[version(0,published,-5),version(1,published,5),version(1,published+1000,8)],states:[]};
 E.parse(b,{from:b.from,to:b.to,as_of:b.asOf});
 assert.equal(E.at(b,start+day/2,published),null);
 assert.equal(E.at(b,start+day/2,published+1).net,-5);
 assert.equal(E.at(b,start+2*day,published+1000).net,5);
 assert.equal(E.at(b,start+2*day,published+1001).net,8);
 assert.deepEqual(E.spans(b,start,start+3*day,b.asOf).map(p=>p.report.net),[-5,8]);
 const bad=structuredClone(b);bad.reports[0].net=900;assert.throws(()=>E.parse(bad,{from:b.from,to:b.to,as_of:b.asOf}));
});
test('ETF native projection retains settlement revisions, source publication time and persistence',()=>{
 const script=String.raw`
import sys, json, tempfile
from types import SimpleNamespace
sys.path.insert(0,'tools')
from etf_service import project, timeline, report_history, EtfService, timestamp
def rows(a,b,complete=True,day='2026-10-27',total=None):
 return [{'kind':'etf_fund_flow','observed_at':day,'values':{'ticker':t,'net_inflow':v,'flow_unit':'USD'}} for t,v in [('A',a),('B',b)]]+[{'kind':'etf_flow_aggregate','observed_at':day,'values':{'expected_funds':['A','B'],'complete_selected_funds':complete,'net_inflow_usd':a+b if total is None and a is not None and b is not None else total,'unit':'USD'}}]
p=project(rows(10,-10))[0];assert p['net']==0 and p['magnitude']==20 and p['reported']==2
assert project(rows(0,0))[0]['magnitude']==0
assert project(rows(10,None,False))[0]['net'] is None
assert project(rows(10,-2,total=900))[0]['complete'] is False
duplicate=rows(10,-2);duplicate.append({'kind':'etf_fund_flow','observed_at':'2026-10-27','values':{'ticker':'A','net_inflow':20,'flow_unit':'USD'}})
assert project(duplicate)[0]['complete'] is False
assert project(rows(10,-2)+[rows(10,-2)[0]])[0]['net']==8
pending=project(rows(10,None,False));settled=project(rows(10,-2));revised=project(rows(15,-2))
states=timeline([(100,pending),(200,settled),(300,revised),(400,revised)])
assert [s['knownAt'] for s in states]==[100,200,300] and [s['net'] for s in states]==[None,8,13]
# An older day's late correction cannot replace the latest economic report.
states=timeline([(100,settled),(200,project(rows(5,2,day='2026-10-28'))),(300,revised)])
assert states[-1]['date']=='2026-10-28' and states[-1]['net']==7
versions=report_history([(100,settled+project(rows(5,2,day='2026-10-28'))),(200,revised)])
assert [(r['date'],r['knownAt']) for r in versions]==[('2026-10-27',100),('2026-10-28',100),('2026-10-27',200)]
assert timestamp('2026-10-27T06:00:00') is None
with tempfile.TemporaryDirectory() as directory:
 path=directory+'/etf.sqlite'
 service=EtfService(None,path,clock=lambda:1000)
 service.ingest(SimpleNamespace(dataset_id='one',records=rows(10,None,False)), '2026-10-28T06:00:00Z')
 service.ingest(SimpleNamespace(dataset_id='two',records=rows(10,-2)), '2026-10-28T12:00:00Z')
 service.rebuild();assert len(service.states)==2
 # A repeated dataset cannot move its first-known time forward.
 service.ingest(SimpleNamespace(dataset_id='two',records=rows(10,-2)), '2026-10-29T12:00:00Z')
 service.rebuild();assert len(service.states)==2
 service.snapshot={'id':'pin','publishedAt':timestamp('2026-10-28T13:00:00Z')}
 service.source={'state':'ok','checkedAt':1000000,'intervalSeconds':21600}
 service.publish()
 begin=timestamp('2026-10-28T07:00:00Z');end=timestamp('2026-10-28T14:00:00Z');edge=timestamp('2026-10-28T12:00:00Z')
 args={'from':[str(begin)],'to':[str(end)],'as_of':[str(edge)]}
 status,answer=service.answer(args);assert status==200 and len(answer['states'])==1 and answer['states'][0]['net'] is None
 assert len(answer['reports'])==1 and answer['reports'][0]['date']=='2026-10-27'
 # Rebuilding a capture cannot expose it with a previous published snapshot.
 old_view=service.current
 service.ingest(SimpleNamespace(dataset_id='three',records=rows(12,-2)), '2026-10-28T13:00:00Z')
 service.rebuild();assert service.current is old_view
 assert service.answer({'from':['NaN'],'to':['2'],'as_of':['3']})[0]==400
 resumed=EtfService(None,path);assert len(resumed.states)==3
 print('projection, revisions, replay and restart verified')
class Reader:
 def __init__(self):
  self.base=timestamp('2026-10-28T00:00:00Z');self.latest='a';self.versions=[];self.payload={};self.reads=[]
 def add(self,key,seconds,a,b,day='2026-10-27'):
  known=self.base+seconds*1000
  published=__import__('datetime').datetime.fromtimestamp(known/1000,__import__('datetime').UTC).isoformat()
  self.versions.append({'dataset_id':key,'first_published_at':published})
  self.payload[key]=SimpleNamespace(dataset_id=key,records=rows(a,b,day=day))
 def snapshot(self):
  return {'snapshot_id':'pin','published_at':'2026-10-29T16:00:00Z','datasets':{'sosovalue_etf_flows':{'dataset_id':self.latest,'status':'ok','last_checked_at':'2026-10-29T16:00:00Z'}}}
 def history(self,*a,**kw):return {'versions':list(reversed(self.versions))}
 def version(self,source,v):self.reads.append(v['dataset_id']);return self.payload[v['dataset_id']]
reader=Reader();reader.add('a',1,10,-2)
service=EtfService(reader)
# Repair a cache created with the later shared snapshot's publication time.
service.ingest(reader.payload['a'],'2026-10-29T16:00:00Z')
service.cycle();assert service.states[0]['knownAt']==reader.base+1000 and reader.reads==[]
# Intermediate captures during an outage must be replayed, not just the latest.
reader.add('b',2,12,-2);reader.add('c',3,14,-2);reader.latest='c'
service.cycle();assert [r['knownAt'] for r in service.states]==[reader.base+n*1000 for n in [1,2,3]]
assert reader.reads==['b','c']
# A later backfill behind an already stored head is discovered without restart.
reader.add('older',0,5,-1,day='2026-10-26')
reader.versions.sort(key=lambda v:v['first_published_at'])
service.cycle();assert service.states[0]['knownAt']==reader.base and service.states[0]['date']=='2026-10-26'
assert reader.reads==['b','c','older'] and service.history_ready
print('first publication, outage recovery and late backfill verified')
`;
 const r=spawnSync('python3',['-c',script],{cwd:require('node:path').resolve(__dirname,'../..'),encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
