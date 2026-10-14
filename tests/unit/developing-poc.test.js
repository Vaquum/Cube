"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc.js");
const trail = E.measure.developingPoc;
test("cumulative quote POC migrates by prefix, with lower rows winning exact ties", () => {
  const cells = [{ c: 0, r: 200, v: 25000 }, { c: 1, r: 201, v: 50250 }, { c: 2, r: 200, v: 25250 }, { c: 3, r: 201, v: 25125 }];
  assert.deepEqual(trail(cells, { n: 4, start: 0, end: 64 }), [
    [16, 25062.5, 25000, 25000], [32, 25187.5, 75250, 50250],
    [48, 25062.5, 100500, 50250], [64, 25187.5, 125625, 75375],
  ]);
  assert.deepEqual(trail(cells, { n: 4, start: 0, end: 32 }), trail(cells, { n: 4, start: 0, end: 64 }).slice(0, 2));
  assert.deepEqual(trail([...cells].reverse(), { n: 4, start: 0, end: 64 }), trail(cells, { n: 4, start: 0, end: 64 }));
});
test("each UTC day resets; zero volume makes no POC and empty intervals hold the observed level", () => {
  assert.deepEqual(trail([{ c: 0, r: 200, v: 0 }], { n: 4, start: 0, end: 32 }), []);
  assert.deepEqual(trail([{ c: 0, r: 200, v: 10 }], { n: 4, start: 0, end: 32 }), [[16, 25062.5, 10, 10], [32, 25062.5, 10, 10]]);
  assert.deepEqual(trail([{ c: 0, r: 200, v: 1000 }, { c: 96, r: 198, v: 10 }], { n: 4, start: 1536, end: 1552 }), [[1552, 24812.5, 10, 10]]);
});
test("live partial endpoint is explicit; completed samples exclude unsupported future volume", () => {
  const cells = [{ c: 0, r: 200, v: 10 }, { c: 1, r: 201, v: 20 }];
  assert.deepEqual(trail(cells, { n: 4, start: 0, end: 24 }), [[16, 25062.5, 10, 10], [24, 25062.5, 10, 10]]);
  assert.deepEqual(trail(cells, { n: 4, start: 0, end: 24, partial: true }), [[16, 25062.5, 10, 10], [24, 25187.5, 30, 20]]);
  assert.deepEqual(trail([{ c: 4, r: 200, v: 10 }], { n: 0, start: 0, end: 5.5, partial: true }), [[5.5, 25062.5, 10, 10]]);
});
test("compensated cumulative sums retain small volumes and reject unsupported inputs", () => {
  const points = trail([{ c: 0, r: 200, v: 1e16 }, { c: 1, r: 200, v: 1 }, { c: 2, r: 200, v: 1 }], { n: 4, start: 0, end: 48 });
  assert.equal(points.at(-1)[2], 10000000000000002);
  for (const spec of [{ n: 5, start: 0, end: 16 }, { n: 4, start: 1, end: 16 }, { n: 4, start: 0, end: 1600 }]) assert.throws(() => trail([], spec));
  assert.throws(() => trail([{ c: 0, r: 0, v: NaN }], { n: 4, start: 0, end: 16 }));
});
