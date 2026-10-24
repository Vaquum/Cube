# Side-panel diagnostics evidence — 24 October 2026

Runtime: `bc63a0d475c9bdd74e2d6a57164b22410a58e3ff` (PR #218), including main
`472bd1e98da7f8e04fd5ab0d8ebf21891cc71d38`. The publication changes evidence only.
The manifest identifies runtime source/index bytes, the metadata-stamped normal
template and the complete controlled fatal document. The fake server injects its
declared synthetic pack into the normal template; its hash is not a hash of that
final injected response.

- [Normal recording JSON](2026-10-24-bc63a0d-side-panel.json) and [native screenshot](2026-10-24-bc63a0d-side-panel.png)
- [Fatal late-start/restart JSON](2026-10-24-bc63a0d-fatal-restart.json) and [native screenshot](2026-10-24-bc63a0d-fatal-restart.png)
- [Build, source and artifact hashes](2026-10-24-bc63a0d-manifest.json)

Only the existing authorized in-app side-panel tab was used. The normal target was
a local standard synthetic fixture (seed 20260924). The export records Chrome 156,
351 × 575 CSS viewport, DPR approximately 3.86, supported timing APIs, pack token and
`PACK.page`. This differs from the designated benchmark environment.

Normal sequence: arm reload at n=5/m=1, change to n=6, open Continuations, wait for busy
to clear and intervals to publish, close/reopen Query, then Export. The 273,269-byte,
1,988-event recording covers 28.858 seconds. It retains startup, request ownership,
pending refinement followed by target submission, study scheduling/history/queue/
compute/yield phases, native timing fields and successful drawer close/open. Both
want-to-dispatch spans completed; the in-flight read is labelled already-dispatched.
Held state/seasonal source packs and bootstrap summaries are recorded separately.
This fixture withholds intervals at the full-matched-block floor and does not certify
#213's qualifying 2,000-draw workload.

The fatal fixture deliberately corrupts the embedded recent gzip and identifies
itself as `synthetic-fatal-start-vector`. After already-failed unarmed startup,
Start, Export and consecutive restarts retained terminal unavailability with zero
draws. The separate small artifact retains that proof. Armed fatal reload was also
verified in this tab and is covered by browser CI. This verifies that the corrected
snapshot still preserves global startup failure while draw errors belong to their
own intent. Held replacement-intent and in-flight Stop/restart regressions use
separate CI oracles; this normal capture does not claim to exercise those boundaries.

Exports ended without truncation. No browser warnings/errors were captured. The
normal viewport was retained and the original production address reopened; the
application may canonicalize its scale descriptor as data/layout changes.

These artifacts establish instrumentation/UI behavior for this runtime and these
fixtures. They do not establish production latency improvement, physical display
presentation, INP, cache-cold behavior or #96's cumulative performance acceptance.
See the [recording contract](../../Performance-Recording.md) for definitions and gaps.
