# Continuations: pre-change attribution

The scheduling/freshness candidate has a verified paired result; the preparation,
digest and retention correction is under test. #213 remains open until the complete
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

## Candidate under test

The selected change retains zero-delay timers and the initial cancellation
handoffs, but charges another timer wait only after an 8 ms work slice. It does
not change arithmetic order or the resample stream. Private cooperative summaries
count direction/barrier populations together, sort their shared delta population
once, and keep independent result arrays. Bounded sort/merge work and summary
checkpoints permit a changed request to cancel during this formerly synchronous
span. The public synchronous arithmetic functions remain unchanged. Bootstrap
qualification uses the two array lengths it needs instead of rebuilding unused
quantiles/category counts; its diagnostic stage is now named `bootstrap.counts`.

The existing three-entry history map now admits a held entry only while its
completed support reaches the current grid boundary and its clipped canonical
boundary still agrees. An append that completes more columns, canonical revision
or whole pack must obtain current inputs before publishing. A token-only rebuild
with unchanged dependencies still permits the original held/in-flight read and
keeps its actual `sourcePack`; no current provenance is invented. This preserves
the existing token-only read-continuity guard while correcting the measured
growth failure. There is no queue change or new cache.

The complete-study map also has a 512 MiB structural estimate alongside its
existing six-entry limit. The estimate counts ledger constituents/outcomes,
cases, matched references and metadata; it evicts older entries at insertion.
The 100k wire-history count is enforced before record allocation. These local
retention limits preserve every case/ledger entry in an owned result; they are
not a guarantee about total process heap or active temporary buffers.

Preparation loops now use the same short-timer work slices. Dependency tuples
retain their exact ordering and JSON/UTF-8 bytes through bounded serialization.
Native asynchronous SHA is optional, with a cooperative SHA fallback using the
original compression/padding, including in insecure/unsupported contexts. The
original synchronous hash/arithmetic APIs retain their results and synchrony.
Cancellation is checked after native completion before any publication. The
test-only probe tracks native digest promises as owed work; no pending promise
can masquerade as a completed study.

`native-freshness-baseline/` retains a current-main reproduction: one append-only
delta adds 105 eight-hour columns. At the same new source/anchor, retained history
stays at 5,400 records/b1 3,213,824 and yields a null anchor/zero matching cases;
the fresh page holds 5,505 records/b1 3,267,584 and yields 243 completed matching
cases. Both clear busy. Candidate regressions compare complete result fingerprints
and the UI for append growth, moving 100k support and a whole-pack revision.

The frozen five-pair A/A collection completed before these product edits:
40 original raw payloads verified, 30 exact whole-kernel comparisons and 10 full
explorer first/warm observations. `baseline/raw.zip` is the untouched original CI
artifact; `baseline/summary.json`, `assessment.json` and the manifest retain its
producer/build/instrument hashes, host and independently computed floors. The
compute-phase median was 5,661.7 ms and its initial noise floor 155.1 ms. The
earlier assessment mislabeled that secondary field as first-result completion.
The declared busy-clear/complete-bootstrap endpoint was already retained in
`endpoints[].automationWallMs` in every raw trial: its initial median is
5,785.4 ms and its A/A floor 151.7 ms. `complete-endpoint-correction.json` retains
the correction and all original endpoints; no source, instrument or observation
is changed or discarded. Controller transport remains included, with native
compute and two-quiet-frame presentation proxies reported separately.

`first-candidate/` retains all 80 original payloads from the first candidate
`0b82ff3` (runtime producer `909b288`), plus the independently checked assessment.
All 120 initial/current payload hashes, 90 whole-kernel fingerprints and five
paired whole-app input/provenance/interval/population comparisons agree. On that
worker, the primary complete-DOM medians are 6,339.5 → 2,555.7 ms; paired median
gain 3,690.5 ms exceeds the larger 151.7 ms floor in all five pairs. Yield counts
fall from 907 to 108–113. Warm data completion and intended tab presentation stay
separate and show no material gain. The complete 1,461-case browser suite passed
once with no skips/retries on that head. These shared-CI results do not waive
absolute/cumulative #96 acceptance.

The first candidate still exposed a 464.9 ms median digest phase and a 557 ms
observed long task. That recorded remaining cost justifies the preparation/digest
correction above; its candidate measurements are still pending. Original failed
labels, raw vectors and the correction remain retrievable.

Cancellation during summaries, native/fallback byte equivalence (through 200k
tuples) and all three whole-output goldens pass locally. New browser regressions
exercise cached A→B→A with late success/failure, horizon changes during summary
work, both ledgers, Cases as another consumer, bounded completion after departure,
synthetic hidden/show ownership and Stop/restart during digest. Hidden documents
retain the existing bounded-completion policy and can throttle short timers;
synthetic visibility checks do not certify real hidden-page latency. Final
candidate measurements and native responsiveness evidence remain pending.

## Reproduction and remaining collection

Pure Node characterization (no browser launch):

```
node tools/characterize_evidence.cjs d8449f3acab8af9fd2d0dd46bd2a95f148a189c6 reports/characterization.json
node --test tests/unit/evidence-characterization.test.js
node tools/benchmark/continuations-assessment.cjs reports/initial reports/candidate reports/assessment.json
```

Serve the exact-module diagnostic, then visit its printed address in the existing
authorized side panel and use the Case/Repeats/Run controls. This starts only an
HTTP server, never another browser:

```
node tools/diagnose_continuations.mjs --serve d944f503b48de7f746c369b440f331294ef23654 8793
```

The committed `cube-continuations@1` protocol and remote-only runner collected five
alternating A/A pairs before product edits. Each arm uses a fresh kernel page for
all three fixed cases and a fresh whole explorer context/server with a 100k-column
trade source, first activation and unchanged warm reopening. The whole explorer
export retains queue want/dispatch, work served ahead and individual read/compute
phases. Synthetic bridge timing cannot certify Origo service time. The existing
read order, optional eligibility, arithmetic and all draws remain unchanged.

With that baseline complete and independently checked, candidate collection
must repeat A/A on its own worker and use the larger initial/current noise floor,
five alternating pairs, exact output equality and demonstrated work reduction.
Do not interpret a smaller point-only endpoint, a floor failure or a missing
endpoint as faster supported completion. Responsiveness/lifecycle and current
retained-versus-fresh history still require their named regressions. A cache
split, worker or queue rewrite is not implied by this attribution.
