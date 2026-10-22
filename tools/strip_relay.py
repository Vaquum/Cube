"""The Strip behind the explorer's own origin: ``GET /cube/strip`` relayed to Origo.

The page asks its origin for ``/cube/strip?proto=2&from=<ms>&to=<ms>&step=<ms>``. ``tools/cube_bridge.py`` forwards the same grid to
the URL in ``STRIP_URL`` and passes the answer on once it has the ``cube-strip@1`` shape that ``docs/strip.md`` sets out, so the page
never reads anything else. A bridge with ``STRIP_URL`` declares so in the page with ``<meta name="explorer-strip">``; without it the
strip is not served, the page never asks, and it says so.
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
SOURCES = (*FORCES, "attention", "calendar", "history", "options")
DECLARATION = b'<meta name="explorer-strip" content="/cube/strip">'
TIMEOUT_S = 20
MAX_ANSWER = 16 * 1024 * 1024
# Bins' probabilities sum to 1 within this: the last bits of a float sum.
BIN_TOLERANCE = 1e-6


def declare(page: bytes) -> bytes:
    """The page with the strip declared in its head."""
    return page.replace(b"<head>", b"<head>\n    " + DECLARATION, 1)


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

    def window(value: object, where: str) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or not 0 < value <= 1440:
            fail(where, "must be 1 to 1440 minutes")
        return value

    def reaction(value: object, where: str) -> None:
        r = mapping(value, where, {"p5", "p50", "p95", "bins"})
        quantiles(r, where)
        bins = r["bins"]
        if not isinstance(bins, list) or not bins:
            fail(f"{where}.bins", "must be a list of [low, high, probability]")
        for i, b in enumerate(bins):
            if not (isinstance(b, list) and len(b) == 3 and all(finite(v) for v in b) and b[0] < b[1] and b[2] >= 0):
                fail(f"{where}.bins[{i}]", "must be [low, high, probability] with low < high and probability >= 0")
            if i and b[0] < bins[i - 1][1]:
                fail(f"{where}.bins[{i}]", "overlaps the bin before it")
        if abs(sum(b[2] for b in bins) - 1) > BIN_TOLERANCE:
            fail(f"{where}.bins", "probabilities must sum to 1")

    def expectation(value: object, where: str, keys: set[str]) -> dict:
        e = mapping(value, where, {"at", "charge", "skew", "reaction"} | keys)
        ms(e["at"], f"{where}.at")
        if not finite(e["charge"]) or e["charge"] < 0:
            fail(f"{where}.charge", "must be a finite number of at least 0")
        if not finite(e["skew"]) or not -1 <= e["skew"] <= 1:
            fail(f"{where}.skew", "must be between -1 and 1")
        reaction(e["reaction"], f"{where}.reaction")
        return e

    def estimates(value: object, where: str) -> None:
        if not isinstance(value, list):
            fail(where, "must be a list")
        last = -1
        for i, item in enumerate(value):
            e = expectation(item, f"{where}[{i}]", {"expiry"})
            if e["at"] <= last:
                fail(f"{where}[{i}].at", "must be after the estimate before it")
            last = e["at"]
            if e["expiry"] is not None:
                expiry = mapping(e["expiry"], f"{where}[{i}].expiry", {"at", "p5", "p50", "p95", "share"})
                ms(expiry["at"], f"{where}[{i}].expiry.at")
                quantiles(expiry, f"{where}[{i}].expiry", positive=True)
                if not finite(expiry["share"]) or not 0 <= expiry["share"] <= 1:
                    fail(f"{where}[{i}].expiry.share", "must be between 0 and 1")

    def schedule(value: object, where: str) -> int | None:
        """The event's last scheduled time, or None where it was cancelled."""
        if not isinstance(value, list) or not value:
            fail(where, "must be a list of at least one {knownAt, at}")
        last = -1
        for i, item in enumerate(value):
            entry = mapping(item, f"{where}[{i}]", {"knownAt", "at"})
            known = ms(entry["knownAt"], f"{where}[{i}].knownAt")
            if known <= last:
                fail(f"{where}[{i}].knownAt", "must be after the entry before it")
            last = known
            if entry["at"] is not None and ms(entry["at"], f"{where}[{i}].at") < known:
                fail(f"{where}[{i}].knownAt", "must not be after the event")
        return value[-1]["at"]

    def measured(value: object, where: str, minutes: int, last: int | None) -> None:
        m = mapping(value, where, {"from", "at", "move", "bits"})
        if not finite(m["move"]) or not finite(m["bits"]) or m["bits"] < 0:
            fail(where, "move must be finite and bits finite and at least 0")
        if ms(m["from"], f"{where}.from") != last:
            fail(f"{where}.from", "must be the event's last scheduled time")
        if ms(m["at"], f"{where}.at") != m["from"] + minutes * 60_000:
            fail(f"{where}.at", "must be from + window")

    top = mapping(answer, "answer", {"schema", "model", "cutoff", "sources", "grid", "events", "jumps"})
    if top["schema"] != SCHEMA:
        fail("schema", f"must be {SCHEMA}")
    text(top["model"], "model")
    ms(top["cutoff"], "cutoff")
    sources = mapping(top["sources"], "sources", set(SOURCES))
    for name in SOURCES:
        source = mapping(sources[name], f"sources.{name}", {"method", "recordedFrom", "fittedThrough"})
        text(source["method"], f"sources.{name}.method", 64)
        for key in ("recordedFrom", "fittedThrough"):
            if source[key] is not None:
                ms(source[key], f"sources.{name}.{key}")
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
        e = mapping(value, where, {"id", "kind", "family", "name", "short", "window", "schedule", "prior", "estimates", "measured"})
        text(e["id"], f"{where}.id")
        if e["id"] in seen:
            fail(f"{where}.id", "repeats an earlier event's")
        seen.add(e["id"])
        text(e["kind"], f"{where}.kind", 32)
        if e["family"] not in FORCES:
            fail(f"{where}.family", f"must be one of {', '.join(FORCES)}")
        text(e["name"], f"{where}.name")
        text(e["short"], f"{where}.short", 8)
        minutes = window(e["window"], f"{where}.window")
        last = schedule(e["schedule"], f"{where}.schedule")
        prior = expectation(e["prior"], f"{where}.prior", {"n"})
        if not isinstance(prior["n"], int) or isinstance(prior["n"], bool) or prior["n"] < 0:
            fail(f"{where}.prior.n", "must be a whole number of at least 0")
        estimates(e["estimates"], f"{where}.estimates")
        if e["measured"] is not None:
            measured(e["measured"], f"{where}.measured", minutes, last)
    if not isinstance(top["jumps"], list):
        fail("jumps", "must be a list")
    for i, value in enumerate(top["jumps"]):
        where = f"jumps[{i}]"
        j = mapping(value, where, {"id", "at", "window", "move", "bits"})
        text(j["id"], f"{where}.id")
        ms(j["at"], f"{where}.at")
        window(j["window"], f"{where}.window")
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
