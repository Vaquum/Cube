"use strict";
// tests/support/strip.js: the fake cube's synthetic Strip, a cube-strip@2 answer (docs/strip.md) for any grid of the profile's time,
// so the page's Strip can be tested without field-data-api. It is SYNTHETIC and says so in its model: the forces' parts and attention
// are seeded walks; the events a fixed calendar of instants, dates and ranges, with seeded importance, certainty, reschedules and
// cancellations; the options a seeded term structure; DVOL a seeded walk; and the sources' freshness fixed times before the cutoff, one of
// them stale. Prices are never invented: the closes, the 24-hour changes, the measured moves and the jumps are read from the profile's own
// synthetic trades, so the strip agrees with the chart it is drawn under.
// The rules the bridge applies to a query (tools/strip_contract.py `request`) are repeated here, as the drift rule of docs/testing.md asks.
const { mulberry32, normal, subSeed } = require("./rng.js");
const { lowerBound } = require("./trades.js");
const { EPOCH_MS } = require("./profiles.js");

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000, GRID = 900000, HORIZON = 90 * DAY;
const STEPS = [900000, 3600000, 21600000, 86400000], MAX_POINTS = 20000;
const FORCES = ["macro", "positioning", "news", "social"];
const SOURCES = ["fred_macro_daily", "deribit_funding", "hyperliquid_funding", "defillama_stablecoins", "deribit_futures_basis", "deribit_options",
  "deribit_dvol", "gdelt_gkg", "bluesky_live", "wikimedia_daily", "wikimedia_hourly", "mempool_retarget"];
// Each force's parts, as the bridge names them.
const COMPONENTS = {
  "macro.DTWEXBGS": ["macro", "Dollar"], "macro.DGS2": ["macro", "2-year yield"], "macro.DGS10": ["macro", "10-year yield"],
  "macro.BAMLH0A0HYM2": ["macro", "High-yield spread"],
  "positioning.funding": ["positioning", "Perpetual funding"], "positioning.stablecoins": ["positioning", "Stablecoin supply"],
  "positioning.basis": ["positioning", "Futures basis"], "positioning.skew": ["positioning", "Options put skew"],
  "news.tone": ["news", "Tone of coverage"], "social.words": ["social", "Bullish against bearish words"],
};
const ATTENTION = { "attention.gdelt": ["News share", 0.5], "attention.wikipedia": ["Wikipedia, daily", 0.15],
  "attention.wikipedia_hourly": ["Wikipedia, hourly", 0.15], "attention.bluesky": ["Bluesky share", 0.2] };
// The calendar: every `every` days at the time of day (null for a date without an hour; `span` days for a range), counted from the
// epoch's day `phase`. A CPI is moved a day later, announced three days before, with probability MOVED; a Jobs release is cancelled
// two days before with probability CANCELLED.
const KINDS = {
  fomc: { name: "Fed FOMC decision", short: "FOMC", kind: "central_bank", family: "macro", every: 42, phase: 3, at: 18 * HOUR, window: 60, importance: "high", certainty: "confirmed" },
  cpi: { name: "US CPI inflation: headline and core", short: "CPI", kind: "inflation", family: "macro", every: 30, phase: 10, at: 12.5 * HOUR, window: 30, importance: "high", certainty: "confirmed" },
  jobs: { name: "US jobs report: payrolls, unemployment and wages", short: "Jobs", kind: "employment", family: "macro", every: 30, phase: 2, at: 12.5 * HOUR, window: 30, importance: "high", certainty: "confirmed" },
  ppi: { name: "US PPI producer-price inflation", short: "PPI", kind: "inflation", family: "macro", every: 30, phase: 12, at: 12.5 * HOUR, window: 30, importance: "medium", certainty: "confirmed" },
  gdp: { name: "US GDP", short: "GDP", kind: "growth", family: "macro", every: 91, phase: 20, at: 12.5 * HOUR, window: 30, importance: "medium", certainty: "tentative" },
  auction: { name: "US Treasury auction — 10-year note", short: "Auction", kind: "treasury_liquidity", family: "macro", every: 7, phase: 4, at: null, importance: "medium", certainty: "tentative" },
  holiday: { name: "Federal Reserve Banks holiday", short: "Holiday", kind: "banking_holiday", family: "macro", every: 14, phase: 6, at: null, importance: "low", certainty: "confirmed" },
  // 1 January 1970 was a Thursday: the epoch's day 1 is a Friday.
  expiry: { name: "Deribit BTC weekly expiry", short: "Expiry", kind: "bitcoin_derivatives", family: "positioning", every: 7, phase: 1, at: 8 * HOUR, window: 30, importance: "medium", certainty: "confirmed" },
  conference: { name: "Bitcoin conference", short: "Conf", kind: "bitcoin_conference", family: "news", every: 60, phase: 15, at: null, span: 3, importance: "high", certainty: "confirmed" },
};
const IMPORTANCE = { high: 1, medium: 0.35, low: 0 }, CERTAINTY = { confirmed: 1, tentative: 0.7, rule_derived: 0.7, unspecified: 0.7, estimate: 0.7 };
const MOVED = 0.2, CANCELLED = 0.15, MINUTES_A_YEAR = 365 * 24 * 60;

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

const round = (x, places = 4) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** places) / 10 ** places);

// The two-sided tail of a unit-variance Student t with three degrees of freedom at z, in bits (tools/strip_model.py tail_bits).
function tailBits(z) {
  const a = Math.abs(z);
  if (a === 0) return 0;
  const p = (2 * (Math.atan(1 / a) - a / (1 + a * a))) / Math.PI;
  return p <= 0 ? 60 : -Math.log2(p);
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
    const n = Math.max(0, (this.endMs - this.startMs) / GRID + 1), seed = this.seed, hour = (ms) => Math.floor(ms / HOUR) * HOUR;
    const walk = (label, theta, sd, start = 0) => {
      const next = mulberry32(subSeed(seed, "strip:" + label)), out = new Array(n);
      let x = start;
      for (let i = 0; i < n; i++) {
        x = x * (1 - theta) + normal(next, 0, sd);
        out[i] = x;
      }
      return out;
    };
    // Each part a walk of its own; a force is the sum of its parts that are known.
    this.parts = {
      "macro.DTWEXBGS": walk("macro.dollar", 0.002, 0.008), "macro.DGS2": walk("macro.y2", 0.002, 0.004),
      "macro.DGS10": walk("macro.y10", 0.002, 0.005), "macro.BAMLH0A0HYM2": walk("macro.hy", 0.002, 0.003),
      "positioning.funding": walk("positioning.funding", 0.01, 0.025), "positioning.stablecoins": walk("positioning.stable", 0.005, 0.01),
      "positioning.basis": walk("positioning.basis", 0.01, 0.008), "positioning.skew": walk("positioning.skew", 0.01, 0.008),
      "news.tone": walk("news", 0.03, 0.12), "social.words": walk("social", 0.05, 0.15),
    };
    // News has stretches nothing covered, and Social no history before its last week: the page must say so, never draw them as zero.
    const gaps = mulberry32(subSeed(seed, "strip:news-gaps"));
    for (let day = 0; day * 96 < n; day++) {
      if (gaps() < 0.15) for (let i = day * 96 + 24; i < Math.min(n, day * 96 + 48); i++) this.parts["news.tone"][i] = null;
    }
    for (let i = 0; i < Math.min(n, Math.max(0, n - 7 * 96)); i++) this.parts["social.words"][i] = null;
    // The basis and skew begin a day before the cutoff, as a fresh deployment's do.
    for (const name of ["positioning.basis", "positioning.skew"]) for (let i = 0; i < Math.min(n, Math.max(0, n - 96)); i++) this.parts[name][i] = null;
    this.close = Array.from({ length: n }, (_, i) => this.price(this.startMs + i * GRID));
    this.next24h = this.close.map((c, i) => {
      const t = this.startMs + i * GRID, later = t + DAY <= this.cutoffMs ? this.price(t + DAY) : null;
      return c && later ? (later / c - 1) * 100 : null;
    });
    this.dvol = walk("dvol", 0.01, 0.6, 0).map((v) => 42 + v);
    // Where each component's values stop being retrospective: six days before the cutoff, News from three, Social never yet.
    const live = hour(this.cutoffMs - 6 * DAY);
    this.retroUntil = Object.fromEntries([...Object.keys(COMPONENTS), ...Object.keys(ATTENTION)].map((name) => [name,
      name === "social.words" ? null : name === "news.tone" ? hour(this.cutoffMs - 3 * DAY) : live]));
    this.sources = Object.fromEntries([...SOURCES, "calendar"].map((name) => [name, {
      state: name === "wikimedia_hourly" ? "stale" : "ok", checkedAt: this.cutoffMs - (name === "wikimedia_hourly" ? 4 * HOUR : 2 * MINUTE),
      receivedAt: this.cutoffMs - 2 * MINUTE, intervalSeconds: 300, observedAt: name === "calendar" ? null : hour(this.cutoffMs) - HOUR,
      recordedFrom: live, detail: null,
    }]));
    this.events = this.calendar();
    this.moves = this.seriesMoves();
    this.jumps = this.findJumps();
    const calm = walk("attention", 0.02, 0.04);
    this.attention = calm.map((v, i) => {
      if (i < 2 * 96) return null; // attention against its recent normal needs some past first
      const t = this.startMs + i * GRID;
      let a = 0.3 + 0.25 * Math.max(0, v);
      for (const e of this.events) {
        const last = e.schedule[e.schedule.length - 1];
        if (last.weight >= 0.3 && last.at !== null && last.precision === "instant") a += 0.4 * Math.exp(-Math.abs(t - last.at) / (6 * HOUR));
      }
      for (const j of this.jumps) a += 0.5 * Math.exp(-Math.abs(t - j.at) / (3 * HOUR));
      return Math.min(1, a);
    });
    // The options: an hourly sample of the term structure from a day before the cutoff, with its put skew and put/call ratio.
    const quotes = mulberry32(subSeed(seed, "strip:options"));
    this.options = [];
    for (let t = hour(this.cutoffMs - DAY) + HOUR; t <= this.cutoffMs; t += HOUR) {
      const base = 40 + 4 * (quotes() - 0.5);
      this.options.push({ at: t, atm: { tomorrow_to_7d: round(base - 3 + 2 * quotes(), 3), "7_30d": round(base, 3), "30_90d": round(base + 1, 3),
        "90d_plus": round(base + 2, 3) }, skew: round(2 + quotes(), 3), putCall: round(0.5 + 0.2 * quotes(), 4) });
    }
  }

  // Every event of the calendar from the first grid time to 90 days past the cutoff: its schedule as it became known and, once its
  // window closed in the profile's trades, what it did.
  calendar() {
    const out = [], next = mulberry32(subSeed(this.seed, "strip:events")), first = Math.floor(this.startMs / DAY), last = Math.floor((this.cutoffMs + HORIZON) / DAY);
    for (let day = first; day <= last; day++)
      for (const [kind, spec] of Object.entries(KINDS)) {
        if ((((day - spec.phase) % spec.every) + spec.every) % spec.every !== 0) continue;
        const instant = spec.at !== null, at = day * DAY + (instant ? spec.at : 0);
        if (at < this.startMs || at > this.cutoffMs + HORIZON) continue;
        const id = `${kind}-${new Date(at).toISOString().slice(0, 10)}`, change = next(),
          precision = instant ? "instant" : spec.span ? "range" : "day", end = instant ? null : at + (spec.span ?? 1) * DAY,
          entry = (knownAt, when, status = "scheduled") => ({ knownAt, at: when, precision, end: when === null ? null : end, status,
            certainty: spec.certainty, importance: spec.importance, weight: round(IMPORTANCE[spec.importance] * CERTAINTY[spec.certainty], 3),
            ...(when === null ? { lastAt: at } : {}) }),
          schedule = [entry(Math.max(0, at - 180 * DAY), at)];
        // A change published before the cutoff is in the answer; one after it is not known yet, and the event keeps its date.
        if (kind === "cpi" && change < MOVED && at - 3 * DAY <= this.cutoffMs) schedule.push(entry(at - 3 * DAY, at + DAY));
        if (kind === "jobs" && change < CANCELLED && at - 2 * DAY <= this.cutoffMs) schedule.push(entry(at - 2 * DAY, null, "cancelled"));
        const final = schedule[schedule.length - 1];
        let measured = null;
        if (instant && final.at !== null && final.at + spec.window * MINUTE <= this.cutoffMs) {
          const before = this.price(final.at), after = this.price(final.at + spec.window * MINUTE),
            i = Math.floor((final.at - this.startMs) / GRID), sigma = i >= 0 && i < this.dvol.length ? this.dvol[i] : null;
          if (before && after) {
            const move = (after / before - 1) * 100, ordinary = sigma === null ? null : sigma * Math.sqrt(spec.window / MINUTES_A_YEAR);
            measured = { from: final.at, at: final.at + spec.window * MINUTE, move: round(move), bits: ordinary ? round(tailBits(move / ordinary), 3) : null,
              ordinary: ordinary === null ? null : round(ordinary), series: kind };
          }
        }
        out.push({ id, kind: spec.kind, family: spec.family, name: spec.name, short: spec.short, region: kind === "conference" ? "Global" : "United States",
          origin: "source", series: kind, link: "https://example.org/calendar/" + kind, window: instant ? spec.window : null, schedule, measured });
      }
    out.sort((a, b) => a.schedule[0].at - b.schedule[0].at || (a.id < b.id ? -1 : 1));
    return out;
  }

  // Each series' moves as they were measured, in time order, for the cards' counts at an edge: given once a series.
  seriesMoves() {
    const moves = {};
    for (const e of this.events) if (e.measured) (moves[e.series] = moves[e.series] || []).push([e.measured.at, e.measured.move]);
    for (const list of Object.values(moves)) list.sort((a, b) => a[0] - b[0]);
    return moves;
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
      out.push({ id: `jump-${m.at}`, at: m.at, window: 30, move: round(m.move), bits: round(tailBits(m.move / 0.35), 3) });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // The answer for a grid: each series' value at each grid time, the 15-minute value known at that time; the events with any scheduled
  // time from a day before the grid to 90 days past its end; the jumps and the options' samples inside it.
  answer({ from, to, step }) {
    const n = Math.ceil((to - from) / step), at = (series, t) => {
      if (t < this.startMs || t > this.endMs) return null;
      const v = series[Math.round((t - this.startMs) / GRID)];
      return v === null || v === undefined ? null : v;
    };
    // Every step is a whole number of 15-minute grid times, so each answer's time is one of the grid's.
    const take = (series, places = 4) => Array.from({ length: n }, (_, k) => round(at(series, from + k * step), places));
    const parts = Object.fromEntries(Object.keys(COMPONENTS).map((name) => [name, take(this.parts[name])]));
    const forces = Object.fromEntries(FORCES.map((f) => [f, Array.from({ length: n }, (_, k) => {
      const known = Object.entries(COMPONENTS).filter(([, c]) => c[0] === f).map(([name]) => parts[name][k]).filter((v) => v !== null);
      return known.length ? round(known.reduce((s, v) => s + v, 0)) : null;
    })]));
    const forceInputs = Object.fromEntries(FORCES.map((force) => {
      const components = Object.entries(COMPONENTS).filter(([, c]) => c[0] === force).map(([name]) => name);
      return [force, { components, masks: Array.from({ length: n }, (_, k) => components.reduce((mask, name, j) => mask + (parts[name][k] !== null ? 2 ** j : 0), 0)) }];
    }));
    const grid = { t0: from, step, forces, forceInputs, attention: take(this.attention), close: take(this.close, 2), next24h: take(this.next24h), dvol: take(this.dvol, 2) };
    if (n <= 3000) grid.parts = parts;
    const events = this.events.filter((e) => e.schedule.some((s) => (s.at ?? s.lastAt) >= from - DAY && (s.at ?? s.lastAt) < to + HORIZON));
    return {
      schema: "cube-strip@2",
      model: `fake-strip@2 SYNTHETIC seed ${this.seed} - not market data`,
      cutoff: this.cutoffMs,
      snapshot: { id: "f".repeat(64), publishedAt: this.cutoffMs - MINUTE, scheduledFor: this.cutoffMs - MINUTE },
      sources: this.sources,
      components: Object.fromEntries(Object.entries(COMPONENTS).map(([name, [force, label]]) => [name, { force, label, retroUntil: this.retroUntil[name] }])),
      attentionParts: Object.fromEntries(Object.entries(ATTENTION).map(([name, [label, weight]]) => [name, { label, weight, retroUntil: this.retroUntil[name] }])),
      grid,
      events,
      moves: Object.fromEntries([...new Set(events.map((e) => e.series))].sort().filter((s) => this.moves[s]).map((s) => [s, this.moves[s]])),
      jumps: this.jumps.filter((j) => j.at >= from && j.at < to),
      options: this.options.filter((o) => o.at >= from - DAY && o.at < to),
    };
  }
}

module.exports = { SyntheticStrip, StripError, stripRequest, tailBits, FORCES, SOURCES, STEPS, MAX_POINTS };
