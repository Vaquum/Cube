# Performance recording

Open **Query → Performance recording** in the existing browser. Start, exercise an
interaction, then Stop/Export. Export stops collection and exposes the same compact
JSON in a read-only field and download. Record next reload stores a one-shot arm in
this tab's session storage, consumed before startup decoding. Stop and Export remain
reachable during held or fatal startup. The arm stores no measurements.

Collection stops at 120 seconds, 10,000 events or 2 MiB of serialized UTF-8 JSON,
including final metadata. A limit sets `truncated` and its `stopReason`. Unfinished
interaction IDs are `ended-incomplete`; unmatched phase starts are incomplete work.
Starting replaces the previous recording. Nothing is transmitted or persisted.
Stopped collection has no measurement event listeners, PerformanceObservers,
acknowledgment timers or animation-frame loop; the four entry-control bindings remain.
There are no diagnostic requests or prototype patches.

`explorerDiagnostics` is a declared production module factory, checked by B01
(S1-003). It exposes classification/serialization and recorder construction, not the
private application instance, market controller, storage mutations or a test/control
route. Help resolves the four actions and the JSON field on demand; Query's System
reference entry describes the recording.

## Identity and ownership

Schema `cube-performance@2` carries deployed commit/PR metadata, `PACK.page` when
supplied, pack token/provenance, time origin, user agent, viewport, DPR and timing
capabilities. Empty build metadata means unknown. Pin an unlabelled served build
independently. Resource/script names omit credentials, query and fragment; inputs
carry control IDs/types rather than typed text, key values or clipboard data.

Acknowledgment follows native event dispatch, including task-queue delay and the
handler's resulting request. It does not establish visible feedback. Semantic intent
has its own generation: camera/view/pack replacement supersedes it, including A→B→A.
Dependency draws may advance dirty revision within that intent. Apply View retains
its owner across decode and commits it only when applied. Rejected/no-op actions
cannot borrow unrelated completion. Restart invalidates old callbacks and retained
raster identity.

The export distinguishes user settings, achievable target and actual submitted output.
The target names `viewLevel()`'s tile-column cap. Candles retain the chosen bar level
and name their bounded window/support. Painted candle ranges carry actual cache keys,
pack tokens, support, measured-through edge, version and bar count. Cell measurement
source is separate. An obsolete decoded candle answer reports discarded when its
consumer rejects mode/range/token, not applied.

| Readiness | Meaning |
| --- | --- |
| `pending-data` | Current output/dependency has not been submitted |
| `pending-refinement` | Retained/blended preview or calibration still owed |
| `coarse-loaded` | Coarse preview held while a known dependency is pending |
| `target-output-submitted` | Target submitted with relevant dependencies satisfied |
| `terminal-fallback` / `terminal-unavailable` | Explicit failure/recorded support limit and reason; failure outranks owed refinement |
| `stalled` | Target gap without known pending dependency or terminal explanation |
| `not-applicable` | Expanded Compare owns the workspace |

During a composite, scalar grid/source are null; retained, preview and target layers
are separate. A raster predating recording or a rebased composite is uncertified.
Lack of reads never proves a grid unsupported. This records #195 without repairing it.

## Completion and native coverage

A draw measures application entry through completed canvas/DOM submission, excluding
the compositor. Draws can precede acknowledgment; deferred attribution preserves their
original `at`. Use timestamps rather than appended array order. First draw, relevant
data-ready submission and presentation proxy are distinct.

The proxy requires two visible sampled frames without relevant scope motion/busy
state. Canvas additionally needs current target submission or an explicit terminal
result. Intended open and close differ; successful close reports `scope-closed`, while
unrelated departure is unavailable. Drawer, inspector (including main-grid motion),
phone Controls, reference, dialog/popover and study scopes are identified. Native CSS
animations/transitions within that scope are inspected. Tooltips and optional background
study work do not delay merely opening a panel. Continuations retains its busy scope
until the complete study is published.

This proxy is not an independent visual-settle metric. It does not count every spring
start/retarget or certify all retiring ghosts, optional chart overlays, or actors
outside the declared scopes. #212 must add a versioned independent geometry/opacity
observation before comparing candidates.

Supported Resource/NavigationTiming, EventTiming, PaintTiming, long-task and
long-animation-frame entries are retained. Paint/LoAF fields such as `paintTime`,
`presentationTime`, blocking/render/layout times and bounded script attribution are
feature-detected with field-level presence. Missing differs from exposed null/zero.
Engine-reported presentation is not a physical-display or requested-grid certificate.
Event Timing excludes wheel/pointermove, with a 16 ms threshold and 8 ms rounded
durations; missing entries do not establish fast input. Buffered entries may predate
recording. Cross-origin transport fields can be zero without Timing-Allow-Origin.
Actual engine capabilities govern the export; see the [Event Timing](https://w3c.github.io/event-timing/),
[Paint Timing](https://w3c.github.io/paint-timing/) and
[Long Animation Frames](https://w3c.github.io/long-animation-frames/) drafts.

Native rAF intervals include recorder overhead and visibility/throttling. An interval
crossing hidden state is labelled, not certified visible. No INP/LCP, CPU/GPU profile,
heap/GC certificate or cache-cold certificate is inferred.

## Attribution and benchmark boundaries

History want→dispatch spans list work served ahead in the unchanged serial queue.
A needed history already in flight is marked `history-already-dispatched`, without
inventing a new queue span after its dispatch or inferring a pre-observation wait.
Cube/movement phases split fetch-to-headers, body JSON, decode and consumer apply;
ResourceTiming supplies permitted transport detail. Startup decode is separate.
Continuations splits scheduling/gesture delay, column preparation, seasonal index,
digest, compute index, ledger/seasonal, thresholds/state, cases, summaries, bootstrap
summaries/scan/draws/intervals. Input metadata distinguishes delivered columns and
held state/seasonal support/source packs from the current pack and logical ledger.
Aggregated seasonal-call durations and yield count/total/max schedule-to-resume waits
expose costs without one event per case. Output records ledger/case counts, digest,
calendar/full matched blocks, valid draws and whether draws ran. Async phases include
yields/waits and overlap; neither their sum nor subtracted aggregate samples is a CPU
profile. Instrumentation overhead is included. Arithmetic, yield order, reads/priority,
caches, motion policy and all bootstrap draws are unchanged.

Existing `tools/benchmark/navigation.v4.json` definitions/thresholds remain intact:

| Existing key | Side-panel relationship |
| --- | --- |
| `p95DrawMs` (10), `drawOverMs` (16.7) | Similar submission span; different observer/environment, diagnostic only |
| `p95FrameMs` (20), `frameOverMs` (50), `gestureIntervalOver33_3MsMaxShare` (0.01) | Native intervals retained; visibility, recorder overhead and designated gesture/environment differ |
| `p95InputToPaintMs` (50) | Acknowledgment/data/proxy are separate; two-frame async completion is not the benchmark's next-paint metric |
| comparison `p95ActionToVisibleMs` (50), `maxMountedEntries` (24) | Render marker retained; scoped proxy does not replace action or mounted-entry assertions |

Recordings do not score the different benchmark environment or waive #96's cumulative
acceptance. Local synthetic runs prove instrumentation/UI behavior only. Publish final
raw JSON and native screenshot under `docs/evidence/` with runtime/source hashes.
A publication-only commit may name the preceding runtime commit when source bytes are
verified identical. A local hash alone is not retrievable raw evidence.
