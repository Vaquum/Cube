"""The Strip behind the explorer's own origin: ``GET /cube/strip`` relayed to Origo.

The page asks its origin for ``/cube/strip?proto=2&from=<ms>&to=<ms>&step=<ms>``. ``tools/cube_bridge.py`` forwards the same grid to
the URL in ``STRIP_URL`` and passes the answer on once it has the ``cube-strip@1`` shape that ``docs/strip.md`` sets out, so the page
never reads anything else. Without ``STRIP_URL`` the strip is not served, and the page says so.
"""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import NoReturn, TypeGuard

SCHEMA = "cube-strip@1"
STEPS = (900_000, 3_600_000, 21_600_000, 86_400_000)
MAX_POINTS = 20_000
FORCES = ("macro", "positioning", "news", "social")
SOURCES = ("options", "history")
TIMEOUT_S = 20
MAX_ANSWER = 16 * 1024 * 1024
# Bins' probabilities sum to 1 within this: the last bits of a float sum.
BIN_TOLERANCE = 1e-6


def request(args: dict[str, list[str]]) -> tuple[int, int, int]:
    """The grid a query asks for, as (from, to, step) in ms, or a ValueError naming the rule it breaks."""

    def whole(name: str) -> int:
        text = args.get(name, [""])[0]
        if not re.fullmatch(r"-?\d{1,16}", text):
            raise ValueError(f"{name} must be a whole number of milliseconds")
        return int(text)

    start, end, step = whole("from"), whole("to"), whole("step")
    if step not in STEPS:
        raise ValueError("step must be 900000, 3600000, 21600000 or 86400000")
    if start < 0 or start % step:
        raise ValueError("from must be a multiple of step")
    if end <= start:
        raise ValueError("to must be after from")
    if math.ceil((end - start) / step) > MAX_POINTS:
        raise ValueError(f"more than {MAX_POINTS} grid times")
    return start, end, step


def forward(url: str, start: int, end: int, step: int) -> tuple[int, bytes]:
    """Origo's status and body for the grid, or status 0 and the reason where there was no answer."""
    target = url + ("&" if "?" in url else "?") + urllib.parse.urlencode({"from": start, "to": end, "step": step})
    try:
        with urllib.request.urlopen(urllib.request.Request(target, headers={"Accept": "application/json"}), timeout=TIMEOUT_S) as response:
            return response.status, response.read(MAX_ANSWER + 1)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.read(MAX_ANSWER + 1)
    except (urllib.error.URLError, OSError) as error:
        return 0, str(error).encode()


def check(answer: object, start: int, end: int, step: int) -> None:
    """A ValueError unless ``answer`` is a ``cube-strip@1`` for this grid, saying where it is not."""

    def fail(where: str, what: str) -> NoReturn:
        raise ValueError(f"{where}: {what}")

    def finite(value: object) -> TypeGuard[float]:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    def ms(value: object, where: str) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            fail(where, "must be a time in ms")
        return value

    def mapping(value: object, where: str, keys: set[str]) -> dict:
        if not isinstance(value, dict):
            fail(where, "must be an object")
        missing = keys - value.keys()
        if missing:
            fail(where, f"lacks {', '.join(sorted(missing))}")
        return value

    def text(value: object, where: str, longest: int = 200) -> None:
        if not isinstance(value, str) or not value or len(value) > longest:
            fail(where, f"must be text of 1 to {longest} characters")

    def series(value: object, where: str, n: int) -> None:
        if not isinstance(value, list) or len(value) != n:
            fail(where, f"must be a list of {n} values")
        if not all(v is None or finite(v) for v in value):
            fail(where, "holds a value that is neither a finite number nor null")

    def quantiles(value: dict, where: str, positive: bool = False) -> None:
        p5, p50, p95 = value.get("p5"), value.get("p50"), value.get("p95")
        if not (finite(p5) and finite(p50) and finite(p95) and p5 <= p50 <= p95):
            fail(where, "p5, p50 and p95 must be finite and in order")
        if positive and p5 <= 0:
            fail(where, "prices must be positive")

    def estimate(value: object, where: str) -> None:
        e = mapping(value, where, {"charge", "from", "at", "skew", "reaction", "expiry"})
        if not finite(e["charge"]) or e["charge"] < 0:
            fail(f"{where}.charge", "must be a finite number of at least 0")
        if e["from"] not in SOURCES:
            fail(f"{where}.from", "must be options or history")
        ms(e["at"], f"{where}.at")
        if not finite(e["skew"]) or not -1 <= e["skew"] <= 1:
            fail(f"{where}.skew", "must be between -1 and 1")
        reaction = mapping(e["reaction"], f"{where}.reaction", {"p5", "p50", "p95", "bins"})
        quantiles(reaction, f"{where}.reaction")
        bins = reaction["bins"]
        if not isinstance(bins, list) or not bins:
            fail(f"{where}.reaction.bins", "must be a list of [low, high, probability]")
        for i, b in enumerate(bins):
            if not (isinstance(b, list) and len(b) == 3 and all(finite(v) for v in b) and b[0] < b[1] and b[2] >= 0):
                fail(f"{where}.reaction.bins[{i}]", "must be [low, high, probability] with low < high and probability >= 0")
            if i and b[0] < bins[i - 1][1]:
                fail(f"{where}.reaction.bins[{i}]", "overlaps the bin before it")
        if abs(sum(b[2] for b in bins) - 1) > BIN_TOLERANCE:
            fail(f"{where}.reaction.bins", "probabilities must sum to 1")
        if e["expiry"] is not None:
            expiry = mapping(e["expiry"], f"{where}.expiry", {"at", "p5", "p50", "p95", "share"})
            ms(expiry["at"], f"{where}.expiry.at")
            quantiles(expiry, f"{where}.expiry", positive=True)
            if not finite(expiry["share"]) or not 0 <= expiry["share"] <= 1:
                fail(f"{where}.expiry.share", "must be between 0 and 1")

    def measured(value: object, where: str) -> None:
        m = mapping(value, where, {"move", "bits", "at"})
        if not finite(m["move"]) or not finite(m["bits"]) or m["bits"] < 0:
            fail(where, "move must be finite and bits finite and at least 0")
        ms(m["at"], f"{where}.at")

    top = mapping(answer, "answer", {"schema", "model", "cutoff", "grid", "events", "jumps"})
    if top["schema"] != SCHEMA:
        fail("schema", f"must be {SCHEMA}")
    text(top["model"], "model")
    ms(top["cutoff"], "cutoff")
    grid = mapping(top["grid"], "grid", {"t0", "step", "forces", "attention", "close", "next24h"})
    if grid["t0"] != start or grid["step"] != step:
        fail("grid", f"must start at {start} with step {step}")
    n = math.ceil((end - start) / step)
    forces = mapping(grid["forces"], "grid.forces", set(FORCES))
    for force in FORCES:
        series(forces[force], f"grid.forces.{force}", n)
    series(grid["attention"], "grid.attention", n)
    series(grid["close"], "grid.close", n)
    series(grid["next24h"], "grid.next24h", n)
    if not all(a is None or 0 <= a <= 1 for a in grid["attention"]):
        fail("grid.attention", "must be between 0 and 1")
    if not all(c is None or c > 0 for c in grid["close"]):
        fail("grid.close", "must be positive")
    if not isinstance(top["events"], list):
        fail("events", "must be a list")
    seen = set()
    for i, value in enumerate(top["events"]):
        where = f"events[{i}]"
        e = mapping(value, where, {"id", "kind", "family", "name", "short", "at", "knownAt", "window", "prior", "estimate", "measured"})
        text(e["id"], f"{where}.id")
        if e["id"] in seen:
            fail(f"{where}.id", "repeats an earlier event's")
        seen.add(e["id"])
        text(e["kind"], f"{where}.kind", 32)
        if e["family"] not in FORCES:
            fail(f"{where}.family", f"must be one of {', '.join(FORCES)}")
        text(e["name"], f"{where}.name")
        text(e["short"], f"{where}.short", 8)
        if ms(e["knownAt"], f"{where}.knownAt") > ms(e["at"], f"{where}.at"):
            fail(f"{where}.knownAt", "must not be after the event")
        if not isinstance(e["window"], int) or isinstance(e["window"], bool) or not 0 < e["window"] <= 1440:
            fail(f"{where}.window", "must be 1 to 1440 minutes")
        estimate(e["prior"], f"{where}.prior")
        if e["estimate"] is not None:
            estimate(e["estimate"], f"{where}.estimate")
        if e["measured"] is not None:
            measured(e["measured"], f"{where}.measured")
    if not isinstance(top["jumps"], list):
        fail("jumps", "must be a list")
    for i, value in enumerate(top["jumps"]):
        where = f"jumps[{i}]"
        j = mapping(value, where, {"id", "at", "window", "move", "bits"})
        text(j["id"], f"{where}.id")
        ms(j["at"], f"{where}.at")
        if not isinstance(j["window"], int) or isinstance(j["window"], bool) or not 0 < j["window"] <= 1440:
            fail(f"{where}.window", "must be 1 to 1440 minutes")
        if not finite(j["move"]) or not finite(j["bits"]) or j["bits"] < 0:
            fail(where, "move must be finite and bits finite and at least 0")


def relay(url: str, args: dict[str, list[str]]) -> tuple[int, dict | bytes]:
    """The page's answer for a query: (200, the checked bytes), or a status and the error object the contract names."""
    try:
        start, end, step = request(args)
    except ValueError as error:
        return 400, {"error": "invalid_strip_request", "detail": str(error)}
    if not url:
        return 503, {"error": "strip_not_configured"}
    status, body = forward(url, start, end, step)
    if status != 200:
        reason = body[:300].decode("utf-8", "replace")
        return 502, {"error": "strip_upstream_failed", "detail": f"Origo answered {status}: {reason}" if status else f"Origo did not answer: {reason}"}
    if len(body) > MAX_ANSWER:
        return 502, {"error": "strip_invalid_answer", "detail": f"answer over {MAX_ANSWER} bytes"}
    try:
        check(json.loads(body), start, end, step)
    except (ValueError, RecursionError) as error:
        return 502, {"error": "strip_invalid_answer", "detail": str(error)}
    return 200, body
