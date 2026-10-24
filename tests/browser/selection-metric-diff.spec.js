"use strict";
const {test,expect}=require("./fixtures.js");
const fixture=require("../fixtures/regressions/clipped-capture-support/cases.json");
const VIEW="#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=";
async function refresh(fake,document) {
  const {dispatch}=await import("../../tools/cube-agent.mjs"),prior=process.env.CUBE_URL;process.env.CUBE_URL=fake.url;
  try{return await dispatch("cube_refresh",{document});}finally{if(prior===undefined)delete process.env.CUBE_URL;else process.env.CUBE_URL=prior;}
}
test("unchanged browser evidence has no MCP metric changes, while a real revision retains canonical changes",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const doc=await page.evaluate(()=>window.cubeAgent.export()),same=await refresh(fake,doc);
  expect(same.changes).toEqual([]);expect(same.unavailableSelectionMetrics??[]).toEqual([]);
  fake.revise({day:"2021-01-01",factor:2});const revised=await refresh(fake,doc);
  expect(revised.changes.map(c=>({metric:c.metric,before:c.before,after:c.after}))).toEqual([
    {metric:"volume",before:953.375,after:1906.75},{metric:"taker_buy_volume",before:528.125,after:1056.25}
  ]);
});
test("legacy row-valued POC is disclosed as incomparable while retained amounts remain comparable",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const doc=await page.evaluate(()=>window.cubeAgent.export());for(const key of ["poc","taker_buy_poc","pocRowWidth"])delete doc.selection.metrics[key];
  const sealed=await page.evaluate(d=>window.explorerAgent.seal(d),doc),same=await refresh(fake,sealed);
  expect(same.changes).toEqual([]);expect(same.unavailableSelectionMetrics.map(x=>x.metric)).toEqual(["poc","taker_buy_poc"]);
});
test("browser POC widths remain explicit when compared with a finer MCP query",async({page,fakeFor,probe})=>{
  const EPOCH=1609459200000,BASE=56250,iso=c=>new Date(EPOCH+c*BASE).toISOString();
  const fake=await fakeFor({cutoffIso:iso(fixture.cutoffBase),trades:fixture.trades.map(({base,offsetMs,...t})=>({...t,t_ms:base*BASE+offsetMs}))});
  await page.goto(fake.url+`/#t=${iso(0)}~${iso(4096)}&p=25000~26000&r=12,3&auto=0&vis=2&lines=`);await probe.waitForReady();
  const doc=await page.evaluate(()=>window.cubeAgent.export());expect(doc.selection.metrics.pocRowWidth).toBe(1000);
  const {dispatch}=await import("../../tools/cube-agent.mjs"),prior=process.env.CUBE_URL;process.env.CUBE_URL=fake.url;
  let fine;try{fine=await dispatch("cube_query",{query:{t1:iso(0),t2:iso(4096),p1:25000,p2:26000,tR:4096*56.25,pR:125}});}finally{if(prior===undefined)delete process.env.CUBE_URL;else process.env.CUBE_URL=prior;}
  const same=await page.evaluate(([a,b])=>{for(const d of [a,b]){d.comparison.captures=[];d.comparison.focus=null;}return window.explorerAgent.diff(window.explorerAgent.seal(a),window.explorerAgent.seal(b));},[doc,fine]);expect(same.changes).toEqual([]);
  expect(same.unavailableSelectionMetrics.map(x=>x.metric)).toEqual(["poc","taker_buy_poc","cell_count"]);
  expect(same.unavailableSelectionMetrics.filter(x=>x.metric!=="cell_count").every(x=>/price row/.test(x.reason))).toBe(true);
});
test("historical selection support ends at its rectangle and remains visible after that edge in replay",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(()=>window.cubeAgent.configure({selection:[0,2,200,202]}));await probe.waitForReady();
  const d=await page.evaluate(()=>window.cubeAgent.export("selection"));expect(d.selection.measuredThrough).toBe(1609459312500);expect(d.selection.metrics.volume).toBe(450.75);
  const legacy=await page.evaluate(d=>{d.selection.measuredThrough=1609459500000;return window.explorerAgent.seal(d);},d);
  const {dispatch}=await import("../../tools/cube-agent.mjs");const replay=await dispatch("cube_replay",{document:legacy,anchor:3});expect(replay.selection.metrics.volume).toBe(450.75);expect(replay.selection.state).not.toBe("hidden");
});
test("empty recorded support remains unavailable instead of becoming a false source revision",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(async()=>{const d=await window.cubeAgent.export();d.snapshot.sources=d.snapshot.sources.filter(s=>s.id==="overview");d.snapshot.live=false;d.snapshot.cache={};d.scene.view.selection=[0,6,201,203];d.scene.query={...d.scene.query,t1:0,t2:6,p1:201,p2:203};d.scene=window.explorerAgent.seal(d.scene);await window.cubeAgent.apply(window.explorerAgent.seal(d));});
  const d=await page.evaluate(()=>window.cubeAgent.export("selection"));expect(d.selection.metrics.tag).toBe("unsupported");expect(d.selection.metrics.value).toBeNull();
  const result=await refresh(fake,d);expect(result.changes).toEqual([]);expect(result.selectionState.before.state).toBe("unsupported");expect(result.selectionState.after.values.volume).toBe(327.375);
});
test("real MCP refresh reports pending/failed availability once without numeric revisions",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();const original=await page.evaluate(()=>window.cubeAgent.export());
  for(const tag of ["pending","failed"]){const d=await page.evaluate(([d,tag])=>{d.selection.metrics={tag,value:null,reason:tag};d.selection.state=tag;return window.explorerAgent.seal(d);},[original,tag]);const result=await refresh(fake,d);expect(result.changes).toEqual([]);expect(result.selectionState.before.state).toBe(tag);expect(result.selectionState.after.values.volume).toBe(953.375);}
});
test("coarse-source selections retain their actual reduction level through unchanged refresh",async({page,fakeFor,probe})=>{
  const fake=await fakeFor({cutoffIso:"2021-01-01T00:05:00Z",trades:[400,800,1200].map((qty,i)=>({t_ms:i*60000+1000,price:2500000,qty,takerBuy:true}))});
  await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(async()=>{const d=await window.cubeAgent.export();d.snapshot.sources=d.snapshot.sources.filter(s=>s.id==="overview");d.snapshot.cache={};d.scene.view.viewport=[0,6,200,208];d.scene.view.selection=null;d.scene.query={t1:0,t2:6,p1:200,p2:208,tR:0,pR:0};d.scene=window.explorerAgent.seal(d.scene);await window.cubeAgent.apply(window.explorerAgent.seal(d));});
  const d=await page.evaluate(()=>window.cubeAgent.export("selection"));expect(d.selection.query).toMatchObject({tR:12,pR:3});
  const result=await refresh(fake,d);expect(result.document.selection.query).toEqual(d.selection.query);expect(result.changes.filter(c=>c.selection)).toEqual([]);
});

test("recorded fallback at a fractional source cutoff can refresh in the browser",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(async()=>{const d=await window.cubeAgent.export();d.snapshot.sources=d.snapshot.sources.filter(s=>s.id==="overview");d.snapshot.cache={};d.snapshot.live=false;d.scene.view.viewport=[0,6,199,209];d.scene.view.selection=null;d.scene.query={t1:0,t2:6,p1:199,p2:209,tR:0,pR:0};d.scene=window.explorerAgent.seal(d.scene);await window.cubeAgent.apply(window.explorerAgent.seal(d));});
  const d=await page.evaluate(()=>window.cubeAgent.export("selection"));expect(d.selection.state).toBe("recorded");expect(d.selection.measuredThrough).toBe(1609459500000);
  await page.evaluate(d=>window.cubeAgent.apply(d),d);await probe.waitForReady();
  const result=await page.evaluate(()=>window.cubeAgent.refresh());expect(result.changes.filter(c=>c.selection)).toEqual([]);expect(result.document.selection.query.t2).toBe(6);
});
test("copying a future comparison cell during replay exports unavailable selection evidence",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.locator("#ol-tab-cells").click();await page.locator('#ol-table-body tr[data-c="1"][data-r="201"]').getByRole("button",{name:"Add to comparison"}).click();
  await page.evaluate(()=>window.cubeAgent.replay(1));await probe.waitForReady();
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.copiedHidden=text;}}}));
  await page.locator('#ol-comparisonWorkspace .ol-comparison-focus [data-comparison-action="copy"]').click();
  await expect.poll(()=>page.evaluate(()=>Boolean(window.copiedHidden))).toBe(true);
  const d=await page.evaluate(()=>window.explorerAgent.parse(window.copiedHidden));expect(d.comparison.captures[0].metrics["volume.amount"].tag).toBe("hidden");expect(d.selection.state).toBe("hidden");expect(d.selection.metrics).toMatchObject({tag:"hidden",value:null});expect(d.selection.metrics.cell_count).toBeUndefined();
});
