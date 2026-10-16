"use strict";
// Oracles: Mill's /discover answers on real 1-hour bars, recorded from its endpoint (tests/fixtures/features/*.json), and
// a manifest YAML that PyYAML reads back as exactly the recorded manifest and Limen's validator accepts (both checked with
// limen 3.15.2 when it was recorded).
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const api = require("../../src/features.js");
const events = require("../fixtures/features/events.json"), description = require("../fixtures/features/description.json");
const research = api.researchSpan({data_window: {start: "2024-01-01", end: "2026-05-15"}});
const at = (s) => Date.parse(s), w = (a, b) => ({startMs: at(a), endMs: at(b)});

test("Mill's research window is half open and includes its last day", () => {
  assert.deepEqual(research, [at("2024-01-01T00:00:00Z"), at("2026-05-16T00:00:00Z")]);
  assert.equal(api.researchSpan(null), null);
});

test("a request never reaches outside Mill's research window or past the chart's cutoff", () => {
  const base = {bar: "1h_time_bars", mode: "inside", lead: 4, pool: {kind: "catalog"}, research};
  const edge = at("2025-06-01T00:00:00Z"), view = [at("2025-05-20T00:00:00Z"), at("2025-06-10T00:00:00Z")];
  const marked = [w("2025-05-25T00:00:00Z", "2025-05-25T12:00:00Z")];
  assert.match(api.request({...base, windows: [w("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z")], against: "research", view, edge: Infinity}).error,
    /outside Mill's research window, 2024-01-01 to 2026-05-15/);
  // Against the whole window, the compared span ends at the cutoff; the returned series covers the view inside it.
  const whole = api.request({...base, windows: marked, against: "research", view, edge}).body;
  assert.deepEqual(whole.context, {start: "2024-01-01T00:00:00Z", end: "2025-06-01T00:00:00Z"});
  assert.deepEqual(whole.display, {start: "2025-05-20T00:00:00Z", end: "2025-06-01T00:00:00Z"});
  assert.deepEqual(whole.windows, [{start: "2025-05-25T00:00:00Z", end: "2025-05-25T12:00:00Z"}]);
  assert.deepEqual(api.request({...base, windows: marked, against: "view", view, edge}).body.context, {start: "2025-05-20T00:00:00Z", end: "2025-06-01T00:00:00Z"});
  // A window wholly after the cutoff has no bar to mark, and no window is no request.
  assert.match(api.request({...base, windows: [w("2025-06-05T00:00:00Z", "2025-06-06T00:00:00Z")], against: "research", view, edge}).error, /No marked window lies inside/);
  assert.match(api.request({...base, windows: [], against: "research", view, edge}).error, /Add at least one window/);
  assert.match(api.request({...base, windows: marked, against: "view", view: [at("2026-07-01T00:00:00Z"), at("2026-08-01T00:00:00Z")], edge: Infinity}).error,
    /The visible time lies outside Mill's research window/);
});

test("a leader's points sit at their buckets' ends, and a partial last bucket at the display's end", () => {
  const series = events.candidates[0].series, end = at("2025-03-08T00:00:00Z");
  const points = api.points(series, end), first = series.values.findIndex((v) => v !== null);
  assert.equal(points.length, series.values.filter((v) => v !== null).length);
  assert.equal(points[0].ms, series.t0 + (first + 1) * series.step_ms);
  assert.ok(points.every((p, i) => i === 0 || p.ms > points[i - 1].ms) && points[points.length - 1].ms <= end);
  assert.deepEqual(api.points({t0: 0, step_ms: 10, bucket_bars: 2, values: [1, null, 3]}, 25), [{ms: 10, value: 1}, {ms: 25, value: 3}]);
  assert.deepEqual(api.points(null, 0), []);
});

test("the chance line says what the shifted windows can and cannot show", () => {
  assert.match(api.chanceText(events), /^Across 8593 shifted labelings, a column is beyond chance when it separates by more than 0\.171,/);
  assert.match(api.chanceText(events), /A column defined on fewer than 30 windows has no interval\.$/);
  assert.match(api.chanceText(description), /^One window describes, it does not test: /);
  assert.equal(api.chanceText({...description, chance: {...description.chance, shifts: 2, critical: null}}),
    "One window describes, it does not test: a slow level separates any contiguous window from its surroundings. 2 shifted labelings are too few for any column to be beyond chance.");
});

test("a fitted rule copies as the YAML that reads back as Mill's manifest", () => {
  const golden = fs.readFileSync(path.join(__dirname, "../fixtures/features/manifest.yaml"), "utf8");
  assert.equal(api.manifestYaml(events.candidates[0].rule.manifest), golden);
});

test("YAML scalars keep their types: exponent floats, quoted look-alikes, plain names and empty collections", () => {
  assert.equal(api.manifestYaml({a: 1e-7, b: 1e21, c: 2.5, d: "yes", e: "2024-01-01", f: "plain_name", g: null, h: true, i: [], j: {}, k: "{threshold}"}),
    'a: 1.0e-7\nb: 1.0e+21\nc: 2.5\nd: "yes"\ne: "2024-01-01"\nf: plain_name\ng: null\nh: true\ni: []\nj: {}\nk: "{threshold}"\n');
});
