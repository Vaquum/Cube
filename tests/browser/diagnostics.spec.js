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
  // Recording deliberately samples rAF. The global-idle probe must not wait
  // for that observer loop; assert application readiness instead.
  await expect(page.locator("#ol-loading")).toBeHidden();
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-startup", "");
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
  await expect(page.locator("#ol-diagnostics-status")).toContainText("Recording");
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("]");
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/);
  const requestedN = Number((await page.locator("#ol-n").textContent()).replace("n ", ""));
  const report = await exported(page);
  expect(report.schema).toBe("cube-performance@1"); expect(report.stopReason).toBe("export");
  expect(report.events.length).toBeLessThanOrEqual(report.limits.events);
  expect(report.identity.browser.supportedEntryTypes).toContain("resource");
  expect(report.events.some(e => e.type === "browser-timing" && e.entryType === "navigation")).toBe(true);
  expect(report.events.filter(e => e.type === "phase-start" && e.name === "startup.decode").map(e => e.identity.source).sort()).toEqual(["overview", "recent", "reference"]);
  expect(report.events.some(e => e.type === "draw" && e.status === "requested-output-submitted")).toBe(true);
  const key = report.events.find(e => e.type === "input" && e.event === "keydown" && e.target === "ol-canvas");
  expect(report.events.find(e => e.type === "acknowledgment" && e.id === key.id).requested.n).toBe(requestedN);
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
  // A fixed price level prevents opening Query from auto-selecting/fitting the
  // destination grid before the calibration hold is installed.
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&vis=2&r=5,1"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("]");
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/);
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
  await exported(page);
  // Change the actual retained raster while stopped, then restart. A previous
  // session's n=6 identity must never label the now-current n=7 raster.
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("]"); await probe.waitForReady();
  await expect(page.locator("#ol-n")).toHaveText("n 7");
  // Start and retarget in one dispatch turn, before a fresh recorded frame
  // could conceal reuse of the preceding session's stale raster identity.
  await page.evaluate(() => {
    document.querySelector("#ol-diagnostics-start").click(); window.__holdDiagnosticsCalibration = true;
    const canvas = document.querySelector("#ol-canvas"); canvas.focus();
    for (const type of ["keydown", "keyup"]) canvas.dispatchEvent(new KeyboardEvent(type, { key: "]", code: "BracketRight", bubbles: true, cancelable: true }));
  });
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
  await page.locator("#ol-tab-query").click();
  await expect(page.locator("#ol-tab-query")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#ol-tab-query").click();
  await expect(page.locator("#ol-tab-query")).toHaveAttribute("aria-expanded", "true");
  await controls(page);
  // Completion belongs to the drawer scope despite its unrelated tooltip marker.
  await expect.poll(async () => page.locator("#ol-drawer-body").getAttribute("data-motion-running")).toBe(null);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const report = await exported(page), draws = report.events.filter(e => e.type === "draw");
  expect(draws.some(e => e.status === "pending-refinement" && e.rendered.raster.kind === "retained-or-blended-preview")).toBe(true);
  expect(draws.filter(e => e.refinement).every(e => e.status !== "requested-output-submitted")).toBe(true);
  const retained = draws.filter(e => e.refinement).map(e => e.rendered.raster.retained).filter(e => e && typeof e === "object");
  expect(retained.every(e => e.n === null || e.n === 7)).toBe(true);
  expect(draws.some(e => !e.refinement && e.status === "requested-output-submitted")).toBe(true);
  expect(report.events.some(e => e.type === "presentation-proxy" && e.scope === "ol-drawer-body")).toBe(true);
});
test("opening Continuations waits for its own history/computation rather than chart submission", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&vis=2&r=9,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route: "/cube/columns" }).gate();
  try {
    await page.locator("#ol-canvas").focus(); await page.keyboard.press("c");
    await gate.arrived(); await expect(page.locator("#ol-evidence")).toHaveAttribute("aria-busy", "true");
    gate.open(); await expect(page.locator("#ol-evidence")).toHaveAttribute("aria-busy", "false");
    await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
    const report = await exported(page), input = report.events.find(e => e.type === "input" && e.scope === "ol-evidence");
    expect(input).toBeTruthy();
    const complete = report.events.find(e => e.type === "presentation-proxy" && e.id === input.id);
    expect(complete).toBeTruthy();
    const phases = report.events.filter(e => e.type === "phase-end" && e.name === "continuations" && e.outcome === "completed");
    expect(phases.length).toBeGreaterThan(0); expect(complete.at).toBeGreaterThanOrEqual(phases.at(-1).at);
  } finally { gate.open(); }
});
test("applying Query bounds waits for requested chart data instead of quiet panel frames", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&vis=2&r=9,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route: "/cube/tile" }).gate();
  try {
    await page.locator("#ol-bounds-start").fill("2026-03-28T00:00");
    await page.locator('#ol-bounds-form button[type="submit"]').click(); await gate.arrived();
    await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
    const report = await exported(page), input = report.events.find(e => e.type === "input" && e.event === "submit");
    expect(input.scope).toBe("ol-canvas");
    expect(report.events.some(e => e.type === "presentation-proxy" && e.id === input.id)).toBe(false);
    expect(report.unfinishedInteractions).toContain(input.id);
    expect(report.events.some(e => e.type === "draw" && ["pending-data", "pending-refinement"].includes(e.status))).toBe(true);
  } finally { gate.open(); }
});
test("malformed cube and movement JSON are failed body phases", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&vis=2&r=9,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  fake.on({ route: "/cube/columns" }).malformed("json");
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("c");
  await expect(page.locator("#ol-evidence")).toContainText("History unavailable");
  fake.on({ route: "/cube/motion" }).malformed("json");
  await page.locator("#ol-mode").click(); await page.locator('[data-mode="path"]').click();
  await fake.idle({ quietMs: 500 });
  const report = await exported(page);
  for (const name of ["cube.body-json", "movement.body-json"]) {
    expect(report.events.some(e => e.type === "phase-end" && e.name === name && e.outcome === "failed")).toBe(true);
  }
});
