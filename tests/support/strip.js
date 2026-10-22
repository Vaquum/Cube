"use strict";
// tests/support/strip.js: the fake cube's synthetic Strip, a cube-strip@1 answer (docs/strip.md) for any grid of the profile's time,
// so the page's Strip can be tested without Origo. It is SYNTHETIC and says so in its model: the forces and attention are seeded walks,
// the events a fixed calendar with seeded expectations. Prices are never invented: the closes, the 24-hour changes, the measured moves
// and the jumps are read from the profile's own synthetic trades, so the strip agrees with the chart it is drawn under.
// The rules the bridge applies to a query (tools/strip_relay.py `request`) are repeated here, as the drift rule of docs/testing.md asks.
const { mulberry32, normal, subSeed } = require("./rng.js");
const { lowerBound } = require("./trades.js");
const { EPOCH_MS } = require("./profiles.js");

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000, YEAR = 365.25 * DAY, GRID = 900000, HORIZON = 90 * DAY;
const STEPS = [900000, 3600000, 21600000, 86400000], MAX_POINTS = 20000;
const FORCES = ["macro", "positioning", "news", "social"];
// The calendar: every `every` days at the time of day, counted from the epoch's day `phase`; the prior is the window's expected move
// in percent from a year of history, as the contract states it.
const KINDS = {
  fomc: { name: "FOMC decision", short: "FOMC", family: "macro", every: 42, phase: 3, at: 18 * HOUR, window: 60, prior: 0.31 },
  cpi: { name: "Consumer Price Index", short: "CPI", family: "macro", every: 30, phase: 10, at: 12.5 * HOUR, window: 30, prior: 0.55 },
  jobs: { name: "Employment Situation", short: "Jobs", family: "macro", every: 30, phase: 2, at: 12.5 * HOUR, window: 30, prior: 0.57 },
  ppi: { name: "Producer Price Index", short: "PPI", family: "macro", every: 30, phase: 12, at: 12.5 * HOUR, window: 30, prior: 0.29 },
  // 1 January 1970 was a Thursday: the epoch's day 1 is a Friday.
  expiry: { name: "Deribit expiry", short: "Expiry", family: "positioning", every: 7, phase: 1, at: 8 * HOUR, window: 30, prior: 0.05 },
};
// The options' volatility the expiry ranges are read at, a year's fraction squared; and the ordinary spread of a 30-minute move.
const SIGMA = 0.4, ORDINARY_30M = 0.35;

class StripError extends Error {}

// The grid a query asks for, or a StripError naming the rule it breaks, in the bridge's words.
function stripRequest(args) {
  const whole = (name) => {
    const text = args[name]?.[0] ?? "";
    if (!/^-?\d{1,16}$/.test(text)) throw new StripError(`${name} must be a whole number of milliseconds`);
    return Number(text);
  };
  const from = whole("from"), to = whole("to"), step = whole("step");
  if (!STEPS.includes(step)) throw new StripError("step must be 900000, 3600000, 21600000 or 86400000");
  if (from < 0 || from % step) throw new StripError("from must be a multiple of step");
  if (to <= from) throw new StripError("to must be after from");
  if (Math.ceil((to - from) / step) > MAX_POINTS) throw new StripError(`more than ${MAX_POINTS} grid times`);
  return { from, to, step };
}

// The first Friday 08:00 UTC after a time: the epoch's day 1 is a Friday.
function nextExpiry(ms) {
  let day = Math.floor(ms / DAY);
  day += (((1 - day) % 7) + 7) % 7;
  if (day * DAY + 8 * HOUR <= ms) day += 7;
  return day * DAY + 8 * HOUR;
}

const round = (x, places = 4) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** places) / 10 ** places);

// The two-sided tail of Student's t with three degrees of freedom at t, and the surprise of a move of `move` percent against a spread
// `sd` (its standard deviation; the t's scale is sd / sqrt 3), in bits.
function tail3(t) {
  const u = Math.abs(t) / Math.sqrt(3);
  return Math.max(1e-12, 1 - (2 / Math.PI) * (Math.atan(u) + u / (1 + u * u)));
}
const surprise = (move, sd) => round(-Math.log2(tail3((move / sd) * Math.sqrt(3))), 3);

// A reaction's distribution: a two-piece t3 around 0, wider on the side the skew leans to, in 32 bins over four spreads either side;
// its p5, p50 and p95 read off the bins.
function reaction(charge, skew) {
  const left = Math.max(0.01, charge * (1 - 0.3 * skew)), right = Math.max(0.01, charge * (1 + 0.3 * skew)), reach = 4 * Math.max(left, right);
  const density = (x) => {
    const c = (x < 0 ? left : right) / Math.sqrt(3);
    return 1 / (c * (1 + (x * x) / (3 * c * c)) ** 2);
  };
  const n = 32, width = (2 * reach) / n, raw = [];
  for (let k = 0; k < n; k++) raw.push(density(-reach + (k + 0.5) * width));
  const total = raw.reduce((s, v) => s + v, 0);
  const bins = raw.map((v, k) => [round(-reach + k * width), round(-reach + (k + 1) * width), v / total]);
  const sum = bins.reduce((s, b) => s + b[2], 0);
  bins[n - 1][2] += 1 - sum; // the last bits of the float sum, so the probabilities sum to 1
  const at = (q) => {
    let acc = 0;
    for (const [a, b, p] of bins) {
      if (acc + p >= q) return round(a + ((q - acc) / p) * (b - a));
      acc += p;
    }
    return bins[n - 1][1];
  };
  return { p5: at(0.05), p50: at(0.5), p95: at(0.95), bins: bins.map(([a, b, p]) => [a, b, round(p, 9)]) };
}

class SyntheticStrip {
  // store: the profile's TradeStore (t in ms since 2021-01-01, the fake's own clock; price in cents); cutoffMs: what is known, on the
  // same clock; seed: the profile's seed. The strip itself speaks epoch ms, as the contract does.
  constructor({ store, cutoffMs, seed }) {
    this.store = store;
    this.cutoffMs = EPOCH_MS + cutoffMs;
    this.seed = seed;
    this.startMs = Math.ceil((EPOCH_MS + (store.length ? store.t[0] : cutoffMs)) / GRID) * GRID;
    this.endMs = Math.floor(this.cutoffMs / GRID) * GRID;
    this.build();
  }

  // The last trade's price at or before an epoch-ms time, in USDT; null before the first trade or after the cutoff.
  price(ms) {
    if (ms > this.cutoffMs) return null;
    const i = lowerBound(this.store.t, ms - EPOCH_MS + 1) - 1;
    return i >= 0 ? this.store.price[i] / 100 : null;
  }

  build() {
    const n = Math.max(0, (this.endMs - this.startMs) / GRID + 1), seed = this.seed;
    const walk = (label, theta, sd, start = 0) => {
      const next = mulberry32(subSeed(seed, "strip:" + label)), out = new Array(n);
      let x = start;
      for (let i = 0; i < n; i++) {
        x = x * (1 - theta) + normal(next, 0, sd);
        out[i] = x;
      }
      return out;
    };
    this.forces = {
      macro: walk("macro", 0.002, 0.02),
      positioning: walk("positioning", 0.01, 0.05),
      news: walk("news", 0.03, 0.12),
      social: walk("social", 0.05, 0.15),
    };
    // News has stretches nothing covered, and Social no history before its last week: the page must say so, never draw them as zero.
    const gaps = mulberry32(subSeed(seed, "strip:news-gaps"));
    for (let day = 0; day * 96 < n; day++) {
      if (gaps() < 0.15) for (let i = day * 96 + 24; i < Math.min(n, day * 96 + 48); i++) this.forces.news[i] = null;
    }
    const socialFrom = n - 7 * 96;
    for (let i = 0; i < Math.min(n, Math.max(0, socialFrom)); i++) this.forces.social[i] = null;
    this.close = Array.from({ length: n }, (_, i) => this.price(this.startMs + i * GRID));
    this.next24h = this.close.map((c, i) => {
      const t = this.startMs + i * GRID, later = t + DAY <= this.cutoffMs ? this.price(t + DAY) : null;
      return c && later ? (later / c - 1) * 100 : null;
    });
    this.events = this.calendar();
    this.jumps = this.findJumps();
    const calm = walk("attention", 0.02, 0.04);
    this.attention = calm.map((v, i) => {
      if (i < 2 * 96) return null; // attention against its recent normal needs some past first
      const t = this.startMs + i * GRID;
      let a = 0.3 + 0.25 * Math.max(0, v);
      for (const e of this.events) if (e.prior.charge >= 0.15) a += 0.4 * Math.exp(-Math.abs(t - e.at) / (6 * HOUR));
      for (const j of this.jumps) a += 0.5 * Math.exp(-Math.abs(t - j.at) / (3 * HOUR));
      return Math.min(1, a);
    });
  }

  // Every event of the calendar from the first grid time to 90 days past the cutoff, with what was expected of it and, once its window
  // closed, what it did.
  calendar() {
    const out = [], next = mulberry32(subSeed(this.seed, "strip:events")), first = Math.floor(this.startMs / DAY), last = Math.floor((this.cutoffMs + HORIZON) / DAY);
    for (let day = first; day <= last; day++)
      for (const [kind, spec] of Object.entries(KINDS)) {
        if ((((day - spec.phase) % spec.every) + spec.every) % spec.every !== 0) continue;
        const at = day * DAY + spec.at;
        if (at < this.startMs || at > this.cutoffMs + HORIZON) continue;
        const knownAt = Math.max(0, at - 180 * DAY), draw = next(), lean = next();
        const prior = { charge: spec.prior, from: "history", at: knownAt, skew: 0, reaction: reaction(spec.prior, 0), expiry: null };
        // The options estimate: two days before a past event, or at the cutoff for one up to 30 days ahead; none further out.
        const estimateAt = at - 2 * DAY <= this.cutoffMs ? at - 2 * DAY : at - this.cutoffMs <= 30 * DAY ? this.cutoffMs : null;
        let estimate = null;
        if (estimateAt !== null && estimateAt >= this.startMs) {
          const charge = round(spec.prior * (0.8 + 0.8 * draw), 3), skew = round((lean - 0.5) * 0.6, 3), spot = this.price(estimateAt);
          const expiryAt = nextExpiry(at), years = (expiryAt - estimateAt) / YEAR;
          estimate = {
            charge, from: "options", at: estimateAt, skew, reaction: reaction(charge, skew),
            expiry: spot && expiryAt > at ? {
              at: expiryAt,
              p5: round(spot * Math.exp(-0.5 * SIGMA ** 2 * years - 1.645 * SIGMA * Math.sqrt(years)), 1),
              p50: round(spot * Math.exp(-0.5 * SIGMA ** 2 * years), 1),
              p95: round(spot * Math.exp(-0.5 * SIGMA ** 2 * years + 1.645 * SIGMA * Math.sqrt(years)), 1),
              share: round(Math.min(1, charge ** 2 / (charge ** 2 + SIGMA ** 2 * years * 1e4))),
            } : null,
          };
        }
        const close = at + spec.window * MINUTE, before = this.price(at), after = close <= this.cutoffMs ? this.price(close) : null;
        const expected = estimate ?? prior, move = before && after ? (after / before - 1) * 100 : null;
        out.push({
          id: `${kind}-${new Date(at).toISOString().slice(0, 16).replace(/[-:T]/g, "")}`, kind, family: spec.family, name: spec.name, short: spec.short,
          at, knownAt, window: spec.window, prior, estimate,
          measured: move === null ? null : { move: round(move), bits: surprise(move, Math.max(0.01, expected.charge)), at: close },
        });
      }
    return out.sort((a, b) => a.at - b.at);
  }

  // The four largest 30-minute moves of the history that come to at least 0.5%, at least a day apart: what an unscheduled move with an
  // attention footprint stands in for here.
  findJumps() {
    const moves = [];
    for (let t = this.startMs; t + 30 * MINUTE <= this.cutoffMs; t += 30 * MINUTE) {
      const a = this.price(t), b = this.price(t + 30 * MINUTE);
      if (a && b) moves.push({ at: t, move: (b / a - 1) * 100 });
    }
    moves.sort((x, y) => Math.abs(y.move) - Math.abs(x.move));
    const out = [];
    for (const m of moves) {
      if (Math.abs(m.move) < 0.5 || out.length === 4) break;
      if (out.some((o) => Math.abs(o.at - m.at) < DAY)) continue;
      out.push({ id: `jump-${new Date(m.at).toISOString().slice(0, 16).replace(/[-:T]/g, "")}`, at: m.at, window: 30, move: round(m.move), bits: surprise(m.move, ORDINARY_30M) });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // The answer for a grid: each series' value at each grid time, the 15-minute value known at that time; the events from a day before
  // the grid to 90 days past its end; the jumps inside it.
  answer({ from, to, step }) {
    const n = Math.ceil((to - from) / step), at = (series, t) => {
      if (t < this.startMs || t > this.endMs) return null;
      const v = series[Math.round((t - this.startMs) / GRID)];
      return v === null || v === undefined ? null : v;
    };
    // Every step is a whole number of 15-minute grid times, so each answer's time is one of the grid's.
    const take = (series, places = 4) => Array.from({ length: n }, (_, k) => round(at(series, from + k * step), places));
    return {
      schema: "cube-strip@1",
      model: `fake-strip@1 SYNTHETIC seed ${this.seed} - not market data`,
      cutoff: this.cutoffMs,
      grid: {
        t0: from, step,
        forces: Object.fromEntries(FORCES.map((f) => [f, take(this.forces[f])])),
        attention: take(this.attention),
        close: take(this.close, 2),
        next24h: take(this.next24h),
      },
      events: this.events.filter((e) => e.at >= from - DAY && e.at < to + HORIZON),
      jumps: this.jumps.filter((j) => j.at >= from && j.at < to),
    };
  }
}

module.exports = { SyntheticStrip, StripError, stripRequest, reaction, tail3, FORCES, STEPS, MAX_POINTS };
