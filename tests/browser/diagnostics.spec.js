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
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive() || document.getAnimations().some(a =>
    (a.playState === "running" || a.pending) && !a.effect?.target?.closest?.('#ol-help-tooltip,#ol-tip,[role="tooltip"]')))).toBe(false);
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
  const canvasBox = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * .5, canvasBox.y + canvasBox.height * .4);
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-subdivision", "waiting");
  // The real 500 ms help timer and its disclosure animation run while this
  // chart request is still held; they are independent of chart readiness.
  await page.locator("#ol-tab-query").hover();
  await expect(page.locator("#ol-help-tooltip")).toContainText("Query, view code and provenance");
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
  const fake = await fakeFor("standard"); await page.goto(fake.url + "/#w=24h&vis=2&r=6,1"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route: "/cube/columns", when:q => q.m === "0" }).gate();
  try {
    await page.locator("#ol-canvas").focus(); await page.keyboard.press("c");
    await gate.arrived(); await expect(page.locator("#ol-evidence")).toHaveAttribute("aria-busy", "true");
    // First history is committed and the seasonal history is already in flight
    // when the changed dependency identity re-enters settledEvidence().
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    gate.open(); await expect(page.locator("#ol-evidence")).toHaveAttribute("aria-busy", "false");
    await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
    const report = await exported(page), input = report.events.find(e => e.type === "input" && e.scope === "ol-evidence");
    expect(input).toBeTruthy();
    const complete = report.events.find(e => e.type === "presentation-proxy" && e.id === input.id);
    expect(complete).toBeTruthy();
    const phases = report.events.filter(e => e.type === "phase-end" && e.name === "continuations" && e.outcome === "completed");
    expect(phases.length).toBeGreaterThan(0); expect(complete.at).toBeGreaterThanOrEqual(phases.at(-1).at);
    expect(report.events.some(e => e.type === "history-already-dispatched")).toBe(true);
    for (const wait of report.events.filter(e => e.type === "phase-start" && e.name === "history.want-to-dispatch")) {
      expect(report.events.find(e => e.type === "phase-end" && e.id === wait.id)?.outcome).toBe("completed");
    }
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
    expect(report.events.some(e => e.type === "draw" && ["pending-data", "pending-refinement", "coarse-loaded"].includes(e.status))).toBe(true);
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
    await page.locator("#ol-import-toggle").click();
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
    // Bounds fields intentionally retain edits while their form has focus.
    // Move focus before using them as the address-application oracle.
    await page.locator("#ol-canvas").focus();
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
  const report = await exported(page), input = report.events.find(e => e.type === "input" && e.target === close && e.event === "click" &&
    report.events.some(ack => ack.type === "acknowledgment" && ack.id === e.id && ack.presentation?.open === false));
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
  await page.locator("#ol-bounds-start").fill("2026-03-28T00:00");
  await page.locator('#ol-bounds-form button[type="submit"]').click();
  await expect.poll(() => fake.log().some(e => e.path === "/cube/tile" && e.status === 503)).toBe(true);
  await expect(page.locator("#ol-loading")).toContainText("diagnostic tile failure"); await settledFrames(page);
  const report = await exported(page);
  expect(report.events.some(e => ["draw","readiness"].includes(e.type) && e.error?.some(message => message.includes("diagnostic tile failure")) && e.status === "terminal-fallback")).toBe(true);
});
test("recording controls have a reference Show route, help, names and native keyboard order", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"); await page.goto(fake.url + "/#w=24h&r=4,0"); await probe.waitForReady();
  await page.locator("#ol-reference-toggle").click(); await page.locator("#ol-reference-search").fill("Performance recording");
  await page.locator("#ol-reference-topic").selectOption("query");
  await page.getByRole("button",{ name:"Show performance recording",exact:true }).click();
  await expect(page.locator("#ol-diagnostics summary")).toBeVisible();
  await expect(page.locator("#ol-reference-status")).toContainText("Highlighted: performance recording");
  await expect.poll(() => page.locator("#ol-diagnostics-start").evaluate(node => {
    const box = node.getBoundingClientRect(), parent = document.querySelector("#ol-drawer-body").getBoundingClientRect();
    return box.top >= parent.top && box.bottom <= parent.bottom;
  })).toBe(true);
  await page.keyboard.press("Escape"); await page.locator("#ol-reference-close").click();
  await controls(page); await page.locator("#ol-diagnostics summary").focus();
  const ids = ["start","stop","export","reload"];
  for (const id of ids) { await page.keyboard.press("Tab"); await expect(page.locator("#ol-diagnostics-" + id)).toBeFocused(); }
  for (const [id, text] of [["start","Start local performance recording"],["stop","Stop collecting measurements"],["export","download the local timings"],["reload","Arm one recording"]]) {
    const control = page.locator("#ol-diagnostics-" + id); await expect(control).toHaveAccessibleName(/record/i);
    await control.hover(); await expect(page.locator("#ol-help-tooltip")).toContainText(text);
  }
  await page.locator("#ol-diagnostics-start").focus(); await page.keyboard.press("Enter"); await expect(page.locator("#ol-diagnostics-status")).toContainText("Recording");
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await expect(page.locator("#ol-diagnostics-status")).toContainText("Stopped");
  await exported(page); await expect(page.getByRole("textbox",{ name:"Performance recording JSON",exact:true })).toHaveAttribute("readonly", "");
});
test("the reported replay address cannot certify a coarse grid as completed target output", async ({ page, fakeFor }) => {
  await page.setViewportSize({ width:1500,height:950 });
  await page.addInitScript(() => sessionStorage.setItem("cube-performance-record-next-load","1"));
  const fake = await fakeFor("standard", { next:300 });
  await page.goto(fake.url + "/#t=2025-12-14T12:30Z~2025-12-20T12:30Z&p=22375~23750&r=4,0&vis=2&rc=1&replay=1&at=2025-12-15T11:30Z");
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-startup", "");
  await fake.idle({ quietMs:500 }); await settledFrames(page);
  // The existing coarse glyph is independent of the recorder. This assertion
  // remains valid if #195 later converges; no historical read sequence is pinned.
  const coarse = await page.locator("#ol-res").getAttribute("data-coarse") === "true";
  const report = await exported(page), draw = report.events.filter(e => e.type === "draw").at(-1);
  expect(draw.requested.n).toBe(4); expect(draw.requested.replay).toBe(true);
  if (coarse) expect(["pending-data","pending-refinement","coarse-loaded","stalled"]).toContain(draw.status);
  else { expect(draw.rendered.n).toBe(draw.target.n); expect(draw.rendered.m).toBe(draw.target.m); }
});
for (const replacement of ["range","pack token"]) test(`obsolete candle ${replacement} answer is never marked applied`, async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:bars", { next:3 });
  await page.goto(fake.url + "/#t=2021-01-01T00:00Z~2021-01-01T00:03:45Z&p=24800~25400&r=2,0"); await probe.waitForReady();
  await controls(page); await page.locator("#ol-diagnostics-start").click();
  const gate = fake.on({ route:"/cube/bars", when:q => q.n === "2",times:1 }).gate();
  try {
    await page.locator("#ol-canvas").focus(); await page.keyboard.press("k"); await gate.arrived();
    const old = fake.log().find(e => e.path === "/cube/bars" && e.query.n === "2"), oldToken = fake.info().packToken;
    if (replacement === "range") {
      await page.evaluate(() => { location.hash = "#t=2021-01-01T00:15Z~2021-01-01T00:18:45Z&p=24800~25400&r=2,0&mode=candles"; });
      await expect(page.locator("#ol-bounds-start")).toHaveValue("2021-01-01T00:15");
    } else {
      fake.advance({ minutes:2,trades:[{ t_ms:1250000,price:2625000,qty:400000,takerBuy:true }] });
      await expect.poll(() => fake.log().some(e => e.path === "/cube/pack" && ["delta","pack"].includes(e.answer)),{ timeout:10000 }).toBe(true);
    }
    gate.open(); await fake.idle({ quietMs:500 }); await settledFrames(page);
    const report = await exported(page), suffix = `|2|${old.query.b0}|${old.query.b1}|${oldToken}`;
    const discarded = report.events.find(e => e.type === "data-discarded" && e.key.startsWith("candles|") && e.key.endsWith(suffix));
    expect(discarded).toBeTruthy(); expect(report.events.some(e => e.type === "data-applied" && e.key === discarded.key)).toBe(false);
  } finally { gate.open(); }
});
