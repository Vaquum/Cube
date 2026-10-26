"use strict";
const {test,expect}=require("./fixtures.js");

function observeWindowMotion() {
    let motion;
    window.windowCameraStarts=[];
    window.windowDetailStarts=[];
    window.windowCameraDone=0;
    Object.defineProperty(window,"explorerMotion",{get:()=>motion,set:value=>{
      motion={...value,spring(element,name,options){
        if(element.id==="ol-canvas"&&name==="cells-camera")window.windowCameraStarts.push(performance.now());
        if(element.id==="ol-canvas"&&name==="cells")window.windowDetailStarts.push(performance.now());
        return value.spring(element,name,element.id==="ol-canvas"&&name==="cells-camera"?{...options,
          canComplete:()=>window.windowHold==null&&(options.canComplete?.()??true),
          write(state){options.write(window.windowHold==null?state:{progress:window.windowHold});},
          complete(){window.windowCameraDone++;options.complete?.();}}:options);
      }};
    }});
    const later=window.setTimeout;
    window.setTimeout=(callback,delay,...args)=>later(callback,window.holdWindowDebounce&&callback.name==="pumpCube"&&delay===200?3600000:delay,...args);
}

for (const late of [false,true]) test(`a window answer ${late?"after":"during"} camera motion shares its original timeline`,async({page,fakeFor,probe})=>{
  const fake=await fakeFor("standard",{next:300});
  await page.addInitScript(observeWindowMotion);
  await page.goto(fake.url+"/#w=24h&vis=2");await probe.waitForReady();
  await page.evaluate(()=>{window.windowCameraStarts=[];window.windowDetailStarts=[];window.windowCameraDone=0;window.holdWindowDebounce=true;});
  const gate=fake.on({route:"/cube/query"}).gate();
  try {
    await page.locator("#ol-canvas").focus();await page.keyboard.press("7");
    await gate.arrived(); // the 200 ms dispatch timer is held for an hour
    await page.evaluate(()=>{window.holdWindowDebounce=false;});
    if(late) await expect.poll(()=>page.evaluate(()=>window.windowCameraDone)).toBe(1);
    const before=JSON.parse(await page.locator("#ol-query-text").inputValue());
    gate.open();await probe.waitForReady();
    const after=JSON.parse(await page.locator("#ol-query-text").inputValue());
    expect([after.p1,after.p2]).toEqual([before.p1,before.p2]);
    expect(await page.evaluate(()=>window.windowCameraStarts.length)).toBe(1);
    expect(await page.evaluate(()=>window.windowDetailStarts.length)).toBe(0);
    await expect(page.locator("#ol-window-text")).toHaveText("7d");
  } finally {gate.open();}
});

test("an unchanged deferred Auto fit preserves the active camera",async({page,fakeFor,probe})=>{
  const profile={name:"unchanged-window-fit",cutoffIso:"2026-09-24T12:00Z",trades:[
    ["2026-08-15T01:00Z",10000],["2026-08-16T01:00Z",29999],
    ["2026-09-23T15:00Z",10000],["2026-09-24T01:00Z",29999],
  ].map(([time,price])=>({t_ms:Date.parse(time)-1609459200000,price:price*100,qty:100000000,takerBuy:true}))};
  await page.addInitScript(observeWindowMotion);
  await page.addInitScript(()=>{let encoding;Object.defineProperty(window,"explorerEncoding",{get:()=>encoding,set:value=>{
    encoding={...value,util:{...value.util,windowLevel:()=>({n:10,m:2})}};
  }});});
  const fake=await fakeFor(profile,{next:300});
  // Seven days includes a whole occupied 16-hour column; the 24-hour span
  // cuts both occupied columns and correctly has no fitted starting field.
  await page.goto(fake.url+"/#w=7d&vis=2");await probe.waitForReady();
  await expect(page.locator("#ol-legend")).toHaveAttribute("data-state","ready");
  await page.evaluate(()=>{window.windowCameraStarts=[];window.windowCameraDone=0;window.windowHold=.35;});
  const gate=fake.on({route:"/cube/tile"}).gate();
  try {
    await page.locator("#ol-window").click();await page.locator('[data-window="45d"]').click();await gate.arrived();
    const before=JSON.parse(await page.locator("#ol-query-text").inputValue());
    expect([before.p1,before.p2]).toEqual([8000,32000]);
    gate.open();
    await expect(page.locator("#ol-canvas")).toHaveAttribute("data-subdivision",/dividing|joining|blending/);
    const after=JSON.parse(await page.locator("#ol-query-text").inputValue());
    expect([after.p1,after.p2]).toEqual([before.p1,before.p2]);
    expect(await page.evaluate(()=>window.windowCameraStarts.length)).toBe(1);
    expect(await page.evaluate(()=>window.windowCameraDone)).toBe(0);
  } finally {gate.open();await page.evaluate(()=>{window.windowHold=null;});}
  await probe.waitForReady();
});
