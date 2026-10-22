"use strict";
// B69 strip.spec.js (#193): the Strip under the price pane, on the fake cube's synthetic strip (tests/support/strip.js).
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
// docs/strip.md, Known-at: an event's time as known strictly before `ms` (undefined before its first entry, null once cancelled), and
// the expectation known then: the latest estimate before it, else a prior that rests on 30 releases or more.
const whenAt = (e, ms) => e.schedule.filter((s) => s.knownAt < ms).map((s) => s.at).pop();
const expectAt = (e, ms) => e.estimates.filter((x) => x.at < ms).pop() ?? (e.prior.at < ms && e.prior.n >= SUPPORT ? e.prior : null);
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
  // A lit event measured inside the history, from the fake's own calendar: lit by what was expected when its window opened. Macro
  // alone, so an unscheduled move (News) adds no seam of its own.
  const history = await (await fetch(`${fake.url}/cube/strip?from=${Math.floor((cutoff - 120 * DAY) / HOUR) * HOUR}&to=${Math.ceil(cutoff / HOUR) * HOUR}&step=${HOUR}&proto=2`)).json();
  const lit = (x) => x.family === "macro" && x.measured && (expectAt(x, x.measured.from)?.charge ?? 0) >= 0.15;
  const e = history.events.find((x) => lit(x) && x.measured.at < cutoff - 2 * DAY);
  expect(e, "the synthetic calendar has a lit, measured event").toBeTruthy();
  const [p0, p1] = info.priceBand.usdt, from = e.measured.from - DAY, to = e.measured.from + DAY;
  const hash = (edge) => `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&r=4,0&vis=2&rc=1&strip=forces.macro&replay=1&at=${iso(edge)}`;
  const seams = async (top) => (await pane.last()).strokes
    .filter((s) => s.width === 2 && s.path.length === 2 && s.path.every(([, y]) => y >= top && y <= top + BAND)).map((s) => s.path[0][0]).sort((a, b) => a - b);
  // The seams an edge allows: every lit Macro event in view whose window had closed strictly before it, where it closed.
  const expected = (edge, X) => history.events.filter((x) => lit(x) && x.measured.at < edge && x.measured.at >= from && x.measured.at <= to)
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
  const e = history.events.find((x) => x.kind === "cpi" && x.schedule.length === 2 && x.schedule[1].at !== null && x.measured && x.measured.at < cutoff - 2 * DAY);
  expect(e, "the synthetic calendar moved a CPI").toBeTruthy();
  const [first, moved] = e.schedule, [p0, p1] = info.priceBand.usdt, from = first.at - 4 * DAY, to = moved.at + DAY;
  const hash = (edge) => `#t=${iso(from)}~${iso(to)}&p=${p0}~${p1}&r=4,0&vis=2&rc=1&strip=forces.macro&replay=1&at=${iso(edge)}`;
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
  await expect(tip.locator(".ol-tip-sub").first()).not.toContainText("moved");
  // After the announcement, an hour past its first date: due a day later, and said to be moved.
  expect(whenAt(e, first.at + HOUR)).toBe(moved.at);
  await ahead(first.at + HOUR, moved.at);
  await expect(tip.locator(".ol-tip-sub").first()).toContainText("moved");
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
  const events = answer.events.map((e) => ({ ...e, at: whenAt(e, edge) })).filter((e) => e.at && e.at > view.from && e.at < edge);
  let x = g.x + g.w * 0.6;
  while (events.some((e) => Math.abs(xOf(e.at) - x) < 12)) x -= 13;
  await page.mouse.move(box.x + x, box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-forces");
  const ms = Math.round(view.from + ((x - g.x) / g.w) * (view.to - view.from)), T = trackRecord(history, ms, edge);
  if (T.near.length >= SUPPORT) {
    const down = T.near.filter((p) => p.r < 0).length / T.near.length, fell = down >= 0.5;
    await expect(tip.locator(".ol-strip-big")).toHaveText(`${fell ? "Fell" : "Rose"} in ${Math.round((fell ? down : 1 - down) * 100)}%`);
    expect(Number(await tip.locator('[data-field="trackShare"]').getAttribute("data-canonical"))).toBeCloseTo(fell ? down : 1 - down, 12);
    await expect(tip.locator(".ol-tip-sub").nth(1)).toContainText(`of ${T.near.length} moments`);
  } else {
    // Below the support floor: how many lay this near, and no figures.
    await expect(tip.locator(".ol-strip-big")).toHaveText("Too few");
    expect(Number(await tip.locator('[data-field="trackNear"]').getAttribute("data-canonical"))).toBe(T.near.length);
    await expect(tip.locator('[data-field="trackShare"]')).toHaveCount(0);
  }
  // The forces shown are the finest grid's at that time: the view's quarter hours here.
  await expect(tip.locator(".ol-tip-sub").first()).toContainText(`${FORCES.filter((f) => value(answer, answer.grid.forces[f], ms) !== null).length} of 4 forces known`);
  const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
  // An event behind the edge, its window closed: the move it made.
  const done = events.find((x) => x.measured && x.measured.at < edge && events.every((o) => o === x || Math.abs(xOf(o.at) - xOf(x.at)) > 12));
  expect(done, "a measured event stands alone in the week").toBeTruthy();
  await page.mouse.move(box.x + xOf(done.at), box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await expect(tip.locator(".ol-tip-head")).toHaveText(done.name);
  await expect(tip.locator(".ol-strip-big")).toHaveText(pct(done.measured.move));
  // An event ahead, in the horizon box beside the profile: its own move as the options last estimated it before the edge.
  const x0 = (await layoutOf(page))[7], width = 62, H = (ms) => x0 + (width * Math.log1p((ms - edge) / HOUR)) / Math.log1p((90 * DAY) / HOUR);
  const ahead = answer.events.map((x) => ({ ...x, at: whenAt(x, edge) })).filter((x) => x.at && x.at > edge && x.at <= edge + 90 * DAY);
  const next = ahead.find((x) => x.estimates.some((q) => q.at < edge) && ahead.every((o) => o === x || Math.abs(H(o.at) - H(x.at)) > 6));
  expect(next, "an estimated event stands alone in the horizon").toBeTruthy();
  const estimate = expectAt(next, edge);
  await page.mouse.move(box.x + H(next.at), box.y + y);
  await expect(tip).toHaveAttribute("data-presentation", "strip-event");
  await expect(tip.locator(".ol-tip-head")).toHaveText(next.name);
  await expect(tip.locator(".ol-strip-q3-value")).toHaveText([pct(estimate.reaction.p5), pct(estimate.reaction.p50), pct(estimate.reaction.p95)]);
  await expect(tip.locator(".ol-tip-note").first()).toContainText("Risk-neutral spread from option prices");
});
