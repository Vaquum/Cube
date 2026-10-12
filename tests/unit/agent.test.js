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
});
test("explicit refresh diffs changed metrics while retaining the original immutable document", () => {
  const before = document(), next = answer(); next.cells[0].v = 600;
  const after = A.fromQuery(next), changes = A.diff(before, after);
  assert.ok(changes.changes.some((change) => change.metric === "volume.amount" && change.before.value === 300 && change.after.value === 600));
  assert.equal(before.comparison.captures[0].metrics["volume.amount"].value, 300);
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
test("production durable store survives a new instance and rejects corrupted or unknown references", () => {
  const script = `import sys,tempfile,json,hashlib,sqlite3\nfrom pathlib import Path\nsys.path.insert(0,'tools')\nfrom investigation_store import InvestigationStore\nwith tempfile.TemporaryDirectory() as root:\n p=Path(root)/'db.sqlite';s=InvestigationStore(p);body=b'{"schema":"cube-analysis@1","evidence":300}';i=s.put(body)\n assert i==hashlib.sha256(body).hexdigest()\n assert s.put(body)==i and InvestigationStore(p).get(i)==body\n assert s.get('a'*64) is None\n with sqlite3.connect(p) as c:c.execute('UPDATE investigations SET body=? WHERE id=?',(b'bad',i))\n try:s.get(i);raise AssertionError('corruption accepted')\n except ValueError:pass\n try:s.get('../db');raise AssertionError('path accepted')\n except ValueError:pass\nprint('durable store verified')\n`;
  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /verified/);
});
test("production agent route uses exact six-parameter rounding and dyadic bounds", () => {
  const script = `import sys\nsys.path.insert(0,'tools')\nimport cube_bridge as c\ncurrent={'cutoffBase':2.1}\na={'t1':['2021-01-01T00:00:00Z'],'t2':['2021-01-01T00:02:00Z'],'p1':['25000'],'p2':['25250'],'tR':['56.25'],'pR':['125']}\nassert c.agent_rectangle(a,current)=={'n':0,'m':0,'b0':0,'b1':3,'r0':200,'r1':202}\nfor field,value in [('tR','60'),('pR','100'),('p1','NaN')]:\n b={**a,field:[value]}\n try:c.agent_rectangle(b,current);raise AssertionError('invalid accepted')\n except ValueError:pass\nprint('agent route verified')\n`;
  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /verified/);
});
