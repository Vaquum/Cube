"use strict";
const {test,expect}=require("./fixtures.js");
const VIEW="#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=";
for(const recovery of ["replay","selection","annotation"])test(`agent ${recovery} can recover a selection wholly after replay`,async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(async()=>{await window.cubeAgent.configure({selection:[2,3,200,202]});await window.cubeAgent.replay(1,true);});await probe.waitForReady();
  if(recovery==="replay")await page.evaluate(()=>window.cubeAgent.replay(null,false));
  else if(recovery==="selection")await page.evaluate(()=>window.cubeAgent.configure({selection:null}));
  else {await page.evaluate(()=>window.cubeAgent.annotate({a:{timeMs:1609459200000,priceCents:2500000},b:{timeMs:1609459256250,priceCents:2512500},color:"#aa5533",label:"After edge"}));await page.evaluate(()=>window.cubeAgent.replay(null,false));}
  await probe.waitForReady();const result=await page.evaluate(()=>window.cubeAgent.export());
  if(recovery==="selection")expect(result.scene.view.selection).toBeNull();else expect(result.scene.view.replay).toBe(false);
  if(recovery==="annotation")expect(result.scene.drawings.objects[0].label).toBe("After edge");
});
test("agent selection rounding refuses an empty base rectangle without changing the page",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();const before=await page.evaluate(()=>window.cubeAgent.export());
  const error=await page.evaluate(()=>window.cubeAgent.configure({selection:[2.1,2.2,200.1,200.2]}).then(()=>null,e=>e.message));expect(error).toMatch(/base column and row/);
  const after=await page.evaluate(()=>window.cubeAgent.export());expect(after.scene.view).toEqual(before.scene.view);expect(after.selection).toEqual(before.selection);
});
test("clearing a selection clips the requested query to history while retaining camera padding",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");fake.advance({toIso:"2021-01-01T00:06:00Z"});await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  await page.evaluate(async()=>{const d=await window.cubeAgent.export();d.scene.view.viewport=[0,8,198,204];d.scene.view.selection=[0,2,200,202];d.scene=window.explorerAgent.seal(d.scene);await window.cubeAgent.apply(window.explorerAgent.seal(d));});await probe.waitForReady();
  const before=await page.evaluate(()=>window.cubeAgent.export());expect(Math.floor(before.scene.view.viewport[1]+.5)).toBeGreaterThan(7);
  await page.evaluate(()=>window.cubeAgent.configure({selection:null}));await probe.waitForReady();const after=await page.evaluate(()=>window.cubeAgent.export());expect(after.scene.view.selection).toBeNull();expect(after.scene.query.t2).toBe(7);expect(after.scene.view.viewport).toEqual(before.scene.view.viewport);
});

for(const empty of ["viewport","resolution","rounded camera"])test(`agent edits recover an empty ${empty} without a selection`,async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:mixed");await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();
  if(empty==="viewport") {await page.evaluate(()=>window.cubeAgent.configure({viewport:[3,6,198,204]}));await page.evaluate(()=>window.cubeAgent.replay(1,true));await page.evaluate(()=>window.cubeAgent.replay(null,false));}
  else if(empty==="resolution") {await page.evaluate(()=>window.cubeAgent.configure({resolution:[2,0]}));await page.evaluate(()=>window.cubeAgent.replay(1,true));await page.evaluate(()=>window.cubeAgent.configure({resolution:[0,0]}));}
  else {await page.goto(fake.url+"/#t=2021-01-01T00:02:30Z~2021-01-01T00:05:00Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=");await probe.waitForReady();await page.locator("canvas").first().focus();await page.keyboard.press("r");await page.keyboard.press(",");await page.evaluate(()=>window.cubeAgent.replay(null,false));}
  await probe.waitForReady();const d=await page.evaluate(()=>window.cubeAgent.export());expect(d.scene.view.selection).toBeNull();if(empty==="resolution")expect(d.scene.query.tR).toBe(0);else expect(d.scene.view.replay).toBe(false);
});
