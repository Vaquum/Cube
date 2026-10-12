"""Immutable, bounded durable investigation storage behind the portal login."""
from __future__ import annotations
import hashlib
import json
import os
import re
import sqlite3
from pathlib import Path

MAX_BYTES = 16 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024


class InvestigationStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path(os.environ.get("CUBE_INVESTIGATIONS", "/var/lib/cube-explorer/investigations.sqlite"))

    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("CREATE TABLE IF NOT EXISTS investigations (id TEXT PRIMARY KEY, body BLOB NOT NULL)")
        return connection

    def put(self, body: bytes) -> str:
        if not 0 < len(body) <= MAX_BYTES:
            raise ValueError("Investigation exceeds 16 MiB")
        document = json.loads(body)
        if not isinstance(document, dict) or document.get("schema") != "cube-analysis@1":
            raise ValueError("Unsupported investigation schema")
        # The browser/Node shared validator validates analytical content before application.
        # The store preserves exact bytes; it never executes, repairs or replaces evidence.
        identity = hashlib.sha256(body).hexdigest()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            prior = connection.execute("SELECT body FROM investigations WHERE id=?", (identity,)).fetchone()
            if prior:
                if prior[0] != body:
                    raise ValueError("Investigation digest collision")
                return identity
            total = connection.execute("SELECT COALESCE(SUM(length(body)),0) FROM investigations").fetchone()[0]
            if total + len(body) > MAX_TOTAL:
                raise ValueError("Investigation store is full; export the complete document")
            connection.execute("INSERT INTO investigations VALUES (?,?)", (identity, body))
        return identity

    def get(self, identity: str) -> bytes | None:
        if not re.fullmatch(r"[a-f0-9]{64}", identity):
            raise ValueError("Invalid investigation reference")
        with self.connection() as connection:
            record = connection.execute("SELECT body FROM investigations WHERE id=?", (identity,)).fetchone()
        if not record:
            return None
        body = record[0]
        if hashlib.sha256(body).hexdigest() != identity:
            raise ValueError("Stored investigation integrity failure")
        return body
