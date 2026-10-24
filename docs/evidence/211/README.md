# Side-panel diagnostics evidence — 24 October 2026

Runtime: `f965cccfb82321e7e76f0af3f1237f741d0142cc` (PR #218), including main
`9f0777c964f2de3b745d0968a3c4139781fc7c26`. The publication commit changes evidence
only. The manifest identifies runtime source/index bytes, the metadata-stamped normal
template and the complete controlled fatal document. The fake server injects its
declared synthetic pack into the normal template; its hash is not a hash of that
final injected response.

- [Normal recording JSON](2026-10-24-f965ccc-side-panel.json) and [native screenshot](2026-10-24-f965ccc-side-panel.png)
- [Fatal late-start/restart JSON](2026-10-24-f965ccc-fatal-restart.json) and [native screenshot](2026-10-24-f965ccc-fatal-restart.png)
- [Build, source and artifact hashes](2026-10-24-f965ccc-manifest.json)

Only the existing authorized in-app side-panel tab was used. The normal target was
a local standard synthetic fixture (seed 20260924). The export records its actual
Chrome 156 user agent, 351 × 575 CSS viewport, DPR approximately 3.86, supported timing
APIs, pack token and `PACK.page`. This differs from the designated benchmark environment.

Normal sequence: arm reload at n=5/m=1, change to n=6, open Continuations, wait for busy
to clear and intervals to publish, close/reopen Query, then Export. The 286,352-byte,
2,185-event recording covers 32.230 seconds and retains startup, request ownership,
pending refinement followed by target submission, study scheduling/history/queue/
compute/yield phases, native timing fields and successful drawer close/open. Both
want-to-dispatch spans completed; the in-flight read is labelled already-dispatched.
Held state/seasonal source packs and bootstrap summaries are recorded separately.
This fixture withholds intervals at the full-matched-block floor and does not certify
#213's qualifying 2,000-draw workload.

The fatal fixture deliberately corrupts the embedded recent gzip and identifies
itself as `synthetic-fatal-start-vector`. After startup had already failed while
unarmed, Start, Export and consecutive restarts consistently retained terminal
unavailability with zero draws. The small separate artifact retains that proof.
Armed fatal reload was also verified in this tab and is covered by browser CI.

Both exports ended normally without truncation. No browser warnings/errors were
captured. The normal viewport was retained and the original production address
reopened; the application may canonicalize its scale descriptor as data/layout changes.

These artifacts establish instrumentation/UI behavior for this runtime and these
fixtures. They do not establish production latency improvement, physical display
presentation, INP, cache-cold behavior or #96's cumulative performance acceptance.
See the [recording contract](../../Performance-Recording.md) for definitions and gaps.
