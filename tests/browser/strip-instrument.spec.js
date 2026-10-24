"use strict";
// Forces as an instrument: explicit input/attention coverage, independent field cutoff, and the same structured readout in
// hover and Inspect. The response overrides below are SYNTHETIC UI states, not market history or model-performance evidence.
// Their independent oracle is a named set of available inputs, including measured zero, and an explicit publication cutoff.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const { T0, BASE_SECONDS } = require("../support/wire.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page);
  await use(paneCanvas.forPage(page));
} });
test.use({ reducedMotion: "reduce" });

const HOUR = 3600000, QUARTER = HOUR / 4, DAY = 24 * HOUR, LABELS = 12, BAND = 22, FOOT = 5;
const INPUTS = ["macro.DTWEXBGS", "macro.DGS2", "macro.DGS10", "macro.BAMLH0A0HYM2", "positioning.funding",
  "positioning.stablecoins", "positioning.basis", "positioning.skew", "news.tone", "social.words"];
const ATTENTION = ["attention.gdelt", "attention.wikipedia", "attention.wikipedia_hourly", "attention.bluesky"];
const FORCES = ["macro", "positioning", "news", "social"];
const iso = (ms) => new Date(ms).toISOString();
const canonical = async (card, field) => Number(await card.locator(`[data-field="${field}"]`).getAttribute("data-canonical"));
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((n) => n.dataset.layout.split(",").map(Number));
const gOf = (layout) => ({ x: layout[0], w: layout[2], by: layout[14], bh: layout[15] });
function rectangle(fake, extra = "") {
  const info = fake.info(), to = Math.floor(Date.parse(info.cutoff) / QUARTER) * QUARTER, from = to - 4 * HOUR,
    [p0, p1] = info.priceBand.usdt;
  return { from, to, cutoff: Date.parse(info.cutoff), hash: `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&vis=2&rc=1&strip=forces${extra}` };
}
async function open(page, fake, probe, hash) {
  await page.goto(`${fake.url}/${hash}`);
  await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "ready");
  await probe.waitForQuiet();
}
async function coverageResponse(page, { inputs, attention, cutoff, detail = true, sources = {}, events = [] }) {
  const available = new Set(INPUTS.slice(0, inputs)), attentionAvailable = new Set(ATTENTION.slice(0, attention));
  await page.route("**/cube/strip?*", async (route) => {
    const original = await route.fetch(), body = await original.json(), n = body.grid.attention.length;
    // Every available input is a measured zero, making it impossible to confuse sparse input support with a small net force.
    const parts = Object.fromEntries(INPUTS.map((name) => [name, new Array(n).fill(available.has(name) ? 0 : null)]));
    for (const name of ATTENTION) parts[name] = new Array(n).fill(attentionAvailable.has(name) ? 0.3 : null);
    body.grid.forces = Object.fromEntries(FORCES.map((force) => [force, Array.from({ length: n }, (_, i) => {
      const values = INPUTS.filter((name) => name.startsWith(force + ".")).map((name) => parts[name][i]).filter((v) => v !== null);
      return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
    })]));
    body.grid.attention = new Array(n).fill(attention ? 0.3 : null);
    if (detail === null) body.grid.parts = null;
    else if (detail) body.grid.parts = parts;
    else delete body.grid.parts;
    body.events = events; body.jumps = [];
    Object.assign(body.sources, sources);
    if (cutoff !== undefined) {
      body.cutoff = cutoff;
      body.snapshot.publishedAt = Math.min(body.snapshot.publishedAt, cutoff);
      if (Number.isFinite(body.snapshot.scheduledFor)) body.snapshot.scheduledFor = Math.min(body.snapshot.scheduledFor, cutoff);
    }
    await route.fulfill({ response: original, json: body });
  });
}
async function hoverBand(page, g, fraction = 0.5) {
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + g.x + fraction * g.w, box.y + g.by + LABELS + BAND / 2);
  const card = page.locator("#ol-tip");
  await expect(card).toHaveAttribute("data-presentation", "strip-forces");
  return card;
}

for (const state of [
  { inputs: 0, attention: 0, status: "none", caption: "No data · Inputs 0/10 · Attention 0/4" },
  { inputs: 1, attention: 1, status: "limited", caption: "Limited data · Inputs 1/10 · Attention 1/4" },
  { inputs: 5, attention: 0, status: "limited", caption: "Limited data · Inputs 5/10 · Attention 0/4" },
  { inputs: 10, attention: 0, status: "limited", caption: "Limited data · Inputs 10/10 · Attention 0/4" },
  { inputs: 10, attention: 4, status: "ready", caption: "Inputs 10/10 · Attention 4/4" },
]) test(`input coverage ${state.inputs}/10 and attention ${state.attention}/4 are visible without a hover`, async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake);
  await coverageResponse(page, state);
  await open(page, fake, probe, view.hash);
  const button = page.locator("#ol-strip");
  await expect(button).toHaveAttribute("data-coverage-state", state.status);
  await expect(button).toHaveAttribute("data-inputs-known", String(state.inputs));
  await expect(button).toHaveAttribute("data-inputs-total", "10");
  await expect(button).toHaveAttribute("data-attention-known", String(state.attention));
  await expect(button).toHaveAttribute("data-attention-total", "4");
  await expect(button).toHaveAttribute("data-coverage", state.caption);
  await expect(button).toHaveAccessibleDescription(new RegExp(state.caption));
  const g = gOf(await layoutOf(page)), top = g.by + LABELS, frame = await pane.last();
  expect(frame.texts.some((t) => t.text === state.caption), "the canvas names its coverage, without opening a card").toBe(true);
  const x = Math.floor(g.x + g.w / 2), covering = frame.rects.filter((r) => r.fill === "pattern" && r.x <= x && x < r.x + r.w);
  if (!state.inputs) {
    expect(covering.some((r) => r.y === top + 1 && r.h === BAND - 2), "no inputs is the full undefined hatch").toBe(true);
    expect(frame.texts.some((t) => t.text === "No data"), "a wide missing interval is named in the band").toBe(true);
  } else {
    const inputGap = FOOT * (1 - state.inputs / 10), attentionGap = FOOT * (1 - state.attention / 4);
    expect(covering.some((r) => r.y === top + 1 && Math.abs(r.h - inputGap) < 1e-6), "the upper hatch measures missing input share").toBe(inputGap > 0);
    expect(covering.some((r) => Math.abs(r.y - (top + BAND - 1 - attentionGap)) < 1e-6 && Math.abs(r.h - attentionGap) < 1e-6), "the lower hatch measures missing attention share").toBe(attentionGap > 0);
  }
  if (state.inputs === 10) {
    const card = await hoverBand(page, g);
    expect(await canonical(card, "net"), "measured zero remains a defined force value").toBe(0);
    expect(await canonical(card, "coverage")).toBe(10);
    expect(await canonical(card, "forceCoverage")).toBe(4);
    if (state.attention) expect(await canonical(card, "attention")).toBe(0.3);
    else await expect(card.locator('[data-field="attention"]')).toHaveAttribute("data-canonical", "unsupported");
    await expect(card.locator('[data-field="supportStatus"]')).toHaveAttribute("data-fact", state.attention < 4 ? "Partial" : "Known");
    await expect(card.locator(".ol-tip-note")).toHaveCount(0);
  }
});

for (const detail of [false, null]) test(`${detail === null ? "null" : "omitted"} component detail is explicit rather than invented as zero or partial support`, async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake);
  await coverageResponse(page, { inputs: 10, attention: 4, detail });
  await open(page, fake, probe, view.hash);
  const button = page.locator("#ol-strip");
  await expect(button).toHaveAttribute("data-coverage-state", "unknown");
  await expect(button).toHaveAttribute("data-inputs-known", "");
  await expect(button).toHaveAttribute("data-coverage", /Input detail unavailable · Forces 4\/4/);
  expect((await pane.last()).texts.some((t) => t.text.startsWith("Input detail unavailable"))).toBe(true);
  const card = await hoverBand(page, gOf(await layoutOf(page)));
  await expect(card.locator('[data-field="coverage"]')).toHaveAttribute("data-canonical", "unsupported");
  await expect(card.locator('[data-field="supportStatus"]')).toHaveAttribute("data-fact", "Detail unavailable");
  await expect(card.locator(".ol-tip-head .ol-strip-status")).toHaveText("Detail unavailable");
  expect(await canonical(card, "forceCoverage")).toBe(4);
  expect(await canonical(card, "net")).toBe(0);
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  const full = page.locator("#ol-inspect-readout");
  await expect(full.locator('[data-field="supportStatus"]')).toBeVisible();
  await expect(full.locator('[data-field="supportStatus"]')).toHaveAttribute("data-fact", "Detail unavailable");
  await expect(full.locator('[data-field="coverage"]')).toHaveAttribute("data-canonical", "unsupported");
  await expect(full.locator('[data-field="attentionCoverage"]')).toHaveAttribute("data-canonical", "unsupported");
  for (const name of [...INPUTS, ...ATTENTION]) {
    await expect(full.locator(`[data-field="${name}"]`)).toHaveAttribute("data-status", "Detail unavailable");
    await expect(full.locator(`[data-field="${name}"]`)).toHaveAttribute("data-canonical", "unsupported");
  }
});

test("a production source error object renders as named source facts alongside explicit support counts", async ({ page, fakeFor, probe }) => {
  // Unchanged gdelt_gkg source record from the real 2026-10-24 response (cutoff 1792830001043), captured during visual QA.
  // Only the surrounding grid is synthetic: this isolates the object-valued production metadata from market-value behavior.
  const source = { state: "stale", checkedAt: 1792829806123, receivedAt: 1792828301067, intervalSeconds: 300,
    observedAt: 1792828800000, recordedFrom: 1792750325926,
    detail: { code: "http_404", message: "HTTP 404 from data.gdeltproject.org", retry_after: null } };
  const fake = await fakeFor("mini", { cutoff: iso(1792830001043) }), view = rectangle(fake);
  await coverageResponse(page, { inputs: 10, attention: 4, sources: { gdelt_gkg: source } });
  await open(page, fake, probe, view.hash);
  const hover = await hoverBand(page, gOf(await layoutOf(page)));
  await expect(hover).not.toContainText("[object Object]");
  await expect(hover.locator(".ol-tip-note")).toHaveCount(0);
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  const card = page.locator("#ol-inspect-readout");
  expect(await canonical(card, "coverage")).toBe(10);
  expect(await canonical(card, "forceCoverage")).toBe(4);
  expect(await canonical(card, "attentionCoverage")).toBe(4);
  await expect(card.locator('[data-field="supportStatus"]')).toHaveAttribute("data-fact", "Known");
  await page.locator("#ol-inspect-strip-view").selectOption("sources");
  await expect(card).toHaveAttribute("data-presentation", "strip-sources");
  const status = card.locator('[data-field="source.gdelt_gkg"]'), code = card.locator('[data-field="source.gdelt_gkg.detail.code"]'),
    message = card.locator('[data-field="source.gdelt_gkg.detail.message"]');
  for (const fact of [status, code, message]) await expect(fact).toBeVisible();
  await expect(status).toHaveAttribute("data-fact", source.state);
  await expect(code).toHaveAttribute("data-fact", source.detail.code);
  await expect(code.locator("..").locator("dt")).toHaveText("Error code");
  await expect(message).toHaveAttribute("data-fact", source.detail.message);
  await expect(message.locator("..").locator("dt")).toHaveText("Provider response");
  expect(await canonical(card, "source.gdelt_gkg.observedAt")).toBe(source.observedAt);
  await expect(card.locator('[data-field="source.gdelt_gkg.detail.retry_after"]')).toHaveCount(0);
  await expect(card).not.toContainText(/\[object Object\]|Left pulls down|Bars: the moments|Descriptive, not a calibrated forecast|Then:|computed later from/);
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
});

test("a held view keeps its publication provenance after a newer history publication arrives", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake), viewCutoff = view.to - HOUR,
    publications = { view: { cutoff: viewCutoff, id: "1".repeat(64), model: "synthetic-held-view@1" },
      history: { cutoff: view.cutoff, id: "2".repeat(64), model: "synthetic-newer-history@2" } };
  await page.route("**/cube/strip?*", async (route) => {
    const original = await route.fetch(), body = await original.json(), q = new URL(route.request().url()).searchParams,
      history = Number(q.get("to")) - Number(q.get("from")) > 60 * DAY, publication = publications[history ? "history" : "view"];
    body.cutoff = publication.cutoff;
    body.snapshot = { ...body.snapshot, id: publication.id, publishedAt: publication.cutoff - 60000, scheduledFor: publication.cutoff - 60000 };
    body.model = publication.model;
    body.events = []; body.jumps = [];
    if (history) body.sources.gdelt_gkg = { ...body.sources.gdelt_gkg, state: "stale", observedAt: publication.cutoff - 2 * HOUR };
    await route.fulfill({ response: original, json: body });
  });
  await open(page, fake, probe, view.hash);
  await expect.poll(() => fake.log().filter((e) => e.path === "/cube/strip" && Number(e.query.to) - Number(e.query.from) > 60 * DAY && e.status === 200).length).toBeGreaterThan(0);
  await probe.waitForQuiet();
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  const mode = page.locator("#ol-inspect-strip-view"), card = page.locator("#ol-inspect-readout"),
    observation = async () => JSON.parse(await card.getAttribute("data-observation")), baseAt = (ms) => (ms / 1000 - T0) / BASE_SECONDS;
  // Sources is the explicit current-state view: this also proves the later history response has actually been applied.
  await mode.selectOption("sources");
  await expect.poll(async () => (await observation()).pack).toBe(publications.history.id);
  expect((await observation()).formula).toBe(publications.history.model);
  await mode.selectOption("forces");
  await expect(card).toHaveAttribute("data-presentation", "strip-forces");
  const held = await observation();
  expect(held.pack).toBe(publications.view.id);
  expect(held.formula).toBe(publications.view.model);
  expect(held.measuredThrough).toBe(baseAt(viewCutoff));
  expect(await canonical(card, "fieldCutoff")).toBe(viewCutoff);
  await expect(card.locator('[data-field="source.gdelt_gkg"]')).toHaveAttribute("data-fact", "stale");
  await card.locator(".ol-cell-details > summary").click();
  const provenance = card.locator(".ol-card-provenance");
  await expect(provenance).toBeVisible();
  const record = JSON.parse(await provenance.textContent());
  expect(record.pack).toBe(publications.view.id);
  expect(record.formula).toBe(publications.view.model);
  expect(record.measuredThrough).toBe(baseAt(viewCutoff));
});

test("real unavailable inputs stay concise and their Inspect labels and values fit the 312 px panel", async ({ page, fakeFor, probe }) => {
  const recorded = require("../fixtures/regressions/forces-calendar-mask/strip.json"), grid = recorded.grid,
    fake = await fakeFor("mini", { cutoff: iso(recorded.cutoff) }), view = rectangle(fake);
  await page.route("**/cube/strip?*", async (route) => {
    const q = new URL(route.request().url()).searchParams, from = Number(q.get("from")), to = Number(q.get("to")), step = Number(q.get("step")),
      read = (series) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => {
        const index = Math.floor((from + i * step - grid.t0) / grid.step);
        return index >= 0 && index < series.length ? series[index] : null;
      });
    await route.fulfill({ json: { ...recorded, grid: { t0: from, step,
      forces: Object.fromEntries(Object.entries(grid.forces).map(([name, values]) => [name, read(values)])),
      ...Object.fromEntries(["attention", "close", "next24h", "dvol"].map((name) => [name, read(grid[name])])),
      parts: Object.fromEntries(Object.entries(grid.parts).map(([name, values]) => [name, read(values)])),
    } } });
  });
  await open(page, fake, probe, view.hash);
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  const card = page.locator("#ol-inspect-readout");
  expect((await page.locator("#ol-side").boundingBox()).width).toBe(312);
  for (const name of ["positioning.basis", "positioning.skew", "news.tone"]) {
    const value = card.locator(`[data-field="${name}"]`);
    await expect(value).toBeVisible();
    await expect(value).toHaveAttribute("data-canonical", "unsupported");
    await expect(value).toHaveText("Unavailable");
  }
  await expect(card).not.toContainText("Not supported here");
  const fit = await card.locator(".ol-cell-group .ol-cell-stat").evaluateAll((rows) => rows.flatMap((row) => {
    const label = row.querySelector("dt"), value = row.querySelector("dd");
    if (!label || !value || !label.getClientRects().length || !value.getClientRects().length) return [];
    const a = label.getBoundingClientRect(), b = value.getBoundingClientRect(),
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5,
      overflow = label.scrollWidth > label.clientWidth + 1 || value.scrollWidth > value.clientWidth + 1;
    return overlap || overflow ? [{ field: value.dataset.field, overlap, overflow }] : [];
  }));
  expect(fit, "every visible Inspect label and value occupies its own box and fits inside it").toEqual([]);
});

for (const precision of ["day", "range", "instant"]) test(`${precision} event cards and Ahead preserve the schedule's actual precision`, async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake), dayStart = Math.floor(view.cutoff / DAY) * DAY + 3 * DAY,
    at = dayStart + (precision === "instant" ? 13.5 * HOUR : 0), end = precision === "instant" ? null : at + (precision === "range" ? 3 : 1) * DAY,
    event = { id: `synthetic-${precision}`, name: `Synthetic ${precision} event`, short: precision.toUpperCase(), series: `test-${precision}`,
      family: "macro", region: "US", window: precision === "instant" ? 60 : null, link: null, measured: null,
      schedule: [{ knownAt: view.cutoff - DAY, at, end, precision, status: "scheduled", certainty: "confirmed", importance: "high", weight: 1 }] };
  await page.route("**/cube/strip?*", async (route) => {
    const original = await route.fetch(), body = await original.json();
    body.events = [event]; body.jumps = [];
    await route.fulfill({ response: original, json: body });
  });
  await open(page, fake, probe, view.hash);
  const dateLabel = (ms, year = true) => {
    const date = new Date(ms), month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
    return `${date.getUTCDate()} ${month}${year ? " " + date.getUTCFullYear() : ""}`;
  }, expectedDate = precision === "instant" ? `${dateLabel(at, false)} 13:30` : precision === "day" ? dateLabel(at) : `${dateLabel(at)}–${dateLabel(end - 1)}`,
    expectedUnit = precision === "instant" ? "UTC" : precision === "day" ? "date only" : "date range";
  const checkSchedule = async (value) => {
    await expect(value).toBeVisible();
    await expect(value).toHaveAttribute("data-canonical", String(at));
    expect(await value.evaluate((n) => n.firstChild.textContent)).toBe(expectedDate);
    await expect(value.locator(".ol-reading-unit")).toHaveText(expectedUnit);
    if (precision !== "instant") await expect(value).not.toContainText(/\d{1,2}:\d{2}|UTC/);
  };
  const layout = await layoutOf(page), g = gOf(layout), box = await page.locator("#ol-canvas").boundingBox(),
    horizonX = layout[7] + 62 * Math.log1p((at - view.cutoff) / HOUR) / Math.log1p(90 * DAY / HOUR);
  await page.mouse.move(box.x + horizonX, box.y + g.by + LABELS + BAND / 2);
  const tip = page.locator("#ol-tip");
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await checkSchedule(tip.locator('[data-field="eventAt"]'));
  await expect(tip.locator('[data-field="eventPrecision"]')).toBeVisible();
  await expect(tip.locator('[data-field="eventPrecision"]')).toHaveAttribute("data-fact", precision);
  if (precision !== "instant") {
    const through = tip.locator('[data-field="eventEnd"]');
    await expect(through).toHaveAttribute("data-canonical", String(end));
    await expect(through).toContainText(dateLabel(end - 1));
    await expect(through).not.toContainText(/\d{1,2}:\d{2}|UTC/);
  }
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  await page.locator("#ol-inspect-strip-view").selectOption("ahead");
  const card = page.locator("#ol-inspect-readout");
  await expect(card).toHaveAttribute("data-presentation", "strip-ahead");
  await checkSchedule(card.locator(`[data-field="ahead.${event.id}.at"]`));
  await expect(card.locator(`[data-field="ahead.${event.id}.precision"]`)).toBeVisible();
  await expect(card.locator(`[data-field="ahead.${event.id}.precision"]`)).toHaveAttribute("data-fact", precision);
});

test("the field cutoff stops held values and identifies the missing tail separately from the cube cutoff", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake), fieldCutoff = view.to - HOUR;
  await coverageResponse(page, { inputs: 10, attention: 4, cutoff: fieldCutoff });
  await open(page, fake, probe, view.hash);
  const button = page.locator("#ol-strip");
  await expect(button).toHaveAttribute("data-cutoff", String(fieldCutoff));
  await expect(button).toHaveAttribute("data-effective-cutoff", String(fieldCutoff));
  const g = gOf(await layoutOf(page)), top = g.by + LABELS, fieldX = g.x + g.w * (fieldCutoff - view.from) / (view.to - view.from), frame = await pane.last();
  const colours = frame.rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.fill !== "pattern");
  expect(colours.length).toBeGreaterThan(100);
  expect(colours.every((r) => r.x < fieldX), "no held-value colour begins after the field cutoff").toBe(true);
  const tail = g.x + 0.9 * g.w;
  expect(frame.rects.some((r) => r.fill === "pattern" && r.y === top + 1 && r.h === BAND - 2 && r.x <= tail && tail < r.x + r.w)).toBe(true);
  expect(frame.texts.some((t) => t.text === "Field cutoff")).toBe(true);
  const card = await hoverBand(page, g, 0.9);
  expect(await canonical(card, "fieldCutoff")).toBe(fieldCutoff);
  await expect(card.locator('[data-field="net"]')).toHaveAttribute("data-canonical", "unsupported");
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
});

test("replay can end before the field cutoff without drawing later support", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake), fieldCutoff = view.to - HOUR, replayEdge = view.from + HOUR;
  await coverageResponse(page, { inputs: 10, attention: 4, cutoff: fieldCutoff });
  await open(page, fake, probe, `${view.hash}&mode=candles&replay=1&at=${iso(replayEdge)}`);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-cutoff", String(fieldCutoff));
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-effective-cutoff", String(replayEdge));
  const g = gOf(await layoutOf(page)), top = g.by + LABELS, edgeX = g.x + g.w / 4, frame = await pane.last();
  const colours = frame.rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.fill !== "pattern");
  expect(colours.length).toBeGreaterThan(20);
  expect(colours.every((r) => r.x < edgeX)).toBe(true);
  const card = await hoverBand(page, g);
  expect(await canonical(card, "effectiveEdge")).toBe(replayEdge);
  expect(await canonical(card, "inspectedAt")).toBeGreaterThan(replayEdge);
  await expect(card.locator('[data-field="net"]')).toHaveAttribute("data-canonical", "unsupported");
});

test("Inspect exposes source timing and the complete horizon without narrative or moving the selected time", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake);
  await open(page, fake, probe, view.hash);
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  const navigator = page.locator("#ol-inspect"), mode = page.locator("#ol-inspect-strip-view"), card = page.locator("#ol-inspect-readout"),
    position = () => navigator.evaluate((n) => ({ c: n.dataset.c, r: n.dataset.r, ts: n.dataset.ts })), initial = await position();
  await expect(mode).toBeVisible();
  await expect(mode).toHaveValue("forces");
  for (const field of ["fieldCutoff", "archiveFrom", "calendarArchiveFrom"]) await expect(card.locator(`[data-field="${field}"]`)).toBeVisible();
  await mode.selectOption("sources");
  await expect(card).toHaveAttribute("data-presentation", "strip-sources");
  for (const field of ["fieldCutoff", "source.wikimedia_hourly", "source.calendar.recordedFrom",
    "source.wikimedia_hourly.recordedFrom", "source.wikimedia_hourly.observedAt", "source.deribit_options.observedAt"]) {
    await expect(card.locator(`[data-field="${field}"]`), `source measurement ${field} is readable without opening hidden details`).toBeVisible();
  }
  await expect(card.locator('[data-field="source.wikimedia_hourly"]')).toContainText(/stale/i);
  expect(await canonical(card, "fieldCutoff")).toBe(view.cutoff);
  expect(await position()).toEqual(initial);
  await mode.selectOption("ahead");
  await expect(card).toHaveAttribute("data-presentation", "strip-ahead");
  for (const field of ["dvol", "optionsAt", "options.tomorrow_to_7d", "options.7_30d", "options.30_90d", "options.skew", "options.putCall", "range.1.p5", "range.7.p95", "range.30.p95"]) {
    await expect(card.locator(`[data-field="${field}"]`), `horizon measurement ${field} is readable without hidden details`).toBeVisible();
    expect(Number.isFinite(await canonical(card, field))).toBe(true);
  }
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
  expect(await position()).toEqual(initial);
  await mode.selectOption("forces");
  await expect(card).toHaveAttribute("data-presentation", "strip-forces");
  expect(await position()).toEqual(initial);
});

for (const force of ["forces", "forces.macro", "forces.social"]) test(`Ahead keeps the ${force} calendar when profiles fold at 590 px`, async ({ page, fakeFor, probe }) => {
  await page.setViewportSize({ width: 590, height: 950 });
  const fake = await fakeFor("mini"), view = rectangle(fake), edge = view.to - HOUR,
    event = (id, family, at, changes = {}) => ({ id, family, name: `Synthetic ${id}`, short: id, series: id, region: "US", window: 60, link: null, measured: null,
      schedule: [{ knownAt: edge - DAY, at, end: null, precision: "instant", status: "scheduled", certainty: "confirmed", importance: "high", weight: 1, ...changes }] }),
    calendar = [event("macro-next", "macro", edge + HOUR), event("social-next", "social", edge + DAY),
      event("macro-boundary", "macro", edge + 90 * DAY, { weight: 0.3 }),
      event("low-importance", "macro", edge + 2 * HOUR, { weight: 0.2, importance: "low" }),
      event("cancelled", "macro", null, { lastAt: edge + 3 * HOUR, status: "cancelled" }),
      event("not-known-yet", "macro", edge + 4 * HOUR, { knownAt: edge }),
      event("at-edge", "macro", edge), event("beyond-horizon", "macro", edge + 90 * DAY + 1), event("past", "macro", edge - HOUR)],
    // This explicit oracle excludes nonimportant, cancelled, not-yet-known, current/past and beyond-horizon entries.
    expected = (force === "forces.social" ? [["social-next", edge + DAY]] : force === "forces.macro"
      ? [["macro-next", edge + HOUR], ["macro-boundary", edge + 90 * DAY]]
      : [["macro-next", edge + HOUR], ["social-next", edge + DAY], ["macro-boundary", edge + 90 * DAY]]);
  await coverageResponse(page, { inputs: 10, attention: 4, cutoff: edge, events: calendar });
  await open(page, fake, probe, view.hash.replace("strip=forces", `strip=${force}`));
  expect((await layoutOf(page))[6], "profile tracks have not painted a horizon on the initial narrow page").toBe(0);
  await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-collapsed", "true");
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  await page.locator("#ol-inspect-strip-view").selectOption("ahead");
  const card = page.locator("#ol-inspect-readout"), check = async () => {
    await expect(card).toHaveAttribute("data-presentation", "strip-ahead");
    expect(await canonical(card, "aheadEvents")).toBe(expected.length);
    expect(await canonical(card, "horizonDays")).toBe(90);
    expect(await card.locator('[data-field^="ahead."][data-field$=".at"]').evaluateAll((values) => values.map((n) =>
      [n.dataset.field.slice("ahead.".length, -".at".length), Number(n.dataset.canonical)]))).toEqual(expected);
    for (const [id] of expected) await expect(card.locator(`[data-field="ahead.${id}.at"]`)).toBeVisible();
    await expect(card.locator(".ol-tip-note")).toHaveCount(0);
  };
  await check();
  await page.setViewportSize({ width: 1500, height: 950 });
  await expect.poll(async () => (await layoutOf(page))[6]).toBeGreaterThan(0);
  await probe.waitForQuiet();
  await check();
  await page.setViewportSize({ width: 590, height: 950 });
  await expect.poll(async () => (await layoutOf(page))[6]).toBe(0);
  await probe.waitForQuiet();
  await check();
});

test("the Strip instrument uses Inspect rows, supports its time keys, and turns off as an Inspect surface", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake);
  await coverageResponse(page, { inputs: 10, attention: 4 });
  await open(page, fake, probe, view.hash);
  await page.keyboard.press("e");
  const navigator = page.locator("#ol-inspect"), tab = page.locator('#ol-inspect-surfaces [data-surface="strip"]');
  await expect(tab).toBeEnabled();
  await tab.click();
  await expect(navigator).toHaveAttribute("data-surface", "strip");
  const card = page.locator("#ol-inspect-readout");
  await expect(card).toHaveAttribute("data-presentation", "strip-forces");
  await expect(card.locator(".ol-core-stats")).toHaveCount(1);
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
  await expect(card.locator('[data-field="net"]')).toHaveCount(1);
  expect(await canonical(card, "net")).toBe(0);
  for (const name of INPUTS) {
    await expect(card.locator(`.ol-cell-stat [data-field="${name}"]`)).toHaveCount(1);
    expect(await canonical(card, name)).toBe(0);
  }
  await expect(card.locator('[data-field="social.words"]')).toHaveAttribute("data-status", "Retrospective");
  await expect(card.locator('[data-field="source.wikimedia_hourly"]')).toContainText(/stale/i);
  await expect(card).not.toContainText(/Left pulls down|Bars: the moments|Descriptive, not a calibrated forecast|Then:|computed later from/);
  const position = () => navigator.evaluate((n) => ({ c: Number(n.dataset.c), r: Number(n.dataset.r), ts: Number(n.dataset.ts) }));
  const hash = () => page.evaluate(() => location.hash.replace(/&sc=[^&]*/, ""));
  const beforeHash = await hash();
  await navigator.focus();
  const a = await position();
  await page.keyboard.press("ArrowRight");
  const b = await position();
  expect(b.c).toBe(a.c + 1);
  expect(b.r).toBe(a.r);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  expect(await position()).toEqual(b);
  expect(await hash()).toBe(beforeHash);
  await page.keyboard.press("Home");
  const first = await position();
  await page.keyboard.press("End");
  const last = await position();
  expect(last.c).toBeGreaterThan(first.c);
  expect(last.r).toBe(first.r);
  expect(await hash()).toBe(beforeHash);
  // A pointer press on the strip chooses that surface too, rather than reporting a price cell.
  await page.locator('#ol-inspect-surfaces [data-surface="cells"]').click();
  const g = gOf(await layoutOf(page)), box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.click(box.x + g.x + g.w / 2, box.y + g.by + LABELS + BAND / 2);
  await expect(navigator).toHaveAttribute("data-surface", "strip");
  await page.locator("#ol-strip").click();
  await page.locator('#ol-strip-menu [data-strip="off"]').click();
  await expect(tab).toBeDisabled();
  await expect(navigator).toHaveAttribute("data-surface", "cells");
});
