"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict"), {spawnSync} = require("node:child_process"), path = require("node:path");

test("raw positioning readings preserve partial coverage, publication time and window bounds without changing forces", () => {
  const run = spawnSync("python3", ["-c", String.raw`
import copy,json,sys
sys.path.insert(0,'tools')
import strip_model as m,strip_contract as contract
t=m.ms('2026-10-25T12:00:00Z');store=m.Store();model=m.Model(store)
def row(key,kind,values,at,metadata=None):
    return {'id':key,'kind':kind,'values':values,'observed_at':m.iso(at),'metadata':metadata or {}}
def fund(ticker,at,flow):
    return row(ticker+str(at),'etf_fund_flow',{'ticker':ticker,'flow_unit':'USD','net_inflow':flow},at)
def total(at):
    return row('total'+str(at),'etf_flow_aggregate',{'expected_funds':['A','B','C']},at)
etf=[total(t-m.DAY),total(t),fund('A',t-m.DAY,30),fund('B',t-m.DAY,-10),fund('C',t-m.DAY,None),
     fund('A',t,None)]
oi=[row('a','open_interest',{'symbol':'a','unit':'USD','value':100},t-60000),
    row('a-duplicate','open_interest',{'symbol':'a','unit':'USD','value':100},t-60000),
    row('b','open_interest',{'symbol':'b','unit':'USD','value':20},t-30000),
    row('funding','funding_rate',{'symbol':'a','unit':'percent','value':200},t)]
def liquidation(key,at,long,short,complete=True):
    return row(key,'liquidation_bar',{'symbol':'a','unit':'USD','long_liquidations_usd':long,'short_liquidations_usd':short},
               at,{'complete':complete,'interval_end':m.iso(at+15*m.MINUTE)})
liq=[liquidation('a',t-m.HOUR,7,3),liquidation('b',t-15*m.MINUTE,2,1),
     liquidation('old',t-7*m.HOUR,1000,1000),liquidation('unfinished',t-15*m.MINUTE,1000,1000,False),
     liquidation('outside-end',t-5*m.MINUTE,1000,1000)]
pub=t+60000
macro=[row('macro'+str(i),'macro_daily',{'series':'DGS2','value':4+(i%5)*0.01+i*0.002},t-(30-i)*m.DAY) for i in range(30)]
model.ingest('fred_macro_daily','fred',macro,{},m.iso(t),pub,6*m.HOUR)
model.ingest('sosovalue_etf_flows','etf',etf,{},m.iso(t),pub,6*m.HOUR)
model.ingest('coinalyze_current','oi',oi,{'requested_market_count':3},m.iso(t),pub,5*m.MINUTE)
meta={'requested_market_count':3,'source_metadata':{'start':m.iso(t-6*m.HOUR),'end_exclusive':m.iso(t)}}
model.ingest('coinalyze_history','liq',liq,meta,m.iso(t),pub,15*m.MINUTE)
model.ingest('sosovalue_etf_flows','older-late-import',[total(t-10*m.DAY),fund('A',t-10*m.DAY,999)],{},m.iso(t+120000),t+180000,6*m.HOUR,retrospective=True)
state=m.build_state(store,m.Prices([],None),{'id':None,'publishedAt':pub},{},pub)
before=[e.at(pub-1)[1] for e in state.context.values()]
readings={name:e.at(pub+180000)[1] for name,e in state.context.items()}
expired=state.context['context.oi'].at(pub+10*m.MINUTE+1)[1]
start=t;end=t+2*m.HOUR;answer=json.loads(state.answer(start,end,m.HOUR));contract.check(answer,start,end,m.HOUR)
baseline_store=m.Store();m.Model(baseline_store).ingest('fred_macro_daily','fred',macro,{},m.iso(t),pub,6*m.HOUR)
baseline=m.build_state(baseline_store,m.Prices([],None),{'id':None,'publishedAt':pub},{},pub)
baseline_forces=json.loads(baseline.answer(start,end,m.HOUR))['grid']['forces']
assert any(v is not None for v in baseline_forces['macro'])
unchanged=answer['grid']['forces']==baseline_forces
bad=copy.deepcopy(answer);bad['grid']['context']['oiUsd']=[]
try:contract.check(bad,start,end,m.HOUR);rejected=False
except ValueError:rejected=True
print(json.dumps({'before':before,'readings':readings,'expired':expired,'unchanged':unchanged,'rejected':rejected}))
`], {cwd:path.resolve(__dirname,"../.."),encoding:"utf8",timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.deepEqual(result.before,[null,null,null]);
  assert.deepEqual(result.readings["context.etf"],{etfFlow:20,etfDate:Date.parse("2026-10-24T12:00:00Z"),etfReported:2,etfExpected:3});
  assert.equal(result.readings["context.oi"].oiUsd,120);
  assert.equal(result.readings["context.oi"].oiReported,2);
  assert.equal(result.readings["context.oi"].oiExpected,3);
  assert.equal(result.readings["context.liquidations"].liqLong,9);
  assert.equal(result.readings["context.liquidations"].liqShort,4);
  assert.equal(result.readings["context.liquidations"].liqReported,1);
  assert.equal(result.readings["context.liquidations"].liqExpected,3);
  assert.equal(result.expired,null);
  assert.equal(result.unchanged,true);
  assert.equal(result.rejected,true);
});
