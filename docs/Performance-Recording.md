# Performance recording

Open **Query → Performance recording** in the existing browser. Start recording,
exercise the interaction, then stop/export. Export also stops collection and shows
the downloaded JSON in a read-only field. **Record next reload** arms one reload
in this tab using session storage; the arm is consumed before startup decoding.
Recording stops after two minutes or 10,000 events. Starting again replaces the
previous recording. No recording is transmitted, persisted, or collected by default.

The export carries the page's deployed commit/PR metadata, pack identity, browser,
viewport, supported timing APIs and `performance.timeOrigin`. Empty build metadata
means unknown, not current main. Pin the served build independently when testing
an unlabelled local build. Resource names omit query strings and credentials; input
records contain control IDs/event types rather than text, key values or clipboard data.

Input acknowledgment is a zero-delay task after dispatch and includes the post-handler
requested state and task-queue delay. It does not establish visible feedback. A draw is the completed
application submission, not compositor presentation. Draw revisions may advance
as dependencies arrive; only the latest interaction in a scope owns completion.
The first subsequent draw, data-ready submission and presentation proxy are separate
events. Superseded inputs, closed scopes and unfinished interactions remain explicit.
Draw attribution can be appended after acknowledgment; its `at` value retains
the original draw timestamp. Use timestamps rather than array order for durations.

Chart readiness distinguishes pending data, retained/blended refinement, a loaded
coarser fallback, requested output submission and terminal unavailable/fallback.
During a composite the scalar rendered grid/source are null; its retained, preview
and target layers are named separately. A retained identity predating recording,
or a rebased composite, is explicitly uncertified. It cannot certify fine output.
The current implementation measures the main grid/measurement, movement/candles
and cell calibration readiness; it does not certify every optional overlay's paint.

Presentation is a proxy: two sampled frames with no relevant scope motion or busy
state. Chart completion additionally requires current requested output submission
or a terminal result. Scope comes from the controlled panel or nearest workspace;
chart controls use the canvas. Opening a panel excludes optional background work
inside it. The Continuations tab and C shortcut use the study's busy scope.
Tooltips are excluded. This is not a general causal trace of every UI
event and it must not replace a case's semantic assertions or existing benchmark gates.

Native frame intervals, supported Resource/NavigationTiming, raw EventTiming
(16 ms threshold), paint entries and long tasks are retained. Buffered browser
entries can predate recording; their own timestamps distinguish them. Unsupported
metrics are marked unavailable. These samples do not establish INP, LCP, physical
display latency, CPU/GPU attribution, heap growth or a cache-cold load. Frame samples
stop when hidden by the browser; an interval crossing a hidden state is labelled and is
not a visible-frame guarantee. Collection overhead is included.

Application phases split cube/movement fetch-to-headers, body read/JSON parse and
decode. ResourceTiming supplies transport phases when the browser permits them.
Startup decoding and Continuations preparation, dependency digest, seasonal/case
calculation and bootstrap are marked separately. Phase elapsed time includes
existing cooperative yields. Unmatched phase starts mean interrupted/incomplete
work; they must not be counted as successful completion. Arithmetic, caches, reads,
motion policy and bootstrap draws are unchanged. #96 remains the cumulative
performance acceptance owner.
