#!/usr/bin/env node
// Dependency-free Node adapter. Analytical operations share the browser modules.
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url), A = require("../src/agent.js");
const codec = { deflate: (bytes) => gzipSync(bytes), inflate: (bytes, max) => gunzipSync(bytes, { maxOutputLength: max }) };
const object = { type: "object", additionalProperties: false };
const documentProperty = { description: "cube-analysis@1 document, copied text with JSON, or cube-analysis code", anyOf: [{ type: "object" }, { type: "string" }] };
const queryProperty = { ...object, required: ["t1", "t2", "p1", "p2", "tR", "pR"], properties: { t1: { type: "string" }, t2: { type: "string" }, p1: { type: "number" }, p2: { type: "number" }, tR: { type: "number" }, pR: { type: "number" } } };
export const tools = [
  ["cube_capabilities", "Discover the shared document and available operations", {}],
  ["cube_inspect", "Read copied evidence, scene settings, captures and provenance", { document: documentProperty }],
  ["cube_query", "Query current cube cells by UTC bounds, seconds and USDT; return captured evidence", { query: queryProperty }],
  ["cube_compare", "Compare captured cells with the canvas comparison engine", { document: documentProperty, basis: { enum: ["auto", "amount", "intensity"] }, reference: { type: ["string", "null"] } }],
  ["cube_configure", "Configure the interactive canvas; viewport uses base positions/rows and resolution uses exponents", { document: documentProperty, patch: { type: "object" } }],
  ["cube_replay", "Set replay at an absolute base-column position", { document: documentProperty, anchor: { type: "number" }, enabled: { type: "boolean" } }],
  ["cube_annotate", "Add a labeled trend line with exact UTC milliseconds and integer price cents", { document: documentProperty, line: { type: "object" } }],
  ["cube_share", "Return a complete investigation link and Markdown evidence links; store large documents durably", { document: documentProperty }],
  ["cube_refresh", "Explicitly reread a captured query and report metric changes", { document: documentProperty }],
].map(([name, description, properties]) => ({ name, description, inputSchema: { ...object, properties, required: Object.keys(properties).filter((key) => !["basis", "reference", "enabled"].includes(key)) }, annotations: { readOnlyHint: name !== "cube_share", destructiveHint: false, idempotentHint: name !== "cube_query" && name !== "cube_refresh", openWorldHint: ["cube_query", "cube_share", "cube_refresh"].includes(name) } }));
async function documentOf(value) { return typeof value === "string" ? value.startsWith("cube-analysis:") ? A.decode(value, codec) : A.parse(value) : A.validate(value); }
function baseUrl() {
  const url = new URL(process.env.CUBE_URL || "http://127.0.0.1:8487/");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("CUBE_URL must be an HTTP(S) origin without credentials");
  return url;
}
async function request(path, options = {}) {
  const base = baseUrl(), headers = { ...options.headers };
  if (process.env.CUBE_COOKIE) headers.Cookie = process.env.CUBE_COOKIE;
  if (process.env.CUBE_AUTHORIZATION) headers.Authorization = process.env.CUBE_AUTHORIZATION;
  const response = await fetch(new URL(path, base), { ...options, headers, redirect: "error", signal: AbortSignal.timeout(120000) });
  const raw = await response.text();
  if (Buffer.byteLength(raw) > A.MAX_BYTES) throw Error("Cube response exceeds 16 MiB");
  let body;
  try { body = JSON.parse(raw); } catch { throw Error("Cube did not return JSON; configure authenticated CUBE_URL access"); }
  if (!response.ok) throw Error(body.detail || body.error || `Cube returned HTTP ${response.status}`);
  return body;
}
function queryOf(d) {
  const q = d.scene.query, f = d.snapshot;
  if (!f) throw Error("Refreshing requires captured query geometry");
  const iso = (x) => new Date((f.origin + x * f.baseSeconds) * 1000).toISOString();
  return { t1: iso(q.t1), t2: iso(q.t2), p1: q.p1 * f.basePrice, p2: q.p2 * f.basePrice, tR: f.baseSeconds * 2 ** q.tR, pR: f.basePrice * 2 ** q.pR };
}
export async function dispatch(name, args = {}) {
  const definition = tools.find((tool) => tool.name === name);
  if (!definition || !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !(key in definition.inputSchema.properties)) || definition.inputSchema.required.some((key) => !(key in args))) throw Error("Unknown operation or invalid arguments");
  if (name === "cube_capabilities") return { schema: A.SCHEMA, tools, maxDocumentBytes: A.MAX_BYTES, queryUnits: { time: "UTC ISO", price: "USDT", tR: "seconds", pR: "USDT" }, sceneUnits: { viewport: "base columns and base rows", resolution: "dyadic exponents", annotation: "UTC milliseconds and integer cents" }, source: baseUrl().origin };
  if (name === "cube_query") return A.fromQuery(await request("/cube/agent/query?proto=2&" + new URLSearchParams(args.query)));
  const document = await documentOf(args.document);
  if (name === "cube_inspect") return A.forExport(document);
  if (name === "cube_compare") return A.compare(document, { basis: args.basis, reference: args.reference });
  if (name === "cube_configure") return A.forExport(A.configure(document, args.patch));
  if (name === "cube_replay") return A.forExport(A.configure(document, { replay: args.enabled !== false, anchor: args.anchor }));
  if (name === "cube_annotate") return A.forExport(A.annotate(document, args.line));
  if (name === "cube_refresh") {
    const fresh = A.fromQuery(await request("/cube/agent/query?proto=2&" + new URLSearchParams(queryOf(document))));
    if (document.comparison?.captures.length) {
      const captures = [], token = fresh.snapshot.token;
      for (const cell of document.comparison.captures) {
        const f = document.snapshot, close = Math.ceil((cell.observed.t1 - f.origin * 1000) / (f.baseSeconds * 1000));
        const query = { t1: new Date(cell.observed.t0).toISOString(), t2: new Date((f.origin + close * f.baseSeconds) * 1000).toISOString(), p1: cell.observed.low, p2: cell.observed.high, tR: f.baseSeconds * 2 ** cell.level.n, pR: f.basePrice * 2 ** cell.level.m, pack: token };
        const answer = await request("/cube/agent/query?proto=2&" + new URLSearchParams(query));
        if (answer.frame.token !== token) throw Error("Source changed during refresh; previous evidence retained");
        if (!answer.cells.some((z) => z.c === cell.c && z.r === cell.r)) {
          const q = answer.query, cut = (answer.frame.cutoffMs / 1000 - f.origin) / f.baseSeconds;
          if (!(cell.c * 2 ** q.n < Math.min(q.b1, cut) && (cell.c + 1) * 2 ** q.n > q.b0 && cell.r * 2 ** q.m < q.r1 && (cell.r + 1) * 2 ** q.m > q.r0)) throw Error("Captured cell is outside current source support; previous evidence retained");
          answer.cells.push({ c: cell.c, r: cell.r, v: 0, bv: 0, ct: 0, bt: 0 });
        }
        answer.cells.sort((a, b) => a.c - b.c || a.r - b.r);
        const observed = A.fromQuery(answer), updated = observed.comparison.captures.find((capture) => capture.id === cell.id);
        if (!updated) throw Error("Captured cell could not be refreshed; previous evidence retained");
        captures.push(updated);
        fresh.snapshot.sources.push({ ...observed.snapshot.sources[0], id: "capture-query:" + cell.id });
        fresh.snapshot.cutoffMs = Math.max(fresh.snapshot.cutoffMs, observed.snapshot.cutoffMs);
      }
      fresh.comparison.captures = captures;
    } else if (document.comparison) {
      fresh.comparison.captures = []; fresh.comparison.focus = null;
    } else { fresh.comparison = null; fresh.focus = null; }
    fresh.scene = structuredClone(document.scene);
    // Observation provenance has a strict portable-scene allowlist.
    fresh.scene.observation = { source: fresh.snapshot.source, instrument: "BTC/USDT", cutoffMs: fresh.snapshot.cutoffMs, canonicalThroughMs: fresh.snapshot.canonicalThroughMs, token: fresh.snapshot.token, note: "Explicit refresh of captured query" };
    fresh.scene = A.seal(fresh.scene);
    if (document.comparison) {
      const ids = new Set(fresh.comparison.captures.map((cell) => cell.id));
      fresh.comparison = { ...structuredClone(document.comparison), captures: fresh.comparison.captures,
        focus: ids.has(document.comparison.focus) ? document.comparison.focus : fresh.comparison.focus,
        reference: ids.has(document.comparison.reference) ? document.comparison.reference : null,
        page: Math.min(document.comparison.page, Math.max(0, Math.ceil(fresh.comparison.captures.length / 24) - 1)) };
      fresh.focus = ids.has(document.focus) ? document.focus : null;
    }
    const updated = A.forExport(A.seal(fresh));
    return { document: updated, ...A.diff(A.forExport(document), updated) };
  }
  if (name === "cube_share") {
    const shared = A.forExport(document), code = await A.encode(shared, codec), base = baseUrl().href;
    let value = code;
    if (A.link(base, code).length > A.INLINE_MAX) {
      const record = await request("/cube/investigations?proto=2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shared) });
      value = record.reference;
    }
    const url = A.link(base, value, document.focus);
    return { url, documentId: shared.id, evidence: (shared.comparison?.captures || []).map((cell) => ({ id: cell.id, url: A.link(base, value, cell.id), markdown: `[Cell ${cell.c},${cell.r}](${A.link(base, value, cell.id)})` })) };
  }
  throw Error("Operation unavailable");
}
export async function rpc(message) {
  const id = message?.id;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request" } };
  if (id === undefined) return null;
  try {
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "cube-agent", version: "1.0.0" }, instructions: "Use captured evidence for analysis. Cite cube_share evidence Markdown links. Refresh explicitly to compare current-source changes." };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = { tools };
    else if (message.method === "tools/call") {
      try {
        const value = await dispatch(message.params?.name, message.params?.arguments);
        result = { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
      } catch (error) { result = { isError: true, content: [{ type: "text", text: error.message }] }; }
    } else return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    return { jsonrpc: "2.0", id, result };
  } catch (error) { return { jsonrpc: "2.0", id, error: { code: -32602, message: error.message } }; }
}
export function serve(port) {
  return createServer(async (req, res) => {
    if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) { res.writeHead(403); res.end(); return; }
    if (req.method !== "POST" || req.url !== "/agent" || req.headers["content-type"]?.split(";")[0] !== "application/json") { res.writeHead(404); res.end(); return; }
    try {
      const chunks = []; let bytes = 0;
      for await (const part of req) { bytes += part.length; if (bytes > A.MAX_BYTES * 2) throw Error("Request too large"); chunks.push(part); }
      const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      const { operation, arguments: args } = JSON.parse(body), result = await dispatch(operation, args);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
  }).listen(port, "127.0.0.1");
}
async function main() {
  if (process.argv[2] === "--http") { const port = Number(process.argv[3] || 8488); serve(port); process.stderr.write(`Cube agent HTTP on http://127.0.0.1:${port}/agent\n`); return; }
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (Buffer.byteLength(line) > A.MAX_BYTES * 2) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Message too large" } }) + "\n"); continue; }
    let response;
    try { response = await rpc(JSON.parse(line)); } catch { response = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }; }
    if (response) process.stdout.write(JSON.stringify(response) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
