# Tactile flow

Cube uses the Tactile spring selected in Eight-Characters and adopted by Poise
and eightchord-com: stiffness 180, damping 20, mass 1. `src/motion.js` retains
position and velocity on reversal; completion belongs to the latest request.
Control feedback is 100 ms ease-out. Ordinary arrival travels 20 px and local
information 8 px. There are no repeating decorative animations.

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

Canvas cell morphing reuses one bounds record; no arrays or closures are allocated per cell. Intrinsic panel measurements cache by content and width, exclude measurement clones from mutation handling, and share a read phase before animation writes. Repeated state updates retain active panel targets without measuring unchanged geometry.

`node tools/benchmark_motion.mjs` compares committed baseline `912d812` with the published head using five alternating pairs per case, motion enabled, the same synthetic market seed, desktop and phone layouts. The baseline includes the integrated Shift+arrow and chart-header features from main. It measures navigation, dense Rows/Lines, Candles, rapid level reversal, inspector resizing, native disclosures, 128 captured cells, dense Cells sorting and phone sheets. Chart inputs use their canvas callback; controls and level keys use two native frame boundaries. Predeclared frame/draw/input budgets are in the runner; all samples and layout/task totals are saved to `reports/motion/performance.json`. This local guard does not certify every device or real network latency.

Closed panel interaction follows native hidden/class state through CSS `interactivity: inert`, so focus on an immediate reopen works synchronously. Browsers without that property close panels immediately. Native dialog exit transitions also require CSS inertness; closed modal controls cannot accept input.
