# Side-panel diagnostics evidence — 24 October 2026

Normal runtime: `2a69f465daf0c8b06e5870ca7bf999f127531812` (PR #218), including main
`115e401d1dbd6c81cd707e5bd19098bcb1b063ee`. Its publication changes evidence only.
The manifest identifies runtime source/index bytes and the metadata-stamped normal
template. The fake server injects its declared synthetic pack; the template hash is
not a hash of that final injected response.

- [Current normal recording JSON](2026-10-24-2a69f46-side-panel.json) and [native screenshot](2026-10-24-2a69f46-side-panel.png)
- [Retained fatal late-start/restart JSON](2026-10-24-f965ccc-fatal-restart.json) and [native screenshot](2026-10-24-f965ccc-fatal-restart.png)
- [Runtime/source/artifact hashes](2026-10-24-2a69f46-manifest.json)

Only the existing authorized in-app side-panel tab was used. The normal target was
a local standard synthetic fixture (seed 20260924). The export records Chrome 156,
351 × 575 CSS viewport, DPR approximately 3.86, supported timing APIs, pack token and
`PACK.page`. This differs from the designated benchmark environment.

Normal sequence: arm reload at n=5/m=1, change to n=6, open Continuations, wait for busy
to clear and intervals to publish, close/reopen Query, then Export. The 282,325-byte,
2,115-event recording covers 30.957 seconds. It retains startup, request ownership,
pending refinement followed by target submission, study scheduling/history/queue/
compute/yield phases, native timing fields and successful drawer close/open. Both
want-to-dispatch spans completed; the in-flight read is labelled already-dispatched.
Held state/seasonal source packs and bootstrap summaries are recorded separately.
This fixture withholds intervals at the full-matched-block floor and does not certify
#213's qualifying 2,000-draw workload.

The separate fatal proof retains runtime `f965cccfb82321e7e76f0af3f1237f741d0142cc`;
it is not a new fatal capture on the normal runtime above. It deliberately corrupts
the embedded recent gzip and identifies itself as `synthetic-fatal-start-vector`.
After already-failed unarmed startup, Start, Export and consecutive restarts retained
terminal unavailability with zero draws. Armed fatal reload was also verified in
that tab. The recorder's source hash remains identical; the current browser suite
covers both armed and initially-unarmed fatal/start/restart cases. The manifest
retains the fatal proof's separate source/document hashes.

Exports ended without truncation. No browser warnings/errors were captured. The
normal viewport was retained and the original production address reopened; the
application may canonicalize its scale descriptor as data/layout changes.

These artifacts establish instrumentation/UI behavior for their named runtimes and
fixtures. They do not establish production latency improvement, physical display
presentation, INP, cache-cold behavior or #96's cumulative performance acceptance.
See the [recording contract](../../Performance-Recording.md) for definitions and gaps.
