"use strict";
// Oracle: continuity of presented browser rectangles, retained DOM identity/focus,
// native modal state, and complete release of temporary presentation ownership.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");
async function open(page,fakeFor,probe,profile="standard") {
  const fake=await fakeFor(profile);
  await page.setViewportSize({width:1500,height:950});
  await page.goto(`${fake.url}/#w=24h&vis=2`);
  await S.atRest(page,fake,probe);
  return fake;
}
async function settled(page) {
  await expect.poll(()=>page.evaluate(()=>window.explorerMotion.motionActive()),{timeout:15000}).toBe(false);
}
test("inspector reversal starts from its presented width and restores native sizing",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  await page.locator("#ol-side-toggle").click();
  const continuity=await page.evaluate(()=>{
    const side=document.querySelector("#ol-side"),button=document.querySelector("#ol-side-toggle");
    const before=side.getBoundingClientRect().width;button.click();
    return {before,after:side.getBoundingClientRect().width,expanded:button.getAttribute("aria-expanded")};
  });
  expect(Math.abs(continuity.after-continuity.before)).toBeLessThan(.6);
  expect(continuity.expanded).toBe("true");await settled(page);
  expect(await page.locator("#ol-main").getAttribute("data-flow-grid")).toBeNull();
  expect(await page.locator("#ol-main").evaluate(node=>node.style.gridTemplateColumns)).toBe("");
});
test("sort retains a cell row, its focused action and authoritative values",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe,"micro:mixed");
  await page.locator("#ol-tab-cells").click();await settled(page);
  const observed=await page.evaluate(()=>{
    const row=document.querySelector("#ol-table-body tr"),button=row.querySelector('[data-cell-comparison-action="copy"]');
    window.__motionRow=row;window.__motionAction=button;button.focus();
    return {key:row.dataset.cellKey,text:row.textContent};
  });
  await page.locator('[data-sort="price"]').click();await settled(page);
  const actual=await page.evaluate(key=>{
    const row=[...document.querySelectorAll("#ol-table-body tr")].find(row=>row.dataset.cellKey===key);
    return {retained:row===window.__motionRow,action:row?.querySelector('[data-cell-comparison-action="copy"]')===window.__motionAction,text:row?.textContent};
  },observed.key);
  expect(actual.retained).toBe(true);expect(actual.action).toBe(true);expect(actual.text).toBe(observed.text);
});
test("popover close is logical immediately and retains an inert exit",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-window").click();await settled(page);
  await page.locator("#ol-window").click();
  const state=await page.locator("#ol-window-menu").evaluate(node=>({hidden:node.hidden,inert:getComputedStyle(node).interactivity==="inert",retained:node.hasAttribute("data-flow-retained")}));
  expect(state.hidden).toBe(true);expect(state.inert).toBe(true);expect(state.retained).toBe(true);
  await settled(page);await expect(page.locator("#ol-window-menu")).toBeHidden();
});
test("native dialog close restores focus before its visual exit",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-help").click();
  await expect(page.locator("#ol-keys")).toHaveJSProperty("open",true);
  await page.locator("#ol-keys-close").click();
  await expect(page.locator("#ol-keys")).toHaveJSProperty("open",false);
  await expect(page.locator("#ol-help")).toBeFocused();
});
test("reduced motion and print release active panel and canvas presentation",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-side-toggle").click();
  await page.emulateMedia({reducedMotion:"reduce"});await settled(page);
  expect(await page.locator("[data-motion-running]").count()).toBe(0);
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.locator("#ol-side-toggle").click();
  await page.evaluate(()=>window.dispatchEvent(new Event("beforeprint")));
  expect(await page.evaluate(()=>window.explorerMotion.motionActive())).toBe(false);
  expect(await page.locator("#ol-main").evaluate(node=>node.style.gridTemplateColumns)).toBe("");
  await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));
});
test("guided scrolling yields to direct input",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-reference-toggle").click();await settled(page);
  await page.evaluate(()=>{const body=document.querySelector("#ol-reference-body");window.explorerMotion.scrollAxis(body,body.scrollHeight);});
  await page.locator("#ol-reference-topic").press("ArrowDown");
  await settled(page);
  expect(await page.evaluate(()=>window.explorerMotion.motionValue(document.querySelector("#ol-reference-body"),"scroll"))).toBeNull();
});

test("reference guidance can reopen during its inert visual exit",async({page,fakeFor,probe,surface})=>{
  await open(page,fakeFor,probe);
  const first=await surface.openLegendDetails("cells");await first.close();
  const second=await surface.openLegendDetails("cells");
  await expect(second.popover).toBeVisible();
  expect(await page.locator("#ol-reference").evaluate(node=>node.hidden||node.inert)).toBe(false);
  await second.close();
});

test("retained drawing actions use the current object and toggle destination",async({page,fakeFor})=>{
  const D=require("./drawings-support.js");const fake=await fakeFor("mini");
  await page.setViewportSize({width:1500,height:950});await D.open(page,fake);
  const first=await D.drawing(page),second=await D.drawing(page,[.125,.25],[.375,.375]);
  await D.choose(page,first.id);await D.command(page,"visible");
  await D.lines(page);expect((await D.row(page,first.id)).visible).toBe(false);
  await D.action(page,first.id,"visible");await D.lines(page);
  expect((await D.row(page,first.id)).visible).toBe(true);
  await D.choose(page,first.id);await D.command(page,"lock");await D.lines(page);
  expect((await D.row(page,first.id)).locked).toBe(true);
  await D.command(page,"lock");await D.lines(page);
  expect((await D.row(page,first.id)).locked).toBe(false);
  await D.choose(page,second.id);await D.command(page,"lock");await D.lines(page);
  expect((await D.row(page,second.id)).locked).toBe(true);
  expect((await D.row(page,first.id)).locked).toBe(false);
});

test("reopened panels accept synchronous focus during an exit",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  await page.locator("#ol-window").click();await settled(page);
  await page.locator("#ol-window").click();
  const focused=await page.evaluate(()=>{
    const button=document.querySelector("#ol-window");button.click();
    const choice=document.querySelector("#ol-window-menu button:not(:disabled)");choice.focus();
    return document.activeElement===choice;
  });
  expect(focused).toBe(true);
});
test("authored visibility survives a native disclosure animation",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  await page.evaluate(()=>{
    const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("div");
    details.id="visibility-fixture";summary.textContent="Movement details";body.textContent="Movement-only counts";
    details.append(summary,body);document.querySelector("#origo-lens").append(details);
    summary.click();body.hidden=true;
  });await settled(page);
  await expect(page.locator("#visibility-fixture > div")).toHaveJSProperty("hidden",true);
});
test("closed reset dialogs reject interaction throughout their exit",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe,"mini");await require("./drawings-support.js").drawing(page);await page.locator("#ol-reset-canvas").click();
  await expect(page.locator("#ol-reset-confirm")).toHaveJSProperty("open",true);
  const action=await page.locator("#ol-reset-apply").boundingBox();
  await page.keyboard.press("Escape");
  const closed=await page.locator("#ol-reset-confirm").evaluate(node=>({open:node.open,interactive:getComputedStyle(node).interactivity,pointer:getComputedStyle(node).pointerEvents}));
  expect(closed.open).toBe(false);expect(closed.pointer).toBe("none");expect(closed.interactive).toBe("inert");
  await page.mouse.click(action.x+action.width/2,action.y+action.height/2);
  expect(await require("./drawings-support.js").count(page)).toBe(1);
});
test("tooltips retain their anchored position while fading",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);
  const result=await page.evaluate(async()=>{
    const tip=document.querySelector("#ol-tip");tip.hidden=false;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    return {transform:tip.style.transform,translate:tip.style.translate};
  });
  expect(result.transform).toBe("");expect(result.translate).toBe("");
});
test("guided scroll APIs retain compatible coordinates on retarget",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-reference-toggle").click();await settled(page);
  await page.evaluate(()=>{
    const body=document.querySelector("#ol-reference-body"),actor=body.querySelector("article"),flow=window.explorerMotion;
    flow.scrollAxis(body,body.scrollHeight);flow.scrollToActor(actor);flow.scrollAxis(body,0);
  });await settled(page);
});

test("comparison sorting preserves presented position, identity and focus",async({page,fakeFor,probe})=>{
  const {COMPARISON_KEY,comparisonFixture}=await import("../../tools/benchmark/comparison.mjs");
  await page.addInitScript(({key,model})=>sessionStorage.setItem(key,JSON.stringify(model)),{key:COMPARISON_KEY,model:comparisonFixture(4)});
  await open(page,fakeFor,probe,"mini");await page.locator("#ol-tab-compare").click();await settled(page);
  const result=await page.evaluate(()=>{
    const card=document.querySelector(".ol-comparison-card"),button=card.querySelector('[data-comparison-action="focus"]');
    button.focus();const before=card.getBoundingClientRect();
    document.querySelector('[data-comparison-action="direction"]').click();
    const after=card.getBoundingClientRect(),first=document.querySelector(".ol-comparison-card");
    return {key:card.dataset.captureId,first:first.dataset.captureId,retained:card.isConnected,focused:document.activeElement===button,
      difference:Math.hypot(before.x-after.x,before.y-after.y),moving:card.hasAttribute("data-flow-layout")};
  });
  expect(result.first).not.toBe(result.key);expect(result.retained).toBe(true);expect(result.focused).toBe(true);
  expect(result.difference).toBeLessThan(1);expect(result.moving).toBe(true);await settled(page);
});
