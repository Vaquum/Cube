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

test("long history carries exact contributing-input masks, including measured zero and stale components", () => {
  const out=python(String.raw`
import copy, strip_contract as c
t=I['T'];end=t+4001*m.HOUR
s=m.build_state(m.Store(),m.Prices([],None),{'id':None,'publishedAt':None},{},end)
s.components={'macro.DGS2':m.Evidence.of('macro.DGS2',[(t,0,None)],3*m.HOUR),
              'macro.DGS10':m.Evidence.of('macro.DGS10',[(t+2*m.HOUR,0.1,None)],3*m.HOUR)}
a=json.loads(s.answer(t,end,m.HOUR));c.check(a,t,end,m.HOUR)
failures=[]
for bad in ['mask','availability','component']:
    b=copy.deepcopy(a);part=b['grid']['forceInputs']['macro']
    if bad=='mask':part['masks'][0]=4
    elif bad=='availability':part['masks'][0]=0
    else:part['components'][0]='social.words'
    try:c.check(b,t,end,m.HOUR)
    except ValueError:failures.append(bad)
print(json.dumps({'names':a['grid']['forceInputs']['macro']['components'],
                  'masks':a['grid']['forceInputs']['macro']['masks'][:7],
                  'detail':'parts' in a['grid'],'failures':failures}))`,{T});
  assert.deepEqual(out.names,['macro.DGS2','macro.DGS10']);
  assert.deepEqual(out.masks,[1,1,3,3,2,2,0]);
  assert.equal(out.detail,false);
  assert.deepEqual(out.failures,['mask','availability','component']);
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

test("news: the normal is the daily tone of the 30 complete days before, skipping days of fewer than ten articles", () => {
  // 45 days of four batches; every seventh day is thin (two articles in all), so it has no daily tone of its own.
  const rows = [];
  for (let d = 0; d < 45; d++) for (let b = 0; b < 4; b++) {
    const at = T + d * DAY + b * 6 * HOUR, thin = d % 7 === 3;
    rows.push([at, at + 15 * 60000, 0, -1 + 0.3 * Math.sin(d * 1.7 + b), JSON.stringify({tone_scored_articles: thin ? (b < 2 ? 1 : 0) : 3})]);
  }
  const out = python("e = m.news_evidence([tuple(r) for r in I])\nprint(json.dumps({'known': e.known, 'value': e.value}))", rows);
  const scored = rows.filter((r) => JSON.parse(r[4]).tone_scored_articles > 0), n = (r) => JSON.parse(r[4]).tone_scored_articles;
  const daily = [];
  for (let d = 0; d < 45; d++) {
    const day = scored.filter((r) => r[0] >= T + d * DAY && r[0] < T + (d + 1) * DAY), total = day.reduce((s, r) => s + n(r), 0);
    if (total >= 10) daily.push([T + d * DAY, day.reduce((s, r) => s + r[3] * n(r), 0) / total]);
  }
  const expected = [];
  scored.forEach((r) => {
    const inside = scored.filter((q) => q[0] > r[0] - DAY && q[0] <= r[0]), count = inside.reduce((s, q) => s + n(q), 0);
    const last = r[0] - ((r[0] - T) % DAY) - DAY, normal = daily.filter(([d]) => d >= last - 29 * DAY && d <= last).map(([, t]) => t);
    if (count < 10 || normal.length < 5) return;
    expected.push([r[1], 0.6 * tanh((inside.reduce((s, q) => s + q[3] * n(q), 0) / count - mean(normal)) / pstdev(normal) / 2)]);
  });
  // From day 33 on, the 30 complete days hold fewer than 30 daily tones, and the 30 latest tones would reach further back.
  assert.ok(expected.length > 100);
  assert.deepEqual(out.known, expected.map((e) => e[0]));
  out.value.forEach((v, k) => assert.ok(close(v, expected[k][1], 1e-9), `${v} for ${expected[k][1]}`));
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

test("an explicit later backfill adds retrospective history without rewriting the first live observation", () => {
  const out=python(String.raw`
st=m.Store();model=m.Model(st);t=I['T']
def row(identity,at,value):return {'id':identity,'observed_at':m.iso(at),'values':{'interest_1h':value}}
model.ingest('deribit_funding','live',[row('live',t,0.00001)],{},m.iso(t),t,m.HOUR)
model.ingest('deribit_funding','backfill',[row('past',t-30*m.DAY,0.00002),row('live',t,0.00099)],{},
             m.iso(t+m.HOUR),t+m.HOUR,m.HOUR,retrospective=True)
model.ingest('deribit_funding','delayed-live',[row('late',t+30*m.MINUTE,0.00003)],{},m.iso(t+2*m.HOUR),t+2*m.HOUR,m.HOUR)
model.ingest('deribit_funding','expanded-native',[row('expanded',t-60*m.DAY,0.00004)],{},m.iso(t+3*m.HOUR),t+3*m.HOUR,m.HOUR)
print(json.dumps({identity:[at,known,retro,value] for identity,at,known,retro,value in
    st.db.execute('SELECT obs_id,observed_ms,known_ms,retro,value FROM obs')}))`,{T});
  assert.deepEqual(out.past.slice(0,3),[T-30*DAY,T-30*DAY,1]);
  assert.deepEqual(out.live.slice(0,3),[T,T,0]);
  assert.ok(close(out.live[3],8.76));
  assert.deepEqual(out.late.slice(0,3),[T+1800000,T+2*HOUR,0]);
  assert.deepEqual(out.expanded.slice(0,3),[T-60*DAY,T-60*DAY,1]);
});

test("continuous social minutes wait for completion and exclude cursor gaps before their counts become first-seen", () => {
  const out=python(String.raw`
st=m.Store();model=m.Model(st);t=I['T'];meta={'source_metadata':{'mode':'continuous_checkpointed'}}
def row(identity,at,count,full=False,gap=False):
    return {'id':identity,'observed_at':m.iso(at),'values':{'creates':count,'bitcoin_creates':count,
        'bullish_word_matches':count,'bearish_word_matches':0},'metadata':{'interval_end':m.iso(at+m.MINUTE),
        'full_minute_connection_coverage':full,'cursor_gap_overlap':gap,'connected_seconds':60 if full else 10}}
first=model.ingest('bluesky_live','partial',[row('one',t,1)],meta,m.iso(t+10000),t+10000,300000)
second=model.ingest('bluesky_live','complete',[row('one',t,20,True),row('two',t+m.MINUTE,2),
    row('gap',t-2*m.MINUTE,1000,True,True)],meta,m.iso(t+2*m.MINUTE),t+2*m.MINUTE,300000)
third=model.ingest('bluesky_live','next',[row('one',t,999,True),row('two',t+m.MINUTE,30,True)],meta,
                   m.iso(t+3*m.MINUTE),t+3*m.MINUTE,300000)
legacy=model.ingest('bluesky_live','legacy',[row('bounded',t-10*m.MINUTE,5)],{},m.iso(t),t,300000)
print(json.dumps({'counts':[first,second,third,legacy],
                 'rows':{identity:[known,json.loads(extra)] for identity,known,extra in st.db.execute('SELECT obs_id,known_ms,extra FROM obs')}}))`,{T});
  assert.deepEqual(out.counts,[0,1,1,1]);
  assert.equal(out.rows.one[0],T+120000);
  assert.equal(out.rows.one[1].creates,20);
  assert.equal(out.rows.two[1].creates,30);
  assert.equal(out.rows.one[1].full_minute_connection_coverage,true);
  assert.equal(out.rows.gap,undefined);
  assert.equal(out.rows.bounded[1].creates,5);
});

test("a reconstructed gap after live collection keeps its retrospective label until the next live row", () => {
  const out=python(String.raw`
st=m.Store();model=m.Model(st);t=I['T']
def row(identity,at):return {'id':identity,'observed_at':m.iso(at),'values':{'interest_1h':0.00001}}
model.ingest('deribit_funding','initial',[row('first',t)],{},m.iso(t),t,m.HOUR)
model.ingest('deribit_funding','gap',[row('recovered',t+m.DAY)],{},m.iso(t+3*m.DAY),t+3*m.DAY,m.HOUR,retrospective=True)
before=[st.retro_until('funding:deribit'),m._retro_until(st.rows('funding:deribit'))]
model.ingest('deribit_funding','new-live',[row('latest',t+4*m.DAY)],{},m.iso(t+4*m.DAY),t+4*m.DAY,m.HOUR)
after=[st.retro_until('funding:deribit'),m._retro_until(st.rows('funding:deribit'))]
other=[(t,t,1,0.1,None)]
combined=m.funding_evidence(st.rows('funding:deribit'),other).retro_until
print(json.dumps({'before':before,'after':after,'mixedVenueBoundary':combined}))`,{T});
  assert.deepEqual(out.before,[null,null]);
  assert.deepEqual(out.after,[T+4*DAY,T+4*DAY]);
  assert.equal(out.mixedVenueBoundary,null);
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

test("an answer gives each of its events' series' measured moves once, in time order, the latest 500", () => {
  // Two CPI releases and a PPI one; the answer's window holds only the second CPI, so the PPI's moves stay out and both CPI moves are in.
  const out = python(String.raw`
import strip_contract as c
st = m.Store(); md = m.Model(st)
def ev(i, at, source):
    return {'id': f'e{i}', 'values': {'title': 'US CPI inflation: headline and core', 'category': 'inflation', 'origin': 'source', 'status': 'scheduled',
            'schedule': {'kind': 'instant', 'at': at}, 'schedule_certainty': 'confirmed', 'context': {'importance': 'high', 'region': 'United States', 'source_id': source}},
            'metadata': {'revision_id': f'r{i}'}}
md.ingest_calendar('c1', [ev(1, '2026-09-10T12:30:00Z', 'US-CPI'), ev(2, '2026-10-10T12:30:00Z', 'US-CPI'), ev(3, '2027-06-10T12:30:00Z', 'US-PPI')], 1000)
for eid, start, move, series in I['reactions']:
    md.record_reaction(eid, {'from': start, 'at': start + 1800000, 'move': move, 'series': series, 'ordinary': None, 'bits': None})
state = m.build_state(st, m.Prices([], None), {'id': None, 'publishedAt': None}, {}, I['now'])
answer = json.loads(state.answer(I['start'], I['end'], I['step']))
c.check(answer, I['start'], I['end'], I['step'])
capped = m.series_moves({f'x{i}': {'series': 's', 'at': 600 - i, 'move': 0.1} for i in range(600)})['s']
print(json.dumps({'events': [e['id'] for e in answer['events']], 'keys': sorted({k for e in answer['events'] for k in e}), 'moves': answer['moves'],
                  'capped': [len(capped), capped[0][0], capped[-1][0]]}))`,
    {reactions: [["e2", Date.parse("2026-10-10T12:30:00Z"), -0.25, "US-CPI"], ["e1", Date.parse("2026-09-10T12:30:00Z"), 0.5, "US-CPI"],
      ["e9", Date.parse("2026-08-10T12:30:00Z"), 1.5, "US-PPI"]],
    now: Date.parse("2026-10-23T00:00:00Z"), start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-10-20T00:00:00Z"), step: HOUR});
  assert.deepEqual(out.events, ["e2"]);
  assert.ok(!out.keys.includes("history"), "an event carries no moves of its own");
  assert.deepEqual(out.moves, {"US-CPI": [[Date.parse("2026-09-10T13:00:00Z"), 0.5], [Date.parse("2026-10-10T13:00:00Z"), -0.25]]});
  // 600 moves: the latest 500, in time order.
  assert.deepEqual(out.capped, [500, 101, 600]);
});

test("a build after new rows, in order or not, gives what a build from nothing gives", () => {
  // Frequent rows (Bluesky every five minutes, GDELT every 15, options hourly) are computed again only from where they changed:
  // each step's build with the kept cache must equal a fresh build over the same store.
  const out = python(String.raw`
import random
rnd = random.Random(I['seed'])
st = m.Store()
HOUR, DAY, MIN = m.HOUR, m.DAY, m.MINUTE
T = I['T']
def put(t0, t1, retro=0):
    for t in range(t0, t1, 5 * MIN):
        if rnd.random() < 0.9:
            st.db.execute("INSERT INTO obs VALUES ('bluesky', ?, ?, ?, ?, NULL, ?)", (f'b{t}', t + rnd.randint(0, 60000), t + 2 * MIN, retro,
                json.dumps({'creates': rnd.randint(200, 900), 'bitcoin_creates': rnd.randint(0, 9), 'bullish_word_matches': rnd.randint(0, 3),
                            'bearish_word_matches': rnd.randint(0, 3), 'dictionary': 'v1'})))
    for t in range(t0, t1, 15 * MIN):
        if rnd.random() < 0.85:
            thin = (t // DAY) % 7 == 3
            st.db.execute("INSERT INTO obs VALUES ('gdelt', ?, ?, ?, ?, ?, ?)", (f'g{t}', t, t + 15 * MIN, retro, rnd.gauss(-1, 0.6),
                json.dumps({'bitcoin_articles': rnd.randint(0, 9), 'panel_articles': rnd.randint(500, 900),
                            'tone_scored_articles': rnd.randint(0, 1) if thin else rnd.randint(0, 9)})))
    for t in range(t0 - t0 % HOUR, t1, HOUR):
        if rnd.random() < 0.9:
            st.db.execute("INSERT OR IGNORE INTO obs VALUES ('options', ?, ?, ?, ?, ?, ?)", (f'o{t}', t + 7000, t + 7000, retro, rnd.gauss(2, 1),
                json.dumps({'atm': {'7_30d': round(rnd.uniform(40, 50), 3)}, 'putCall': 0.6})))
def view(state):
    parts = {n: [e.known, [round(v, 12) for v in e.value], e.detail, e.retro_until] for n, e in {**state.components, **state.attention}.items()}
    return {'parts': parts, 'options': state.options}
def build(cache):
    return m.build_state(st, m.Prices([], None), {'id': None, 'publishedAt': None}, {}, T + 80 * DAY, cache)
put(T, T + 36 * DAY, retro=1)
cache, steps = {}, []
build(cache)
for a, b in [(36, 36.01), (36.01, 37), (None, None), (18.004, 18.2), (37, 41), (-1, 0)]:
    if a is not None:
        put(T + int(a * DAY), T + int(b * DAY))
    kept, fresh = view(build(cache)), view(build({}))
    steps.append({'same': kept == fresh, 'sizes': {n: len(p[0]) for n, p in fresh['parts'].items()}, 'options': len(fresh['options'])})
print(json.dumps(steps))`, {seed: 7, T});
  assert.equal(out.length, 6);
  out.forEach((step, k) => assert.ok(step.same, `step ${k}: the kept build differs from a fresh one`));
  // Every frequent part had values to compare, and they grew as rows came.
  for (const name of ["news.tone", "social.words", "attention.gdelt", "attention.bluesky"]) assert.ok(out[0].sizes[name] > 100 && out[5].sizes[name] > out[0].sizes[name], name);
  assert.ok(out[5].options > out[0].options);
});

test("a sample is the latest value known at or before each time, and nothing once it is stale", () => {
  const out = python("e = m.Evidence.of('x', [(10, 1.0, None), (20, 2.0, None)], 5)\nprint(json.dumps(e.sample([5, 10, 14, 15, 16, 20, 25, 26])))", null);
  assert.deepEqual(out, [null, 1, 1, 1, null, 2, 2, null]);
});
