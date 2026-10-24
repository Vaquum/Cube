"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),A=require("../../src/agent.js");
const epoch=1609459200000,BASE=56250,key="developing-poc|0|0|1536";
function document(){const d=A.fromQuery({query:{n:0,m:0,b0:0,b1:2,r0:200,r1:202},cells:[{c:0,r:200,v:250,bv:250,ct:1,bt:1}],summary:{volume:250,trade_count:1},frame:{baseSeconds:56.25,basePrice:125,origin:epoch/1000,cutoffMs:epoch+1536*BASE,canonicalThroughMs:epoch+1536*BASE,source:"SYNTHETIC cache validation",token:"cache-v1",live:true}});d.snapshot.generation=0;d.snapshot.cache.developingPocReads={cubeMap:[[key,{id:key,n:4,m:0,b0:0,b1:1536,col0:0,col1:96,cells:[{c:0,r:200,v:250,bv:250,ct:1,bt:1}]}]]};return d;}
test("dedicated POC cache requires matching UTC coverage and valid cells before import",()=>{
  assert.doesNotThrow(()=>A.validate(A.seal(document())));
  for(const mutate of [
    r=>{r.b1=16;r.col1=1;},r=>{r.n=5;},r=>{r.m=1;},r=>{r.b0=16;},r=>{delete r.cells;},r=>{r.cells.push({...r.cells[0]});},r=>{r.cells[0].v=-1;},r=>{r.cells[0].bv=251;},r=>{r.cells[0].ct=.5;},r=>{r.cells[0].c=100000;}
  ]){const d=document();mutate(d.snapshot.cache.developingPocReads.cubeMap[0][1]);assert.throws(()=>A.validate(A.seal(d)),/captured.*(POC|cache|cell)|POC.*(coverage|cell)/i);}
  for(const badKey of ["bad","developing-poc|1|0|1536","developing-poc|0|1|1536"]){const d=document();d.snapshot.cache.developingPocReads.cubeMap[0][0]=badKey;assert.throws(()=>A.validate(A.seal(d)),/POC|cache/);}
});
test("dedicated POC import enforces map uniqueness, entry limits and aggregate cached-cell bounds",()=>{
  const duplicate=document();duplicate.snapshot.cache.developingPocReads.cubeMap.push(structuredClone(duplicate.snapshot.cache.developingPocReads.cubeMap[0]));assert.throws(()=>A.validate(A.seal(duplicate)),/POC|cache/);
  const many=document();many.snapshot.cache.developingPocReads.cubeMap=Array.from({length:65},()=>many.snapshot.cache.developingPocReads.cubeMap[0]);assert.throws(()=>A.validate(A.seal(many)),/64/);
  const large=document();large.snapshot.cache.extra={cells:Array.from({length:250000},(_,r)=>({c:0,r,v:1,bv:0,ct:1,bt:0}))};assert.throws(()=>A.validate(A.seal(large)),/250,000/);
});
test("invalid cached future cells cannot pass replay's declared-end filter",()=>{
  const d=document();d.snapshot.cache.developingPocReads.cubeMap[0][1].cells.push({c:100000,r:300,v:123456789,bv:0,ct:1,bt:0});
  assert.throws(()=>A.forExport(A.configure(A.seal(d),{replay:true,anchor:1536})),/POC|cache|cell/);
});
