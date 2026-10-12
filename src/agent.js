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
    if (!scene.ok || scene.dropped.length) fail(scene.reasons.join("; ") || "Scene contains unsupported settings");
    if (!raw.scene.observation || !Number.isFinite(raw.scene.observation.cutoffMs) || typeof raw.scene.observation.source !== "string") fail("Analysis scene requires its observation source and cutoff");
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
    if (!keys(frame, ["baseSeconds", "basePrice", "origin", "cutoffMs", "sourceCutoffMs", "canonicalThroughMs", "source", "token", "live", "generation", "sources", "motion", "cache"]) || ![frame.baseSeconds, frame.basePrice, frame.origin, frame.cutoffMs].every(Number.isFinite) || frame.baseSeconds <= 0 || frame.basePrice <= 0 || typeof frame.live !== "boolean" || !Array.isArray(frame.sources) || !frame.sources.length) fail("Invalid captured canvas");
    if (frame.sourceCutoffMs !== undefined && (!Number.isFinite(frame.sourceCutoffMs) || frame.sourceCutoffMs < frame.cutoffMs)) fail("Invalid captured source cutoff");
    if (frame.generation !== undefined && (!Number.isSafeInteger(frame.generation) || frame.generation < 0)) fail("Invalid captured cache generation");
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
    if (typeof text !== "string" || E.hash.utf8(text).length > MAX_BYTES * 3) fail("Analysis input is too large");
    const fence = [...text.matchAll(/^```json\s*\n([\s\S]*?)\n```\s*$/gm)].at(-1);
    return validate(JSON.parse(fence ? fence[1] : text));
  }
  async function encode(document, { deflate } = {}) {
    const bytes = E.hash.utf8(E.hash.canonical(forExport(document)));
    return deflate ? "cube-analysis:1." + E.hash.b64urlEncode(await deflate(bytes)) : "cube-analysis:1j." + E.hash.b64urlEncode(bytes);
  }
  async function decode(code, { inflate } = {}) {
    if (typeof code !== "string" || code.length > MAX_BYTES * 2) fail("Analysis code exceeds the size limit");
    const match = /^cube-analysis:1(j?)\.([A-Za-z0-9_-]+)$/.exec(code);
    if (!match) fail("Unsupported analysis code");
    let bytes = E.hash.b64urlDecode(match[2]);
    if (!(bytes instanceof Uint8Array)) fail("Invalid analysis base64 encoding");
    if (!match[1]) { if (!inflate) fail("Compressed analysis needs an inflater"); bytes = await inflate(bytes, MAX_BYTES); }
    if (!(bytes instanceof Uint8Array)) fail("Analysis inflater did not return bytes");
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
    const d = forExport(document), cells = d.comparison?.captures || [];
    const edge = replayEdge(d), basis = C.analyze(cells, { edge, basis: d.comparison?.basis }).basis;
    const sections = [`Cube analysis · ${d.instrument} · ${d.mode}`, `Captured at: ${new Date(d.createdAt).toISOString()}`, ...cells.map((cell) => C.captureText(cell, { edge, selectedMetric: d.comparison.selectedMetric, basis, poc: d.comparison.poc }))];
    if (cells.some((cell) => !cell.context?.histories?.length)) sections.push("Frozen histories not captured for some cells; missing context is unavailable, not zero.");
    if (d.selection) sections.push("Selection: " + JSON.stringify(d.selection));
    if (href) sections.push("Open canvas: " + href);
    sections.push("```json\n" + JSON.stringify(d) + "\n```");
    return sections.join("\n\n");
  }
  function compare(document, options = {}) {
    const d = validate(document);
    const sceneEdge = replayEdge(d), edge = sceneEdge === null ? options.edge ?? null : Math.min(sceneEdge, options.edge ?? sceneEdge);
    return C.analyze((d.comparison?.captures || []).map((cell) => redact(cell, edge)), { ...options, edge, basis: options.basis ?? d.comparison?.basis ?? "auto", reference: options.reference === undefined ? d.comparison?.reference : options.reference, poc: options.poc === undefined ? d.comparison?.poc : options.poc });
  }
  function replayEdge(d) {
    if (!d.scene.view.replay) return null;
    const step = 2 ** d.scene.query.tR, anchor = d.scene.view.anchor;
    const position = d.scene.view.mode === "candles" ? anchor : Math.floor(anchor / step) * step;
    const geometry = d.snapshot || { origin: 1609459200, baseSeconds: 56.25 };
    return Math.min(d.scene.observation.cutoffMs, (geometry.origin + position * geometry.baseSeconds) * 1000);
  }
  function forExport(document) {
    const d = validate(document), edge = replayEdge(d);
    if (edge === null) return d;
    if (d.comparison) {
      d.comparison.captures = d.comparison.captures.map((cell) => redact(cell, edge));
      if (d.comparison.poc && Math.max(d.comparison.poc.supportEnd ?? Infinity, d.comparison.poc.knownThrough ?? Infinity) > edge) d.comparison.poc = null;
    }
    if (d.selection && (!Number.isFinite(d.selection.measuredThrough) || d.selection.measuredThrough > edge)) {
      d.selection.metrics = { tag: "hidden", value: null, reason: "Unavailable in replay" }; d.selection.state = "hidden";
    }
    d.scene.scales = (d.scene.scales || []).filter((scale) => Number.isFinite(scale.cutMs) && scale.cutMs <= edge && Number.isFinite(scale.obsEndMs) && scale.obsEndMs <= edge);
    d.scene.axes = (d.scene.axes || []).filter((axis) => axis.through === null || axis.through <= edge);
    if (d.snapshot) {
      const frame = d.snapshot, cut = (edge / 1000 - frame.origin) / frame.baseSeconds;
      const clip = (source) => ({ ...source, b1: Math.min(source.b1, cut), col1: Math.ceil(Math.min(source.b1, cut) / 2 ** source.n), cells: source.cells.filter((cell) => Math.min((cell.c + 1) * 2 ** source.n, source.b1) <= cut) });
      frame.sources = frame.sources.filter((source) => source.b0 < cut).map(clip);
      frame.motion = (frame.motion || []).filter((source) => source.b0 < cut).map(clip);
      frame.sourceCutoffMs ??= frame.cutoffMs;
      frame.cutoffMs = edge;
      frame.cache = replayCache(frame.cache || {}, cut);
      if (!frame.sources.length) d.snapshot = null;
    }
    d.scene.observation.cutoffMs = edge;
    d.scene = seal(d.scene);
    return validate(seal(d));
  }
  function replayCache(cache, cut) {
    const output = {}, entries = (name) => cache[name]?.cubeMap || [], put = (name, values) => { output[name] = { cubeMap: values }; };
    put("barChunks", entries("barChunks").filter(([, r]) => r.a < cut).map(([key, r]) => [key, { ...r, end: Math.min(r.end, cut), bars: r.bars.filter((bar) => (bar.c + 1) * 2 ** r.n <= cut) }]));
    put("barEdges", entries("barEdges").filter(([, r]) => Number.isFinite(r.end) && r.end <= cut));
    put("candleRanges", entries("candleRanges").map(([key, r]) => {
      const stop = r.end <= cut ? Math.min(r.b, cut) : Math.floor(cut / 2 ** r.n) * 2 ** r.n;
      return [key, { ...r, b: stop, end: Math.min(r.end, stop), bars: r.bars.filter((bar) => bar.through <= stop) }];
    }).filter(([, r]) => r.b > r.a));
    for (const name of ["lineResults", "lineLatest"]) put(name, entries(name).filter(([, r]) => Array.isArray(r.span) && r.span[1] <= cut));
    put("visibleVwaps", entries("visibleVwaps").filter(([, r]) => Number.isFinite(r.end) && r.end <= cut));
    return output;
  }
  function diff(before, after) {
    const a = validate(before), b = validate(after), changes = [];
    const old = new Map((a.comparison?.captures || []).map((cell) => [cell.id, cell]));
    for (const cell of b.comparison?.captures || []) {
      const prior = old.get(cell.id);
      if (!prior) { changes.push({ cell: cell.id, change: "added" }); continue; }
      for (const [metric, value] of Object.entries(cell.metrics)) if (E.hash.canonical(prior.metrics[metric] ?? null) !== E.hash.canonical(value)) changes.push({ cell: cell.id, metric, before: prior.metrics[metric] ?? null, after: value });
      old.delete(cell.id);
    }
    for (const cell of old.keys()) changes.push({ cell, change: "removed" });
    return { previous: a.id, current: b.id, changes };
  }
  function redact(capture, edge) {
    const cell = structuredClone(capture);
    if (edge === null) return cell;
    const eligible = (support) => Number.isFinite(support?.supportEnd) && Number.isFinite(support?.knownThrough) && Math.max(support.supportEnd, support.knownThrough) <= edge;
    for (const metric of Object.values(cell.metrics)) if (!eligible(metric)) Object.assign(metric, { tag: "hidden", value: null, numerator: null, denominator: null, reason: "Unavailable in replay" });
    for (const detail of cell.detail) if (!eligible(detail)) Object.assign(detail, { tag: "hidden", value: null, reason: "Unavailable in replay" });
    const context = cell.context;
    if (context) {
      const visible = (id) => eligible(context.supports[id]);
      for (const support of Object.values(context.supports)) if (!eligible(support)) {
        for (const key of ["value", "numerator", "denominator"]) if (key in support) support[key] = null;
        if (support.result) support.result = { tag: "hidden", value: null, reason: "Unavailable in replay" };
      }
      for (const history of context.histories) for (const slot of history.slots) if (!visible(slot.supportId) || slot.denominatorIds.some((id) => !visible(id))) slot.result = { tag: "hidden", value: null, reason: "Unavailable in replay" };
      const origin = context.originatingObservation;
      if (origin && (!visible(origin.supportId) || origin.denominatorIds?.some((id) => !visible(id)))) origin.result = { tag: "hidden", value: null, reason: "Unavailable in replay" };
      cell.originatingObservation = structuredClone(origin);
    }
    return cell;
  }
  function configure(document, patch) {
    const d = validate(document);
    if (!keys(patch, ["viewport", "resolution", "mode", "pane", "rows", "period", "lines", "selection", "replay", "anchor", "scale"])) fail("Unknown scene setting");
    Object.assign(d.scene.view, Object.fromEntries(Object.entries(patch).filter(([key]) => !["resolution", "viewport"].includes(key))));
    if (patch.viewport) { d.scene.view.viewport = patch.viewport; d.scene.view.window = ""; Object.assign(d.scene.query, { t1: patch.viewport[0], t2: patch.viewport[1], p1: patch.viewport[2], p2: patch.viewport[3] }); }
    if (patch.resolution) { [d.scene.query.tR, d.scene.query.pR] = patch.resolution; d.scene.view.auto = false; }
    d.scene = seal(d.scene);
    return validate(seal(d));
  }
  function annotate(document, line) {
    const d = validate(document), collection = d.scene.drawings;
    if (!collection) fail("Annotations require a v3 scene");
    collection.objects.push(E.drawings.newObject(collection, line));
    d.scene = seal(d.scene);
    return validate(seal(d));
  }
  function fromQuery(answer) {
    const { query: q, frame: f, cells, summary } = answer;
    const snapshot = { ...f, sources: [{ id: "agent-query", n: q.n, m: q.m, b0: q.b0, b1: Math.min(q.b1, (f.cutoffMs / 1000 - f.origin) / f.baseSeconds), col0: Math.floor(q.b0 / 2 ** q.n), col1: Math.ceil(q.b1 / 2 ** q.n), cells }], motion: [], cache: {} };
    const cut = (f.cutoffMs / 1000 - f.origin) / f.baseSeconds, bounds = [q.b0, q.b1, q.r0, q.r1], ms = (x) => Math.round((f.origin + x * f.baseSeconds) * 1000);
    const captures = cells.map((z) => {
      const ts = 2 ** q.n, ps = 2 ** q.m, t0 = Math.max(z.c * ts, q.b0), t1 = Math.min((z.c + 1) * ts, q.b1, cut), low = Math.max(z.r * ps, q.r0), high = Math.min((z.r + 1) * ps, q.r1), metrics = {};
      for (const mode of ["volume", "trades", "delta", "size", "flow", "flowtrades"]) for (const basis of ["amount", ...( ["volume", "trades", "delta"].includes(mode) ? ["intensity"] : [])]) {
        const measurement = E.measure.cellMeasurement({ mode, basis, z, geom: { BASE: f.baseSeconds, PR: f.basePrice }, level: { n: q.n, m: q.m }, bounds, cut, end: cut, CUT: cut, replay: false });
        metrics[mode + (["volume", "trades", "delta"].includes(mode) ? "." + basis : "")] = { tag: measurement.result.tag, value: measurement.result.value ?? null, unit: measurement.unit, formula: measurement.formula, numerator: measurement.numerator ?? null, denominator: measurement.denominator ?? null, supportEnd: ms(t1), knownThrough: ms(t1), reason: measurement.result.reason ?? "" };
      }
      const capture = { instrument: "BTC/USDT", level: { n: q.n, m: q.m }, origin: f.origin, c: z.c, r: z.r, nominal: { t0: ms(z.c * ts), t1: ms((z.c + 1) * ts), low: z.r * ps * f.basePrice, high: (z.r + 1) * ps * f.basePrice }, observed: { t0: ms(t0), t1: ms(t1), low: low * f.basePrice, high: high * f.basePrice, seconds: (t1 - t0) * f.baseSeconds, width: (high - low) * f.basePrice }, capturedAt: Date.now(), measuredThrough: ms(t1), source: f.source + " · " + f.token, completeness: t1 === (z.c + 1) * ts ? "Complete" : "Portion", metrics, detail: [], contextOrigin: "legacy-structural", context: { supports: {}, histories: [], originatingObservation: null }, originatingObservation: null };
      capture.id = C.identity(capture); return capture;
    });
    const scene = seal({ visualVersion: 3, kind: "view", query: { t1: q.b0, t2: q.b1, p1: q.r0, p2: q.r1, tR: q.n, pR: q.m }, view: { viewport: bounds, window: "", auto: false, mode: "volume", selection: null, replay: false, anchor: null, lines: [] }, drawings: E.drawings.empty(), scales: [], axes: [], models: [], observation: { source: f.source, instrument: "BTC/USDT", cutoffMs: f.cutoffMs, canonicalThroughMs: f.canonicalThroughMs, token: f.token, note: "Captured current-source query; no historical vintage reconstruction" } });
    return validate(seal({ schema: SCHEMA, instrument: "BTC/USDT", createdAt: Date.now(), mode: "captured", scene, snapshot, comparison: { comparisonVersion: 2, instrument: "BTC/USDT", selectedMetric: "volume", captures, focus: captures[0]?.id ?? null, reference: null, basis: "auto", sort: { key: "time", direction: "asc" }, view: "grid", page: 0, poc: null, expanded: false, restoreLayout: null }, selection: { query: scene.query, metrics: summary, source: f.source, measuredThrough: f.cutoffMs, state: "exact" }, focus: null }));
  }
  return Object.freeze({ SCHEMA, MAX_BYTES, INLINE_MAX, seal, validate, parse, encode, decode, link, text, compare, diff, redact, configure, annotate, fromQuery, forExport });
});
