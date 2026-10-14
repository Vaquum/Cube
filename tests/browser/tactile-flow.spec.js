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
  const state=await page.locator("#ol-window-menu").evaluate(node=>({hidden:node.hidden,inert:node.inert,retained:node.hasAttribute("data-flow-retained")}));
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
