"use strict";
const { test, expect } = require("./fixtures.js");
// Controlled clock/visibility events establish lifecycle ownership, not elapsed
// performance or real background throttling. Performance uses the separate
// native-clock, build-pinned presentation recordings.
async function open(page, fakeFor, probe, phone = true, hidden = false) {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1500, height: 950 });
  await page.clock.install({ time: Date.now() });
  if (hidden) await page.addInitScript(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => Boolean(window.__lifecycleHidden) }));
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h&vis=2"); await probe.waitForReady();
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
}
async function pause(page) { await page.clock.pauseAt(Date.now() + 1000); }
const state = () => {
  const sheet = document.querySelector("#ol-controls"), style = getComputedStyle(sheet);
  return { logical: document.querySelector("#origo-lens").dataset.sheet, expanded: document.querySelector("#ol-sheet-toggle").getAttribute("aria-expanded"),
    running: sheet.hasAttribute("data-motion-running"), retained: sheet.hasAttribute("data-flow-retained"), panelRetained: sheet.hasAttribute("data-flow-panel-retained"),
    opacity: sheet.style.opacity, transform: sheet.style.transform, translate: sheet.style.translate, displayOverride: sheet.style.getPropertyValue("--flow-display"),
    display: style.display, position: style.position, direction: style.flexDirection, focus: document.activeElement.id,
    barHeight: document.querySelector(".ol-bar").getBoundingClientRect().height };
};
function cleanClosed(value) {
  expect(value.logical).toBe("closed"); expect(value.expanded).toBe("false");
  expect(value.running).toBe(false); expect(value.retained).toBe(false); expect(value.panelRetained).toBe(false);
  for (const key of ["opacity", "transform", "translate", "displayOverride"]) expect(value[key]).toBe("");
  expect(value.display).toBe("none");
}
for (const event of ["hidden", "pagehide", "print", "resize"]) test(`phone close releases its retained layout on ${event}`, async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, true, event === "hidden");
  await page.locator("#ol-sheet-toggle").click();
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
  await pause(page);
  const before = await page.evaluate(async () => {
    document.querySelector("#ol-sheet-close").focus(); document.querySelector("#ol-sheet-close").click();
    await Promise.resolve();
    const sheet = document.querySelector("#ol-controls");
    return { running: sheet.hasAttribute("data-motion-running"), position: getComputedStyle(sheet).position,
      height: document.querySelector(".ol-bar").getBoundingClientRect().height };
  });
  expect(before.running).toBe(true); expect(before.position).toBe("fixed");
  await page.evaluate(event => {
    if (event === "hidden") { window.__lifecycleHidden = true; document.dispatchEvent(new Event("visibilitychange")); }
    else window.dispatchEvent(new Event(event === "print" ? "beforeprint" : event));
  }, event);
  const after = await page.evaluate(state); cleanClosed(after);
  expect(after.focus).toBe("ol-sheet-toggle"); expect(Math.abs(after.barHeight - before.height)).toBeLessThan(.5);
  await page.clock.runFor(1000); cleanClosed(await page.evaluate(state));
  if (event !== "pagehide") {
    await page.evaluate(event => {
      if (event === "hidden") { window.__lifecycleHidden = false; document.dispatchEvent(new Event("visibilitychange")); }
      if (event === "print") window.dispatchEvent(new Event("afterprint"));
      document.querySelector("#ol-sheet-toggle").click(); document.querySelector("#ol-res").focus();
    }, event);
    await page.clock.runFor(1000);
    await expect(page.locator("#ol-res")).toBeFocused();
    const reopened = await page.evaluate(state);
    expect(reopened.logical).toBe("open"); expect(reopened.position).toBe("fixed"); expect(reopened.running).toBe(false);
  }
});

test("a closing phone sheet releases its layout across the desktop breakpoint and back", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe); await page.locator("#ol-sheet-toggle").click();
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false); await pause(page);
  await page.evaluate(async () => { document.querySelector("#ol-sheet-close").focus(); document.querySelector("#ol-sheet-close").click(); await Promise.resolve(); });
  expect((await page.evaluate(state)).running).toBe(true);
  await page.setViewportSize({ width: 1200, height: 950 }); await page.clock.runFor(1000);
  const desktop = await page.evaluate(state);
  expect(desktop.logical).toBe("closed"); expect(desktop.display).not.toBe("none"); expect(desktop.position).not.toBe("fixed");
  expect(desktop.retained).toBe(false); expect(desktop.running).toBe(false); expect(desktop.transform).toBe("");
  await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(1000);
  cleanClosed(await page.evaluate(state));
  await page.evaluate(() => { document.querySelector("#ol-sheet-toggle").click(); document.querySelector("#ol-res").focus(); });
  await page.clock.runFor(1000); await expect(page.locator("#ol-res")).toBeFocused();
  expect((await page.evaluate(state)).position).toBe("fixed");
});

for (const kind of ["inspector", "drawer"]) test(`${kind} grip takes the presented dimensions during motion`, async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, false);
  const toggle = kind === "inspector" ? "#ol-side-toggle" : "#ol-tab-cells";
  if (await page.locator(toggle).getAttribute("aria-expanded") === "true") {
    await page.locator(toggle).click(); await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
  }
  await pause(page);
  // A real active mouse pointer allows native pointer capture. Dispatch the
  // takeover at the currently presented grip to avoid a locator waiting until
  // its motion has ended; this tests the actual grip handler, not hit-testing.
  await page.evaluate(() => document.addEventListener("pointerdown", event => { window.__lifecyclePointer = event.pointerId; }, { capture: true, once: true }));
  await page.mouse.move(5, 5); await page.mouse.down();
  try {
    await page.locator(toggle).evaluate(node => node.click()); await page.clock.runFor(400);
    const actual = await page.evaluate(kind => {
      const grip = document.querySelector(kind === "inspector" ? "#ol-side-grip" : "#ol-drawer-grip"),
        actor = kind === "inspector" ? document.querySelector("#ol-side") : document.querySelector(".ol-drawer-body"),
        owner = kind === "inspector" ? document.querySelector("#ol-main") : actor,
        channel = kind === "inspector" ? "grid" : "size", box = grip.getBoundingClientRect(),
        dimension = () => actor.getBoundingClientRect()[kind === "inspector" ? "width" : "height"],
        before = dimension(), moving = Boolean(window.explorerMotion.motionValue(owner, channel));
      grip.dispatchEvent(new PointerEvent("pointerdown", { pointerId: window.__lifecyclePointer, pointerType: "mouse", isPrimary: true,
        button: 0, buttons: 1, bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
      return { before, after: dimension(), moving, active: grip.dataset.active, captured: grip.hasPointerCapture(window.__lifecyclePointer),
        remaining: window.explorerMotion.motionValue(owner, channel), template: document.querySelector("#ol-main").style.gridTemplateColumns,
        height: document.querySelector(".ol-drawer-body").style.height };
    }, kind);
    expect(actual.moving).toBe(true); expect(actual.active).toBe("true"); expect(actual.captured).toBe(true);
    expect(Math.abs(actual.after - actual.before)).toBeLessThan(.6); expect(actual.remaining).toBeNull();
    expect(actual.template).toBe(""); expect(actual.height).toBe("");
  } finally { await page.mouse.up(); }
  await page.clock.runFor(1000);
  await expect(page.locator(kind === "inspector" ? "#ol-side-grip" : "#ol-drawer-grip")).toHaveAttribute("data-active", "false");
});

for (const event of ["hidden", "pagehide"]) test(`guided scrolling cancels at its presented position on ${event}`, async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, false, event === "hidden"); await pause(page);
  await page.evaluate(() => {
    const owner = document.createElement("div"), content = document.createElement("div");
    owner.id = "lifecycle-scroll"; owner.style.cssText = "position:fixed;left:4px;top:60px;width:100px;height:100px;overflow:auto";
    content.style.height = "2000px"; owner.append(content); document.querySelector("#origo-lens").append(owner);
    window.explorerMotion.scroll(owner, () => 800);
  });
  await page.clock.runFor(100);
  const actual = await page.evaluate(event => {
    const owner = document.querySelector("#lifecycle-scroll"), before = owner.scrollTop, moving = Boolean(window.explorerMotion.motionValue(owner, "scroll"));
    if (event === "hidden") { window.__lifecycleHidden = true; document.dispatchEvent(new Event("visibilitychange")); }
    else window.dispatchEvent(new Event("pagehide"));
    return { before, after: owner.scrollTop, moving, remaining: window.explorerMotion.motionValue(owner, "scroll") };
  }, event);
  expect(actual.moving).toBe(true); expect(actual.before).toBeGreaterThan(0); expect(actual.before).toBeLessThan(800);
  expect(Math.abs(actual.after - actual.before)).toBeLessThan(.6); expect(actual.remaining).toBeNull();
  await page.clock.runFor(1000);
  expect(Math.abs(await page.locator("#lifecycle-scroll").evaluate(node => node.scrollTop) - actual.before)).toBeLessThan(.6);
});
