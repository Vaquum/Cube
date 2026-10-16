"""Mill behind the explorer's own origin, for Find features.

The page asks its origin for ``GET /mill/app-config`` and ``POST /mill/discover``. A server that
relays them to Mill declares so in the page with ``<meta name="explorer-mill">``, which offers the
Find features tab. Exactly those two paths are forwarded, with Mill's API secret added here as a
Bearer token, so the secret never reaches the page. ``tools/cube_bridge.py`` relays them when
``MILL_URL`` and ``MILL_API_SECRET`` are set, and ``tools/features_dev.py`` does locally.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

ROUTES = frozenset({("GET", "/mill/app-config"), ("POST", "/mill/discover")})
DECLARATION = b'<meta name="explorer-mill" content="/mill/">'
# A search answers well within the minute: a timeframe's first builds Mill's pool, at most about 16 s.
TIMEOUT_S = 58
MAX_BODY = 65536


def declare(page: bytes) -> bytes:
    """The page with Mill declared in its head."""
    return page.replace(b"<head>", b"<head>\n    " + DECLARATION, 1)


def forward(mill_url: str, secret: str, method: str, path: str, body: bytes | None) -> tuple[int, bytes]:
    """Mill's status and JSON for one of ROUTES, or a 502 that says there was no answer."""
    request = urllib.request.Request(
        mill_url.rstrip("/") + path.removeprefix("/mill"), data=body, method=method,
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.read()
    except (urllib.error.URLError, OSError) as error:
        return 502, json.dumps({"error": "mill_unreachable", "detail": f"Mill did not answer: {error}"}).encode()
