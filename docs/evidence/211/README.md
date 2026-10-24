# Side-panel diagnostics evidence — 24 October 2026

Runtime: `0bc7958ad9f9cf43f8e5696c2b3c7f61378689a1` (PR #218), including main
`d33897e3c0be9385f45a2d51a8b1fc51fe4662bf`. The publication commit changes evidence
only; the manifest verifies the runtime source/index bytes against publication.
The served page adds only deployment-style commit/time/PR metadata to the generated
template; both template and served SHA-256 values are retained.

- [Raw compact JSON](2026-10-24-0bc7958-side-panel.json)
- [Native screenshot](2026-10-24-0bc7958-side-panel.png)
- [Build, source and artifact hashes](2026-10-24-0bc7958-manifest.json)

Only the existing authorized in-app side-panel tab was used. The target was a local
standard synthetic fixture (seed 20260924), not production market data. The recording
contains its actual Chrome user agent, viewport, DPR, timing capabilities, pack token
and `PACK.page`; these differ from the designated benchmark environment.

Sequence: arm reload at n=5/m=1, change to n=6, open Continuations, verify busy clears
with intervals published, close/reopen Query, then Export. The 6,065-event recording
retains startup, request ownership, pending refinement followed by target submission,
study scheduling/history/queue/compute/yield phases, native paint/long-frame fields and successful
drawer close/open. This particular study withholds intervals at the full-matched-block
floor; the bootstrap record explicitly says whether draws ran. It does not certify
the qualifying 2,000-draw browser workload required by #213.

Both want-to-dispatch spans ended completed, and the in-flight read was explicitly
labelled already-dispatched. Held state/seasonal source packs and bootstrap summaries
are retained separately. Recording ended by Export, without truncation. No browser warnings/errors were
captured. The viewport override was reset and the original production address opened;
the application may canonicalize its active scale descriptor as data/layout changes.

These artifacts prove instrumentation/UI behavior for the named runtime and fixture.
They do not establish a production latency improvement, physical presentation, INP,
cache-cold behavior or #96's cumulative performance acceptance. See the
[recording contract](../../Performance-Recording.md) for definitions and coverage gaps.
