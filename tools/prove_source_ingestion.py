#!/usr/bin/env python3
"""Local proof using public funding history and a live social stream. No production writes or raw post retention."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--field-data-root", type=Path, required=True)
    parser.add_argument("--live", action="store_true", required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.field_data_root.resolve()))
    from field_data_api.bluesky_capture import ContinuousCapture
    from field_data_api.sources.core import HttpClient, stamp
    from field_data_api.sources.deribit import funding
    from strip_model import HOUR, Model, Store, ms

    with tempfile.TemporaryDirectory() as directory:
        now = time.time()
        end = int(now) // 3600 * 3600
        raw = funding(HttpClient(directory), start=stamp(end - 3 * 86400), end=stamp(end))
        assert len(raw["records"]) > 1
        store = Store()
        model = Model(store)
        latest = max(raw["records"], key=lambda r: ms(r["observed_at"]))
        model.ingest("deribit_funding", "initial", [latest], raw["meta"], stamp(now), int(now * 1000), HOUR)
        before = store.db.execute("SELECT * FROM obs").fetchone()
        model.ingest("deribit_funding", "backfill", raw["records"], raw["meta"], stamp(now + 1),
                     int((now + 1) * 1000), HOUR, retrospective=True)
        rows = store.db.execute("SELECT * FROM obs").fetchall()
        assert len(rows) == len(raw["records"])
        assert store.db.execute("SELECT * FROM obs WHERE obs_id=?", (before[1],)).fetchone() == before
        added = [r for r in rows if r[1] != before[1]]
        assert all(r[3] == r[2] and r[4] == 1 for r in added)
        result = {"funding": {"provider_observations": len(raw["records"]), "retained_observations": len(rows),
            "later_backfill_observations": len(added), "backfilled_times_retrospective": True, "first_observation_unchanged": True}}

        capture = ContinuousCapture(directory)
        capture.start()
        start, partial_at, partial_id = time.time(), None, None
        try:
            while time.time() - start < 135:
                try:
                    data = capture.journal.read()
                except Exception:
                    time.sleep(1)
                    continue
                records = data["records"]
                if partial_at is None:
                    # Observe a minute that started after connection, while it is still open.
                    candidates = [r for r in records if ms(r["observed_at"]) > start * 1000 and
                                  r["metadata"]["full_minute_connection_coverage"] is False]
                    if candidates:
                        partial_id = candidates[-1]["id"]
                        partial_at = time.time()
                        model.ingest("bluesky_live", "partial", records, data["meta"], stamp(partial_at),
                                     int(partial_at * 1000), 300000)
                        assert store.db.execute("SELECT 1 FROM obs WHERE obs_id=?", (partial_id,)).fetchone() is None
                complete = [r for r in records if r["metadata"]["full_minute_connection_coverage"] and
                            not r["metadata"]["cursor_gap_overlap"]]
                if partial_id and any(r["id"] == partial_id for r in complete):
                    finished = time.time()
                    count = model.ingest("bluesky_live", "complete", records, data["meta"], stamp(finished),
                                         int(finished * 1000), 300000)
                    stored = store.db.execute("SELECT obs_id,extra FROM obs WHERE series='bluesky'").fetchall()
                    expected = {r["id"]: r["values"] for r in complete}
                    assert {identity: json.loads(extra)["creates"] for identity, extra in stored} == {
                        identity: values["creates"] for identity, values in expected.items()}
                    result["social"] = {"capture_seconds": round(finished - start, 2), "minute_rows": len(records),
                        "complete_minutes_admitted": count, "creates_in_admitted_minutes": sum(v["creates"] for v in expected.values()),
                        "partial_minute_deferred_until_complete": True, "all_complete_counts_equal": True,
                        "raw_posts_retained": False}
                    break
                time.sleep(1)
            else:
                raise AssertionError("No continuously covered minute completed during the live proof")
        finally:
            capture.stop()
        print(json.dumps({"origin": "public providers captured locally", **result}, indent=2))


if __name__ == "__main__":
    main()
