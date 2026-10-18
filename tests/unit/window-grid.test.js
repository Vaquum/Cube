"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const grid = E.util.windowLevel;
const desktop = { width: 1024, height: 512, timeSpan: 1024, priceSpan: 64 };

test("joint window levels match hand-calculated square cells at desktop and phone widths", () => {
  // 2^4 * 1024/1024 = 2^1 * 512/64 = 16 px. At 256 px width, n gains two levels.
  assert.deepEqual(grid(desktop), { n: 4, m: 1 });
  assert.deepEqual(grid({ ...desktop, width: 256 }), { n: 6, m: 1 });
  assert.deepEqual(grid({ ...desktop, width: 1024 * Math.sqrt(2) }), { n: 3, m: 1 });
});

test("the base lattice permits larger square cells for a short window", () => {
  assert.deepEqual(grid({ width: 1024, height: 512, timeSpan: 16, priceSpan: 8 }), { n: 0, m: 0 });
});

test("source floors and exhausted lattice bounds constrain the nearest square", () => {
  assert.deepEqual(grid({ ...desktop, nMin: 6, mMin: 3 }), { n: 6, m: 3 });
  assert.deepEqual(grid({ width: 1024, height: 512, timeSpan: 1, priceSpan: 4096 }), { n: 0, m: 9 });
});

test("diagonal constraints take precedence and ties prefer readable density", () => {
  assert.deepEqual(grid({ ...desktop, diagonal: { a: 0, b: 0.5 } }), { n: 6, m: 3 });
  assert.equal(grid({ ...desktop, nMin: 0, mMin: 8, nMax: 2, diagonal: { a: 0, b: 0.5 } }), null);
});

test("missing plot geometry never invents a level", () => {
  for (const key of ["timeSpan", "priceSpan", "width", "height"])
    for (const value of [0, -1, NaN, Infinity]) assert.equal(grid({ ...desktop, [key]: value }), null);
});
