"""The Strip in the bridge: a worker thread that reads field-data-api once per publication and the cube's own prices,
and the state ``/cube/strip`` answers from, so that no page request ever waits on either (docs/strip.md).

Each cycle selects the latest publication once and reads every source and the calendar under that pin, following every
page (``field_data.py``); a source that is unavailable or stale is recorded as such and never stops the rest. New
observations go into the store as first seen (``strip_model.py``). Prices come from the cube through the bridge's own
bar reader, in small reads paced apart, so that a page's reads never wait long behind them. The state is rebuilt only
when something moved, and swapped in whole.
"""

from __future__ import annotations

import math
import threading
import time
import traceback
from typing import Callable

import strip_contract
import strip_model as model
from field_data import FieldDataError, FieldDataReader
from strip_model import DAY, HOUR, MINUTE, Model, Prices, State, Store, build_state, ms, tail_bits

T0_MS = 1609459200000
BASE_MS = 56250
CHECK_SECONDS = 60
HISTORY_DAYS = 730
FINE_DAYS = 30
CHUNK_COLUMNS = 2048
PAUSE_SECONDS = 0.5
# How many published versions a start-up reads back per source: a day of five-minute versions.
BOOTSTRAP_VERSIONS = 300


def base_of(t_ms: float) -> float:
    return (t_ms - T0_MS) / BASE_MS


def ms_of(base: float) -> int:
    return int(round(T0_MS + base * BASE_MS))


class CubePrices:
    """The cube's closes: hourly for two years and every 15 minutes for the last 30 days, read in chunks as they are
    missing. ``read(n, b0, b1)`` is the bridge's bar reader: columns and closes of the bars at level n over base
    columns [b0, b1), in time order; it may raise when the cube has not measured that time yet."""

    def __init__(self, read: Callable[[int, int, float], tuple[list[int], list[float], list[float]]] | None) -> None:
        self.read = read
        self.hourly: dict[int, float] = {}  # bar end ms -> close
        self.fine: dict[int, float] = {}
        self.hourly_through = self.fine_through = None
        self.cutoff: int | None = None

    def _fill(self, store: dict, n: int, start_ms: int, end_ms: int) -> int | None:
        """Bars at level n from start_ms to end_ms, in chunks; the time read up to."""
        read = self.read
        assert read is not None
        span = 2**n
        b0 = math.floor(base_of(start_ms) / span) * span
        b_end = base_of(end_ms)
        read_to = None
        while b0 < b_end:
            b1 = min(b0 + CHUNK_COLUMNS * span, b_end)
            try:
                cols, _, closes = read(n, b0, b1)
            except Exception:  # the cube may not have measured this stretch; the rest stays readable
                b0 += CHUNK_COLUMNS * span
                time.sleep(PAUSE_SECONDS)
                continue
            for col, close in zip(cols, closes):
                if close and math.isfinite(close):
                    store[ms_of((col + 1) * span)] = close
            read_to = ms_of(b1)
            b0 += CHUNK_COLUMNS * span
            time.sleep(PAUSE_SECONDS)
        return read_to

    def refresh(self, now_ms: int) -> None:
        if self.read is None:
            return
        # Complete bars only: up to the start of the current hour, or of the current quarter hour.
        hour_end, fine_end = now_ms - now_ms % HOUR, now_ms - now_ms % (15 * MINUTE)
        start = self.hourly_through if self.hourly_through else now_ms - HISTORY_DAYS * DAY
        if hour_end > start:
            self.hourly_through = self._fill(self.hourly, 6, start, hour_end) or self.hourly_through
        start = self.fine_through if self.fine_through else now_ms - FINE_DAYS * DAY
        if fine_end > start:
            self.fine_through = self._fill(self.fine, 4, start, fine_end) or self.fine_through
        for store in (self.fine,):
            for t in [t for t in store if t < now_ms - FINE_DAYS * DAY - DAY]:
                del store[t]
        ends = [t for t in (self.hourly_through, self.fine_through) if t]
        self.cutoff = max(ends) if ends else None

    def prices(self) -> Prices:
        bars = dict(self.hourly)
        bars.update(self.fine)
        return Prices(list(bars.items()), self.cutoff)

    def move(self, start_ms: int, end_ms: int) -> float | None:
        """BTC's percent change from the base bar holding start_ms to the close of the one holding end_ms - 1."""
        if self.read is None:
            return None
        b0, b1 = math.floor(base_of(start_ms)), math.floor(base_of(end_ms - 1)) + 1
        try:
            cols, opens, closes = self.read(0, b0, b1)
        except Exception:
            return None
        if not cols or cols[0] != b0 or cols[-1] != b1 - 1 or not opens[0]:
            return None
        return (closes[-1] / opens[0] - 1) * 100


class StripService:
    def __init__(self, reader: FieldDataReader, store_path: str, bars=None, clock: Callable[[], float] = time.time) -> None:
        self.reader = reader
        self.store = Store(store_path)
        self.model = Model(self.store)
        self.prices = CubePrices(bars)
        self.clock = clock
        self.state: State | None = None
        self.held: dict = {}
        self.pinned: str | None = None
        self.publication: dict = {}
        self.manifest_states: dict = {}
        self.calendar_state: dict | None = None
        self.last_error: str | None = None
        self.cache: dict = {}
        self.prices_at = 0.0
        self.thread: threading.Thread | None = None

    # ------------------------------------------------------------ the worker

    def start(self) -> None:
        self.thread = threading.Thread(target=self.run, name="strip", daemon=True)
        self.thread.start()

    def run(self) -> None:
        try:
            self.bootstrap()
        except Exception as error:  # the cycle below still reads the latest publication
            self.last_error = f"bootstrap: {type(error).__name__}: {error}"
            traceback.print_exc()
        while True:
            try:
                self.cycle()
            except Exception as error:
                self.last_error = f"{type(error).__name__}: {error}"
                traceback.print_exc()
            time.sleep(CHECK_SECONDS)

    def cycle(self) -> bool:
        """Read the latest publication if it is new, and the cube's prices if five minutes have passed; rebuild the
        state when either moved. Returns whether it was rebuilt."""
        now = self.clock()
        moved = False
        manifest = self.reader.snapshot()
        if manifest["snapshot_id"] != self.pinned:
            moved = self.update() or moved
        if now - self.prices_at >= 300:
            self.prices_at = now
            self.prices.refresh(int(now * 1000))
            self.measure_reactions(int(now * 1000))
            moved = True
        if moved or self.state is None:
            self.rebuild()
        return moved

    def update(self, as_of: str | None = None) -> bool:
        """One pinned publication: every source and the calendar under one snapshot_id, each on its own."""
        pub = self.reader.publication(model.SOURCES, self.held, as_of=as_of)
        published = ms(pub.published_at) or int(self.clock() * 1000)
        for source, dataset in pub.datasets.items():
            interval = int((pub.states.get(source) or {}).get("collection_interval_seconds") or 300) * 1000
            self.model.ingest(source, dataset.dataset_id, dataset.records, dataset.meta, dataset.received_at, published, interval)
            self.held[source] = dataset
        if pub.calendar is not None:
            self.model.ingest_calendar(pub.calendar.dataset_id, pub.calendar.records, published)
            self.held["calendar"] = pub.calendar
        self.pinned = pub.snapshot_id
        self.publication = {"id": pub.snapshot_id, "publishedAt": published, "scheduledFor": ms(pub.scheduled_for),
                            "requests": pub.requests}
        self.manifest_states = {**pub.states, **{s: {**(pub.states.get(s) or {}), **why} for s, why in pub.unavailable.items()}}
        self.calendar_state = pub.calendar_state
        self.last_error = None
        return True

    def bootstrap(self) -> None:
        """At start, every source's published versions since the store last saw it, at most a day of five-minute
        versions back, read oldest first so that each observation is known at the publication that first carried it."""
        for source in model.SOURCES:
            versions, before, before_id = [], None, None
            while len(versions) < BOOTSTRAP_VERSIONS:
                try:
                    page = self.reader.history(source, before=before, before_id=before_id, limit=12)
                except FieldDataError:
                    break
                batch = page.get("versions") or []
                done = False
                for v in batch:
                    if self.store.has_dataset(source, v.get("dataset_id", "")):
                        done = True
                        break
                    versions.append(v)
                before, before_id = page.get("next_before"), page.get("next_before_id")
                if done or not batch or before is None:
                    break
            for v in reversed(versions):
                data = v.get("data") or {}
                interval = 300_000 if source in ("deribit_options", "deribit_dvol", "deribit_futures_basis", "gdelt_gkg", "bluesky_live",
                                                 "mempool_retarget") else 3_600_000 if source.endswith("_funding") or source == "wikimedia_hourly" else 21_600_000
                self.model.ingest(source, v["dataset_id"], data.get("records") or [], data.get("meta") or {}, data.get("received_at"),
                                  ms(v.get("first_published_at")) or int(self.clock() * 1000), interval)
        # The calendar's history lists index descriptors: each version's events are read through a publication pin.
        versions, before, before_id = [], None, None
        while len(versions) < 50:
            try:
                page = self.reader.history("calendar", before=before, before_id=before_id, limit=20)
            except FieldDataError:
                break
            batch = page.get("versions") or []
            done = False
            for v in batch:
                if self.store.has_dataset("calendar", v.get("dataset_id", "")):
                    done = True
                    break
                versions.append(v)
            before, before_id = page.get("next_before"), page.get("next_before_id")
            if done or not batch or before is None:
                break
        for v in reversed(versions):
            try:
                pub = self.reader.publication((), as_of=v["first_published_at"])
            except FieldDataError:
                continue
            if pub.calendar is not None and pub.calendar.dataset_id == v["dataset_id"]:
                self.model.ingest_calendar(pub.calendar.dataset_id, pub.calendar.records, ms(v["first_published_at"]) or ms(pub.published_at))

    def measure_reactions(self, now_ms: int) -> None:
        """Each timed event whose window has closed in the cube's data, once: BTC's move over its window from the cube's
        base bars, and its surprise against the ordinary spread over that window at DVOL as known when it opened."""
        if self.prices.read is None:
            return
        state = self.state
        done = self.store.reactions()
        dvol = state.dvol if state else None
        for event in (state.events if state else []):
            last = event["schedule"][-1]
            window = event.get("window")
            if event["id"] in done or not window or last["at"] is None or last["precision"] != "instant" or last["status"] != "scheduled":
                continue
            start, end = last["at"], last["at"] + window * MINUTE
            if end > (self.prices.cutoff or 0) or end > now_ms - 5 * MINUTE or start < now_ms - 30 * DAY:
                continue
            move = self.prices.move(start, end)
            if move is None:
                continue
            sigma = dvol.at(start)[0] if dvol else None
            ordinary = None if sigma is None else sigma * math.sqrt(window / model.MINUTES_A_YEAR)
            self.model.record_reaction(event["id"], {
                "from": start, "at": end, "move": round(move, 4), "series": event.get("series"),
                "ordinary": None if ordinary is None else round(ordinary, 4),
                "bits": None if not ordinary else round(tail_bits(move / ordinary), 3),
            })
            time.sleep(PAUSE_SECONDS)

    def rebuild(self) -> None:
        now = int(self.clock() * 1000)
        self.state = build_state(self.store, self.prices.prices(), self.publication, self.source_states(now), now, self.cache)

    # ------------------------------------------------------------ what the page reads

    def source_states(self, now_ms: int) -> dict:
        """Each source's state as the pinned publication gave it, with its age now, its newest observation and where its
        values stop being retrospective: what the page shows as freshness."""
        out = {}
        for source in (*model.SOURCES, "calendar"):
            s = (self.calendar_state if source == "calendar" else self.manifest_states.get(source)) or {}
            status = str(s.get("status") or ("unavailable" if self.manifest_states else "pending"))
            checked = ms(s.get("last_checked_at") or s.get("received_at"))
            interval = int(s.get("collection_interval_seconds") or 300)
            # The service's own rule for a collected source; the calendar is a supplied file, reused while unchanged.
            if source != "calendar" and status == "ok" and checked is not None and now_ms - checked > max(2 * interval, interval + 300) * 1000:
                status = "stale"
            newest = None
            for series in model.SERIES_OF.get(source, ()):
                observed = self.store.newest_observed(series)
                newest = observed if newest is None or (observed is not None and observed > newest) else newest
            first, _ = self.store.seen(source)
            out[source] = {"state": status, "checkedAt": checked, "receivedAt": ms(s.get("received_at")), "intervalSeconds": interval,
                           "observedAt": newest, "recordedFrom": first, "detail": s.get("reason") or s.get("error")}
        return out

    def answer(self, args: dict) -> tuple[int, dict | bytes]:
        """The page's answer for a query: the checked grid from the current state, or why there is none yet."""
        try:
            start, end, step = strip_contract.request(args)
        except ValueError as error:
            return 400, {"error": "invalid_strip_request", "detail": str(error)}
        state = self.state
        if state is None:
            return 503, {"error": "strip_loading", "detail": self.last_error or "the first publication is being read"}
        return 200, state.answer(start, end, step)
