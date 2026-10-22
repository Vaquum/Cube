# Strip

The **Strip** is a band between the price pane and the columns that shows what the cells cannot: the forces acting on BTC from outside this one market, as potential rather than as news items. Its first and only dataset so far is **Forces**. This document is the contract for the data behind it, the route Origo serves and the bridge relays, and the fixed formulas the page draws it with. No model reads text anywhere in it: every value is a price, a count or a published figure, or a fixed formula over them.

## What Forces draws

- **Hue** is where the forces lean: blue for up, orange for down, grey when they cancel. **Forces** sums all four; a single force (Macro, Positioning, News or Social) shows that one alone, with only its own events.
- **Intensity** is attention: how much attention bitcoin is getting against its own recent normal. A quiet stretch is a dim band whatever its lean.
- **White light** is potential: each scheduled event's expected move, building toward its time and breaking there.
- **A seam** is a measured reaction: a bright line where an event's window closed, as bright as its surprise. An unscheduled move with an attention footprint draws one too.
- **The horizon box** right of the band holds the scheduled events of the next 90 days on a log scale of time to go, so the light ahead stays readable at any zoom.

## The route

`GET /cube/strip?proto=2&from=<ms>&to=<ms>&step=<ms>` answers for the grid times `from ≤ t < to`, in epoch milliseconds UTC.

- `step` is one of 900000 (15 minutes), 3600000 (an hour), 21600000 (6 hours) or 86400000 (a day); `from` is a multiple of it, `to` is after `from`, and the answer holds at most 20,000 grid times.
- The bridge forwards the same query to the URL in its `STRIP_URL` environment variable and passes the answer on once it has the shape below. Without `STRIP_URL` it answers `503 {"error": "strip_not_configured"}`, and the page says the strip is not served yet; an upstream failure is `502 {"error": "strip_upstream_failed", "detail": …}`, and an answer of the wrong shape `502 {"error": "strip_invalid_answer", "detail": …}`. A query outside these rules is `400 {"error": "invalid_strip_request", "detail": …}`.
- The recorded page has no strip: it is live only.

## The answer: `cube-strip@1`

```json
{
  "schema": "cube-strip@1",
  "model": "origo-strip@1",
  "cutoff": 1792692000000,
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
      "id": "fomc-202610281800",
      "kind": "fomc",
      "family": "macro",
      "name": "FOMC decision",
      "short": "FOMC",
      "at": 1793210400000,
      "knownAt": 1777680000000,
      "window": 60,
      "prior": { "charge": 0.31, "from": "history", "at": 1777680000000, "skew": 0, "reaction": { "p5": -0.5, "p50": 0, "p95": 0.5, "bins": [[-3, -2.9, 0.0004], …] }, "expiry": null },
      "estimate": { "charge": 1.2, "from": "options", "at": 1792692000000, "skew": 0.3, "reaction": { "p5": -1.76, "p50": 0.14, "p95": 2.47, "bins": [[-4, -3.8, 0.0003], …] }, "expiry": { "at": 1793347200000, "p5": 74522, "p50": 81537, "p95": 87949, "share": 0.096 } },
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
| `grid.t0`, `grid.step` | The first grid time and the spacing, both in ms; `t0` is `from` rounded down to `step`. Every array in `grid` has the same length. |
| `grid.forces.<force>` | For each of `macro`, `positioning`, `news` and `social`: signed evidence that BTC will rise (positive) or fall (negative), in units the four forces add in, at each grid time; `null` where the force is not known. |
| `grid.attention` | Attention at each grid time on 0–1, where 0.3 is ordinary and 1 is the most the scale shows; `null` where not known. |
| `grid.close` | BTC's Binance BTCUSDT spot price at each grid time: the last trade at or before it; `null` where not known. |
| `grid.next24h` | BTC's change in percent from the grid time to 24 hours later, from those closes; `null` until those 24 hours have passed. |
| `events[]` | The scheduled events at times in `[from − 1 day, to + 90 days)`, so the horizon box can show the next 90 days. |
| `.id`, `.kind`, `.family` | A stable id; the kind (`fomc`, `cpi`, `jobs`, `ppi`, `gdp`, `pce`, `jolts`, `eci`, `election`, `expiry`, `retarget`, or another named kind); the force it belongs to. |
| `.name`, `.short` | The full name and a label of at most 8 characters. |
| `.at`, `.knownAt` | When it happens, and when its date was published. |
| `.window` | Minutes after `at` over which its reaction is measured: 30, or 60 for FOMC. |
| `.prior` | The expected reaction from history alone, known at `knownAt`. |
| `.estimate` | The latest estimate, known at its own `at`; `null` where there is none. Options-based where `from` is `options`. |
| `.charge` | The expected size of the move over the window, in percent, as a standard deviation. |
| `.skew` | How the options' skew moves across the event, −1 (toward down) to +1 (toward up); 0 for history. |
| `.reaction` | The distribution of BTC's percent move over the window: its p5, p50 and p95, and `bins` of `[low, high, probability]` covering it, the probabilities summing to 1. |
| `.expiry` | The options' range for BTC's price at the first expiry after the event: when it is, p5, p50 and p95 in USDT, and the event's share of the variance to then; `null` for history. |
| `.measured` | Once the window has closed: `move`, BTC's percent change over it, `bits`, its surprise against what was expected, and `at`, when the window closed. `null` before. |
| `jumps[]` | Unscheduled moves with an attention footprint: `id`, `at`, `window` in minutes, `move` in percent and `bits`, each known at `at + window`. |

## Known-at

Every value in the answer is known at a stated time, and the page draws only what was known by the edge of the view: the data's cutoff, or the replay's edge.

- A grid value at time `t` was computed only from what was published by `t`. A value is never revised after it is first published: where a source revises its history, the strip keeps what was first known.
- `next24h` at `t` is known at `t + 24 hours`.
- An event is known at its `knownAt`. Its `estimate` is known at the estimate's `at`; before that, the page uses the `prior`. Its `measured` is known at `measured.at`.
- A jump is known at `at + window`.

## What the page computes

The page draws with fixed formulas over the answer, and nothing else.

- **Lean.** Forces sums the forces known at a time, skipping the unknown ones; a single force is its own value. No force known means no hue: the band shows the neutral mark for missing data, never a lean of zero.
- **Hue and intensity.** A lean `L` mixes from the neutral grey toward the positive or negative role by `min(1, |L|)^0.6`; attention `a` lays that colour over the band's ground at an alpha of `min(1, 1.7 a)`. Unknown attention lays it at 0.5.
- **Light.** An event's light at a time before it is `min(1, charge / 2) · exp(−(at − t) / 2 days)`, from the charge known then, and nothing after it. The lights of events add, up to 1.
- **Seams and labels.** A measured reaction or a jump draws a line at its window's close whose strength is `0.22 + 0.78 · √(min(1, bits / 3) · min(1, |move| / 2))`. An event is labelled, and its reaction seamed, only when its expected move is at least 0.15%: an expiry or a retarget that the options price at nothing draws neither.
- **Prices.** A card turns a percent move into a price from the last `close` known at the edge.
- **Track record.** For the forces at a time `t`, the page takes the past grid times `s` with `s + 24 h ≤ edge`, each at least six hours from the others, whose forces lie within 0.5 of `t`'s (Euclidean, over the forces known at `t` that are known at more than half of the past times), nearest first, up to 40. It shows the share of them after which BTC fell over the next 24 hours, against the share for all past times six hours apart, and the p5, p50 and p95 of both.
