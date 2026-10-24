# Human and agent exchange

Cube uses one versioned `cube-analysis@1` document for human and agent exchange.
It holds a complete sealed v3 scene, validated comparison captures, captured
selection measurements and optional frozen canvas sources. Text exports contain
readable measurements followed by compact JSON. Source text is data, not agent
instructions. Unknown schemas, invalid support, unsafe members, missing provenance,
nonfinite values and content-integrity failures reject the whole document.

## Human workflow

- Right-click a cell or use Inspect/Cells **Copy cell** to paste its exact measurements,
  formulas, histories, units and source identity into a conversation.
- Select a rectangle, open Query and **Copy selection**; Ctrl/Cmd+C on the focused
  canvas also copies the selected cells. **Copy comparison** exchanges scattered
  captured cells without changing their original observations.
- **Share investigation** copies a complete link. It retains camera, cell resolution,
  encoding, reference choices, calibrations, axes, drawings, comparison values and
  captured source data. Small documents embed a compressed code in the URL fragment;
  documents over the 8,192-character link budget use an immutable server reference.
- Restore a copied JSON document, text packet, `cube-analysis:` code or same-host
  investigation link through Query **Restore view**. Existing drawings are preserved
  before replacement; invalid required content is not applied.
- Captured investigations identify their capture time and keep evidence fixed.
  **Refresh current source** explicitly reads the current cube, compares measurements
  and retains the prior capture until the page closes. **Restore previous capture**
  returns to it; agents can call `cubeAgent.restorePrevious()`. `cubeAgent.previous` exposes a causally redacted copy; the full prior state remains private for restoration. Source revisions are
  observations; neither a code nor a pack token reconstructs an unavailable vintage.

The standalone recorded page supports document exchange and embedded links; large
links and refresh need the live bridge. Documents are bounded at 16 MiB and canvas
snapshots at 250,000 cells. Oversized exports fail explicitly; no data is truncated.
Comparison captures retain their existing 4 MiB collection limit.

## Browser API

`window.cubeAgent` exposes `capabilities()`, `inspect()`, `export(scope)`, `query(query)`,
`apply(document)`, `configure(patch)`, `compare(options)`, `replay(anchor,enabled)`,
`annotate(line)`, `share(document?,focus?)`, `refresh()` and `restorePrevious()`. These operations use the
same scene, drawing and comparison validators, committed-frame capture and
measurement kernel as the human controls. Scopes are `view`, `selection`, and
`comparison`. State operations are asynchronous.

Queries use UTC ISO `t1,t2`, USDT `p1,p2`, seconds `tR` and USDT `pR`. Scene patches
use `viewport:[baseStart,baseEnd,rowStart,rowEnd]`, `resolution:[n,m]` (dyadic
exponents), `mode,pane,rows,period,background,backgroundPeriod,lines,selection,replay,anchor,scale`.
Rows controls the second profile; Background controls the backdrop and native colour strip. Their measures and periods are independent.
Use `readMode:"captured"` to hold evidence or `readMode:"live"` to create a view
that reads the current source, including data needed by newly enabled features. Anchors are
absolute base-column positions; cell replay floors the edge to its current grid.
Trend-line annotation uses the existing drawing object: `a,b` each contain
`timeMs` (integer UTC milliseconds) and `priceCents` (integer cents), with RGB
`color` and optional plain-text `label`.

`src/agent.js` is the common browser/Node document library. `seal`, `validate`,
`parse`, `encode`, `decode`, `text`, `link`, `configure`, `annotate`, `compare`,
`fromQuery` and `diff` share the existing engines. Comparisons derive causal
cutoffs from the scene; caller options cannot broaden a replay edge. Refresh
compares canonical metric content rather than object member order.

## Agent HTTP and MCP

Node 22 or newer runs the adapter without npm runtime dependencies:

```sh
CUBE_URL=https://cube.vaquum.fi node tools/cube-agent.mjs
```

This serves MCP over stdio using the pinned [2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
and [newline-delimited transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
Configure an MCP client with command `node`, the absolute adapter path as its
argument, and `CUBE_URL`. Existing portal credentials can be supplied through
`CUBE_COOKIE` or `CUBE_AUTHORIZATION`; credentials are never put into links or
logged, and authenticated requests refuse redirects. The bridge remains behind
the existing portal login.

The adapter exposes `cube_capabilities`, `cube_inspect`, `cube_query`,
`cube_compare`, `cube_configure`, `cube_replay`, `cube_annotate`, `cube_share` and
`cube_refresh`. Discover exact argument schemas with MCP `tools/list`.
`cube_query` reads the current source and returns a captured document;
`cube_refresh` rereads `document.selection.query` and each captured cell at their original bounds, pinned to one source token, then returns the new document and explicit metric changes. `scene.view.viewport` remains the camera; browser `scene.query` describes the drawn rectangle when present, otherwise the camera; a null recorded selection stays null. The configuration patch `selection` edits the drawn `scene.view.selection` rectangle, rather than replacing the recorded selection region.

Selection
changes use common quantity names (`volume`, `taker_buy_volume`, `trade_count`,
`taker_buy_trade_count`, `poc`, `taker_buy_poc`), accepting older browser aliases.
Summary geometry and provenance remain in the document and do not count as
measurement changes. Browser POC centres are exported in USDT with the actual
measured `pocRowWidth`; the legacy `pocRow` address remains available. POCs with
unknown or different measured row widths are disclosed in
`unavailableSelectionMetrics` rather than reported as a market change.
Browser camera edits, inspection exports and Share retain the investigation's
recorded selection (including an explicit null). Explicit selection/cell copies
capture the current requested region; refresh rereads the recorded region.

For ordinary HTTP clients:

```sh
CUBE_URL=https://cube.vaquum.fi node tools/cube-agent.mjs --http 8488
curl -s http://127.0.0.1:8488/agent -H 'Content-Type: application/json' \
  -d '{"operation":"cube_capabilities","arguments":{}}'
```

The local HTTP adapter binds to loopback and rejects foreign Origin headers.
Both transports call the same dispatch function. The bridge provides bounded
`GET /cube/agent/query?proto=2&t1&t2&p1&p2&tR&pR`,
`GET /cube/agent/capabilities?proto=2`, `POST /cube/investigations?proto=2`, and
`GET /cube/investigations/<sha256>?proto=2`. Agent query arithmetic uses the same
canonical reader and open-column handling as the existing cube query. Raw
responses are translated through the browser's measurement kernel in Node.

Stored investigations are immutable SHA-256-addressed bytes in SQLite on the
`cube-investigations` Docker volume. References survive service restarts and
deploys. Storage is bounded at 512 MiB; it refuses new documents when full,
without evicting or replacing existing evidence. Local Docker startup retains
the existing read-only image, dropped capabilities and loopback bridge.

## Evidence in chat

`cube_share` returns `url` and `evidence:[{id,url,markdown}]`. Use the provided
Markdown next to a claim, e.g. `[Supporting cell](COMPLETE_EVIDENCE_URL)`. Opening
it restores the investigation, focuses the comparison record and selects its
exact nominal cell at its original resolution. Labels identify evidence rather
than asserting that a hypothesis has been established.

Future interactive canvas sequences, optional replay, narration and annotation
overlays are design work tracked in [Present mode #131](https://github.com/Vaquum/Market-State-Cube-Explorer/issues/131).

Each document's selection is recorded evidence carried by the investigation,
including in live mode. Editing the camera or drawing a rectangle does not replace
it. `export("selection")` / Copy selection records the current reading; applying
that resulting document explicitly adopts it as the investigation. Share captures
the current source snapshot while retaining the investigation's recorded selection.
Exported text labels the document creation time separately from measurement
provenance. Legacy cell-copy bounds are normalized from unique retained support on
inspect/configure/share/refresh exports. POCs name measured price-row centres and
can lie outside a clipped observed price band; `pocRowWidth` identifies that grid.

Selection comparisons report numeric differences in `changes`. Whole-reading
availability is separate: `selectionState` contains before/after states and the
measured side's canonical values. Pending, failed, hidden and unavailable reads
never become invented numeric revisions. Supported POC values changing to explicit null remain changes; missing fields are
disclosed as unavailable rather than interpreted as measured removals.
occupied `cell_count` requires the same observed region and measured `cellGrid`
(time seconds and price USDT). Legacy missing grids/fields are disclosed in
`unavailableSelectionMetrics`. New browser `supportVersion: 1` records actual
whole-cell bounds for recorded fallback; older recorded packets without those
bounds cannot establish a numeric comparison. Empty recorded support is unavailable.
Historical measurement time ends at the observed region, which keeps already-known
readings visible in replay. Full source/support metadata remains in the returned
document; a numeric difference alone does not classify a historical source revision
versus growth of the observed interval. No blanket numeric tolerance is applied.

New browser selections record their actual measurement resolution in
`selection.query`, preserving the reduction/grid used by the original observation
when refreshing through MCP, even if the requested display level was finer.
An unavailable reading retains its requested level because it has no observed grid.
The bridge preserves an absent source occupied-cell count as unavailable, without
defaulting it to zero. Selection summaries can miss distribution changes that preserve their totals,
POCs and occupied-cell count; per-cell captures retain that finer evidence.

While a rolling window awaits a newer query, selection copies retain the bounds
of the still-displayed measurement; the current camera does not relabel it.
