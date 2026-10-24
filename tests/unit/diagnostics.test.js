"use strict";
// Hand-authored readiness/ownership cases, driven by a deterministic clock.
const test = require("node:test"), assert = require("node:assert/strict");
const D = require("../../src/diagnostics.js");
function fixture(limits) {
  let time = 0, timeout = null, timers = 0;
  const recorder = D.create({ now: () => time, setTimer(fn) { timers++; timeout = fn; return 1; }, clearTimer() { timeout = null; }, limits });
  return { recorder, advance: n => time += n, expire: () => timeout(), get timers() { return timers; } };
}
const state = (revision = 1, intent = revision) => ({ requested: { intent, revision, n: 4, m: 0 }, rendered: { intent, revision, n: 4, m: 0 }, pending: false, refinement: null, error: null });
const events = (r, type) => r.export().events.filter(e => e.type === type);
test("disabled collection neither schedules work nor retains calls", () => {
  const f = fixture(), r = f.recorder;
  r.mark("ignored"); r.phase("ignored")(); r.draw(state(), 5);
  assert.equal(r.input("ol-canvas", {}), null);
  assert.equal(r.export(), null); assert.equal(f.timers, 0);
});
test("draw submission distinguishes pending refinement, fallback and terminal output", () => {
  const s = state();
  assert.equal(D.readiness(s), "target-output-submitted");
  assert.equal(D.readiness({ ...s, refinement: "waiting" }), "pending-refinement");
  assert.equal(D.readiness({ ...s, rendered: { ...s.rendered, intent: 0 } }), "pending-data");
  assert.equal(D.readiness({ ...s, rendered: { ...s.rendered, n: 8 } }), "stalled");
  assert.equal(D.readiness({ ...s, movement: { state: "cube", updating: true } }), "pending-data");
  assert.equal(D.readiness({ ...s, movement: { state: "pending", updating: false } }), "pending-data");
  assert.equal(D.readiness({ ...s, movement: { state: "cube", updating: false } }), "target-output-submitted");
  assert.equal(D.readiness({ ...s, error: ["Unavailable"] }), "terminal-fallback");
  assert.equal(D.readiness({ ...s, rendered: null, error: ["Unavailable"] }), "terminal-unavailable");
});
test("a retained preview and obsolete draw cannot complete a requested fine grid", () => {
  const f = fixture(), r = f.recorder; r.start({ build: "test" });
  const p = r.input("ol-canvas", {}); r.acknowledge(p, state(2).requested);
  const frame = chart => r.frame({ interval: 16, hidden: false, scopes: () => ({ moving: false, busy: false }), chart });
  for (const chart of [{ ...state(2), rendered: state(1).rendered }, { ...state(2), refinement: "blending" }, { ...state(2), pending: true }]) { frame(chart); frame(chart); }
  assert.equal(events(r, "presentation-proxy").length, 0);
  frame(state(2)); frame(state(2));
  assert.equal(events(r, "presentation-proxy")[0].id, p.id);
});
test("data arrivals advance draw revision without losing the initiating interaction", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("ol-canvas", {}); r.acknowledge(p, state(2).requested);
  r.draw({ ...state(3, 2), pending: true }, 4); f.advance(30); r.draw(state(4, 2), 5);
  assert.equal(events(r, "interaction-data-ready")[0].id, p.id);
  assert.equal(events(r, "interaction-data-ready")[0].duration, 30);
  const frame = () => r.frame({ interval: 16, hidden: false, scopes: () => ({ moving: false, busy: false }), chart: state(4, 2) });
  frame(); frame(); assert.equal(events(r, "presentation-proxy")[0].id, p.id);
});
test("draws before acknowledgment retain their original timing and ignore obsolete requested revisions", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("ol-canvas", {});
  f.advance(5); r.draw(state(1), 2); f.advance(5); r.draw(state(2), 3);
  f.advance(20); r.acknowledge(p, state(2).requested);
  for (const type of ["interaction-draw", "interaction-data-ready"]) {
    assert.equal(events(r, type).length, 1); assert.equal(events(r, type)[0].id, p.id);
    assert.equal(events(r, type)[0].at, 10); assert.equal(events(r, type)[0].duration, 10);
  }
  const frame = () => r.frame({ interval: 16, hidden: false, scopes: () => ({ moving: false, busy: false }), chart: state(2) });
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
test("a limit hit during supersession cannot leave an orphan in a restarted recording", () => {
  const f = fixture({ events: 3, milliseconds: 100 }), r = f.recorder; r.start({});
  const old = r.input("ol-canvas", {}); r.acknowledge(old, state().requested);
  assert.equal(r.input("ol-canvas", {}), null); assert.equal(r.active, false);
  r.start({}); r.stop();
  assert.deepEqual(r.export().unfinishedInteractions, []);
  assert.equal(events(r, "input").length, 0);
});
test("semantic intent replacement supersedes A even when a later request returns to A's grid", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("ol-canvas", { expectsRequest: true }), native = { eventPhase: 1 };
  r.dispatch(p, native); r.request(state(1).requested); native.eventPhase = 0;
  r.acknowledge(p, state(1).requested);
  // Same n/m, different camera or pack: callers assign a new semantic intent.
  r.request({ ...state(2).requested, camera: [10,20], pack: "B" });
  r.request({ ...state(3).requested, camera: [0,10], pack: "A" });
  r.draw(state(3), 1);
  for (let i = 0; i < 3; i++) r.frame({ interval: 16, hidden: false, scopes: () => ({}), chart: state(3) });
  assert.equal(events(r, "interaction-superseded")[0].id, p.id);
  assert.equal(events(r, "interaction-data-ready").length, 0);
  assert.equal(events(r, "presentation-proxy").length, 0);
  assert.equal(r.owner(), null, "ended native dispatch cannot own unrelated work");
});
test("owned asynchronous action cannot complete on the preceding quiet chart", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("ol-canvas", { expectsRequest: true }), native = { eventPhase: 1 };
  r.dispatch(p, native); assert.equal(r.beginAction("apply-view"), p); native.eventPhase = 0;
  r.acknowledge(p, state(1).requested);
  const frame = chart => r.frame({ interval: 16, hidden: false, scopes: () => ({}), chart });
  r.draw(state(1), 1); frame(state(1)); frame(state(1));
  assert.equal(events(r, "presentation-proxy").length, 0);
  r.request(state(2).requested, p); r.draw(state(2), 1); r.endAction(p, true);
  frame(state(2)); frame(state(2));
  assert.equal(events(r, "interaction-data-ready").at(-1).id, p.id);
  assert.equal(events(r, "presentation-proxy").at(-1).id, p.id);
  const rejected = r.input("ol-canvas", { expectsRequest: true });
  r.dispatch(rejected, { eventPhase: 1 }); r.beginAction("apply-view"); r.endAction(rejected, false);
  assert.equal(events(r, "interaction-rejected")[0].id, rejected.id);
});
test("achievable target, unexplained gap, failure priority and expanded comparison remain distinct", () => {
  const chart = { ...state(), requested: { ...state().requested, n: 0 }, target: { n: 4, m: 0, reason: "tile-column-cap" } };
  assert.equal(D.readiness(chart), "target-output-submitted");
  assert.equal(D.readiness({ ...chart, rendered: { ...chart.rendered, n: 9 } }), "stalled");
  assert.equal(D.readiness({ ...chart, rendered: { ...chart.rendered, n: 9 }, fallbackReason: "recorded-snapshot-resolution-or-coverage" }), "terminal-fallback");
  assert.equal(D.readiness({ ...chart, pending: true, refinement: "waiting", error: ["tile 503"] }), "terminal-fallback");
  assert.equal(D.readiness({ ...chart, rendered: null, pending: true, error: ["startup decode failed"] }), "terminal-unavailable");
  assert.equal(D.readiness({ ...chart, applicable: false, pending: true }), "not-applicable");
});
test("intended close waits for acknowledgment and relevant motion then completes as closed", () => {
  const f = fixture(), r = f.recorder; r.start({});
  const p = r.input("ol-drawer-body", {});
  const frame = moving => r.frame({ interval: 16, hidden: false, scopes: () => ({ closed: true, moving }), chart: state() });
  frame(false); assert.equal(events(r, "interaction-unavailable").length, 0);
  r.acknowledge(p, state().requested, { open: false });
  frame(true); frame(false); assert.equal(events(r, "presentation-proxy").length, 0);
  frame(false); assert.equal(events(r, "presentation-proxy")[0].status, "scope-closed");
});
test("compact UTF-8 byte cap includes multibyte metadata, final fields and incomplete owners", () => {
  const f = fixture({ bytes: 4096 }), r = f.recorder; r.start({ build: "test" });
  const p = r.input("ol-canvas", {});
  while (r.active) r.mark("sample", { text: "漢".repeat(100) });
  const report = r.export();
  assert.equal(report.stopReason, "byte-limit"); assert.equal(report.truncated, true);
  assert.deepEqual(report.unfinishedInteractions, [p.id]);
  assert.equal(report.unfinishedState, "ended-incomplete");
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 4096);
  r.start({ oversized: "漢".repeat(3000) });
  assert.equal(r.active, false); assert.equal(r.export().stopReason, "byte-limit");
  assert.ok(Buffer.byteLength(JSON.stringify(r.export())) <= 4096);
});
test("native paint and long-frame fields retain actual support, raw values and bounded script attribution", () => {
  const paint = D.timing({ entryType: "paint", name: "first-paint", startTime: 10, duration: 0, paintTime: 9, presentationTime: null });
  assert.equal(paint.paintTime, 9); assert.equal(paint.presentationTime, null);
  assert.equal(paint.fieldSupport.presentationTime, true); assert.equal(paint.fieldSupport.renderStart, false);
  const frame = D.timing({ entryType: "long-animation-frame", name: "long-animation-frame", startTime: 10, duration: 75,
    blockingDuration: 24, renderStart: 60, scripts: Array.from({ length: 20 }, () => ({ duration: 30, sourceURL: "https://example.com/app.js?token=private", sourceFunctionName: "work", forcedStyleAndLayoutDuration: 3 })) });
  assert.equal(frame.blockingDuration, 24); assert.equal(frame.scripts.length, 16); assert.equal(frame.omittedScripts, 4);
  assert.equal(frame.scripts[0].sourcePath, "/app.js"); assert.equal(frame.scripts[0].forcedStyleAndLayoutDuration, 3);
  assert.equal(JSON.stringify(frame).includes("private"), false);
});
test("mounted recorder removes measurement listeners, observers, frames and acknowledgment timers when stopped", () => {
  const vm = require("node:vm"), fs = require("node:fs"), timers = new Map(), frames = new Map(), observers = [];
  class Node {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type,set); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    get count() { return [...this.listeners.values()].reduce((n,set) => n + set.size,0); }
    click() { for (const fn of this.listeners.get("click") ?? []) fn(); }
  }
  const root = new Node(), document = new Node(), controls = Object.fromEntries(["start","stop","export","reload","output","status"].map(id => [id,new Node()]));
  root.querySelector = selector => controls[selector.replace("#ol-diagnostics-","")];
  let serial = 0;
  class Observer {
    static supportedEntryTypes = ["resource","longtask","long-animation-frame","event","paint"];
    constructor() { this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    takeRecords() { return []; }
  }
  const context = vm.createContext({ TextEncoder, URL, document, Element:Node, PerformanceObserver:Observer,
    performance:{ now:() => 0, getEntriesByType:() => [] }, navigator:{ userAgent:"test" }, innerWidth:679, innerHeight:1111, devicePixelRatio:1,
    sessionStorage:{ getItem:() => null }, setTimeout:fn => { const id = ++serial; timers.set(id,fn); return id; }, clearTimeout:id => timers.delete(id),
    requestAnimationFrame:fn => { const id = ++serial; frames.set(id,fn); return id; }, cancelAnimationFrame:id => frames.delete(id) });
  vm.runInContext(fs.readFileSync(require.resolve("../../src/diagnostics.js"),"utf8"),context);
  context.explorerDiagnostics.mount({ root, requested:() => state().requested, snapshot:() => state(), identity:() => ({}), download:() => {} });
  assert.equal(root.count,0); assert.equal(document.count,0); assert.equal(timers.size,0); assert.equal(frames.size,0); assert.equal(observers.length,0);
  controls.start.click(); assert.ok(root.count > 0); assert.equal(document.count,1); assert.equal(frames.size,1); assert.equal(timers.size,1);
  assert.equal(observers.filter(o => o.connected).length,5);
  controls.stop.click(); assert.equal(root.count,0); assert.equal(document.count,0); assert.equal(frames.size,0); assert.equal(timers.size,0);
  assert.equal(observers.filter(o => o.connected).length,0);
  controls.start.click(); controls.export.click();
  assert.equal(root.count,0); assert.equal(document.count,0); assert.equal(frames.size,0); assert.equal(timers.size,0);
  controls.start.click(); const expire = [...timers.values()][0]; expire();
  assert.equal(root.count,0); assert.equal(document.count,0); assert.equal(frames.size,0); assert.equal(timers.size,0);
});
