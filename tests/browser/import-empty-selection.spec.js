"use strict";
const {test,expect}=require("./fixtures.js");
test.use({reducedMotion:"reduce"});
const VIEW="#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=";
async function outgoing(page,fakeFor,probe,kind,forces=false) {
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW+(forces?"&rc=1&strip=forces":""));await probe.waitForReady();
  if(forces)await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  const original=await page.evaluate(()=>window.cubeAgent.export());
  if(kind==="replay") await page.evaluate(()=>window.cubeAgent.configure({selection:[2,3,200,202]}));
  else await page.evaluate(async()=>{const d=await window.cubeAgent.export();d.mode="live";d.snapshot=null;d.scene.view.selection=[2.1,2.2,200.1,200.2];d.scene=window.explorerAgent.seal(d.scene);await window.cubeAgent.apply(window.explorerAgent.seal(d));});
  if(kind==="replay") {await page.locator("#ol-canvas").focus();await page.keyboard.press("r");for(let i=0;i<7;i++)await page.keyboard.press(",");}
  await probe.waitForReady();return original;
}
for(const kind of ["replay","rounded"]) test(`valid import restores while outgoing selection is empty in ${kind}`,async({page,fakeFor,probe})=>{
  const original=await outgoing(page,fakeFor,probe,kind);
  await page.evaluate(doc=>window.cubeAgent.apply(doc),original);await probe.waitForReady();
  const after=await page.evaluate(()=>window.cubeAgent.export());
  expect(after.scene.view).toEqual(original.scene.view);expect(after.selection).toEqual(original.selection);
  await expect(page.locator("#ol-analysis-status")).toContainText("Captured evidence");
});
for(const kind of ["replay","rounded"]) test(`a runtime import failure preserves the empty ${kind} selection and source`,async({page,fakeFor,probe})=>{
  const original=await outgoing(page,fakeFor,probe,kind,true),before={url:page.url(),query:await page.locator("#ol-query-text").inputValue(),cutoff:await page.locator("#ol-strip").getAttribute("data-cutoff")};
  const failure=await page.evaluate(async d=>{
    // A valid JSON packet with a malformed cache fails during installation, after source mutation.
    d.snapshot.cache.candleRanges={cubeMap:[["bad",null]]};
    try {await window.cubeAgent.apply(window.explorerAgent.seal(d));return "unexpected success";}catch(error){return error.message;}
  },original);
  expect(failure).toMatch(/generation/);expect(page.url()).toBe(before.url);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-cutoff",before.cutoff);
  expect(await page.locator("#ol-query-text").inputValue()).toBe(before.query);
  expect(await page.evaluate(()=>window.cubeAgent.export().then(()=>"unexpected success",error=>error.message))).toContain("query rectangle is not ordered");
  // The valid document can still be applied after rollback.
  await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
  expect((await page.evaluate(()=>window.cubeAgent.export())).scene.view).toEqual(original.scene.view);
});

test("a failure after the imported view applies restores the original palette",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const original=await page.evaluate(()=>window.cubeAgent.export());
  const failure=await page.evaluate(async d=>{
    const lut=window.explorerEncoding.lut,other=Object.keys(lut.APPEARANCES).find(name=>lut.appearanceId(name)!==d.scene.appearance.id);
    d.scene.appearance.id=lut.appearanceId(other);d.scene=window.explorerAgent.seal(d.scene);d=window.explorerAgent.seal(d);
    const comparison=window.explorerState.comparison;
    window.explorerState.comparison={...comparison,measure(){window.explorerState.comparison=comparison;throw Error("late comparison failure");}};
    try {await window.cubeAgent.apply(d);return "unexpected success";}catch(error){return error.message;}finally{window.explorerState.comparison=comparison;}
  },original);
  expect(failure).toBe("late comparison failure");
  const after=await page.evaluate(()=>window.cubeAgent.export());
  expect(after.scene.appearance.id).toBe(original.scene.appearance.id);
  expect(after.scene.view).toEqual(original.scene.view);
});
async function populated(page,fakeFor,probe) {
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.locator("#ol-tab-cells").click();await page.locator('#ol-table-body tr[data-c="0"][data-r="200"]').getByRole("button",{name:"Add to comparison"}).click();
  await page.evaluate(()=>window.cubeAgent.annotate({a:{timeMs:1609459200000,priceCents:2500000},b:{timeMs:1609459256250,priceCents:2512500},color:"#aa5533",label:"Retained drawing"}));await probe.waitForReady();
  return {fake,before:await page.evaluate(()=>window.cubeAgent.export())};
}
for(const expanded of [false,true])test(`a late import failure restores ${expanded?"expanded":"ordinary"} collections and address`,async({page,fakeFor,probe})=>{
  let {before}=await populated(page,fakeFor,probe);
  if(expanded){await page.locator("#ol-tab-compare").click();await page.locator('[data-comparison-action="expand"]').dispatchEvent("click");await expect(page.locator('[data-comparison-action="expand"]')).toHaveAttribute("aria-expanded","true");before=await page.evaluate(()=>window.cubeAgent.export());}
  const url=page.url(),persisted=await page.evaluate(()=>window.explorerState.comparison.read("BTC/USDT").value);
  const error=await page.evaluate(async d=>{
    d.scene.view.lines=["1d"];d.scene.drawings=window.explorerEncoding.drawings.empty();d.scene=window.explorerAgent.seal(d.scene);d.comparison=null;d.focus=null;
    d.snapshot.cache.lineResults={cubeMap:[["bad",null]]};
    try{await window.cubeAgent.apply(window.explorerAgent.seal(d));return "unexpected success";}catch(e){return e.message;}
  },before);
  expect(error).toMatch(/state/);if(!expanded)await probe.waitForReady();const after=await page.evaluate(()=>window.cubeAgent.export());
  expect(after.scene.drawings).toEqual(before.scene.drawings);expect(after.comparison).toEqual(before.comparison);expect(page.url()).toBe(url);
  const stored=await page.evaluate(()=>({drawings:window.explorerState.drawings.load().collection,comparison:window.explorerState.comparison.read("BTC/USDT").value}));
  expect(stored.drawings).toEqual(before.scene.drawings);expect(stored.comparison).toEqual(persisted);
  if(expanded)await expect(page.locator('[data-comparison-action="expand"]')).toHaveAttribute("aria-expanded","true");
});
for(const captured of [false,true])test(`failed import preserves ${captured?"captured freeze":"live polling"}`,async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();const original=await page.evaluate(()=>window.cubeAgent.export());
  if(captured){await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();}
  const error=await page.evaluate(async d=>{d.snapshot.cache.candleRanges={cubeMap:[["bad",null]]};try{await window.cubeAgent.apply(window.explorerAgent.seal(d));return "unexpected success";}catch(e){return e.message;}},original);expect(error).toMatch(/generation/);
  const offset=fake.log().length;fake.revise({day:"2021-01-01",factor:2});
  if(captured){await page.waitForTimeout(3700);expect(fake.log().slice(offset).filter(r=>r.path==="/cube/pack")).toEqual([]);}
  else await expect.poll(()=>fake.log().slice(offset).filter(r=>r.path==="/cube/pack").length,{timeout:12000}).toBeGreaterThan(0);
});

test("an earlier captured query does not block importing a later valid investigation",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();const original=await page.evaluate(()=>window.cubeAgent.export());
  await page.evaluate(async()=>window.cubeAgent.apply(await window.cubeAgent.query({t1:"2021-01-01T00:00:00Z",t2:"2021-01-01T00:01:52.500Z",p1:25000,p2:25250,tR:56.25,pR:125})));await probe.waitForReady();
  await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
  const restored=await page.evaluate(()=>window.cubeAgent.export());expect(restored.scene.view).toEqual(original.scene.view);expect(restored.snapshot.cutoffMs).toBe(original.snapshot.cutoffMs);
});

test("a refused incoming comparison rejects the whole import and retains outgoing collections",async({page,fakeFor,probe})=>{
  const {before}=await populated(page,fakeFor,probe);
  const error=await page.evaluate(async d=>{d.scene.drawings=window.explorerEncoding.drawings.empty();d.scene=window.explorerAgent.seal(d.scene);d.comparison=null;d.focus=null;const original=window.explorerState.comparison;window.explorerState.comparison={...original,measure(){window.explorerState.comparison=original;return {ok:false,reason:"Comparison refused"};}};try{await window.cubeAgent.apply(window.explorerAgent.seal(d));return "unexpected success";}catch(e){return e.message;}finally{window.explorerState.comparison=original;}},before);
  expect(error).toBe("Comparison refused");await probe.waitForReady();const after=await page.evaluate(()=>window.cubeAgent.export());expect(after.scene.drawings).toEqual(before.scene.drawings);expect(after.comparison).toEqual(before.comparison);
});
