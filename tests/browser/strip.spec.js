"use strict";
// B69 strip.spec.js (#193): the Strip under the price pane, on the fake cube's synthetic strip and recorded production regressions.
// Oracles: the fake's own /cube/strip answers, asked for again over HTTP (test support, never the page); the formulas and known-at
// rules of docs/strip.md computed here, with the vendored d3 for the Lab mixing and the page's role colours read from its stylesheet;
// the canvas operations pane-canvas.js records; the fake's request log; and the address grammar and the menu's catalogue written as
// literals.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page);
  await use(paneCanvas.forPage(page));
} });
test.use({ reducedMotion: "reduce" });

const HOUR = 3600000, DAY = 86400000, FORCES = ["macro", "positioning", "news", "social"], LABELS = 12, BAND = 22, FOOT = 5, SUPPORT = 30;
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
// A replay in the candles view, whose edge is the address's own: a cells view's edge is floored to its drawn level's column and can
// stay at a coarser one (#195).
const REPLAY = "mode=candles&replay=1";
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((n) => n.dataset.layout.split(",").map(Number));
// The canvas layout's fields, as geometry() writes them: the plot's x and w, and the Strip's y and height.
const at = (layout) => ({ x: layout[0], w: layout[2], by: layout[14], bh: layout[15] });
// Structured status badges share the heading; the name itself is its leading text node.
const titleOf = (card) => card.locator(".ol-tip-head").evaluate((n) => n.firstChild.textContent.trim());

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
// docs/strip.md, Known-at: an event's schedule entry known strictly before `ms`, and its time then (undefined before its first entry,
// null once cancelled); where the page places it, its time, or the middle of a date or a range no later than the edge.
const entryAt = (e, ms) => e.schedule.filter((s) => s.knownAt < ms).pop();
const whenAt = (e, ms) => entryAt(e, ms)?.at;
const placeAt = (e, ms) => {
  const s = entryAt(e, ms);
  return !s || s.at === null ? null : s.precision === "instant" ? s.at : Math.min((s.at + s.end) / 2, ms);
};
// docs/strip.md, Hue and intensity, in the page's own role colours: each sample's hue, mixed in Lab from the midpoint toward the role
// (d3, an oracle independent of the module's colour tables), and the alpha that lays it over the surface.
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
    return samples.map(({ lean, attention }) => ({
      hue: d3.color(d3.interpolateLab(mid, lean >= 0 ? pos : neg)(Math.min(1, Math.abs(lean)) ** 0.6)).formatHex(),
      alpha: attention === null ? 0.5 : Math.min(1, 1.7 * attention),
    }));
  }, samples);
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// A fresh load at an address: a change of hash alone would not reload the page.
async function open(page, fake, probe, hash) {
  await page.goto("about:blank");
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
  expect(fake.log().filter((e) => e.path === "/cube/strip")).toEqual([]);
});

test("each column of the band is its documented colour at its attention's alpha, and nothing is drawn past the edge", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("standard"), view = await rectangle(fake, 1, "&strip=forces");
  await open(page, fake, probe, view.hash);
  const answer = await asked(fake, "view"), g = at(await layoutOf(page)), frame = await pane.last(), top = g.by + LABELS;
  const columns = frame.rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.fill !== "pattern" && r.x >= g.x && r.x < g.x + g.w);
  expect(columns.length).toBeGreaterThan(100);
  const time = (x) => view.from + ((x + 0.5 - g.x) / g.w) * (view.to - view.from);
  // The edge is the cutoff, at the plot's right edge here: no column lies past it.
  expect(Math.max(...columns.map((r) => time(r.x)))).toBeLessThan(view.cutoff);
  const samples = columns.filter((_, k) => k % 37 === 0).map((r) => {
    const ms = Math.round(time(r.x));
    return { x: r.x, fill: r.fill, alpha: r.alpha, lean: lean(answer, ms), attention: value(answer, answer.grid.attention, ms) };
  });
  expect(samples.every((s) => s.lean !== null && s.attention !== null)).toBe(true);
  const want = await colours(page, samples);
  samples.forEach((s, k) => {
    rgb(s.fill).forEach((c, i) => expect(Math.abs(c - rgb(want[k].hue)[i]), `column ${s.x}: ${s.fill} for ${want[k].hue}`).toBeLessThanOrEqual(2));
    expect(s.alpha, `column ${s.x}'s alpha`).toBeCloseTo(want[k].alpha, 4);
  });
  // Attention is known throughout: no foot of the undefined hatch.
  expect(frame.rects.filter((r) => r.fill === "pattern" && r.y === top + BAND - 1 - FOOT)).toEqual([]);
});

test("where no force is known the column is the hatch of an undefined value, and where attention is not known a strip of it runs along the foot", async ({ page, fakeFor, probe, pane }) => {
  // Social has no history before its last week in the synthetic strip: ten days of it are three days of hatch, then hue.
  const fake = await fakeFor("standard"), view = await rectangle(fake, 10, "&strip=forces.social");
  await open(page, fake, probe, view.hash);
  const answer = await asked(fake, "view"), g = at(await layoutOf(page)), top = g.by + LABELS, rects = (await pane.last()).rects;
  const time = (x) => view.from + ((x + 0.5 - g.x) / g.w) * (view.to - view.from);
  const hue = new Set(rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.fill !== "pattern").map((r) => r.x));
  const hatch = rects.filter((r) => r.fill === "pattern" && r.y === top + 1 && r.h === BAND - 2);
  let unknown = 0;
  for (let x = Math.ceil(g.x); x < g.x + g.w - 1; x += 7) {
    const known = lean(answer, Math.round(time(x)), "social") !== null;
    unknown += known ? 0 : 1;
    expect(hue.has(x), `column ${x} has a hue exactly where Social is known`).toBe(known);
    expect(hatch.some((r) => r.x <= x && x < r.x + r.w), `column ${x} is hatched exactly where Social is not known`).toBe(!known);
  }
  expect(unknown).toBeGreaterThan(10);
  // The mini profile's history is two days, all before its attention has a normal to be read against.
  const mini = await fakeFor("mini"), day = await rectangle(mini, 1, "&strip=forces");
  await open(page, mini, probe, day.hash);
  const answer2 = await asked(mini, "view"), frame = await pane.last(), g2 = at(await layoutOf(page)), top2 = g2.by + LABELS;
  const columns = frame.rects.filter((r) => r.w === 1 && r.y === top2 + 1 && r.h === BAND - 2 && r.fill !== "pattern");
  const feet = frame.rects.filter((r) => r.fill === "pattern" && r.y === top2 + BAND - 1 - FOOT && r.h === FOOT);
  expect(columns.length).toBeGreaterThan(100);
  for (const r of columns.filter((_, k) => k % 29 === 0)) {
    const ms = Math.round(day.from + ((r.x + 0.5 - g2.x) / g2.w) * (day.to - day.from));
    expect(value(answer2, answer2.grid.attention, ms), `column ${r.x}'s attention`).toBeNull();
    expect(r.alpha, `column ${r.x} is laid at 0.5`).toBeCloseTo(0.5, 4);
    expect(feet.some((f) => f.x <= r.x && r.x < f.x + f.w), `column ${r.x} carries the foot`).toBe(true);
  }
});

test("replay draws only what was known strictly before its edge: no band past it, no seam until a window has closed", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("standard"), info = fake.info(), cutoff = Date.parse(info.cutoff);
  // A lit event measured inside the history, from the fake's own calendar: lit by the calendar's weight as the edge knew it. Macro
  // alone, so an unscheduled move (News) adds no seam of its own.
  const history = await (await fetch(`${fake.url}/cube/strip?from=${Math.floor((cutoff - 120 * DAY) / HOUR) * HOUR}&to=${Math.ceil(cutoff / HOUR) * HOUR}&step=${HOUR}&proto=2`)).json();
  const lit = (x, edge) => x.family === "macro" && x.measured && (entryAt(x, edge)?.weight ?? 0) >= 0.3;
  const e = history.events.find((x) => lit(x, cutoff) && x.measured.at < cutoff - 2 * DAY);
  expect(e, "the synthetic calendar has a lit, measured event").toBeTruthy();
  const [p0, p1] = info.priceBand.usdt, from = e.measured.from - DAY, to = e.measured.from + DAY;
  const hash = (edge) => `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&r=4,0&vis=2&rc=1&strip=forces.macro&${REPLAY}&at=${iso(edge)}`;
  const seams = async (top) => (await pane.last()).strokes
    .filter((s) => s.width === 2 && s.path.length === 2 && s.path.every(([, y]) => y >= top && y <= top + BAND)).map((s) => s.path[0][0]).sort((a, b) => a - b);
  // The seams an edge allows: every lit Macro event in view whose window had closed strictly before it, where it closed.
  const expected = (edge, X) => history.events.filter((x) => lit(x, edge) && x.measured.at < edge && x.measured.at >= from && x.measured.at <= to)
    .map((x) => Math.round(X(x.measured.at)) + 0.5).sort((a, b) => a - b);
  // Within the window: the band ends at the edge and the reaction is not yet a seam.
  const opened = e.measured.from + 15 * 60000;
  await open(page, fake, probe, hash(opened));
  const g = at(await layoutOf(page)), top = g.by + LABELS, X = (ms) => g.x + ((ms - from) / (to - from)) * g.w;
  const columns = (await pane.last()).rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2);
  expect(columns.length).toBeGreaterThan(0);
  expect(Math.max(...columns.map((r) => r.x))).toBeLessThan(X(opened) + 1);
  expect(await seams(top)).toEqual(expected(opened, X));
  expect(expected(opened, X)).not.toContain(Math.round(X(e.measured.at)) + 0.5);
  // At the window's close itself the reaction is known only at the edge, not before it: still no seam.
  await open(page, fake, probe, hash(e.measured.at));
  expect(await seams(top)).toEqual(expected(e.measured.at, X));
  expect(expected(e.measured.at, X)).not.toContain(Math.round(X(e.measured.at)) + 0.5);
  // A quarter hour later, its seam is drawn where it closed.
  const closed = e.measured.at + 15 * 60000;
  await open(page, fake, probe, hash(closed));
  expect(await seams(top)).toEqual(expected(closed, X));
  expect(expected(closed, X)).toContain(Math.round(X(e.measured.at)) + 0.5);
});

test("a moved event is where each edge knew it would be: before the move was announced, after it, and once it had happened", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("standard"), info = fake.info(), cutoff = Date.parse(info.cutoff), tip = page.locator("#ol-tip");
  const history = await (await fetch(`${fake.url}/cube/strip?from=${Math.floor((cutoff - 300 * DAY) / HOUR) * HOUR}&to=${Math.ceil(cutoff / HOUR) * HOUR}&step=${HOUR}&proto=2`)).json();
  // A CPI moved a day later, announced three days before its first date.
  const e = history.events.find((x) => x.series === "cpi" && x.schedule.length === 2 && x.schedule[1].at !== null && x.measured && x.measured.at < cutoff - 2 * DAY);
  expect(e, "the synthetic calendar moved a CPI").toBeTruthy();
  const [first, moved] = e.schedule, [p0, p1] = info.priceBand.usdt, from = first.at - 4 * DAY, to = moved.at + DAY;
  const hash = (edge) => `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&r=4,0&vis=2&rc=1&strip=forces.macro&${REPLAY}&at=${iso(edge)}`;
  // Ahead of an edge, in the horizon box beside the profile, hovered where the edge knew the event would be.
  async function ahead(edge, time) {
    await open(page, fake, probe, hash(edge));
    const layout = await layoutOf(page), g = at(layout), box = await page.locator("#ol-canvas").boundingBox();
    const H = (ms) => layout[7] + (62 * Math.log1p((ms - edge) / HOUR)) / Math.log1p((90 * DAY) / HOUR);
    await page.mouse.move(box.x + H(time), box.y + g.by + LABELS + BAND / 2);
    await expect(tip).toHaveAttribute("data-presentation", "strip-event");
    await expect(tip.locator(".ol-tip-head")).toHaveText(e.name);
  }
  // Before the move was announced: due at its first date.
  expect(whenAt(e, moved.knownAt - HOUR)).toBe(first.at);
  await ahead(moved.knownAt - HOUR, first.at);
  await expect(tip.locator('[data-field="eventMoved"]')).toHaveAttribute("data-fact", "No");
  await expect(tip.locator('[data-field="eventAt"]')).toHaveAttribute("data-canonical", String(first.at));
  // After the announcement, an hour past its first date: due a day later, and said to be moved.
  expect(whenAt(e, first.at + HOUR)).toBe(moved.at);
  await ahead(first.at + HOUR, moved.at);
  await expect(tip.locator('[data-field="eventMoved"]')).toHaveAttribute("data-fact", "Yes");
  await expect(tip.locator('[data-field="eventAt"]')).toHaveAttribute("data-canonical", String(moved.at));
  // Once it has happened: labelled at the moved time, never at the first.
  await open(page, fake, probe, hash(moved.at + 2 * HOUR));
  const g = at(await layoutOf(page)), X = (ms) => g.x + ((ms - from) / (to - from)) * g.w;
  const labels = (await pane.last()).texts.filter((t) => t.text === "CPI").map((t) => Math.round(t.x));
  expect(labels).toContain(Math.round(X(moved.at)));
  expect(labels).not.toContain(Math.round(X(first.at)));
});

test("a page served without the strip never asks for it, and says so in the band and in the selector", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("mini", { strip: "off" });
  await page.goto(`${fake.url}/#w=24h&vis=2&rc=1&strip=forces`);
  await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "unconfigured");
  await expect(page.locator("#ol-strip")).toHaveAttribute("aria-label", "Strip: Forces");
  await probe.waitForQuiet();
  expect((await pane.last()).texts.map((t) => t.text)).toContain("Strip data is not served here yet");
  expect(fake.log().filter((e) => e.path === "/cube/strip")).toEqual([]);
  await page.locator("#ol-strip").click();
  await expect(page.locator('#ol-strip-menu [data-strip="forces"] .ol-item-desc')).toHaveText("Not served here yet: the band will say so");
});

test("a strip the bridge cannot get says so with the bridge's words, apart from one not served", async ({ page, fakeFor, probe, pane, allowConsole }) => {
  const fake = await fakeFor("mini");
  fake.on({ route: "/cube/strip" }).fail({ status: 502, body: { error: "strip_upstream_failed", detail: "Origo did not answer: timed out" } });
  allowConsole(/Failed to load resource: the server responded with a status of 502/);
  await page.goto(`${fake.url}/#w=24h&vis=2&rc=1&strip=forces`);
  await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state", "failed");
  await probe.waitForQuiet();
  expect((await pane.last()).texts.map((t) => t.text)).toContain("Strip unavailable: Origo did not answer: timed out");
});

// docs/strip.md, Track record, computed here from the fake's hourly history.
function trackRecord(history, ms, edge) {
  const step = history.grid.step, gap = Math.round((6 * HOUR) / step), t0 = history.grid.t0;
  // Moments whose next 24 hours had passed strictly before both this moment and the edge.
  const last = Math.min(history.grid.next24h.length, Math.ceil((Math.min(ms, edge) - DAY - t0) / step)) - 1;
  const now = Object.fromEntries(FORCES.map((f) => [f, value(history, history.grid.forces[f], ms)]));
  const dims = FORCES.filter((f) => now[f] !== null && history.grid.forces[f].slice(0, last + 1).filter((v) => v !== null).length > 0.5 * (last + 1));
  const pool = [], all = [];
  for (let i = 0; i <= last; i++) {
    const r = history.grid.next24h[i];
    if (r === null) continue;
    expect(t0 + i * step + DAY, "no moment's outcome reaches this moment or the edge").toBeLessThan(Math.min(ms, edge));
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
  const answer = await asked(fake, "view"), history = await asked(fake, "history"), edge = view.cutoff;
  // An event to hover, and a column at least 12 px from every event for the forces.
  const xOf = (ms) => g.x + ((ms - view.from) / (view.to - view.from)) * g.w;
  const events = answer.events.map((e) => ({ ...e, at: placeAt(e, edge) })).filter((e) => e.at && e.at > view.from && e.at < edge);
  let x = g.x + g.w * 0.6;
  while (events.some((e) => Math.abs(xOf(e.at) - x) < 12)) x -= 13;
  await page.mouse.move(box.x + x, box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-forces");
  const ms = Math.round(view.from + ((x - g.x) / g.w) * (view.to - view.from)), T = trackRecord(history, ms, edge);
  if (T.near.length >= SUPPORT) {
    const down = T.near.filter((p) => p.r < 0).length / T.near.length;
    expect(Number(await tip.locator('[data-field="trackShare"]').getAttribute("data-canonical"))).toBeCloseTo(down, 12);
    await expect(tip.locator(".ol-strip-hist")).toHaveCount(1);
  } else {
    // Below the support floor, only support counts are available: no finite share or quantile.
    const estimates = await tip.locator('[data-field="trackShare"], [data-field^="trackP"]').evaluateAll((nodes) => nodes.map((n) => n.dataset.canonical));
    expect(estimates.every((v) => !Number.isFinite(Number(v)))).toBe(true);
    await expect(tip.locator(".ol-strip-hist")).toHaveCount(0);
  }
  expect(Number(await tip.locator('[data-field="trackNear"]').getAttribute("data-canonical"))).toBe(T.near.length);
  expect(Number(await tip.locator('[data-field="trackAll"]').getAttribute("data-canonical"))).toBe(T.all.length);
  // The forces shown are the finest grid's at that time: the view's quarter hours here.
  expect(Number(await tip.locator('[data-field="forceCoverage"]').getAttribute("data-canonical")))
    .toBe(FORCES.filter((f) => value(answer, answer.grid.forces[f], ms) !== null).length);
  await expect(tip.locator(".ol-tip-note")).toHaveCount(0);
  // An event behind the edge, its window closed: the move it made.
  const done = events.find((x) => x.measured && x.measured.at < edge && events.every((o) => o === x || Math.abs(xOf(o.at) - xOf(x.at)) > 12));
  expect(done, "a measured event stands alone in the week").toBeTruthy();
  await page.mouse.move(box.x + xOf(done.at), box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await expect.poll(() => titleOf(tip)).toBe(done.name);
  await expect(tip.locator(".ol-tip-head .ol-strip-status")).toHaveText("Measured");
  expect(Number(await tip.locator('[data-field="eventMove"]').getAttribute("data-canonical"))).toBe(done.measured.move);
  await expect(tip.locator(".ol-tip-note")).toHaveCount(0);
  // An event ahead, in the horizon box beside the profile: when it is, how much it matters, and the options' range to its time.
  const x0 = (await layoutOf(page))[7], width = 62, H = (ms) => x0 + (width * Math.log1p((ms - edge) / HOUR)) / Math.log1p((90 * DAY) / HOUR);
  const ahead = answer.events.map((x) => ({ ...x, at: whenAt(x, edge) })).filter((x) => x.at && x.at > edge && x.at <= edge + 90 * DAY);
  const next = ahead.find((x) => entryAt(x, edge).weight > 0 && ahead.every((o) => o === x || Math.abs(H(o.at) - H(x.at)) > 6));
  expect(next, "a lit event stands alone in the horizon").toBeTruthy();
  await page.mouse.move(box.x + H(next.at), box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await expect(tip.locator(".ol-tip-head")).toHaveText(next.name);
  const entry = entryAt(next, edge);
  await expect(tip.locator('[data-field="eventImportance"]')).toContainText(new RegExp(entry.importance, "i"));
  await expect(tip.locator('[data-field="dvol"]')).toHaveCount(1);
  await expect(tip.locator(".ol-tip-note")).toHaveCount(0);
});

test("a range of dates with no hour is labelled at its middle over a bracket of its span, its light held through it", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("standard"), info = fake.info(), cutoff = Date.parse(info.cutoff);
  const history = await (await fetch(`${fake.url}/cube/strip?from=${Math.floor((cutoff - 200 * DAY) / HOUR) * HOUR}&to=${Math.ceil(cutoff / HOUR) * HOUR}&step=${HOUR}&proto=2`)).json();
  const e = history.events.find((x) => x.schedule[0].precision === "range" && x.schedule[0].weight >= 0.3 && x.schedule[0].end < cutoff - 2 * DAY);
  expect(e, "the synthetic calendar has a lit range").toBeTruthy();
  const { at: start, end } = e.schedule[0], [p0, p1] = info.priceBand.usdt, from = start - 2 * DAY, to = end + 2 * DAY;
  await open(page, fake, probe, `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&r=4,0&vis=2&rc=1&strip=forces.news&${REPLAY}&at=${iso(end + DAY)}`);
  const g = at(await layoutOf(page)), X = (ms) => g.x + ((ms - from) / (to - from)) * g.w, frame = await pane.last();
  const label = frame.texts.find((t) => t.text === e.short);
  expect(label, "the range is labelled").toBeTruthy();
  expect(Math.abs(label.x - X((start + end) / 2))).toBeLessThan(1);
  const bracket = frame.strokes.find((s) => s.width === 1 && s.path.length === 2 && s.path.every(([, y]) => y === g.by + LABELS - 0.5));
  expect(bracket, "a bracket spans it").toBeTruthy();
  expect(Math.abs(bracket.path[0][0] - X(start))).toBeLessThan(1);
  expect(Math.abs(bracket.path[1][0] - X(end))).toBeLessThan(1);
  // The original variable-height light holds through the date range at its full weight.
  const top = g.by + LABELS, mid = Math.floor(X((start + end) / 2)), height = (BAND - 2) * 0.7;
  expect(frame.rects.some((r) => r.w === 1 && r.x === mid && r.fill !== "pattern" && Math.abs(r.h - height) < 1e-9
    && Math.abs(r.y - (top + (BAND - height) / 2)) < 1e-9 && Math.abs(r.alpha - 0.85) < 1e-9)).toBe(true);
});

test("the band's own card names each source's freshness, a stale one as stale", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"), view = await rectangle(fake, 1, "&strip=forces");
  await open(page, fake, probe, view.hash);
  const g = at(await layoutOf(page)), box = await page.locator("#ol-canvas").boundingBox(), tip = page.locator("#ol-tip");
  await page.mouse.move(box.x + g.x - 20, box.y + g.by + LABELS + BAND / 2);
  await expect.poll(() => titleOf(tip)).toBe("Strip · Forces");
  await expect(tip).toHaveAttribute("data-presentation", "strip-sources");
  await expect(tip.locator('[data-field="source.wikimedia_hourly"]')).toContainText(/stale/i);
  await expect(tip.locator('[data-field="source.fred_macro_daily"]')).toContainText(/ok/i);
  for (const source of ["deribit_funding", "hyperliquid_funding", "gdelt_gkg", "bluesky_live", "deribit_dvol", "calendar"])
    await expect(tip.locator(`[data-field="source.${source}"]`)).toHaveCount(1);
  await expect(tip.locator('[data-field="fieldCutoff"]')).toHaveCount(1);
  await expect(tip.locator(".ol-tip-note")).toHaveCount(0);
});

// Recorded production coverage, translated to the fake's clock without changing a value. The real view predates the
// field archive: daily Macro/stablecoins alone lean down; News, Social and every attention part are unavailable.
test("recorded partial history is disclosed on the band, in its hatch and in the archive card", async ({ page, fakeFor, probe, pane }) => {
  const recorded = require("../fixtures/regressions/forces-partial-history/strip.json"), grid = recorded.grid;
  expect(grid.attention.every((v) => v === null)).toBe(true);
  expect(grid.forces.news.every((v) => v === null) && grid.forces.social.every((v) => v === null)).toBe(true);
  const fake = await fakeFor("standard"), view = await rectangle(fake, grid.attention.length / 96, "&strip=forces"), shift = view.from - grid.t0;
  await page.route("**/cube/strip?*", async (route) => {
    const original = await route.fetch(), body = await original.json(), q = new URL(route.request().url()).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to")), step = Number(q.get("step"));
    const read = (series) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => {
      const at = Math.floor((from + i * step - shift - grid.t0) / grid.step);
      return at >= 0 && at < series.length ? series[at] : null;
    });
    body.grid.forces = Object.fromEntries(Object.entries(grid.forces).map(([k, v]) => [k, read(v)]));
    body.grid.attention = read(grid.attention);
    body.grid.parts = Object.fromEntries(Object.entries(grid.parts).map(([k, v]) => [k, read(v)]));
    body.events = []; body.jumps = [];
    body.sources = Object.fromEntries(Object.entries(recorded.sources).map(([name, source]) => [name, {
      ...source, recordedFrom: source.recordedFrom === null ? null : source.recordedFrom + shift,
    }]));
    await route.fulfill({ response: original, json: body });
  });
  await open(page, fake, probe, view.hash);
  const button = page.locator("#ol-strip"), caption = "Limited data · Inputs 5/10 · Attention 0/4";
  await expect(button).toHaveAttribute("data-coverage", caption);
  await expect(button).toHaveAccessibleDescription(new RegExp(caption));
  await expect(button).toHaveAccessibleDescription(/What the band under the prices shows/);
  const g = at(await layoutOf(page)), frame = await pane.last(), top = g.by + LABELS;
  expect(frame.texts.some((t) => t.text === caption && t.y >= g.by && t.y < top)).toBe(true);
  const partial = frame.rects.filter((r) => r.fill === "pattern" && r.y === top + 1 && r.h === FOOT / 2);
  const feet = frame.rects.filter((r) => r.fill === "pattern" && r.y === top + BAND - 1 - FOOT && r.h === FOOT);
  for (let x = Math.ceil(g.x); x < g.x + g.w - 1; x += 29) {
    expect(partial.some((r) => r.x <= x && x < r.x + r.w), `partial force hatch at ${x}`).toBe(true);
    expect(feet.some((r) => r.x <= x && x < r.x + r.w), `missing attention hatch at ${x}`).toBe(true);
  }
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + g.x + g.w / 2, box.y + top + BAND / 2);
  const tip = page.locator("#ol-tip");
  await expect(tip).toHaveAttribute("data-presentation", "strip-forces");
  await expect(tip.locator(".ol-tip-note")).toHaveCount(0);
  expect(Number(await tip.locator('[data-field="coverage"]').getAttribute("data-canonical"))).toBe(5);
  expect(Number(await tip.locator('[data-field="forceCoverage"]').getAttribute("data-canonical"))).toBe(2);
  await button.click();
  await page.locator('#ol-strip-menu [data-strip="forces"]').click();
  await page.locator('#ol-strip-menu [data-force="macro"]').click();
  await expect(button).toHaveAttribute("data-coverage", "Limited data · Inputs 4/4 · Attention 0/4");
  await probe.waitForQuiet();
  expect((await pane.last()).rects.filter((r) => r.fill === "pattern" && r.y === top + 1 && r.h === FOOT)).toEqual([]);
  await button.click();
  await page.locator('#ol-strip-menu [data-strip="off"]').click();
  await expect(button).toHaveAttribute("data-coverage", "");
  await expect(button).not.toHaveAccessibleDescription(/Limited data|Inputs/);
  await expect(button).toHaveAccessibleDescription(/What the band under the prices shows/);
});

test("a dense real calendar keeps the reference light envelope without masking the force colours", async ({ page, fakeFor, probe, pane }) => {
  const recorded = require("../fixtures/regressions/forces-calendar-mask/strip.json"), grid = recorded.grid;
  const fake = await fakeFor("mini", { cutoff: new Date(recorded.cutoff).toISOString() }), view = await rectangle(fake, 4 / 24, "&strip=forces");
  await page.route("**/cube/strip?*", async (route) => {
    const q = new URL(route.request().url()).searchParams, from = Number(q.get("from")), to = Number(q.get("to")), step = Number(q.get("step"));
    const read = (series) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => {
      const at = Math.floor((from + i * step - grid.t0) / grid.step);
      return at >= 0 && at < series.length ? series[at] : null;
    });
    await route.fulfill({ json: { ...recorded, grid: { t0: from, step,
      forces: Object.fromEntries(Object.entries(grid.forces).map(([k, v]) => [k, read(v)])),
      ...Object.fromEntries(["attention", "close", "next24h", "dvol"].map((k) => [k, read(grid[k])])),
      parts: Object.fromEntries(Object.entries(grid.parts).map(([k, v]) => [k, read(v)])),
    } } });
  });
  await open(page, fake, probe, view.hash);
  // These captured records contain seven measured force inputs, including Social, and all four attention inputs.
  const inputs = Object.keys(grid.parts).filter((name) => !name.startsWith("attention."));
  expect(inputs.length).toBe(10);
  expect(inputs.filter((name) => value(recorded, grid.parts[name], (view.from + view.to) / 2) !== null).length).toBe(7);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-coverage", "Limited data · Inputs 7/10 · Attention 4/4");
  const g = at(await layoutOf(page)), top = g.by + LABELS, frame = await pane.last(), palette = await pane.colours();
  const columns = frame.rects.filter((r) => r.w === 1 && r.y === top + 1 && r.h === BAND - 2 && r.fill !== "pattern" && r.x >= g.x && r.x < g.x + g.w);
  expect(columns.length).toBeGreaterThan(100);
  const samples = columns.filter((_, i) => i % 97 === 43).map((r) => {
    const ms = Math.round(view.from + ((r.x + 0.5 - g.x) / g.w) * (view.to - view.from));
    return { x: r.x, ms, lean: lean(recorded, ms), attention: value(recorded, grid.attention, ms) };
  });
  expect(samples.length).toBeGreaterThan(5);
  expect(samples.every((s) => s.lean !== null && s.attention !== null)).toBe(true);
  // The oracle derives each event's contribution independently from the captured schedule. The combined light is its maximum,
  // so thirty-eight simultaneous low weights cannot manufacture one permanently high-importance event.
  for (const sample of samples) {
    const contributions = recorded.events.map((e) => {
      const s = entryAt(e, sample.ms);
      if (!s || s.at === null || !s.weight) return 0;
      return sample.ms < s.at ? s.at - sample.ms > 14 * DAY ? 0 : s.weight * Math.exp(-(s.at - sample.ms) / (2 * DAY))
        : s.end !== null && sample.ms < s.end ? s.weight : 0;
    });
    expect(contributions.reduce((sum, v) => sum + v, 0), "the former sum would saturate").toBeGreaterThan(1);
    sample.light = Math.max(...contributions);
    expect(sample.light).toBeGreaterThan(0.2);
    expect(sample.light).toBeLessThan(0.3);
  }
  const want = await colours(page, samples), surface = rgb(palette.surface), ink = rgb(palette.ink),
    blend = (under, over, alpha) => under.map((v, i) => v * (1 - alpha) + over[i] * alpha),
    grounds = want.map((s) => blend(surface, rgb(s.hue), s.alpha)),
    beams = frame.rects.filter((r) => r.w === 1 && r.fill === palette.ink && r.x >= g.x && r.x < g.x + g.w && r.y >= top + 1 && r.y + r.h <= top + BAND - 1);
  expect(beams.length).toBe(columns.length);
  for (const sample of samples) {
    const beam = beams.find((r) => r.x === sample.x), height = (BAND - 2) * (0.2 + 0.5 * sample.light);
    expect(beam, `light at ${sample.x}`).toBeTruthy();
    expect(beam.h).toBeCloseTo(height, 5);
    expect(beam.y).toBeCloseTo(top + (BAND - height) / 2, 5);
    expect(beam.alpha).toBeCloseTo(0.85 * sample.light, 6);
  }
  // y+6 and y+15 were inside the old saturated 14 px block; they are outside the real event's narrower envelope.
  // Center pixels also keep their documented force colour under the event's actual opacity.
  const pixels = await page.locator("#ol-canvas").evaluate((canvas, { samples, top }) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return samples.map(({ x }) => [6, 15, 11].map((y) => Array.from(ctx.getImageData(x, top + y, 1, 1).data.slice(0, 3))));
  }, { samples, top });
  pixels.forEach((points, k) => {
    for (const point of points.slice(0, 2)) point.forEach((v, i) => expect(Math.abs(v - grounds[k][i]), `force colour outside the event light at ${samples[k].x}`).toBeLessThanOrEqual(2));
    const lit = blend(grounds[k], ink, 0.85 * samples[k].light);
    points[2].forEach((v, i) => expect(Math.abs(v - lit[i]), `event light at ${samples[k].x}`).toBeLessThanOrEqual(2));
  });
  const first = pixels[0][0], last = pixels[pixels.length - 1][0];
  expect(Math.max(...first.map((v, i) => Math.abs(v - last[i]))), "the real force/attention change remains visible").toBeGreaterThan(20);
});

test("coverage reports changing support only before the visible replay edge", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor("standard"), view = await rectangle(fake, 1, "&strip=forces"), middle = (view.from + view.to) / 2;
  await page.route("**/cube/strip?*", async (route) => {
    const original = await route.fetch(), body = await original.json(), { t0, step } = body.grid;
    body.grid.forces.news = body.grid.forces.news.map((v, i) => t0 + i * step < middle ? null : v);
    // Synthetic support changes, independent of the fake's optional per-component detail at coarse history resolutions.
    const inputs = ["macro.DTWEXBGS", "macro.DGS2", "macro.DGS10", "macro.BAMLH0A0HYM2", "positioning.funding",
      "positioning.stablecoins", "positioning.basis", "positioning.skew", "news.tone", "social.words"],
      attention = ["attention.gdelt", "attention.wikipedia", "attention.wikipedia_hourly", "attention.bluesky"], n = body.grid.attention.length;
    body.grid.parts = Object.fromEntries(inputs.map((name) => [name, Array.from({ length: n }, (_, i) => name === "news.tone" && t0 + i * step < middle ? null : 0)]));
    for (const name of attention) body.grid.parts[name] = Array.from({ length: n }, (_, i) => t0 + i * step >= middle ? null : 0.3);
    body.grid.attention = body.grid.attention.map((v, i) => t0 + i * step >= middle ? null : v);
    await route.fulfill({ response: original, json: body });
  });
  await open(page, fake, probe, view.hash);
  const button = page.locator("#ol-strip"), g = at(await layoutOf(page)), top = g.by + LABELS, frame = await pane.last();
  await expect(button).toHaveAttribute("data-coverage", "Limited data · Inputs 9–10/10 · Attention 0–4/4");
  const hatchAt = (x, y) => frame.rects.some((r) => r.fill === "pattern" && r.y === y && r.h > 0 && r.h <= FOOT && r.x <= x && x < r.x + r.w);
  expect(hatchAt(g.x + g.w / 4, top + 1)).toBe(true);
  expect(hatchAt(g.x + 3 * g.w / 4, top + 1)).toBe(false);
  expect(hatchAt(g.x + g.w / 4, top + BAND - 1 - FOOT)).toBe(false);
  expect(hatchAt(g.x + 3 * g.w / 4, top + BAND - 1 - FOOT)).toBe(true);
  await open(page, fake, probe, `${view.hash}&${REPLAY}&at=${iso(view.from + 0.4 * DAY)}`);
  await expect(button).toHaveAttribute("data-coverage", "Limited data · Inputs 9/10 · Attention 4/4");
});
