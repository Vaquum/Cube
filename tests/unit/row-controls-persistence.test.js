"use strict";
// Independent fixtures distinguish the old coupled 90-day default from the split controls' defaults.
// The same payloads exercise links, complete codes and storage restoration without deriving expectations from the codec.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const E = require("../support/enc");
const C = E.codec;
const AP = "slate2-8f7890f7";
const plain = (value) => JSON.parse(JSON.stringify(value));
const controls = (view) => Object.fromEntries(["rowControlsVersion", "rows", "period", "background", "backgroundPeriod"].map((key) => [key, view[key]]));
const fresh = { rowControlsVersion: 1, rows: "off", period: "visible", background: "off", backgroundPeriod: "90d" };
const coupled = (kind, period) => ({ rowControlsVersion: 1, rows: kind, period, background: kind, backgroundPeriod: period });
const view = (patch = {}) => ({ window: "24h", appearance: AP, ...fresh, ...patch });
function seal(payload) {
  const canon = (value) => value && typeof value === "object" ? (Array.isArray(value) ? value.map(canon) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]))) : value;
  const body = { ...payload }; delete body.id;
  return { ...body, id: crypto.createHash("sha256").update(JSON.stringify(canon(body))).digest().subarray(0, 12).toString("base64url") };
}
function payload(settings, version = 2) {
  return { visualVersion: version, kind: "view", query: { t1: 0, t2: 2, p1: 200, p2: 202, tR: 0, pR: 0 },
    view: { window: "24h", viewport: [0, 2, 200, 202], ...settings }, scales: [], axes: [], models: [],
    ...(version === 3 ? { drawings: E.drawings.empty() } : {}) };
}

test("a marked fresh view has independent defaults, and its link always writes rc=1", () => {
  assert.deepEqual(controls(C.checkView(view(), {})), fresh);
  const address = C.formatAddress(view(), {}).hash;
  assert.equal(address, `#w=24h&vis=2&ap=${AP}&rc=1`);
  assert.deepEqual(controls(C.parseAddress(address, {}).view), fresh);
});

test("legacy links and raw saved views copy the old measure and actual or implicit period into both controls", () => {
  for (const period of [undefined, "7d", "visible", "2026-09-01"]) {
    const raw = { window: "24h", rows: "delta", ...(period === undefined ? {} : { period }) }, before = structuredClone(raw);
    const expected = coupled("delta", period ?? "90d");
    assert.deepEqual(controls(C.checkView(raw, {})), expected);
    assert.deepEqual(raw, before);
    for (const prefix of ["#w=24h", "#w=24h&vis=2"]) {
      const legacy = C.parseAddress(`${prefix}&rows=delta${period === undefined ? "" : `&period=${period}`}`, {});
      assert.deepEqual(controls(legacy.view), expected);
      assert.deepEqual(controls(C.parseAddress(C.formatAddress({ ...legacy.view, appearance: AP }, {}).hash, {}).view), expected);
    }
  }
});

test("split links retain different measures and periods, and each control can be off independently", () => {
  for (const settings of [
    { rows: "delta", period: "visible", background: "volume", backgroundPeriod: "7d" },
    { rows: "off", period: "1y", background: "time", backgroundPeriod: "2026-09-01" },
    { rows: "relvol", period: "30d", background: "off", backgroundPeriod: "90d" },
  ]) {
    const expected = { ...fresh, ...settings }, address = C.formatAddress(view(settings), {}).hash;
    assert.deepEqual(controls(C.parseAddress(address, {}).view), expected);
    assert.match(address, /(?:^|&)rc=1(?:&|$)/);
  }
  const unavailable = C.parseAddress("#w=24h&vis=2&rc=1&rows=time&background=time", { rowsChoices: ["off", "volume", "delta", "relvol"] });
  assert.equal(unavailable.view.rows, "off");
  assert.equal(unavailable.view.background, "off");
  assert.deepEqual(unavailable.dropped.map((item) => item.key).sort(), ["background", "rows"]);
});

test("unsupported or malformed split versions never reinterpret an address or raw view", () => {
  for (const value of ["0", "2", "", "01", "%E0%A4%A"]) assert.equal(C.parseAddress(`#w=24h&vis=2&rc=${value}`, {}).kind, "reject");
  for (const value of [0, 2, "1", null]) assert.equal(C.checkView(view({ rowControlsVersion: value }), {}), null);
});

test("v2 and complete v3 codes persist independent controls and migrate old wire payloads without changing them", async () => {
  for (const version of [2, 3]) {
    const settings = { ...fresh, rows: "delta", background: "volume", backgroundPeriod: "1y" };
    const code = await C.encodePortable(payload(settings, version)), decoded = await C.decodePortable(code);
    assert.deepEqual(controls(C.validatePortable(decoded.payload, {}).value.view), settings);
    assert.equal(decoded.payload.view.rowControlsVersion, 1);
    for (const oldSettings of [{ rows: "volume" }, { rows: "delta", period: "7d" }]) {
      const old = seal(payload(oldSettings, version)), before = structuredClone(old), expected = coupled(oldSettings.rows, oldSettings.period ?? "90d");
      assert.deepEqual(controls(C.validatePortable(old, {}).value.view), expected);
      assert.deepEqual(old, before);
      const rewritten = await C.decodePortable(await C.encodePortable(old));
      assert.deepEqual(controls(rewritten.payload.view), expected);
    }
  }
});

test("portable strict validation covers new field types and refuses future split versions", () => {
  for (const patch of [{ background: 1 }, { backgroundPeriod: 1 }, { rowControlsVersion: 2 }, { rowControlsVersion: "1" }]) {
    const result = C.validatePortable(seal(payload({ ...fresh, ...patch })), {});
    assert.equal(result.ok, false);
    assert.match(result.reasons.join(" "), /background|row controls version/);
  }
});

test("stored last views and tab history retain the split marker and independent choices", () => {
  class Memory {
    constructor() { this.map = new Map(); }
    get length() { return this.map.size; }
    key(index) { return [...this.map.keys()][index] ?? null; }
    getItem(key) { return this.map.get(key) ?? null; }
    setItem(key, value) { this.map.set(key, String(value)); }
    removeItem(key) { this.map.delete(key); }
  }
  const window = { localStorage: new Memory(), sessionStorage: new Memory() };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/state.js"), "utf8"), { window, console: { warn() {} } });
  const settings = view({ rows: "delta", background: "volume", backgroundPeriod: "7d" }), hash = C.formatAddress(settings, {}).hash;
  window.explorerState.save({ version: 5, view: hash });
  window.explorerState.saveHistory({ entries: [{ id: "one", hash }], index: 0 });
  assert.deepEqual(controls(C.parseAddress(window.explorerState.read("view:v5").value.view, {}).view), controls(settings));
  assert.deepEqual(controls(C.parseAddress(window.explorerState.history().entries[0].hash, {}).view), controls(settings));
  const key = "market-state-cube-explorer:view:v5";
  window.localStorage.setItem(key, JSON.stringify({ version: 5, rowControlsVersion: 2, view: hash }));
  assert.equal(window.explorerState.read("view:v5").status, "unknown-version");
  window.explorerState.save({ version: 5, view: hash });
  assert.equal(JSON.parse(window.localStorage.getItem("market-state-cube-explorer:backup:view:v5")).rowControlsVersion, 2);
});
