"use strict";
const { test, expect } = require("./fixtures.js");
test.use({ viewport: { width: 390, height: 844 } });

for (const mode of ["motion", "reduced", "no-inert"]) for (const action of ["close-owned", "escape-owned", "close-outside", "escape-outside", "escape-unowned"]) {
  test(`phone ${action} preserves close layout and focus (${mode})`, async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("standard");
    if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    if (mode === "no-inert") await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args) => args[0] === "interactivity" && args[1] === "inert" ? false : supports(...args);
    });
    await page.goto(fake.url + "/#w=24h&vis=2"); await probe.waitForReady();
    await page.locator("#ol-sheet-toggle").click();
    await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
    // Dispatch and read in the same task: eventual focus after a closing
    // animation cannot satisfy this assertion. Trusted input is also exercised
    // by the build-pinned presentation cases.
    const observed = await page.evaluate(async action => {
      const toggle = document.querySelector("#ol-sheet-toggle"), close = document.querySelector("#ol-sheet-close"), canvas = document.querySelector("#ol-canvas");
      (action.endsWith("outside") ? canvas : close).focus({ preventScroll: true });
      if (action === "escape-unowned") document.activeElement.blur();
      const before = document.activeElement.id, scroll = [scrollX, scrollY], barHeight = document.querySelector('.ol-bar').getBoundingClientRect().height,
        sheetWidth = document.querySelector('#ol-controls').getBoundingClientRect().width;
      if (action.startsWith("escape")) document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      else close.click();
      const immediate = { before, sheet: document.querySelector("#origo-lens").dataset.sheet, expanded: toggle.getAttribute("aria-expanded"), focus: document.activeElement.id,
        scroll, afterScroll: [scrollX, scrollY] };
      // Let the panel observer start/finish its spring, still before another
      // frame can run. Slow CI cannot turn this into an eventual-focus check.
      await Promise.resolve();
      const sheet = document.querySelector("#ol-controls"), style = getComputedStyle(sheet);
      close.focus({ preventScroll: true }); // Inert/hidden closing content must refuse focus.
      return { immediate, afterObserver: { focus: document.activeElement.id, inertOrHidden: style.interactivity === "inert" || style.display === "none",
        running: sheet.hasAttribute("data-motion-running"), supportsInert: CSS.supports("interactivity", "inert"), position: style.position, direction: style.flexDirection,
        barHeight, closingBarHeight: document.querySelector('.ol-bar').getBoundingClientRect().height,
        sheetWidth, closingSheetWidth: sheet.getBoundingClientRect().width } };
    }, action);
    const { immediate, afterObserver } = observed;
    expect(immediate.before).toBe(action === "escape-unowned" ? "" : action.endsWith("outside") ? "ol-canvas" : "ol-sheet-close");
    expect(immediate.sheet).toBe("closed"); expect(immediate.expanded).toBe("false");
    expect(immediate.focus).toBe(action.endsWith("outside") ? "ol-canvas" : "ol-sheet-toggle");
    expect(immediate.afterScroll).toEqual(immediate.scroll);
    expect(afterObserver.focus).toBe(immediate.focus); expect(afterObserver.inertOrHidden).toBe(true);
    expect(afterObserver.running).toBe(mode === "motion" && afterObserver.supportsInert);
    expect(Math.abs(afterObserver.barHeight - afterObserver.closingBarHeight)).toBeLessThan(.5);
    if (afterObserver.running) {
      expect(afterObserver.position).toBe('fixed'); expect(afterObserver.direction).toBe('column');
      expect(Math.abs(afterObserver.sheetWidth - afterObserver.closingSheetWidth)).toBeLessThan(.5);
    }
    if (action === "close-owned" && mode === "motion") {
      await page.evaluate(() => { document.querySelector("#ol-sheet-toggle").click(); document.querySelector("#ol-res").focus({ preventScroll: true }); });
      await expect(page.locator("#ol-sheet-toggle")).toHaveAttribute("aria-expanded", "true");
      await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
      await expect(page.locator("#ol-res")).toBeFocused();
    }
  });
}
