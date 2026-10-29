"""Native daily ETF fund net flows, pinned to field-data-api publications.

Economic dates never establish availability. Every retained capture is replayed at
its first actual publication; settlements and revisions replace a day's report only
from that publication onward. No provider calls, price queries or request-time I/O.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import math
import re
import sqlite3
import threading
import time
from datetime import UTC, datetime

from field_data import FieldDataError, FieldDataReader

SOURCE = "sosovalue_etf_flows"
SCHEMA = "cube-etf@1"
SCALE_USD = 1_000_000_000
DECLARATION = b'<meta name="explorer-etf" content="/cube/etf">'


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(instant.timestamp() * 1000) if instant.tzinfo is not None else None
    except ValueError:
        return None


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def project(records):
    """Use each selected fund once. Adapter totals qualify completeness, never add to it."""
    if not isinstance(records, list) or any(not isinstance(row, dict) or not isinstance(row.get("values", {}), dict) for row in records):
        raise ValueError("Invalid ETF fund projection")
    funds, duplicate = {}, set()
    for row in records:
        if row.get("kind") != "etf_fund_flow":
            continue
        v = row.get("values") or {}
        key = (row.get("observed_at"), v.get("ticker"))
        if not isinstance(key[1], str):
            continue
        if key in funds and funds[key] != v:
            duplicate.add(key)
        funds[key] = v
    out = []
    for row in records:
        if row.get("kind") != "etf_flow_aggregate":
            continue
        v, day = row.get("values") or {}, row.get("observed_at")
        expected = v.get("expected_funds")
        if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        if timestamp(day + "T00:00:00Z") is None:
            continue
        if not isinstance(expected, list) or not 0 < len(expected) <= 30 or not all(isinstance(t, str) and 0 < len(t) <= 15 for t in expected):
            continue
        if len(set(expected)) != len(expected):
            continue
        selected = []
        for ticker in sorted(expected):
            fund = funds.get((day, ticker)) or {}
            net = number(fund.get("net_inflow")) if fund.get("flow_unit") == "USD" and (day, ticker) not in duplicate else None
            selected.append({"ticker": ticker, "net": net})
        known = [f["net"] for f in selected if f["net"] is not None]
        inflow, outflow = (math.fsum(max(0, n) for n in known), math.fsum(max(0, -n) for n in known)) if known else (None, None)
        aggregate = number(v.get("net_inflow_usd"))
        complete = (v.get("complete_selected_funds") is True and len(known) == len(expected)
                    and v.get("unit", "USD") == "USD" and aggregate is not None
                    and math.isclose(inflow - outflow, aggregate, rel_tol=1e-12, abs_tol=.01))
        report = {"date": day, "funds": selected, "reported": len(known), "expected": len(expected),
                  "complete": complete, "inflow": inflow, "outflow": outflow,
                  "net": inflow - outflow if complete else None,
                  "magnitude": inflow + outflow if complete else None,
                  "universe": v.get("selected_universe_hash") or hashlib.sha256(json.dumps(sorted(expected)).encode()).hexdigest(),
                  "allCurrentFunds": v.get("all_current_catalogue_funds_selected") is True}
        out.append(report)
    return sorted(out, key=lambda r: (r["date"], r["universe"]))


def timeline(captures):
    """Latest economic date known at each publication, including changes to that date."""
    by_date, states, previous = {}, [], None
    for known_at, reports in captures:
        for report in reports:
            prior = by_date.get(report["date"])
            if prior is None or {k: v for k, v in prior.items() if k != "reportPublishedAt"} != report:
                by_date[report["date"]] = {**report, "reportPublishedAt": known_at}
        if not by_date:
            continue
        latest = by_date[max(by_date)]
        prior = [r for day, r in sorted(by_date.items()) if day < latest["date"] and r["complete"] and r["universe"] == latest["universe"]][-20:]
        values = sorted(r["magnitude"] for r in prior)
        normal = (values[9] + values[10]) / 2 if len(values) == 20 else None
        body = {**latest, "normal": normal, "normalReports": len(values)}
        identity = json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False)
        if identity != previous:
            entry = {**body, "knownAt": known_at}
            if states and states[-1]["knownAt"] == known_at:
                states[-1] = entry
            else:
                states.append(entry)
            previous = identity
    return states


class EtfService:
    def __init__(self, reader: FieldDataReader, path=":memory:", clock=time.time):
        self.reader, self.clock = reader, clock
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS etf_captures (id TEXT PRIMARY KEY, known_at INTEGER, body TEXT);
            CREATE TABLE IF NOT EXISTS etf_checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT);
        """)
        self.snapshot, self.source, self.states, self.error = None, {}, [], None
        self.history_ready = False
        saved = self.db.execute("SELECT body FROM etf_checkpoint WHERE id=1").fetchone()
        if saved:
            checkpoint = json.loads(saved[0])
            self.snapshot, self.source = checkpoint["snapshot"], checkpoint["source"]
        self.rebuild()
        self.publish()

    def publish(self):
        # Request threads take one immutable view; a new capture cannot be paired
        # with the previous publication's source status or snapshot identity.
        self.current = (self.snapshot, self.source, self.states, self.history_ready)

    def ingest(self, dataset, published):
        known = timestamp(published)
        if known is None:
            raise ValueError("ETF capture has no publication time")
        reports = project(dataset.records)
        if dataset.records and not reports:
            raise ValueError("ETF projection contains no qualified fund reports")
        self.db.execute("INSERT INTO etf_captures VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET known_at=MIN(known_at,excluded.known_at)",
                        (dataset.dataset_id, known, json.dumps(reports, allow_nan=False, separators=(",", ":"))))

    def rebuild(self):
        self.states = timeline([(known, json.loads(body)) for known, body in self.db.execute("SELECT known_at,body FROM etf_captures ORDER BY known_at,id")])

    def bootstrap(self):
        versions, before, before_id = [], None, None
        while True:
            page = self.reader.history(SOURCE, before=before, before_id=before_id, limit=100)
            batch = page.get("versions") or []
            versions.extend(batch)
            next_before, next_id = page.get("next_before"), page.get("next_before_id")
            if not batch or next_before is None:
                break
            if before is not None and (next_before, next_id or "") >= (before, before_id or ""):
                raise ValueError("ETF history cursor did not advance")
            before, before_id = next_before, next_id
        for version in reversed(versions):
            if self.db.execute("SELECT 1 FROM etf_captures WHERE id=?", (version["dataset_id"],)).fetchone():
                continue
            self.ingest(self.reader.version(SOURCE, version), version.get("first_published_at"))
        self.rebuild()
        self.history_ready = True

    def cycle(self):
        manifest = self.reader.snapshot()
        state = manifest.get("datasets", {}).get(SOURCE) or {"status": "not_in_catalogue"}
        dataset_id = state.get("dataset_id")
        if dataset_id and not self.db.execute("SELECT 1 FROM etf_captures WHERE id=?", (dataset_id,)).fetchone():
            dataset = self.reader.pages("/v1/data/" + SOURCE, manifest["snapshot_id"], SOURCE)
            self.ingest(dataset, manifest["published_at"])
            self.rebuild()
        self.snapshot = {"id": manifest["snapshot_id"], "publishedAt": timestamp(manifest["published_at"])}
        self.source = {"state": state.get("status", "unavailable"), "checkedAt": timestamp(state.get("last_checked_at")),
                       "receivedAt": timestamp(state.get("received_at")), "intervalSeconds": state.get("collection_interval_seconds", 21600),
                       "detail": state.get("reason") or state.get("error")}
        self.db.execute("INSERT OR REPLACE INTO etf_checkpoint VALUES(1,?)", (json.dumps({"snapshot": self.snapshot, "source": self.source}),))
        self.error = None
        self.publish()

    def start(self):
        def run():
            while True:
                try:
                    if not self.history_ready:
                        self.bootstrap()
                except (FieldDataError, ValueError, OSError, sqlite3.Error) as error:
                    self.error = str(error)
                try:
                    self.cycle()
                except (FieldDataError, ValueError, OSError, sqlite3.Error) as error:
                    self.error = str(error)
                time.sleep(60)
        threading.Thread(target=run, name="etf", daemon=True).start()

    def answer(self, args):
        try:
            values = []
            for key in ("from", "to", "as_of"):
                text = args.get(key, [""])[0]
                if not re.fullmatch(r"\d{1,16}", text):
                    raise ValueError(key + " must be whole epoch milliseconds")
                values.append(int(text))
            start, end, edge = values
            if start >= end or end - start > 3660 * 86400000:
                raise ValueError("ETF range must be positive and at most ten years")
        except (ValueError, TypeError, IndexError) as error:
            return 400, {"error": "invalid_etf_request", "detail": str(error)}
        snapshot, current_source, states, history_ready = self.current
        if snapshot is None:
            return 503, {"error": "etf_loading", "detail": self.error or "Reading retained ETF publications"}
        source = dict(current_source)
        checked = source.get("checkedAt")
        interval = source.get("intervalSeconds") or 21600
        if source.get("state") == "ok" and checked is not None and self.clock() * 1000 - checked > max(interval * 2, interval + 300) * 1000:
            source["state"] = "stale"
        if self.error:
            source.update(state="error", detail=self.error)
        elif not history_ready:
            source.update(state="partial", detail="Retained ETF publication history is still loading")
        stops = [s["knownAt"] for s in states]
        lo = max(0, bisect.bisect_left(stops, start) - 1)
        hi = bisect.bisect_left(stops, min(end, edge))
        return 200, {"schema": SCHEMA, "model": "etf-fund-flows@1", "snapshot": snapshot, "source": source,
                     "scaleUsd": SCALE_USD, "from": start, "to": end, "asOf": edge,
                     "historyReady": history_ready, "states": states[lo:hi] if hi > lo else []}
