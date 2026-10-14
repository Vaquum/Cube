"use strict";
// Oracle: hand arithmetic for one 8 ms Euler step, and physical continuity/settling bounds.
const test = require("node:test");
const assert = require("node:assert/strict");
const Flow = require("../../src/motion.js");
test("Tactile flow uses the reference physical model and hand-computed step", () => {
  assert.deepEqual(Flow.MOTION,{stiffness:180,damping:20,mass:1,travel:20,information:8,feedback:100});
  const step=Flow.integrate(0,0,1,.008);
  assert.ok(Math.abs(step.velocity-1.44)<1e-12);
  assert.ok(Math.abs(step.position-.01152)<1e-12);
});
test("reversal retains positive momentum before turning and settles to the new target", () => {
  let position=.4,velocity=3;
  let next=Flow.integrate(position,velocity,0,.008);
  assert.ok(next.position>position,"retargeting does not discard momentum");
  for(let i=0;i<250;i++) next=Flow.integrate(next.position,next.velocity,0,.008);
  assert.ok(Math.abs(next.position)<.0008);
  assert.ok(Math.abs(next.velocity)<.008);
  assert.ok(Flow.SPRING.duration>300 && Flow.SPRING.duration<2000);
  assert.match(Flow.SPRING.easing,/^linear\(0\.00000,/);
  assert.match(Flow.SPRING.easing,/,1\.00000\)$/);
});
test("invalid motion input fails before presentation", () => {
  for(const args of [[NaN,0,1,.008],[0,Infinity,1,.008],[0,0,NaN,.008],[0,0,1,-1]]) assert.throws(()=>Flow.integrate(...args),/finite|non-negative/);
});
