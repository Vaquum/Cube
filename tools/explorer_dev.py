"""Local source preview on a real bridge, with ETF reads through field-data-api.

Tunnel the remote bridge and field service to loopback first. This serves a local
build with the bridge's real pack and relays its cube requests unchanged. No
provider credentials, production files or remote configuration are changed.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from etf_service import EtfService, DECLARATION
from field_data import FieldDataReader


def serve(page, upstream, field_url, port, store):
    etf = EtfService(FieldDataReader(field_url, token=os.environ.get("FIELD_DATA_API_TOKEN") or None), store)
    etf.start()

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, kind, body):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def remote(self, path, method="GET", body=None):
            headers = {"Accept-Encoding": "identity"}
            if body is not None:
                headers["Content-Type"] = "application/json"
            request = urllib.request.Request(upstream + path, data=body, headers=headers, method=method)
            try:
                return urllib.request.urlopen(request, timeout=90)
            except urllib.error.HTTPError as error:
                return error

        def do_GET(self):
            url = urlsplit(self.path)
            try:
                if url.path in ("/", "/index.html"):
                    with self.remote("/") as response:
                        remote = response.read()
                    pack = re.search(rb'(<script type="application/json" id="origo-lens-data">).*?(</script>)', remote, re.S)
                    if pack is None:
                        raise ValueError("Upstream page has no live cube pack")
                    local = page.read_bytes()
                    local = re.sub(rb'(<script type="application/json" id="origo-lens-data">).*?(</script>)', lambda _: pack.group(), local, count=1, flags=re.S)
                    declarations = re.findall(rb'<meta name="explorer-(?:strip|micro|mill)"[^>]*>', remote)
                    local = local.replace(b"</head>", b"".join(declarations) + DECLARATION + b"</head>", 1)
                    self.reply(200, "text/html; charset=utf-8", local)
                elif url.path == "/cube/etf":
                    args = parse_qs(url.query)
                    status, body = etf.answer(args) if args.get("proto") == ["2"] else (409, {"error": "outdated_explorer", "reload": True})
                    self.reply(status, "application/json", json.dumps(body, allow_nan=False).encode())
                elif url.path.startswith("/vendor/") and Path(url.path).name == url.path.removeprefix("/vendor/"):
                    asset = page.parent / "vendor" / Path(url.path).name
                    self.reply(200, "application/javascript", asset.read_bytes())
                elif url.path.startswith(("/cube/", "/mill/", "/assets/")):
                    with self.remote(self.path) as response:
                        self.reply(response.status, response.headers.get("Content-Type", "application/json"), response.read())
                else:
                    self.reply(404, "text/plain", b"Not found")
            except (OSError, ValueError) as error:
                self.reply(502, "application/json", json.dumps({"error": "local_upstream_failed", "detail": str(error)}).encode())

        def do_POST(self):
            if urlsplit(self.path).path not in ("/cube/micro", "/cube/rallies", "/cube/rallies/view", "/mill/discover"):
                self.reply(404, "text/plain", b"Not found")
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 2 * 1024 * 1024:
                self.reply(413, "text/plain", b"Invalid request size")
                return
            try:
                with self.remote(self.path, "POST", self.rfile.read(length)) as response:
                    self.reply(response.status, response.headers.get("Content-Type", "application/json"), response.read())
            except OSError:
                self.reply(502, "application/json", b'{"error":"local_upstream_failed"}')

    print(f"Local explorer at http://127.0.0.1:{port} · real cube and ETF data", flush=True)
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page", type=Path, required=True)
    parser.add_argument("--upstream", default="http://127.0.0.1:18487")
    parser.add_argument("--field-data", default="http://127.0.0.1:18491")
    parser.add_argument("--port", type=int, default=8796)
    parser.add_argument("--store", default=":memory:")
    args = parser.parse_args()
    serve(args.page, args.upstream.rstrip("/"), args.field_data, args.port, args.store)
