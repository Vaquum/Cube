# Continuations: pre-change attribution

No product optimization is included yet. #213 remains open until the complete
before/after collection, correctness, source freshness, responsiveness,
cancellation and independent review gates are satisfied. #96 retains absolute
and cumulative acceptance.

## Retained evidence

- `baseline/characterization-{d844,d944}.json.gz` contains bounded SHA-256 tree
  fingerprints of every enumerable study field, every ledger row and every case
  in all horizons, both summary kinds, thresholds, provenance and uncertainty.
  Hashes agree on the #211 merge and implementation parent. Input construction
  is fixed by `tests/support/evidence-study.js`; the unit golden predates product
  changes. `baseline/manifest.json` pins original compressed and decoded bytes.
- `native-baseline/production-611-first-1*.json.gz` retains the untruncated #211
  page-owned export from actual deployed `61175f2` in the authorized side panel,
  after Record next reload and first explicit Continuations activation. The
  complete intervals were observed with busy false. One source-token advance
  occurred while waiting; actual source, support, digest, key and seed remain in
  the export/state. Bridge/backend warmth is unknown; this is one ordinary-load
  production diagnostic, not a cache-cold or candidate certificate.
- `native-baseline/kernel-d944-*-three.json.gz` contains three sequential native
  runs each of qualifying 100k, floor-failure and partial-coverage synthetic
  inputs using exact current-main encoding/evidence modules. All nine whole
  output fingerprints and populations match the pre-edit Node golden. The
  native report records engine/viewport/DPR, visibility, every phase boundary,
  frame intervals, yield count/waits, engine-exposed long tasks and heap
  estimates. The report identifies the exact modules and generated HTML.
  `native-baseline/summary.json` pins every raw file and the observed results.

The qualifying input produces 100,000 ledger rows, 97,311 horizon-1 cases,
4,890 matches, 25 calendar blocks, 24 full matched blocks and all 2,000 draws.
The 10k floor case has 2 full matched blocks and correctly runs no draws. The
partial case retains coverage/empty/missing-POC/predecessor exclusions and still
runs all 2,000 draws. These populations are not inferred from fake duration.

Native qualifying compute wall was 5,841.1–6,128.4 ms, with 907 timer yields
and 4,509.8–4,709.1 ms schedule-to-resume waits. The full production compute
phase was 6,690.4 ms, including 559.1 ms digest and a 1,629.2 ms summary phase.
These are async walls with overlapping subspans, never additive CPU estimates.

Kernel input construction and fingerprinting are outside compute wall and timed
separately. Native repeats share a page and include no transport/explorer
preparation. Raw long-task entries can start before compute or straddle its
boundary; the summary labels those separately instead of attributing all their
duration to compute. Heap is a nonstandard engine estimate, not GC or retained
heap attribution. None of these diagnostics certifies INP, compositor timing or
the designated-machine budgets.

## Reproduction and remaining collection

Pure Node characterization (no browser launch):

```
node tools/characterize_evidence.cjs d8449f3acab8af9fd2d0dd46bd2a95f148a189c6 reports/characterization.json
node --test tests/unit/evidence-characterization.test.js
```

Serve the exact-module diagnostic, then visit its printed address in the existing
authorized side panel and use the Case/Repeats/Run controls. This starts only an
HTTP server, never another browser:

```
node tools/diagnose_continuations.mjs --serve d944f503b48de7f746c369b440f331294ef23654 8793
```

The committed `cube-continuations@1` protocol and remote-only runner collect five
alternating A/A pairs before product edits. Each arm uses a fresh kernel page for
all three fixed cases and a fresh whole explorer context/server with a 100k-column
trade source, first activation and unchanged warm reopening. The whole explorer
export retains queue want/dispatch, work served ahead and individual read/compute
phases. Synthetic bridge timing cannot certify Origo service time. The existing
read order, optional eligibility, arithmetic and all draws remain unchanged.

Once that baseline is complete and independently checked, candidate collection
must repeat A/A on its own worker and use the larger initial/current noise floor,
five alternating pairs, exact output equality and demonstrated work reduction.
Do not interpret a smaller point-only endpoint, a floor failure or a missing
endpoint as faster supported completion. Responsiveness/lifecycle and current
retained-versus-fresh history still require their named regressions. A cache
split, worker or queue rewrite is not implied by this attribution.
