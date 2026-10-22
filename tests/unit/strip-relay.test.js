"use strict";
// The bridge's strip relay over real HTTP, in one Python process: the production Handler of tools/cube_bridge.py and a stub Origo strip
// endpoint that records what reaches it and answers as each case sets. Oracles: the hand-written answers in the script, the query the
// stub receives, the page the bridge serves, and the statuses and bodies the page gets, as docs/strip.md (The route, The answer) states
// them.
const {test} = require("node:test"), assert = require("node:assert/strict"), {spawnSync} = require("node:child_process"), path = require("node:path");

const SCRIPT = String.raw`
import json, sys, threading, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, 'tools')
import cube_bridge as c

T0, STEP, DAY = 1790100000000, 900000, 86400000
SOURCES = ('macro', 'positioning', 'news', 'social', 'attention', 'calendar', 'history', 'options')
def reaction():
    return {'p5': -1.0, 'p50': 0.0, 'p95': 1.0, 'bins': [[-2, 0, 0.5], [0, 2, 0.5]]}
# A CPI moved by a quarter of an hour the day before, estimated twice and measured; a Jobs release cancelled before it happened.
def valid():
    return {'schema': 'cube-strip@1', 'model': 'stub@1', 'cutoff': T0 + 3 * STEP,
            'sources': {name: {'method': name + '@1', 'recordedFrom': T0 - DAY, 'fittedThrough': None} for name in SOURCES},
            'grid': {'t0': T0, 'step': STEP,
                     'forces': {'macro': [0.1, 0.2, None, 0.3], 'positioning': [None] * 4, 'news': [-0.2, -0.1, 0, 0.4], 'social': [None] * 4},
                     'attention': [0.3, 0.5, None, 1], 'close': [80000, 80100.5, None, 79900], 'next24h': [1.5, None, None, None]},
            'events': [{'id': 'cpi-1', 'kind': 'cpi', 'family': 'macro', 'name': 'Consumer Price Index', 'short': 'CPI', 'window': 30,
                        'schedule': [{'knownAt': T0 - 2 * DAY, 'at': T0 + STEP}, {'knownAt': T0 - DAY, 'at': T0 + 2 * STEP}],
                        'prior': {'at': T0 - 2 * DAY, 'n': 40, 'charge': 0.5, 'skew': 0, 'reaction': reaction()},
                        'estimates': [{'at': T0 - DAY, 'charge': 0.8, 'skew': 0.1, 'reaction': reaction(), 'expiry': None},
                                      {'at': T0, 'charge': 0.9, 'skew': 0.2, 'reaction': reaction(),
                                       'expiry': {'at': T0 + DAY, 'p5': 70000, 'p50': 80000, 'p95': 90000, 'share': 0.1}}],
                        'measured': {'from': T0 + 2 * STEP, 'at': T0 + 2 * STEP + 1800000, 'move': -0.4, 'bits': 1.2}},
                       {'id': 'jobs-1', 'kind': 'jobs', 'family': 'macro', 'name': 'Employment Situation', 'short': 'Jobs', 'window': 30,
                        'schedule': [{'knownAt': T0 - 2 * DAY, 'at': T0 + 3 * STEP}, {'knownAt': T0 - DAY, 'at': None}],
                        'prior': {'at': T0 - 2 * DAY, 'n': 12, 'charge': 0.6, 'skew': 0, 'reaction': reaction()},
                        'estimates': [], 'measured': None}],
            'jumps': [{'id': 'jump-1', 'at': T0 + STEP, 'window': 30, 'move': 2.1, 'bits': 3.5}]}

mode = {'answer': valid(), 'status': 200}
seen = []
class Origo(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        seen.append(self.path)
        payload = mode['answer'] if isinstance(mode['answer'], bytes) else json.dumps(mode['answer']).encode()
        self.send_response(mode['status']); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)

class Page:
    def html(self): return b'<!doctype html><html><head><title>x</title></head><body></body></html>'

def serve(handler):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, 'http://127.0.0.1:%d' % server.server_address[1]

def call(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r: return [r.status, r.read().decode()]
    except urllib.error.HTTPError as e:
        with e: return [e.code, e.read().decode()]

c.Handler.log_message = lambda *a: None
origo, origo_url = serve(Origo)
c.Handler.explorer = Page()
bridge, url = serve(c.Handler)
def strip(query, proto=True): return call(url + '/cube/strip?' + ('proto=2&' if proto else '') + query)
grid = 'from=%d&to=%d&step=%d' % (T0, T0 + 4 * STEP, STEP)
out = {}
c.STRIP_URL = ''
out['off'] = strip(grid)
out['pageOff'] = call(url + '/')
c.STRIP_URL = origo_url + '/v1/strip'
out['pageOn'] = call(url + '/')
out['outdated'] = strip(grid, proto=False)[0]
queries = ['from=x&to=1&step=900000', 'from=%d&to=%d&step=60000' % (T0, T0 + STEP), 'from=%d&to=%d&step=%d' % (T0 + 1, T0 + STEP, STEP),
           'from=%d&to=%d&step=%d' % (T0, T0, STEP), 'from=0&to=%d&step=%d' % (20001 * STEP, STEP)]
out['bad'] = [json.loads(strip(q)[1]) | {'status': strip(q)[0]} for q in queries]
out['ok'] = strip(grid)
out['seen'] = list(seen)
def broken(change):
    a = valid(); change(a); mode['answer'] = a
    r = strip(grid)
    mode['answer'] = valid()
    return [r[0], json.loads(r[1])]
out['wrong'] = [broken(lambda a: a.update(schema='cube-strip@2')),
                broken(lambda a: a['grid']['attention'].pop()),
                broken(lambda a: a['grid']['forces'].pop('social')),
                broken(lambda a: a['events'][0].update(family='crowd')),
                broken(lambda a: a['events'][0]['prior']['reaction']['bins'][0].__setitem__(2, 0.4)),
                broken(lambda a: a['grid'].update(t0=T0 + STEP)),
                broken(lambda a: a['events'][0].update(short='Consumer price')),
                broken(lambda a: a['grid']['forces']['macro'].__setitem__(0, 'up')),
                broken(lambda a: a['events'][0]['schedule'][0].update(knownAt=T0 + DAY)),
                broken(lambda a: a['jumps'][0].update(bits=-1)),
                broken(lambda a: a['grid']['close'].__setitem__(1, 0)),
                broken(lambda a: a['sources'].pop('options')),
                broken(lambda a: a['sources']['news'].update(method='x' * 65)),
                broken(lambda a: a['events'][0]['schedule'][1].update(knownAt=T0 - 2 * DAY)),
                broken(lambda a: a['events'][0]['estimates'][1].update(at=T0 - DAY)),
                broken(lambda a: a['events'][0]['measured'].__setitem__('from', T0 + STEP)),
                broken(lambda a: a['events'][0]['measured'].__setitem__('at', T0 + 2 * STEP + 60000)),
                broken(lambda a: a['events'][1].update(measured={'from': T0 + 3 * STEP, 'at': T0 + 3 * STEP + 1800000, 'move': 0.1, 'bits': 0.2})),
                broken(lambda a: a['events'][0]['prior'].update(n=-1))]
mode['answer'] = b'not json'
out['notJson'] = strip(grid)
mode['answer'], mode['status'] = {'error': 'busy'}, 503
out['upstream'] = strip(grid)
mode['answer'], mode['status'] = valid(), 200
origo.shutdown(); origo.server_close()
out['down'] = strip(grid)
bridge.shutdown()
print(json.dumps(out))
`;

test("the bridge relays /cube/strip to Origo only when configured, and passes on only answers of the cube-strip@1 shape", () => {
  const run = spawnSync("python3", ["-c", SCRIPT], {cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 50000});
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout), T0 = 1790100000000, STEP = 900000;
  // Without STRIP_URL the strip is not served, in the words the page reads, and the page is not told of it; with it, the page is.
  assert.deepEqual([out.off[0], JSON.parse(out.off[1])], [503, {error: "strip_not_configured"}]);
  assert.equal(out.pageOff[0], 200);
  assert.doesNotMatch(out.pageOff[1], /explorer-strip/);
  assert.match(out.pageOn[1], /^<!doctype html><html><head>\n {4}<meta name="explorer-strip" content="\/cube\/strip"><title>x<\/title>/);
  // A page without the protocol is told to reload, like every /cube/ route.
  assert.equal(out.outdated, 409);
  // Each rule of the query is its own refusal, before Origo is asked.
  assert.deepEqual(out.bad.map((b) => [b.status, b.error, b.detail]), [
    [400, "invalid_strip_request", "from must be a whole number of milliseconds"],
    [400, "invalid_strip_request", "step must be 900000, 3600000, 21600000 or 86400000"],
    [400, "invalid_strip_request", "from must be a multiple of step"],
    [400, "invalid_strip_request", "to must be after from"],
    [400, "invalid_strip_request", "more than 20000 grid times"],
  ]);
  // A good answer passes unchanged, and Origo was asked once, for exactly the grid the page asked for.
  assert.equal(out.ok[0], 200);
  assert.equal(JSON.parse(out.ok[1]).grid.forces.news[3], 0.4);
  assert.equal(JSON.parse(out.ok[1]).events[0].estimates[1].expiry.p50, 80000);
  assert.equal(JSON.parse(out.ok[1]).events[1].schedule[1].at, null);
  assert.deepEqual(out.seen, [`/v1/strip?from=${T0}&to=${T0 + 4 * STEP}&step=${STEP}`]);
  // An answer of the wrong shape never reaches the page; the detail says where it is wrong.
  assert.deepEqual(out.wrong.map(([status, body]) => [status, body.error, body.detail]), [
    [502, "strip_invalid_answer", "schema: must be cube-strip@1"],
    [502, "strip_invalid_answer", "grid.attention: must be a list of 4 values"],
    [502, "strip_invalid_answer", "grid.forces: lacks social"],
    [502, "strip_invalid_answer", "events[0].family: must be one of macro, positioning, news, social"],
    [502, "strip_invalid_answer", "events[0].prior.reaction.bins: probabilities must sum to 1"],
    [502, "strip_invalid_answer", `grid: must start at ${T0} with step ${STEP}`],
    [502, "strip_invalid_answer", "events[0].short: must be text of 1 to 8 characters"],
    [502, "strip_invalid_answer", "grid.forces.macro: holds a value that is neither a finite number nor null"],
    [502, "strip_invalid_answer", "events[0].schedule[0].knownAt: must not be after the event"],
    [502, "strip_invalid_answer", "jumps[0]: move must be finite and bits finite and at least 0"],
    [502, "strip_invalid_answer", "grid.close: must be positive"],
    [502, "strip_invalid_answer", "sources: lacks options"],
    [502, "strip_invalid_answer", "sources.news.method: must be text of 1 to 64 characters"],
    [502, "strip_invalid_answer", "events[0].schedule[1].knownAt: must be after the entry before it"],
    [502, "strip_invalid_answer", "events[0].estimates[1].at: must be after the estimate before it"],
    [502, "strip_invalid_answer", "events[0].measured.from: must be the event's last scheduled time"],
    [502, "strip_invalid_answer", "events[0].measured.at: must be from + window"],
    [502, "strip_invalid_answer", "events[1].measured.from: must be the event's last scheduled time"],
    [502, "strip_invalid_answer", "events[0].prior.n: must be a whole number of at least 0"],
  ]);
  assert.deepEqual([out.notJson[0], JSON.parse(out.notJson[1]).error], [502, "strip_invalid_answer"]);
  // Origo's own refusal and Origo not answering are 502s that say which.
  assert.equal(out.upstream[0], 502);
  assert.deepEqual(JSON.parse(out.upstream[1]), {error: "strip_upstream_failed", detail: 'Origo answered 503: {"error": "busy"}'});
  assert.equal(out.down[0], 502);
  assert.equal(JSON.parse(out.down[1]).error, "strip_upstream_failed");
  assert.match(JSON.parse(out.down[1]).detail, /^Origo did not answer: /);
});
