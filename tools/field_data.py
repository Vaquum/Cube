"""The explorer's reader for field-data-api, the shared service of compact field-data projections and the calendar.

The bridge calls it from its own process: the service refuses browser requests, so the page never sees it. One update
reads one publication: it selects ``/v1/snapshots/latest`` once and passes that ``snapshot_id`` to every source and
calendar request, following each ``page.next_offset`` until it is null (Vaquum/field-data-api, docs/api.md "Select once,
then pin every read"). A source is handled on its own: one that is unavailable, stale or failing never fails the
update, and a dataset already held under the same ``dataset_id`` is not read again. Provider collection and credentials
belong to the service; this module only reads what it published.
"""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
PAGE_LIMIT = 500
# Bound progress by the API's offset range, independent of adaptive page size.
MAX_OFFSET = 100_000
SNAPSHOT_ID = re.compile(r"[0-9a-f]{64}\Z")
SOURCE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")


class FieldDataError(RuntimeError):
    """A bounded error that names its code and HTTP status, never a body, URL or token."""

    def __init__(self, code: str, status: int | None = None) -> None:
        self.code, self.status = code, status
        super().__init__(code + (f" (HTTP {status})" if status else ""))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ARG002 - the base class's signature
        # A redirect must not carry the bearer token anywhere else.
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


def _finite(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("nonfinite JSON number")
    return value


def _constant(_text: str) -> float:
    raise ValueError("nonfinite JSON constant")


@dataclass
class Dataset:
    """One source's published dataset, every page of it, as one pinned publication selected it."""

    source: str
    dataset_id: str
    received_at: str | None
    records: list
    meta: dict
    state: dict
    status: str
    projection_version: str | None = None
    publication_kind: str = "live"


@dataclass
class Publication:
    """What one update read: the publication it pinned, each source's state in it, the datasets read, and why a source
    has none (``unavailable[source]``: the service's state or the error)."""

    snapshot_id: str
    published_at: str
    scheduled_for: str | None
    states: dict
    datasets: dict = field(default_factory=dict)
    unavailable: dict = field(default_factory=dict)
    calendar: Dataset | None = None
    calendar_state: dict | None = None
    requests: int = 0


class FieldDataReader:
    def __init__(self, base_url: str, *, token: str | None = None, timeout: float = 15.0) -> None:
        parts = urllib.parse.urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError("FIELD_DATA_URL must be an HTTP(S) base URL without credentials, query or fragment")
        if token is not None and (not token or not token.isascii() or any(c.isspace() or ord(c) < 32 for c in token)):
            raise ValueError("FIELD_DATA_API_TOKEN must be nonempty ASCII without whitespace")
        if not 0 < timeout <= 120:
            raise ValueError("timeout must be between 0 and 120 seconds")
        self.base_url, self.token, self.timeout = base_url.rstrip("/"), token, timeout
        self.opener = urllib.request.build_opener(_NoRedirect())
        self.requests = 0

    def get(self, path: str, query: dict | None = None) -> dict:
        """One GET, as JSON; any failure as a FieldDataError."""
        query = {key: value for key, value in (query or {}).items() if value is not None}
        url = self.base_url + path + ("?" + urllib.parse.urlencode(query) if query else "")
        headers = {"Accept": "application/json", "User-Agent": "cube-explorer-strip/1"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        self.requests += 1
        try:
            with self.opener.open(urllib.request.Request(url, headers=headers, method="GET"), timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            status = error.code
            code = "http_error"
            try:
                body = json.loads(error.read(4096) or b"{}")
                code = str(body.get("error") or body.get("code") or code)[:64] if isinstance(body, dict) else code
            except (ValueError, OSError):
                pass
            finally:
                error.close()
            raise FieldDataError(code, status) from None
        except (urllib.error.URLError, OSError, TimeoutError):
            raise FieldDataError("transport_error") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise FieldDataError("response_too_large")
        try:
            value = json.loads(raw, parse_float=_finite, parse_constant=_constant)
        except (ValueError, UnicodeError, RecursionError):
            raise FieldDataError("invalid_json") from None
        if not isinstance(value, dict):
            raise FieldDataError("invalid_response")
        return value

    def snapshot(self, *, as_of: str | None = None) -> dict:
        value = self.get("/v1/snapshots/latest", {"as_of": as_of})
        if not isinstance(value.get("snapshot_id"), str) or not SNAPSHOT_ID.fullmatch(value["snapshot_id"]):
            raise FieldDataError("invalid_snapshot")
        if not isinstance(value.get("datasets"), dict) or not isinstance(value.get("published_at"), str):
            raise FieldDataError("invalid_snapshot")
        return value

    def pages(self, path: str, pin: str, source: str, query: dict | None = None) -> Dataset:
        """Every page of one pinned dataset, keeping the pin and filters on each, checked to be that publication's."""
        records, offset, first, limit = [], 0, None, PAGE_LIMIT
        while True:
            try:
                page = self.get(path, {"snapshot_id": pin, **(query or {}), "limit": limit, "offset": offset})
            except FieldDataError as error:
                if limit > 1 and (error.status == 413 or error.code == "response_too_large"):
                    limit = max(1, limit // 2)
                    continue
                raise
            if page.get("snapshot_id") != pin or page.get("source") != source:
                raise FieldDataError("snapshot_or_source_mismatch")
            data = page.get("data")
            if not isinstance(data, dict) or not isinstance(data.get("records"), list):
                raise FieldDataError("invalid_response")
            if first is None:
                first = page
            elif page.get("dataset_id") != first.get("dataset_id"):
                raise FieldDataError("dataset_changed_between_pages")
            records.extend(data["records"])
            next_offset = (page.get("page") or {}).get("next_offset")
            if next_offset is None:
                total = (page.get("page") or {}).get("total")
                if type(total) is int and len(records) != total:
                    raise FieldDataError("incomplete_dataset")
                break
            if type(next_offset) is not int or next_offset <= offset:
                raise FieldDataError("page_cursor_did_not_advance")
            if next_offset > MAX_OFFSET:
                raise FieldDataError("too_many_pages")
            offset = next_offset
        data = first["data"]
        return Dataset(source=source, dataset_id=str(first.get("dataset_id")), received_at=data.get("received_at"),
                       records=records, meta=data.get("meta") or {}, state=first.get("state") or {},
                       status=str(first.get("status") or (first.get("state") or {}).get("status") or "ok"),
                       projection_version=data.get("projection_version"), publication_kind=first.get("publication_kind", "live"))

    def publication(self, sources: tuple[str, ...], held: dict | None = None, *, as_of: str | None = None,
                    manifest: dict | None = None) -> Publication:
        """One update: the publication pinned once, then each source and the calendar read under that pin.

        ``held`` maps a source (or ``calendar``) to the Dataset this caller already holds; a source whose published
        ``dataset_id`` is the same is passed on as held, unread. A source without a dataset, or one the service
        refuses, is recorded in ``unavailable`` and never fails the rest. ``manifest`` is a snapshot the caller has
        just selected, pinned instead of selecting again."""
        held = held or {}
        start = self.requests
        manifest = manifest if manifest is not None else self.snapshot(as_of=as_of)
        pin = manifest["snapshot_id"]
        result = Publication(snapshot_id=pin, published_at=manifest["published_at"], scheduled_for=manifest.get("scheduled_for"),
                             states=manifest["datasets"])
        for source in sources:
            if not SOURCE_ID.fullmatch(source):
                raise ValueError(f"invalid source id {source!r}")
            state = manifest["datasets"].get(source)
            if not isinstance(state, dict):
                result.unavailable[source] = {"status": "not_in_catalogue"}
                continue
            if not state.get("dataset_id"):
                result.unavailable[source] = {"status": str(state.get("status") or "unavailable"), "reason": state.get("reason")}
                continue
            mine = held.get(source)
            if mine is not None and mine.dataset_id == state["dataset_id"]:
                result.datasets[source] = mine
                continue
            try:
                result.datasets[source] = self.pages("/v1/data/" + source, pin, source)
            except FieldDataError as error:
                result.unavailable[source] = {"status": "error", "error": error.code, "http": error.status}
        calendar = manifest.get("calendar")
        result.calendar_state = calendar if isinstance(calendar, dict) else None
        if isinstance(calendar, dict) and calendar.get("dataset_id"):
            mine = held.get("calendar")
            if mine is not None and mine.dataset_id == calendar["dataset_id"]:
                result.calendar = mine
            else:
                try:
                    result.calendar = self.pages("/v1/calendar", pin, "calendar")
                except FieldDataError as error:
                    result.unavailable["calendar"] = {"status": "error", "error": error.code, "http": error.status}
        else:
            result.unavailable["calendar"] = {"status": str((calendar or {}).get("status") or "unavailable")}
        result.requests = self.requests - start
        return result

    def history(self, source: str, *, before: str | None = None, before_id: str | None = None, limit: int = 100) -> dict:
        """Version metadata, newest first. Read complete bodies separately under their publication pins."""
        query = {"limit": limit, "include_data": 0, "before": before, "before_id": before_id}
        return self.get("/v1/history/" + source, query)

    def version(self, source: str, version: dict) -> Dataset:
        """Every record of one historical version, including native/calendar indexes."""
        pin = version.get("first_snapshot_id")
        if pin is None:  # compatibility with the service before explicit historical pins
            if not version.get("first_published_at"):
                raise FieldDataError("invalid_history_version")
            pin = self.snapshot(as_of=version["first_published_at"])["snapshot_id"]
        if not isinstance(pin, str) or not SNAPSHOT_ID.fullmatch(pin):
            raise FieldDataError("invalid_history_snapshot")
        dataset = self.pages("/v1/calendar" if source == "calendar" else "/v1/data/" + source, pin, source)
        if dataset.dataset_id != version.get("dataset_id"):
            raise FieldDataError("history_dataset_mismatch")
        return dataset
