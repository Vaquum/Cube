# Navy and stock surfaces: before and after

Screenshots of the change that set Cube on the Vaquum surfaces (appearance `vaquum3`, the Vaquum faces and the shared Auto / Navy / Stock switch). Engineering evidence only: no human validation of the palette is claimed (`docs/operator-protocol.md`).

- `cells-before-after.png`: Cells in Delta with the Forces strip, the daily POC, prior-day levels, session VWAP, the 50 SMA, the US open and a Level at 31,500. Top: `e89f800` in the light theme, then this change on stock. Bottom: `e89f800` dark, then navy.
- `candles-before-after.png`: the same view in Candles.
- `switch-overrides-system.png`: the reader's choice holds against the system: Stock chosen on a dark system (left) and Navy chosen on a light one (right).

How they were made: both builds behind the fake cube (`tests/support/cube-fake.js`, profile `standard`, seed 7, cutoff 2026-10-20T13:30:00Z), Chromium 153 from Playwright 1.63.0, 1500 x 950 css px at device scale 1, reduced motion, each tile scaled to 60%. `e89f800` is its committed `index.html`; this change is `npm run build:tmp`. Auto follows the emulated `prefers-color-scheme`, so light gives stock and dark gives navy; the last image sets the `vq-surface` cookie.
