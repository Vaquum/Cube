"""The Strip's page contract, ``cube-strip@2`` (docs/strip.md): the rules of a ``/cube/strip`` query, the declaration a
bridge that serves the strip writes into the page, and a check of an answer's shape.

The bridge builds its answers itself (``strip_service.py``) from field-data-api and the cube's prices; the fake cube
builds synthetic ones (tests/support/strip.js). ``check`` is the contract both are held to, so the page never reads
anything else.
"""

from __future__ import annotations

import math
import re
from typing import NoReturn, TypeGuard

SCHEMA = "cube-strip@2"
STEPS = (900_000, 3_600_000, 21_600_000, 86_400_000)
MAX_POINTS = 20_000
FORCES = ("macro", "positioning", "news", "social")
PRECISIONS = ("instant", "day", "range")
STATUSES = ("scheduled", "cancelled", "withdrawn")
CERTAINTIES = ("confirmed", "tentative", "rule_derived", "unspecified", "estimate")
IMPORTANCES = ("high", "medium", "low")
BUCKETS = ("same_day", "tomorrow_to_7d", "7_30d", "30_90d", "90d_plus")
DAY_MS = 86_400_000
DECLARATION = b'<meta name="explorer-strip" content="/cube/strip">'


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


def check(answer: object, start: int, end: int, step: int) -> None:
    """A ValueError unless ``answer`` is a ``cube-strip@2`` for this grid, saying where it is not."""

    def fail(where: str, what: str) -> NoReturn:
        raise ValueError(f"{where}: {what}")

    def finite(value: object) -> TypeGuard[float]:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    def ms(value: object, where: str, nullable: bool = False) -> int | None:
        if value is None and nullable:
            return None
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            fail(where, "must be a time in ms" + (" or null" if nullable else ""))
        return value

    def mapping(value: object, where: str, keys: set[str]) -> dict:
        if not isinstance(value, dict):
            fail(where, "must be an object")
        missing = keys - value.keys()
        if missing:
            fail(where, f"lacks {', '.join(sorted(missing))}")
        return value

    def text(value: object, where: str, longest: int = 240, nullable: bool = False) -> None:
        if value is None and nullable:
            return
        if not isinstance(value, str) or not value or len(value) > longest:
            fail(where, f"must be text of 1 to {longest} characters" + (" or null" if nullable else ""))

    def one_of(value: object, where: str, allowed: tuple, nullable: bool = False) -> None:
        if not (value in allowed or (nullable and value is None)):
            fail(where, f"must be one of {', '.join(allowed)}" + (" or null" if nullable else ""))

    def series(value: object, where: str, n: int, low: float | None = None, high: float | None = None) -> None:
        if not isinstance(value, list) or len(value) != n:
            fail(where, f"must be a list of {n} values")
        if not all(v is None or finite(v) for v in value):
            fail(where, "holds a value that is neither a finite number nor null")
        if low is not None and not all(v is None or low <= v <= (high if high is not None else v) for v in value):
            fail(where, f"must be between {low} and {high}")

    top = mapping(answer, "answer", {"schema", "model", "cutoff", "snapshot", "sources", "components", "attentionParts",
                                     "grid", "events", "jumps", "options"})
    if top["schema"] != SCHEMA:
        fail("schema", f"must be {SCHEMA}")
    text(top["model"], "model")
    ms(top["cutoff"], "cutoff")
    snapshot = mapping(top["snapshot"], "snapshot", {"id", "publishedAt"})
    text(snapshot["id"], "snapshot.id", 64, nullable=True)
    ms(snapshot["publishedAt"], "snapshot.publishedAt", nullable=True)
    if not isinstance(top["sources"], dict):
        fail("sources", "must be an object")
    for name, source in top["sources"].items():
        s = mapping(source, f"sources.{name}", {"state", "checkedAt", "observedAt", "recordedFrom"})
        text(s["state"], f"sources.{name}.state", 32)
        for key in ("checkedAt", "observedAt", "recordedFrom"):
            ms(s[key], f"sources.{name}.{key}", nullable=True)
    for group, keys in (("components", {"force", "label", "retroUntil"}), ("attentionParts", {"label", "weight", "retroUntil"})):
        if not isinstance(top[group], dict):
            fail(group, "must be an object")
        for name, part in top[group].items():
            p = mapping(part, f"{group}.{name}", keys)
            if group == "components":
                one_of(p["force"], f"{group}.{name}.force", FORCES)
            elif not finite(p["weight"]) or not 0 < p["weight"] <= 1:
                fail(f"{group}.{name}.weight", "must be above 0 and at most 1")
            text(p["label"], f"{group}.{name}.label", 64)
            ms(p["retroUntil"], f"{group}.{name}.retroUntil", nullable=True)

    grid = mapping(top["grid"], "grid", {"t0", "step", "forces", "attention", "close", "next24h", "dvol"})
    if grid["t0"] != start or grid["step"] != step:
        fail("grid", f"must start at {start} with step {step}")
    n = math.ceil((end - start) / step)
    forces = mapping(grid["forces"], "grid.forces", set(FORCES))
    for force in FORCES:
        series(forces[force], f"grid.forces.{force}", n)
    series(grid["attention"], "grid.attention", n, 0, 1)
    series(grid["close"], "grid.close", n)
    if not all(c is None or c > 0 for c in grid["close"]):
        fail("grid.close", "must be positive")
    series(grid["next24h"], "grid.next24h", n)
    series(grid["dvol"], "grid.dvol", n)
    if "parts" in grid:
        if not isinstance(grid["parts"], dict):
            fail("grid.parts", "must be an object")
        for name, part in grid["parts"].items():
            series(part, f"grid.parts.{name}", n)

    if not isinstance(top["events"], list):
        fail("events", "must be a list")
    seen = set()
    for i, value in enumerate(top["events"]):
        where = f"events[{i}]"
        e = mapping(value, where, {"id", "kind", "family", "name", "short", "region", "origin", "series", "link", "window",
                                   "schedule", "measured", "history"})
        text(e["id"], f"{where}.id", 160)
        if e["id"] in seen:
            fail(f"{where}.id", "repeats an earlier event's")
        seen.add(e["id"])
        text(e["kind"], f"{where}.kind", 64)
        one_of(e["family"], f"{where}.family", FORCES)
        text(e["name"], f"{where}.name")
        text(e["short"], f"{where}.short", 8)
        text(e["region"], f"{where}.region", 64, nullable=True)
        text(e["link"], f"{where}.link", 2048, nullable=True)
        window = e["window"]
        if window is not None and (not isinstance(window, int) or isinstance(window, bool) or not 0 < window <= 1440):
            fail(f"{where}.window", "must be 1 to 1440 minutes or null")
        schedule = e["schedule"]
        if not isinstance(schedule, list) or not schedule:
            fail(f"{where}.schedule", "must be a list of at least one entry")
        last = -1
        for k, item in enumerate(schedule):
            w = f"{where}.schedule[{k}]"
            s = mapping(item, w, {"knownAt", "at", "precision", "end", "status", "certainty", "importance", "weight"})
            known = ms(s["knownAt"], f"{w}.knownAt")
            if known is None or known <= last:
                fail(f"{w}.knownAt", "must be after the entry before it")
            last = known
            one_of(s["precision"], f"{w}.precision", PRECISIONS)
            one_of(s["status"], f"{w}.status", STATUSES)
            one_of(s["certainty"], f"{w}.certainty", CERTAINTIES)
            one_of(s["importance"], f"{w}.importance", IMPORTANCES, nullable=True)
            if not finite(s["weight"]) or not 0 <= s["weight"] <= 1:
                fail(f"{w}.weight", "must be between 0 and 1")
            at = ms(s["at"], f"{w}.at", nullable=True)
            if (at is None) != (s["status"] != "scheduled"):
                fail(f"{w}.at", "must be null exactly when the event is cancelled or withdrawn")
            if at is None:
                ms(s.get("lastAt"), f"{w}.lastAt")
            end_at = ms(s["end"], f"{w}.end", nullable=True)
            if at is not None:
                if s["precision"] == "day" and end_at != at + DAY_MS:
                    fail(f"{w}.end", "must be a day after a date's start")
                if s["precision"] == "range" and (end_at is None or end_at <= at):
                    fail(f"{w}.end", "must be after a range's start")
                if s["precision"] == "instant" and end_at is not None:
                    fail(f"{w}.end", "must be null for an instant")
        measured = e["measured"]
        if measured is not None:
            m = mapping(measured, f"{where}.measured", {"from", "at", "move", "bits"})
            if not finite(m["move"]) or (m["bits"] is not None and (not finite(m["bits"]) or m["bits"] < 0)):
                fail(f"{where}.measured", "move must be finite and bits finite and at least 0, or null")
            start_at = ms(m["from"], f"{where}.measured.from")
            final = schedule[-1]
            if window is None or start_at is None or final["precision"] != "instant" or start_at != final["at"]:
                fail(f"{where}.measured.from", "must be the event's last scheduled instant")
            if ms(m["at"], f"{where}.measured.at") != start_at + window * 60_000:
                fail(f"{where}.measured.at", "must be from + window")
        history = mapping(e["history"], f"{where}.history", {"moves"})
        moves = history["moves"]
        if not isinstance(moves, list) or not all(isinstance(m, list) and len(m) == 2 and ms(m[0], f"{where}.history.moves") is not None
                                                  and finite(m[1]) for m in moves):
            fail(f"{where}.history.moves", "must be a list of [ms, percent]")
        if any(moves[k][0] < moves[k - 1][0] for k in range(1, len(moves))):
            fail(f"{where}.history.moves", "must be in time order")

    if not isinstance(top["jumps"], list):
        fail("jumps", "must be a list")
    for i, value in enumerate(top["jumps"]):
        where = f"jumps[{i}]"
        j = mapping(value, where, {"id", "at", "window", "move", "bits"})
        text(j["id"], f"{where}.id", 64)
        ms(j["at"], f"{where}.at")
        if not isinstance(j["window"], int) or isinstance(j["window"], bool) or not 0 < j["window"] <= 1440:
            fail(f"{where}.window", "must be 1 to 1440 minutes")
        if not finite(j["move"]) or not finite(j["bits"]) or j["bits"] < 0:
            fail(where, "move must be finite and bits finite and at least 0")

    if not isinstance(top["options"], list):
        fail("options", "must be a list")
    last = -1
    for i, value in enumerate(top["options"]):
        where = f"options[{i}]"
        o = mapping(value, where, {"at", "atm", "skew", "putCall"})
        at = ms(o["at"], f"{where}.at")
        if at is None or at <= last:
            fail(f"{where}.at", "must be after the sample before it")
        last = at
        atm = mapping(o["atm"], f"{where}.atm", set())
        for bucket, iv in atm.items():
            one_of(bucket, f"{where}.atm", BUCKETS)
            if not finite(iv) or iv < 0:
                fail(f"{where}.atm.{bucket}", "must be a finite volatility of at least 0")
        for key in ("skew", "putCall"):
            if o[key] is not None and not finite(o[key]):
                fail(f"{where}.{key}", "must be finite or null")
