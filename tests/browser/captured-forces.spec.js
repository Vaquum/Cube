"use strict";
// Synthetic publication identities and constant leans isolate ownership, not market/model accuracy.
const {test,expect}=require("./fixtures.js");
test.use({reducedMotion:"reduce"});
const HASH="#w=24h&vis=2&rc=1&strip=forces&lines=", NOTE="Forces data was not captured in this investigation";
async function publication(page,letter,lean) {
  await page.route("**/cube/strip?*",async route=>{
    const response=await route.fetch(),body=await response.json();
    body.snapshot.id=letter.repeat(64);body.model=`synthetic-capture-${letter}`;
    for(const values of Object.values(body.grid.forces)) values.fill(lean/4);
    body.grid.attention.fill(.5);body.events=[];body.jumps=[];
    await route.fulfill({response,json:body}).catch(()=>{});
  });
}
async function open(page,fake,hash=HASH,query="") {
  await page.goto(fake.url+"/"+query+hash);
  await require("./probe.js").forPage(page).waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  await expect.poll(()=>page.evaluate(()=>typeof window.cubeAgent?.export)).toBe("function");
}
async function hover(page) {
  const canvas=page.locator("#ol-canvas"),box=await canvas.boundingBox(),g=(await canvas.getAttribute("data-layout")).split(",").map(Number);
  await page.mouse.move(box.x+g[0]+g[2]*.3,box.y+g[14]+23);
  const card=page.locator("#ol-tip");await expect(card).toBeVisible();return card;
}
async function unavailable(page) {
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","uncaptured");
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-cutoff","");
  const card=await hover(page);
  await expect(card).toHaveAttribute("data-presentation","strip-sources");
  const obs=await card.evaluate(n=>JSON.parse(n.dataset.observation));expect(obs.pack).toBeNull();
  expect(obs.result.tag).toBe("unsupported");
  await expect(card).not.toContainText("Reading the strip");
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  const inspect=page.locator("#ol-inspect-readout");
  for(const part of ["sources","ahead","forces"]) {
    await page.locator("#ol-inspect-strip-view").selectOption(part);
    await expect(inspect).toHaveAttribute("data-presentation","strip-sources");
    expect(JSON.parse(await inspect.getAttribute("data-observation")).pack).toBeNull();
    await expect(inspect).toContainText(NOTE);
  }
  await page.keyboard.press("Escape");
  expect(await page.evaluate(()=>window.explorerAgent.text(window.explorerAgent.parse(window.explorerAgent.text(window.__capturedForces))))).toContain(NOTE);
}
async function choose(page,value,force) {
  await page.locator("#ol-strip").click();await page.locator(`#ol-strip-menu [data-strip="${value}"]`).click();
  if(force)await page.locator(`#ol-strip-menu [data-force="${force}"]`).click();
}
test("legacy Forces share opens explicitly uncaptured and menu changes cannot read live data",async({page,fakeFor,freshContext})=>{
  const fake=await fakeFor("mini");await publication(page,"a",.3);await open(page,fake);
  const doc=await page.evaluate(()=>window.cubeAgent.export()),link=await page.evaluate(()=>window.cubeAgent.share());
  const other=await (await freshContext()).newPage();await publication(other,"b",-.8);
  let reads=0;other.on("request",r=>{if(new URL(r.url()).pathname==="/cube/strip")reads++;});
  await other.goto(link);await expect(other.locator("#ol-market")).toHaveText("CAPTURED");
  await other.evaluate(d=>{window.__capturedForces=d;},doc);await unavailable(other);
  for(const [value,force] of [["off"],["forces","macro"],["off"],["forces","forces"]]) {await choose(other,value,force);if(value!=="off")await expect(other.locator("#ol-strip")).toHaveAttribute("data-state","uncaptured");}
  await other.waitForTimeout(350);expect(reads).toBe(0);
});
test("a warm later publication is masked, explicit refresh reads current data, and restore masks it again",async({page,fakeFor})=>{
  const fake=await fakeFor("mini");await publication(page,"a",.3);await open(page,fake);
  const doc=await page.evaluate(()=>window.cubeAgent.export());
  await page.unroute("**/cube/strip?*");fake.advance({minutes:720});await publication(page,"b",-.8);await open(page,fake,HASH.replace("24h","7d"),"?warm=1");
  expect(JSON.parse(await (await hover(page)).getAttribute("data-observation")).pack).toBe("b".repeat(64));
  await page.evaluate(async d=>{window.__capturedForces=d;await window.cubeAgent.apply(d);},doc);await unavailable(page);
  await page.unroute("**/cube/strip?*");await publication(page,"c",.9);
  await page.evaluate(()=>window.cubeAgent.refresh());await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  expect(JSON.parse(await (await hover(page)).getAttribute("data-observation")).pack).toBe("c".repeat(64));
  await page.evaluate(()=>window.cubeAgent.restorePrevious());await unavailable(page);
});
test("a queued or in-flight Strip response cannot populate an imported capture",async({page,fakeFor})=>{
  const fake=await fakeFor("mini");await publication(page,"a",.3);await open(page,fake);
  const doc=await page.evaluate(()=>window.cubeAgent.export());
  await page.goto(fake.url+"/?empty=1"+HASH.replace("strip=forces","strip=off"));
  await expect.poll(()=>page.evaluate(()=>typeof window.cubeAgent?.apply)).toBe("function");
  const gate=fake.on({route:"/cube/strip",times:1}).gate();await choose(page,"forces","forces");await gate.arrived();
  await page.evaluate(async d=>{window.__capturedForces=d;await window.cubeAgent.apply(d);},doc);
  gate.open();await unavailable(page);const reads=fake.log().filter(r=>r.path==="/cube/strip").length;
  await page.waitForTimeout(650);expect(fake.log().filter(r=>r.path==="/cube/strip").length).toBe(reads);
});
