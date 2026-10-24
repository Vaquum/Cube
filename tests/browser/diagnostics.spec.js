"use strict";
const { test, expect } = require("./fixtures.js");
async function controls(page) {
  if (!await page.locator("#ol-panel-query").isVisible()) await page.locator("#ol-tab-query").click();
  const details = page.locator("#ol-diagnostics");
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
}
async function exported(page) {
  await controls(page);
  const downloading = page.waitForEvent("download");
  await page.locator("#ol-diagnostics-export").click();
  expect((await downloading).suggestedFilename()).toBe("cube-performance.json");
  return JSON.parse(await page.locator("#ol-diagnostics-output").inputValue());
}
test("side-panel controls export bounded reload, browser and application measurements", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await page.goto(fake.url + "/#w=24h&vis=2"); await probe.waitForReady();
  await controls(page);
  await Promise.all([page.waitForEvent("load"), page.locator("#ol-diagnostics-reload").click()]);
  await probe.waitForReady();
  await expect(page.locator("#ol-diagnostics-status")).toContainText("Recording");
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("]");
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/);
  const report = await exported(page);
  expect(report.schema).toBe("cube-performance@1"); expect(report.stopReason).toBe("export");
  expect(report.events.length).toBeLessThanOrEqual(report.limits.events);
  expect(report.identity.browser.supportedEntryTypes).toContain("resource");
  expect(report.events.some(e => e.type === "browser-timing" && e.entryType === "navigation")).toBe(true);
  expect(report.events.filter(e => e.type === "phase-start" && e.name === "startup.decode").map(e => e.identity.source).sort()).toEqual(["overview", "recent", "reference"]);
  expect(report.events.some(e => e.type === "draw" && e.status === "requested-output-submitted")).toBe(true);
  expect(report.definitions.unavailable).toContain("INP");
  // The reload opt-in is consumed once. A second reload starts no recorder.
  await page.reload(); await probe.waitForReady();
  await expect(page.locator("#ol-diagnostics-status")).toContainText("Stopped");
});
test("retained fine-grid requests stay pending until calibration arrives; unrelated tooltip is excluded", async ({ page, fakeFor, probe }) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, "explorerEncoding", { get: () => api, set: value => {
      api = { ...value, lifecycle: { ...value.lifecycle, coherent: (...args) => window.__holdDiagnosticsCalibration ? { ok: false, reason: "pending" } : value.lifecycle.coherent(...args) } };
    } });
  });
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&vis=2"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  await page.evaluate(() => { window.__holdDiagnosticsCalibration = true; });
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("]");
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-subdivision", "waiting");
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive()), { timeout: 3000 }).toBe(false);
  // Release through a real resize, which advances the draw revision without new input.
  await page.evaluate(() => { window.__holdDiagnosticsCalibration = false; });
  const viewport = page.viewportSize(); await page.setViewportSize({ ...viewport, width: viewport.width - 1 });
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/);
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
  await page.evaluate(() => {
    const tooltip = document.createElement("span"); tooltip.setAttribute("role", "tooltip"); tooltip.setAttribute("data-motion-running", "");
    document.querySelector("#ol-drawer-body").append(tooltip);
  });
  await controls(page);
  // Completion belongs to the drawer scope despite its unrelated tooltip marker.
  await expect.poll(async () => page.locator("#ol-drawer-body").getAttribute("data-motion-running")).toBe(null);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const report = await exported(page), draws = report.events.filter(e => e.type === "draw");
  expect(draws.some(e => e.status === "pending-refinement" && e.rendered.raster.kind === "retained-or-blended-preview")).toBe(true);
  expect(draws.filter(e => e.refinement).every(e => e.status !== "requested-output-submitted")).toBe(true);
  expect(draws.some(e => !e.refinement && e.status === "requested-output-submitted")).toBe(true);
  expect(report.events.some(e => e.type === "presentation-proxy" && e.scope === "ol-drawer-body")).toBe(true);
});
