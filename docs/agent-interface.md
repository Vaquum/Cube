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
  and retains the prior capture through `cubeAgent.previous`. Source revisions are
  observations; neither a code nor a pack token reconstructs an unavailable vintage.

The standalone recorded page supports document exchange and embedded links; large
links and refresh need the live bridge. Documents are bounded at 16 MiB and canvas
snapshots at 250,000 cells. Oversized exports fail explicitly; no data is truncated.
Comparison captures retain their existing 4 MiB collection limit.

## Browser API

`window.cubeAgent` exposes `capabilities()`, `inspect()`, `export(scope)`, `query(query)`,
`apply(document)`, `configure(patch)`, `compare(options)`, `replay(anchor,enabled)`,
`annotate(line)`, `share(document?,focus?)` and `refresh()`. These operations use the
same scene, drawing and comparison validators, committed-frame capture and
measurement kernel as the human controls. Scopes are `view`, `selection`, and
`comparison`. State operations are asynchronous.

Queries use UTC ISO `t1,t2`, USDT `p1,p2`, seconds `tR` and USDT `pR`. Scene patches
use `viewport:[baseStart,baseEnd,rowStart,rowEnd]`, `resolution:[n,m]` (dyadic
exponents), `mode,pane,rows,period,lines,selection,replay,anchor,scale`. Anchors are
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
`cube_refresh` returns the new document and explicit metric changes.

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
