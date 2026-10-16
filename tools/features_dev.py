#!/usr/bin/env python3
"""Serve a built explorer page with Mill behind /mill/, to try Find features locally.

The page asks its own origin for GET /mill/app-config and POST /mill/discover. This relay
serves the page's directory, declares Mill to the page (the <meta name="explorer-mill"> that
offers the Find features tab), and forwards exactly those two paths to Mill (MILL_URL, default
http://127.0.0.1:8765) with Mill's API secret (MILL_API_SECRET) as a Bearer token, so the
secret never reaches the page. It listens on 127.0.0.1 only.

    npm run build:tmp
    MILL_API_SECRET=... python3 tools/features_dev.py --dir reports/page
"""

import argparse
import json
import os
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Mill answers a search well within the minute; the relay never waits longer than that.
TIMEOUT_S = 58
ROUTES = {("GET", "/mill/app-config"), ("POST", "/mill/discover")}
DECLARATION = b'<meta name="explorer-mill" content="/mill/">'


class Relay(SimpleHTTPRequestHandler):
    mill = ""
    secret = ""

    def forward(self, method: str) -> None:
        path = self.path.split("?", 1)[0]
        if (method, path) not in ROUTES:
            self.send_error(404, "The relay forwards only GET /mill/app-config and POST /mill/discover")
            return
        length = int(self.headers.get("Content-Length") or 0)
        request = urllib.request.Request(
            self.mill + path[len("/mill"):], data=self.rfile.read(length) if length else None, method=method,
            headers={"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            with error:
                status, payload = error.code, error.read()
        except (urllib.error.URLError, TimeoutError) as error:
            status = 502
            payload = json.dumps({"error": "mill_unreachable", "detail": f"Mill at {self.mill} did not answer: {error}"}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def page(self) -> None:
        with open(os.path.join(self.directory, "index.html"), "rb") as f:
            payload = f.read().replace(b"<head>", b"<head>\n    " + DECLARATION, 1)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/mill/"):
            self.forward("GET")
        elif path in ("/", "/index.html"):
            self.page()
        else:
            super().do_GET()

    def do_POST(self) -> None:
        self.forward("POST")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default="reports/page", help="the built page's directory (default: reports/page)")
    parser.add_argument("--port", type=int, default=8795, help="port on 127.0.0.1 (default: 8795)")
    parser.add_argument("--mill", default=os.environ.get("MILL_URL", "http://127.0.0.1:8765"), help="Mill's base URL")
    args = parser.parse_args()
    secret = os.environ.get("MILL_API_SECRET", "")
    if not secret:
        raise SystemExit("Set MILL_API_SECRET to the API_SECRET Mill was started with.")
    if not os.path.isfile(os.path.join(args.dir, "index.html")):
        raise SystemExit(f"{args.dir}/index.html is missing; run npm run build:tmp first.")
    Relay.mill, Relay.secret = args.mill.rstrip("/"), secret
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Relay, directory=args.dir))
    except OSError as error:
        raise SystemExit(f"127.0.0.1:{args.port} is not available ({error.strerror}); choose another with --port.") from None
    print(f"Explorer at http://127.0.0.1:{args.port}/ · Find features through Mill at {Relay.mill}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
