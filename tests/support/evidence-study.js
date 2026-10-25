/* Fixed synthetic inputs and bounded whole-result fingerprints for #213.
 * Plain script in the diagnostic page; require() in Node. No production use.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.evidenceStudyFixture = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CASES = ["cap-qualified", "floor-failure", "partial-coverage"];
  function input(E, name) {
    if (!CASES.includes(name)) throw new RangeError("Unknown study fixture");
    const count = name === "floor-failure" ? 10000 : 100000, n = 4, step = 2 ** n;
    let x = 12345;
    const cols = Array.from({ length: count }, (_, c) => {
      x = (Math.imul(1664525, x) + 1013904223) >>> 0;
      const col = { c, v: 10 + x % 10, bv: 3 + x % 7, poc: 198 + x % 5, covered: true, source: "synthetic-213" };
      if (name === "partial-coverage") {
        if (c % 257 === 0) col.covered = false;
        if (c % 509 === 0) { col.v = 0; col.bv = 0; col.poc = null; }
        if (c % 1021 === 0) col.poc = null;
      }
      return col;
    });
    const index = E.measure.seasonalIndex({ cols: cols.filter(c => c.covered), n, b0: 0, b1: count * step, source: "synthetic-213", precision: "Float64" });
    const sourceDigest = E.hash.hex(E.hash.sha256(E.hash.utf8(JSON.stringify(cols))));
    return { cols, n, m: 0, a: count - 1, b0: 0, b1: count * step, barrier: 1, horizon: 1, kind: "next-poc",
      provenance: { instrument: "SYNTHETIC-213", sourceDigest, packKey: ["synthetic-213", name, 12345], revision: "fixed-1", sourceCutoff: count * step, canonicalCutoff: count * step, replayEdge: null, measuredThrough: count * step, priceLow: 0, priceHigh: null, precisionID: "synthetic-integers+Float64" },
      seasonal: args => E.measure.seasonalActivity({ ...args, index }) };
  }
  // Hash every enumerable result field. Each JSON block contains at most 128
  // records, avoiding the giant JSON string / engine string limit. No sampled
  // rows or rounded numbers. Repeated references are serialized by value.
  async function fingerprint(result, digest) {
    const hash = value => digest(JSON.stringify(value));
    async function records(rows) {
      const chunks = [];
      for (let i = 0; i < rows.length; i += 128) chunks.push(await hash(rows.slice(i, i + 128)));
      return { count: rows.length, chunks, root: await hash(chunks) };
    }
    const fields = {};
    for (const key of Object.keys(result).sort()) {
      const value = result[key];
      fields[key] = key === "ledger" ? await records(value) : ["cases", "matched"].includes(key) ? await Promise.all(value.map(records)) : { root: await hash(value) };
    }
    return { version: "study-tree-sha256@1", recordsPerChunk: 128, fields, root: await hash(fields) };
  }
  function population(result) {
    const u = result.uncertainty;
    return { ledger: result.ledger.length, cases: result.cases.map(x => x.length), matched: result.matched.map(x => x.length), state: result.state,
      reasons: Object.fromEntries([...new Set(result.ledger.map(x => x.reason))].map(reason => [String(reason), result.ledger.filter(x => x.reason === reason).length])),
      fullMatched: u.fullMatched, calendarBlocks: u.calendarBlocks, seed: u.seed, key: u.key, resamples: u.resamples,
      validDraws: Object.fromEntries(Object.entries(u.intervals).map(([name, parts]) => [name, Object.fromEntries(Object.entries(parts).map(([part, x]) => [part, x.validDraws]))])),
      intervals: u.intervals, drawsRan: Object.values(u.intervals).some(parts => Object.values(parts).some(x => x.validDraws > 0)) };
  }
  return Object.freeze({ CASES: Object.freeze(CASES), input, fingerprint, population });
});
