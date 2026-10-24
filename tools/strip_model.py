"""The Strip's model: its forces, attention, events and options context, from field-data-api publications and the cube's
own prices, each value kept as it was first computed (docs/strip.md).

Observations come in through ``Model.ingest``, one source's published dataset at a time, and are stored once, when first
seen: an observation's known-at is the publication that first carried it. The first dataset of a source also carries a
native window of older observations; those were collected later than they happened, so they are marked retrospective and
placed at the time a rule says their source makes them public. Nothing here calls a provider or the network: the reader
(``field_data.py``) and the cube's bars (``strip_service.py``) feed it. It needs the standard library only.

``build_state`` turns the stored observations into evidence, one series per component, each a list of (known-at, value)
under a fixed formula, method ``field-strip@1``. ``State.answer`` samples them on a grid for ``/cube/strip``.
"""

from __future__ import annotations

import bisect
import json
import math
import re
import sqlite3
import statistics
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

SCHEMA = "cube-strip@2"
MODEL = "field-strip@1"
MINUTE, HOUR, DAY = 60_000, 3_600_000, 86_400_000
FORCES = ("macro", "positioning", "news", "social")
# What the Strip reads from field-data-api; the calendar has its own route.
SOURCES = (
    "fred_macro_daily", "deribit_funding", "hyperliquid_funding", "defillama_stablecoins", "deribit_futures_basis",
    "deribit_options", "deribit_dvol", "gdelt_gkg", "bluesky_live", "wikimedia_daily", "wikimedia_hourly", "mempool_retarget",
)
# Which sources each part of the Strip stands on: the page shows their freshness beside it.
FEEDS = {
    "macro": ("fred_macro_daily",),
    "positioning": ("deribit_funding", "hyperliquid_funding", "defillama_stablecoins", "deribit_futures_basis", "deribit_options"),
    "news": ("gdelt_gkg",),
    "social": ("bluesky_live",),
    "attention": ("gdelt_gkg", "wikimedia_daily", "wikimedia_hourly", "bluesky_live"),
    "events": ("calendar", "mempool_retarget"),
    "options": ("deribit_options", "deribit_dvol"),
}
# Which store series each source fills, so that a source's freshness can name its newest observation.
SERIES_OF = {
    "fred_macro_daily": ("fred:DTWEXBGS", "fred:DGS2", "fred:DGS10", "fred:BAMLH0A0HYM2"),
    "deribit_funding": ("funding:deribit",), "hyperliquid_funding": ("funding:hyperliquid",), "defillama_stablecoins": ("stable",),
    "deribit_futures_basis": ("basis",), "deribit_options": ("options",), "deribit_dvol": ("dvol",), "gdelt_gkg": ("gdelt",),
    "bluesky_live": ("bluesky",), "wikimedia_daily": ("wiki_day",), "wikimedia_hourly": ("wiki_hour",), "mempool_retarget": ("retarget",),
}
MACRO_SERIES = {"DTWEXBGS": "Dollar", "DGS2": "2-year yield", "DGS10": "10-year yield", "BAMLH0A0HYM2": "High-yield spread"}
# Each component: its force, its weight in it and its label. Attention's components carry their weight in the mean.
COMPONENTS = {
    **{"macro." + code: ("macro", label) for code, label in MACRO_SERIES.items()},
    "positioning.funding": ("positioning", "Perpetual funding"), "positioning.stablecoins": ("positioning", "Stablecoin supply"),
    "positioning.basis": ("positioning", "Futures basis"), "positioning.skew": ("positioning", "Options put skew"),
    "news.tone": ("news", "Tone of coverage"), "social.words": ("social", "Bullish against bearish words"),
}
ATTENTION = {"attention.gdelt": ("News share", 0.5), "attention.wikipedia": ("Wikipedia, daily", 0.15),
             "attention.wikipedia_hourly": ("Wikipedia, hourly", 0.15), "attention.bluesky": ("Bluesky share", 0.2)}
# The light of an event: its importance as the calendar gives it, dimmed where its date is not confirmed.
IMPORTANCE = {"high": 1.0, "medium": 0.35, "low": 0.0}
CERTAINTY = {"confirmed": 1.0, "tentative": 0.7, "rule_derived": 0.7, "unspecified": 0.7, "estimate": 0.7}
FAMILY = {
    **dict.fromkeys(("central_bank", "growth", "inflation", "employment", "treasury_liquidity", "global_economic_data",
                     "global_policy", "fiscal_policy", "tax_liquidity", "energy_policy", "election", "banking_holiday",
                     "market_holiday"), "macro"),
    **dict.fromkeys(("bitcoin_derivatives", "market_derivatives", "positioning_window"), "positioning"),
    **dict.fromkeys(("bitcoin_conference", "bitcoin_anniversary", "bitcoin_corporate", "bitcoin_supply", "crypto_regulation",
                     "market_structure", "retarget"), "news"),
}
REGION = {"United States": "", "US": "", "Global": "", "United Kingdom": "UK", "UK": "UK", "Japan": "JP", "Euro area": "EA",
          "Eurozone": "EA", "China": "CN", "Australia": "AU", "Canada": "CA", "Norway": "NO", "Sweden": "SE", "Brazil": "BR",
          "Switzerland": "CH", "New Zealand": "NZ", "India": "IN", "Mexico": "MX", "South Korea": "KR", "Korea": "KR",
          "Israel": "IL", "Spain": "ES", "Germany": "DE", "France": "FR", "Italy": "IT", "Taiwan": "TW", "Nigeria": "NG",
          "Netherlands": "NL", "Czech Republic": "CZ", "Hong Kong": "HK", "United Arab Emirates": "AE", "Turkey": "TR",
          "European Union": "EU", "Finland": "FI", "Argentina": "AR", "Kenya": "KE"}
# A central bank's name already says where it is: its label has no region.
NO_REGION = {"FOMC", "ECB", "BoJ", "BoE", "RBA", "RBNZ", "BoC", "Norges", "Riksbank", "Copom", "SNB", "PBoC", "Fed", "Conf",
             "RBI", "LPR", "Beige", "OPEC", "Anniv", "MtGox", "Earnings"}
SHORT = (
    (r"FOMC", "FOMC"), (r"\bECB\b", "ECB"), (r"Bank of Japan|\bBoJ\b", "BoJ"), (r"Bank of England|\bBoE\b", "BoE"),
    (r"Reserve Bank of Australia|\bRBA\b", "RBA"), (r"Bank of Canada", "BoC"), (r"Norges", "Norges"), (r"Riksbank", "Riksbank"),
    (r"Copom", "Copom"), (r"Swiss National|\bSNB\b", "SNB"), (r"People's Bank|\bPBoC\b", "PBoC"), (r"RBNZ|Reserve Bank of New Zealand", "RBNZ"),
    (r"Federal Reserve Banks holiday", "Holiday"), (r"\bFed\b", "Fed"),
    (r"jobless claims", "Claims"), (r"jobs report|payrolls", "Jobs"), (r"JOLTS", "JOLTS"), (r"\bADP\b", "ADP"),
    (r"Employment Cost", "ECI"), (r"productivity", "Product"), (r"\bPCE\b", "PCE"), (r"\bCPI\b|consumer price", "CPI"), (r"\bPPI\b", "PPI"),
    (r"import and export", "Imports"), (r"Michigan", "UMich"), (r"\bGDP\b", "GDP"), (r"retail sales", "Retail"),
    (r"durable", "Durables"), (r"new-home", "Homes"), (r"housing starts", "Housing"), (r"industrial production", "Indust"),
    (r"trade balance", "Trade"), (r"\bPMI\b", "PMI"), (r"activity bundle", "Activity"), (r"Treasury auction", "Auction"),
    (r"borrowing estimates|refunding", "Refund"), (r"quarterly expiry", "Qtr exp"), (r"monthly expiry", "Expiry"),
    (r"CME", "CME"), (r"options cycle|options expiration", "OpEx"), (r"Month-end", "Mon end"), (r"Quarter-end", "Qtr end"),
    (r"early close", "Early"), (r"holiday|closed|closing day|full-close", "Holiday"), (r"election|runoff|Knesset", "Vote"),
    (r"\btax\b", "Tax"), (r"G20|G7", "G20"), (r"IMF", "IMF"), (r"Davos|World Economic Forum", "Davos"), (r"retarget", "Retarget"),
    (r"Conference Board", "ConfBd"), (r"\bBudget\b", "Budget"), (r"Beige Book", "Beige"), (r"Loan Prime Rate", "LPR"),
    (r"Reserve Bank of India", "RBI"), (r"OPEC", "OPEC"), (r"\bT\+1\b", "T+1"), (r"central-clearing", "Clearing"),
    (r"continuing-resolution|funding deadline", "Funding"), (r"fiscal year", "FY end"), (r"primary-dealer", "Dealers"),
    (r"crypto|stablecoin|GENIUS|DAC8", "Crypto"), (r"anniversary|Pizza Day", "Anniv"), (r"MtGox", "MtGox"), (r"earnings", "Earnings"),
    (r"SIFMA", "Bonds"),
)
# Reaction windows in minutes; a central bank's decision is given an hour.
WINDOW, DECISION_WINDOW = 30, 60
MINUTES_A_YEAR = 365 * 24 * 60


def ms(stamp: str | None) -> int | None:
    """An ISO time as epoch ms; a date as its UTC midnight."""
    if not stamp:
        return None
    if len(stamp) == 10:
        return int(datetime.fromisoformat(stamp).replace(tzinfo=UTC).timestamp() * 1000)
    return int(round(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000))


def iso(at: int | None) -> str | None:
    return None if at is None else datetime.fromtimestamp(at / 1000, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def iso_day(day_ms: int) -> str:
    return datetime.fromtimestamp(day_ms / 1000, UTC).date().isoformat()


def tail_bits(z: float) -> float:
    """Surprise in bits of a move z standard deviations from nothing, two-sided, under a unit-variance Student t with 3
    degrees of freedom: BTC's tails are fat, so a large move is surprising but not impossible."""
    a = abs(z)
    if a == 0:
        return 0.0
    p = 2 * (math.atan(1 / a) - a / (1 + a * a)) / math.pi
    return 60.0 if p <= 0 else -math.log2(p)


def attention_of(ratio: float) -> float:
    """Attention on 0..1 from a ratio to the normal: 0.3 is ordinary, each doubling adds a quarter."""
    return max(0.0, min(1.0, 0.3 + 0.25 * math.log2(ratio)))


# ---------------------------------------------------------------- when a source makes an observation public

def next_day_22(day_ms: int) -> int:
    """FRED's daily series: a value for day d is public by 22:00 UTC the next day."""
    return day_ms + DAY + 22 * HOUR


def h10_release(day_ms: int) -> int:
    """The Fed's H.10 dollar index: a week's values are public the Monday after it, 16:15 in New York."""
    d = datetime.fromtimestamp(day_ms / 1000, UTC).date()
    monday = d + timedelta(days=7 - d.weekday())
    summer = date(monday.year, 3, 8) <= monday < date(monday.year, 11, 1)
    return int(datetime(monday.year, monday.month, monday.day, 20 if summer else 21, 15, tzinfo=UTC).timestamp() * 1000)


@dataclass
class Obs:
    series: str
    obs_id: str
    observed_ms: int
    value: float | None
    extra: dict = field(default_factory=dict)
    rule_known_ms: int | None = None  # when its source makes it public, for one collected later than that


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def observations(source: str, records: list, meta: dict, received_ms: int) -> list[Obs]:
    """The observations one dataset carries, in the Strip's series (docs/strip.md, Source mappings)."""
    out: list[Obs] = []
    hour = received_ms - received_ms % HOUR
    if source == "fred_macro_daily":
        for r in records:
            v = r.get("values") or {}
            series, day, value = v.get("series"), ms(r.get("observed_at")), _num(v.get("value"))
            if series in MACRO_SERIES and day is not None and value is not None:
                rule = h10_release(day) if series == "DTWEXBGS" else next_day_22(day)
                out.append(Obs("fred:" + series, r["id"], day, value, {}, rule))
    elif source in ("deribit_funding", "hyperliquid_funding"):
        for r in records:
            v, at = r.get("values") or {}, ms(r.get("observed_at"))
            if at is None:
                continue
            if source == "deribit_funding":
                rate = _num(v.get("interest_1h"))
            else:
                period, raw = _num(v.get("funding_period_seconds")) or 3600.0, _num(v.get("funding_rate"))
                rate = None if raw is None else raw * 3600 / period
            if rate is not None:
                # Each venue's hourly funding fraction, annualised in percent; positive is longs paying shorts.
                out.append(Obs("funding:" + source.split("_")[0], r["id"], at, rate * 24 * 365 * 100, {}, at))
    elif source == "defillama_stablecoins":
        for r in records:
            v, day, value = r.get("values") or {}, ms(r.get("observed_at")), _num((r.get("values") or {}).get("total_usd"))
            if day is not None and value:
                out.append(Obs("stable", r["id"], day, value, {}, day + DAY + 6 * HOUR))
    elif source == "deribit_futures_basis":
        ahead = []
        for r in records:
            v, expiry = r.get("values") or {}, ms(r.get("event_at"))
            basis = _num(v.get("simple_annualized_basis_fraction_oi_weighted"))
            basis = basis if basis is not None else _num(v.get("simple_annualized_basis_fraction_median"))
            if expiry is not None and basis is not None and expiry - received_ms >= 30 * DAY:
                ahead.append((expiry, basis))
        if ahead:
            expiry, basis = min(ahead)
            out.append(Obs("basis", str(hour), received_ms, basis * 100, {"expiry": expiry}, received_ms))
    elif source == "deribit_options":
        iv = {}
        for r in records:
            v = r.get("values") or {}
            key = (v.get("expiry_bucket"), v.get("strike_underlying_bucket"), v.get("option_type"))
            value, weight = _num(v.get("mark_iv_oi_weighted_percent")), _num(v.get("iv_valid_weight"))
            if value is not None and weight:
                iv[key] = (value, weight)
        atm = {}
        for bucket in ("same_day", "tomorrow_to_7d", "7_30d", "30_90d", "90d_plus"):
            pair = [iv[k] for k in ((bucket, "0_98_1_02", "call"), (bucket, "0_98_1_02", "put")) if k in iv]
            weight = sum(w for _, w in pair)
            if weight:
                atm[bucket] = round(sum(x * w for x, w in pair) / weight, 3)
        put, call = iv.get(("7_30d", "0_90_0_98", "put")), iv.get(("7_30d", "1_02_1_10", "call"))
        totals = (meta or {}).get("totals") or {}
        extra = {"atm": atm, "putCall": _num(totals.get("put_call_oi_ratio"))}
        out.append(Obs("options", str(hour), received_ms, None if not (put and call) else put[0] - call[0], extra, received_ms))
    elif source == "deribit_dvol":
        for r in records:
            v, at, m = r.get("values") or {}, ms(r.get("observed_at")), r.get("metadata") or {}
            close = _num(v.get("close"))
            if at is not None and close is not None and m.get("complete", True):
                out.append(Obs("dvol", r["id"], at, close, {}, ms(m.get("interval_end")) or at + HOUR))
    elif source == "gdelt_gkg":
        for r in records:
            v, at = r.get("values") or {}, ms(r.get("observed_at"))
            if at is not None:
                extra = {k: v.get(k) for k in ("bitcoin_articles", "panel_articles", "tone_scored_articles")}
                out.append(Obs("gdelt", r["id"], at, _num(v.get("tone_mean")), extra, at + 15 * MINUTE))
    elif source == "bluesky_live":
        continuous = (meta.get("mode") or (meta.get("source_metadata") or {}).get("mode") or
                      (meta.get("session") or {}).get("mode")) == "continuous_checkpointed"
        for r in records:
            v, at, m = r.get("values") or {}, ms(r.get("observed_at")), r.get("metadata") or {}
            if continuous and (m.get("full_minute_connection_coverage") is not True or m.get("cursor_gap_overlap") is not False):
                continue
            if at is not None:
                extra = {k: v.get(k) for k in ("creates", "bitcoin_creates", "bullish_word_matches", "bearish_word_matches")}
                extra["dictionary"] = m.get("dictionary_version")
                if continuous:
                    extra.update(mode="continuous_checkpointed", connected_seconds=m.get("connected_seconds"),
                                 full_minute_connection_coverage=True, cursor_gap_overlap=False)
                out.append(Obs("bluesky", r["id"], at, None, extra, ms(m.get("interval_end")) or at + MINUTE))
    elif source == "wikimedia_daily":
        for r in records:
            day, views = ms(r.get("observed_at")), _num((r.get("values") or {}).get("views"))
            if day is not None and views:
                out.append(Obs("wiki_day", r["id"], day, views, {}, day + DAY + 3 * HOUR))
    elif source == "wikimedia_hourly":
        for r in records:
            at, views = ms(r.get("observed_at")), _num((r.get("values") or {}).get("views"))
            end = ms((r.get("metadata") or {}).get("interval_end"))
            if at is not None and views:
                out.append(Obs("wiki_hour", r["id"], at, views, {}, (end or at + HOUR) + 3 * HOUR))
    elif source == "mempool_retarget":
        for r in records:
            v = r.get("values") or {}
            at, height = _num(v.get("estimatedRetargetDate")), v.get("nextRetargetHeight")
            if at is not None and height is not None:
                out.append(Obs("retarget", f"{height}:{hour}", received_ms, at,
                               {"height": height, "change": _num(v.get("difficultyChange")), "progress": _num(v.get("progressPercent"))},
                               received_ms))
    return out


# ---------------------------------------------------------------- the store: every observation as first seen


class Store:
    """Observations, calendar revisions and measured reactions as first seen, in SQLite. One writer: the worker."""

    def __init__(self, path: str = ":memory:") -> None:
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        if path != ":memory:":
            self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS obs (series TEXT, obs_id TEXT, observed_ms INTEGER, known_ms INTEGER, retro INTEGER,
                                            value REAL, extra TEXT, PRIMARY KEY (series, obs_id));
            CREATE TABLE IF NOT EXISTS seen (source TEXT PRIMARY KEY, first_ms INTEGER, last_ms INTEGER, last_dataset TEXT);
            CREATE TABLE IF NOT EXISTS datasets (source TEXT, dataset_id TEXT, published_ms INTEGER, PRIMARY KEY (source, dataset_id));
            CREATE TABLE IF NOT EXISTS history_sync (source TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS calendar (id TEXT, revision TEXT, known_ms INTEGER, entry TEXT, PRIMARY KEY (id, revision));
            CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, entry TEXT);
            CREATE INDEX IF NOT EXISTS obs_time ON obs (series, observed_ms, known_ms);
            CREATE INDEX IF NOT EXISTS obs_retro ON obs (series, retro, known_ms);
        """)
        self.lock = threading.Lock()
        self.version = 0  # moves on every write, so the worker knows what to compute again

    def seen(self, source: str) -> tuple[int | None, int | None]:
        row = self.db.execute("SELECT first_ms, last_ms FROM seen WHERE source = ?", (source,)).fetchone()
        return (row[0], row[1]) if row else (None, None)

    def has_dataset(self, source: str, dataset_id: str) -> bool:
        return self.db.execute("SELECT 1 FROM datasets WHERE source = ? AND dataset_id = ?", (source, dataset_id)).fetchone() is not None

    def history_complete(self, source: str) -> bool:
        return self.db.execute("SELECT 1 FROM history_sync WHERE source=?", (source,)).fetchone() is not None

    def mark_history_complete(self, source: str) -> None:
        self.db.execute("INSERT OR IGNORE INTO history_sync VALUES (?)", (source,))

    def mark_history_pending(self, source: str) -> None:
        self.db.execute("DELETE FROM history_sync WHERE source=?", (source,))

    def reset_source(self, source: str) -> None:
        """Reconstruct one source in publication order inside the caller's replay transaction."""
        for series in SERIES_OF.get(source, ()):
            self.db.execute("DELETE FROM obs WHERE series=?", (series,))
        if source == "calendar":
            self.db.execute("DELETE FROM calendar")
        self.db.execute("DELETE FROM datasets WHERE source=?", (source,))
        self.db.execute("DELETE FROM seen WHERE source=?", (source,))

    def rows(self, series: str, since: int | None = None) -> list[tuple]:
        """(observed, known, retro, value, extra) of a series, in time order; those observed from ``since`` on, when given."""
        return self.db.execute("SELECT observed_ms, known_ms, retro, value, extra FROM obs WHERE series = ? AND observed_ms >= ? "
                               "ORDER BY observed_ms, known_ms", (series, -1 if since is None else since)).fetchall()

    def last_row(self) -> int:
        """The number of the newest observation: one stored later has a larger one."""
        return self.db.execute("SELECT COALESCE(MAX(rowid), 0) FROM obs").fetchone()[0]

    def changed_since(self, row: int) -> dict[str, int]:
        """Each series with observations stored after observation number ``row``, and the earliest time they observe."""
        # NOT INDEXED keeps the search to the rows after ``row``, by number, rather than a scan of a series index.
        return dict(self.db.execute("SELECT series, MIN(observed_ms) FROM obs NOT INDEXED WHERE rowid > ? GROUP BY series", (row,)).fetchall())

    def retro_until(self, series: str) -> int | None:
        """Where a series' values stop being retrospective: its first value known live, or after its last retrospective one."""
        live = self.db.execute("SELECT MIN(known_ms) FROM obs WHERE series = ? AND retro = 0", (series,)).fetchone()[0]
        if live is not None:
            return live
        retro = self.db.execute("SELECT MAX(known_ms) FROM obs WHERE series = ? AND retro = 1", (series,)).fetchone()[0]
        return retro + 1 if retro is not None else None

    def newest_observed(self, series: str) -> int | None:
        row = self.db.execute("SELECT MAX(observed_ms) FROM obs WHERE series = ?", (series,)).fetchone()
        return row[0] if row else None

    def calendar_rows(self) -> list[tuple]:
        return self.db.execute("SELECT id, revision, known_ms, entry FROM calendar ORDER BY id, known_ms").fetchall()

    def reactions(self) -> dict:
        return {event_id: json.loads(entry) for event_id, entry in self.db.execute("SELECT id, entry FROM reactions")}


class Model:
    """Ingests published datasets into the store."""

    def __init__(self, store: Store) -> None:
        self.store = store

    def ingest(self, source: str, dataset_id: str, records: list, meta: dict, received_at: str | None, published_ms: int,
               interval_ms: int, *, retrospective: bool = False) -> int:
        """One source's dataset, first published at ``published_ms``. Returns how many observations were new.

        An observation is known at the publication that first carried it. The first dataset of a source also carries
        older observations of its native window: those that its source made public more than one collection interval
        before the dataset was received are retrospective, known at the time their source rule gives. Explicit
        historical backfills use that same rule even after the source has begun live collection."""
        db = self.store.db
        with self.store.lock:
            if self.store.has_dataset(source, dataset_id):
                return 0
            first, _ = self.store.seen(source)
            received_ms = ms(received_at) or published_ms
            fresh = 0
            for o in observations(source, records, meta, received_ms):
                rule = o.rule_known_ms if o.rule_known_ms is not None else o.observed_ms
                retro = (first is None or retrospective) and rule < received_ms - interval_ms
                known = min(rule, published_ms) if retro else published_ms
                cursor = db.execute("INSERT OR IGNORE INTO obs VALUES (?, ?, ?, ?, ?, ?, ?)",
                                    (o.series, o.obs_id, o.observed_ms, known, int(retro), o.value,
                                     json.dumps(o.extra, separators=(",", ":")) if o.extra else None))
                fresh += cursor.rowcount
            db.execute("INSERT OR IGNORE INTO datasets VALUES (?, ?, ?)", (source, dataset_id, published_ms))
            db.execute("INSERT INTO seen VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET "
                       "first_ms = MIN(first_ms, excluded.first_ms), last_ms = MAX(last_ms, excluded.last_ms), last_dataset = excluded.last_dataset",
                       (source, published_ms, published_ms, dataset_id))
            self.store.version += 1
            return fresh

    def ingest_calendar(self, dataset_id: str, records: list, published_ms: int) -> int:
        """The supplied calendar's events: a revision of an event is known at the publication that first carried it.
        An event that a later calendar no longer lists is withdrawn from then on; that is not a cancellation."""
        db = self.store.db
        with self.store.lock:
            if self.store.has_dataset("calendar", dataset_id):
                return 0
            first, _ = self.store.seen("calendar")
            fresh, listed = 0, set()
            for r in records:
                entry = calendar_entry(r)
                if entry is None:
                    continue
                listed.add(r["id"])
                revision = (r.get("metadata") or {}).get("revision_id") or json.dumps(r.get("values"), sort_keys=True)
                cursor = db.execute("INSERT OR IGNORE INTO calendar VALUES (?, ?, ?, ?)",
                                    (r["id"], revision, published_ms, json.dumps(entry, separators=(",", ":"))))
                fresh += cursor.rowcount
            if first is not None:
                latest: dict[str, dict] = {}
                for event_id, _, _, entry in self.store.calendar_rows():
                    latest[event_id] = json.loads(entry)
                for event_id, entry in latest.items():
                    if event_id not in listed and entry.get("status") != "withdrawn":
                        db.execute("INSERT OR IGNORE INTO calendar VALUES (?, ?, ?, ?)",
                                   (event_id, "withdrawn:" + dataset_id, published_ms,
                                    json.dumps({**entry, "status": "withdrawn", "at": None}, separators=(",", ":"))))
            db.execute("INSERT OR IGNORE INTO datasets VALUES ('calendar', ?, ?)", (dataset_id, published_ms))
            db.execute("INSERT INTO seen VALUES ('calendar', ?, ?, ?) ON CONFLICT(source) DO UPDATE SET "
                       "first_ms = MIN(first_ms, excluded.first_ms), last_ms = MAX(last_ms, excluded.last_ms), last_dataset = excluded.last_dataset",
                       (published_ms, published_ms, dataset_id))
            self.store.version += 1
            return fresh

    def record_reaction(self, event_id: str, entry: dict) -> None:
        with self.store.lock:
            cursor = self.store.db.execute("INSERT OR IGNORE INTO reactions VALUES (?, ?)", (event_id, json.dumps(entry, separators=(",", ":"))))
            self.store.version += cursor.rowcount


def short_label(title: str, region: str | None, category: str = "") -> str:
    """A label of at most 8 characters for the band: the release's usual name, with its region outside the US."""
    code = REGION.get(region or "", (region or "")[:2].upper())
    found = "Conf" if category == "bitcoin_conference" else next((label for pattern, label in SHORT if re.search(pattern, title, re.I)), None)
    if found:
        text = f"{code} {found}" if code and found not in NO_REGION else found
        return text if len(text) <= 8 else found[:8]
    word = re.sub(r"[^A-Za-z0-9]", "", title.split()[0] if title.split() else "Event")[:8]
    return word or "Event"


def calendar_entry(r: dict) -> dict | None:
    """One supplied calendar record as a schedule entry, its precision kept: an instant, a date or a range of dates."""
    v = r.get("values") or {}
    schedule = v.get("schedule") or {}
    kind = schedule.get("kind")
    context = v.get("context") or {}
    if kind == "instant":
        at, precision, end = ms(schedule.get("at")), "instant", None
    elif kind == "date":
        at, precision = ms(schedule.get("date")), "day"
        end = None if at is None else at + DAY
    elif kind == "date_range":
        at, precision, end = ms(schedule.get("start")), "range", ms(schedule.get("end"))
    else:
        return None
    if at is None:
        return None
    title, category = str(v.get("title") or "Event"), str(v.get("category") or "event")
    decision = category == "central_bank" and re.search(r"decision|FOMC(?! minutes)", title, re.I)
    status = "cancelled" if v.get("status") == "cancelled" else "scheduled"
    return {
        "at": None if status == "cancelled" else at, "lastAt": at, "precision": precision, "end": end, "status": status,
        "certainty": v.get("schedule_certainty") or "unspecified", "importance": context.get("importance"),
        "title": title, "category": category, "region": context.get("region"), "origin": v.get("origin"),
        "series": context.get("source_id") or re.sub(r"\s*\(.*\)$", "", title),
        "link": ((r.get("metadata") or {}).get("provenance") or {}).get("url"),
        "window": (DECISION_WINDOW if decision else WINDOW) if precision == "instant" else None,
    }


def weight_of(entry: dict) -> float:
    """The light an event gives: the calendar's importance, dimmed where its date is not confirmed."""
    return round(IMPORTANCE.get(entry.get("importance") or "low", 0.0) * CERTAINTY.get(entry.get("certainty") or "unspecified", 0.7), 3)


# ---------------------------------------------------------------- evidence: one series per component


@dataclass
class Evidence:
    """A component's evidence: values known at sorted times, each standing for ``stale_ms`` at most, and where its
    values stop being retrospective."""

    name: str
    known: list[int]
    value: list[float]
    detail: list
    stale_ms: int
    retro_until: int | None = None

    @staticmethod
    def of(name: str, rows: list[tuple[int, float, dict | None]], stale_ms: int, retro_until: int | None = None) -> "Evidence":
        rows = sorted(rows, key=lambda r: r[0])
        return Evidence(name, [r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], stale_ms, retro_until)

    def sample(self, times: list[int]) -> list[float | None]:
        """Each time's value: the latest known at or before it and not stale; None otherwise. ``times`` ascend."""
        n = len(self.known)
        out, j = [], bisect.bisect_right(self.known, times[0]) - 1 if times else -1
        for t in times:
            while j + 1 < n and self.known[j + 1] <= t:
                j += 1
            out.append(self.value[j] if j >= 0 and t - self.known[j] <= self.stale_ms else None)
        return out

    def at(self, t: int) -> tuple[float | None, dict | None, int | None]:
        i = bisect.bisect_right(self.known, t) - 1
        if i < 0 or t - self.known[i] > self.stale_ms:
            return None, None, None
        return self.value[i], self.detail[i], self.known[i]


class Window:
    """Sum, sum of squares and count of the values in a sliding window, in time order."""

    def __init__(self) -> None:
        self.items: deque = deque()
        self.s = self.q = 0.0

    def add(self, key: int, value: float) -> None:
        self.items.append((key, value))
        self.s += value
        self.q += value * value

    def drop_before(self, key: int) -> None:
        while self.items and self.items[0][0] < key:
            _, value = self.items.popleft()
            self.s -= value
            self.q -= value * value

    def drop_to(self, count: int) -> None:
        while len(self.items) > count:
            _, value = self.items.popleft()
            self.s -= value
            self.q -= value * value

    def z(self, value: float, minimum: int) -> float | None:
        n = len(self.items)
        if n < minimum:
            return None
        mean = self.s / n
        var = max(0.0, self.q / n - mean * mean)
        return None if var <= 1e-18 else (value - mean) / math.sqrt(var)


class SortedWindow:
    """The values of a sliding window, kept sorted for its median."""

    def __init__(self) -> None:
        self.items: deque = deque()
        self.sorted: list[float] = []

    def add(self, key: int, value: float) -> None:
        self.items.append((key, value))
        bisect.insort(self.sorted, value)

    def drop_before(self, key: int) -> None:
        while self.items and self.items[0][0] < key:
            _, value = self.items.popleft()
            del self.sorted[bisect.bisect_left(self.sorted, value)]

    def ratio(self, value: float) -> float | None:
        n = len(self.sorted)
        if n < 6 or value <= 0:
            return None
        # The median of values already in order, as statistics.median gives it.
        median = self.sorted[n // 2] if n % 2 else (self.sorted[n // 2 - 1] + self.sorted[n // 2]) / 2
        return None if median <= 0 else value / median


def _retro_until(rows: list[tuple]) -> int | None:
    """Where a series' values stop being retrospective: its first value known live, or after its last retrospective one."""
    live = [r[1] for r in rows if not r[2]]
    if live:
        return min(live)
    retro = [r[1] for r in rows if r[2]]
    return max(retro) + 1 if retro else None


def macro_evidence(code: str, rows: list[tuple]) -> Evidence:
    """A FRED series' 5-observation change against the spread of its single-observation changes over the trailing 60.
    Up is a headwind for BTC in all four: a dearer dollar, higher yields, wider credit spreads."""
    ev, steps = [], Window()
    values = [r[3] for r in rows]
    for i in range(1, len(rows)):
        steps.add(i, values[i] - values[i - 1])
        steps.drop_to(60)
        if i < 5 or len(steps.items) < 10:
            continue
        n = len(steps.items)
        var = max(0.0, steps.q / n - (steps.s / n) ** 2)
        if var <= 0:
            continue
        z = (values[i] - values[i - 5]) / (math.sqrt(var) * math.sqrt(5))
        ev.append((rows[i][1], -0.5 * math.tanh(z / 2), {"z": round(z, 2), "value": values[i], "day": iso_day(rows[i][0])}))
    return Evidence.of("macro." + code, ev, (9 if code == "DTWEXBGS" else 6) * DAY, _retro_until(rows))


def funding_evidence(deribit: list[tuple], hyperliquid: list[tuple]) -> Evidence:
    """Funding of both venues, annualised and averaged hour by hour where both are known, against its trailing 30 days.
    Longs paying is a lean up."""
    hours: dict[int, list[tuple[float, int]]] = {}
    for rows in (deribit, hyperliquid):
        for observed, known, _, value, _ in rows:
            if value is not None:
                hours.setdefault(observed - observed % HOUR, []).append((value, known))
    ev, window = [], Window()
    for h in sorted(hours):
        mean = statistics.fmean(v for v, _ in hours[h])
        window.drop_before(h - 30 * DAY)
        z = window.z(mean, 24)
        window.add(h, mean)
        if z is not None:
            ev.append((max(k for _, k in hours[h]), 0.6 * math.tanh(z / 2), {"z": round(z, 2), "annualised": round(mean, 2), "venues": len(hours[h])}))
    retro = [x for x in (_retro_until(deribit), _retro_until(hyperliquid)) if x is not None]
    return Evidence.of("positioning.funding", ev, 3 * HOUR, max(retro) if retro else None)


def stablecoin_evidence(rows: list[tuple]) -> Evidence:
    """Stablecoin supply's 7-day growth against the growth of its trailing year. More supply is a lean up."""
    ev, window = [], Window()
    for i in range(7, len(rows)):
        if not rows[i - 7][3]:
            continue
        growth = math.log(rows[i][3] / rows[i - 7][3])
        window.drop_before(rows[i][0] - 365 * DAY)
        z = window.z(growth, 14)
        window.add(rows[i][0], growth)
        if z is not None:
            ev.append((rows[i][1], 0.4 * math.tanh(z / 2), {"z": round(z, 2), "growth7d": round(growth * 100, 3), "day": iso_day(rows[i][0])}))
    return Evidence.of("positioning.stablecoins", ev, 3 * DAY, _retro_until(rows))


def hourly_evidence(name: str, rows: list[tuple], weight: float) -> Evidence:
    """An hourly sample against its trailing 30 days: the futures basis about 30 days out (a premium for longs is a lean
    up) or the options' 7-30 day put skew (dearer puts are a lean down)."""
    ev, window = [], Window()
    for observed, known, _, value, _ in rows:
        if value is None:
            continue
        window.drop_before(observed - 30 * DAY)
        z = window.z(value, 24)
        window.add(observed, value)
        if z is not None:
            ev.append((known, weight * math.tanh(z / 2), {"z": round(z, 2), "value": round(value, 3)}))
    return Evidence.of(name, ev, 2 * HOUR, _retro_until(rows))


# The parts read from frequent rows are computed as entries: (the time of the row each is computed at, known, value, detail),
# so that a build computes again only those at rows that changed (Tail).


def news_entries(rows: list[tuple]) -> list[tuple]:
    """News at each GDELT batch: the mean tone of Bitcoin coverage over the trailing day, against the daily tone of the
    trailing 30 complete days. GDELT's whole-article dictionary tone is the tone of the coverage, not a forecast of BTC's
    direction."""
    batches = []
    for observed, known, _, tone, extra in rows:
        n = (json.loads(extra) if extra else {}).get("tone_scored_articles") or 0
        if tone is not None and n:
            batches.append((observed, known, tone, n))
    days: dict[int, list[float]] = {}
    for observed, _, tone, n in batches:
        d = days.setdefault(observed - observed % DAY, [0.0, 0.0])
        d[0] += tone * n
        d[1] += n
    daily = sorted((day, s / n) for day, (s, n) in days.items() if n >= 10)
    day_keys = [d for d, _ in daily]
    out, inside, count, normals = [], deque(), 0, {}
    for observed, known, tone, n in batches:
        inside.append((observed, tone, n))
        count += n
        while inside and inside[0][0] <= observed - DAY:
            count -= inside.popleft()[2]
        # The days with a daily tone among the 30 complete days before this batch's day.
        last = observed - observed % DAY - DAY
        span = (bisect.bisect_left(day_keys, last - 29 * DAY), bisect.bisect_right(day_keys, last))
        if count < 10 or span[1] - span[0] < 5:
            continue
        if span not in normals:
            normal = [t for _, t in daily[span[0]:span[1]]]
            normals[span] = (statistics.fmean(normal), statistics.pstdev(normal))
        mean, sd = normals[span]
        if sd <= 0:
            continue
        # A correctly rounded sum, so that the tone is the same however far back its computation began.
        mean_tone = math.fsum(t * k for _, t, k in inside) / count
        out.append((observed, known, 0.6 * math.tanh((mean_tone - mean) / sd / 2),
                    {"tone": round(mean_tone, 3), "articles": int(count), "normal": round(mean, 3)}))
    return out


def social_entries(rows: list[tuple]) -> list[tuple]:
    """Social at each Bluesky sample: bullish against bearish words in posts that mention bitcoin, over the trailing day of
    samples; a fixed word list, counted by the service; no model reads the posts."""
    out, inside, sums = [], deque(), [0, 0, 0]
    for observed, known, _, _, extra in rows:
        x = json.loads(extra) if extra else {}
        row = (observed, x.get("bitcoin_creates") or 0, x.get("bullish_word_matches") or 0, x.get("bearish_word_matches") or 0)
        inside.append(row)
        for k in range(3):
            sums[k] += row[k + 1]
        while inside and inside[0][0] <= observed - DAY:
            old = inside.popleft()
            for k in range(3):
                sums[k] -= old[k + 1]
        mentions, bull, bear = sums
        if mentions >= 10 and bull + bear >= 3:
            out.append((observed, known, 0.8 * (bull - bear) / (bull + bear + 5),
                        {"bull": bull, "bear": bear, "mentions": mentions, "dictionary": x.get("dictionary")}))
    return out


def gdelt_attention_entries(rows: list[tuple]) -> list[tuple]:
    """GDELT's attention at each batch: the Bitcoin share of the panel's articles over the trailing two hours, against its
    trailing week."""
    out, inside, sums, normal = [], deque(), [0, 0], SortedWindow()
    for observed, known, _, _, extra in rows:
        x = json.loads(extra) if extra else {}
        row = (observed, x.get("bitcoin_articles") or 0, x.get("panel_articles") or 0)
        inside.append(row)
        sums[0] += row[1]
        sums[1] += row[2]
        while inside and inside[0][0] <= observed - 2 * HOUR:
            old = inside.popleft()
            sums[0] -= old[1]
            sums[1] -= old[2]
        if sums[1] <= 0:
            continue
        share = sums[0] / sums[1]
        normal.drop_before(observed - 7 * DAY)
        ratio = normal.ratio(share)
        normal.add(observed, share)
        if ratio is not None:
            out.append((observed, known, attention_of(ratio), {"ratio": round(ratio, 2), "share": round(share, 4)}))
    return out


def bluesky_attention_entries(rows: list[tuple]) -> list[tuple]:
    """Bluesky's attention, hour by hour, at each hour's start: the share of new posts that mention bitcoin, against the
    trailing week."""
    hours: dict[int, list[int]] = {}
    for observed, known, _, _, extra in rows:
        x = json.loads(extra) if extra else {}
        b = hours.setdefault(observed - observed % HOUR, [0, 0, 0])
        b[0] += x.get("bitcoin_creates") or 0
        b[1] += x.get("creates") or 0
        b[2] = max(b[2], known)
    out, normal = [], SortedWindow()
    for h in sorted(hours):
        mentions, creates, known = hours[h]
        if creates < 300:
            continue
        share = mentions / creates
        normal.drop_before(h - 7 * DAY)
        ratio = normal.ratio(share) if share > 0 else None
        normal.add(h, share)
        if ratio is not None:
            out.append((h, known, attention_of(ratio), {"ratio": round(ratio, 2)}))
    return out


def wikipedia_attention(wiki_day: list[tuple], wiki_hour: list[tuple]) -> dict[str, Evidence]:
    """Wikipedia's Bitcoin article: a day's readers against the trailing 30 days, an hour's against the trailing week."""
    out = {}
    for name, rows, back, stale in (("attention.wikipedia", wiki_day, 30 * DAY, 2 * DAY), ("attention.wikipedia_hourly", wiki_hour, 7 * DAY, 4 * HOUR)):
        ev, normal = [], SortedWindow()
        for observed, known, _, views, _ in rows:
            normal.drop_before(observed - back)
            ratio = normal.ratio(views)
            normal.add(observed, views)
            if ratio is not None:
                ev.append((known, attention_of(ratio), {"ratio": round(ratio, 2), "views": int(views)}))
        out[name] = Evidence.of(name, ev, stale, _retro_until(rows))
    return out


def evidence_of(name: str, entries: list[tuple], stale_ms: int, retro_until: int | None) -> Evidence:
    """A part's evidence from its entries in row order, as Evidence.of orders them: by known time, which they nearly always
    are already."""
    if any(entries[i][1] > entries[i + 1][1] for i in range(len(entries) - 1)):
        entries = sorted(entries, key=lambda e: e[1])
    return Evidence(name, [e[1] for e in entries], [e[2] for e in entries], [e[3] for e in entries], stale_ms, retro_until)


def news_evidence(rows: list[tuple]) -> Evidence:
    return evidence_of("news.tone", news_entries(rows), 2 * HOUR, _retro_until(rows))


def social_evidence(rows: list[tuple]) -> Evidence:
    return evidence_of("social.words", social_entries(rows), HOUR, _retro_until(rows))


def attention_evidence(gdelt: list[tuple], wiki_day: list[tuple], wiki_hour: list[tuple], bluesky: list[tuple]) -> dict[str, Evidence]:
    return {"attention.gdelt": evidence_of("attention.gdelt", gdelt_attention_entries(gdelt), 2 * HOUR, _retro_until(gdelt)),
            **wikipedia_attention(wiki_day, wiki_hour),
            "attention.bluesky": evidence_of("attention.bluesky", bluesky_attention_entries(bluesky), 2 * HOUR, _retro_until(bluesky))}


@dataclass
class Tail:
    """A part of frequent rows, computed again only from where its rows changed. Its value at a row looks back no further
    than ``start(cut)`` for any row at or after ``cut``, so a build keeps the entries computed at rows before the earliest
    row stored since the last build, and computes the rest from ``start(cut)`` on: what one computation over every row
    gives. ``align`` is the span an entry stands at the start of: an hour for an hourly part."""

    series: str
    entries: Callable[[list[tuple]], list[tuple]]
    start: Callable[[int], int]
    align: int = 1
    row: int = 0
    done: list = field(default_factory=list)

    def update(self, store: Store) -> bool:
        """Bring the entries up to the store. Returns whether they changed."""
        last = store.last_row()
        if not self.row:
            self.done = self.entries(store.rows(self.series))
        else:
            earliest = store.changed_since(self.row).get(self.series)
            if earliest is None:
                self.row = last
                return False
            cut = earliest - earliest % self.align
            fresh = [e for e in self.entries(store.rows(self.series, self.start(cut))) if e[0] >= cut]
            self.done = [e for e in self.done if e[0] < cut] + fresh
        self.row = last
        return True


def dvol_evidence(rows: list[tuple]) -> Evidence:
    return Evidence.of("dvol", [(r[1], r[3], None) for r in rows if r[3] is not None], 3 * HOUR, _retro_until(rows))


def options_entries(rows: list[tuple]) -> list[tuple]:
    """The options' hourly samples, each at its row: at-the-money IV by expiry bucket, skew and put/call."""
    out = []
    for observed, known, _, skew, extra in rows:
        x = json.loads(extra) if extra else {}
        out.append((observed, {"at": known, "atm": x.get("atm") or {}, "skew": None if skew is None else round(skew, 3), "putCall": x.get("putCall")}))
    return out


def options_samples(rows: list[tuple]) -> list[dict]:
    return [e[1] for e in options_entries(rows)]


class Prices:
    """The cube's closes the Strip reads: (bar end in ms, close) in time order, hourly and, recently, every 15 minutes."""

    def __init__(self, bars: list[tuple[int, float]] | None = None, cutoff: int | None = None) -> None:
        self.bars = sorted(bars or [])
        self.ends = [b[0] for b in self.bars]
        self.cutoff = cutoff if cutoff is not None else (self.ends[-1] if self.ends else None)

    def close_at(self, t: int) -> float | None:
        """The last close at or before t."""
        i = bisect.bisect_right(self.ends, t) - 1
        return self.bars[i][1] if i >= 0 else None

    def sample(self, times: list[int]) -> list[float | None]:
        n = len(self.ends)
        out, j = [], bisect.bisect_right(self.ends, times[0]) - 1 if times else -1
        for t in times:
            while j + 1 < n and self.ends[j + 1] <= t:
                j += 1
            out.append(self.bars[j][1] if j >= 0 and (self.cutoff is None or t <= self.cutoff + HOUR) else None)
        return out


@dataclass
class State:
    """What the route answers from, built once a publication or the cube's prices move."""

    built_ms: int
    snapshot: dict
    sources: dict
    components: dict
    attention: dict
    dvol: Evidence
    prices: Prices
    events: list
    moves: dict
    jumps: list
    options: list
    cutoff: int
    version: int = 0
    answers: dict = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def answer(self, start: int, end: int, step: int) -> bytes:
        """The cube-strip@2 answer for the grid times start <= t < end, as JSON bytes; kept per grid."""
        key = (start, end, step)
        with self.lock:
            hit = self.answers.get(key)
        if hit is not None:
            return hit
        times = list(range(start, end, step))
        forces = {}
        for force in FORCES:
            parts = [self.components[name].sample(times) for name, (f, _) in COMPONENTS.items() if f == force and name in self.components]
            forces[force] = [None if all(p[k] is None for p in parts) else round(sum(p[k] for p in parts if p[k] is not None), 4)
                             for k in range(len(times))] if parts else [None] * len(times)
        weights = [(self.attention[name].sample(times), w) for name, (_, w) in ATTENTION.items() if name in self.attention]
        attention = []
        for k in range(len(times)):
            have = [(s[k], w) for s, w in weights if s[k] is not None]
            attention.append(round(sum(v * w for v, w in have) / sum(w for _, w in have), 3) if have else None)
        closes = self.prices.sample(times)
        later = self.prices.sample([t + DAY for t in times])
        cutoff = self.prices.cutoff
        next24h = [None if c is None or c2 is None or cutoff is None or t + DAY > cutoff else round((c2 / c - 1) * 100, 4)
                   for t, c, c2 in zip(times, closes, later)]
        grid = {"t0": start, "step": step, "forces": forces, "attention": attention,
                "close": [None if c is None else round(c, 2) for c in closes], "next24h": next24h,
                "dvol": [None if v is None else round(v, 2) for v in self.dvol.sample(times)]}
        if len(times) <= 3000:
            grid["parts"] = {name: [None if v is None else round(v, 4) for v in e.sample(times)]
                             for name, e in {**self.components, **self.attention}.items()}
        def near(s: dict) -> bool:
            # A cancelled or withdrawn entry is placed by the date it last had.
            at = s["at"] if s["at"] is not None else s.get("lastAt")
            return at is not None and start - DAY <= at < end + 90 * DAY
        events = [e for e in self.events if any(near(s) for s in e["schedule"])]
        body = {
            "schema": SCHEMA, "model": MODEL, "cutoff": self.cutoff, "snapshot": self.snapshot, "sources": self.sources,
            "components": {name: {"force": f, "label": label, "retroUntil": self.components[name].retro_until}
                           for name, (f, label) in COMPONENTS.items() if name in self.components},
            "attentionParts": {name: {"label": label, "weight": w, "retroUntil": self.attention[name].retro_until}
                               for name, (label, w) in ATTENTION.items() if name in self.attention},
            "grid": grid, "events": events,
            "moves": {s: self.moves[s] for s in sorted({e["series"] for e in events if e["series"] in self.moves})},
            "jumps": [j for j in self.jumps if start <= j["at"] < end],
            "options": [o for o in self.options if start - DAY <= o["at"] < end][-200:],
        }
        raw = json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
        with self.lock:
            self.answers[key] = raw
            while len(self.answers) > 32:
                del self.answers[next(iter(self.answers))]
        return raw


def series_moves(reactions: dict) -> dict[str, list[list]]:
    """Each series' measured moves as [the time each became known, percent], in time order, the latest 500: given once
    a series, so that a page counts only those measured before its edge."""
    moves: dict[str, list[list]] = {}
    for r in reactions.values():
        if r.get("series") and r.get("move") is not None:
            moves.setdefault(r["series"], []).append([r["at"], r["move"]])
    return {series: sorted(found)[-500:] for series, found in moves.items()}


def build_events(store: Store, retarget_rows: list[tuple], reactions: dict) -> list[dict]:
    """The calendar's events with their schedule as each revision made it known, the difficulty retarget as the
    estimates moved, and the measured reaction of each that has one."""
    by_id: dict[str, list[tuple[int, dict]]] = {}
    for event_id, _, known, entry in store.calendar_rows():
        by_id.setdefault(event_id, []).append((known, json.loads(entry)))
    events = []
    for event_id, revisions in by_id.items():
        revisions.sort(key=lambda r: r[0])
        latest = revisions[-1][1]
        schedule, last = [], None
        for known, e in revisions:
            item = {"knownAt": known, "at": e["at"], "precision": e["precision"], "end": e["end"] if e["at"] is not None else None,
                    "status": e["status"], "certainty": e["certainty"], "importance": e["importance"], "weight": weight_of(e)}
            if e["at"] is None:
                item["lastAt"] = e.get("lastAt")  # a cancelled or withdrawn event stays findable by the date it last had
            if last is None or any(item[k] != last[k] for k in ("at", "precision", "end", "status", "certainty", "importance")):
                schedule.append(item)
                last = item
        events.append({
            "id": event_id, "kind": latest["category"], "family": FAMILY.get(latest["category"], "macro"), "name": latest["title"],
            "short": short_label(latest["title"], latest["region"], latest["category"]), "region": latest["region"], "origin": latest["origin"],
            "series": latest["series"], "link": latest["link"], "window": latest["window"], "schedule": schedule,
            "measured": reactions.get(event_id),
        })
    # The difficulty retarget: an estimate that moves as blocks come; a new entry once it moves by an hour.
    by_height: dict = {}
    for _, known, _, at, extra in retarget_rows:
        x = json.loads(extra) if extra else {}
        by_height.setdefault(x.get("height"), []).append((known, int(at), x))
    for height, rows in by_height.items():
        rows.sort(key=lambda r: r[0])
        schedule = []
        for known, at, x in rows:
            if not schedule or abs(at - schedule[-1]["at"]) >= HOUR:
                schedule.append({"knownAt": known, "at": at, "precision": "instant", "end": None, "status": "scheduled",
                                 "certainty": "estimate", "importance": "low", "weight": 0.0, "change": x.get("change")})
        events.append({"id": f"retarget-{height}", "kind": "retarget", "family": "news", "name": "Bitcoin difficulty retarget",
                       "short": "Retarget", "region": None, "origin": "protocol", "series": "retarget", "link": None, "window": None,
                       "schedule": schedule, "measured": None})
    events.sort(key=lambda e: (e["schedule"][0]["at"] or e["schedule"][0].get("lastAt") or 0, e["id"]))
    return events


def find_jumps(prices: Prices, attention_at, dvol: Evidence, events: list[dict], start: int) -> list[dict]:
    """Unscheduled moves with an attention footprint: a 30-minute move on the cube's 15-minute closes at least 0.5% and
    four ordinary 30-minute spreads, with attention at 0.5 or more by its end, and no lit event within an hour; the
    largest of any within a day of each other."""
    lit = sorted(s["at"] for e in events for s in e["schedule"] if s["at"] is not None and s["weight"] >= 0.3 and s["precision"] == "instant")
    bars = [b for b in prices.bars if b[0] >= start]
    found = []
    for i in range(len(bars) - 2):
        t0, c0 = bars[i]
        t1, c1 = bars[i + 2]
        if t1 - t0 != 30 * MINUTE or c0 <= 0:
            continue
        move = (c1 / c0 - 1) * 100
        sigma, _, _ = dvol.at(t0)
        if sigma is None:
            continue
        ordinary = sigma * math.sqrt(30 / MINUTES_A_YEAR)
        a = attention_at(t1)
        k = bisect.bisect_left(lit, t0 - HOUR)
        near = k < len(lit) and lit[k] <= t1 + HOUR
        if abs(move) >= max(0.5, 4 * ordinary) and a is not None and a >= 0.5 and not near:
            found.append({"id": f"jump-{t0}", "at": t0, "window": 30, "move": round(move, 4), "bits": round(tail_bits(move / ordinary), 3)})
    found.sort(key=lambda j: -abs(j["move"]))
    kept = []
    for j in found:
        if all(abs(j["at"] - k["at"]) >= DAY for k in kept):
            kept.append(j)
    return sorted(kept, key=lambda j: j["at"])


def build_state(store: Store, prices: Prices, snapshot: dict, sources: dict, now_ms: int, cache: dict | None = None) -> State:
    """Every series' evidence, events and options context, from the store as it stands. ``cache`` keeps the parts whose
    series have not changed since the last build, and the parts of frequent rows as tails, computed again only from
    where their rows changed."""
    cache = cache if cache is not None else {}
    # The series with observations stored since the newest one the last build read; everything at the first build.
    last, seen = store.last_row(), cache.get("row", 0)
    changed = store.changed_since(seen) if seen else None

    def cached(key: str, series: tuple[str, ...], make):
        if key in cache and changed is not None and not any(s in changed for s in series):
            return cache[key]
        cache[key] = make()
        return cache[key]

    def tail(key: str, series: str, entries, start, align: int = 1) -> tuple[Tail, bool]:
        part = cache.get(key)
        if not isinstance(part, Tail):
            part = cache[key] = Tail(series, entries, start, align)
        return part, part.update(store)

    def evidence(key: str, name: str, series: str, entries, start, stale_ms: int, align: int = 1) -> Evidence:
        part, moved = tail(key, series, entries, start, align)
        if moved or key + ".evidence" not in cache:
            cache[key + ".evidence"] = evidence_of(name, part.done, stale_ms, store.retro_until(series))
        return cache[key + ".evidence"]

    components: dict[str, Evidence] = {}
    for code in MACRO_SERIES:
        components["macro." + code] = cached("macro." + code, ("fred:" + code,), lambda c=code: macro_evidence(c, store.rows("fred:" + c)))
    components["positioning.funding"] = cached("funding", ("funding:deribit", "funding:hyperliquid"),
                                               lambda: funding_evidence(store.rows("funding:deribit"), store.rows("funding:hyperliquid")))
    components["positioning.stablecoins"] = cached("stable", ("stable",), lambda: stablecoin_evidence(store.rows("stable")))
    components["positioning.basis"] = cached("basis", ("basis",), lambda: hourly_evidence("positioning.basis", store.rows("basis"), 0.3))
    components["positioning.skew"] = cached("skew", ("options",), lambda: hourly_evidence("positioning.skew", store.rows("options"), -0.3))
    # How far back a value at a row at or after a cut looks: news, the trailing day and the 30 complete days before it; social, the
    # trailing day; attention, the trailing week of two-hour shares, or of whole hours.
    components["news.tone"] = evidence("tail.news", "news.tone", "gdelt", news_entries, lambda cut: cut - cut % DAY - 31 * DAY, 2 * HOUR)
    components["social.words"] = evidence("tail.social", "social.words", "bluesky", social_entries, lambda cut: cut - DAY, HOUR)
    attention = {
        "attention.gdelt": evidence("tail.attention.gdelt", "attention.gdelt", "gdelt", gdelt_attention_entries,
                                    lambda cut: cut - 7 * DAY - 2 * HOUR, 2 * HOUR),
        **cached("wikipedia", ("wiki_day", "wiki_hour"), lambda: wikipedia_attention(store.rows("wiki_day"), store.rows("wiki_hour"))),
        "attention.bluesky": evidence("tail.attention.bluesky", "attention.bluesky", "bluesky", bluesky_attention_entries,
                                      lambda cut: cut - 7 * DAY - HOUR, 2 * HOUR, HOUR),
    }
    dvol = cached("dvol", ("dvol",), lambda: dvol_evidence(store.rows("dvol")))
    # Each sample is its own row's, so only the rows from the earliest new one on are read again.
    options = [e[1] for e in tail("tail.options", "options", options_entries, lambda cut: cut)[0].done]
    reactions = store.reactions()
    events = build_events(store, store.rows("retarget"), reactions)

    def attention_at(t: int) -> float | None:
        have = [(e.at(t)[0], w) for name, (_, w) in ATTENTION.items() if (e := attention.get(name))]
        have = [(v, w) for v, w in have if v is not None]
        return sum(v * w for v, w in have) / sum(w for _, w in have) if have else None

    first = min((v for v in (store.seen(s)[0] for s in SOURCES) if v is not None), default=now_ms)
    jumps = find_jumps(prices, attention_at, dvol, events, first)
    known = [e.known[-1] for e in [*components.values(), *attention.values(), dvol] if e.known]
    cutoff = max([*known, prices.cutoff or 0, snapshot.get("publishedAt") or 0])
    cache["row"] = last
    return State(built_ms=now_ms, snapshot=snapshot, sources=sources, components=components, attention=attention, dvol=dvol,
                 prices=prices, events=events, moves=series_moves(reactions), jumps=jumps, options=options, cutoff=cutoff,
                 version=store.version)
