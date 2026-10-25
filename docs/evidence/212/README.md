# Presentation evidence for #212

Phone Controls lost its fixed, column layout while retained for closing. Its
toolbar grew by 90 CSS px and returned at spring completion. Two selector
additions preserve the existing sheet layout during that exit. The Close and
Escape endpoints also restore the toggle when the sheet owns focus, while
preserving focus deliberately moved elsewhere.

The motion implementation, rest criterion and 664 ms spring are unchanged.

| Independent styled-DOM completion | Baseline | Candidate |
| --- | ---: | ---: |
| Phone close, median | 665.2 ms | 280.7 ms |
| Toolbar maximum height excursion | 90 CSS px | 0 CSS px |
| Toolbar height transitions per trial | 2 | 0 |

All five paired close trials improved; the median gain was 384.5 ms, above the
33.4 ms A/A floor. The other fourteen primary cases had paired median differences
within their floors and justify no additional product change. This metric
observes styled-DOM position/opacity, including declared ancestors, ghosts and
CSS transitions. It does not certify canvas pixels or physical display timing.
The marker duration is separate evidence, not the improvement oracle.

## Build and measurement ownership

- Baseline application: #211 merge `d8449f3acab8af9fd2d0dd46bd2a95f148a189c6`.
  The pre-candidate A/A producer was `e75a5f6ee757fcfe8ce091b32800d114c23a3587`.
  `baseline/` retains its 184 trials plus 56 preflight trials.
- Candidate PR head: `5592683b86f1811047332bd9706957dcbb841523`; measured merge:
  `a1cc27efd860777439f1d47350e9d79ce10b7dc6`. `candidate/` retains a fresh
  184-trial A/A followed by 184 A/B trials on the same worker, plus 56 preflight
  trials. All 424 raw payloads were hash-verified and reanalyzed.
- Candidate `index.html` SHA-256:
  `a5c4c478f1377d19138d43669f97df0660238d0176e741aa99975ffe6d6612d7`.
  Application, fixture and measurement bytes remain identical after the
  backend-only main update and this evidence/test publication.
- Both producers used Headless Chrome 153, DPR 1 and the protocol viewports
  (390×844 phone; 1500×950 desktop). The initial worker was EPYC 7763; the
  candidate worker was EPYC 9V74. Shared-worker variation is retained through
  the larger initial/fresh A/A floor, not treated as a dedicated-host guarantee.

The frozen protocol is `tools/benchmark/presentation.v1.json`. Producer summaries
and manifests are unmodified. `candidate/assessment.json` supplies the separately
demonstrated toolbar layout-cycle removal to the existing improvement rule;
its implementation hash and every raw reference are retained.

## Retained evidence and reproduction

Each publication manifest hashes its files and compressed raw payloads. Both
`raw.zip` archives retain every measured trace and #211 recording, including
continuity and focus controls. Optional CI context PNGs remain listed in the
original producer manifests; native correctness screenshots are retained in
`native-baseline/` and `native-candidate/`. Native captures use synthetic data
and different actual geometry; their DOM observations and later screenshots
are not synchronized latency samples.

Reproduce the candidate assessment without starting a browser:

```sh
mkdir -p reports/212-reproduce/presentation
unzip -q docs/evidence/212/candidate/raw.zip -d reports/212-reproduce
cp docs/evidence/212/candidate/summary.json reports/212-reproduce/presentation/summary.json
cp docs/evidence/212/candidate/producer-manifest.json reports/212-reproduce/presentation/manifest.json
node tools/benchmark/presentation-assessment.mjs docs/evidence/212/baseline/summary.json reports/212-reproduce/presentation reports/212-reproduce/assessment.json
```

`guards/history.json` and its hashed archive retain all fourteen original motion
comparisons, including failures and both application-identical controls. The
candidate's #211-reference guard passed. Its additional implementation-parent
comparison flagged Compare frame time (16.8→33.3 ms); that flag is retained and
is not declared a proven false positive or waived. Compare input exceeded the
existing absolute 50 ms budget in both arms. Relative guards and these styled-DOM
measurements do not close #96's absolute/cumulative acceptance. Final-head CI
and review remain independently required on PR #251.

## Inspector attribution

The current-head #211-reference guard flagged Inspector frame p95; its single
unchanged confirmation instead flagged slow-frame share (8.63→10.37%), with
unchanged median draw p95 and lower total task time. Both failures and every
intermediate comparison are retained above. The current implementation-parent
comparison passes. None of these observations waives a failed guard.

`tools/diagnose_inspector.mjs` selects the existing Inspector case in the frozen
guard's existing one-pair CPU-profile mode and retains its full frame, draw,
callback and input vectors. It verifies the original guard's bytes against the
#211 merge, adapts an untracked temporary copy, and removes that copy afterward.
Its manifest identifies both adaptations and hashes every resulting JSON file.
CPU profiling changes execution cost: this is attribution data, and its
profile-mode success means collection completed. Budget acceptance continues to
use the original unmodified guard. No further confirmation rerun is authorized
by this diagnostic; attribution must precede a product change.
