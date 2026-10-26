"""Production delivery with a supplied held pack and a fixture cube upstream.

No market service, browser launch or production credentials. Used to hold
archives independently of the real HTML/assets handler in browser tests.
"""
import json
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import cube_bridge as c

config = json.loads(sys.stdin.readline())
e = object.__new__(c.Explorer)
e.page = Path(config["page"])
e.lock = threading.Lock()
e.pack = config["pack"]
e.packed_at = time.monotonic()
e.advanced_at = time.time()
e.stale = False
e.version = e.pack.get("page", "delivery-fixture")
archives = threading.Event()
if not config.get("hold"):
    archives.set()


class Handler(c.Handler):
    explorer = e

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/test/release":
            archives.set()
            self.reply(200, "text/plain", b"released")
        elif path.startswith("/cube/"):
            try:
                response = urlopen(Request(config["upstream"] + self.path), timeout=30)
            except HTTPError as error:
                response = error
            with response:
                self.reply(response.status, response.headers.get_content_type(), response.read())
        else:
            if path.endswith(".msc") and not archives.wait(30):
                self.reply(503, "text/plain", b"archive gate timed out")
                return
            super().do_GET()

    def log_message(self, *args):
        pass


server = c.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(json.dumps({"url": "http://127.0.0.1:" + str(server.server_port)}), flush=True)
server.serve_forever()
