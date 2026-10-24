"use strict";
const {test,expect} = require("./fixtures.js");
const cases = require("../fixtures/regressions/scattered-refresh/cases.json");
const EPOCH=1609459200000,BASE=56250;
const iso = c=>new Date(EPOCH+c*BASE).toISOString();
const trade = (c,r)=>({t_ms:c*BASE+1000+r,price:r*12500,qty:1000000,takerBuy:true});
function sample(kind) {
  if(kind==="dense") {
    const {columns,rows,firstRow}=cases.dense;
    return {trades:Array.from({length:columns},(_,c)=>Array.from({length:rows},(_,r)=>trade(c,firstRow+r))).flat(),cutoffIso:iso(columns+1),
      captures:[{bounds:[0,1,200,201],n:0,m:0,volume:250},{bounds:[columns-1,columns,207,208],n:0,m:0,volume:258.75}]};
  }
  if(kind==="mixed") return {trades:[trade(0,200),trade(1,201),trade(4,200),trade(5,201),trade(5000,200),trade(5001,201)],cutoffIso:iso(5100),captures:cases.mixed};
  return {trades:cases.sparseColumns.map(c=>trade(c,200)),cutoffIso:iso(5100),captures:cases.sparseColumns.map(c=>({bounds:[c,c+1,200,201],n:0,m:0,volume:250}))};
}
async function open(page,fakeFor,probe,kind) {
  const input=sample(kind),fake=await fakeFor(input);
  await page.goto(fake.url+`/#t=${iso(0)}~${iso(6)}&p=24800~26000&r=0,0&auto=0&vis=2&lines=`);
  await probe.waitForReady();
  await page.evaluate(async captures=>{
    const records=[];
    for(const {bounds:[a,b,low,high],n,m} of captures) {
      const iso=c=>new Date(1609459200000+c*56250).toISOString();
      const d=await window.cubeAgent.query({t1:iso(a),t2:iso(b),p1:low*125,p2:high*125,tR:56.25*2**n,pR:125*2**m});
      records.push(d.comparison.captures[0]);
    }
    const doc=await window.cubeAgent.export();doc.comparison.captures=records;doc.comparison.focus=records[0].id;
    await window.cubeAgent.apply(window.explorerAgent.seal(doc));
  },input.captures);
  return {fake,input};
}
for(const kind of ["sparse","dense","mixed"]) test(`${kind} captures refresh within both agent bounds and retain each observed region`,async({page,fakeFor,probe})=>{
  const {fake,input}=await open(page,fakeFor,probe,kind),before=await page.evaluate(()=>window.cubeAgent.export()),offset=fake.log().length;
  const result=await page.evaluate(()=>window.cubeAgent.refresh());
  expect(result.document.comparison.captures.map(c=>c.observed)).toEqual(before.comparison.captures.map(c=>c.observed));
  expect(result.document.comparison.captures.map(c=>c.metrics["volume.amount"].value)).toEqual(input.captures.map(c=>c.volume));
  const reads=fake.log().slice(offset).filter(r=>r.path==="/cube/agent/query");
  expect(reads.length).toBeGreaterThan(0);
  expect(new Set(reads.map(r=>r.query.pack)).size).toBe(1);
  for(const {query:q} of reads) {
    const cols=Math.ceil((Date.parse(q.t2)-EPOCH)/BASE/(Number(q.tR)/56.25))-Math.floor((Date.parse(q.t1)-EPOCH)/BASE/(Number(q.tR)/56.25));
    const rows=Math.ceil(Number(q.p2)/Number(q.pR))-Math.floor(Number(q.p1)/Number(q.pR));
    expect(cols).toBeLessThanOrEqual(4096);expect(cols*rows).toBeLessThanOrEqual(20000);
  }
});
for(const fault of ["refusal","revision"]) test(`a later refresh ${fault} preserves the complete prior capture`,async({page,fakeFor,probe,allowConsole})=>{
  const {fake}=await open(page,fakeFor,probe,"sparse"),before=await page.evaluate(()=>window.cubeAgent.export());
  allowConsole(/Failed to load resource/);
  if(fault==="refusal") fake.on({route:"/cube/agent/query",after:1,times:1}).fail({status:409,body:{error:"cube_changed"}});
  else {
    const gate=fake.on({route:"/cube/agent/query",after:1,times:1}).gate();
    await page.evaluate(()=>{window.refreshResult=window.cubeAgent.refresh().then(()=>"unexpected success",e=>e.message);});
    await gate.arrived();fake.revise({day:"2021-01-03",factor:2});gate.open();
  }
  const error=fault==="revision"?await page.evaluate(()=>window.refreshResult):await page.evaluate(()=>window.cubeAgent.refresh().then(()=>"unexpected success",e=>e.message));
  expect(error).toContain("captured evidence retained");
  const after=await page.evaluate(()=>window.cubeAgent.export());
  expect(after.comparison).toEqual(before.comparison);expect(after.scene.view).toEqual(before.scene.view);
  expect(await page.evaluate(()=>window.cubeAgent.previous)).toBeNull();
});
