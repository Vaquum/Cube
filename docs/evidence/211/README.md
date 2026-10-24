# Side-panel diagnostics evidence — 24 October 2026

**Historical capture pending refresh:** review subsequently corrected an in-flight
history queue classification and the reference Show scroll owner. This capture is
retained as evidence of the named runtime, not the final revision's acceptance.

Runtime: `765231780c11e1a86272aacfce92b32c0eed12ed` (PR #218), including main
`c3485234f812447471b57807957690690bd84f0b`. The publication commit changes evidence
only; the manifest verifies the runtime source/index bytes against publication.
The served page adds only deployment-style commit/time/PR metadata to the generated
template; both template and served SHA-256 values are retained.

- [Raw compact JSON](2026-10-24-7652317-side-panel.json)
- [Native screenshot](2026-10-24-7652317-side-panel.png)
- [Build, source and artifact hashes](2026-10-24-7652317-manifest.json)

Only the existing authorized in-app side-panel tab was used. The target was a local
standard synthetic fixture (seed 20260924), not production market data. The recording
contains its actual Chrome user agent, viewport, DPR, timing capabilities, pack token
and `PACK.page`; these differ from the designated benchmark environment.

Sequence: arm reload at n=5/m=1, change to n=6, open Continuations, verify busy clears
with intervals published, close/reopen Query, then Export. The 2,748-event recording
retains startup, request ownership, pending refinement followed by target submission,
study history/queue/compute/yield phases, native paint/long-frame fields and successful
drawer close/open. This particular study withholds intervals at the full-matched-block
floor; the bootstrap record explicitly says whether draws ran. It does not certify
the qualifying 2,000-draw browser workload required by #213.

Recording ended by Export, without truncation. No browser warnings/errors were
captured. The viewport override was reset and the original production address opened;
the application may canonicalize its active scale descriptor as data/layout changes.

These artifacts prove instrumentation/UI behavior for the named runtime and fixture.
They do not establish a production latency improvement, physical presentation, INP,
cache-cold behavior or #96's cumulative performance acceptance. See the
[recording contract](../../Performance-Recording.md) for definitions and coverage gaps.
