"use strict";
// The bridge's Find features relay over real HTTP, in one Python process: the production Handler of tools/cube_bridge.py with a
// stub explorer for the page, and a stub Mill that records what reaches it. Oracles: the requests the stub Mill receives, and the
// statuses and bodies the page gets.
const {test} = require("node:test"), assert = require("node:assert/strict"), {spawnSync} = require("node:child_process"), path = require("node:path");

const SCRIPT = String.raw`
import json, sys, threading, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, 'tools')
import cube_bridge as c

seen = []
class Mill(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def answer(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        seen.append({'method': self.command, 'path': self.path, 'auth': self.headers.get('Authorization'), 'body': body.decode()})
        payload = json.dumps({'path': self.path}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
    do_GET = do_POST = answer

class Page:
    def html(self): return b'<!doctype html><html><head><title>x</title></head><body></body></html>'

def serve(handler):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, 'http://127.0.0.1:%d' % server.server_address[1]

def call(url, method='GET', body=None, headers=None):
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=10) as r: return [r.status, r.read().decode()]
    except urllib.error.HTTPError as e:
        with e: return [e.code, e.read().decode()]

c.Handler.log_message = lambda *a: None
mill, mill_url = serve(Mill)
c.Handler.explorer = Page()
bridge, url = serve(c.Handler)
same = {'Content-Type': 'application/json', 'Origin': 'https://cube.vaquum.fi'}
out = {}
c.MILL_URL, c.MILL_API_SECRET = mill_url, ''
out['off'] = [call(url + '/mill/app-config')[0], 'explorer-mill' in call(url + '/')[1]]
c.MILL_URL, c.MILL_API_SECRET = mill_url, 's3cret'
page = call(url + '/')[1]
out['page'] = page.count('<meta name="explorer-mill" content="/mill/">')
out['config'] = call(url + '/mill/app-config')
out['discover'] = call(url + '/mill/discover', 'POST', b'{"windows": []}', same)
out['refused'] = [call(url + '/mill/discover', 'POST', b'{}', {'Content-Type': 'application/json', 'Origin': 'https://elsewhere.example'})[0],
                  call(url + '/mill/discover', 'POST', b'{}', {'Content-Type': 'text/plain', 'Origin': 'https://cube.vaquum.fi'})[0],
                  call(url + '/mill/discover', 'POST', b'x' * 70000, same)[0]]
out['unrouted'] = [call(url + '/mill/data')[0], call(url + '/mill/save_view', 'POST', b'{}', same)[0], call(url + '/mill/discover')[0]]
out['leak'] = any('s3cret' in text for text in [page, out['config'][1], out['discover'][1]])
out['seen'] = seen
mill.shutdown(); mill.server_close()
out['down'] = call(url + '/mill/app-config')
bridge.shutdown()
print(json.dumps(out))
`;

test("the bridge relays exactly Find features' two routes to Mill, with the secret added server-side, and only when configured", () => {
  const run = spawnSync("python3", ["-c", SCRIPT], {cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 50000});
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  // Without the secret there is no relay and no tab.
  assert.deepEqual(out.off, [404, false]);
  // With it the page declares Mill once, and the two routes reach Mill as Mill's own paths, with the Bearer secret.
  assert.equal(out.page, 1);
  assert.deepEqual([out.config[0], JSON.parse(out.config[1])], [200, {path: "/app-config"}]);
  assert.deepEqual([out.discover[0], JSON.parse(out.discover[1])], [200, {path: "/discover"}]);
  assert.deepEqual(out.seen, [
    {method: "GET", path: "/app-config", auth: "Bearer s3cret", body: ""},
    {method: "POST", path: "/discover", auth: "Bearer s3cret", body: '{"windows": []}'},
  ]);
  // Another origin, a body that is not JSON and an oversized one are refused before Mill; no other route reaches it.
  assert.deepEqual(out.refused, [403, 400, 413]);
  assert.deepEqual(out.unrouted, [404, 404, 404]);
  assert.equal(out.leak, false, "the secret never reaches the page");
  // Mill not answering is a 502 that says so.
  assert.equal(out.down[0], 502);
  assert.equal(JSON.parse(out.down[1]).error, "mill_unreachable");
});
