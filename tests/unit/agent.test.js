"use strict";
// Oracle: hand-calculated 300 USDT / 2 trades, 56.25 seconds, 125 USDT exposure;
// node:zlib and node:crypto independently check wire bytes and content integrity.
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib"), { spawnSync } = require("node:child_process");
const A = require("../../src/agent.js");
const epoch = 1609459200000;
function answer() {
  return { query: { n: 0, m: 0, b0: 0, b1: 2, r0: 200, r1: 202 }, cells: [{ c: 0, r: 200, v: 300, bv: 100, ct: 2, bt: 1 }, { c: 1, r: 201, v: 100, bv: 100, ct: 1, bt: 1 }], summary: { volume: 400, trade_count: 3 }, frame: { baseSeconds: 56.25, basePrice: 125, origin: epoch / 1000, cutoffMs: epoch + 112500, canonicalThroughMs: epoch + 112500, source: "SYNTHETIC hand vector", token: "vector-1", live: true } };
}
const document = () => A.fromQuery(answer());
const codecs = { deflate: (bytes) => gzipSync(bytes), inflate: (bytes, max) => gunzipSync(bytes, { maxOutputLength: max }) };
test("agent captures use the canvas kernel for amounts, intensity and ratios", () => {
  const d = document(), cell = d.comparison.captures[0];
  assert.equal(cell.metrics["volume.amount"].value, 300);
  assert.equal(cell.metrics["volume.intensity"].value, 320);
  assert.equal(cell.metrics["delta.amount"].value, -100);
  assert.equal(cell.metrics.size.value, 150);
  assert.equal(cell.metrics.flow.value, 1 / 3);
  assert.equal(cell.metrics["volume.amount"].formula, "cells.volume.amount@1");
  assert.equal(cell.metrics["volume.amount"].supportEnd, epoch + 56250);
  assert.equal(A.compare(d).metrics.volume[cell.id].count, 2);
  assert.equal(A.compare(d).metrics.volume[cell.id].reference, 200);
});
test("text and compressed codes preserve groups, sources, selections and exact scene bytes", async () => {
  const d = document(), text = A.text(d);
  assert.match(text, /Volume: 300 usdt/); assert.match(text, /SYNTHETIC hand vector/);
  assert.deepEqual(A.parse(text), d);
  for (const codec of [codecs, {}]) assert.deepEqual(await A.decode(await A.encode(d, codec), codecs), d);
  const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, canonical(x[key])])) : x;
  const { id, ...body } = d;
  assert.equal(id, crypto.createHash("sha256").update(JSON.stringify(canonical(body))).digest().subarray(0, 12).toString("base64url"));
});
test("tampered values, unsupported schema, duplicate cells and unsafe objects reject whole", async () => {
  const tampered = document(); tampered.comparison.captures[0].metrics.size.value = 999;
  assert.throws(() => A.validate(tampered), /integrity/);
  assert.throws(() => A.validate(A.seal({ ...document(), schema: "cube-analysis@2" })), /schema/);
  const duplicate = document(); duplicate.snapshot.sources[0].cells.push(duplicate.snapshot.sources[0].cells[1]);
  assert.throws(() => A.validate(A.seal(duplicate)), /captured cell/);
  assert.throws(() => A.parse('{"__proto__":{"bad":true}}'), /unsafe/);
  assert.throws(() => A.seal({ bad: NaN }), /non-JSON/);
  const bomb = "cube-analysis:1." + gzipSync(Buffer.alloc(A.MAX_BYTES + 1)).toString("base64url");
  await assert.rejects(() => A.decode(bomb, codecs));
});
test("replay copy removes future values and diagnostics without modifying the source capture", () => {
  const capture = document().comparison.captures[0], original = structuredClone(capture);
  const redacted = A.redact(capture, epoch + 1000);
  assert.equal(redacted.metrics["volume.amount"].tag, "hidden");
  assert.equal(redacted.metrics["volume.amount"].value, null);
  assert.equal(redacted.metrics["volume.amount"].numerator, null);
  assert.equal(redacted.metrics.flow.denominator, null);
  assert.deepEqual(capture, original);
});
test("configuration and annotation reseal complete scenes; evidence links identify exact cells", () => {
  const d = document(), changed = A.configure(d, { mode: "delta", resolution: [1, 0] });
  assert.equal(changed.scene.view.mode, "delta"); assert.equal(changed.scene.query.tR, 1);
  assert.notEqual(changed.id, d.id); assert.equal(d.scene.view.mode, "volume");
  const annotated = A.annotate(d, { a: { timeMs: epoch, priceCents: 2500000 }, b: { timeMs: epoch + 112500, priceCents: 2512500 }, color: "#aa5533", label: "Evidence" });
  assert.equal(annotated.scene.drawings.objects[0].label, "Evidence");
  const url = new URL(A.link("https://cube.example/", "ref:" + "a".repeat(64), d.comparison.captures[0].id));
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("evidence"), d.comparison.captures[0].id);
  assert.throws(() => A.configure(d, { madeUp: true }), /Unknown/);
  assert.equal(A.configure(d, { readMode: "live" }).mode, "live");
  assert.throws(() => A.configure(d, { readMode: "unknown" }), /Read mode/);
});
test("explicit refresh diffs changed metrics while retaining the original immutable document", () => {
  const before = document(), next = answer(); next.cells[0].v = 600;
  const after = A.fromQuery(next), changes = A.diff(before, after);
  assert.ok(changes.changes.some((change) => change.metric === "volume.amount" && change.before.value === 300 && change.after.value === 600));
  assert.equal(before.comparison.captures[0].metrics["volume.amount"].value, 300);
});
test("lossless code round trips do not manufacture metric changes from member order", async () => {
  const d = document(), decoded = await A.decode(await A.encode(d, codecs), codecs);
  assert.deepEqual(A.diff(d, decoded).changes, []);
});
test("an explicit null comparison reference selects the cohort baseline", () => {
  const d = document(); d.comparison.reference = d.comparison.captures[0].id;
  const sealed = A.seal(d), id = d.comparison.captures[0].id;
  assert.equal(A.compare(sealed).metrics.volume[id].reference, 300);
  assert.equal(A.compare(sealed, { reference: null }).metrics.volume[id].reference, 200);
});
test("readable export resolves unequal-exposure Auto basis exactly as comparison does", () => {
  const d = document(), partial = d.comparison.captures[1];
  partial.observed.t1 -= 28125; partial.observed.seconds = 28.125;
  const sealed = A.validate(A.seal(d));
  assert.equal(A.compare(sealed).basis, "intensity");
  assert.match(A.text(sealed), /Selected comparison metric\/basis · volume\/intensity/);
});
test("replay comparisons use the scene anchor even without a caller-supplied edge", () => {
  const d = A.configure(document(), { replay: true, anchor: 1 });
  const values = A.compare(d).metrics.volume;
  assert.equal(values[d.comparison.captures[0].id].value, 300);
  assert.equal(values[d.comparison.captures[1].id].tag, "hidden");
  assert.equal(A.compare(d, { edge: epoch + 112500 }).metrics.volume[d.comparison.captures[1].id].tag, "hidden");
});
test("replay packet JSON and comparison ordering cannot leak future captured amounts", async () => {
  const d = A.configure(document(), { replay: true, anchor: 1 });
  const exported = A.parse(A.text(d));
  assert.equal(exported.comparison.captures[1].metrics["volume.amount"].value, null);
  assert.equal(exported.snapshot.sources[0].cells.length, 1);
  assert.equal(A.compare(d).ordered[1].metrics["volume.amount"].value, null);
  assert.equal((await A.decode(await A.encode(d, codecs), codecs)).snapshot.cutoffMs, epoch + 56250);
  assert.equal(d.comparison.captures[1].metrics["volume.amount"].value, 100);
});
test("a fenced snippet in source text cannot replace the final analysis JSON block", () => {
  const d = document(); d.comparison.captures[0].source += '\n```json\n{"unrelated":true}\n```';
  const sealed = A.seal(d); assert.deepEqual(A.parse(A.text(sealed)), sealed);
});
test("missing observation rejects before any export or replay comparison can dereference it", () => {
  const d = document(); delete d.scene.observation; d.scene = A.seal(d.scene);
  assert.throws(() => A.validate(A.seal(d)), /observation source and cutoff/);
});
test("noncanonical base64 and invalid inflater results reject as explicit codec errors", async () => {
  for (const code of ["cube-analysis:1j.A", "cube-analysis:1j.AB"]) await assert.rejects(() => A.decode(code, codecs), /Invalid analysis base64/);
  const code = await A.encode(document(), codecs);
  for (const invalid of [null, undefined, "text", {}]) await assert.rejects(() => A.decode(code, { inflate: async () => invalid }), /inflater did not return bytes/);
});
test("the maximum permitted zero-cell snapshot exports compact JSON that remains importable", () => {
  const d = document(), source = d.snapshot.sources[0];
  source.cells = Array.from({ length: 250000 }, (_, r) => ({ c: 0, r, v: 0, bv: 0, ct: 0, bt: 0 }));
  const sealed = A.seal(d), copied = A.text(sealed);
  assert.ok(Buffer.byteLength(copied) < A.MAX_BYTES * 3);
  assert.equal(A.parse(copied).snapshot.sources[0].cells.length, 250000);
});
test("MCP process emits only JSON-RPC and supports discover, inspection and actionable errors", () => {
  const input = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cube_inspect", arguments: { document: document() } } }, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "missing", arguments: {} } }].map(JSON.stringify).join("\n") + "\n";
  const run = spawnSync(process.execPath, ["tools/cube-agent.mjs"], { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const messages = run.stdout.trim().split("\n").map(JSON.parse);
  assert.deepEqual(messages.map((message) => message.id), [1, 2, 3, 4]);
  assert.equal(messages[0].result.protocolVersion, "2025-11-25");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "cube_share"));
  assert.equal(messages[2].result.structuredContent.comparison.captures.length, 2);
  assert.equal(messages[3].result.isError, true);
});
test("HTTP-backed MCP refresh preserves the original sealed scene and returns changed facts", async (t) => {
  const { startFake } = require("../support/cube-fake.js"), { dispatch } = await import("../../tools/cube-agent.mjs");
  const fake = await startFake({ profile: "micro:mixed" }); t.after(() => fake.close());
  const previousUrl = process.env.CUBE_URL; process.env.CUBE_URL = fake.url;
  t.after(() => { if (previousUrl === undefined) delete process.env.CUBE_URL; else process.env.CUBE_URL = previousUrl; });
  const before = await dispatch("cube_query", { query: { t1: "2021-01-01T00:00:00Z", t2: "2021-01-01T00:01:52.500Z", p1: 25000, p2: 25250, tR: 56.25, pR: 125 } });
  const original = structuredClone(before); fake.revise({ day: "2021-01-01", factor: 2 });
  const after = await dispatch("cube_refresh", { document: before });
  assert.deepEqual(before, original); assert.deepEqual(A.validate(before), original);
  assert.ok(after.changes.some((change) => change.metric === "volume.amount" && change.before.value === 300 && change.after.value === 600));
  before.comparison.selectedMetric = "delta"; before.comparison.basis = "intensity"; before.comparison.reference = before.comparison.captures[0].id; before.focus = before.comparison.captures[0].id;
  const configured = A.seal(before), refreshed = await dispatch("cube_refresh", { document: configured });
  assert.equal(refreshed.document.comparison.selectedMetric, "delta"); assert.equal(refreshed.document.comparison.basis, "intensity");
  assert.equal(refreshed.document.comparison.reference, configured.comparison.reference); assert.equal(refreshed.document.focus, configured.focus);
});
test("HTTP agent preserves Unicode split across request chunks", async (t) => {
  const { serve } = await import("../../tools/cube-agent.mjs"), http = require("node:http");
  const server = serve(0); await new Promise((resolve) => server.once("listening", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const d = document(); d.scene.observation.source += " · € evidence"; d.scene = A.seal(d.scene);
  const sealed = A.seal(d), payload = Buffer.from(JSON.stringify({ operation: "cube_inspect", arguments: { document: sealed } }));
  const split = payload.indexOf(Buffer.from("€")) + 1;
  const result = await new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: server.address().port, path: "/agent", method: "POST", headers: { "Content-Type": "application/json" } }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on("error", reject); request.write(payload.subarray(0, split)); setImmediate(() => request.end(payload.subarray(split)));
  });
  assert.equal(result.status, 200); assert.equal(result.body.scene.observation.source, sealed.scene.observation.source); assert.equal(result.body.id, sealed.id);
});
test("selection imports require a complete region and observation provenance", () => {
  for (const field of ["source", "measuredThrough", "state"]) {
    const d = document(); delete d.selection[field];
    assert.throws(() => A.validate(A.seal(d)), /selection region or provenance/);
  }
  for (const field of ["t1", "t2", "p1", "p2", "tR", "pR"]) {
    const d = document(); d.selection.query = { ...d.selection.query }; delete d.selection.query[field];
    assert.throws(() => A.validate(A.seal(d)), /selection region or provenance/);
  }
});
test("query captures mark clipped start and price support as portions and retain raw counters", () => {
  const a = answer(); a.query = { n: 1, m: 1, b0: 1, b1: 2, r0: 201, r1: 202 };
  a.cells = [{ c: 0, r: 100, v: 300, bv: 100, ct: 2, bt: 1 }];
  const cell = A.fromQuery(a).comparison.captures[0];
  assert.equal(cell.completeness, "Portion"); assert.equal(cell.observed.seconds, 56.25); assert.equal(cell.observed.width, 125);
  assert.equal(cell.detail.find((d) => d.label === "Buyer-initiated USDT").value, 100);
});
test("selection-only diffs retain changes and removals without captured cells", () => {
  const before = document(); before.comparison.captures = []; before.comparison.focus = null;
  const after = structuredClone(before); after.selection.metrics.volume = 800; delete after.selection.metrics.trade_count;
  const changes = A.diff(A.seal(before), A.seal(after)).changes;
  assert.ok(changes.some((c) => c.selection && c.metric === "volume" && c.before === 400 && c.after === 800));
  assert.ok(changes.some((c) => c.selection && c.metric === "trade_count" && c.after === null));
});
test("MCP refresh retains scattered evidence outside the configured viewport", async (t) => {
  const { startFake } = require("../support/cube-fake.js"), { dispatch } = await import("../../tools/cube-agent.mjs");
  const fake = await startFake({ profile: "micro:mixed" }); t.after(() => fake.close());
  const previousUrl = process.env.CUBE_URL; process.env.CUBE_URL = fake.url;
  t.after(() => { if (previousUrl === undefined) delete process.env.CUBE_URL; else process.env.CUBE_URL = previousUrl; });
  const original = await dispatch("cube_query", { query: { t1: "2021-01-01T00:00:00Z", t2: "2021-01-01T00:01:52.500Z", p1: 25000, p2: 25250, tR: 56.25, pR: 125 } });
  const narrow = A.configure(original, { viewport: [0, 1, 200, 201] });
  fake.revise({ day: "2021-01-01", factor: 2 });
  const after = await dispatch("cube_refresh", { document: narrow });
  assert.deepEqual(after.document.comparison.captures.map((c) => c.id), narrow.comparison.captures.map((c) => c.id));
  assert.equal(after.document.comparison.captures.find((c) => c.c === 1 && c.r === 201).metrics["volume.amount"].value, 200);
  assert.equal(new Set(after.document.snapshot.sources.map((s) => s.token || after.document.snapshot.token)).size, 1);
});
test("production durable store survives a new instance and rejects corrupted or unknown references", () => {
  const script = `import sys,tempfile,json,hashlib,sqlite3\nfrom pathlib import Path\nsys.path.insert(0,'tools')\nfrom investigation_store import InvestigationStore\nwith tempfile.TemporaryDirectory() as root:\n p=Path(root)/'db.sqlite';s=InvestigationStore(p);body=b'{"schema":"cube-analysis@1","evidence":300}';i=s.put(body)\n assert i==hashlib.sha256(body).hexdigest()\n assert s.put(body)==i and InvestigationStore(p).get(i)==body\n assert s.get('a'*64) is None\n with sqlite3.connect(p) as c:c.execute('UPDATE investigations SET body=? WHERE id=?',(b'bad',i))\n try:s.get(i);raise AssertionError('corruption accepted')\n except ValueError:pass\n try:s.get('../db');raise AssertionError('path accepted')\n except ValueError:pass\nprint('durable store verified')\n`;
  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /verified/);
});
test("production agent route uses exact six-parameter rounding and dyadic bounds", () => {
  const script = `import sys\nsys.path.insert(0,'tools')\nimport cube_bridge as c\ncurrent={'cutoffBase':2.1}\na={'t1':['2021-01-01T00:00:00Z'],'t2':['2021-01-01T00:02:00Z'],'p1':['25000'],'p2':['25250'],'tR':['56.25'],'pR':['125']}\nassert c.agent_rectangle(a,current)=={'n':0,'m':0,'b0':0,'b1':3,'r0':200,'r1':202}\nfor field,value in [('tR','60'),('pR','100'),('p1','NaN')]:\n b={**a,field:[value]}\n try:c.agent_rectangle(b,current);raise AssertionError('invalid accepted')\n except ValueError:pass\nprint('agent route verified')\n`;
  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /verified/);
});
