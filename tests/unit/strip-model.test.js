"use strict";
// U103: the Strip's model (tools/strip_model.py): each evidence formula, the first-seen and retrospective rules, the calendar's
// revisions, and the labels. Oracles: the formulas of docs/strip.md written again here in JavaScript and run on the same hand-made
// inputs, and hand-counted expectations for the store's rules. The Python runs in one process; nothing reaches a network.
const {test} = require("node:test"), assert = require("node:assert/strict"), {spawnSync} = require("node:child_process"), path = require("node:path");

const HOUR = 3600000, DAY = 86400000, T = 1792713600000; // 2026-10-23T00:00:00Z

function python(script, input) {
  const run = spawnSync("python3", ["-c", "import json, sys\nsys.path.insert(0, 'tools')\nimport strip_model as m\nI = json.load(sys.stdin)\n" + script],
    {cwd: path.resolve(__dirname, "../.."), input: JSON.stringify(input), encoding: "utf8", timeout: 30000});
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const tanh = Math.tanh, mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length, pstdev = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test("macro: a FRED series' 5-observation change against its single-observation changes, up a headwind", () => {
  // 30 daily values that wander: rows are (observed, known, retro, value, extra).
  const values = Array.from({length: 30}, (_, i) => 4 + 0.02 * Math.sin(i) + 0.003 * i), rows = values.map((v, i) => [T + i * DAY, T + i * DAY + 22 * HOUR, 0, v, null]);
  const out = python("e = m.macro_evidence('DGS10', [tuple(r) for r in I])\nprint(json.dumps({'known': e.known, 'value': e.value, 'stale': e.stale_ms}))", rows);
  const expected = [];
  for (let i = 5; i < values.length; i++) {
    const steps = []; for (let k = Math.max(1, i - 59); k <= i; k++) steps.push(values[k] - values[k - 1]);
    if (steps.length < 10) continue;
    expected.push([rows[i][1], -0.5 * tanh(((values[i] - values[i - 5]) / (pstdev(steps) * Math.sqrt(5))) / 2)]);
  }
  assert.deepEqual(out.known, expected.map((e) => e[0]));
  out.value.forEach((v, k) => assert.ok(close(v, expected[k][1], 1e-6), `${v} for ${expected[k][1]}`));
  assert.equal(out.stale, 6 * DAY);
});

test("positioning: funding of both venues averaged by the hour against its trailing 30 days, longs paying a lean up", () => {
  const deribit = Array.from({length: 40}, (_, i) => [T + i * HOUR, T + i * HOUR + 60000, 0, 5 + Math.sin(i / 3), null]);
  const hyper = Array.from({length: 40}, (_, i) => [T + i * HOUR + 14, T + i * HOUR + 60000, 0, 6 + Math.cos(i / 4), null]);
  const out = python("e = m.funding_evidence([tuple(r) for r in I[0]], [tuple(r) for r in I[1]])\nprint(json.dumps({'known': e.known, 'value': e.value}))", [deribit, hyper]);
  const avg = deribit.map((r, i) => (r[3] + hyper[i][3]) / 2), expected = [];
  for (let i = 24; i < avg.length; i++) {
    const hist = avg.slice(0, i), z = (avg[i] - mean(hist)) / pstdev(hist);
    expected.push(0.6 * tanh(z / 2));
  }
  assert.equal(out.value.length, expected.length);
  out.value.forEach((v, k) => assert.ok(close(v, expected[k], 1e-6), `${v} for ${expected[k]}`));
});

test("social: bullish against bearish words over the trailing day, once there are enough of both", () => {
  // One sample a quarter hour: 2 mentions and alternating words; the threshold is 10 mentions and 3 words.
  const rows = Array.from({length: 12}, (_, i) => [T + i * 900000, T + i * 900000 + 60000, 0, null,
    JSON.stringify({bitcoin_creates: 2, bullish_word_matches: i % 2, bearish_word_matches: i % 3 === 0 ? 1 : 0, dictionary: "v1"})]);
  const out = python("e = m.social_evidence([tuple(r) for r in I])\nprint(json.dumps({'known': e.known, 'value': e.value}))", rows);
  const expected = [];
  let mentions = 0, bull = 0, bear = 0;
  rows.forEach((r, i) => {
    const x = JSON.parse(r[4]); mentions += x.bitcoin_creates; bull += x.bullish_word_matches; bear += x.bearish_word_matches;
    if (mentions >= 10 && bull + bear >= 3) expected.push([r[1], 0.8 * (bull - bear) / (bull + bear + 5)]);
  });
  assert.deepEqual(out.known, expected.map((e) => e[0]));
  out.value.forEach((v, k) => assert.ok(close(v, expected[k][1]), `${v} for ${expected[k][1]}`));
});

test("news: the day's tone against the daily tone of the trailing 30 days, needing five days and ten articles", () => {
  // Eight days of four batches a day, each with 3 scored articles; the last day is calmer.
  const rows = [];
  for (let d = 0; d < 8; d++) for (let b = 0; b < 4; b++) {
    const at = T + d * DAY + b * 6 * HOUR;
    rows.push([at, at + 15 * 60000, 0, d === 7 ? 0.5 : -1 + 0.2 * Math.sin(d + b), JSON.stringify({tone_scored_articles: 3})]);
  }
  const out = python("e = m.news_evidence([tuple(r) for r in I])\nprint(json.dumps({'known': e.known, 'value': e.value}))", rows);
  const daily = [];
  for (let d = 0; d < 8; d++) daily.push([T + d * DAY, mean(rows.filter((r) => r[0] >= T + d * DAY && r[0] < T + (d + 1) * DAY).map((r) => r[3]))]);
  const expected = [];
  rows.forEach((r) => {
    const inside = rows.filter((q) => q[0] > r[0] - DAY && q[0] <= r[0]), count = 3 * inside.length;
    const normal = daily.filter(([d]) => d + DAY <= r[0]).slice(-30).map(([, t]) => t);
    if (count < 10 || normal.length < 5) return;
    expected.push([r[1], 0.6 * tanh((mean(inside.map((q) => q[3])) - mean(normal)) / pstdev(normal) / 2)]);
  });
  assert.ok(expected.length > 0);
  assert.deepEqual(out.known, expected.map((e) => e[0]));
  out.value.forEach((v, k) => assert.ok(close(v, expected[k][1], 1e-6), `${v} for ${expected[k][1]}`));
});

test("attention: Wikipedia's readers against the median of the trailing 30 days, 0.3 ordinary and a quarter a doubling", () => {
  const views = [2000, 2100, 1900, 2050, 1950, 2000, 2020, 4000, 1000];
  const rows = views.map((v, i) => [T + i * DAY, T + i * DAY + 27 * HOUR, 0, v, null]);
  const out = python("e = m.attention_evidence([], [tuple(r) for r in I], [], [])['attention.wikipedia']\nprint(json.dumps({'value': e.value}))", rows);
  const expected = [];
  for (let i = 6; i < views.length; i++) expected.push(Math.max(0, Math.min(1, 0.3 + 0.25 * Math.log2(views[i] / median(views.slice(0, i))))));
  out.value.forEach((v, k) => assert.ok(close(v, expected[k]), `${v} for ${expected[k]}`));
  assert.equal(out.value.length, 3);
});

test("the store keeps each observation as first seen; a source's first window is retrospective, known when its source makes it public", () => {
  const out = python(String.raw`
st = m.Store(); md = m.Model(st)
P1, P2 = 1792750000000, 1792750300000
rec = lambda i, v: {'id': f'w:{i}', 'kind': 'pageviews_day', 'values': {'views': v}, 'observed_at': m.iso_day(1792713600000 - (3 - i) * 86400000), 'time_precision': 'day'}
md.ingest('wikimedia_daily', 'd1', [rec(0, 10), rec(1, 11), rec(2, 12)], {}, m.iso(P1 - 1000), P1, 21600000)
md.ingest('wikimedia_daily', 'd2', [rec(1, 99), rec(2, 12), rec(3, 13)], {}, m.iso(P2 - 1000), P2, 21600000)
again = md.ingest('wikimedia_daily', 'd2', [rec(4, 1)], {}, m.iso(P2), P2, 21600000)
print(json.dumps({'rows': st.rows('wiki_day'), 'again': again, 'seen': st.seen('wikimedia_daily')}))`, null);
  const P1 = 1792750000000, P2 = 1792750300000;
  // The first dataset's window: each day known at the rule (the next day, 03:00), all before the publication, so retrospective.
  assert.deepEqual(out.rows.slice(0, 3).map((r) => [r[1], r[2]]), [0, 1, 2].map((i) => [1792713600000 - (3 - i) * DAY + DAY + 3 * HOUR, 1]));
  // A later dataset's new day is live, known at its publication; a value seen again is never replaced, whatever it says now.
  assert.deepEqual([out.rows[3][1], out.rows[3][2], out.rows[3][3]], [P2, 0, 13]);
  assert.equal(out.rows[1][3], 11);
  assert.equal(out.again, 0);
  assert.deepEqual(out.seen, [P1, P2]);
});

test("the calendar's revisions become schedule entries; a date stays a date; a withdrawn event leaves no cancellation behind", () => {
  const out = python(String.raw`
st = m.Store(); md = m.Model(st)
def ev(i, sched, rev, status='scheduled', certainty='confirmed', importance='high'):
    return {'id': f'e{i}', 'values': {'title': 'US CPI inflation: headline and core', 'category': 'inflation', 'origin': 'source', 'status': status,
            'schedule': sched, 'schedule_certainty': certainty, 'context': {'importance': importance, 'region': 'United States', 'source_id': 'US-CPI'}},
            'metadata': {'revision_id': rev}}
a = ev(1, {'kind': 'instant', 'at': '2026-11-10T13:30:00Z'}, 'r1')
b = ev(2, {'kind': 'date', 'date': '2026-11-20'}, 'r2', certainty='tentative', importance='medium')
md.ingest_calendar('c1', [a, b], 1000)
md.ingest_calendar('c2', [ev(1, {'kind': 'instant', 'at': '2026-11-11T13:30:00Z'}, 'r1b')], 2000)
events = {e['id']: e for e in m.build_events(st, [], {})}
print(json.dumps({'e1': events['e1'], 'e2': events['e2'], 'labels': [m.short_label(t, r, c) for t, r, c in I]}))`,
    [["US CPI inflation: headline and core", "United States", "inflation"], ["UK consumer price inflation", "United Kingdom", "inflation"],
      ["Fed FOMC decision", "United States", "central_bank"], ["Bank of Canada policy decision", "Canada", "central_bank"],
      ["Bitcoin Amsterdam 2026", "Global", "bitcoin_conference"], ["Federal Reserve Banks holiday — Thanksgiving", "United States", "banking_holiday"]]);
  const at = (s) => Date.parse(s);
  // Moved a day, known from the second calendar on; the light of a confirmed high-importance release is 1.
  assert.deepEqual(out.e1.schedule.map((s) => [s.knownAt, s.at, s.precision, s.weight]),
    [[1000, at("2026-11-10T13:30:00Z"), "instant", 1], [2000, at("2026-11-11T13:30:00Z"), "instant", 1]]);
  assert.equal(out.e1.window, 30);
  assert.equal(out.e1.short, "CPI");
  // A date with no hour stays a whole day; a tentative medium event gives 0.35 x 0.7 of the light.
  assert.deepEqual(out.e2.schedule[0], {knownAt: 1000, at: at("2026-11-20T00:00:00Z"), precision: "day", end: at("2026-11-21T00:00:00Z"),
    status: "scheduled", certainty: "tentative", importance: "medium", weight: 0.245});
  assert.equal(out.e2.window, null);
  // Missing from the second calendar: withdrawn from then on, with no time; its first entry is untouched.
  assert.deepEqual([out.e2.schedule[1].knownAt, out.e2.schedule[1].status, out.e2.schedule[1].at], [2000, "withdrawn", null]);
  assert.deepEqual(out.labels, ["CPI", "UK CPI", "FOMC", "BoC", "Conf", "Holiday"]);
});

test("a sample is the latest value known at or before each time, and nothing once it is stale", () => {
  const out = python("e = m.Evidence.of('x', [(10, 1.0, None), (20, 2.0, None)], 5)\nprint(json.dumps(e.sample([5, 10, 14, 15, 16, 20, 25, 26])))", null);
  assert.deepEqual(out, [null, 1, 1, 1, null, 2, 2, null]);
});
