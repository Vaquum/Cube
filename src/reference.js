(() => {
  "use strict";
  // One reference structure throughout: purpose, interpretation, action. Targets identify real UI
  // or regions of the current canvas; reading never turns features on or changes a saved view.
  const topics = [
    { id: "grid", group: "Read the market", title: "Time × price grid",
      purpose: "Locate trading activity in time and price. Each cell covers one time interval and one price band.",
      read: "Time runs left to right; price increases upward. Colour describes the selected Cells measure. A blank cell can mean no activity; marked cells can mean unavailable data.",
      use: "Start with Volume, then inspect a cell to read its amount and coverage. Change the time window or resolution to move between detail and context.",
      targets: [{"label":"Show grid","region":"cells"},{"label":"Show measure control","selector":"#ol-mode"}], colour: "cells" },
    { id: "window", group: "Read the market", title: "Time window & price axis",
      purpose: "Choose the history to examine and how price follows time navigation.",
      read: "The window presets set the time span. Free axes lets you navigate independently; Refit fits price to the visible activity; Coupled zooms both axes; Diagonal follows the fitted resolution relationship.",
      use: "Choose a preset or Bounds; drag to pan and wheel to zoom. Shift-wheel over the chart changes price; the time labels still zoom time, and Coupled also changes time. Shift alone shows exact values. End returns to latest data; F fits price.",
      targets: [{"label":"Show time window","selector":"#ol-window"},{"label":"Show price-axis control","selector":"#ol-follow"}], colour: "none" },
    { id: "resolution", group: "Read the market", title: "Resolution",
      purpose: "Choose the time interval and price width aggregated into each cell.",
      read: "Larger cells sum more activity. Time and price sizes are independent. Auto chooses levels from screen size; a locked level stays chosen. A coarser fallback means the requested detail is unavailable.",
      use: "Open Resolution and use the time and price steppers or the lattice. Ready, pending and unavailable describe data availability; small, usable and large describe cell size on screen.",
      targets: [{"label":"Show resolution","selector":"#ol-res"}], colour: "resolution" },
    { id: "measures", group: "Read the market", title: "Cells: trading measures",
      purpose: "Choose what each cell measures; its tooltip and inspector report the same quantity.",
      read: "Volume is traded USDT; Trades is the count; Trade size is USDT per reported trade. Taker flow is the taker-buy share of volume; Taker trades is the taker-buy share of trades. Delta is taker-buy minus taker-sell USDT: the aggressive side, not net buying or participant intent. Cascade measures concentration within the cell's four-child parent: 0 means an even quarter, +2 means the whole parent; it does not identify liquidations. Geometry shows occupancy.",
      use: "Choose a Cells measure, then its supported basis. Amount uses observed totals; Intensity uses covered time and price. Shares centre on 50%, Delta on zero, Cascade on an even split. Colour opens the actual fitted key.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show grid","region":"cells"}], colour: "cells" },
    { id: "candles", group: "Read the market", title: "Candles",
      purpose: "Read each time interval's exact open, high, low and close instead of colouring price cells.",
      read: "The body spans open to close; the wick reaches low and high. Up candles are hollow, down candles are filled, and unchanged candles are neutral. Prices do not snap to the grid's price rows. Coverage and unfinished intervals still matter.",
      use: "Choose Candles in Cells or press K to toggle back to the previous encoding. Use Lens for finer candles, and hover, Inspect or the Cells table for exact prices. Candles requires the live cube; recorded data reports unavailability.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show price chart","region":"cells"}], colour: "candles" },
    { id: "movement", group: "Read the market", title: "Cells: movement measures",
      purpose: "See where price travelled or stayed, including cells with movement and no trades.",
      read: "Path measures distance travelled in cell row spans; the record also gives USDT moved and spans per minute. Dwell is the cell's share of its column's covered time. Movement-only cells have an inset stroke; insufficient screen space is counted as detail unresolved.",
      use: "On the live cube, choose Path or Dwell in Cells. Inspect for exact movement and coverage. These measures are unavailable in the recorded snapshot.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"}], colour: "cells" },
    { id: "scales", group: "Read the market", title: "Colour scales & comparison",
      purpose: "Establish what a shade means before comparing cells or rows.",
      read: "Value preserves amounts on a linear or log1p scale; Relative rank approximates position in fitted observations. Explore holds a fit per context; Auto color refits after settled changes. Fit calibrates once. Comparison lock holds colour and axes across compatible contexts; Local contrast belongs to the lens. Later replay cutoffs can invalidate a fit.",
      use: "Expand Cell colour scale or Rows colour scale below for ticks, fitted data and controls. Fit recalibrates once. Use Comparison lock when comparing across resolutions or periods; check out-of-range and low-discrimination notices. Local contrast applies only to the lens.",
      targets: [{"label":"Show cells","region":"cells"},{"label":"Show row strip","region":"rows"}], colour: "cells" },
    { id: "rows", group: "Read the market", title: "Rows & reference period",
      purpose: "Place the view or selection against a longer history at each price level.",
      read: "Rows has its own period. Its narrow strip shows full-strength values; its faint backdrop extends behind the grid. Volume and Delta are period totals; Time at price is period dwell. Row volume versus mean traded row compares a row's period volume with the mean of all traded rows in that period: 0 is average, +1 is double, −1 is half. Untraded rows have no concentration band. The strip retains the period’s native row width; the drawn profile may use coarser bins. Profile-share log₂ ratio separately compares overlapping clipped bins on common support; Shared row share uses wholly-in-view bins. Each profile has its own amount axis unless a supported shared axis is selected.",
      use: "Turn Rows on, choose a measure and set its period. All history is the available reference history. Fixed periods ignore navigation and selections; Visible range follows the chart's time window. A selection changes Profile-share log₂ ratio, while Rows values retain their period basis.",
      targets: [{"label":"Show Rows control","selector":"#ol-rows"},{"label":"Show row strip","region":"rows"}], colour: "rows" },
    { id: "profiles", group: "Read the market", title: "Profile tracks",
      purpose: "Compare how activity is distributed across price levels.",
      read: "The current track is view or selection volume, with taker-buy volume inset; the reference track uses the Rows measure and period. Independent axes scales each separately. Shared absolute makes equal lengths equal amounts. Shared row share makes each row a percentage of its own track's total over the common price window: 20% versus 10% is twice the concentration.",
      use: "Use Profiles or expand Profile comparison below. Shared absolute needs Volume on both tracks; row share needs nonnegative distributions. Read Window W, both totals and domains. Narrow charts fold the tracks; Show the tracks reveals them.",
      targets: [{"label":"Show profile tracks","region":"profiles"}], colour: "profiles" },
    { id: "columns", group: "Read the market", title: "Columns & indicators",
      purpose: "Read time-based summaries below the price grid.",
      read: "Columns has its own measure and axis. Same as cells selects a companion: totals for additive measures, net taker volume/count for shares, Choppiness for Path, Volume per path for Dwell, Volume for Geometry/Candles. RSI and MACD use native closes. The model compares touched-row volume against its parent and fitted expectation; timing and fitted levels qualify it.",
      use: "Choose Columns independently of Cells; use Axes for its domain and provenance. Inspect reads the canonical value and companions. Read the series key for indicators and the model's timing before interpreting its ratio.",
      targets: [{"label":"Show Columns menu","selector":"#ol-pane"},{"label":"Show column pane","region":"columns"}], colour: "columns" },
    { id: "states", group: "Read the market", title: "Data states & coverage",
      purpose: "Distinguish a measured value from zero, incomplete coverage or unavailable data.",
      read: "The footer keys identify pending, failed, unsupported, undefined and out-of-range marks. Open columns are unfinished; provisional minutes may be replaced by archived data. Edge portions have their own amounts and exposure. Short exposure means less than 10% of nominal time or price coverage.",
      use: "Read the footer and inspect marked cells for their reason. Use the data-through and canonical-through times to judge freshness. Wait for pending data; use the displayed error and retry action when a read fails.",
      targets: [{"label":"Show state key","selector":".ol-status"},{"label":"Show data status","selector":"#ol-state-pill"}], colour: "states" },
    { id: "coordinates", group: "Read the market", title: "Grid precision",
      purpose: "Reconcile exact bounds with the cube's cells.",
      read: "The base cell is 56.25 seconds × 125 USDT, aligned to 1 Jan 2021 00:00 UTC and price zero. Level n multiplies time by 2ⁿ; m multiplies price by 2ᵐ. Bounds include the lower edge and exclude the upper; requested bounds align to base cells. Midpoints snap upward; a latest-data rectangle closes its open base interval. Live cropped amounts use measured support; a recorded untiled rectangle counts whole snapshot cells inside it.",
      use: "Use Bounds for UTC times and prices. Read requested and measured bounds in Query; a coarser answer does not change the requested rectangle.",
      targets: [{"label":"Show Bounds","selector":"#ol-bounds-settings"},{"label":"Show Query","selector":"#ol-tab-query"},{"label":"Show resolution","selector":"#ol-res"}], colour: "cells" },
    { id: "exposure", group: "Read the market", title: "Amounts & exposure",
      purpose: "Compare quantities on the same measured support.",
      read: "Amount is an observed total. Intensity divides by covered minutes and price width, reported per 125 USDT; trades use the same exposure. Shares and means use their own denominators. Path spans divide by row width; spans per minute also divide by covered time. Less than 10% nominal time or width is short exposure for a normalized measure.",
      use: "Inspect nominal and observed bounds before comparing. A small rate denominator can amplify a value; it does not increase evidence.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show Inspect","selector":"#ol-inspect-tool"}], colour: "cells" },
    { id: "transforms", group: "Read the market", title: "Value & relative rank",
      purpose: "Choose what differences in shade preserve.",
      read: "Linear Value scales to U. Log Value uses log(1 + |x|/k) / log(1 + U/k), retaining sign; k sets curvature. Relative rank approximates position among fitted observations using quantile knots; it is not an exact ordering. Shares and concentration ratios have their own fixed midpoint. Invalid or uncovered observations are excluded and counted.",
      use: "Read the ticks, U, k, support and clipping in the colour scale. A rank shade compares positions, not equal differences in amount.",
      targets: [{"label":"Show colour key","selector":"#ol-cell-key"},{"label":"Show cells","region":"cells"}], colour: "cells" },
    { id: "row-comparisons", group: "Read the market", title: "Row comparison denominators",
      purpose: "Keep the three row comparisons distinct.",
      read: "Row concentration is log₂(row period volume / mean traded-row volume): twice the mean is +1. Profile-share is log₂(current share / reference share) over overlapping clipped bins. Shared row share reports each track's percentage over wholly-in-view common bins. For Profile-share, zero current against positive reference is −∞; a positive current against zero reference has no reference; empty-both is separate. Shared axes coarsen by exact summation, never split a coarse row; zero totals are undefined. Signed Delta cannot use a shared share axis.",
      use: "Read Window W and both totals in Profiles. Concentration: 100 against a mean of 50 is +1. Profile-share: 20% against 10% is +1. Shared row share: 20/100 against 40/400 draws 20% against 10%. Selection changes the current distribution; period concentration stays fixed.",
      targets: [{"label":"Show Rows","selector":"#ol-rows"},{"label":"Show Profiles","selector":"#ol-profile-settings"},{"label":"Show profile tracks","region":"profiles"}], colour: "rows" },
    { id: "poc-value", group: "Read the market", title: "POC & value area",
      purpose: "Read the profile's reported price landmarks.",
      read: "POC is the centre of its highest-volume row; equal maxima choose the lower row. Buy POC uses taker-buy volume and is unavailable without it. Value area starts at POC and grows contiguously toward the larger neighbouring volume, lower on a tie, until whole rows hold at least 70%. Row width and measured period affect each landmark.",
      use: "Distinguish Column POCs, the current profile and period references. Turn on 70% area or choose period landmarks in Lines; inspect their support.",
      targets: [{"label":"Show POC overlay","selector":"#ol-poc"},{"label":"Show 70% area","selector":"#ol-area"},{"label":"Show Lines","selector":"#ol-lines"}], colour: "references" },
    { id: "cascade", group: "Read the market", title: "Cascade & its parent",
      purpose: "Read concentration without treating it as a liquidation detector.",
      read: "Cascade is log₂(4 × child volume / parent volume). The parent has twice the time span and price width: four children. An even quarter is 0; all of the parent is +2. It uses whole-cell totals when the view crops a cell. Its column companion uses a two-child time parent. Zero, missing or unfinished parents have separate states; the coarsest levels have no parent.",
      use: "Inspect the child and parent support. Use the state key for −∞, no reference and open-parent marks.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show cells","region":"cells"},{"label":"Show state key","selector":"#ol-key-guide"}], colour: "cells" },
    { id: "motion-support", group: "Read the market", title: "Path & dwell support",
      purpose: "Account for movement independently of reported trades.",
      read: "Path attributes travel to the later trade's interval and to the crossed rows, retaining USDT travel and row spans. Dwell attributes covered time at price; its share uses covered column time and is not renormalized over the visible rows. Movement can exist without trades. For a 250-USDT move across two 125-USDT rows, path contributions sum to two spans. Dwell sums to covered seconds; unobserved native time is not filled. Open intervals, missing reads and marks too small to resolve are distinct states.",
      use: "Inspect raw travel, dwell seconds and coverage. Use Lens for unresolved detail; the recorded snapshot does not supply movement.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show Lens","selector":"#ol-lens"},{"label":"Show Cells table","selector":"#ol-tab-cells"}], colour: "cells" },
    { id: "session-levels", group: "Read the market", title: "Session levels",
      purpose: "Locate UTC session boundaries and prior-session prices.",
      read: "Day, week and month opens use the first supported bar of the period. Prior-day high, low and close are final only after that UTC day ends; the current period remains so far. Weeks start Monday. Location uses the latest completed loaded 8-hour close, with its timestamp and prior completed-day ATR.",
      use: "Choose Session in Lines. Inspect the exact period, coverage and known-at; absence of an opening input is unavailable.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "references" },
    { id: "structure-rules", group: "Read the market", title: "Structure & swings",
      purpose: "Distinguish a price extreme from its later confirmation.",
      read: "Daily and 4h swings follow an ATR zigzag: reversal must exceed 3 × the preceding bar's Wilder ATR(14). The extreme's time and the confirming bar's end differ. A forming reversal is a candidate. Consecutive same-frame highs or lows within 125 USDT are equal. The prior cycle high precedes the last deep low below half the prior peak before the all-time high. ATH is the highest recorded trade.",
      use: "Inspect occurrence, confirmation and traded-through state. Replay reveals a swing only when the confirming inputs are available.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "references" },
    { id: "retracements", group: "Read the market", title: "Retracements",
      purpose: "Read fractions of a declared price impulse.",
      read: "Levels use later − f × (later − earlier): 38.2%, 50% and 61.8%. Classic adds 0%, 23.6%, 78.6% and 100%; Extensions adds 127.2% and 161.8% past the earlier extreme. Sources are rolling 30/90 sessions, since a chosen UTC day, or the latest daily/4h swing pair. Same-8h-bar extremes use its close/open direction to order them.",
      use: "Enable a source before its optional levels; up to twelve dates can be retained. Inspect the anchors, direction, known-at and unclamped depth.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "references" },
    { id: "average-rules", group: "Read the market", title: "Moving averages & bands",
      purpose: "Read close-based summaries on their native bars.",
      read: "SMA is the mean of its window; EMA uses 2/(period + 1), seeded with the first window's mean. Bollinger is SMA(20) ± 2 population standard deviations. The weekly support band is SMA(20)/EMA(21), a construction rather than a regime claim. Intraday pairs use their named bars; the 3.75m feed is the labelled 3m proxy. Warm-up and unsupported bars produce gaps.",
      use: "Choose Moving averages in Lines. Inspect the timeframe, first usable window and so-far status; a line's colour does not identify its timeframe.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "averages" },
    { id: "vwap-rules", group: "Read the market", title: "VWAP & dispersion",
      purpose: "Read a quote-weighted price approximation on declared support.",
      read: "VWAP is quote volume / BTC volume. Session, visible-range and since-a-day sources use existing profile bins; dispersion uses quote volume at bin centres and is labelled approximate. Swing anchoring starts at the extreme's 8h bar and can include earlier trades within that bar. The recorded source does not supply dispersion.",
      use: "Choose VWAP in Lines and inspect anchor, bin width, measured-through and approximation. A chosen date is UTC; an unsupported input stays unavailable.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "vwap" },
    { id: "clock-rules", group: "Read the market", title: "Clock & calendar assumptions",
      purpose: "Separate scheduled landmarks from measured events.",
      read: "UTC boundaries are calendar marks. Funding assumes 00:00/08:00/16:00 UTC, not measured rates. US opens are weekdays 09:30 New York without a holiday model; expiry markers are Fridays 08:00 UTC, naming the last monthly and quarterly Friday. The Binance spot weekend proxy uses Friday 16:00 and Sunday 17:00 Chicago spots, with signed change relative to Friday. That historical convention is not a current CME closure model after 29 May 2026; stale spots are unavailable. Fill is the first hourly range reaching Friday spot, confirmed only at that bar's completed end.",
      use: "Choose Clock in Lines. Inspect the nearest event, ties earlier, and its elapsed/until time, actual source and confirmation.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "clock" },
    { id: "untested-rules", group: "Read the market", title: "Untested levels & event lanes",
      purpose: "Read each revisit or compression rule on its own horizon.",
      read: "Untested in view uses the loaded columns' row-width revisit rule. Daily/weekly untested POCs scan 30 completed days/26 weeks: later 8h ranges meeting POC ±125 USDT count as a test; only levels within five daily ATRs show. A 4h squeeze is Bollinger width below its trailing 500-bar tenth percentile; daily compression uses its separate 182-day minimum.",
      use: "Inspect an individual event through References, including merged lanes. No revisit is a historical observation, not a claim that price must return.",
      targets: [{"label":"Show Untested in view","selector":"#ol-untested"},{"label":"Show Lines","selector":"#ol-lines"},{"label":"Show event lanes","region":"events"}], colour: "references" },
    { id: "indicator-rules", group: "Read the market", title: "RSI & MACD series",
      purpose: "Keep native indicator bars distinct from cube columns.",
      read: "RSI uses Wilder(14) on completed daily or 4h closes, with 30/70 guides. Divergence states price higher/RSI lower or the reverse and requires confirmed swings. Daily MACD is EMA(12) − EMA(26); its signal is EMA(9), histogram MACD − signal. Cross triangles point above/below the signal. Warm-up gaps and forming values remain labelled.",
      use: "Use Columns and read its series key. Inspect native close time, slopes and confirmation; repeated cube columns do not create new indicator bars.",
      targets: [{"label":"Show Columns","selector":"#ol-pane"},{"label":"Show indicator pane","region":"columns"}], colour: "indicators" },
    { id: "state-glossary", group: "Read the market", title: "Non-values & recovery",
      purpose: "Keep an unknown value distinct from a measured zero.",
      read: "Reading/Pending awaits data; Preparing awaits calculation. Not measured requires its explicit workflow. Failed names a read error; Unsupported lacks the capability; Unavailable lacks eligible support. Undefined is not a finite ratio. −∞ is a zero numerator against positive support; no reference and empty-both have separate denominator states. Open parents can withhold derived values. Out-of-range and precision marks qualify a value rather than replace it.",
      use: "Inspect the stated reason. Retry a failed read, enable the required input, or use Lens for unresolved detail; do not replace a gap with zero.",
      targets: [{"label":"Show state key","selector":"#ol-key-guide"},{"label":"Show data status","selector":"#ol-state-pill"},{"label":"Show Inspect","selector":"#ol-inspect-tool"}], colour: "states" },
    { id: "selection", group: "Work with the view", title: "Select a region",
      purpose: "Measure a time-and-price rectangle within the chart.",
      read: "The right context pane and current volume profile describe the selection while it exists. Partial edge cells contribute their observed portion. Rows keeps its independent reference period.",
      use: "Choose Select and drag a rectangle. Inspect cells for detail; use Clear or Escape to return the summaries to the whole view. Selection alone does not anchor an evidence query.",
      targets: [{"label":"Show Select tool","selector":"#ol-select"},{"label":"Show selection","region":"selection"}], colour: "selection" },
    { id: "inspect", group: "Work with the view", title: "Inspect & context",
      purpose: "Read exact records for cells, rows, columns, references and lens cells.",
      read: "The inspector reports the selected record's measurements and coverage. The context pane summarizes the view or selection. The inspection cursor remains at its time and price through navigation.",
      use: "Choose Inspect or E, then a surface and feature. Arrows/steppers move the cursor; search finds references. Open details or Enter opens the record; Escape closes detail, then Inspect. Home brings an outside cursor back.",
      targets: [{"label":"Show Inspect tool","selector":"#ol-inspect-tool"},{"label":"Show inspector","selector":"#ol-inspect"}], colour: "histories" },
    { id: "lens", group: "Work with the view", title: "Lens & pin",
      purpose: "Examine finer cells inside a region while keeping the wider context visible.",
      read: "The lens uses the active cell colour scale unless Local contrast is enabled. Finer data is read separately; it becomes the main view only when pinned.",
      use: "Choose Lens, or hold Alt for a temporary peek. Shift+L changes depth from one to four finer levels. Enter or Pin adopts the lens rectangle and resolution; check any resulting scale-change notice.",
      targets: [{"label":"Show Lens tool","selector":"#ol-lens"}], colour: "cells" },
    { id: "references", group: "Work with the view", title: "Reference lines & events",
      purpose: "Locate profile, session, structural, average, VWAP and calendar landmarks.",
      read: "POC is the highest-volume row; Buy POC uses taker buys; a value area reaches at least 70% of volume in whole rows. These depend on the measured period and row width. Session and structure marks locate ranges, equal highs/lows, gaps, swings and retracements. Averages and VWAP trace price summaries. Clock schedules are vertical marks; squeezes and the spot weekend proxy occupy event lanes. A reference locates a hypothesis; it does not establish support, resistance or future direction.",
      use: "Open Lines to choose families, periods and dates. Focus through Lines or an Inspect reference detail; Show all restores the normal visibility budget. References reads enabled and held-back items. X places or clears a horizontal level.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show event lanes","region":"events"}], colour: "references" },
    { id: "drawings", group: "Work with the view", title: "Trend drawings",
      purpose: "Add and retain your own geometric price references.",
      read: "A drawing is your annotation. Its two anchors are UTC time and USDT price, so it remains tied to the market coordinates when the view changes.",
      use: "Choose the trend tool and place two anchors. Select a drawing to edit its coordinates, name, colour and label, or use its available lock, copy and delete actions. Undo restores drawing changes.",
      targets: [{"label":"Show drawing tool","selector":"#ol-trend"}], colour: "drawings" },
    { id: "reference-visibility", group: "Work with the view", title: "Reference visibility",
      purpose: "Understand why an enabled reference may not be drawn.",
      read: "Colour names the family; stroke pattern and the record distinguish confirmed, candidate, forming and retrospective marks. Timeframe is in the name. Off-screen references and label budgets can hold marks back. Focus temporarily brings one reference or family forward; Show all restores the normal budget. Eligibility and known-at remain separate from visibility.",
      use: "Use Lines focus actions or open an Inspect reference detail. The reference chooser includes held-back items; search by name and read its status.",
      targets: [{"label":"Show Lines","selector":"#ol-lines"},{"label":"Show Inspect","selector":"#ol-inspect-tool"}], colour: "references" },
    { id: "history-reading", group: "Work with the view", title: "Inspector histories",
      purpose: "Read historical companions on their declared support.",
      read: "The compact record keeps its selected value and three companions; twelve intervals use a fixed price band. Each miniature has its own vertical scale, so equal heights do not mean equal amounts. Gaps mean unavailable support, not zero. Price response is all-price close − open and pairs with activity only on equal time support; each interval uses its own prior completed-day ATR. Seasonal history has 32-bit input precision.",
      use: "Open details for units, supports and exact values. Search References, use its steppers, and capture a cell only after its desired histories are available.",
      targets: [{"label":"Show Inspect","selector":"#ol-inspect-tool"},{"label":"Show details","selector":"#ol-inspect-open-detail"}], colour: "histories" },
    { id: "lens-rules", group: "Work with the view", title: "Lens support & pinning",
      purpose: "Keep finer inspection separate from adopting a new view.",
      read: "Depth lowers time and price levels by up to one to four steps, stopping at base levels. Finer support is read separately and may be pending or unavailable. Inspect can hold the lens frame. Local contrast has its own colour fit; otherwise the main mapping applies. Pin adopts the rectangle and resolution and can trigger a disclosed scale change.",
      use: "At n=4, m=2, depth 1 reads n=3, m=1; depth 4 stops price at m=0. Use Alt for a peek, Inspect to hold, then Pin or Enter to adopt bounds/levels and record navigation. Read coverage and any calibration change.",
      targets: [{"label":"Show Lens","selector":"#ol-lens"},{"label":"Show Lens controls","selector":"#ol-lensbar"}], colour: "cells" },
    { id: "drawing-rules", group: "Work with the view", title: "Drawing operations & recovery",
      purpose: "Retain an annotation without confusing it with data.",
      read: "G places A then B by clicks or a drag. Move the line or an endpoint; coordinates stay UTC/USDT and authored A→B order is retained. Name identifies it; Label is the caption, with a custom Name used when Label is blank. Colour is your RGB choice; the caption shares it at the first usable anchor. Lock prevents movement; per-line and collection visibility are separate from deletion. Undo/Redo covers the drawing collection, not navigation.",
      use: "Use Edit or the context menu for coordinates/Delete; More for Undo/Redo, copies and recovery. Reload keeps the tab snapshot; recovery revisions can expire on later saves. Recover by timestamp/workspace/name; complete codes keep drawings permanently. Replay annotations may reflect later knowledge; authorship time is unrecorded.",
      targets: [{"label":"Show drawing tool","selector":"#ol-trend"},{"label":"Show Lines","selector":"#ol-lines"}], colour: "drawings" },
    { id: "mobile", group: "Work with the view", title: "Phone controls & highlights",
      purpose: "Reach the same view and records on a narrow screen.",
      read: "Controls contains the chart menus. The reference remains a left pane beside a horizontally scrollable workspace; the inspector and drawer have their own position. Show reveals a hidden control sheet or scrolls to an existing target. It does not enable a measure, create a selection or start discovery. Back to reference returns to the article.",
      use: "Use Close reference for the full chart, or Show then Back to reference. Inspect has Open details; table, profile and collection actions use labelled buttons.",
      targets: [{"label":"Show Controls","selector":"#ol-sheet-toggle"},{"label":"Show chart","selector":"#ol-canvas"}], colour: "none" },
    { id: "evidence", group: "Evaluate & retain", title: "Continuations & matching cases",
      purpose: "Compare historical outcomes after market states resembling an anchored column.",
      read: "Continuations separates matching cases from all seasonally eligible cases and shows their outcome rates and differences. Outcomes measure POC movement, not trade returns. Horizon determines how far ahead outcomes are read; barrier settings apply to POC-barrier outcomes. Historical rates and pointwise intervals do not calibrate forecast odds or establish a trading edge after costs.",
      use: "Open Continuations or press C, then click a completed column with Pan to anchor it. Choose outcome and horizon, read the matching-case count and explanation, and open Cases to inspect examples. A selected rectangle and a continuation anchor serve different purposes.",
      targets: [{"label":"Show Continuations tab","selector":"#ol-evidence-tab"},{"label":"Show Cases panel","selector":"#ol-tab-cases"}], colour: "evidence" },
    { id: "rallies", group: "Evaluate & retain", title: "Rallies: observed upward moves",
      purpose: "Discover upward price moves in native trades using an explicit operational definition.",
      read: "First passage ends at the target; Controlled advance also limits pullback; Swing confirms after a reversal from a qualifying high. Thresholds use basis points or frozen ATR14-SMA on native UTC 15-minute bars. Confirmation describes an observed event, not future gains. Binance spot data cannot establish short covering or derivatives leadership.",
      use: "Open Rallies, choose the definition and UTC analysis window, then Discover on the live cube. Select a confirmed event for member-only totals and profile. Grid, replay and time-to-target filters reuse the discovery; Refresh discovery applies changed definition or window settings. Cell outlines can include other trades alongside members.",
      targets: [{"label":"Show Rallies panel","selector":"#ol-tab-rallies"}], colour: "rallies" },
    { id: "replay", group: "Evaluate & retain", title: "Replay & model timing",
      purpose: "Explore history with an explicit effective data cutoff.",
      read: "The replay edge limits measurements and reference periods. Scales fitted after that cutoff are invalidated, unless a deliberate comparison lock is disclosed as an external override. Replay uses currently available history; original data vintages are not guaranteed. Volume per touched row versus expected model timing has its own disclosure.",
      use: "Open Replay and enter an edge, select a column, or step/play. The effective Cells edge aligns to a completed grid column; Candles retains the exact exclusive timestamp. Read source/model timing; exit Replay to restore its workspace and scales.",
      targets: [{"label":"Show Replay control","selector":"#ol-replay"}], colour: "states" },
    { id: "tables", group: "Evaluate & retain", title: "Rallies, Cells, Cases & Query drawer",
      purpose: "Inspect the underlying records and the exact configuration behind the chart.",
      read: "Rallies lists confirmed native events; Cells lists measured cells; Cases lists continuation examples; Query summarizes bounds, measures, scales, axes and provenance. Sorting changes table order, not the measurements.",
      use: "Choose a bottom-panel icon; choose again to close. T toggles the current panel. Cells arrows/Enter inspect records; Export CSV retains the full filtered result. Query provides bounds, codes and provenance.",
      targets: [{"label":"Show panel toggles","selector":".ol-drawer-bar"}], colour: "none" },
    { id: "compare", group: "Evaluate & retain", title: "Compare captured cells",
      purpose: "Keep cell records together for direct comparison.",
      read: "A capture retains its measurement, bounds, coverage, source and original scale. The Compare workspace lets you read captures together; their context and completeness remain part of the comparison.",
      use: "Capture through a cell's context menu, Inspect details or Cells. Use Compare for Cards/Matrix, metrics and references. Export collection keeps its frozen records; Import restores them. Undo restores the last collection change.",
      targets: [{"label":"Show Compare panel","selector":"#ol-tab-compare"}], colour: "compare" },
    { id: "views", group: "Evaluate & retain", title: "History, saved views & sharing",
      purpose: "Return to a configuration or share how the chart was interpreted.",
      read: "History records this tab's navigation; saved views retain chosen settings. Links and portable view codes include active colour scales and frozen axes. A settings-only URL does not preserve exact calibration; a scale descriptor does not freeze the underlying market data.",
      use: "Open Views for names and links; open Query to copy a portable view code. Back/Forward use tab history. Keep a code when a URL cannot carry exact scales. Reset confirms before clearing drawings or captures; their undo routes are separate.",
      targets: [{"label":"Show Views","selector":"#ol-hist"},{"label":"Show reset control","selector":"#ol-reset-canvas"}], colour: "none" },
    { id: "matching", group: "Evaluate & retain", title: "Matching states & eligibility",
      purpose: "Identify the population behind a continuation estimate.",
      read: "The state combines contiguous prior-POC direction, taker-buy share tertile and seasonal volume tertile. Thresholds fit before the anchor. Seasonal activity compares all-price volume with six prior weekly offsets and needs four exactly covered matches. All seasonally eligible states is the baseline; matching states is the conditioned subset. Forward windows can overlap, so case count is not independent sample size.",
      use: "Anchor a completed column. Read its raw state, fit anchor and eligible/matching counts before examining rates.",
      targets: [{"label":"Show Continuations","selector":"#ol-evidence-tab"},{"label":"Show Cases","selector":"#ol-tab-cases"}], colour: "evidence" },
    { id: "outcomes", group: "Evaluate & retain", title: "POC outcomes & barriers",
      purpose: "Know when an outcome becomes observable.",
      read: "Next POC compares POC after 1, 2, 4 or 8 columns; unchanged means the same row. Barrier outcomes use the first qualifying column-end POC crossing, not a native-trade touch. Upper/lower settings are in row units; excursions are minimum and maximum relative POC movement. Each interval's ATR context comes from its prior completed UTC day.",
      use: "Choose outcome and horizon in Continuations. Inspect Cases for starting/final POC, first crossing and support; an unfinished future is withheld.",
      targets: [{"label":"Show Continuations","selector":"#ol-evidence-tab"},{"label":"Show Cases","selector":"#ol-tab-cases"}], colour: "evidence" },
    { id: "intervals", group: "Evaluate & retain", title: "Distributions & estimation intervals",
      purpose: "Distinguish observed outcomes from uncertainty in a rate.",
      read: "The central 50%/80% boxes describe historical POC outcomes. Pointwise 95% intervals describe rate estimates from 2,000 block-bootstrap resamples. A rate needs 30 eligible cases; intervals also need 20 matched full blocks and 1,800 valid resamples. Missing support or degenerate draws can withhold an interval while valid descriptive results remain.",
      use: "Read the method and the displayed withholding reason. Neither the boxes nor rate intervals are calibrated forecast odds or an after-cost trading edge.",
      targets: [{"label":"Show Continuations","selector":"#ol-evidence-tab"},{"label":"Show continuation marks","region":"cells"}], colour: "evidence" },
    { id: "case-records", group: "Evaluate & retain", title: "Cases & exclusions",
      purpose: "Trace membership rather than reading only a rate.",
      read: "Cases distinguishes matching states from all seasonally eligible states, completed directions and non-modal outcomes. The eligibility ledger retains excluded or unfinished candidates and their reasons. Raw buy share, seasonal ratio, state buckets and fit time explain matching; POC excursions use column ends. Pagination counts the filtered population.",
      use: "Choose a population/filter, sort, then open a case to replay its state. Export the full filtered table; missing outcomes are not failures of a trading strategy.",
      targets: [{"label":"Show Cases","selector":"#ol-tab-cases"},{"label":"Show Continuations","selector":"#ol-evidence-tab"}], colour: "evidence" },
    { id: "rally-rules", group: "Evaluate & retain", title: "Rally boundaries & membership",
      purpose: "Keep event discovery, filtering and members separate.",
      read: "First passage starts at epoch-aligned cadence anchors and ends at the first target trade. A bps threshold is frozen reference price × bps/10,000; ATR thresholds multiply frozen ATR. Controlled advance also caps pullback. Swing establishes its trough by an initial reversal, qualifies the rise, then confirms on reversal from the high; the confirming trade is outside membership. Anchored modes require completion strictly before 240 minutes. The 48h budget includes 3h45 ATR warm-up; Use visible time chooses at most 24h. ATR14-SMA is frozen at anchor/trough, distinct from chart Wilder ATR.",
      use: "Unfinished lacks confirmation at the ceiling; left-censored starts before supported analysis; unknown context lacks its threshold inputs. Events can overlap: each retains its identity, member totals count only its native members, and outlined cells can also contain unrelated trades. Replay requires confirmation strictly before its edge. Source revisions invalidate discovery; Refresh scans again. Stop waiting aborts the client wait, not service computation.",
      targets: [{"label":"Show Rallies","selector":"#ol-tab-rallies"},{"label":"Show rally outlines","region":"cells"}], colour: "rallies" },
    { id: "replay-objects", group: "Evaluate & retain", title: "Replay & retained objects",
      purpose: "Read each object's time eligibility honestly.",
      read: "Replay filters measurements and references by support and known-at, using current history rather than guaranteed original vintages. Captured metrics also need support-end and known-through before the edge; their values stay frozen. Rallies are filtered by confirmation. Drawings remain authored annotations. A held comparison mapping can be an explicit later-fit override.",
      use: "Enter an exact UTC edge or select a column, then check the effective edge: Cells aligns to grid columns, Candles preserves exact time. Exit Replay restores its saved workspace; collection export is independent.",
      targets: [{"label":"Show Replay","selector":"#ol-replay"},{"label":"Show Query","selector":"#ol-tab-query"},{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "states" },
    { id: "comparison-math", group: "Evaluate & retain", title: "Comparison basis & references",
      purpose: "Compare collected cells using eligible observations.",
      read: "Auto uses Amount for equal observed time × price exposure and Intensity when exposures differ. Means/shares keep their own units. The reference is the eligible set median or a pinned cell. Magnitude ranks use collected comparable cells, ties sharing rank; POC distance ranks nearest first and requires an eligible POC at the edge. Share differences are percentage points; 60% − 50% is +10 pp. Ranks are competition ranks: two tied firsts are followed by third. Zero or missing references can withhold relative differences.",
      use: "Choose metric, basis, reference and POC in Compare. Read units, geometry and eligible counts; colour/length in the dashboard is its comparison scale, not the original chart shade.",
      targets: [{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "compare" },
    { id: "capture-content", group: "Evaluate & retain", title: "Frozen capture content",
      purpose: "Know what a capture preserves and what it lacks.",
      read: "A capture freezes source, nominal/observed bounds, measured-through, scale and available compact histories. It does not fetch missing context or update with live data. The selected compact history and companions are retained; other metrics can say History not captured. Legacy structural context and a captured chart frame differ. POC timing and each history slot have their own replay eligibility.",
      use: "Open cell details before capture when you need its histories. Use Update capture deliberately; export/import the collection to keep it beyond this tab.",
      targets: [{"label":"Show Inspect","selector":"#ol-inspect-tool"},{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "compare" },
    { id: "retention", group: "Evaluate & retain", title: "What survives & what travels",
      purpose: "Choose the right retention route for each object.",
      matrix: {headers:["Retains","Link","Code","Named","History","Reload"],rows:[["Bounds / measures / levels / references","Yes","Yes","Yes","Yes","Yes"],["Active colour / axes","Size limit","Yes","Yes","Yes","Yes"],["Drawings","No","Current v3","Yes","No","This tab"],["Captured cells","No","No","No","No","This tab"],["Rally discovery","No","No","No","No","No"],["Market snapshot","No","No","No","No","Current source"]]},
      read: "The address keeps this tab's view; browser preferences keep panel layout and the last view. History is tab navigation; named views are browser-local settings. Links carry settings and, within the size limit, calibration; a settings-only fallback loses exact scales. Current portable codes retain active scales, axes and drawings; links omit drawings. Named views retain settings and drawings; older codes can omit them. Comparison records stay in this tab and use their own JSON export. Drawing recovery is browser-local, bounded and may expire; the tab snapshot restores on reload. Rallies are memory-only discoveries and are lost on reload. Comparison reloads in this tab; duplicated tabs then diverge.",
      use: "Use Views for names/links and Query for codes. Export drawings or comparison collections before clearing. Undo restores the last collection change; a scale descriptor never freezes market data.",
      targets: [{"label":"Show Views","selector":"#ol-hist"},{"label":"Show Query","selector":"#ol-tab-query"},{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "none" },
  ];

  function create({ root, region, beforeOpen, beforeChange, closeTransient, openKeys, hasTransient, reveal, colourKey }) {
    const el = id => root.querySelector(`#ol-reference-${id}`), pane = root.querySelector("#ol-reference"), main = root.querySelector("#ol-main"), select = el("topic");
    let current = topics[0], active = null, scheduled = 0, lastShape = "", returnFocus = null;
    const node = (tag, text, cls) => {
      const value = document.createElement(tag);
      if (text) value.textContent = text;
      if (cls) value.className = cls;
      return value;
    };
    let group;
    for (const topic of topics) {
      if (!group || group.label !== topic.group) { group = document.createElement("optgroup"); group.label = topic.group; select.append(group); }
      const option = node("option", topic.title); option.value = topic.id; group.append(option);
    }
    const ns = "http://www.w3.org/2000/svg", overlay = document.createElementNS(ns, "svg"), shade = document.createElementNS(ns, "path"), frame = document.createElementNS(ns, "rect");
    overlay.id = "ol-reference-spotlight";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
    shade.setAttribute("fill-rule", "evenodd");
    shade.setAttribute("class", "ol-reference-shade");
    frame.setAttribute("class", "ol-reference-frame"); frame.setAttribute("rx", "5");
    overlay.append(shade, frame); root.append(overlay);
    shade.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); clearSpotlight(); });
    const back = el("back"); root.append(back);
    const matches = () => { const query = el("search").value.trim().toLowerCase(); return topics.filter(topic => !query || [topic.title,topic.purpose,topic.read,topic.use].join(" ").toLowerCase().includes(query)); };

    function bounds(target) {
      if (target.region) return region(target.region);
      const element = root.querySelector(target.selector);
      if (!element || element.closest("[hidden], [inert]") || !element.getClientRects().length) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, overReference: element.closest("#ol-controls") && root.dataset.sheet === "open" } : null;
    }
    function refresh() {
      if (pane.hidden) return;
      if (innerWidth > 760) delete main.dataset.referenceReveal;
      const list = matches(), at = list.indexOf(current);
      el("prev").disabled = at <= 0;
      el("next").disabled = at < 0 || at >= list.length - 1;
      colourKey?.(el("colours"), current);
      back.hidden = innerWidth > 760 || (!active && !main.dataset.referenceReveal && main.scrollLeft < 40);
      if (active) schedule();
    }
    function clearSpotlight(restore = true) {
      const returning = restore && Boolean(main.dataset.referenceReveal);
      if (restore) delete main.dataset.referenceReveal;
      active = null; lastShape = ""; overlay.style.display = "none";
      for (const button of pane.querySelectorAll("[data-reference-target]")) button.setAttribute("aria-pressed", "false");
      el("status").textContent = "";
      if (returning && !pane.hidden) select.focus({preventScroll:true});
    }
    function hole(rect) { return `M${rect.left},${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`; }
    function paint() {
      scheduled = 0;
      if (!active || pane.hidden) return;
      const raw = bounds(active), doc = main.dataset.referenceReveal ? {left:-1,top:-1,right:-1,bottom:-1,width:0,height:0} : pane.getBoundingClientRect();
      if (!raw) {
        overlay.style.display = "none";
        const reasons = { rows: "Rows is off. Use Rows to enable the strip.", selection: "No selection. Choose Select and drag a rectangle.", events: "No event lanes. Enable an event family in Lines.", columns: "The column pane is unavailable in this view.", profiles: "Profile tracks are folded. Use Profiles to reveal them." };
        el("status").textContent = reasons[active.region] || "This part is not visible. Open its panel or control, then Show again."; return;
      }
      let left = Math.max(0, raw.left - 4), top = Math.max(0, raw.top - 4), right = Math.min(innerWidth, raw.right + 4), bottom = Math.min(innerHeight, raw.bottom + 4);
      // Clip the target to the visible workspace and leave the docked reference unobscured.
      if (!raw.overReference && left < doc.right && right > doc.left && top < doc.bottom && bottom > doc.top) {
        if (doc.width >= innerWidth - 16) bottom = Math.min(bottom, doc.top);
        else left = Math.max(left, doc.right);
      }
      if (right <= left || bottom <= top) { overlay.style.display = "none"; el("status").textContent = "This part is outside the visible area. Scroll it into view to highlight it."; return; }
      const rect = { left, top, width: right - left, height: bottom - top }, path = `M0,0H${innerWidth}V${innerHeight}H0Z${hole(doc)}${hole(rect)}`;
      if (path !== lastShape) {
        lastShape = path; overlay.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`); shade.setAttribute("d", path);
        for (const [key, value] of Object.entries({ x: left, y: top, width: rect.width, height: rect.height })) frame.setAttribute(key, value);
      }
      overlay.style.display = "block";
      el("status").textContent = `Highlighted: ${active.label.replace(/^Show /, "")}. Press Escape or click the dimmed area to stop.`;
    }
    function schedule() { if (!scheduled) scheduled = requestAnimationFrame(paint); }
    function render(id) {
      beforeChange();
      current = topics.find(topic => topic.id === id) || topics[0];
      select.value = current.id; clearSpotlight();
      const available = matches(), index = available.indexOf(current), article = node("article");
      article.dataset.topic = current.id;
      article.append(node("p", current.group, "ol-reference-group"), node("h3", current.title));
      const list = node("dl");
      for (const [title, key] of [["Purpose", "purpose"], ["Read", "read"], ["Use", "use"]]) {
        const value=node("dd",current[key]);
        if(key==="read" && current.matrix){const wrap=node("div","","ol-reference-matrix"),table=node("table"),head=node("thead"),tr=node("tr"),body=node("tbody");for(const label of current.matrix.headers){const th=node("th",label);th.scope="col";tr.append(th);}head.append(tr);table.append(head);for(const cells of current.matrix.rows){const row=node("tr");cells.forEach((text,i)=>{const cell=node(i?"td":"th",text);if(!i)cell.scope="row";row.append(cell);});body.append(row);}table.append(body);wrap.append(table);value.append(wrap);}
        list.append(node("dt",title),value);
      }
      article.append(list);
      const actions = node("div", "", "ol-reference-targets");
      for (const [i, target] of current.targets.entries()) {
        const button = node("button", target.label, "ol-action cursor-interaction"); button.type = "button"; button.dataset.referenceTarget = i; button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          if (active === target) { clearSpotlight(); return; }
          clearSpotlight(); active = target; reveal?.(target);
          if (innerWidth <= 760 && !root.querySelector(target.selector || "#ol-canvas")?.closest("#ol-reference") && bounds(target)) { main.dataset.referenceReveal = "true"; main.scrollLeft = 0; }
          button.setAttribute("aria-pressed", "true"); back.hidden = innerWidth > 760; schedule();
        });
        actions.append(button);
      }
      el("targets").replaceChildren(...actions.children);
      el("article").replaceChildren(article);
      const settings = current.settings || current.id;
      for (const section of pane.querySelectorAll("[data-reference-settings]")) section.hidden = section.dataset.referenceSettings !== settings;
      el("colours").replaceChildren(); delete el("colours").dataset.key; colourKey?.(el("colours"), current);
      el("position").textContent = `${Math.max(0,index + 1)} / ${available.length}${el("search").value ? " matches" : ""}`;
      el("prev").disabled = index === 0; el("next").disabled = index === topics.length - 1;
      el("body").scrollTop = 0;
      refresh();
    }
    function open(id, origin = document.activeElement) {
      if (pane.hidden) returnFocus = origin;
      beforeOpen(); pane.hidden = false; main.dataset.reference = "open"; el("toggle").setAttribute("aria-expanded", "true"); el("toggle").setAttribute("aria-pressed", "true");
      if (id) { el("search").value = ""; for (const option of select.options) option.hidden = false; render(id); } else refresh();
      select.focus({ preventScroll: true });
    }
    function close() {
      beforeChange();
      clearSpotlight(); pane.hidden = true; delete main.dataset.reference; el("toggle").setAttribute("aria-expanded", "false"); el("toggle").setAttribute("aria-pressed", "false");
      back.hidden = true; main.scrollLeft = 0;
      const destination = returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest("[hidden]") ? returnFocus : el("toggle");
      destination.focus({ preventScroll: true });
    }
    el("toggle").addEventListener("click", () => pane.hidden ? open(null, el("toggle")) : close());
    el("close").addEventListener("click", close);
    el("shortcuts").addEventListener("click", () => { clearSpotlight(); openKeys(); });
    select.addEventListener("change", () => render(select.value));
    el("prev").addEventListener("click", () => { const list = matches(); render(list[list.indexOf(current) - 1]?.id); if (el("prev").disabled) select.focus(); });
    el("next").addEventListener("click", () => { const list = matches(); render(list[list.indexOf(current) + 1]?.id); if (el("next").disabled) select.focus(); });
    el("search").addEventListener("input", () => {
      const list = matches(), ids = new Set(list.map(topic => topic.id));
      for (const option of select.options) option.hidden = !ids.has(option.value);
      if (list.length) render(ids.has(current.id) ? current.id : list[0].id);
      else { clearSpotlight(); el("position").textContent = "0 / 0 matches"; el("status").textContent = "No matching topics. Clear the search to see all topics."; refresh(); }
    });
    back.addEventListener("click", () => { clearSpotlight(); beforeChange(); main.scrollLeft = 0; back.hidden = true; select.focus({ preventScroll: true }); });
    pane.addEventListener("keydown", event => {
      if (event.key === "Escape" && closeTransient()) event.preventDefault();
      event.stopPropagation();
    });
    document.addEventListener("keydown", event => {
      if (pane.hidden || event.key !== "Escape" || hasTransient()) return;
      // A spotlight owns Escape globally; the docked pane only owns keys from its contents.
      if (!active && !pane.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (active) clearSpotlight(); else close();
    }, true);
    root.addEventListener("click", event => {
      if (active && !pane.contains(event.target)) clearSpotlight(false);
    });
    addEventListener("resize", refresh); addEventListener("scroll", refresh, true);
    new ResizeObserver(refresh).observe(root);
    render(current.id);
    return { open, refresh, clearSpotlight };
  }
  window.explorerReference = Object.freeze({ create });
})();
