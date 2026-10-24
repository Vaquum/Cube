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
async function settledFrames(page) {
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
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
  expect(report.schema).toBe("cube-performance@2"); expect(report.stopReason).toBe("export");
  expect(report.events.length).toBeLessThanOrEqual(report.limits.events);
  expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(report.limits.bytes);
  expect(report.identity.browser.supportedEntryTypes).toContain("resource");
  expect(report.events.some(e => e.type === "browser-timing" && e.entryType === "navigation")).toBe(true);
  expect(report.events.filter(e => e.type === "phase-start" && e.name === "startup.decode").map(e => e.identity.source).sort()).toEqual(["overview", "recent", "reference"]);
  expect(report.events.some(e => e.type === "draw" && e.status === "target-output-submitted")).toBe(true);
  const key = report.events.find(e => e.type === "input" && e.event === "keydown" && e.target === "ol-canvas");
  expect(report.events.find(e => e.type === "acknowledgment" && e.id === key.id).requested.n).toBe(requestedN);
  expect(report.definitions.unavailable).toContain("INP");
  const paint = report.events.find(e => e.type === "browser-timing" && e.entryType === "paint");
  expect(paint.fieldSupport).toHaveProperty("presentationTime");
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
  // The real 500 ms help timer and its disclosure animation run while this
  // chart request is still held; they are independent of chart readiness.
  await page.locator("#ol-diagnostics-export").hover();
  await expect(page.locator("#ol-help-tooltip")).toContainText("download the local timings");
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
  expect(draws.filter(e => e.refinement).every(e => e.status !== "target-output-submitted")).toBe(true);
  const retained = draws.filter(e => e.refinement).map(e => e.rendered.raster.retained).filter(e => e && typeof e === "object");
  expect(retained.every(e => e.n === null || e.n === 7)).toBe(true);
  expect(draws.some(e => !e.refinement && e.status === "target-output-submitted")).toBe(true);
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
  await expect.poll(() => fake.log().some(entry => entry.path === "/cube/motion")).toBe(true);
  await fake.idle({ quietMs: 500 });
  const report = await exported(page);
  for (const name of ["cube.body-json", "movement.body-json"]) {
    expect(report.events.some(e => e.type === "phase-end" && e.name === name && e.outcome === "failed"), name).toBe(true);
  }
});
test("Apply view owns its asynchronous commit and cannot finish before its held chart answer", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&r=9,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route:"/cube/tile" }).gate();
  try {
    await page.locator("#ol-import-text").fill(JSON.stringify({ tR:28800, pR:125, t1:"2026-03-28T00:00Z", t2:"2026-03-29T00:00Z", p1:24500, p2:25500 }));
    await page.locator("#ol-import-apply").click(); await gate.arrived();
    await expect(page.locator("#ol-bounds-start")).toHaveValue("2026-03-28T00:00");
    await settledFrames(page);
    const release = await page.evaluate(() => performance.now()); gate.open();
    await fake.idle({ quietMs:500 });
    await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/); await settledFrames(page);
    const report = await exported(page), input = report.events.find(e => e.type === "input" && e.target === "ol-import-apply" && e.event === "click");
    expect(input.scope).toBe("ol-canvas");
    expect(report.events.find(e => e.type === "action-start" && e.id === input.id)).toBeTruthy();
    const complete = report.events.find(e => e.type === "presentation-proxy" && e.id === input.id);
    expect(complete).toBeTruthy(); expect(complete.at).toBeGreaterThanOrEqual(release);
    expect(report.events.some(e => e.type === "interaction-data-ready" && e.id === input.id && e.at >= release)).toBe(true);
  } finally { gate.open(); }
});
test("external A to B to A address replacement cannot complete the earlier bounds interaction", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&r=9,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route:"/cube/tile" }).gate();
  try {
    await page.locator("#ol-bounds-start").fill("2026-03-28T00:00");
    await page.locator('#ol-bounds-form button[type="submit"]').click(); await gate.arrived();
    const original = new URL(page.url()).hash;
    await page.evaluate(() => { location.hash = "#w=7d&r=9,0"; });
    await expect(page.locator("#ol-bounds-start")).not.toHaveValue("2026-03-28T00:00");
    await page.evaluate(hash => { location.hash = hash; }, original);
    await expect(page.locator("#ol-bounds-start")).toHaveValue("2026-03-28T00:00"); await settledFrames(page);
    const report = await exported(page), input = report.events.find(e => e.type === "input" && e.event === "submit");
    expect(report.events.some(e => e.type === "interaction-superseded" && e.id === input.id && e.reason === "requested intent replaced")).toBe(true);
    expect(report.events.some(e => e.type === "presentation-proxy" && e.id === input.id)).toBe(false);
    const intents = new Set(report.events.filter(e => e.type === "request").map(e => e.requested.intent)); expect(intents.size).toBeGreaterThanOrEqual(3);
  } finally { gate.open(); }
});
test("held startup keeps Stop and Export reachable before any chart was decoded", async ({ page, fakeFor }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("cube-performance-record-next-load","1");
    const original = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function(...args) {
      const bytes = await original.apply(this,args);
      if (!window.__heldStartup) { window.__heldStartup = true; await new Promise(resolve => { window.__releaseStartup = resolve; }); }
      return bytes;
    };
  });
  const fake = await fakeFor("recorded"); await page.goto(fake.url + "/");
  try {
    await expect.poll(() => page.evaluate(() => Boolean(window.__heldStartup))).toBe(true);
    await controls(page); await expect(page.locator("#ol-diagnostics-stop")).toBeEnabled();
    await page.locator("#ol-diagnostics-stop").click(); const report = await exported(page);
    expect(report.stopReason).toBe("user"); expect(report.events.some(e => e.type === "draw")).toBe(false);
    expect(report.events.some(e => e.type === "phase-start" && e.name === "startup.decode")).toBe(true);
  } finally { await page.evaluate(() => window.__releaseStartup?.()); }
});
test("fatal armed startup exports a terminal state without a successful draw", async ({ page, fakeFor }) => {
  const fake = await fakeFor("recorded");
  await page.addInitScript(() => sessionStorage.setItem("cube-performance-record-next-load","1"));
  await page.route(fake.url + "/", async route => {
    const response = await route.fetch(), html = await response.text(), match = html.match(/(<script type="application\/json" id="origo-lens-data">)([\s\S]*?)(<\/script>)/);
    const pack = JSON.parse(match[2]); pack.blocks.recent.gzip_base64 = "AA=="; pack.page = "diagnostics-fatal-vector";
    await route.fulfill({ response, body:html.replace(match[0],match[1] + JSON.stringify(pack) + match[3]) });
  });
  await page.goto(fake.url + "/"); await expect(page.locator("#ol-loading")).toContainText("Recorded data unavailable");
  const report = await exported(page);
  expect(report.identity.page).toBe("diagnostics-fatal-vector");
  expect(report.events.some(e => e.type === "readiness" && e.status === "terminal-unavailable" && e.error.length)).toBe(true);
  expect(report.events.some(e => e.type === "draw")).toBe(false);
});
test("painted candle identity names actual bar ranges and keeps cell measurement separate", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:bars");
  await page.goto(fake.url + "/#t=2021-01-01T00:00Z~2021-01-01T00:20Z&p=24800~25400&r=2,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("k");
  await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state","ready"); await settledFrames(page);
  const report = await exported(page), draw = report.events.filter(e => e.type === "draw" && e.requested.mode === "candles" && e.status === "target-output-submitted").at(-1);
  expect(draw.rendered.source.kind).toBe("painted-candles"); expect(draw.rendered.source.paintedBars).toBe(4);
  expect(draw.rendered.source.ranges.reduce((n,r) => n + r.paintedBars,0)).toBe(4);
  expect(draw.rendered.source.ranges.every(r => r.n === 2 && r.token === draw.requested.pack)).toBe(true);
  expect(draw.rendered.m).toBe(null); expect(draw.rendered.cellMeasurement.source).toBeTruthy();
});
test("a candle answer rejected by its consumer is discarded rather than reported as applied", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:bars");
  await page.goto(fake.url + "/#w=24h&r=2,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route:"/cube/bars", when:q => q.n === "2" }).gate();
  try {
    await page.locator("#ol-canvas").focus(); await page.keyboard.press("k"); await gate.arrived();
    await page.keyboard.press("k"); await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
    gate.open(); await fake.idle({ quietMs:500 }); await settledFrames(page);
    const report = await exported(page), discarded = report.events.find(e => e.type === "data-discarded" && e.key.startsWith("candles|") && e.consumerAccepted === false);
    expect(discarded).toBeTruthy(); expect(report.events.some(e => e.type === "data-applied" && e.key === discarded.key)).toBe(false);
  } finally { gate.open(); }
});
for (const kind of ["drawer", "inspector", "reference", "keys", "phone-controls"]) test(`${kind} close completes in its own scope after the close handler`, async ({ page, fakeFor, probe }) => {
  if (kind === "phone-controls") await page.setViewportSize({ width:390,height:844 });
  const fake = await fakeFor("mini"); await page.goto(fake.url + "/#w=24h&r=4,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const close = kind === "drawer" ? "ol-tab-query" : kind === "inspector" ? "ol-side-toggle" : kind === "reference" ? "ol-reference-close" : kind === "keys" ? "ol-keys-close" : "ol-sheet-close";
  const scope = { drawer:"ol-drawer-body", inspector:"ol-side-body", reference:"ol-reference", keys:"ol-keys", "phone-controls":"ol-controls" }[kind];
  if (kind === "inspector" && await page.locator("#ol-side-toggle").getAttribute("aria-expanded") === "false") await page.locator("#ol-side-toggle").click();
  if (kind === "reference") await page.locator("#ol-reference-toggle").click();
  if (kind === "keys") await page.locator("#ol-help").click();
  if (kind === "phone-controls") await page.locator("#ol-sheet-toggle").click();
  await settledFrames(page); await page.locator("#" + close).click(); await settledFrames(page);
  const report = await exported(page), input = report.events.filter(e => e.type === "input" && e.target === close && e.event === "click").at(-1);
  expect(input.scope).toBe(scope);
  const acknowledgment = report.events.find(e => e.type === "acknowledgment" && e.id === input.id), complete = report.events.find(e => e.type === "presentation-proxy" && e.id === input.id);
  expect(acknowledgment.presentation.open).toBe(false); expect(complete.status).toBe("scope-closed"); expect(complete.at).toBeGreaterThanOrEqual(acknowledgment.at);
  expect(report.events.some(e => e.type === "interaction-unavailable" && e.id === input.id)).toBe(false);
});
test("tile failure remains terminal while calibration still owes refinement", async ({ page, fakeFor, probe, allowConsole }) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window,"explorerEncoding",{ get:() => api, set:value => {
      api = { ...value, lifecycle:{ ...value.lifecycle, coherent:(...args) => window.__holdDiagnosticsCalibration ? { ok:false,reason:"pending" } : value.lifecycle.coherent(...args) } };
    } });
  });
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&r=5,1"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  allowConsole(/Failed to load resource/); fake.on({ route:"/cube/tile" }).fail({ status:503,body:{ error:"diagnostic tile failure" } });
  await page.evaluate(() => { window.__holdDiagnosticsCalibration = true; });
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("[");
  await expect.poll(() => fake.log().some(e => e.path === "/cube/tile" && e.status === 503)).toBe(true);
  await expect(page.locator("#ol-loading")).toContainText("diagnostic tile failure"); await settledFrames(page);
  const report = await exported(page);
  expect(report.events.some(e => ["draw","readiness"].includes(e.type) && e.error?.some(message => message.includes("diagnostic tile failure")) && e.status === "terminal-fallback")).toBe(true);
});
