# Strip

The **Strip** is a band between the price pane and the columns that shows what the cells cannot: the forces acting on BTC from outside this one market, as potential rather than as news items. Its first and only dataset so far is **Forces**. This document is the contract for the data behind it: the route Origo serves and the bridge relays, what each value means and when it was known, and the fixed formulas the page draws it with. Origo computes every value in the answer; the bridge checks the answer's shape and passes it on unchanged; the page computes only what [What the page computes](#what-the-page-computes) lists. No agent or learned model reads text anywhere in it: a force that uses text only counts its words against fixed lists, which its `method` names.

## What Forces draws

- **Hue** is where the forces lean: blue for up, orange for down, grey when they cancel. **Forces** sums all four; a single force (Macro, Positioning, News or Social) shows that one alone, with only its own events. Forces that cancel draw grey at their attention: Macro at +1 with Positioning at −1 is a grey band, and only the card's arrows show the pull each way.
- **Intensity** is attention: how much attention bitcoin is getting against its own recent normal. A quiet stretch is a dim band whatever its lean.
- **Light** is potential: each scheduled event's expected move, building toward its time and breaking there. It is drawn in the ink colour, dark on the light theme and light on the dark.
- **A seam** is a measured reaction: a line where an event's window closed, as strong as its surprise. An unscheduled move with an attention footprint draws one too.
- **The horizon box** right of the band holds the scheduled events of the next 90 days on a log scale of time to go, so the light ahead stays readable at any zoom.

These are descriptive figures, not calibrated forecasts. The colours are the explorer's positive and negative roles because they mean the same up and down; the band is set apart from the cells, candles and columns by its own frame, its name in the price labels' column and its place under the price pane.

## The route

`GET /cube/strip?proto=2&from=<ms>&to=<ms>&step=<ms>` answers for the grid times `from ≤ t < to`, in whole epoch milliseconds UTC.

- `step` is one of 900000 (15 minutes), 3600000 (an hour), 21600000 (6 hours) or 86400000 (a day); `from` is a multiple of it, `to` is after `from`, and the answer holds at most 20,000 grid times. A query outside these rules is `400 {"error": "invalid_strip_request", "detail": …}`.
- The bridge forwards `from`, `to` and `step` to the URL in its `STRIP_URL` environment variable and passes the answer on once it has the shape below. An upstream failure is `502 {"error": "strip_upstream_failed", "detail": …}`; an answer of the wrong shape, or over 16 MiB, is `502 {"error": "strip_invalid_answer", "detail": …}`.
- A bridge with `STRIP_URL` declares the strip in the page it serves, with `<meta name="explorer-strip" content="/cube/strip">` in its head, as it declares Mill. A page without the declaration never asks for the strip and says the strip is not served there; the route itself answers `503 {"error": "strip_not_configured"}` without `STRIP_URL`.
- The recorded page has no strip: it is live only, offers only Off, and never asks.
- Like every `/cube/` route, an outdated `proto` is `409` with `reload: true`. The strip's answer does not depend on the cube's pack: its identity is its `model`, its `sources` and its `cutoff`.

## The answer: `cube-strip@1`

```json
{
  "schema": "cube-strip@1",
  "model": "origo-strip@1",
  "cutoff": 1792692000000,
  "sources": {
    "macro": { "method": "macro-dollar-yields-credit@1", "recordedFrom": 1790000000000, "fittedThrough": null },
    "positioning": { "method": "funding-stablecoins@1", "recordedFrom": 1790000000000, "fittedThrough": null },
    "news": { "method": "news-tone@1", "recordedFrom": 1791000000000, "fittedThrough": null },
    "social": { "method": "social-words@1", "recordedFrom": 1792000000000, "fittedThrough": null },
    "attention": { "method": "attention@1", "recordedFrom": 1790000000000, "fittedThrough": null },
    "calendar": { "method": "calendar@1", "recordedFrom": 1790000000000, "fittedThrough": null },
    "history": { "method": "event-study@1", "recordedFrom": 1790000000000, "fittedThrough": null },
    "options": { "method": "deribit-events@1", "recordedFrom": 1790000000000, "fittedThrough": null }
  },
  "grid": {
    "t0": 1790100000000,
    "step": 900000,
    "forces": { "macro": [0.12, …], "positioning": [-0.31, …], "news": [null, …], "social": [null, …] },
    "attention": [0.42, …],
    "close": [81404.2, …],
    "next24h": [1.37, …]
  },
  "events": [
    {
      "id": "fomc-2026-10-28",
      "kind": "fomc",
      "family": "macro",
      "name": "FOMC decision",
      "short": "FOMC",
      "window": 60,
      "schedule": [{ "knownAt": 1777680000000, "at": 1793210400000 }],
      "prior": { "at": 1777680000000, "n": 46, "charge": 0.31, "skew": 0, "reaction": { "p5": -0.5, "p50": 0, "p95": 0.5, "bins": [[-3, -2.9, 0.0004], …] } },
      "estimates": [
        { "at": 1792670400000, "charge": 1.1, "skew": 0.2, "reaction": { "p5": -1.62, "p50": 0.1, "p95": 2.21, "bins": [[-4, -3.8, 0.0003], …] }, "expiry": { "at": 1793347200000, "p5": 74610, "p50": 81490, "p95": 87830, "share": 0.088 } },
        { "at": 1792692000000, "charge": 1.2, "skew": 0.3, "reaction": { "p5": -1.76, "p50": 0.14, "p95": 2.47, "bins": [[-4, -3.8, 0.0003], …] }, "expiry": { "at": 1793347200000, "p5": 74522, "p50": 81537, "p95": 87949, "share": 0.096 } }
      ],
      "measured": null
    }
  ],
  "jumps": [
    { "id": "jump-202610140845", "at": 1791967500000, "window": 30, "move": -1.9, "bits": 4.2 }
  ]
}
```

| Field | Meaning |
|---|---|
| `schema` | Always `cube-strip@1`. A change of meaning is a new schema, never a quiet change to this one. |
| `model` | The producing model and its version, shown in the strip's details. |
| `cutoff` | The latest time any value in the answer became known. |
| `sources.<source>` | For each of `macro`, `positioning`, `news`, `social`, `attention`, `calendar` (the schedules), `history` (the priors) and `options` (the estimates): `method`, the formula's name and version (1 to 64 characters); `recordedFrom`, the time from which its values are kept as they were first computed, or `null` where none are yet; and `fittedThrough`, the last time of the history its parameters were fitted on, or `null` where it has none. See [Known-at](#known-at). A method's description says its inputs, its sign and its normalisation window. |
| `grid.t0`, `grid.step` | The first grid time and the spacing, both in ms; `t0` is `from`. Every array in `grid` has one value per grid time. |
| `grid.forces.<force>` | For each of `macro`, `positioning`, `news` and `social`: signed evidence that BTC will rise (positive) or fall (negative) at each grid time, scaled so that ±1 is a strong lean by the force's own trailing history and the four add; `null` where the force is not known. |
| `grid.attention` | Attention at each grid time on 0–1, where 0.3 is ordinary and 1 is the most the scale shows, against its own trailing normal; `null` where not known. |
| `grid.close` | BTC's price at each grid time: the last trade at or before it on Binance BTCUSDT spot, the cube's own trades; `null` where not known. |
| `grid.next24h` | BTC's change in percent from the grid time's close to the close 24 hours later; `null` until those 24 hours have passed. |
| `events[]` | Every scheduled event that any entry of its schedule puts in `[from − 1 day, to + 90 days)`, so a replay sees an event that was later moved or cancelled, and the horizon box sees the next 90 days. Each event belongs to one force, its `family`. |
| `.id`, `.kind`, `.family` | A stable id, never reused; the kind (`fomc`, `cpi`, `jobs`, `ppi`, `gdp`, `pce`, `jolts`, `eci`, `election`, `expiry`, `retarget`, or another named kind); the force it belongs to. |
| `.name`, `.short` | The full name and a label of at most 8 characters. |
| `.window` | Minutes after the event over which its reaction is measured, 1 to 1440: 30, or 60 for FOMC. |
| `.schedule` | Every time the event was given, in the order they became known: `knownAt`, when it was published, and `at`, when the event was to happen then, or `null` where it was cancelled. `knownAt` rises strictly, and is never after a non-null `at`. |
| `.prior` | The expected reaction from history alone: `at`, when it was computed, from the releases of its kind before then only; `n`, how many past releases it rests on; `charge`, `skew` and `reaction` as for an estimate. |
| `.estimates` | Every estimate from option prices, in the order made: `at`, when the prices were quoted; `charge`; `skew`; `reaction`; and `expiry`. All are made before the event, at most one every 6 hours. Empty where the options price nothing for it. |
| `.charge` | The expected size of the move over the window, in percent, as a standard deviation. |
| `.skew` | How the options' skew moves across the event, −1 (toward down) to +1 (toward up); 0 for a prior. |
| `.reaction` | The distribution of BTC's percent move over the window: its p5, p50 and p95 (in order), and `bins` of `[low, high, probability]` in order and not overlapping, the probabilities summing to 1. From options it is a risk-neutral distribution, not a real-world probability. |
| `.expiry` | The options' risk-neutral range for BTC's price at the first Deribit expiry after the event's window closes, from the density implied by that expiry's option prices at the estimate's `at`: the expiry's time, p5, p50 and p95 in USDT, and the event's share of the variance to then; `null` where there is none. |
| `.measured` | Once the window has closed: `from`, when it opened (the event's last scheduled `at`); `at`, when it closed, `from + window`; `move`, BTC's percent change from the close at `from` to the close at `at`; and `bits`, its surprise. `null` before. |
| `.bits` | Surprise in bits: −log2 of the two-sided probability of a move at least this large under the expectation known when the window opened (the latest estimate before it, else the prior), as a Student t with 3 degrees of freedom at that charge. For a jump, under BTC's ordinary 30-minute spread known at its `at`. |
| `jumps[]` | Unscheduled moves with an attention footprint, inside `[from, to)`: `id`, `at`, `window` in minutes, `move` in percent and `bits`, each known at `at + window`. |

## Known-at

The page draws only what was known strictly before the **edge**: the data's cutoff, or the replay's edge, in whole ms. A value known at the edge itself is not yet drawn.

- A grid value at time `t` is computed only from what was published by `t`: its normalisation and any trailing window end at `t`. It is known at `t`. `next24h` at `t` is known at `t + 24 h`.
- An event is known from its first schedule entry's `knownAt`, at the time its latest entry known by then gives; an entry with `at: null` cancels it from its `knownAt`. Its prior is known at its `at`, each estimate at its `at`, and `measured` at `measured.at`. A jump is known at `at + window`.
- **Vintages.** From a source's `recordedFrom` on, Origo keeps each value as it was first computed: a later revision of the source's history never changes it. Values from before `recordedFrom` were computed later from the history as it stands today, and a method fitted on history is in sample up to its `fittedThrough`. Such values are **retrospective**: the page marks where they end and says so in its cards, as the explorer does for its other models.

## What the page computes

The page draws with fixed formulas over the answer, and nothing else. Its figures are descriptive, not calibrated forecasts.

- **Lean.** Forces sums the forces known at a time, skipping the unknown ones, and its card says how many of the four were known; a single force is its own value. No force known means no hue: the column carries the hatch the explorer draws for an undefined value, never a lean of zero.
- **Hue and intensity.** A lean `L` takes the colour tables' positive or negative arm, which run in Lab from the midpoint grey to the role, at `min(1, |L|)^0.6`. Attention `a` lays that colour over the band's ground at an alpha of `min(1, 1.7 a)`. Where attention is not known, the colour is laid at 0.5 and a 5 px strip of the same hatch runs along the band's foot. The mapping is fixed: no scale is fitted, so Explore, Comparison lock and Auto colour do not apply.
- **Sampling.** Each pixel column shows the values held at its centre time, from the finest grid the page holds there; it is never averaged.
- **Light.** At a time `t`, each event the schedule then known puts within 14 days after `t` adds `min(1, charge / 2) · exp(−(at − t) / 2 days)`, from the expectation known at `t` (the latest estimate before `t`, else the prior), up to 1 in all. A prior that rests on fewer than 30 past releases is not used: such an event draws no light until an estimate prices it.
- **Seams and labels.** A measured reaction or a jump known by the edge draws a 2 px line at its window's close in the ink colour, at an opacity of `0.22 + 0.78 · √(min(1, bits / 3) · min(1, |move| / 2))`. An event is labelled, at its time, and its reaction seamed, only when its expected move is at least 0.15%; an expiry or a retarget that the options price at nothing draws neither, and the cards say so. A label that would overlap the one before it is left out.
- **Order.** The band's ground, then the hue, the hatch where a value is not known, the 1 px dashed line where the shown forces' retrospective values end, the light, the seams; the labels sit in a 12 px row above the 22 px band.
- **Horizon.** The box is the profile column's width when that is at least 40 px (62 px with Rows off, 128 px with Rows on) and is not drawn where the profile tracks fold, under 600 px. Its time to go runs from the edge, not the wall clock: an event at `at` sits at `log1p((at − edge) / 1 h) / log1p(90 days / 1 h)` of the box's width, for `edge < at ≤ edge + 90 days`, with ticks at a day, a week and 30 days. An event leaves the box at its time, even while its reaction window is open. The box draws light only; its card lists the lit events ahead.
- **Prices.** A card turns a percent move into a price from the last `close` known at the edge.
- **Track record.** For the forces at a time `t`, the page takes the hourly grid times `s` of the two years before the data's cutoff with `s + 24 h < min(t, edge)`, so no moment's outcome overlaps `t`'s or is unknown at the edge. The forces compared are those known at `t` that are known at more than half of those times, read from the hourly grid at `t` whatever the view's step. It keeps the times whose forces lie within 0.5 of `t`'s (Euclidean), nearest first, each at least six hours from those kept, up to 40, and needs at least 30: with fewer it says how many there were and shows no figures. It shows the share of them after which BTC fell over the next 24 hours, against the share for all those times six hours apart, and the p5, p50 and p95 of both. Samples overlap.
- **Quantiles.** A pth quantile of `n` sorted values is the value `(n − 1) · p` of the way along them, interpolated linearly between the two order statistics either side.
- **An event's own move.** The card shows the reaction known at the edge, from options (risk-neutral) or from history, with how many past releases a prior rests on; a prior on fewer than 30 is withheld. The expiry's range is one line of context with its own horizon, never the window's p5 to p95.

## Reads and states

- The page reads only while the Strip is on, the page is live and the strip is declared. It reads one grid at a time, in no query slot of the cube's: the view's grid first (the view and a quarter of it either side, at the finest step that keeps under two grid times a pixel), then the history (hourly, the two years to the data's cutoff). A held grid is read again once it is five minutes old where it reaches the live edge, the history once it is half an hour old, and a failed read after a minute. Turning the Strip off stops reading and abandons a read under way.
- The states are kept apart, in the band and in the selector's `data-state`: **off**; **unconfigured**, the page served without the strip; **loading**; **failed**, with the bridge's error; and **ready**. A ready band with no force known in view says so. The recorded page offers Off alone.
