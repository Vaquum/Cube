"use strict";
// U101: the bridge's Strip over real HTTP, in one Python process: the production Handler of tools/cube_bridge.py, its field-data reader
// (tools/field_data.py) and service (tools/strip_service.py), against a stub field-data-api that publishes two hand-written publications
// and records every request it gets. Oracles: the stub's own record of requests (which snapshot each named, which offsets), the hand-made
// datasets and their counts, tools/strip_contract.py's check of each answer, and the statuses and bodies the page gets, as
// docs/strip.md (The route, Reads and states) and Vaquum/field-data-api docs/api.md ("Select once, then pin every read") state them.
const {test} = require("node:test"), assert = require("node:assert/strict"), {spawnSync} = require("node:child_process"), path = require("node:path");

const SCRIPT = String.raw`
import json, sys, threading, urllib.request, urllib.error, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, 'tools')
import cube_bridge as c
import strip_contract
from field_data import FieldDataReader
from strip_service import StripService

HOUR, DAY = 3600000, 86400000
NOW = 1792756800000  # 2026-10-23T11:20:00Z
def iso(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
def day(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).date().isoformat()
PIN1, PIN2 = 'a' * 64, 'b' * 64

def record(rid, kind, values, observed=None, precision='millisecond', metadata=None, event=None):
    return {'id': rid, 'kind': kind, 'values': values, 'observed_at': observed, 'published_at': None, 'event_at': event,
            'time_basis': 'x', 'time_precision': precision, **({'metadata': metadata} if metadata else {})}

# Hand-made datasets in the projections' shapes (Vaquum/field-data-api docs/projections.md).
fred = [record(f'{s}:{d}', 'observation', {'series': s, 'value': v + 0.01 * i * (1 if s != 'DGS2' else -1), 'unit': 'x'},
               day(NOW - (20 - i) * DAY), 'day')
        for s, v in (('DTWEXBGS', 120.0), ('DGS2', 4.8), ('DGS10', 4.3), ('BAMLH0A0HYM2', 3.0)) for i, d in enumerate(range(20))]
funding = [record(f'f:{i}', 'funding', {'interest_1h': 2e-6 + 1e-7 * (i % 7), 'interest_8h': 1e-5, 'index_price': 80000},
                  iso(NOW - (48 - i) * HOUR)) for i in range(48)]
hl = [record(f'h:{i}', 'funding', {'funding_rate': 1.25e-5 + 1e-7 * (i % 5), 'funding_period_seconds': 3600, 'coin': 'BTC'},
             iso(NOW - (48 - i) * HOUR)) for i in range(48)]
stable = [record(f's:{i}', 'supply', {'total_usd': 3.0e11 * (1 + 0.001 * i + 0.0005 * (i % 3)), 'unit': 'USD'}, day(NOW - (30 - i) * DAY), 'day')
          for i in range(30)]
options = [record(f'7_30d:{m}:{side}', 'option_bucket', {'expiry_bucket': '7_30d', 'strike_underlying_bucket': m, 'option_type': side,
                  'mark_iv_oi_weighted_percent': iv, 'iv_valid_weight': 1000.0})
           for m, side, iv in (('0_98_1_02', 'call', 40.0), ('0_98_1_02', 'put', 41.0), ('0_90_0_98', 'put', 44.0), ('1_02_1_10', 'call', 39.0))]
dvol = [record(f'd:{i}', 'dvol', {'close': 40.0 + 0.1 * i, 'open': 40.0, 'high': 41.0, 'low': 39.0, 'unit': 'annualised_percent'},
               iso(NOW - (48 - i) * HOUR), metadata={'complete': True, 'interval_end': iso(NOW - (47 - i) * HOUR)}) for i in range(48)]
basis = [record('future-expiry:x', 'future_basis_expiry', {'simple_annualized_basis_fraction_oi_weighted': 0.05}, iso(NOW - 60000), event=iso(NOW + 60 * DAY))]
retarget = [record('bitcoin:retarget:973728', 'retarget', {'estimatedRetargetDate': float(NOW + 6 * DAY), 'nextRetargetHeight': 973728,
                                                           'difficultyChange': 5.0, 'progressPercent': 51.9}, event=iso(NOW + 6 * DAY))]
wiki = [record(f'w:{i}', 'pageviews_day', {'views': 2000 + 10 * i}, day(NOW - (7 - i) * DAY), 'day') for i in range(7)]
gdelt = [record(f'g:{i}', 'news_coverage_batch', {'panel_articles': 40, 'bitcoin_articles': 2, 'tone_mean': -1.0, 'tone_scored_articles': 2},
                iso(NOW - (4 - i) * 900000)) for i in range(4)]
# The calendar: 721 events, more than one 500-record page; instants, dates and ranges; every certainty; one cancelled.
cal = []
for i in range(721):
    at = NOW + (i + 1) * 3 * HOUR
    if i % 3 == 0:
        schedule = {'kind': 'instant', 'at': iso(at)}
    elif i % 3 == 1:
        schedule = {'kind': 'date', 'date': day(at)}
    else:
        schedule = {'kind': 'date_range', 'start': day(at), 'end': day(at + 3 * DAY)}
    cal.append(record(f'e{i:03d}', 'calendar_event', {
        'title': 'US CPI inflation: headline and core' if i % 5 == 0 else f'Event {i}', 'category': ('inflation', 'banking_holiday', 'bitcoin_conference')[i % 3],
        'origin': 'source', 'status': 'cancelled' if i == 7 else 'scheduled', 'schedule': schedule,
        'schedule_certainty': ('confirmed', 'tentative', 'rule_derived', 'unspecified')[i % 4],
        'context': {'importance': ('high', 'medium', 'low')[i % 3], 'region': 'United States', 'source_id': f'S{i % 5}'}},
        metadata={'revision_id': f'r{i}', 'provenance': {'url': 'https://example.org/e'}}))

def dataset(source, records, version='1', meta=None):
    return {'dataset_id': (source + version).encode().hex()[:64].ljust(64, '0'), 'received_at': iso(NOW - 120000), 'records': records,
            'meta': meta or {}, 'projection_version': '1.0.0'}

SOURCES = {'fred_macro_daily': fred, 'deribit_funding': funding, 'hyperliquid_funding': hl, 'defillama_stablecoins': stable,
           'deribit_options': options, 'deribit_dvol': dvol, 'deribit_futures_basis': basis, 'mempool_retarget': retarget,
           'wikimedia_daily': wiki, 'gdelt_gkg': gdelt, 'wikimedia_hourly': []}
def publication(pin, published, options_version):
    sets = {s: dataset(s, r, options_version if s == 'deribit_options' else '1') for s, r in SOURCES.items()}
    states = {s: {'status': 'ok', 'dataset_id': d['dataset_id'], 'received_at': d['received_at'], 'last_checked_at': iso(published - 60000),
                  'collection_interval_seconds': 300} for s, d in sets.items()}
    states['gdelt_gkg']['status'] = 'stale'
    # A failed collection without a dataset, and a disabled source: the service gives them no dataset.
    states['bluesky_live'] = {'status': 'error', 'dataset_id': None, 'error': 'provider_timeout', 'collection_interval_seconds': 300}
    states['coindesk_headlines'] = {'status': 'disabled', 'dataset_id': None, 'reason': 'Provider returns HTTP403'}
    return {'snapshot_id': pin, 'published_at': iso(published), 'scheduled_for': iso(published), 'datasets': states,
            'calendar': {'dataset_id': 'c' * 64, 'record_count': len(cal), 'status': 'ok', 'received_at': iso(NOW - DAY)}}, sets
pubs = {PIN1: publication(PIN1, NOW - 300000, '1'), PIN2: publication(PIN2, NOW, '2')}
current = {'pin': PIN1}
seen = []

class FieldData(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(payload)))
        self.end_headers(); self.wfile.write(payload)
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path); q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        seen.append([url.path, q])
        if url.path == '/v1/snapshots/latest':
            return self.send(200, pubs[q.get('snapshot_id', current['pin'])][0])
        manifest, sets = pubs[q.get('snapshot_id', current['pin'])]
        limit, offset = int(q.get('limit', 500)), int(q.get('offset', 0))
        def page(source, ds, records):
            nxt = offset + limit if offset + limit < len(records) else None
            return {'snapshot_id': manifest['snapshot_id'], 'published_at': manifest['published_at'], 'source': source, 'dataset_id': ds,
                    'status': manifest['datasets'].get(source, {}).get('status', 'ok'), 'state': manifest['datasets'].get(source, {}),
                    'data': {'records': records[offset:offset + limit], 'received_at': iso(NOW - 120000), 'meta': {}, 'projection_version': '1.0.0'},
                    'page': {'offset': offset, 'limit': limit, 'total': len(records), 'next_offset': nxt}}
        if url.path == '/v1/calendar':
            return self.send(200, page('calendar', 'c' * 64, cal))
        if url.path.startswith('/v1/history/'):
            return self.send(200, {'versions': [], 'next_before': None, 'next_before_id': None})
        source = url.path.rsplit('/', 1)[1]
        if source == 'wikimedia_hourly':
            return self.send(503, {'error': 'dataset_not_available'})
        d = sets[source]
        return self.send(200, page(source, d['dataset_id'], d['records']))

def serve(handler):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, 'http://127.0.0.1:%d' % server.server_address[1]
def call(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r: return [r.status, r.read().decode()]
    except urllib.error.HTTPError as e:
        with e: return [e.code, e.read().decode()]

fd, fd_url = serve(FieldData)
out = {}
# The reader: one publication, every source and calendar page under its pin.
reader = FieldDataReader(fd_url)
pub = reader.publication(('fred_macro_daily', 'deribit_options', 'bluesky_live', 'coindesk_headlines', 'wikimedia_hourly', 'gdelt_gkg'))
out['reader'] = {'pin': pub.snapshot_id, 'datasets': sorted(pub.datasets), 'unavailable': pub.unavailable, 'calendar': len(pub.calendar.records),
                 'requests': pub.requests, 'gdelt_status': pub.datasets['gdelt_gkg'].status}
out['seen1'] = list(seen)

# The bridge without field-data-api: no declaration, and the strip is not configured.
class Page:
    def html(self): return b'<!doctype html><html><head><title>x</title></head><body></body></html>'
c.Handler.log_message = lambda *a: None
c.Handler.explorer = Page()
bridge, url = serve(c.Handler)
def strip(query, proto=True): return call(url + '/cube/strip?' + ('proto=2&' if proto else '') + query)
step = 900000
end = (NOW // step) * step + step; start = end - 2 * DAY
grid = 'from=%d&to=%d&step=%d' % (start, end, step)
c.STRIP = None
out['off'] = strip(grid)
out['pageOff'] = call(url + '/')
# With it, before the first publication is read, and after.
seen.clear()
service = StripService(FieldDataReader(fd_url), ':memory:', bars=None, clock=lambda: NOW / 1000)
c.STRIP = service
out['pageOn'] = call(url + '/')
out['loading'] = strip(grid)
service.update(); service.rebuild()
out['seen2'] = list(seen)
ok = strip(grid)
answer = json.loads(ok[1])
try:
    strip_contract.check(answer, start, end, step); out['check'] = 'ok'
except ValueError as e:
    out['check'] = str(e)
out['ok'] = ok[0]
out['sources'] = {k: v['state'] for k, v in answer['sources'].items()}
out['events'] = len([e for e in answer['events'] if e['kind'] != 'retarget'])
out['retarget'] = [e['schedule'][0]['at'] for e in answer['events'] if e['kind'] == 'retarget']
out['precisions'] = sorted({e['schedule'][0]['precision'] for e in answer['events']})
out['cancelled'] = [e['schedule'][0] for e in answer['events'] if e['id'] == 'e007']
out['dated'] = [e['schedule'][0] for e in answer['events'] if e['id'] == 'e001']
out['macro'] = next((v for v in reversed(answer['grid']['forces']['macro']) if v is not None), None)
out['outdated'] = strip(grid, proto=False)[0]
out['bad'] = json.loads(strip('from=1&to=2&step=60000')[1])
# The next publication: only the options moved, so only they and the snapshot are read again.
seen.clear()
current['pin'] = PIN2
service.update(); service.rebuild()
out['seen3'] = list(seen)
bridge.shutdown(); fd.shutdown()
print(json.dumps(out))
`;

test("the bridge reads field-data-api one pinned publication at a time, every page of it, and serves the Strip only when configured", () => {
  const run = spawnSync("python3", ["-c", SCRIPT], {cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 60000});
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout), PIN1 = "a".repeat(64), PIN2 = "b".repeat(64);
  // The reader pins once: every data and calendar request names the snapshot it selected, and the calendar's second page keeps the pin.
  assert.equal(out.reader.pin, PIN1);
  const pinned = out.seen1.filter(([p]) => p !== "/v1/snapshots/latest");
  assert.ok(pinned.length > 0 && pinned.every(([, q]) => q.snapshot_id === PIN1), JSON.stringify(pinned));
  assert.deepEqual(out.seen1.filter(([p]) => p === "/v1/calendar").map(([, q]) => q.offset), ["0", "500"]);
  assert.equal(out.reader.calendar, 721);
  // A source without a dataset, or one that the service refuses, is unavailable on its own; a stale one still reads, as stale.
  assert.deepEqual(out.reader.datasets, ["deribit_options", "fred_macro_daily", "gdelt_gkg"]);
  assert.deepEqual(Object.keys(out.reader.unavailable).sort(), ["bluesky_live", "coindesk_headlines", "wikimedia_hourly"]);
  assert.equal(out.reader.unavailable.bluesky_live.status, "error");
  assert.equal(out.reader.unavailable.coindesk_headlines.status, "disabled");
  assert.deepEqual([out.reader.unavailable.wikimedia_hourly.status, out.reader.unavailable.wikimedia_hourly.http], ["error", 503]);
  assert.equal(out.reader.gdelt_status, "stale");
  // Without FIELD_DATA_URL the strip is not served, and the page is not told of it; with it, the page is.
  assert.deepEqual([out.off[0], JSON.parse(out.off[1])], [503, {error: "strip_not_configured"}]);
  assert.doesNotMatch(out.pageOff[1], /explorer-strip/);
  assert.match(out.pageOn[1], /^<!doctype html><html><head>\n {4}<meta name="explorer-strip" content="\/cube\/strip"><title>x<\/title>/);
  // Before the first publication is read the page is told to wait; after it, the answer is a cube-strip@2.
  assert.equal(out.loading[0], 503);
  assert.equal(JSON.parse(out.loading[1]).error, "strip_loading");
  assert.equal(out.ok, 200);
  assert.equal(out.check, "ok");
  assert.ok(out.seen2.filter(([p]) => p.startsWith("/v1/data/") || p === "/v1/calendar").every(([, q]) => q.snapshot_id === PIN1));
  // Each source's state, as the publication gave it: stale stays stale, a failure is a failure, never zero or silence.
  assert.equal(out.sources.gdelt_gkg, "stale");
  assert.equal(out.sources.bluesky_live, "error");
  assert.equal(out.sources.wikimedia_hourly, "error");
  assert.equal(out.sources.fred_macro_daily, "ok");
  // Every event of the calendar that falls in the answer's span; a date stays a date and a range a range; a cancelled one has no time.
  assert.ok(out.events > 0);
  assert.deepEqual(out.precisions, ["day", "instant", "range"]);
  assert.deepEqual([out.cancelled[0].status, out.cancelled[0].at], ["cancelled", null]);
  assert.equal(out.dated[0].precision, "day");
  assert.equal(out.dated[0].end - out.dated[0].at, 86400000);
  assert.equal(out.retarget.length, 1);
  assert.equal(typeof out.macro, "number");
  // A page without the protocol is told to reload; a bad grid is refused in the contract's words.
  assert.equal(out.outdated, 409);
  assert.deepEqual([out.bad.error, out.bad.detail], ["invalid_strip_request", "step must be 900000, 3600000, 21600000 or 86400000"]);
  // The next publication: the snapshot, then only the dataset whose id moved, under the new pin; the calendar is not read again.
  assert.deepEqual(out.seen3.map(([p, q]) => [p, q.snapshot_id ?? null]), [["/v1/snapshots/latest", null], ["/v1/data/deribit_options", PIN2], ["/v1/data/wikimedia_hourly", PIN2]]);
});
