"use strict";
// The quantitative second half is visible, and the hover instrument keeps its geometry while its data changes.
// SYNTHETIC UI states only: the constant forces, invented outcomes and event below are layout inputs, not market evidence.
const { test, expect } = require("./fixtures.js");
test.use({ reducedMotion: "reduce" });

const HOUR = 3600000, DAY = 24 * HOUR, QUARTER = HOUR / 4, LABELS = 12, BAND = 22;
const FORCES = ["macro", "positioning", "news", "social"];
const INPUTS = ["macro.DTWEXBGS", "macro.DGS2", "macro.DGS10", "macro.BAMLH0A0HYM2", "positioning.funding",
  "positioning.stablecoins", "positioning.basis", "positioning.skew", "news.tone", "social.words"];
const ATTENTION = ["attention.gdelt", "attention.wikipedia", "attention.wikipedia_hourly", "attention.bluesky"];
const SLOTS = ["header", "summary", "forces", "track", "event"];
const TRACK_FIELDS = ["trackOutcomeShare", "trackOutcomeBaseShare", "trackNear", "trackDays", "trackAll",
  "trackP5", "trackP50", "trackP95", "trackAllP5", "trackAllP50", "trackAllP95"];
const iso = (ms) => new Date(ms).toISOString();
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((n) => n.dataset.layout.split(",").map(Number));

function rectangle(fake) {
  const info = fake.info(), to = Math.floor(Date.parse(info.cutoff) / HOUR) * HOUR, from = to - 4 * HOUR,
    [p0, p1] = info.priceBand.usdt;
  return { from, to, cutoff: Date.parse(info.cutoff),
    hash: `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&vis=2&rc=1&strip=forces` };
}

async function syntheticStates(page, view, outcomes = null) {
  let entered = false, first = true, release;
  const pending = new Promise((resolve) => { release = resolve; });
  const eventAt = view.from + 0.875 * (view.to - view.from), event = {
    id: "synthetic-hover-layout-event", kind: "inflation", family: "macro", name: "Synthetic layout event", short: "Layout",
    region: "Synthetic", origin: "source", series: "layout-only", link: "https://example.org/layout-only", window: 15,
    schedule: [{ knownAt: view.from - DAY, at: eventAt, precision: "instant", end: null, status: "scheduled",
      certainty: "confirmed", importance: "medium", weight: 0.35 }],
    measured: { from: eventAt, at: eventAt + QUARTER, move: 0.1, ordinary: 0.2, bits: 0.4, series: "layout-only" },
  };
  await page.route("**/cube/strip?*", async (route) => {
    if (first) { first = false; entered = true; await pending; }
    const original = await route.fetch(), body = await original.json(), { t0, step } = body.grid, n = body.grid.attention.length;
    const state = (i) => {
      const fraction = (t0 + i * step - view.from) / (view.to - view.from);
      return fraction >= 0.65 && fraction < 0.8 ? "missing" : fraction >= 0.45 && fraction < 0.6 ? "sparse" : "supported";
    };
    const part = (name, i) => state(i) === "missing" ? null : state(i) === "sparse" ? name === INPUTS[0] ? 0.95 : null
      : name.startsWith("macro.") ? 0.025 : name.startsWith("positioning.") ? -0.0125 : name === "news.tone" ? 0.02 : 0.03;
    body.grid.parts = Object.fromEntries(INPUTS.map((name) => [name, Array.from({ length: n }, (_, i) => part(name, i))]));
    for (const component of Object.values(body.components)) component.retroUntil = view.from - DAY;
    body.components[INPUTS[0]].retroUntil = view.from + HOUR;
    for (const name of ATTENTION) body.grid.parts[name] = Array.from({ length: n }, (_, i) => state(i) === "missing" ? null : 0.3);
    body.grid.forces = Object.fromEntries(FORCES.map((force) => [force, Array.from({ length: n }, (_, i) => {
      const known = INPUTS.filter((name) => name.startsWith(`${force}.`)).map((name) => part(name, i)).filter((v) => v !== null);
      return known.length ? known.reduce((sum, v) => sum + v, 0) : null;
    })]));
    body.grid.attention = Array.from({ length: n }, (_, i) => state(i) === "missing" ? null : 0.3);
    // Thirty-seven hours avoids aliasing the six-hour sample gap and provides nonempty negative and positive bins.
    body.grid.next24h = Array.from({ length: n }, (_, i) => outcomes ? outcomes[Math.floor(i / 6) % outcomes.length] : ((i % 37) - 18) / 10);
    body.events = [event]; body.jumps = []; body.moves = { "layout-only": [[event.measured.at, 0.1]] };
    body.model = "synthetic-hover-layout-only@1";
    await route.fulfill({ response: original, json: body });
  });
  return { entered: () => entered, release, event };
}

async function hover(page, fraction, presentation, bandY = BAND / 2) {
  const g = await layoutOf(page), box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + g[0] + fraction * g[2], box.y + g[14] + LABELS + bandY);
  const card = page.locator("#ol-tip");
  await expect(card).toHaveAttribute("data-presentation", presentation);
  await expect(card).toBeVisible();
  return card;
}

async function geometry(card) {
  for (const slot of SLOTS) await expect(card.locator(`[data-strip-slot="${slot}"]`)).toHaveCount(1);
  return card.evaluate((node, { slots, trackFields }) => {
    const b = node.getBoundingClientRect(), relative = (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height };
    };
    return { x: b.x, y: b.y, width: b.width, height: b.height,
      slots: Object.fromEntries(slots.map((slot) => [slot, relative(node.querySelector(`[data-strip-slot="${slot}"]`))])),
      distribution: relative(node.querySelector(".ol-strip-distribution")),
      trackFields: Object.fromEntries(trackFields.map((field) => [field, relative(node.querySelector(`[data-strip-slot="track"] [data-field="${field}"]`))])),
      fields: Object.fromEntries(["net", "attention", "coverage"].flatMap((field) => {
        const n = node.querySelector(`[data-field="${field}"]`);
        return n ? [[field, relative(n)]] : [];
      })) };
  }, { slots: SLOTS, trackFields: TRACK_FIELDS });
}

function stable(reference, actual, name) {
  for (const key of ["y", "width", "height"]) expect(actual[key], `${name}: panel ${key}`).toBeCloseTo(reference[key], 1);
  for (const slot of SLOTS) {
    expect(actual.slots[slot].width, `${name}: ${slot} reserves width`).toBeGreaterThan(0);
    expect(actual.slots[slot].height, `${name}: ${slot} reserves height`).toBeGreaterThan(0);
    for (const key of ["x", "y", "width", "height"])
      expect(actual.slots[slot][key], `${name}: ${slot} ${key}`).toBeCloseTo(reference.slots[slot][key], 1);
  }
  for (const key of ["x", "y", "width", "height"])
    expect(actual.distribution[key], `${name}: distribution ${key}`).toBeCloseTo(reference.distribution[key], 1);
  for (const field of TRACK_FIELDS) for (const key of ["x", "y"])
    expect(actual.trackFields[field][key], `${name}: ${field} ${key}`).toBeCloseTo(reference.trackFields[field][key], 1);
}

async function contained(card) {
  const failures = await card.evaluate((node) => {
    const panel = node.getBoundingClientRect(), errors = [], tolerance = 0.75;
    const within = (r, b) => r.left >= b.left - tolerance && r.top >= b.top - tolerance
      && r.right <= b.right + tolerance && r.bottom <= b.bottom + tolerance;
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const nodes = node.querySelectorAll('[data-strip-slot="summary"] dd, [data-strip-slot="track"] dd, [data-strip-slot="event"] dd, .ol-strip-distribution, .ol-strip-hist, .ol-strip-hist > *');
    for (const element of nodes) {
      const r = element.getBoundingClientRect(), name = element.dataset.field || `${element.tagName}:${element.textContent}`;
      if (!within(r, panel) || !within(r, viewport)) errors.push(`${name}: outside panel or viewport`);
      if (element.tagName === "DD" && element.scrollWidth > element.clientWidth + 1) errors.push(`${name}: text is ellipsized`);
      for (let ancestor = element.parentElement; ancestor && node.contains(ancestor); ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), clipX = /hidden|clip|auto|scroll/.test(style.overflowX), clipY = /hidden|clip|auto|scroll/.test(style.overflowY), b = ancestor.getBoundingClientRect();
        if (clipX && (r.left < b.left - tolerance || r.right > b.right + tolerance)
          || clipY && (r.top < b.top - tolerance || r.bottom > b.bottom + tolerance)) {
          errors.push(`${name}: clipped by ${ancestor.dataset.stripSlot || ancestor.className}`); break;
        }
      }
    }
    return errors;
  });
  expect(failures, "quantitative values, markers and plot fit their panel, viewport and clipping ancestors").toEqual([]);
}

async function quantitativeTrack(card) {
  const track = card.locator('[data-strip-slot="track"]'), hist = track.locator(".ol-strip-hist");
  await expect(track).toBeVisible();
  await expect(hist).toBeVisible();
  expect(await hist.locator("rect").count(), "conditional distribution has visible bars").toBeGreaterThan(1);
  await expect(hist.locator('path[fill="none"]')).toBeVisible();
  for (const name of ["p5", "p50", "p95"]) await expect(hist.locator("text").filter({ hasText: new RegExp(`^${name}$`) })).toBeVisible();
  for (const field of TRACK_FIELDS) {
    const value = track.locator(`[data-field="${field}"]`);
    await expect(value, `${field} is readable in compact hover`).toBeVisible();
    expect(Number.isFinite(Number(await value.getAttribute("data-canonical"))), `${field} has a real measurement`).toBe(true);
    if (/track(?:All)?P\d/.test(field)) await expect(value).toHaveText(/^[+−]?\d+\.\d%$/);
  }
  expect(Number(await track.locator('[data-field="trackNear"]').getAttribute("data-canonical"))).toBe(40);
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
  for (const field of INPUTS) await expect(card.locator(`[data-field="${field}"]`), "detailed inputs belong in Inspect").toBeHidden();
  await expect(card).not.toContainText(/Bars: the moments|Descriptive, not a calibrated forecast|Then:|computed later from/);
  await contained(card);
}

for (const height of [500, 700, 701, 720, 839, 840, 841, 950]) test(`the complete distribution and fixed hover slots survive ${height}px viewport height`, async ({ page, fakeFor, probe }) => {
  await page.setViewportSize({ width: 1500, height });
  const fake = await fakeFor("mini"), view = rectangle(fake), states = await syntheticStates(page, view);
  await page.goto(`${fake.url}/${view.hash}`);
  await expect.poll(states.entered).toBe(true);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "loading");
  await expect.poll(async () => (await layoutOf(page))[15]).toBe(LABELS + BAND);
  const loading = await hover(page, 0.18, "strip-sources"), initial = await geometry(loading).finally(states.release);
  expect(initial.y, "the hover begins inside the viewport").toBeGreaterThanOrEqual(0);
  expect(initial.y + initial.height, "the complete hover fits the viewport").toBeLessThanOrEqual(height);
  const headerLayer = await loading.evaluate((node) => {
    const header = node.querySelector('[data-strip-slot="header"]').getBoundingClientRect(), bar = document.querySelector('.ol-bar'), style = getComputedStyle(node);
    return { overlaps: header.top < bar.getBoundingClientRect().bottom, card: Number(style.zIndex), bar: Number(getComputedStyle(bar).zIndex) };
  });
  if (headerLayer.overlaps) expect(headerLayer.card, "the complete title is painted above the toolbar on short viewports").toBeGreaterThan(headerLayer.bar);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "ready");
  await expect.poll(() => fake.log().filter((e) => e.path === "/cube/strip" && Number(e.query.to) - Number(e.query.from) > 60 * DAY && e.status === 200).length).toBeGreaterThan(0);
  await probe.waitForQuiet();

  // A response must update the stationary hover. Moving the pointer first would conceal a stale readout.
  let card = page.locator("#ol-tip");
  await expect(card).toHaveAttribute("data-presentation", "strip-forces");
  await quantitativeTrack(card);
  const supported = await geometry(card);
  await expect(card.locator('.ol-strip-tug [data-force="macro"][data-status="retrospective"]')).toBeVisible();
  stable(initial, supported, "loaded supported history");
  const grid = await layoutOf(page), canvas = await page.locator("#ol-canvas").boundingBox();
  expect(canvas.y + grid[14] + LABELS - supported.y - supported.height, "the card bottom sits eight pixels above the band").toBeCloseTo(8, 1);
  for (const bandY of [1, BAND - 1]) {
    card = await hover(page, 0.18, "strip-forces", bandY);
    stable(supported, await geometry(card), `pointer height ${bandY} inside the band`);
  }
  card = await hover(page, 0.32, "strip-forces");
  await quantitativeTrack(card);
  const moved = await geometry(card);
  await expect(card.locator('.ol-strip-tug [data-force="macro"][data-status="retrospective"]')).toHaveCount(0);
  stable(supported, moved, "supported history at another cursor position");
  expect(moved.x - supported.x, "the panel follows a rightward cursor movement to the right").toBeGreaterThan(10);
  for (const field of ["net", "attention", "coverage"]) for (const key of ["x", "y", "width", "height"])
    expect(moved.fields[field][key], `${field} ${key} stays in its instrument position`).toBeCloseTo(supported.fields[field][key], 1);

  let previousLeft = moved.x;
  for (const [name, fraction] of [["sparse history", 0.5], ["missing inputs", 0.7]]) {
    card = await hover(page, fraction, "strip-forces");
    await expect(card.locator('.ol-strip-distribution[data-state="unavailable"]')).toBeVisible();
    await expect(card.locator('.ol-strip-distribution[data-state="unavailable"]')).toContainText(/Insufficient history|Unavailable/);
    await expect(card.locator(".ol-strip-hist")).toHaveCount(0);
    const actual = await geometry(card);
    expect(actual.x, "a continuing rightward sweep never sends the panel backwards").toBeGreaterThanOrEqual(previousLeft);
    previousLeft = actual.x;
    stable(supported, actual, name);
    for (const field of ["net", "attention", "coverage"]) for (const key of ["x", "y", "width", "height"])
      expect(actual.fields[field][key], `${name}: ${field} ${key}`).toBeCloseTo(supported.fields[field][key], 1);
    await expect(card.locator(".ol-tip-note")).toHaveCount(0);
    await contained(card);
  }

  const layout = await layoutOf(page), box = await page.locator("#ol-canvas").boundingBox(), y = box.y + layout[14] + LABELS + BAND / 2;
  await page.mouse.move(box.x + layout[0] - 20, y);
  await expect(card).toHaveAttribute("data-presentation", "strip-sources");
  stable(supported, await geometry(card), "source measurements");
  expect(await card.locator('[data-strip-slot="event"]').evaluate((n) => n.scrollHeight <= n.clientHeight + 1), "source hover has no unreachable rows").toBe(true);
  await contained(card);
  await page.mouse.move(box.x + layout[7] + 31, y);
  await expect(card).toHaveAttribute("data-presentation", "strip-ahead");
  stable(supported, await geometry(card), "Ahead measurements");
  expect(await card.locator('[data-strip-slot="event"]').evaluate((n) => n.scrollHeight <= n.clientHeight + 1), "Ahead hover has no unreachable rows").toBe(true);
  await contained(card);

  card = await hover(page, 0.875, "strip-event");
  await expect(card).toContainText(states.event.name);
  await expect(card.locator('[data-field="eventMove"]')).toBeVisible();
  stable(supported, await geometry(card), "measured event");
  expect(await card.locator('[data-strip-slot="event"]').evaluate((n) => n.scrollHeight <= n.clientHeight + 1), "event hover has no unreachable rows").toBe(true);
  await contained(card);
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
});

test("a failed first publication keeps the loading hover's fixed shell", async ({ page, fakeFor, allowConsole }) => {
  await page.setViewportSize({ width: 1500, height: 840 });
  const fake = await fakeFor("mini"), view = rectangle(fake), gate = fake.on({ route: "/cube/strip" }).gate();
  allowConsole(/Failed to load resource: the server responded with a status of 502/);
  await page.goto(`${fake.url}/${view.hash}`);
  await gate.arrived();
  await expect.poll(async () => (await layoutOf(page))[15]).toBe(LABELS + BAND);
  const card = await hover(page, 0.18, "strip-sources"), initial = await geometry(card);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "loading");
  gate.fail(502, { error: "strip_upstream_failed", detail: "Synthetic layout failure" });
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "failed");
  // No pointer movement: the failed response itself must refresh the values and preserve the loading geometry.
  await expect(card.locator('[data-field="stripStatus"]')).toHaveAttribute("data-fact", "failed");
  stable(initial, await geometry(card), "failed first publication");
  await contained(card);
  await expect(card.locator(".ol-tip-note")).toHaveCount(0);
});

for (const sample of [
  { name: "all flat", outcomes: [0], label: "Flat in", share: 1 },
  { name: "half flat and half rising", outcomes: [0, 0, 0.1, 0.1], label: "Rose in", share: 0.5 },
]) test(`${sample.name}: flat returns never count as rises in either comparison`, async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake), states = await syntheticStates(page, view, sample.outcomes);
  states.release();
  await page.goto(`${fake.url}/${view.hash}`);
  await probe.waitForReady();
  await expect.poll(() => fake.log().filter((e) => e.path === "/cube/strip" && Number(e.query.to) - Number(e.query.from) > 60 * DAY && e.status === 200).length).toBeGreaterThan(0);
  await probe.waitForQuiet();
  const card = await hover(page, 0.18, "strip-forces"), outcome = card.locator('[data-field="trackOutcomeShare"]'), baseline = card.locator('[data-field="trackOutcomeBaseShare"]');
  await expect(outcome.locator("..").locator("dt")).toHaveText(sample.label);
  expect(Number(await outcome.getAttribute("data-canonical"))).toBe(sample.share);
  expect(Number(await baseline.getAttribute("data-canonical"))).toBeCloseTo(sample.share, 2);
  await expect(card.locator('[data-strip-slot="track"] .ol-strip-hist')).toBeVisible();
});

for (const context of [
  { mode: "forces", kind: "strip-event", fraction: 0.875, field: "eventRegion" },
  { mode: "sources", kind: "strip-sources", field: "source.fred_macro_daily.checkedAt" },
  { mode: "ahead", kind: "strip-ahead", field: "range.30.p95" },
]) test(`${context.kind}: bounded hover context retains complete measurements in Inspect`, async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = rectangle(fake), states = await syntheticStates(page, view);
  states.release();
  await page.goto(`${fake.url}/${view.hash}`);
  await probe.waitForReady();
  await expect.poll(() => fake.log().filter((e) => e.path === "/cube/strip" && Number(e.query.to) - Number(e.query.from) > 60 * DAY && e.status === 200).length).toBeGreaterThan(0);
  await probe.waitForQuiet();
  if (context.fraction) await hover(page, context.fraction, context.kind);
  else {
    const g = await layoutOf(page), box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + (context.mode === "sources" ? g[0] - 20 : g[7] + 31), box.y + g[14] + LABELS + BAND / 2);
  }
  const compact = page.locator('#ol-tip [data-strip-slot="event"]');
  expect(await compact.locator(".ol-cell-stat").count()).toBeLessThanOrEqual(4);
  expect(await compact.evaluate((n) => n.scrollHeight <= n.clientHeight + 1)).toBe(true);
  await page.keyboard.press("e");
  await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
  await page.locator("#ol-inspect-strip-view").selectOption(context.mode);
  const detail = page.locator("#ol-inspect-readout");
  await expect(detail).toHaveAttribute("data-presentation", context.kind);
  const extra = detail.locator(`[data-field="${context.field}"]`);
  await expect(extra).toBeVisible();
  // Inspect can replace a readout during its reveal. Scroll its stable container with the real pointer, rather than
  // retaining an individual row handle through that replacement.
  const position = await page.locator("#ol-inspect").evaluate((node, field) => {
    const b = node.getBoundingClientRect(), r = node.querySelector(`[data-field="${field}"]`).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, delta: r.top - b.y - b.height / 2 };
  }, context.field);
  await page.mouse.move(position.x, position.y);
  await page.mouse.wheel(0, position.delta);
  await expect(extra).toBeInViewport();
});
