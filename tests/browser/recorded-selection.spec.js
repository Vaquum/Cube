"use strict";
const {test,expect}=require("./fixtures.js");
const VIEW="#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=";
for(const patch of [{viewport:[0,1,200,201]},{viewport:[0,6,196,208]},{resolution:[1,1]}]) {
  test(`captured camera edit ${JSON.stringify(patch)} retains recorded selection through Share and restore`,async({page,fakeFor,probe,freshContext})=>{
    const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
    const original=await page.evaluate(()=>window.cubeAgent.export());
    await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
    await page.evaluate(p=>window.cubeAgent.configure({...p,readMode:"captured"}),patch);await probe.waitForReady();
    const edited=await page.evaluate(()=>window.cubeAgent.export());expect(edited.selection).toEqual(original.selection);
    const link=await page.evaluate(()=>window.cubeAgent.share()),ctx=await freshContext(),other=await ctx.newPage();
    await other.goto(link);await expect.poll(()=>other.evaluate(()=>typeof window.cubeAgent?.export)).toBe("function");
    await expect(other.locator("#ol-analysis-status")).toContainText("Captured evidence");
    expect((await other.evaluate(()=>window.cubeAgent.export())).selection).toEqual(original.selection);
  });
}
test("browser camera edits retain an explicitly absent recorded selection",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(async()=>{const d=await window.cubeAgent.export();d.selection=null;await window.cubeAgent.apply(window.explorerAgent.seal(d));});await probe.waitForReady();
  await page.evaluate(()=>window.cubeAgent.configure({viewport:[0,1,200,201],readMode:"captured"}));await probe.waitForReady();
  expect((await page.evaluate(()=>window.cubeAgent.export())).selection).toBeNull();
  expect((await page.evaluate(()=>window.cubeAgent.refresh())).document.selection).toBeNull();
});
test("explicit browser refresh rereads the recorded region after a camera edit and restores its prior evidence",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const original=await page.evaluate(()=>window.cubeAgent.export());await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
  await page.evaluate(()=>window.cubeAgent.configure({viewport:[0,1,200,201],readMode:"captured"}));await probe.waitForReady();
  const unchanged=await page.evaluate(()=>window.cubeAgent.refresh());expect(unchanged.changes).toEqual([]);expect(unchanged.document.selection.query).toEqual(original.selection.query);expect(unchanged.document.selection.metrics.volume).toBe(953.375);
  await probe.waitForReady();fake.revise({day:"2021-01-01",factor:2});
  const changed=await page.evaluate(()=>window.cubeAgent.refresh());expect(changed.document.selection.query).toEqual(original.selection.query);expect(changed.document.selection.metrics.volume).toBe(1906.75);
  expect(changed.changes.some(c=>c.selection&&c.metric==="volume"&&c.before===953.375&&c.after===1906.75)).toBe(true);
  await probe.waitForReady();await page.evaluate(()=>window.cubeAgent.restorePrevious());await probe.waitForReady();
  expect((await page.evaluate(()=>window.cubeAgent.export())).selection.metrics.volume).toBe(953.375);
});
test("explicit selection copy records the current requested region without replacing the investigation selection",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const original=await page.evaluate(()=>window.cubeAgent.export());await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
  await page.evaluate(()=>window.cubeAgent.configure({viewport:[0,1,200,201],readMode:"captured"}));await probe.waitForReady();
  const selected=await page.evaluate(()=>window.cubeAgent.export("selection"));expect(selected.selection.metrics.volume).toBe(300);expect(selected.selection.query).not.toEqual(original.selection.query);
  expect((await page.evaluate(()=>window.cubeAgent.export())).selection).toEqual(original.selection);
});
test("a selection refresh refusal retains the recorded investigation before any source mutation",async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const original=await page.evaluate(()=>window.cubeAgent.export());await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
  await page.evaluate(()=>window.cubeAgent.configure({viewport:[0,1,200,201],readMode:"captured"}));await probe.waitForReady();
  const before=await page.evaluate(()=>window.cubeAgent.export());allowConsole(/Failed to load resource/);
  fake.on({route:"/cube/query",times:1}).fail({status:409,body:{error:"source_changed",detail:"selection source revised"}});
  const error=await page.evaluate(()=>window.cubeAgent.refresh().then(()=>null,e=>e.message));expect(error).toContain("selection source revised");
  const after=await page.evaluate(()=>window.cubeAgent.export());expect(after.selection).toEqual(before.selection);expect(after.scene.query).toEqual(before.scene.query);expect(after.snapshot.token).toBe(before.snapshot.token);
});
test("a copied cell clipped in price retains its observed selection bounds and unchanged totals",async({page,fakeFor,probe})=>{
  const sample=require("../fixtures/regressions/clipped-capture-support/cases.json"),BASE=56250,EPOCH=1609459200000,iso=c=>new Date(EPOCH+c*BASE).toISOString();
  const fake=await fakeFor({cutoffIso:iso(sample.cutoffBase),trades:sample.trades.map(({base,offsetMs,...t})=>({...t,t_ms:base*BASE+offsetMs}))});
  await page.goto(fake.url+`/#t=${iso(0)}~${iso(8192)}&p=24000~27000&r=12,3&auto=0&vis=2&lines=&sel=${iso(1600)}~${iso(1601)},25000~25125`);await probe.waitForReady();
  const doc=await page.evaluate(()=>window.cubeAgent.export("cell"));expect(doc.selection.metrics.volume).toBe(250);
  expect(doc.selection.query).toMatchObject({t1:1600,t2:1601,p1:200,p2:201,tR:12,pR:3});
  await page.evaluate(d=>window.cubeAgent.apply(d),doc);await expect.poll(async()=>(await page.evaluate(()=>window.cubeAgent.export())).selection.metrics.volume).toBe(250);
  const result=await page.evaluate(()=>window.cubeAgent.refresh());expect(result.document.selection.metrics.volume).toBe(250);expect(result.changes.filter(c=>c.selection)).toEqual([]);
  await probe.waitForReady();
  // Old portable cell copies carried nominal selection prices. Both refresh
  // adapters can recover the observed band from the matching retained cell.
  const legacy=await page.evaluate(d=>{d.selection.query.p2=208;d.scene.query.p2=208;d.scene=window.explorerAgent.seal(d.scene);return window.explorerAgent.seal(d);},doc);
  await page.evaluate(d=>window.cubeAgent.apply(d),legacy);await expect.poll(async()=>(await page.evaluate(()=>window.cubeAgent.export())).selection.metrics.volume).toBe(250);
  const repaired=await page.evaluate(()=>window.cubeAgent.refresh());expect(repaired.document.selection.query.p2).toBe(201);expect(repaired.document.selection.metrics.volume).toBe(250);
  const {dispatch}=await import("../../tools/cube-agent.mjs"),prior=process.env.CUBE_URL;process.env.CUBE_URL=fake.url;
  try{const mcp=await dispatch("cube_refresh",{document:legacy});expect(mcp.document.selection.query.p2).toBe(201);expect(mcp.document.selection.metrics.volume).toBe(250);expect(mcp.changes.filter(c=>c.selection)).toEqual([]);}finally{if(prior===undefined)delete process.env.CUBE_URL;else process.env.CUBE_URL=prior;}
});
test("a dense 24,000-cell browser selection remains refreshable without comparison captures",async({page,fakeFor,probe})=>{
  const {columns,rows,firstRow}=require("../fixtures/regressions/scattered-refresh/cases.json").dense,BASE=56250,EPOCH=1609459200000,iso=c=>new Date(EPOCH+c*BASE).toISOString();
  const trades=Array.from({length:columns},(_,c)=>Array.from({length:rows},(_,r)=>({t_ms:c*BASE+1000+r,price:(firstRow+r)*12500,qty:1000000,takerBuy:true}))).flat();
  const fake=await fakeFor({cutoffIso:iso(columns+1),trades});await page.goto(fake.url+`/#t=${iso(0)}~${iso(columns)}&p=25000~26000&r=0,0&auto=0&vis=2&lines=`);await probe.waitForReady();
  const doc=await page.evaluate(()=>window.cubeAgent.export());expect(doc.comparison.captures).toEqual([]);expect(doc.selection.metrics.volume).toBe(6105000);
  await page.evaluate(d=>window.cubeAgent.apply(d),doc);await probe.waitForReady();
  const result=await page.evaluate(()=>window.cubeAgent.refresh());expect(result.document.selection.query).toEqual(doc.selection.query);expect(result.document.selection.metrics.volume).toBe(6105000);expect(result.changes).toEqual([]);
});
