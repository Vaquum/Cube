# Tactile flow

Cube uses the Tactile spring selected in Eight-Characters and adopted by Poise
and eightchord-com: stiffness 180, damping 20, mass 1. `src/motion.js` retains
position and velocity on reversal; completion belongs to the latest request.
Control feedback is 100 ms ease-out. Ordinary arrival travels 20 px and local
information 8 px. There are no repeating decorative animations.

Startup status uses a bounded, scrollable row outside the plot while a message
is active, including in expanded Compare. An idle chart reclaims that row.
Status-only resizing does not change Auto resolution. Visibility changes wait
for an active drawing gesture to commit or cancel before resizing its surface.
Controls start transparent
before the first paint; the chart enters in place through the same spring after
its first calibrated or terminal frame. Calibration timing and market values
remain direct, including on refresh. Reduced motion presents the frame immediately.

Panel width and drawer height follow the shared spring while canvas coordinates
remain native to each presented size. Resize grips take over from presented
geometry. Popovers and the phone sheet retain inert departing content; logical
close and focus restoration happen immediately. Native dialogs keep native
modality, cancellation and focus; supporting browsers retain their visual exit.
Disclosures resize intrinsic content and release temporary dimensions afterward.

Cells, comparison, cases, lines, views, histories, drawings and rallies retain
semantic actors across structural updates. Arrivals, departures and reorders
share the same spring. Numeric text, market mappings and quantitative miniatures
update directly. Focused native fields retain drafts, selections and composition.
Retiring visuals have no IDs, live controls or accessibility ownership, and keep
their pre-removal clipping and inherited opacity.

The canvas level morph shares the spring and retains the presented level
geometry during reversal. Camera commands, pan, zoom, pinch, selection, drawing,
replay stepping and live data remain authoritative and immediate. Replay speeds,
hover intent, settle/calibration clocks, query debounce and polling keep their
operational timing. Motion never generates intermediate market values.

Volume resolution and time-menu changes retain the previous coloured field
until the new grid has its own coherent calibration. Subdivision opens or closes
seams inside parent footprints, then reveals the destination's measured colours.
Temporary colour interpolation is presentation only; readouts stay exact and
the settled frame uses the native renderer. Reversal takes the presented raster.
Preparation is bounded to 8,192 tiles; larger changes use retained raster layers.
Flat geometry and cached colour pairs avoid per-cell lookup/allocation during
animation. Three reusable surfaces retain at most two million pixels each.
Pending data does not keep an idle frame loop alive. Loading-status resizing
retains the field through the new geometry. Direct navigation, mode changes and
reduced motion release presentation ownership. Inputs before the first paint
retain the original source; they never capture an unpainted temporary surface.

Timeframe choices fit the destination prices with the existing Fit margin,
completing after pending bars or finer tiles arrive. The time
change and price fit share one history entry. New navigation cancels an obsolete
fit, and whole-window changes release the previous cell morph before painting.

Automatic timeframe grids choose time and price levels together after the price
fit. The closest available cell aspect ratio wins; equally square grids choose
the geometric mean nearest 12 CSS pixels. The rule uses the actual plot size,
respects source resolution, tile capacity and the empirical diagonal, and runs
again after destination data or a layout change. Base resolution can require
larger cells in short windows. Explicit grid locks survive timeframe changes;
ordinary free-camera navigation retains its existing density hysteresis.

Reference guidance uses bounded scrolling that follows the live target and
yields to wheel, pointer, touch and keyboard input. Tall targets settle when
covering the viewport. Native scrolling and input behavior remain direct.

Reduced motion settles spatial presentation and removes feedback delays. Resize,
printing, hidden documents and page departure settle non-scroll actors and
release temporary styles. Hidden documents and departure cancel guided scrolling
at its presented position. Theme and typography apply directly.

## Interaction coverage

The 75 grouped families inventoried on 14 October 2026 identify surfaces rather
than independent animations. This table covers the full tracking issue #136.

| Families | Treatment |
| --- | --- |
| M001–M003 | Shared spring replaces the linear grid morph and arrow rotations. |
| M004–M015 | Startup fades; camera commands and direct navigation retain their semantics. |
| M016–M030 | Level changes share continuous morphing; lens, hover, selection, readouts and market overlays follow input and data directly. |
| M031–M045 | Inspector/drawer geometry, sheet/popover visibility, disclosures and native dialogs share presentation; logical state and focus remain immediate. |
| M046–M063 | Retained collection actors, structural layout and inert departures; authoritative values and operation status remain immediate. |
| M064–M075 | Replay/live semantics remain direct; reference content and guided scrolling share flow; intent clocks and all lifecycle boundaries remain explicit. |

## Verification

`tests/unit/motion.test.js` uses hand-computed integration and physical reversal
and settling bounds. `tests/browser/tactile-flow.spec.js` checks actual inspector
reversal, retained table controls and values, logical popover close, native dialog
focus, preference/print cleanup and scrolling interruption. Existing help-motion,
replay, lens, inspection and drawing suites retain their independent functional
oracles. Build parity and required CI validate the committed standalone page.

## UX performance gate

Canvas cell morphing reuses one bounds record; no arrays or closures are allocated per cell. Intrinsic panel measurements cache by content and width, exclude measurement clones from mutation handling, and share a read phase before animation writes. Repeated state updates retain active panel targets without measuring unchanged geometry. Collection layout reads every destination before its first style write and animates only actors intersecting the old or new clipped viewport. Table actor lookup is linear.

`node tools/benchmark_motion.mjs` compares committed baseline `f860aeb` with the published head using five alternating pairs per case, motion enabled, the same synthetic market seed, desktop and phone layouts. The baseline includes the integrated Shift+arrow, chart-header and developing POC trail features from main. It measures navigation, dense Rows/Lines, Candles, rapid level reversal, inspector resizing, native disclosures, 128 captured cells, dense Cells sorting and phone sheets. Chart inputs use their canvas callback; controls and level keys use two native frame boundaries. Predeclared frame/draw/input budgets are in the runner; all samples and layout/task totals are saved to `reports/motion/performance.json`. This local guard does not certify every device or real network latency.

Closed panel interaction follows native hidden/class state through CSS `interactivity: inert`, so focus on an immediate reopen works synchronously. Browsers without that property close panels immediately. Native dialog exit transitions also require CSS inertness; closed modal controls cannot accept input.
