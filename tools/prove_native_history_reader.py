#!/usr/bin/env python3
"""Local proof against an actual field-data-api checkout and saved provider captures.

Creates a temporary SQLite service on loopback and reads it through the Cube's
reader/model. No provider request, production write or deployment occurs.
"""
import argparse
import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--field-data-root", type=Path, required=True)
    parser.add_argument("--captures", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.field_data_root.resolve()))
    from field_data_api.api import make_server
    from field_data_api.collector import Collector
    from field_data_api.config import Config
    from field_data_api.sources.core import stamp
    from field_data_api.storage import SQLiteStore
    from field_data import FieldDataReader
    from strip_service import StripService

    sources = ("fred_macro_daily", "defillama_stablecoins")
    captures = {s: json.loads((args.captures / (s + ".json")).read_text()) for s in sources}
    def replay(raw):
        def adapter(http):
            return copy.deepcopy(raw)
        return adapter
    with tempfile.TemporaryDirectory() as directory:
        store = SQLiteStore(directory)
        store.initialize()
        collector = Collector(Config(state_dir=directory), store,
            source_specs={s: SimpleNamespace(adapter=replay(raw), required_env=[]) for s, raw in captures.items()},
            transport_factory=lambda *a, **k: SimpleNamespace(trace=[]))
        states = {s: collector.collect(s) for s in sources}
        assert all(s["status"] == "ok" for s in states.values()), states
        now = stamp()
        snapshot = store.publish({"schema_version": 1, "scheduled_for": now, "published_at": now, "datasets": states})
        server = make_server(store, "127.0.0.1", 0, token="local-proof-only")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            reader = FieldDataReader("http://127.0.0.1:" + str(server.server_address[1]), token="local-proof-only")
            result = {}
            for source, raw in captures.items():
                version = reader.history(source)["versions"][0]
                assert "data" not in version
                assert version["first_snapshot_id"] == snapshot["snapshot_id"]
                data = reader.version(source, version)
                assert {r["id"]: r for r in data.records} == {r["id"]: r for r in raw["records"]}
                result[source] = {"input_records": len(raw["records"]), "retained_records": len(data.records),
                                  "all_fields_equal": True, "historical_pin_matches": True}
            service = StripService(reader, ":memory:")
            service.bootstrap()
            count = service.store.db.execute("SELECT count(*) FROM obs").fetchone()[0]
            assert count == sum(len(raw["records"]) for raw in captures.values()), count
            assert not service.history_errors, service.history_errors
            start = reader.requests
            service.bootstrap()
            assert service.store.db.execute("SELECT count(*) FROM obs").fetchone()[0] == count
            print(json.dumps({"origin": "saved real provider captures served by actual local field-data-api",
                "sources": result, "model_observations": count, "repeat_bootstrap_unchanged": True,
                "repeat_metadata_requests": reader.requests - start}, indent=2))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
