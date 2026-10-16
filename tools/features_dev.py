#!/usr/bin/env python3
"""Serve a built explorer page with Mill behind /mill/, to try Find features locally.

The page asks its own origin for GET /mill/app-config and POST /mill/discover. This relay
serves the page's directory, declares Mill to the page (the <meta name="explorer-mill"> that
offers the Find features tab), and forwards exactly those two paths to Mill (MILL_URL, default
http://127.0.0.1:8765) with Mill's API secret (MILL_API_SECRET) as a Bearer token, so the
secret never reaches the page, as tools/cube_bridge.py does on the Origo host
(tools/mill_relay.py). It listens on 127.0.0.1 only.

    npm run build:tmp
    MILL_API_SECRET=... python3 tools/features_dev.py --dir reports/page
"""

import argparse
import json
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mill_relay import MAX_BODY, ROUTES, declare, forward  # noqa: E402


class Relay(SimpleHTTPRequestHandler):
    mill = ""
    secret = ""

    def answer(self, status: int, kind: str, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def relay(self, method: str, path: str) -> None:
        if (method, path) not in ROUTES:
            self.send_error(404, "The relay forwards only GET /mill/app-config and POST /mill/discover")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.answer(413, "application/json", json.dumps({"error": "request_too_large"}).encode())
            return
        status, payload = forward(self.mill, self.secret, method, path, self.rfile.read(length) if length else None)
        self.answer(status, "application/json", payload)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/mill/"):
            self.relay("GET", path)
        elif path in ("/", "/index.html"):
            self.answer(200, "text/html; charset=utf-8", declare((Path(self.directory) / "index.html").read_bytes()))
        else:
            super().do_GET()

    def do_POST(self) -> None:
        self.relay("POST", self.path.split("?", 1)[0])


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
