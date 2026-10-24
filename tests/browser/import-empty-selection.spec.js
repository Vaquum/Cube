"use strict";
const {test,expect}=require("./fixtures.js");
const VIEW="#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=";
async function outgoing(page,fakeFor,probe,kind) {
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  const original=await page.evaluate(()=>window.cubeAgent.export());
  await page.evaluate(selection=>window.cubeAgent.configure({selection}),kind==="replay"?[2,3,200,202]:[2.1,2.2,200.1,200.2]);
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
  const original=await outgoing(page,fakeFor,probe,kind),before={url:page.url(),query:await page.locator("#ol-query-text").inputValue()};
  const failure=await page.evaluate(async d=>{
    // A valid JSON packet with a malformed cache fails during installation, after source mutation.
    d.snapshot.cache.candleRanges={cubeMap:[["bad",null]]};
    try {await window.cubeAgent.apply(window.explorerAgent.seal(d));return "unexpected success";}catch(error){return error.message;}
  },original);
  expect(failure).toMatch(/generation/);expect(page.url()).toBe(before.url);
  expect(await page.locator("#ol-query-text").inputValue()).toBe(before.query);
  expect(await page.evaluate(()=>window.cubeAgent.export().then(()=>"unexpected success",error=>error.message))).toContain("query rectangle is not ordered");
  // The valid document can still be applied after rollback.
  await page.evaluate(d=>window.cubeAgent.apply(d),original);await probe.waitForReady();
  expect((await page.evaluate(()=>window.cubeAgent.export())).scene.view).toEqual(original.scene.view);
});
