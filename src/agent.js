(function (factory) {
  "use strict";
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./encoding.js"), require("./comparison.js"), require("./state.js"));
  else window.explorerAgent = factory(window.explorerEncoding, window.explorerComparison, window.explorerState);
})(function (E, C, storage) {
  "use strict";
  const SCHEMA = "cube-analysis@1", MAX_BYTES = 16 * 1024 * 1024, INLINE_MAX = 8192;
  const fail = (reason) => { throw new RangeError(reason); };
  const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => names.includes(key));
  const safe = (value, depth = 0) => {
    if (depth > 32) fail("Analysis nesting exceeds 32 levels");
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object") fail("Analysis contains a non-JSON value");
    for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("Analysis contains an unsafe member");
      safe(value[key], depth + 1);
    }
  };
  function seal(body) {
    const { id, ...rest } = body;
    safe(rest);
    return { ...rest, id: E.hash.id96(rest) };
  }
  function validate(raw) {
    safe(raw);
    if (!keys(raw, ["schema", "id", "instrument", "createdAt", "mode", "scene", "comparison", "snapshot", "selection", "focus"]) || raw.schema !== SCHEMA) fail("Unsupported analysis schema or members");
    if (raw.instrument !== "BTC/USDT" || !["captured", "live"].includes(raw.mode) || !Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0) fail("Invalid analysis identity or mode");
    if (seal(raw).id !== raw.id) fail("Analysis integrity check failed");
    const scene = E.codec.validatePortable(raw.scene, {});
    if (!scene.ok) fail(scene.reasons.join("; "));
    if (raw.comparison !== null) {
      const checked = storage.comparison.validate(raw.comparison);
      if (!checked.ok) fail(checked.reason);
    }
    if (raw.focus !== null && (!raw.comparison || !raw.comparison.captures.some((cell) => cell.id === raw.focus))) fail("Unknown evidence focus");
    if (raw.snapshot !== null) validateSnapshot(raw.snapshot);
    if (raw.selection !== null && (!keys(raw.selection, ["query", "metrics", "source", "measuredThrough", "state"]) || !keys(raw.selection.query, ["t1", "t2", "p1", "p2", "tR", "pR"]) || !raw.selection.metrics)) fail("Invalid captured selection");
    const bytes = E.hash.utf8(JSON.stringify(raw)).length;
    if (bytes > MAX_BYTES) fail("Analysis exceeds 16 MiB; narrow the captured region");
    return structuredClone(raw);
  }
  function validateSnapshot(frame) {
    if (!keys(frame, ["baseSeconds", "basePrice", "origin", "cutoffMs", "canonicalThroughMs", "source", "token", "sources", "motion", "barChunks", "histories", "measured"]) || ![frame.baseSeconds, frame.basePrice, frame.origin, frame.cutoffMs].every(Number.isFinite) || frame.baseSeconds <= 0 || frame.basePrice <= 0 || !Array.isArray(frame.sources) || !frame.sources.length) fail("Invalid captured canvas");
    if (frame.canonicalThroughMs !== null && !Number.isFinite(frame.canonicalThroughMs)) fail("Invalid canonical cutoff");
    const ids = new Set(); let count = 0;
    for (const source of [...frame.sources, ...(frame.motion || [])]) {
      if (!keys(source, ["id", "n", "m", "b0", "b1", "col0", "col1", "end", "token", "cells"]) || typeof source.id !== "string" || ids.has(source.id) || ![source.n, source.m].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 20) || ![source.b0, source.b1].every(Number.isFinite) || source.b0 > source.b1 || !Array.isArray(source.cells)) fail("Invalid captured source");
      ids.add(source.id);
      let previous = -1; const cells = new Set();
      for (const cell of source.cells) {
        if (!keys(cell, ["c", "r", "v", "bv", "ct", "bt", "p", "w", "hi", "lo"]) || ![cell.c, cell.r].every((x) => Number.isSafeInteger(x) && x >= 0) || ![cell.v, cell.bv, cell.ct, cell.bt].every((x) => Number.isFinite(x) && x >= 0) || cell.bv > cell.v || cell.bt > cell.ct || cell.c < previous || cells.has(cell.c + "," + cell.r)) fail("Invalid captured cell");
        previous = cell.c; cells.add(cell.c + "," + cell.r); count++;
      }
    }
    if (count > 250000) fail("Captured canvas exceeds 250,000 cells");
  }
  function parse(text) {
    if (typeof text !== "string" || E.hash.utf8(text).length > MAX_BYTES * 2) fail("Analysis input is too large");
    const fence = text.match(/```json\s*\n([\s\S]*?)\n```/);
    return validate(JSON.parse(fence ? fence[1] : text));
  }
  async function encode(document, { deflate } = {}) {
    const bytes = E.hash.utf8(E.hash.canonical(validate(document)));
    return deflate ? "cube-analysis:1." + E.hash.b64urlEncode(await deflate(bytes)) : "cube-analysis:1j." + E.hash.b64urlEncode(bytes);
  }
  async function decode(code, { inflate } = {}) {
    if (typeof code !== "string" || code.length > MAX_BYTES * 2) fail("Analysis code exceeds the size limit");
    const match = /^cube-analysis:1(j?)\.([A-Za-z0-9_-]+)$/.exec(code);
    if (!match) fail("Unsupported analysis code");
    let bytes = E.hash.b64urlDecode(match[2]);
    if (!match[1]) { if (!inflate) fail("Compressed analysis needs an inflater"); bytes = await inflate(bytes, MAX_BYTES); }
    if (bytes.length > MAX_BYTES) fail("Analysis exceeds 16 MiB");
    return parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  function link(base, code, focus = null) {
    const url = new URL(base); url.username = url.password = "";
    if (!["http:", "https:"].includes(url.protocol)) fail("Analysis links need HTTP or HTTPS");
    const query = new URLSearchParams({ analysis: code });
    if (focus) query.set("evidence", focus);
    url.hash = query.toString();
    return url.href;
  }
  function text(document, { link: href = null } = {}) {
    const d = validate(document), cells = d.comparison?.captures || [];
    const sections = [`Cube analysis · ${d.instrument} · ${d.mode}`, `Captured at: ${new Date(d.createdAt).toISOString()}`, ...cells.map((cell) => C.captureText(cell, { edge: d.scene.view.replay ? d.scene.observation.cutoffMs : null, selectedMetric: d.comparison.selectedMetric, basis: d.comparison.basis === "auto" ? "amount" : d.comparison.basis, poc: d.comparison.poc }))];
    if (d.selection) sections.push("Selection: " + JSON.stringify(d.selection));
    if (href) sections.push("Open canvas: " + href);
    sections.push("```json\n" + JSON.stringify(d, null, 2) + "\n```");
    return sections.join("\n\n");
  }
  function compare(document, options = {}) {
    const d = validate(document);
    return C.analyze(d.comparison?.captures || [], { ...options, basis: options.basis ?? d.comparison?.basis ?? "auto", reference: options.reference ?? d.comparison?.reference, poc: options.poc ?? d.comparison?.poc });
  }
  function diff(before, after) {
    const a = validate(before), b = validate(after), changes = [];
    const old = new Map((a.comparison?.captures || []).map((cell) => [cell.id, cell]));
    for (const cell of b.comparison?.captures || []) {
      const prior = old.get(cell.id);
      if (!prior) { changes.push({ cell: cell.id, change: "added" }); continue; }
      for (const [metric, value] of Object.entries(cell.metrics)) if (JSON.stringify(prior.metrics[metric]) !== JSON.stringify(value)) changes.push({ cell: cell.id, metric, before: prior.metrics[metric] ?? null, after: value });
      old.delete(cell.id);
    }
    for (const cell of old.keys()) changes.push({ cell, change: "removed" });
    return { previous: a.id, current: b.id, changes };
  }
  return Object.freeze({ SCHEMA, MAX_BYTES, INLINE_MAX, seal, validate, parse, encode, decode, link, text, compare, diff });
});
