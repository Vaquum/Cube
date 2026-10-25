#!/usr/bin/env node
// Pure Node characterization; never launches a browser. Run before product edits.
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), vm = require("node:vm"), { execFileSync } = require("node:child_process");
const fixture = require("../tests/support/evidence-study.js");
const ref = process.argv[2], output = process.argv[3];
if (!ref || !output) throw Error("Usage: node tools/characterize_evidence.cjs <commit> <output.json> [case]");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const sha = git("rev-parse", ref + "^{commit}").trim(), sources = {};
function load(file) {
  const source = git("show", sha + ":" + file); sources[file] = crypto.createHash("sha256").update(source).digest("hex");
  const scope = { module: { exports: {} }, setTimeout, clearTimeout, TextEncoder, performance };
  vm.runInNewContext(source, scope, { filename: file }); return scope.module.exports;
}
const E = load("src/encoding.js"), H = load("src/evidence.js");
const digest = text => crypto.createHash("sha256").update(text).digest("hex");
(async () => {
  const samples = [];
  for (const name of process.argv[4] ? [process.argv[4]] : fixture.CASES) {
    const args = fixture.input(E, name), began = performance.now();
    const result = await H.compute(args);
    const computeWallMs = performance.now() - began;
    const fingerprint = await fixture.fingerprint(result, digest), population = fixture.population(result);
    samples.push({ name, inputDigest: args.provenance.sourceDigest, computeWallMs, population, fingerprint });
    process.stderr.write(name + ": " + population.ledger + " rows, " + population.cases[1] + " cases, " + population.fullMatched + " full matches, " + population.validDraws.up.baseline + " draws, " + fingerprint.root + "\n");
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ schema: "evidence-characterization@1", sha, sources, fixtureSha256: digest(fs.readFileSync(require.resolve("../tests/support/evidence-study.js"))), runtime: process.version,
    note: "Whole deterministic output, not browser performance evidence. Timing excludes fingerprinting and input construction; Node scheduling is not a browser certificate.", samples }, null, 2) + "\n");
})().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
