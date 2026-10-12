# Human and agent exchange

The shared document is `cube-analysis@1`. It contains a sealed complete v3 scene,
validated comparison captures, captured selection measurements and optional canvas
sources. `mode` declares captured evidence or a live query. Each document has a
content digest; mutation requires resealing. Unknown schemas, unsafe members,
nonfinite data, invalid comparison support and invalid scenes reject the document.

`src/agent.js` exposes the same codec in browsers and Node. `seal`, `validate`,
`parse`, `encode`, `decode`, `text`, `link`, `compare` and `diff` share existing
scene validation, comparison validation and measurement results. Text exports
include readable context and a JSON block; importing the block loses no facts.
Captured values are observations at the stated cutoff, not historical revisions
reconstructed from the current source.

Complete integration, HTTP operations and MCP transport are being delivered in
the linked implementation issue #130. Guided canvas sequences are future design
work tracked separately in #131.
