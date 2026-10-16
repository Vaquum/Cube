"use strict";
// Oracles: Mill's /discover answers on real 1-hour bars, recorded from its endpoint (tests/fixtures/features/*.json), and
// a manifest YAML that PyYAML reads back as exactly the recorded manifest and Limen's validator accepts (both checked with
// limen 3.15.2 when it was recorded).
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const api = require("../../src/features.js");
const events = require("../fixtures/features/events.json"), description = require("../fixtures/features/description.json");
const research = api.researchSpan({data_window: {start: "2024-01-01", end: "2026-05-15"}});
const at = (s) => Date.parse(s), w = (a, b) => ({startMs: at(a), endMs: at(b)});

test("Mill's research window is half open and includes its last day", () => {
  assert.deepEqual(research, [at("2024-01-01T00:00:00Z"), at("2026-05-16T00:00:00Z")]);
  assert.equal(api.researchSpan(null), null);
});

test("a request never reaches outside Mill's research window or past the chart's cutoff", () => {
  const base = {bar: "1h_time_bars", mode: "inside", lead: 4, pool: {kind: "catalog"}, research};
  const edge = at("2025-06-01T00:00:00Z"), view = [at("2025-05-20T00:00:00Z"), at("2025-06-10T00:00:00Z")];
  const marked = [w("2025-05-25T00:00:00Z", "2025-05-25T12:00:00Z")];
  assert.match(api.request({...base, windows: [w("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z")], against: "research", view, edge: Infinity}).error,
    /outside Mill's research window, 2024-01-01 to 2026-05-15/);
  // Against the whole window, the compared span ends at the cutoff; the returned series covers the view inside it.
  const whole = api.request({...base, windows: marked, against: "research", view, edge}).body;
  assert.deepEqual(whole.context, {start: "2024-01-01T00:00:00Z", end: "2025-06-01T00:00:00Z"});
  assert.deepEqual(whole.display, {start: "2025-05-20T00:00:00Z", end: "2025-06-01T00:00:00Z"});
  assert.deepEqual(whole.windows, [{start: "2025-05-25T00:00:00Z", end: "2025-05-25T12:00:00Z"}]);
  assert.deepEqual(api.request({...base, windows: marked, against: "view", view, edge}).body.context, {start: "2025-05-20T00:00:00Z", end: "2025-06-01T00:00:00Z"});
  // A window wholly after the cutoff has no bar to mark, and no window is no request.
  assert.match(api.request({...base, windows: [w("2025-06-05T00:00:00Z", "2025-06-06T00:00:00Z")], against: "research", view, edge}).error, /No marked window lies inside/);
  assert.match(api.request({...base, windows: [], against: "research", view, edge}).error, /Add at least one window/);
  assert.match(api.request({...base, windows: marked, against: "view", view: [at("2026-07-01T00:00:00Z"), at("2026-08-01T00:00:00Z")], edge: Infinity}).error,
    /The visible time lies outside Mill's research window/);
});

test("a leader's points sit at their buckets' ends, and a partial last bucket at the display's end", () => {
  const series = events.candidates[0].series, end = at("2025-03-08T00:00:00Z");
  const points = api.points(series, end), first = series.values.findIndex((v) => v !== null);
  assert.equal(points.length, series.values.filter((v) => v !== null).length);
  assert.equal(points[0].ms, series.t0 + (first + 1) * series.step_ms);
  assert.ok(points.every((p, i) => i === 0 || p.ms > points[i - 1].ms) && points[points.length - 1].ms <= end);
  assert.deepEqual(api.points({t0: 0, step_ms: 10, bucket_bars: 2, values: [1, null, 3]}, 25), [{ms: 10, value: 1}, {ms: 25, value: 3}]);
  assert.deepEqual(api.points(null, 0), []);
});

test("the chance line says what the shifted windows can and cannot show", () => {
  assert.match(api.chanceText(events), /^Across 8593 shifted labelings, a column is beyond chance when it separates by more than 0\.171,/);
  assert.match(api.chanceText(events), /A column defined on fewer than 30 windows has no interval\.$/);
  assert.match(api.chanceText(description), /^One window describes, it does not test: /);
  assert.equal(api.chanceText({...description, chance: {...description.chance, shifts: 2, critical: null}}),
    "One window describes, it does not test: a slow level separates any contiguous window from its surroundings. 2 shifted labelings are too few for any column to be beyond chance.");
});

test("a fitted rule copies as the YAML that reads back as Mill's manifest", () => {
  const golden = fs.readFileSync(path.join(__dirname, "../fixtures/features/manifest.yaml"), "utf8");
  assert.equal(api.manifestYaml(events.candidates[0].rule.manifest), golden);
});

test("YAML scalars keep their types: exponent floats, quoted look-alikes, plain names and empty collections", () => {
  assert.equal(api.manifestYaml({a: 1e-7, b: 1e21, c: 2.5, d: "yes", e: "2024-01-01", f: "plain_name", g: null, h: true, i: [], j: {}, k: "{threshold}"}),
    'a: 1.0e-7\nb: 1.0e+21\nc: 2.5\nd: "yes"\ne: "2024-01-01"\nf: plain_name\ng: null\nh: true\ni: []\nj: {}\nk: "{threshold}"\n');
  // Keys follow the scalar rule, and a list or map inside a list is a nested block.
  assert.equal(api.manifestYaml({on: [[1, 2], [], {x: 1, y: [3]}, {}]}), '"on":\n  - - 1\n    - 2\n  - []\n  - x: 1\n    "y":\n      - 3\n  - {}\n');
});

// The controller, on a minimal DOM: the panel's elements by id, Mill as a stubbed fetch that answers when told to, and the recorded
// answer above. Oracles: the requests the controller sends and the state it leaves on the panel's elements.
class Element {
  constructor(tag, id = "") { Object.assign(this, {tagName: tag.toUpperCase(), id, children: [], parent: null, dataset: {}, attributes: {}, listeners: {}, hidden: false, disabled: false, textContent: "", value: ""}); }
  append(...nodes) { for (const node of nodes) for (const child of node.fragment ? node.children : [node]) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const ids = selector.startsWith("#") ? [selector.slice(1)] : null, tags = selector.split(",").map((s) => s.trim().toUpperCase());
    return this.all().filter((e) => ids ? e.id === ids[0] : tags.includes(e.tagName));
  }
}
function panel() {
  const root = new Element("div"), form = new Element("form", "ol-features-form");
  const field = (tag, name, value = "") => Object.assign(new Element(tag, "ol-features-" + name), {value});
  form.append(field("select", "bar", "1h_time_bars"), field("select", "mode", "inside"), field("label", "lead-label"), field("input", "lead", "4"),
    field("select", "against", "research"), field("select", "pool", "catalog"), field("button", "add"), field("button", "find"), field("button", "cancel"));
  root.append(form);
  for (const name of ["status", "results", "summary", "chance", "rows", "detail", "detail-text", "similar", "copy", "unpreview", "yaml", "count", "clear-windows", "windows"]) root.append(field(name === "rows" ? "tbody" : "div", name));
  return root;
}
function mill(answers = {}) {
  const calls = [], waiting = [];
  globalThis.fetch = (path, options) => new Promise((resolve) => {
    calls.push({path, body: options.body ? JSON.parse(options.body) : null});
    const text = answers[path] ?? JSON.stringify(path.endsWith("/app-config") ? {data_window: {start: "2024-01-01", end: "2026-05-15"}, views: []} : events);
    waiting.push(() => resolve({ok: true, status: 200, text: async () => text}));
  });
  const next = async () => { waiting.shift()(); await new Promise((r) => setTimeout(r, 0)); };
  return {calls, next, answer: async () => { while (waiting.length) await next(); }};
}
function controller(root, edgeMs = () => at("2026-09-24T00:00:00Z")) {
  globalThis.document = {createElement: (tag) => new Element(tag), createDocumentFragment: () => Object.assign(new Element("#fragment"), {fragment: true})};
  globalThis.window = {explorerMotion: {replaceChildren: (host, ...content) => { host.children = []; host.append(...content); }}};
  return api.create({root, changed: () => {}, context: () => ({ready: true, selectionMs: [at("2025-03-03T00:00:00Z"), at("2025-03-03T12:00:00Z")],
    viewMs: [at("2025-03-01T00:00:00Z"), at("2025-03-08T00:00:00Z")], edgeMs: edgeMs()})});
}
const byId = (root, name) => root.querySelector("#ol-features-" + name);
const submit = (root) => byId(root, "form").listeners.submit[0]({preventDefault() {}});

test("a second Find while Mill is still connecting starts no second search", async () => {
  const root = panel(), stub = mill();
  controller(root);
  byId(root, "add").onclick();
  const first = submit(root), second = submit(root);
  assert.equal(byId(root, "find").disabled, true);
  // Nor do the marked windows change under it.
  assert.equal(byId(root, "clear-windows").disabled, true);
  assert.ok(byId(root, "windows").all().filter((e) => e.tagName === "BUTTON").every((b) => b.disabled));
  await stub.answer(); await first; await second;
  assert.deepEqual(stub.calls.map((c) => c.path), ["/mill/app-config", "/mill/discover"]);
  assert.equal(byId(root, "results").hidden, false);
});

test("a field the chosen mode does not use is disabled and left out of the request", async () => {
  const root = panel(), stub = mill();
  const lead = byId(root, "lead"), mode = byId(root, "mode");
  controller(root);
  byId(root, "add").onclick();
  mode.value = "lead"; mode.listeners.change[0]();
  assert.equal(lead.disabled, false);
  lead.value = ""; mode.value = "inside"; mode.listeners.change[0]();
  assert.equal(lead.disabled, true, "a disabled field takes no part in the form's validation");
  const done = submit(root); await stub.answer(); await done;
  assert.equal("lead_bars" in stub.calls[1].body, false);
});

test("a manifest shown by hand after a refused copy goes with its leader", async () => {
  const root = panel(), stub = mill();
  Object.defineProperty(globalThis, "navigator", {value: {clipboard: {writeText: async () => { throw new Error("denied"); }}}, configurable: true});
  controller(root);
  byId(root, "add").onclick();
  const done = submit(root); await stub.answer(); await done;
  await byId(root, "copy").onclick();
  const yaml = byId(root, "yaml");
  assert.equal(yaml.hidden, false);
  assert.equal(yaml.textContent, api.manifestYaml(events.candidates[0].rule.manifest));
  byId(root, "rows").all().filter((e) => e.tagName === "BUTTON")[1].onclick();
  assert.equal(yaml.hidden, true);
  assert.equal(yaml.textContent, "");
});

test("an answer that is not Mill's is reported, keeps no result and is asked again", async () => {
  const root = panel(), html = "<!doctype html><title>Explorer</title>";
  let stub = mill({"/mill/app-config": html});
  controller(root);
  byId(root, "add").onclick();
  let done = submit(root); await stub.answer(); await done;
  assert.equal(byId(root, "status").textContent, "Mill's /app-config answered 200 without JSON.");
  assert.equal(byId(root, "results").hidden, true);
  // The next Find asks for the configuration again; a discovery answer of the wrong shape is refused the same way.
  stub = mill({"/mill/discover": JSON.stringify({candidates: "none"})});
  done = submit(root); await stub.answer(); await done;
  assert.deepEqual(stub.calls.map((c) => c.path), ["/mill/app-config", "/mill/discover"]);
  assert.equal(byId(root, "status").textContent, "Mill's /discover answered with JSON that is not its answer.");
  assert.equal(byId(root, "results").hidden, true);
});

test("an answer that arrives after the cutoff moved before what it compared is not kept", async () => {
  const root = panel(), stub = mill();
  let edge = at("2026-09-24T00:00:00Z");
  controller(root, () => edge);
  byId(root, "add").onclick();
  const done = submit(root);
  await stub.next();
  // The discovery is asked with the cutoff of that moment; replay then moves it into 2025 before Mill answers.
  edge = at("2025-06-01T00:00:00Z");
  await stub.next(); await done;
  assert.equal(stub.calls[1].body.context.end, "2026-05-16T00:00:00Z");
  assert.equal(byId(root, "results").hidden, true);
  assert.equal(byId(root, "status").textContent, "The cutoff moved before the end of what Mill compared against, so its answer used later bars. Find again.");
});

test("a copy the clipboard refuses after another leader is selected shows no manifest under the new rule", async () => {
  const root = panel(), stub = mill();
  let refuse;
  Object.defineProperty(globalThis, "navigator", {value: {clipboard: {writeText: () => new Promise((_, reject) => { refuse = reject; })}}, configurable: true});
  controller(root);
  byId(root, "add").onclick();
  const done = submit(root); await stub.answer(); await done;
  const copying = byId(root, "copy").onclick();
  byId(root, "rows").all().filter((e) => e.tagName === "BUTTON")[1].onclick();
  refuse(new Error("denied")); await copying;
  const yaml = byId(root, "yaml");
  assert.equal(yaml.hidden, true);
  assert.equal(yaml.textContent, "");
  assert.equal(byId(root, "status").textContent, `The clipboard refused to copy ${events.candidates[0].column}'s rule; select it and copy again.`);
});
