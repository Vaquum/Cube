"use strict";
// Hand-authored readiness/ownership cases, driven by a deterministic clock.
const test = require("node:test"), assert = require("node:assert/strict");
const D = require("../../src/diagnostics.js");
function fixture(limits) {
  let time = 0, timeout = null, timers = 0;
  const recorder = D.create({ now: () => time, setTimer(fn) { timers++; timeout = fn; return 1; }, clearTimer() { timeout = null; }, limits });
  return { recorder, advance: n => time += n, expire: () => timeout(), get timers() { return timers; } };
}
const state = (revision = 1) => ({ requested: { revision, n: 4, m: 0 }, rendered: { revision, n: 4, m: 0 }, pending: false, refinement: null, error: null });
const events = (r, type) => r.export().events.filter(e => e.type === type);
test("disabled collection neither schedules work nor retains calls", () => {
  const f = fixture(), r = f.recorder;
  r.mark("ignored"); r.phase("ignored")(); r.draw(state(), 5);
  assert.equal(r.input("ol-canvas", {}), null);
  assert.equal(r.export(), null); assert.equal(f.timers, 0);
});
test("draw submission distinguishes pending refinement, fallback and terminal output", () => {
  const s = state();
  assert.equal(D.readiness(s), "requested-output-submitted");
  assert.equal(D.readiness({ ...s, refinement: "waiting" }), "pending-refinement");
  assert.equal(D.readiness({ ...s, rendered: { ...s.rendered, revision: 0 } }), "pending-data");
  assert.equal(D.readiness({ ...s, rendered: { ...s.rendered, n: 8 } }), "loaded-fallback");
  assert.equal(D.readiness({ ...s, error: ["Unavailable"] }), "terminal-fallback");
  assert.equal(D.readiness({ ...s, rendered: null, error: ["Unavailable"] }), "terminal-unavailable");
});
test("a retained preview and obsolete draw cannot complete a requested fine grid", () => {
  const f = fixture(), r = f.recorder; r.start({ build: "test" });
  const p = r.input("ol-canvas", {}); r.acknowledge(p, state(2).requested);
  const frame = chart => r.frame({ interval: 16, hidden: false, scopes: () => ({ moving: false, busy: false }), chart });
  for (const chart of [state(1), { ...state(2), refinement: "blending" }, { ...state(2), pending: true }]) { frame(chart); frame(chart); }
  assert.equal(events(r, "presentation-proxy").length, 0);
  frame(state(2)); frame(state(2));
  assert.equal(events(r, "presentation-proxy")[0].id, p.id);
});
test("data arrivals advance draw revision without losing the initiating interaction", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("ol-canvas", {}); r.acknowledge(p, state(2).requested);
  r.draw({ ...state(3), pending: true }, 4); f.advance(30); r.draw(state(4), 5);
  assert.equal(events(r, "interaction-data-ready")[0].id, p.id);
  assert.equal(events(r, "interaction-data-ready")[0].duration, 30);
  const frame = () => r.frame({ interval: 16, hidden: false, scopes: () => ({ moving: false, busy: false }), chart: state(4) });
  frame(); frame(); assert.equal(events(r, "presentation-proxy")[0].id, p.id);
});
test("new input owns completion and old-session callbacks cannot contaminate a recording", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const end = r.phase("history"), first = r.input("ol-canvas", {}), second = r.input("ol-canvas", {});
  r.acknowledge(first, state().requested); r.acknowledge(second, state(2).requested);
  r.draw(state(), 3); r.draw(state(2), 4);
  assert.deepEqual(events(r, "interaction-draw").map(e => e.id), [second.id]);
  assert.equal(events(r, "interaction-superseded")[0].id, first.id);
  r.start({ build: "next" }); end(); r.acknowledge(second, state(2).requested);
  assert.equal(events(r, "phase-end").length, 0); assert.equal(events(r, "acknowledgment").length, 0);
});
test("unrelated tooltip activity does not delay another scope, and hidden frames do not certify it", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("comparison", {}); r.acknowledge(p, state().requested);
  const frame = hidden => r.frame({ interval: 16, hidden, scopes: id => ({ moving: id === "tooltip", busy: false }), chart: { ...state(), pending: true } });
  frame(true); frame(true); assert.equal(events(r, "presentation-proxy").length, 0);
  frame(false); frame(false);
  assert.equal(events(r, "presentation-proxy")[0].scope, "comparison");
});
test("changed inspector tabs supersede the previous scope, and closed scopes cannot claim presentation", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const old = r.input("evidence", { owner: "inspector-tab" }), current = r.input("context", { owner: "inspector-tab" });
  r.acknowledge(old, state().requested); r.acknowledge(current, state().requested);
  assert.deepEqual(events(r, "acknowledgment").map(e => e.id), [current.id]);
  r.frame({ interval: 16, hidden: false, scopes: () => ({ unavailable: true }), chart: state() });
  assert.equal(events(r, "interaction-unavailable")[0].id, current.id);
  assert.equal(events(r, "presentation-proxy").length, 0);
});
test("phase elapsed time includes yields; duplicate ends and stopped callbacks are ignored", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const end = r.phase("decode", { source: "history" }); f.advance(25); end("obsolete"); end();
  assert.equal(events(r, "phase-end").length, 1); assert.equal(events(r, "phase-end")[0].duration, 25);
  const late = r.phase("late"); r.stop(); late(); assert.equal(events(r, "phase-end").length, 1);
});
test("recordings stop at the sample/time bounds and exported snapshots are independent", () => {
  const f = fixture({ events: 3, milliseconds: 20 }), r = f.recorder; r.start({});
  r.mark("one"); r.mark("two"); r.mark("overflow");
  assert.equal(r.active, false); assert.equal(r.export().events.length, 3); assert.equal(r.export().stopReason, "event-limit");
  const copy = r.export(); copy.events.length = 0; assert.equal(r.export().events.length, 3);
  r.start({}); f.expire(); assert.equal(r.active, false); assert.equal(r.export().stopReason, "time-limit");
});
