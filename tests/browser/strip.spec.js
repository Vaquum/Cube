"use strict";
// B69 strip.spec.js (#193): the Strip under the price pane, on the fake cube's synthetic strip (tests/support/strip.js).
// Oracles: the fake's own /cube/strip answers, asked for again over HTTP (test support, never the page); the formulas of
// docs/strip.md computed here, with the vendored d3 for the Lab mixing and the page's role colours read from its stylesheet; the
// canvas operations pane-canvas.js records; and the address grammar and the menu's catalogue written as literals.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page);
  await use(paneCanvas.forPage(page));
} });
test.use({ reducedMotion: "reduce" });

const HOUR = 3600000, DAY = 86400000, FORCES = ["macro", "positioning", "news", "social"], LABELS = 12, BAND = 22;
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((n) => n.dataset.layout.split(",").map(Number));
// The canvas layout's fields, as geometry() writes them: the plot's x and w, and the Strip's y and height.
const at = (layout) => ({ x: layout[0], w: layout[2], by: layout[14], bh: layout[15] });

// A rectangle view of `days` days ending at the last quarter hour before the fake's cutoff, so every column's time is arithmetic
// on the address: a quarter hour is 16 base columns, so its edges are the cube's own and nothing is snapped.
const QUARTER = 900000;
async function rectangle(fake, days, extra) {
  const info = fake.info(), cutoff = Date.parse(info.cutoff), to = Math.floor(cutoff / QUARTER) * QUARTER, from = to - days * DAY;
  const [p0, p1] = info.priceBand.usdt;
  return { hash: `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&vis=2&rc=1${extra}`, from, to, cutoff };
}
// The fake's answer for a grid the page asked for: the view's (under 60 days wide) or the history's.
async function asked(fake, kind) {
  const request = fake.log().filter((e) => e.path === "/cube/strip" && e.status === 200)
    .filter((e) => (Number(e.query.to) - Number(e.query.from) < 60 * DAY) === (kind === "view")).pop();
  if (!request) throw new Error(`the page asked for no ${kind} grid`);
  const { from, to, step } = request.query;
  return (await fetch(`${fake.url}/cube/strip?from=${from}&to=${to}&step=${step}&proto=2`)).json();
}
const value = (answer, series, ms) => {
  const i = Math.floor((ms - answer.grid.t0) / answer.grid.step);
  return i >= 0 && i < series.length ? series[i] : null;
};
function lean(answer, ms, force = null) {
  if (force) return value(answer, answer.grid.forces[force], ms);
  const known = FORCES.map((f) => value(answer, answer.grid.forces[f], ms)).filter((v) => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) : null;
}
// docs/strip.md, Hue and intensity, in the page's own role colours: the expected #rrggbb of each sample.
function colours(page, samples) {
  return page.evaluate((samples) => {
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const role = (name) => {
      probe.style.color = `var(--ol-${name})`;
      return getComputedStyle(probe).color;
    };
    const surface = role("surface"), mid = role("midpoint"), pos = role("positive"), neg = role("negative");
    probe.remove();
    return samples.map(({ lean, attention }) => {
      const hue = d3.interpolateLab(mid, lean >= 0 ? pos : neg)(Math.min(1, Math.abs(lean)) ** 0.6);
      return d3.color(d3.interpolateLab(surface, hue)(Math.min(1, 1.7 * (attention ?? 0.5)))).formatHex();
    });
  }, samples);
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
async function open(page, fake, probe, hash) {
  await page.goto(`${fake.url}/${hash}`);
  await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", /^(ready|off)$/);
  await probe.waitForQuiet();
}

test("the Strip steps from Off to Forces to one force, and the address and a reload keep it", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(`${fake.url}/#w=24h&vis=2&rc=1`);
  await probe.waitForReady();
  const button = page.locator("#ol-strip"), menu = page.locator("#ol-strip-menu");
  await expect(button).toHaveAttribute("aria-label", "Strip: Off");
  expect((await layoutOf(page))[15]).toBe(0);
  await button.click();
  expect(await menu.locator("[data-strip]").evaluateAll((nodes) => nodes.map((n) => [n.dataset.strip, n.getAttribute("aria-checked")]))).toEqual([["off", "true"], ["forces", "false"]]);
  await menu.locator('[data-strip="forces"]').click();
  expect(await menu.locator("[data-force]").evaluateAll((nodes) => nodes.map((n) => [n.dataset.force, document.getElementById(n.getAttribute("aria-labelledby")).textContent])))
    .toEqual([["forces", "All forces"], ["macro", "Macro"], ["positioning", "Positioning"], ["news", "News"], ["social", "Social"]]);
  await menu.locator('[data-force="macro"]').click();
  await expect(menu).toBeHidden();
  await expect(button).toHaveAttribute("aria-label", "Strip: Forces · Macro");
  await expect(page).toHaveURL(/[#&]strip=forces\.macro(&|$)/);
  await expect(button).toHaveAttribute("data-state", "ready");
  expect((await layoutOf(page))[15]).toBe(LABELS + BAND);
  await page.reload();
  await probe.waitForReady();
  await expect(button).toHaveAttribute("aria-label", "Strip: Forces · Macro");
  await button.click();
  await menu.locator('[data-strip="off"]').click();
  await expect(button).toHaveAttribute("aria-label", "Strip: Off");
  await expect(page).not.toHaveURL(/strip=/);
});

test("the recorded page offers only Off, and drops a Strip an address asks for", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded");
  await page.goto(`${fake.url}/#w=24h&vis=2&rc=1&strip=forces`);
  await probe.waitForReady();
  const button = page.locator("#ol-strip"), menu = page.locator("#ol-strip-menu");
  await expect(button).toHaveAttribute("aria-label", "Strip: Off");
  await button.click();
  await expect(menu.locator('[data-strip="forces"]')).toHaveAttribute("aria-disabled", "true");
  await expect(menu.locator('[data-strip="forces"] .ol-item-desc')).toHaveText("Live cube only");
});

test("each column of the band is its documented colour, and nothing is drawn past the edge", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("mini"), view = await rectangle(fake, 1, "&strip=forces");
  await open(page, fake, probe, view.hash);
  const answer = await asked(fake, "view"), g = at(await layoutOf(page)), frame = await pane.last(), top = g.by + LABELS;
  const columns = frame.rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.x >= g.x && r.x < g.x + g.w);
  expect(columns.length).toBeGreaterThan(100);
  const time = (x) => view.from + ((x + 0.5 - g.x) / g.w) * (view.to - view.from);
  // The edge is the cutoff, at the plot's right edge here: no column lies past it.
  expect(Math.max(...columns.map((r) => time(r.x)))).toBeLessThanOrEqual(view.cutoff);
  const samples = columns.filter((_, k) => k % 37 === 0).map((r) => {
    const ms = Math.round(time(r.x));
    return { x: r.x, fill: r.fill, lean: lean(answer, ms), attention: value(answer, answer.grid.attention, ms) };
  });
  expect(samples.every((s) => s.lean !== null)).toBe(true);
  const want = await colours(page, samples);
  samples.forEach((s, k) => rgb(s.fill).forEach((c, i) => expect(Math.abs(c - rgb(want[k])[i]), `column ${s.x}: ${s.fill} for ${want[k]}`).toBeLessThanOrEqual(2)));
  // A column with no force known is left empty: News alone has gaps in the synthetic strip.
  await page.locator("#ol-strip").click();
  await page.locator('#ol-strip-menu [data-strip="forces"]').click();
  await page.locator('#ol-strip-menu [data-force="news"]').click();
  await probe.waitForQuiet();
  const news = (await pane.last()).rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.x >= g.x && r.x < g.x + g.w);
  const xs = new Set(news.map((r) => r.x));
  for (let x = Math.ceil(g.x); x < g.x + g.w; x += 7) {
    const known = lean(answer, Math.round(time(x)), "news") !== null;
    expect(xs.has(x), `column ${x} drawn exactly when News is known there`).toBe(known);
  }
});

test("replay draws only what was known by its edge: no band past it, no seam before a window closes", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("standard"), info = fake.info(), cutoff = Date.parse(info.cutoff);
  // A lit event measured inside the history, from the fake's own calendar: its window and the edge around it. Macro alone, so an
  // unscheduled move (News) adds no seam of its own.
  const history = await (await fetch(`${fake.url}/cube/strip?from=${Math.floor((cutoff - 120 * DAY) / HOUR) * HOUR}&to=${Math.ceil(cutoff / HOUR) * HOUR}&step=${HOUR}&proto=2`)).json();
  const lit = (x) => x.family === "macro" && (x.estimate ?? x.prior).charge >= 0.15;
  const e = history.events.find((x) => lit(x) && x.measured && x.measured.at < cutoff - 2 * DAY);
  expect(e, "the synthetic calendar has a lit, measured event").toBeTruthy();
  const [p0, p1] = info.priceBand.usdt, from = e.at - DAY, to = e.at + DAY;
  const hash = (edge) => `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&r=4,0&vis=2&rc=1&strip=forces.macro&replay=1&at=${iso(edge)}`;
  const seams = async (top) => (await pane.last()).strokes
    .filter((s) => s.width === 2 && s.path.length === 2 && s.path.every(([, y]) => y >= top && y <= top + BAND)).map((s) => s.path[0][0]).sort((a, b) => a - b);
  // The seams an edge allows: every lit Macro event in view whose window had closed by it, where it closed (docs/strip.md).
  const expected = (edge, X) => history.events.filter((x) => lit(x) && x.measured && x.measured.at <= edge && x.measured.at >= from && x.measured.at <= to)
    .map((x) => Math.round(X(x.measured.at)) + 0.5).sort((a, b) => a - b);
  // Within the window: the band ends at the edge and the reaction is not yet a seam.
  const opened = e.at + 15 * 60000;
  await open(page, fake, probe, hash(opened));
  const g = at(await layoutOf(page)), top = g.by + LABELS, X = (ms) => g.x + ((ms - from) / (to - from)) * g.w;
  const columns = (await pane.last()).rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2);
  expect(columns.length).toBeGreaterThan(0);
  expect(Math.max(...columns.map((r) => r.x))).toBeLessThan(X(opened) + 1);
  expect(await seams(top)).toEqual(expected(opened, X));
  expect(expected(opened, X)).not.toContain(Math.round(X(e.measured.at)) + 0.5);
  // Once the window has closed, its seam is drawn where it closed.
  const closed = e.measured.at + 15 * 60000;
  await open(page, fake, probe, hash(closed));
  expect(await seams(top)).toEqual(expected(closed, X));
  expect(expected(closed, X)).toContain(Math.round(X(e.measured.at)) + 0.5);
});

test("a bridge without the strip says so in the band and in the selector", async ({ page, fakeFor, probe, pane, allowConsole }) => {
  const fake = await fakeFor("mini");
  fake.on({ route: "/cube/strip" }).fail({ status: 503, body: { error: "strip_not_configured" } });
  allowConsole(/Failed to load resource: the server responded with a status of 503/);
  await page.goto(`${fake.url}/#w=24h&vis=2&rc=1&strip=forces`);
  await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "unconfigured");
  await probe.waitForQuiet();
  expect((await pane.last()).texts.map((t) => t.text)).toContain("Strip data is not served yet");
});

// docs/strip.md, Track record, computed here from the fake's history and view answers.
function trackRecord(history, view, ms, edge) {
  const step = history.grid.step, last = Math.min(history.grid.next24h.length - 1, Math.floor((edge - DAY - history.grid.t0) / step)), gap = Math.round((6 * HOUR) / step);
  const now = Object.fromEntries(FORCES.map((f) => [f, value(view, view.grid.forces[f], ms)]));
  const dims = FORCES.filter((f) => now[f] !== null && history.grid.forces[f].slice(0, last + 1).filter((v) => v !== null).length > 0.5 * (last + 1));
  const pool = [], all = [];
  for (let i = 0; i <= last; i++) {
    const r = history.grid.next24h[i];
    if (r === null) continue;
    if (i % gap === 0) all.push(r);
    if (dims.some((f) => history.grid.forces[f][i] === null)) continue;
    pool.push({ i, r, d: Math.sqrt(dims.reduce((s, f) => s + (history.grid.forces[f][i] - now[f]) ** 2, 0)) });
  }
  pool.sort((a, b) => a.d - b.d || a.i - b.i);
  const near = [];
  for (const p of pool) {
    if (p.d > 0.5 || near.length === 40) break;
    if (near.every((q) => Math.abs(q.i - p.i) >= gap)) near.push(p);
  }
  return { dims, near, all };
}

test("the card on the band gives the forces and their track record; on an event, its own move", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"), view = await rectangle(fake, 7, "&strip=forces");
  await open(page, fake, probe, view.hash);
  await expect.poll(async () => fake.log().filter((e) => e.path === "/cube/strip" && Number(e.query.to) - Number(e.query.from) > 60 * DAY && e.status === 200).length).toBeGreaterThan(0);
  await probe.waitForQuiet();
  const g = at(await layoutOf(page)), box = await page.locator("#ol-canvas").boundingBox(), y = g.by + LABELS + BAND / 2, tip = page.locator("#ol-tip");
  const answer = await asked(fake, "view"), history = await asked(fake, "history");
  // An event to hover, and a column at least 12 px from every event for the forces.
  const xOf = (ms) => g.x + ((ms - view.from) / (view.to - view.from)) * g.w;
  const events = answer.events.filter((e) => e.at > view.from && e.at < view.cutoff && e.knownAt <= view.cutoff);
  let x = g.x + g.w * 0.6;
  while (events.some((e) => Math.abs(xOf(e.at) - x) < 12)) x -= 13;
  await page.mouse.move(box.x + x, box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-forces");
  const ms = Math.round(view.from + ((x - g.x) / g.w) * (view.to - view.from)), T = trackRecord(history, answer, ms, view.cutoff);
  expect(T.near.length).toBeGreaterThanOrEqual(8);
  const down = T.near.filter((p) => p.r < 0).length / T.near.length, fell = down >= 0.5;
  await expect(tip.locator(".ol-strip-big")).toHaveText(`${fell ? "Fell" : "Rose"} in ${Math.round((fell ? down : 1 - down) * 100)}%`);
  expect(Number(await tip.locator('[data-field="trackShare"]').getAttribute("data-canonical"))).toBeCloseTo(fell ? down : 1 - down, 12);
  await expect(tip.locator(".ol-tip-sub").nth(1)).toContainText(`of ${T.near.length} moments`);
  const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
  // An event behind the edge, its window closed: the move it made.
  const done = events.find((x) => x.measured && x.measured.at <= view.cutoff && events.every((o) => o === x || Math.abs(xOf(o.at) - xOf(x.at)) > 12));
  expect(done, "a measured event stands alone in the week").toBeTruthy();
  await page.mouse.move(box.x + xOf(done.at), box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await expect(tip.locator(".ol-tip-head")).toHaveText(done.name);
  await expect(tip.locator(".ol-strip-big")).toHaveText(pct(done.measured.move));
  // An event ahead, in the horizon box beside the profile: its own move as the options estimated it, p5, p50 and p95.
  const x0 = (await layoutOf(page))[7], width = 62, H = (ms) => x0 + (width * Math.log1p((ms - view.cutoff) / HOUR)) / Math.log1p((90 * DAY) / HOUR);
  const ahead = answer.events.filter((x) => x.at > view.cutoff && x.at <= view.cutoff + 90 * DAY && x.knownAt <= view.cutoff);
  const next = ahead.find((x) => x.estimate && x.estimate.at <= view.cutoff && ahead.every((o) => o === x || Math.abs(H(o.at) - H(x.at)) > 6));
  expect(next, "an estimated event stands alone in the horizon").toBeTruthy();
  await page.mouse.move(box.x + H(next.at), box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await expect(tip.locator(".ol-tip-head")).toHaveText(next.name);
  await expect(tip.locator(".ol-strip-q3-value")).toHaveText([pct(next.estimate.reaction.p5), pct(next.estimate.reaction.p50), pct(next.estimate.reaction.p95)]);
});
