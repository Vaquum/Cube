# Strip

## Micro

The live bridge also declares Micro independently of Forces, through
`<meta name="explorer-micro" content="/cube/micro">`. Micro uses the existing
Origo market-state service and its existing two-slot query admission. It
adds no worker, collection, provider access or operational storage.

Micro uses the same continuous Lab color field, theme/appearance LUT, alpha and
variable light renderer as Forces. Its independent dimensions are:

- Hue: `(meanBid - meanAsk) / (meanBid + meanAsk)`, with grey for balance.
  Means use actual one-Hz samples for which both 0.1 bp radii are captured.
- Intensity: total mean near depth against its own preceding-hour mean. For
  ratio `r`, intensity is `min(1, log2(1+r)/3)`, laid at Forces' `min(1,1.7a)`
  alpha. The normal excludes the displayed interval, uses quotes received by
  their minute close, and needs 1800 observed eligible seconds. Unknown normal
  has the same middling alpha and missing-support foot as Forces; it is not
  fitted to the view or zoom.
- Light: gross individual executed USDT per second divided by mean near depth.
  For pressure `p`, light is `1-exp(-p)`; Forces' beam renderer varies its height
  and opacity independently of book hue. Aggregate USDT never enters this flow.
- Seams: observed first-to-last mid movement in each completed bin. A one-pixel
  seam has opacity `0.35*(1-exp(-abs(moveBps)/10))`; 10 bp is a fixed display scale.

Hatching distinguishes unavailable lean, unavailable normal/flow, and partial
book support. The upper missing-support foot is proportional to absent
near-book seconds, as Forces' coverage foot is proportional to missing inputs.
An empty near radius has undefined lean and pressure, not invented balance.

Hover uses Forces' fixed 484 px frame, or its 280 px two-column frame at short
heights, clamped within the viewport. The loaded interval's mean book balance,
depth normal and observed response appear immediately. While a finer read is
pending, Market ribbon shows up to twelve loaded bins with its grid stated.
The optional preceding-thirty-second read enriches that ribbon without
blanking or resizing the card. Its own exact time bounds remain separate from
the strip interval's header. Bubbles have side USDT area at execution VWAP;
the mid path and mean resting-depth shade share that timeline. The first
captured quote is the disclosed baseline when a pre-window anchor is absent.
The ribbon reports its actual book sample support. The strip labels the latest
loaded book exchange time, independently of the cube's trade cutoff.
Inspect retains the same interval figures. Its Response map follows
cumulative net aggressive USDT against observed mid movement; its ending ring
shows bid/ask near-depth shares. Sources exposes the exact accepted partition,
revision/build identities and the method. Exchange and receipt clocks remain
separate. This is descriptive co-movement, not an estimate of causal impact or
hidden liquidity.

Micro pins individual-trade generations to the cube pack held by the page.
Overview uses accepted minute trade/aggregate statistics, observed-second book
means and separate first/last quote evidence. Detail reads executions and
actual aggregate groups. Group counts
and mean size provide grouping context about the same executions; aggregate
notional is never added to individual flow. Groups are not assumed to identify
complete parent orders. Missing coverage stays unavailable rather than zero.

No Micro request is started while it is inactive or while a captured
investigation is selected. Requests end at the cube/replay edge, and every book
receipt is strictly before that edge. Detail ends at the inspected second.
Historical data reconstructs accepted source generations, not first-publication
knowledge of trade corrections. A cached live page cannot paint a quote after a
rewound receipt edge. The existing immutable book cohort begins
2026-10-24T13:00Z; earlier times have no captured book. Wide views page through
bounded 31-day Origo reads with no more than 4096 bins per request. An eight-entry
API cache validates all three sources' activations and anchors before reuse;
baseline-only book identities participate. The bridge always reaches that
validator instead of trusting a whole-pack cache. The browser retains sixteen
detail windows, finishes one read at a time, and gives the loaded interval
priority during a sweep. Same-pack, same-grid facts remain visible while a pan
refreshes. Recorded/captured investigations without these inputs disclose
their absence. Rewind checks the maximum receipt contributing to every bin,
not just the final quote's receipt.

The HTTP request is `POST /cube/micro?proto=2` with exactly `pack`, `from`, `to`,
`step`, `as_of`. Times are integer epoch milliseconds, intervals half-open and
aligned. The bridge derives the relevant trade-pin digest, validates the held
cutoff and relays Origo's `origo-micro@1` response. Source changes return an
explicit conflict instead of blending generations. The native API contract is
documented in Origo's `docs/Developer/Market-state-micro.md`.

The **Strip** is a band between the price pane and the columns. **Forces** shows the forces acting on BTC from outside this one market, as potential rather than as news items. Its data comes from [field-data-api](https://github.com/Vaquum/field-data-api), the shared service of compact field-data projections and the calendar, and from the cube's own prices. This document is the Strip's contract: what the bridge reads from the service, how each projected field becomes a value the page draws, the route the page reads, and the fixed formulas both sides use. News reads the service's pinned financial FinBERT scores; Social retains its literal word counts. Financial tone describes the text, not Bitcoin price direction.

## What Forces draws

- **Hue** is where the forces lean: blue for up, orange for down, grey when they cancel. **Forces** sums all four; a single force (Macro, Positioning, News or Social) shows that one alone, with only its own events. Forces that cancel draw grey at their attention: Macro at +1 with Positioning at −1 is a grey band, and only the card's arrows show the pull each way.
- **Intensity** is attention: how much attention bitcoin is getting against its own recent normal. A quiet stretch is a dim band whatever its lean.
- **Light** is how much the calendar says an event matters: each event's importance, dimmed where its date is not confirmed, building toward its time and breaking there. It is drawn in the ink colour, dark on the light theme and light on the dark. Each pixel follows the strongest event contribution, so the number of events alone cannot create a permanently saturated mask. Its height and opacity both follow that contribution, as in the reference design.
- **A seam** is a measured reaction: a line where an event's window closed, as strong as its surprise. An unscheduled move with an attention footprint draws one too.
- **The horizon box** right of the band holds the events of the next 90 days on a log scale of time to go, so the light ahead stays readable at any zoom.

These are descriptive figures, not calibrated forecasts. The colours are the explorer's positive and negative roles because they mean the same up and down; the band is set apart from the cells, candles and columns by its own frame, its name in the price labels' column and its place under the price pane.

## How the bridge reads field-data-api

The bridge reads the service from its own process; the service refuses requests from a browser. `FIELD_DATA_URL` names it (on the Cube host, `http://127.0.0.1:8491`), and `FIELD_DATA_API_TOKEN` is sent as a bearer token where the service requires one. Without `FIELD_DATA_URL` the strip is not served. Provider collection and credentials belong to the service; the bridge never calls a provider.

- **One publication per update.** A worker thread (`tools/strip_service.py`) asks `/v1/snapshots/latest` once a minute. When the `snapshot_id` is new, it reads every source it uses and the calendar under that one `snapshot_id`, through `tools/field_data.py`. A source whose `dataset_id` is the same as the one it holds is not read again.
- **Every page.** Each `/v1/data/{source}` and `/v1/calendar` read follows `page.next_offset` until it is null, keeping the same pin. The calendar has 721 events, more than one 500-record page.
- **Each source on its own.** A source without a dataset (`disabled`, `pending`, `blocked`, `error`), one that answers 503, and one whose read fails are recorded with their state, and the rest of the update goes on. A stale source still reads, and stays stale in the answer. Nothing missing becomes a zero.
- **First seen, kept.** Every observation is stored once, in `STRIP_STORE` (`/var/lib/cube-explorer/strip.sqlite`, beside the investigations), the first time a publication carries it: its known-at is that publication's `published_at`. A value seen again under a later publication never replaces the first. At start, the worker lists version metadata and reads each complete dataset oldest first under its `first_snapshot_id`, checking the dataset identity and following every page. Older service versions use an explicitly checked as-of pin. A first complete scan reconstructs each source in publication order to repair caches made by the former 300-version startup cap, including first-seen times and calendar withdrawals; Routine retries stop at acknowledged history. Startup and changes to the live publication’s backfill summary scan metadata past acknowledged live heads for unseen historical captures; unchanged summaries do not trigger another scan. Large pages shrink while keeping the same pin. Replay commits atomically per source. A failure retains that source's prior state, durably marks its history incomplete, and blocks newer ingestion until recovery. Pending sources retry independently after five minutes, with the reason in source detail. A response-size error is never treated as empty history.
- **Retrospective windows.** A source's first dataset carries a native window of older observations: FRED's last 20, DefiLlama's 30 days, Wikipedia's 7. Those the source made public more than one collection interval before the dataset was received were collected later than they happened. They are marked retrospective and placed at the time their source makes them public (the rules below).
- **The cube's prices.** Closes, the next 24 hours' changes, measured reactions and jumps come from the cube's own bars (Binance BTCUSDT spot, the cube's existing source), read through the bridge's second query slot in chunks of at most 2,048 bars, half a second apart: hourly bars for two years, 15-minute bars for 30 days, and base bars around each event's window. A page's reads never wait long behind them. One-minute spot and perpetual candles stay on the cube; the strip reads none from the service.
- **Off the request path.** `/cube/strip` answers from what the worker last built, in memory, and never waits on the service or the cube. An answer is kept per grid until the next build.
- **A build stays short as the history grows.** The worker builds again only when a publication or the cube's prices moved, and computes again only the parts whose series changed. The parts of frequent rows (News, Social, the GDELT and Bluesky attention, and the options' samples) are computed again only from the earliest new row, reading back only as far as their formula looks: a day for Social, each capture's stored aggregate for News, a week of shares for attention, nothing for the options. That gives exactly what one computation over every row gives (`tests/unit/strip-model.test.js`). With two years of rows, a build after a publication takes about 0.2 s; the first build after a start computes everything once.

## Source mappings

What the Strip takes from each projection ([projection contracts](https://github.com/Vaquum/field-data-api/blob/main/docs/projections.md)), and what it becomes. Units stay as the service gives them until a formula below combines them.

| Source | Fields read | Becomes | Known at |
|---|---|---|---|
| `fred_macro_daily` | `values.series` (DTWEXBGS, DGS2, DGS10, BAMLH0A0HYM2), `values.value`, `observed_at` (a date) | Macro: one part a series | The publication that first carried it; for the first window, 22:00 UTC the next day, and the broad dollar index the Monday after its week, 16:15 in New York |
| `deribit_funding` | `values.interest_1h`, `observed_at` | Positioning's funding: annualised percent, averaged with Hyperliquid's by the hour | That publication; for the first window, its observation time |
| `hyperliquid_funding` | `values.funding_rate`, `values.funding_period_seconds`, `observed_at` | The same, its rate taken to an hour | The same |
| `defillama_stablecoins` | `values.total_usd`, `observed_at` (a date) | Positioning's stablecoin supply: its 7-day log growth; daily supply is never summed | That publication; for the first window, 06:00 UTC the next day |
| `deribit_futures_basis` | the nearest expiry at least 30 days out: `event_at`, `values.simple_annualized_basis_fraction_oi_weighted`, else its median | Positioning's basis, one sample an hour; never weighted across maturities | That publication |
| `deribit_options` | buckets of `values.expiry_bucket`, `strike_underlying_bucket`, `option_type`, `mark_iv_oi_weighted_percent`, `iv_valid_weight`; `meta.totals.put_call_oi_ratio` | Positioning's put skew: the 7–30 day put IV at 0.90–0.98 less the call IV at 1.02–1.10, one sample an hour; the at-the-money IV of each expiry bucket (calls and puts at 0.98–1.02, weighted by their valid IV weight) and the put/call ratio for the cards. `same_day` stays its own bucket. Rolling 24-hour volumes are not read. | That publication |
| `deribit_dvol` | complete hourly bars: `values.close`, `metadata.interval_end` | The ordinary spread for surprise, and the options context | That publication; for the first window, its bar's end |
| `gdelt_gkg` | batches: `bitcoin_articles`, `panel_articles`, `observed_at` | Attention: the Bitcoin share of the panel over two hours. Batch counts are not a five-minute flow. | That publication; for the first window, the batch time and 15 minutes |
| `financial_news_tone` | URL, publication and analysis times, scope, pinned model/method, probabilities and score | News: each capture's mean financial tone of unique articles published in its trailing 24 hours. The latest analyzed version of each URL wins; invalid probabilities, future timestamps and incompatible model versions are excluded. | The actual capture publication; analysis of older articles never creates earlier force history |
| `bluesky_live` | minute rows: `values.creates`, `bitcoin_creates`, `bullish_word_matches`, `bearish_word_matches`, `observed_at`, `metadata.interval_end`, `dictionary_version` | Social: bullish against bearish words over the trailing day; attention: the hourly share of posts that mention bitcoin. Each row is counted once, by its id; overlapping sessions are not added again. | That publication |
| `wikimedia_daily`, `wikimedia_hourly` | `values.views`, `observed_at` | Attention: readers of the Bitcoin article against their own normal | That publication; for the first window, 03:00 UTC the next day, or three hours after the hour |
| `mempool_retarget` | `values.estimatedRetargetDate`, `nextRetargetHeight`, `difficultyChange` | An event with an estimated time, a new schedule entry once the estimate moves by an hour | That publication |
| `sosovalue_etf_flows` | Individual USD net flows and matching selected-fund membership | Inspect: latest reported day's fund sum, report date and reported/expected fund counts; an incomplete sum is explicitly reported coverage | Actual capture publication |
| `coinalyze_current` | USD open interest, symbol and provider update time | Inspect: reported-market OI, oldest provider update and market coverage | Actual capture publication |
| `coinalyze_history` | Complete USD long/short liquidation bars inside the capture's explicit window | Inspect: reported long/short totals, window bounds and market coverage | Actual capture publication; a late historical window never displaces a newer window |
| `/v1/calendar` | `id`, `values.title`, `category`, `status`, `schedule` (instant, date or date range), `schedule_certainty`, `context.importance`, `context.region`, `context.source_id`, `metadata.revision_id`, `metadata.provenance.url` | Events: each revision a schedule entry, its precision kept; a date is never turned into a midnight appointment | The publication that first carried that revision |

The three raw positioning readouts do not contribute to force scores or historical matching. They expire after twelve hours for an ETF capture, ten minutes for OI and thirty minutes for a liquidation capture. They appear in Inspect for Forces and Positioning; the compact hover card retains its geometry and distribution. Funding from Coinalyze is not combined because its venue funding periods are unknown.

Not read: `coinalyze_markets` and `coindesk_headlines`; `deribit_perpetual` and `hyperliquid_perpetual`, whose current funding is the funding series' own; `mempool_difficulty_history`; the optional provider calendars; and `kalshi_event_odds`, whose terms restrict passing its quotes on, so a deployment that shows them to other people needs Kalshi's permission first.

## What the bridge computes

Each force is a sum of parts, each part a fixed formula over its source's stored observations, method `field-strip@2` (`tools/strip_model.py`). A part's value stands until it is stale: six days for a FRED series (nine for the dollar index), three days for stablecoins, three hours for funding, two hours for basis, skew, news and the attention parts, one hour for social, two days for Wikipedia's daily readers.

- **Macro.** For each FRED series: its change over the last 5 observations, divided by √5 times the standard deviation of its single-observation changes over the trailing 60, as z; the part is `−0.5 · tanh(z / 2)`. Up is a headwind for BTC in all four: a dearer dollar, higher yields, wider credit spreads. Its sign is fixed, not fitted.
- **Positioning.** Funding, annualised and averaged across the two venues hour by hour, as z against the trailing 30 days (at least 24 hours): `0.6 · tanh(z / 2)`, longs paying a lean up. Stablecoin supply's 7-day growth as z against the trailing year (at least 14 days): `0.4 · tanh(z / 2)`. The futures basis about 30 days out: `0.3 · tanh(z / 2)`. The options' put skew: `−0.3 · tanh(z / 2)`, dearer puts a lean down. Both of those against their trailing 30 days of hourly samples, at least 24.
- **News.** `0.6 · mean(positive probability − negative probability)` over unique article URLs published in the capture's trailing 24 hours, each weighted equally. The pinned financial model is `yiyanghkust/finbert-tone` revision `4921590d3c0c3832c0efea24c8381ce0bda7844b`, method `finbert_sentence_token_weighted/1`. Both body and explicitly labeled headline inputs contribute; their counts remain in the component detail. One valid article is sufficient; a capture with none explicitly makes the component unavailable. This uses the model's existing −1…+1 scale and requires no historical-normal warmup. Each actual capture is one observation, so repeated captures never add article counts together. GDELT dictionary tone is excluded from this News component. Older recorded investigations retain their original component names, model and source labels.
- **Social.** Over the trailing day of samples, with at least 10 posts that mention bitcoin and 3 words: `0.8 · (bullish − bearish) / (bullish + bearish + 5)`.
- **Attention.** Each part is `min(1, max(0, 0.3 + 0.25 · log2(ratio)))`, a ratio of 1 being ordinary, against the median of its own trailing window (at least 6 values). The parts are the GDELT share (weight 0.5, against a week), Wikipedia daily (0.15, against 30 days), Wikipedia hourly (0.15, against a week) and the Bluesky share (0.2, against a week, hours with at least 300 posts). Attention is their weighted mean over the parts known.
- **An event's weight.** Its light is its importance (high 1, medium 0.35, low 0) times its certainty (confirmed 1; tentative, set by rule, unspecified or estimated 0.7). A central bank's decision has a 60-minute reaction window; any other timed release 30 minutes; a date or a range of dates has none, since its hour is not given.
- **Measured reactions.** Once an event's window has closed in the cube's data: BTC's percent change from the base bar holding its time to the close of the bar holding the window's end. Its surprise in bits is `−log2` of the two-sided probability of a move that large under a unit-variance Student t with 3 degrees of freedom, scaled to the ordinary spread over the window at the DVOL known when it opened, `DVOL · √(window / one year)`. Each is computed once and kept.
- **Jumps.** A 30-minute move on the cube's 15-minute closes of at least 0.5% and four ordinary 30-minute spreads, with attention at 0.5 or more at its end and no lit event within an hour: the largest of any within a day of each other.

## The route

`GET /cube/strip?proto=2&from=<ms>&to=<ms>&step=<ms>` answers for the grid times `from ≤ t < to`, in whole epoch milliseconds UTC.

- `step` is one of 900000 (15 minutes), 3600000 (an hour), 21600000 (6 hours) or 86400000 (a day); `from` is a multiple of it, `to` is after `from`, and the answer holds at most 20,000 grid times. A query outside these rules is `400 {"error": "invalid_strip_request", "detail": …}`.
- Before the worker has read its first publication: `503 {"error": "strip_loading", "detail": …}`.
- A bridge with `FIELD_DATA_URL` declares the strip in the page it serves, with `<meta name="explorer-strip" content="/cube/strip">` in its head, as it declares Mill. A page without the declaration never asks for the strip and says it is not served there; the route itself answers `503 {"error": "strip_not_configured"}`.
- The recorded page has no strip: it is live only, offers only Off, and never asks.
- Like every `/cube/` route, an outdated `proto` is `409` with `reload: true`. The answer's identity is its `model`, its `snapshot` and its `cutoff`.

## The answer: `cube-strip@2`

`tools/strip_contract.py` checks this shape; the bridge's answers and the fake cube's synthetic ones (`tests/support/strip.js`) both pass it.

| Field | Meaning |
|---|---|
| `schema` | Always `cube-strip@2`. A change of meaning is a new schema, never a quiet change to this one. |
| `model` | The formulas' name and version, `field-strip@2`. |
| `cutoff` | The latest time any value in the answer became known. |
| `snapshot` | The field-data-api publication the latest update pinned: `id`, `publishedAt`, `scheduledFor`. |
| `sources.<source>` | For each source the strip reads and for `calendar`: `state` as the publication gave it (`ok`, `stale`, `disabled`, `error`, …), made `stale` once an `ok` source's last check is older than the service's own rule, `max(2 · interval, interval + 300 s)`; `checkedAt`, `receivedAt`, `intervalSeconds`; `observedAt`, its newest observation the strip holds; `recordedFrom`, the first publication the strip read it from; and `detail`, the service's reason or error. |
| `components.<name>` | Each force's part: its `force`, its `label`, and `retroUntil`, the first live observation after its latest reconstructed observation, or null until that boundary exists. |
| `attentionParts.<name>` | Each part of attention: `label`, `weight`, `retroUntil`. |
| `grid.t0`, `grid.step` | The first grid time and the spacing; `t0` is `from`. Every array in `grid` has one value per grid time. |
| `grid.forces.<force>` | The sum of the force's parts known at each grid time, each the latest value known at or before it and not stale; null where none is. |
| `grid.forceInputs.<force>` | The ordered `components` and an integer `masks` array identifying the inputs contributing at each grid time (bit `j` names component `j`). Measured zero contributes; an absent or stale input does not. Available on the complete hourly history without carrying every component value. Older responses can supply equivalent coverage through `grid.parts`; without either, conditional matching remains unavailable. |
| `grid.attention` | Attention on 0–1, where 0.3 is ordinary; null where no part is known. |
| `grid.close`, `grid.next24h` | The cube's close at each grid time, and BTC's percent change to 24 hours later, null until those 24 hours have passed. |
| `grid.dvol` | DVOL at each grid time, in annualised percent. |
| `grid.parts` | Each part's value at each grid time, for answers of at most 3,000 grid times. |
| `grid.context` | Optional numeric arrays at the same grid times: `etfFlow`, `etfDate`, `etfReported`, `etfExpected`; `oiUsd`, `oiObserved`, `oiReported`, `oiExpected`; `liqLong`, `liqShort`, `liqStart`, `liqEnd`, `liqReported`, `liqExpected`. Money is USD and dates are epoch ms (ETF date retains day precision). Null is unavailable. Supplied with detailed grids of at most 3,000 points, as `grid.parts` is. |
| `events[]` | Every event any entry of whose schedule falls in `[from − 1 day, to + 90 days)`: `id`, `kind` (the calendar's category), `family` (its force), `name`, `short` (at most 8 characters), `region`, `origin`, `series` (the calendar's source id, which releases share), `link`, `window` (minutes, or null), `schedule` and `measured`. |
| `.schedule[]` | Each revision, in the order they became known: `knownAt`; `at`, its start, or null once `cancelled` or `withdrawn` (then `lastAt` is the date it last had); `precision`, `instant`, `day` or `range`; `end`, a date's or range's exclusive end; `status`; `certainty`; `importance`; and `weight`. |
| `.measured` | Once measured: `from` and `at`, its window's bounds; `move` in percent; `bits`, or null without DVOL; `ordinary`, the spread it was measured against. |
| `moves.<series>` | Each answered event's series' measured moves as `[known at, percent]`, in time order, the latest 500: given once a series, not with each of its events, so that an answer grows with the events it holds and not with their product. |
| `jumps[]` | `id`, `at`, `window`, `move` and `bits`, each known at `at + window`. |
| `options[]` | Hourly samples: `at`, `atm` (at-the-money IV by expiry bucket), `skew` and `putCall`. |

## Known-at

The page draws only what was known strictly before the **edge**: the data's cutoff, or the replay's edge, in whole ms. A value known at the edge itself is not yet drawn.

- A grid value at time `t` is the latest value known at or before `t`. Its formula uses only observations known by then: normalisations and trailing windows end at it.
- An event is known from its first schedule entry's `knownAt`, at the time its latest entry known by then gives. An entry with no time cancels it, or withdraws it where the calendar stopped listing it, from its `knownAt`. Its measured reaction is known at `measured.at`, a series' move at the time it carries, a jump at `at + window`.
- **Retrospective.** A part's values before `retroUntil` may include a native window or backfill collected later, rather than observations recorded as they became known. The boundary is conservative: a reconstructed gap after collection started extends the marked prefix until the next live observation; intervening recorded values can share that label. With no subsequent live observation, all available values retain the retrospective marker. Funding uses the latest boundary of its contributing venues, and keeps the marker while any venue has no subsequent live observation. The band draws a dashed line where the prefix ends and the cards say so. This replay does not recover a provider's superseded historical vintages.

## What the page computes

The page draws with fixed formulas over the answer, and nothing else.

- **Lean.** Forces sums the forces known at a time, skipping the unknown ones, and its card says how many of the four were known; a single force is its own value. No force known means no hue: the column carries the hatch the explorer draws for an undefined value, never a lean of zero.
- **Coverage.** The label row shows supported inputs against the expected inputs (four Macro, four Positioning, one News and one Social; only the selected force’s inputs in a single-force view), plus supported attention inputs out of four. A value of zero counts as known. No force known is a full undefined hatch with **No data**; partial input coverage is **Limited data**, with a top hatch whose height is `5 · (1 − known / expected)` px. Missing attention inputs use the same fraction in a hatch along the foot. Exact counts make sparse coverage visible without inventing a statistical confidence score. Where component arrays are absent, input coverage is explicitly unavailable and the known force count is shown instead. These counts concern available contributions, not the number of raw observations used by their formulas.
- **Field cutoff.** The field-data cutoff is retained from the answer, separately from the cube cutoff and replay edge. Force samples stop at the earliest of those cutoffs; the remaining in-view tail is hatched and the field cutoff has its own labeled marker. Coverage counts describe only visible pixels before that edge. The instrument shows the field-data timestamp and its selected time as separate values.
- **Hue and intensity.** A lean `L` takes the colour tables' positive or negative arm, which run in Lab from the midpoint grey to the role, at `min(1, |L|)^0.6`. Attention `a` lays that colour over the band's ground at an alpha of `min(1, 1.7 a)`. Where attention is not known, the colour is laid at 0.5 and a 5 px strip of the same hatch runs along the band's foot. The mapping is fixed: no scale is fitted, so Explore, Comparison lock and Auto colour do not apply.
- **Sampling.** Each pixel column shows the values held at its centre time, from the finest grid the page holds there; it is never averaged.
- **Light.** At a time `t`, an event’s contribution is `weight · exp(−(at − t) / 2 days)` during the 14 days before its time, or its weight through a date/range with no hour. The pixel follows the maximum contribution, capped at 1, rather than adding importance weights from unrelated events. For light `l ≥ 0.02`, its central beam has height `(22 − 2) · (0.2 + 0.5 l)` px and opacity `0.85 l`; weaker light is not drawn. The strip and horizon use this same rule.
- **Seams and labels.** A measured reaction or a jump known by the edge draws a 2 px line at its window's close in the ink colour, at an opacity of `0.22 + 0.78 · √(min(1, bits / 3) · min(1, |move| / 2))`; without bits, the first factor is 0.5. An event is labelled, and its reaction seamed, only from a weight of 0.3: a high-importance event, or a medium one whose date is confirmed. A timed event is labelled at its time; a date or a range at its middle, over a bracket of its span, once its first date has begun. A label that would overlap the coverage label, cutoff marker or the preceding event label is left out.
- **Order.** The band's ground, then the hue, the hatch where a value is not known, the 1 px dashed line where the shown parts' retrospective values end, the light, the seams; the labels sit in a 12 px row above the 22 px band.
- **Horizon.** The box is the profile column's width when that is at least 40 px (62 px with Rows off, 128 px with Rows on) and is not drawn where the profile tracks fold, under 600 px. Its time to go runs from the edge, not the wall clock: an event at `at` sits at `log1p((at − edge) / 1 h) / log1p(90 days / 1 h)` of the box's width, for `edge < at ≤ edge + 90 days`, a date at its start, with ticks at a day, a week and 30 days. An event leaves the box at its time, even while its reaction window is open. The box draws light only; its card lists the lit events ahead with the options' context.
- **Prices.** A card turns a percent move into a price from the last `close` known at the edge.
- **Track record.** For the forces at a time `t`, the page takes the hourly grid times `s` of the two years before the data's cutoff with `s + 24 h < min(t, edge)`, so no moment's outcome overlaps `t`'s or is unknown at the edge. A compared force must be known at `t` and have at least 30 earlier completed outcomes, six hours apart, using exactly the same contributing inputs. Eligibility uses available observations rather than requiring coverage of half of the two-year price grid. Candidate sums must have the same component masks as the current sums. It keeps the times whose forces lie within 0.5 of `t`'s (Euclidean), nearest first, each at least six hours from those kept, up to 40, and needs at least 30 for conditional figures. With fewer, it shows the actual count and the all-moments price-return distribution and quantiles; conditional shares and quantiles remain unavailable in their fixed slots. The compact track heading names the forces actually compared. With sufficient support it shows the most frequent outcome (fell, rose or flat), its share against all moments six hours apart, and the p5, p50 and p95 of both. Samples overlap; 30 is a display threshold, not a calibrated confidence guarantee. Thirty similar moments six hours apart require at least 174 hours of sampling plus the final 24-hour outcome, and may take longer when inputs or forces differ. Provider history can supply retrospective comparisons, labeled as such.
- **Quantiles.** A pth quantile of `n` sorted values is the value `(n − 1) · p` of the way along them, interpolated linearly between the two order statistics either side.
- **An event's card.** When it is (a time, or dates with no hour given), its importance, how sure its date is, and whether it moved; once measured, its move and its surprise. Once 30 of its series' releases have been measured before the edge, their p5, p50 and p95; until then, how many have been. Ahead of the edge, the options context: BTC's range to the event's time at DVOL's 30-day level, `close · exp(±1.645 · DVOL · √(Δt / one year))`, risk-neutral, for the whole stretch rather than the event's own move.

## Reads and states

- The page reads only while the Strip is on, the page is live and the strip is declared. It reads one grid at a time, in no query slot of the cube's: the view's grid first (the view and a quarter of it either side, at the finest step that keeps under two grid times a pixel and 3,000 points, so component detail remains available), then the history (hourly, the two years to the data's cutoff). A held grid is read again once it is five minutes old where it reaches the live edge, the history once it is half an hour old; a failed read after a minute, and a bridge still reading its first publication after 15 seconds. Turning the Strip off stops reading and abandons a read under way.
- The states are kept apart, in the band and in the selector's `data-state`: **off**; **unconfigured**, the page served without the strip; **loading**; **failed**, with the bridge's error; and **ready**. A ready band with no force known in view says so. Each source's freshness is in the band's own card, beside the time of the publication it was read from, and a force's card names any of its sources that is not current. The recorded page offers Off alone.

## Instrument readouts

Strip readouts use the same typed primary values, grouped label/value rows and signed measurements as Inspect. Force components, attention and coverage are quantitative fields; retrospective and source states are compact markers. Hover and the Strip surface in Inspect share the same readout. Component detail is visible rather than buried in prose.

Track-record distributions, quantiles and support counts remain quantitative displays. The explanatory paragraph below them is removed. Event reactions, windows, surprise, schedule state and options context are labeled figures rather than narrative paragraphs. Source status is labeled as current publication status; it is never presented as the source’s state at a historical hover time.

The Strip hover has one fixed frame for forces, events, sources and Ahead. Its bottom stays eight pixels above the band. Its width, height, vertical anchor and measurement slots do not change during a sweep; only its horizontal position follows the pointer. Loading, failed, sparse and missing observations occupy the same slots with explicit unavailable states. Publication and history responses refresh a stationary hover. The hover shows force arrows and the complete distribution with large figures; detailed component lists stay in Inspect, which retains its normal document flow.

The full next-24-hour comparison stays visible at short viewport heights: the share that rose or fell, similar moments and days, all-moments count and outcome share, conditional histogram with the all-moments outline, and both sets of p5/p50/p95. Hover percentiles use signed percentages to one decimal, as in the reference. The 30-sample floor and temporal eligibility rules above are unchanged; unsupported distributions reserve the same plot and value positions without estimates.

An **R** beside a force marks known contributions reconstructed retrospectively; the component-level provenance remains in Inspect. Event, source and Ahead hover context is bounded to four visible rows, with complete details in Inspect. At viewport heights of 700 px or less the same two visual parts sit side by side, retaining their type sizes, fixed slots and bottom anchor. The panel stays centered on the pointer horizontally, clamped to the chart edges, without switching sides during a sweep. Outcome shares count strictly negative, strictly positive and flat observations separately; the most common outcome is named and compared with that same outcome in all moments. A zero return never counts as a rise.


## Continuous-minute and backfill ingestion

Explicit backfill publications carry `publication_kind: backfill` through the pinned reader. New historical observations in these publications use the existing source timing rules and retrospective labels, even after live collection has started. Newly exposed native-window observations whose timing rule predates the start of collection by more than a collection interval receive the same retrospective treatment, even in a live publication. Delayed live observations within the recorded period retain their actual first-publication time. Previously stored observations remain unchanged. Retrospective provider data does not recreate original provider release vintages.

For `continuous_checkpointed` Bluesky captures, a minute enters the model only once it has full connection coverage and no overlap with an unrecoverable cursor gap. Partial minutes remain available in field-data-api and are reconsidered under later dataset versions; their interim counts cannot occupy the model's permanent first-seen slot. Bounded legacy sessions retain their existing behavior.

Ingestion replay revision 2 clears older completion markers once, so already acknowledged captures are reconstructed under these rules too. Observations and dataset acknowledgements remain intact until each source's replay commits atomically. Failed upgrades retain prior state and remain pending across restarts; completed upgrades resume metadata-only scans. The existing completion-marker schema remains compatible with the previous release.

The local live proof retained all 71 funding observations, including 70 later observations under identical retrospective timing through explicit backfill and native-window expansion, and waited for a social minute to close before admitting its complete 2,516 observed creates. No raw posts were retained. Reproduce with `python3 tools/prove_source_ingestion.py --field-data-root /path/to/field-data-api --live`; counts will vary. Evidence: [source-ingestion-proof-2026-10-24.json](source-ingestion-proof-2026-10-24.json).

## Readiness proof, 24 October 2026

The saved production grids were replayed locally through the page's actual matcher with `node tools/prove_strip_readiness.cjs saved-grids.json`. The 17,520-hour price grid contained 2,916 completed baseline moments. The former half-grid eligibility rule compared no forces. The corrected rule found 40 comparable macro moments, each with identical input coverage and a completed next-day outcome. Positioning, news and social remained excluded at that capture. This is a local proof against production input, not deployment confirmation. The result is recorded in [strip-readiness-proof-2026-10-24.json](strip-readiness-proof-2026-10-24.json).

Synthetic browser cases separately cover 20 days of usable history within the two-year grid, equal force sums with different contributing inputs, baseline-only rendering, and constant card geometry across viewport heights from 500 to 950 pixels.
