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
test("panel resizing keeps a complete canvas frame between paints",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  const alpha=()=>page.locator("#ol-canvas").evaluate(canvas=>canvas.getContext("2d").getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data[3]);
  expect(await alpha()).toBeGreaterThan(0);await page.locator("#ol-side-toggle").click();
  const blank=await page.evaluate(async()=>{
    const canvas=document.querySelector("#ol-canvas"),ctx=canvas.getContext("2d");let blank=0;
    for(let i=0;i<20;i++){
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
      if(!ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data[3])blank++;
    }
    return blank;
  });
  expect(blank).toBe(0);await settled(page);
});
test("sort retains a cell row, its focused action and authoritative values",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe,"micro:mixed");
  await page.locator("#ol-tab-cells").click();
  await expect(page.locator("#ol-table-body tr").first()).toBeVisible();await settled(page);
  const before=await page.locator("#ol-table-body tr").evaluateAll(rows=>rows.map(row=>row.dataset.cellKey));
  const observed=await page.evaluate(()=>{
    const row=document.querySelector("#ol-table-body tr"),button=row.querySelector('[data-cell-comparison-action="copy"]');
    window.__motionRow=row;window.__motionAction=button;button.focus();
    return {key:row.dataset.cellKey,text:row.textContent};
  });
  await page.locator('[data-sort="price"]').evaluate(button=>button.click());await settled(page);
  await expect(page.locator('th[aria-sort="descending"] [data-sort="price"]')).toBeVisible();
  expect(await page.locator("#ol-table-body tr").evaluateAll(rows=>rows.map(row=>row.dataset.cellKey))).not.toEqual(before);
  const actual=await page.evaluate(key=>{
    const row=[...document.querySelectorAll("#ol-table-body tr")].find(row=>row.dataset.cellKey===key);
    return {focused:document.activeElement===window.__motionAction,retained:row===window.__motionRow,action:row?.querySelector('[data-cell-comparison-action="copy"]')===window.__motionAction,text:row?.textContent};
  },observed.key);
  expect(actual.focused).toBe(true);expect(actual.retained).toBe(true);expect(actual.action).toBe(true);expect(actual.text).toBe(observed.text);
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
test("native close preserves the visible body while logical state closes immediately",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  const result=await page.evaluate(()=>{
    const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("div");
    details.id="close-fixture";summary.textContent="Disclosure";body.textContent="Retiring words";body.style.minHeight="100px";
    details.append(summary,body);document.querySelector("#origo-lens").append(details);details.open=true;
    const before=body.getBoundingClientRect().height;summary.click();
    return {before,after:body.getBoundingClientRect().height,open:details.open,inert:body.inert};
  });
  expect(result.open).toBe(false);expect(result.inert).toBe(true);expect(result.before).toBeGreaterThan(0);
  expect(result.after).toBeGreaterThan(0);await settled(page);
  await expect(page.locator("#close-fixture > div")).toBeHidden();
});
test("successive same-width content changes retain height before settling",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  await page.evaluate(()=>{
    const panel=document.createElement("div");panel.id="size-fixture";panel.style.width="200px";
    const first=document.createElement("div");first.style.height="20px";panel.append(first);
    document.querySelector("#origo-lens").append(panel);window.explorerMotion.observeSize(panel);
    const second=document.createElement("div");second.style.height="30px";panel.append(second);
  });await settled(page);
  const result=await page.evaluate(async()=>{
    const panel=document.querySelector("#size-fixture"),before=panel.getBoundingClientRect().height;
    const next=document.createElement("div");next.style.height="40px";panel.append(next);
    await Promise.resolve();return {before,after:panel.getBoundingClientRect().height};
  });
  expect(Math.abs(result.after-result.before)).toBeLessThan(1);await settled(page);
  expect(await page.locator("#size-fixture").evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThan(result.before+30);
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
test("revisiting the Rows period step keeps the current date draft authoritative",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe,"mini");await page.locator("#ol-rows").click();
  const menu=page.locator("#ol-rows-menu");await menu.locator('[data-rows="volume"]').click();
  await menu.locator('[data-rows-step="period"]').click();
  await page.locator("#ol-rows-period-date").fill("2026-09-01");
  await menu.locator('[data-rows-step="period"]').click();
  await page.locator("#ol-rows-period-date").fill("2026-09-03");
  await menu.locator(".ol-flow-date button").click();
  await expect.poll(()=>page.url()).toContain("2026-09-03");
});

test("nested disclosure close starts from its fully presented popover height",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  await page.evaluate(()=>{
    const panel=document.createElement("div"),details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("div"),content=document.createElement("div");
    panel.id="nested-size-fixture";panel.style.width="200px";summary.textContent="Nested details";content.style.height="100px";
    body.append(content);details.append(summary,body);panel.append(details);document.querySelector("#origo-lens").append(panel);
    window.explorerMotion.observeSize(panel);const warm=document.createElement("div");warm.style.height="5px";panel.append(warm);
  });await settled(page);
  await page.locator("#nested-size-fixture summary").click();await settled(page);
  const result=await page.evaluate(async()=>{
    const panel=document.querySelector("#nested-size-fixture"),before=panel.getBoundingClientRect().height;
    panel.querySelector("summary").click();await Promise.resolve();return {before,after:panel.getBoundingClientRect().height};
  });
  expect(Math.abs(result.after-result.before)).toBeLessThan(1);await settled(page);
  expect(await page.locator("#nested-size-fixture").evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(result.before-90);
});


test("retirement freezes moving descendants, clears IDs and releases its inert copy",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  const state=await page.evaluate(async()=>{
    const parent=document.createElement('div');parent.id='retire-source';
    Object.assign(parent.style,{position:'fixed',left:'60px',top:'120px',width:'180px',height:'80px',opacity:'.6'});
    parent.innerHTML='<span id="retire-flow">Moving text</span><button id="retire-native">Native opacity</button>';
    document.querySelector('#origo-lens').append(parent);
    const flow=parent.firstElementChild,native=parent.lastElementChild;flow.style.display='inline-block';
    window.explorerMotion.reveal(flow,{distance:8});
    native.animate([{opacity:.2},{opacity:1}],{duration:1000});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const before={top:flow.getBoundingClientRect().top,flowOpacity:Number(getComputedStyle(flow).opacity),nativeOpacity:Number(getComputedStyle(native).opacity)};
    window.explorerMotion.retire(parent);
    const ghost=document.querySelector('[data-flow-retiring]');
    return {before,after:{top:ghost.firstElementChild.getBoundingClientRect().top,flowOpacity:Number(getComputedStyle(ghost.firstElementChild).opacity),nativeOpacity:Number(getComputedStyle(ghost.lastElementChild).opacity)},ids:ghost.querySelectorAll('[id]').length,inert:ghost.inert,aria:ghost.getAttribute('aria-hidden'),original:parent.isConnected};
  });
  expect(Math.abs(state.after.top-state.before.top)).toBeLessThan(.1);
  expect(Math.abs(state.after.flowOpacity-state.before.flowOpacity)).toBeLessThan(.01);
  expect(Math.abs(state.after.nativeOpacity-state.before.nativeOpacity)).toBeLessThan(.01);
  expect(state.ids).toBe(0);expect(state.inert).toBe(true);expect(state.aria).toBe('true');expect(state.original).toBe(false);
  await settled(page);expect(await page.locator('[data-flow-retiring]').count()).toBe(0);
});


for (const formOwner of [false,true]) test(`intrinsic measurement preserves live named radios (form owner: ${formOwner})`,async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await settled(page);
  const state=await page.evaluate(formOwner=>{
    const host=document.createElement(formOwner?'form':'div'),content=document.createElement('div');
    host.id='motion-radio-owner';content.style.width='260px';
    content.innerHTML='<label><input type="radio" name="motion-measure-radio">First</label><label><input type="radio" name="motion-measure-radio">Second</label>';
    host.append(content);document.querySelector('#origo-lens').append(host);
    const radios=[...content.querySelectorAll('input')];
    if(formOwner) for(const radio of radios) radio.setAttribute('form',host.id);
    radios[0].checked=true;
    const before=radios.map(radio=>radio.checked),height=window.explorerMotion.intrinsicHeight(content);
    const result={before,after:radios.map(radio=>radio.checked),height,copies:document.querySelectorAll('[data-flow-measuring]').length};
    host.remove();return result;
  },formOwner);
  expect(state.before).toEqual([true,false]);expect(state.after).toEqual([true,false]);
  expect(state.height).toBeGreaterThan(0);expect(state.copies).toBe(0);
});
