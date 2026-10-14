"use strict";
// Oracle: a control's frame witness answers its event; a later hidden-chart
// callback is unrelated. Hand-authored event intervals pin that separation.
const test = require('node:test');
const assert = require('node:assert/strict');
test('control latency excludes unrelated hidden-chart events', async () => {
  const { inputSamples } = await import('../../tools/benchmark/motion-metrics.mjs');
  assert.deepEqual(inputSamples('comparison', [1550], [33, 34]), [33, 34]);
  assert.deepEqual(inputSamples('levels', [], [17]), [17]);
  assert.deepEqual(inputSamples('navigate', [28, 29], [40]), [28, 29]);
});
test('a missing or invalid witness cannot pass the UX guard', async () => {
  const { inputSamples } = await import('../../tools/benchmark/motion-metrics.mjs');
  assert.throws(() => inputSamples('comparison', [1500], []), /Missing/);
  assert.throws(() => inputSamples('navigate', [NaN], [33]), /invalid/);
});
