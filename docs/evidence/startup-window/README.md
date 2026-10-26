# Startup and window response investigation, 26 October 2026

Production observations use the user's existing in-app browser on their machine
and connection. No additional browser connection or local browser process was
used. The page's opt-in recorder retained native navigation/resource/EventTiming,
long-task and animation-frame entries plus application phases. These are
diagnostics, not a Core Web Vitals or physical display certificate.

## Baseline

- `updated-d0fbdd5-reload.json.gz`: deployed `d0fbdd5`. Navigation response began
  at 148 ms but finished at 27,828 ms: 1,517,279 encoded / 3,470,355 decoded bytes.
  The application recorder could only start at 27,859 ms, after the inline
  application arrived. Buffered resource entries preserve that download; the
  navigation entry was initially incomplete and its final fields are retained
  in the subsequent sweep. Recent-data decoding itself took 52 ms.
- `updated-d0fbdd5-window-sweep.json.gz`: same build, fresh recording, no recording
  truncation. Seven-day, 30-day and 90-day changes acknowledged input in 34, 36
  and 33 ms. Target-output presentation proxies were 1,499, 1,605 and 1,422 ms.
  Their data arrived 752, 884 and 690 ms after input; each then waited another
  approximately 700 ms even though the requested camera was unchanged. Source
  inspection found an independent grid spring after data arrival as well as an
  unconditional camera restart. A
  cached 24-hour change took 724 ms including its intended camera motion.
- `old-tab-61175f2.json.gz`: the previously open 24 October build, about 31 hours
  old, reported server timeouts and a pending update. Its observed 24-hour and
  seven-day changes were approximately 720 ms. This does not reproduce every
  user-reported multi-second interaction.

The reload and old-tab captures reached the recorder's 120-second limit and
are explicitly marked truncated. The cited completed transitions are inside
the retained intervals. Native buffered events pre-dating a recording are not
current test samples. Several long tasks during the later sweep include recorder
export, open panel and observer work; source attribution is not a CPU profile.
No broad claim of a render-thread root cause is made from those entries.

## Change and validation

Live delivery separates content-addressed, privately cached application/style
assets from current market data, including vendored D3 in the application asset.
A small two-day, 15-minute measured source is summed from the same held recent
pack; the incomplete first parent is excluded and the open last parent retains
its actual support. Full history, recent and reference archives then load as
binary gzip responses at low network priority. Their values and normal pack/delta
protocol are unchanged. Portable `index.html` remains self-contained.

`delivery-bytes.json` compares byte sizes using the production pack captured from
the original page. The initial live document falls from the observed 1.52 MB
transfer to about 32 KB gzip; application and stylesheet bytes are reusable.
The first uncached application download remains substantial and must be reported
separately from a cached reload. Byte reduction alone is not a latency result.

Window selection dispatches its required read directly, without the continuous
gesture's 200 ms debounce. Window camera and grid share one timeline, so late
data does not start a second full spring. An unchanged resolved price fit
retains the existing camera animation; changed fits keep their motion.

Unit checks use independently specified quantities/support and exercise the real
HTML/assets HTTP handler, gzip/identity/HEAD, conditional requests and preservation
of the portable page. Browser checks use the production delivery handler against
the existing synthetic cube, hold all archives while the first calibrated Volume
and Path charts
and window controls work, verify reload cache reuse, and hold the debounce timer
while checking immediate window dispatch and a single camera animation.
An archive completion is checked against its original pack, generation and
metadata; a replacement whole pack owns all subsequent source writes. A gated
refresh regression checks that releasing old archives cannot overwrite it.

The browser probe separately tracks local export compression without inventing
a subsequent chart-paint obligation. Its synthetic self-check verifies both that
compression/cloning leaves a painted frame valid and that decompressed data still
requires a later draw. This addresses an idle-frame dependency exposed in the
recorded-selection refresh test; production does not add a redraw for an export.

Production remeasurement and complete CI/review status belong to the resulting
pull request. This evidence does not close cumulative acceptance issue #96.

## Controlled side-panel check

`controlled-cached-startup.json.gz` uses the production HTTP delivery handler
and the standard synthetic cube on localhost in the same side-panel tab, with
archives independently withheld. On candidate `46bb66b`, application and CSS
resource transfers were both zero on reload. The requested seven-day data was
submitted at 427 ms from navigation, while the first archive was still held.
This includes local transport and a previously stored valid calibration; it is
not production network latency or a first-visit result. The startup source was
decoded at 151 ms. The recording later reached its 120-second cap and includes
archive-gate timeouts; its early completed readiness remains retained.

## Controlled delayed window answer

The two untruncated `paired-*-900ms.json.gz` captures compare the deployed
`d0fbdd5` application with implementation `ddca20f` in the same existing side-panel
tab. Both use the same standard synthetic cube, pack, 351 × 575 viewport, seven-day
destination, resolution and fitted bounds. Only `/cube/query` is given a 900 ms
fixture delay, after each startup has completed. The candidate uses the real
production delivery handler; the baseline uses its original portable application
through the existing fake server. No browser instrumentation is injected; inputs
and exports use the page's recorder. Portable builds have empty deployment
attestation fields, so source file hashes and commits are retained explicitly in
`paired-summary.json`, together with the fixture identity and raw request log.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Input acknowledgment | 22.7 ms | 21.2 ms |
| Requested data applied after input | 1,138.2 ms | 926.5 ms |
| Applied data to target output submitted | 780.2 ms | 113.7 ms |
| Input to target output presentation proxy | 1,950.3 ms | 1,069.0 ms |

This single pair demonstrates removal of the debounce and second full settling
period under the declared delayed answer. It is not a confidence interval, a
physical display measurement or a production network result. Changed price fits
retain their necessary camera motion. The complete browser suite remains the
correctness gate for interruption, calibration, source replacement and reduced
motion.
