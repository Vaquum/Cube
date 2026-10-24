"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { analyze, noiseFloor, improvement } = require("../../tools/benchmark/presentation-metrics.cjs");
const protocol = { ...require("../../tools/benchmark/presentation.v1.json"), captureMs: 400, finalStabilityMs: 150 };
const pose = (x, opacity = 1, clip = 10) => [1, x, 0, 10, 10, opacity, 0, clip, clip];
const trace = rows => ({ ack: { at: 0 }, springDuration: 664, semantic: { changed: true }, channels: [],
  frames: rows.map(([at, x, alpha = 1, clip = 10]) => ({ at, poses: [pose(x, alpha, clip)], marked: at < 300 ? 1 : 0, css: 0 })) });
test("presentation uses the observed pose independently of marker clearance", () => {
  const data = trace([[0, 0], [100, 9.6], [200, 10], [250, 10], [300, 10], [350, 10], [400, 10]]);
  const result = analyze(data, protocol);
  assert.equal(result.outcome, "complete"); assert.equal(result.presentationMs, 100); assert.equal(result.markerMs, 300);
  assert.equal(result.excessMs, -564);
  for (const frame of data.frames) frame.marked = 0;
  assert.equal(analyze(data, protocol).presentationMs, 100);
});
test("retiring visuals finish when imperceptible and remain so through removal", () => {
  const data = trace([[0, 0], [100, 2, .1], [200, 4, .003], [250, 0, 0, 0], [300, 0, 0, 0], [350, 0, 0, 0], [400, 0, 0, 0]]);
  assert.equal(analyze(data, protocol).presentationMs, 200);
});
test("an unstable endpoint and an unchanged result cannot become successful zero-duration reorders", () => {
  const data = trace([[0, 0], [100, 9.6], [200, 10], [250, 10], [300, 10], [350, 12], [400, 10]]);
  assert.equal(analyze(data, protocol).outcome, "inconclusive");
  data.semantic.changed = false;
  assert.equal(analyze(data, protocol).outcome, "no-change"); assert.equal(analyze(data, protocol).presentationMs, null);
});
test("paired gains must clear the A/A floor and have corresponding work evidence", () => {
  const sample = ms => ({ outcome: "complete", presentationMs: ms, medianFrameMs: 16 });
  const floor = noiseFloor([5, 7, 12, 0, 2].map(delta => [sample(100), sample(100 + delta)]));
  assert.equal(floor.aaP95Ms, 12); assert.equal(floor.floorMs, 32);
  const pairs = [35, 40, 34, 38, 36].map(gain => [sample(200), sample(200 - gain)]);
  assert.equal(improvement(pairs, floor, false).outcome, "no-demonstrated-improvement");
  assert.equal(improvement(pairs, floor, true).outcome, "material-improvement");
  assert.equal(noiseFloor(pairs.slice(1)).outcome, "inconclusive");
});

test("declared comparison inputs survive the real storage boundary and induce a real basis reorder", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const { fixture, definition } = await import("../../tools/benchmark/presentation-cases.mjs");
  const window = { localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; } } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/state.js"), "utf8"), { window, console });
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/comparison.js"), "utf8"), { window, console });
  for (const id of ["comparison-sort", "comparison-basis-reorder", "comparison-membership"]) {
    const model = fixture(definition({ id, captures: id === "comparison-membership" ? 128 : 24 }));
    assert.equal(window.explorerState.comparison.validate(model).ok, true, id);
    if (id !== "comparison-basis-reorder") continue;
    const amount = window.explorerComparison.analyze(model.captures, { basis: "amount", sort: model.sort });
    const intensity = window.explorerComparison.analyze(model.captures, { basis: "intensity", sort: model.sort });
    assert.notDeepEqual(Array.from(amount.ordered, c => c.id), Array.from(intensity.ordered, c => c.id));
    assert.deepEqual(Array.from(intensity.ordered.slice(0, 3), c => c.id), ["bench-cell-23", "bench-cell-19", "bench-cell-15"]);
  }
});
