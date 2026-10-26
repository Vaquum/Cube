"use strict";
const {test,expect}=require("./fixtures.js");

test("a window choice reads immediately and an unchanged fit does not restart camera motion",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard",{next:300});
  await page.addInitScript(()=>{
    let motion;
    window.windowCameraStarts=[];
    Object.defineProperty(window,"explorerMotion",{get:()=>motion,set:value=>{
      motion={...value,spring(element,name,options){
        if(element.id==="ol-canvas"&&name==="cells-camera")window.windowCameraStarts.push(performance.now());
        return value.spring(element,name,options);
      }};
    }});
    const later=window.setTimeout;
    window.setTimeout=(callback,delay,...args)=>later(callback,window.holdWindowDebounce&&callback.name==="pumpCube"&&delay===200?3600000:delay,...args);
  });
  await page.goto(fake.url+"/#w=24h&vis=2");await probe.waitForReady();
  await page.evaluate(()=>{window.windowCameraStarts=[];window.holdWindowDebounce=true;});
  const gate=fake.on({route:"/cube/query"}).gate();
  try {
    await page.locator("#ol-canvas").focus();await page.keyboard.press("7");
    await gate.arrived(); // the 200 ms dispatch timer is held for an hour
    await page.evaluate(()=>{window.holdWindowDebounce=false;});
    const before=JSON.parse(await page.locator("#ol-query-text").inputValue());
    gate.open();await probe.waitForReady();
    const after=JSON.parse(await page.locator("#ol-query-text").inputValue());
    expect([after.p1,after.p2]).toEqual([before.p1,before.p2]);
    expect(await page.evaluate(()=>window.windowCameraStarts.length)).toBe(1);
    await expect(page.locator("#ol-window-text")).toHaveText("7d");
  } finally {gate.open();}
});
