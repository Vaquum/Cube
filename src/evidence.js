/* P7-S3: seasonal-state@1 / block-bootstrap@2. Pure inputs, no transport or DOM.
 * Bounded setTimeout(0) batches are visible to the existing read/draw probe.
 * Thresholds are fixed at the study anchor; intervals are approximate and pointwise.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MODEL = "seasonal-state@1", BOOTSTRAP = "block-bootstrap@2", MAX_H = 8;
  const REASONS = ["Missing coverage", "Observed empty POC population", "Missing POC", "No contiguous predecessor POC", "Ineligible seasonal support", "Unavailable fitted threshold"];
  const finite = (value) => ({ tag: "finite", value });
  const unavailable = (reason, tag = "unsupported") => ({ tag, reason });
  function quantile(values, p) {
    if (!values.length) return null;
    const at = (values.length - 1) * p, i = Math.floor(at), j = Math.ceil(at);
    return values[i] + (values[j] - values[i]) * (at - i);
  }
  function fnv(text) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash || 1;
  }
  function random(seed) {
    let value = seed >>> 0 || 1;
    return () => { value ^= value << 13; value >>>= 0; value ^= value >>> 17; value >>>= 0; value ^= value << 5; return value >>>= 0; };
  }
  const bucket = (value, pair) => value < pair[0] ? 0 : value < pair[1] ? 1 : 2;
  const yieldTask = (control, stage) => new Promise((resolve) => {
    const started = control.now?.();
    setTimeout(() => { if (started !== undefined) control.yield?.(stage, control.now() - started); resolve(); }, 0);
  });
  const taskClock = () => typeof performance === "object" ? performance.now() : Date.now();
  // Keep short timers visible to the existing owed-work probe. Rows/draws keep
  // their arithmetic order; only a spent work slice incurs another timer wait.
  async function checkpoint(control, stage, budget, force = false) {
    if (force || taskClock() - budget.at >= 8) {
      await yieldTask(control, stage);
      budget.at = taskClock();
    }
    return !control.cancelled?.();
  }
  async function sorted(values, control, stage, budget, compare = null) {
    const size = 2048;
    for (let at = 0; at < values.length; at += size) {
      const chunk = values.slice(at, at + size).sort(compare ?? ((a, b) => a - b));
      for (let i = 0; i < chunk.length; i++) values[at + i] = chunk[i];
      if (!await checkpoint(control, stage, budget)) return null;
    }
    if (values.length <= size) return values;
    let from = values, to = new Array(values.length);
    for (let width = size; width < values.length; width *= 2) {
      for (let at = 0; at < values.length; at += width * 2) {
        const middle = Math.min(at + width, values.length), end = Math.min(at + width * 2, values.length);
        let left = at, right = middle;
        for (let i = at; i < end; i++) to[i] = right >= end || left < middle && (compare ? !(compare(from[left], from[right]) > 0) : from[left] <= from[right]) ? from[left++] : from[right++];
        if (!await checkpoint(control, stage, budget)) return null;
      }
      [from, to] = [to, from];
    }
    return from;
  }
  // Exact JSON/UTF-8 bytes of [packKey, revision, sorted dependency tuples].
  // Bounded serialization avoids one giant string/encoding task. Native SHA is
  // optional; the same compression/padding remains available without a secure
  // context. Neither path changes the canonical seed or publication identity.
  async function sourceDigest({ packKey, revision, tuples }, hash, control = {}) {
    const budget = { at: taskClock() };
    let endPhase = control.phase?.("digest.sort");
    try {
      if (!await checkpoint(control, "digest", budget, true)) return null;
      const ordered = await sorted(tuples.slice(), control, "digest", budget,
        (x, y) => (String(x[0]) < String(y[0]) ? -1 : String(x[0]) > String(y[0]) ? 1 : 0) || x[1] - y[1]);
      if (!ordered) return null;
      endPhase?.(); endPhase = control.phase?.("digest.encode");
      const parts = [hash.utf8(JSON.stringify([packKey, revision]).slice(0, -1) + ",[")];
      for (let at = 0; at < ordered.length; at += 256) {
        parts.push(hash.utf8((at ? "," : "") + JSON.stringify(ordered.slice(at, at + 256)).slice(1, -1)));
        if (!await checkpoint(control, "digest", budget)) return null;
      }
      parts.push(hash.utf8("]]"));
      const bytes = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
      let at = 0;
      for (const part of parts) { bytes.set(part, at); at += part.length; if (!await checkpoint(control, "digest", budget)) return null; }
      endPhase?.(); endPhase = null;
      let digest;
      if (control.digestBytes) {
        endPhase = control.phase?.("digest.native-sha256");
        try { digest = await control.digestBytes(bytes); if (digest?.length !== 32) digest = null; }
        catch { digest = null; }
        endPhase?.(digest ? "completed" : "failed"); endPhase = null;
        if (control.cancelled?.()) return null;
      }
      if (!digest) {
        endPhase = control.phase?.("digest.cooperative-sha256");
        digest = await hash.sha256Async(bytes, () => checkpoint(control, "digest", budget));
        endPhase?.(digest ? "completed" : "interrupted"); endPhase = null;
      }
      return digest && !control.cancelled?.() ? hash.hex(digest) : null;
    } finally { endPhase?.("interrupted"); }
  }
  // Direction and barrier summaries share only their delta quantiles and
  // overlap population. Count both fields in one pass and sort once. Keep
  // independent result arrays; the public synchronous summary stays unchanged.
  async function summaries(cases, control, budget) {
    const values = [], direction = [0, 0, 0], barrier = [0, 0, 0];
    let overlapping = 0;
    for (let i = 0; i < cases.length; i++) {
      if (i % 512 === 0 && !await checkpoint(control, "summaries", budget, i === 0)) return null;
      const c = cases[i], before = cases[i - 1], after = cases[i + 1];
      values.push(c.delta);
      if (c.direction < 0) direction[0]++; else if (c.direction === 0) direction[1]++; else if (c.direction > 0) direction[2]++;
      if (c.first < 0) barrier[0]++; else if (c.first === 0) barrier[1]++; else if (c.first > 0) barrier[2]++;
      if (before && before.end + 1 > c.c || after && c.end + 1 > after.c) overlapping++;
    }
    const ordered = await sorted(values, control, "summaries", budget);
    if (!ordered) return null;
    const q = values.length ? [.1, .25, .5, .75, .9].map(p => quantile(ordered, p)) : [];
    return [direction, barrier].map(counts => ({ n: cases.length, up: counts[2], flat: counts[1], down: counts[0], q: q.slice(), overlapping }));
  }
  function summary(cases, field) {
    const values = cases.map((c) => c.delta).sort((a, b) => a - b);
    let overlapping = 0;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i], before = cases[i - 1], after = cases[i + 1];
      if (before && before.end + 1 > c.c || after && c.end + 1 > after.c) overlapping++;
    }
    return { n: cases.length, up: cases.filter((c) => c[field] > 0).length, flat: cases.filter((c) => c[field] === 0).length, down: cases.filter((c) => c[field] < 0).length,
      q: values.length ? [.1, .25, .5, .75, .9].map((p) => quantile(values, p)) : [], overlapping };
  }
  function canonicalKey(input, result, kind, horizon) {
    const p = input.provenance, cutoff = (result.a + 1) * 2 ** result.n;
    // Actual current cutoffs are kept in provenance; seed cutoffs stop at dependencies.
    const clip = (value) => value === null || value === undefined ? null : Math.min(value, cutoff);
    return [MODEL, BOOTSTRAP, kind, p.instrument, result.n, result.m, [input.b0, input.b1, p.priceLow, p.priceHigh], cutoff, cutoff,
      [clip(p.sourceCutoff), clip(p.canonicalCutoff), clip(p.replayEdge), cutoff], p.sourceDigest,
      result.thresholds.share, result.thresholds.seasonal, result.state, result.barrier, horizon, MAX_H, result.blockLength,
      "prior-positive-volume", "prior-seasonal-eligible", p.precisionID];
  }
  function intervalResult({values, ownN, fullMatched, anchorReason = null}) {
    const pair=values.length ? [quantile(values,.025),quantile(values,.975)] : null;
    const reason=anchorReason || (ownN<30 ? "Fewer than 30 eligible cases" : fullMatched<20 ? "Fewer than 20 full matched blocks" : values.length<1800 ? "Fewer than 1800 valid resamples" : pair[0]===pair[1] ? "Degenerate resampling interval" : null);
    return {result:reason ? unavailable(reason,reason==="Degenerate resampling interval" ? "undefined" : "unsupported") : finite(pair),validDraws:values.length};
  }
  async function bootstrap(input, result, kind, horizon, control = {}) {
    const phaseEnd = control.phase?.("bootstrap");
    let stageEnd = control.phase?.("bootstrap.counts");
    let phaseOutcome = "interrupted";
    try {
    const budget = { at: taskClock() };
    // Only the population sizes enter interval qualification, not the sorted
    // quantiles or category counts formerly rebuilt here.
    const field = kind === "poc-barrier" ? "first" : "direction", sampleN = result.matched[horizon].length, baseN = result.cases[horizon].length;
    stageEnd?.(); stageEnd = control.phase?.("bootstrap.scan");
    const length = result.blockLength, step = 2 ** result.n, start = input.b0 / step, stop = (result.a + 1), first = Math.floor(start / length), last = Math.ceil(stop / length);
    const blocks = Array.from({ length: Math.max(0, last - first) }, (_, i) => ({ id: first + i, sample: [0, 0, 0, 0], base: [0, 0, 0, 0], full: (first + i) * length >= start && (first + i + 1) * length <= stop }));
    for (let i = 0; i < result.cases[horizon].length; i++) {
      if (i % 1024 === 0 && !await checkpoint(control, "bootstrap.scan", budget, i === 0)) return null;
      const c = result.cases[horizon][i], block = blocks[Math.floor(c.c / length) - first], category = c[field] + 1;
      block.base[category]++; block.base[3]++;
      if (c.matched) { block.sample[category]++; block.sample[3]++; }
    }
    const fullMatched = blocks.filter((b) => b.full && b.sample[3] > 0).length;
    const key = canonicalKey(input, result, kind, horizon), seed = fnv(JSON.stringify(key) + BOOTSTRAP), rng = random(seed);
    const draws = Object.fromEntries(["down", "flat", "up"].map((k) => [k, { conditional: [], baseline: [], difference: [] }]));
    stageEnd?.(); stageEnd = control.phase?.("bootstrap.draws");
    // A floor failure remains explicit; do not spend 2000 draws on a known unusable study.
    if (result.state && fullMatched >= 20 && blocks.length) {
      for (let r = 0; r < 2000; r++) {
        if (r % 16 === 0 && !await checkpoint(control, "bootstrap.draws", budget, r === 0)) return null;
        const s = [0, 0, 0, 0], b = [0, 0, 0, 0];
        for (let j = 0; j < blocks.length; j++) {
          const chosen = blocks[Math.floor(rng() / 4294967296 * blocks.length)];
          for (let k = 0; k < 4; k++) { s[k] += chosen.sample[k]; b[k] += chosen.base[k]; }
        }
        for (const [i, name] of ["down", "flat", "up"].entries()) {
          if (s[3]) draws[name].conditional.push(100 * s[i] / s[3]);
          if (b[3]) draws[name].baseline.push(100 * b[i] / b[3]);
          if (s[3] && b[3]) draws[name].difference.push(100 * (s[i] / s[3] - b[i] / b[3]));
        }
      }
    }
    stageEnd?.(); stageEnd = control.phase?.("bootstrap.intervals");
    const intervals = {};
    for (const name of ["down", "flat", "up"]) {
      intervals[name] = {};
      for (const component of ["conditional", "baseline", "difference"]) {
        const values = draws[name][component].sort((a,b)=>a-b), ownN=component==="baseline" ? baseN : component==="conditional" ? sampleN : Math.min(sampleN,baseN);
        intervals[name][component]=intervalResult({values,ownN,fullMatched,anchorReason:result.state ? null : result.anchorReason || "Anchor seasonal support unavailable"});
      }
    }
    control.sample?.({ calendarBlocks: blocks.length, fullMatched, drawsRan: Boolean(result.state && fullMatched >= 20 && blocks.length),
      validDraws: Object.fromEntries(Object.entries(intervals).map(([name, components]) => [name,Object.fromEntries(Object.entries(components).map(([component, value]) => [component,value.validDraws]))])) });
    stageEnd?.(); stageEnd = null; phaseOutcome = "completed";
    return { version: BOOTSTRAP, key, seed, fullMatched, calendarBlocks: blocks.length, blockLength: length, resamples: 2000, intervals,
      qualification: "Approximate pointwise 95% intervals; fixed anchor thresholds. Longer dependence and nonstationarity may invalidate coverage." };
    } finally { stageEnd?.("interrupted"); phaseEnd?.(phaseOutcome); }
  }
  async function compute(input, control = {}) {
    let phaseEnd = control.phase?.("index");
    const phase = name => { phaseEnd?.(); phaseEnd = control.phase?.(name); };
    try {
    const alive = () => !control.cancelled?.(), step = 2 ** input.n, budget = { at: taskClock() };
    if (!Number.isInteger(input.a) || input.b1 <= input.b0 || (input.b1 - input.b0) / step > 100000) throw new RangeError("Invalid bounded evidence support");
    const by = new Map(), rows = [], shares = [], seasonalValues = [];
    for (let i = 0; i < input.cols.length; i++) {
      // Retain both initial handoffs, so an input queued after the first one
      // can cancel before even a cheap index runs into the next phase.
      if (i % 1024 === 0 && !await checkpoint(control, "index", budget, i <= 1024)) return null;
      by.set(input.cols[i].c, input.cols[i]);
    }
    phase("ledger-seasonal");
    const stop = input.a + 1, first = Math.ceil(input.b0 / step);
    for (let c = first; c < stop; c++) {
      if ((c - first) % 512 === 0 && !await checkpoint(control, "ledger-seasonal", budget, c === first)) return null;
      const col = by.get(c), previous = by.get(c - 1), row = { c, source: col?.source ?? null, time: [c * step, (c + 1) * step], volume: col?.v ?? null, buyShare: col?.v > 0 ? col.bv / col.v : null, poc: col?.poc ?? null, state: null, matched: false, reason: null, outcomes: {} };
      const seasonalStart = control.now?.();
      row.seasonal = input.seasonal({ numerator: col?.v ?? null, start: c * step, end: (c + 1) * step, cutoff: stop * step });
      if (seasonalStart !== undefined) control.cost?.("seasonal", control.now() - seasonalStart);
      row.reason = !col || col.covered === false ? REASONS[0] : col.v === 0 ? REASONS[1] : !Number.isFinite(col.poc) ? REASONS[2] : !previous || previous.covered === false || !(previous.v > 0) || !Number.isFinite(previous.poc) ? REASONS[3] : row.seasonal.result.tag !== "finite" ? REASONS[4] : null;
      row.result = row.reason ? unavailable(row.reason, row.reason === REASONS[1] ? "empty-population" : "unsupported") : finite(row.seasonal.result.value);
      if (c < input.a && col?.v > 0 && Number.isFinite(row.buyShare)) shares.push(row.buyShare);
      if (c < input.a && row.seasonal.result.tag === "finite") seasonalValues.push(row.seasonal.result.value);
      rows.push(row);
    }
    phase("thresholds-state");
    const orderedShares = await sorted(shares, control, "thresholds-state", budget), orderedSeasonal = orderedShares && await sorted(seasonalValues, control, "thresholds-state", budget);
    if (!orderedShares || !orderedSeasonal) return null;
    const st = [quantile(orderedShares, 1 / 3), quantile(orderedShares, 2 / 3)], vt = [quantile(orderedSeasonal, 1 / 3), quantile(orderedSeasonal, 2 / 3)], fitted = st.every(Number.isFinite) && vt.every(Number.isFinite);
    for (let i = 0; i < rows.length; i++) {
      if (i % 512 === 0 && !await checkpoint(control, "thresholds-state", budget, i === 0)) return null;
      const row = rows[i];
      if (!row.reason && !fitted) { row.reason = REASONS[5]; row.result = unavailable(row.reason); }
      if (!row.reason) row.state = [Math.sign(row.poc - by.get(row.c - 1).poc) + 1, bucket(row.buyShare, st), bucket(row.seasonal.result.value, vt)];
    }
    const anchor = rows.find((r) => r.c === input.a), state = anchor?.state ?? null;
    phase("cases");
    const cases = Array.from({ length: 9 }, () => []), matched = Array.from({ length: 9 }, () => []);
    for (let i = 0; i < rows.length; i++) {
      if (i % 512 === 0 && !await checkpoint(control, "cases", budget, i === 0)) return null;
      const row = rows[i];
      row.matched = Boolean(state && row.state && row.state.every((v, j) => v === state[j]));
      if (!row.state) continue;
      let firstCross = 0, firstAt = null, min = 0, max = 0, gap = false;
      for (let h = 1; h <= MAX_H; h++) {
        const future = by.get(row.c + h), unfinished = row.c + h > input.a;
        if (!future || future.covered === false || !(future.v > 0) || !Number.isFinite(future.poc)) gap = true;
        const reason = unfinished ? "Unfinished horizon" : gap ? "Missing horizon coverage" : null;
        row.outcomes[h] = { reason, result: reason ? unavailable(reason, unfinished ? "pending" : "unsupported") : finite(future.poc - row.poc), knownThrough: (row.c + h + 1) * step };
        if (reason) continue;
        const delta = future.poc - row.poc;
        min = Math.min(min, delta); max = Math.max(max, delta);
        if (!firstCross && Math.abs(delta) >= input.barrier) { firstCross = Math.sign(delta); firstAt = h; }
        const c = { c: row.c, end: row.c + h, poc: row.poc, finalPoc: future.poc, delta, direction: Math.sign(delta), first: firstCross, firstAt, min, max, state: row.state, source: row.source, buyShare: row.buyShare, volume: row.volume, seasonal: row.seasonal, matched: row.matched, knownThrough: (row.c + h + 1) * step };
        cases[h].push(c); if (row.matched) matched[h].push(c);
      }
    }
    phase("summaries");
    const matchingSummaries = [], allSummaries = [];
    for (const group of matched) { const pair = await summaries(group, control, budget); if (!pair) return null; matchingSummaries.push(pair); }
    for (const group of cases) { const pair = await summaries(group, control, budget); if (!pair) return null; allSummaries.push(pair); }
    const blockLength = Math.ceil((6 * 10752 + 9 * step) / step);
    const out = { version: MODEL, a: input.a, n: input.n, m: input.m, barrier: input.barrier, from: first, poc: anchor?.poc ?? null, anchor, state,
      thresholds: { share: st, seasonal: vt }, cases, matched, match: matchingSummaries.map(pair => pair[0]), all: allSummaries.map(pair => pair[0]),
      barrierMatch: matchingSummaries.map(pair => pair[1]), barrierAll: allSummaries.map(pair => pair[1]), ledger: rows, blockLength, provenance: input.provenance,
      anchorReason: state ? null : anchor?.reason === REASONS[3] ? REASONS[3] : "Anchor seasonal support unavailable", fitReason: fitted ? null : REASONS[5] };
    phaseEnd?.(); phaseEnd = null;
    out.uncertainty = await bootstrap(input, out, input.kind, input.horizon, control);
    return alive() ? out : null;
    } finally { phaseEnd?.("interrupted"); }
  }
  return Object.freeze({ MODEL, BOOTSTRAP, REASONS: Object.freeze(REASONS), quantile, fnv, random, summary, canonicalKey, intervalResult, sourceDigest, bootstrap, compute });
});
