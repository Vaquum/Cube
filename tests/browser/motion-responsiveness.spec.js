"use strict";
const {test,expect}=require("./fixtures.js");

test("a spring keeps wall-clock duration on 100 ms frames",async({freshContext,fakeFor})=>{
 const fake=await fakeFor("mini"),context=await freshContext({probe:false}),page=await context.newPage();
 await page.addInitScript(()=>{
  const native=requestAnimationFrame;
  window.requestAnimationFrame=callback=>window.__slowMotion&&callback.name==="tick"
   ?setTimeout(()=>callback(performance.now()),100):native(callback);
 });
 await page.goto(fake.url+"/#w=24h");await page.waitForFunction(()=>window.cubeAgent&&!window.explorerMotion.motionActive()&&document.querySelector("#ol-loading").hidden);
 await page.evaluate(()=>{
  window.__slowMotion=true;
  const actor=document.createElement("div");actor.id="slow-frame-actor";actor.style.cssText="position:fixed;top:0;left:0;width:10px;height:10px";
  document.querySelector("#origo-lens").append(actor);window.explorerMotion.reveal(actor);
 });
 await expect(page.locator("#slow-frame-actor")).not.toHaveAttribute("data-motion-running", "", {timeout:1500});
});

test("cell calibration commits while presentation keeps requesting frames",async({page,fakeFor,probe})=>{
 const fake=await fakeFor("mini");
 await page.addInitScript(()=>{
  let api;Object.defineProperty(window,"explorerMotion",{get:()=>api,set:motion=>{
   api={...motion,spring(owner,name,options){
    if(name==="cells")options={...options,canComplete:()=>!window.__holdCellSpring};
    return motion.spring(owner,name,options);
   }};
  }});
 });
 await page.goto(fake.url+"/#w=24h");await probe.waitForReady();
 await page.evaluate(()=>{window.__holdCellSpring=true;});
 await page.locator("#ol-canvas").focus();await page.keyboard.press("]");
 await expect(page.locator("#ol-legend")).toHaveAttribute("data-state","ready",{timeout:4000});
 expect(await page.locator("#ol-canvas").getAttribute("data-motion-running")).not.toBeNull();
 await page.evaluate(()=>{window.__holdCellSpring=false;});
});

test("year columns get their own axis while exact totals are still being read",async({page,fakeFor,probe})=>{
 const fake=await fakeFor("standard");
 await page.goto(fake.url+"/#w=24h&pane=volume");await probe.waitForReady();await fake.idle();
 const before=Number((await page.locator("#ol-axis-chip").getAttribute("data-domain")).split(",")[1]);
 const gate=fake.on({route:"/cube/query",when:args=>Number(args.b1)-Number(args.b0)>300*86400/56.25}).gate();
 await page.locator("#ol-canvas").focus();await page.keyboard.press("9");await gate.arrived();
 await expect.poll(async()=>Number((await page.locator("#ol-axis-chip").getAttribute("data-domain")).split(",")[1])).toBeGreaterThan(before*4);
 expect(gate.held).toBeGreaterThan(0);
 await expect(page.locator("#ol-axis-chip")).toHaveAttribute("data-axis-state","auto");
 gate.open();
});

// A full window jump can refit a wide price camera into a finer level.
// Destination cells must not overlap inside their former parent geometry.
test("seven-day stepping paints its destination resolution without a cell morph",async({page,fakeFor,probe})=>{
 const fake=await fakeFor("standard");
 await page.goto(fake.url+"/#w=7d&p=10000~50000&pane=volume");await probe.waitForReady();
 await page.locator("#ol-canvas").focus();await page.keyboard.press("Shift+ArrowLeft");
 expect(await page.locator("#ol-canvas").getAttribute("data-motion-running")).toBeNull();
 await probe.waitForReady();
 expect(await page.locator("#ol-canvas").getAttribute("data-motion-running")).toBeNull();
});

for(const auto of [false,true]) test(`a whole-window step interrupts an active ${auto?"auto":"manual"} resolution morph`,async({page,fakeFor,probe})=>{
 const fake=await fakeFor("standard");
 await page.goto(fake.url+"/#w=7d&pane=volume");await probe.waitForReady();
 await page.locator("#ol-canvas").focus();await page.keyboard.press("]");
 if(auto)await page.keyboard.press("a");
 expect(await page.locator("#ol-canvas").getAttribute("data-motion-running")).not.toBeNull();
 await page.keyboard.press("Shift+ArrowLeft");
 expect(await page.locator("#ol-canvas").getAttribute("data-motion-running")).toBeNull();
 await probe.waitForReady();
 expect(await page.locator("#ol-canvas").getAttribute("data-motion-running")).toBeNull();
});
