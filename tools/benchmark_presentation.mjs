#!/usr/bin/env node
// Remote CI only: do not launch another browser on the user's machine.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { presentationBuild, hash } from './benchmark/presentation-build.mjs';
import { definition, fixture, prepare, act, settle, validate } from './benchmark/presentation-cases.mjs';
import { COMPARISON_KEY } from './benchmark/comparison.mjs';
const require = createRequire(import.meta.url);
const { startFake } = require('../tests/support/cube-fake.js');
const { analyze, noiseFloor, improvement, median, p95 } = require('./benchmark/presentation-metrics.cjs');
if (process.env.GITHUB_ACTIONS !== 'true') throw Error('This runner is restricted to remote GitHub Actions; use the existing side panel locally.');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Commit the protocol and harness before measurement.');
const protocol = JSON.parse(fs.readFileSync('tools/benchmark/presentation.v1.json'));
const head = git('rev-parse', 'HEAD'), out = 'reports/presentation';
fs.mkdirSync(out, { recursive: true });
const instrumentation = ['tools/benchmark/presentation.v1.json', 'tools/benchmark/presentation-probe.js',
  'tools/benchmark/presentation-build.mjs', 'tools/benchmark/presentation-cases.mjs', 'tools/benchmark/presentation-metrics.cjs', 'tools/benchmark_presentation.mjs'];
const hashes = Object.fromEntries(instrumentation.map(file => [file, hash(fs.readFileSync(file))]));
const sources = [protocol.baseline, head].map((sha, i) => presentationBuild(sha, 'presentation-' + i,
  'https://github.com/Vaquum/Market-State-Cube-Explorer/pull/' + (i ? process.env.PRESENTATION_PR_NUMBER : '218')));
const sourceHash = (sha, file) => hash(execFileSync('git', ['show', sha + ':' + file], { maxBuffer: 64 * 1024 * 1024 }));
const frozen = protocol.frozenFiles.map(file => ({ file, baseline: sourceHash(protocol.baseline, file), candidate: sourceHash(head, file) }));
if (frozen.some(file => file.baseline !== file.candidate)) throw Error('A frozen movement/diagnostics/guard file changed.');
const candidateChanged = sources[0].indexSha256 !== sources[1].indexSha256;
const initialPath = 'docs/evidence/212/baseline/summary.json';
const initial = fs.existsSync(initialPath) ? JSON.parse(fs.readFileSync(initialPath)) : null;
const compare = process.argv.includes('--candidate') && candidateChanged;
if (compare && (!initial || !Object.entries(hashes).every(([file, value]) => initial.instrumentation[file] === value)))
  throw Error('A candidate requires a retained pre-change baseline with this exact protocol and instrumentation.');
const primary = protocol.primaryCases.map(raw => definition(raw));
const continuity = protocol.continuityCases.map(raw => definition(raw, 'continuity'));
const controls = protocol.controls.map(raw => definition(raw, 'control'));
const all = [...primary, ...continuity, ...controls], samples = [], artifacts = [], servers = new Map();
let browser;
function retain(relative, value) {
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(value) + '\n'), { level: 9 });
  fs.writeFileSync(path.join(out, relative), bytes);
  artifacts.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), encoding: 'gzip-json' });
}
async function server(build, profile) {
  const key = build.sha + ':' + profile;
  if (!servers.has(key)) servers.set(key, await startFake({ mode: 'live', profile, seed: protocol.fixture.seed, cutoff: protocol.fixture.cutoff, pageRoot: build.dir }));
  return servers.get(key);
}
async function trial(build, d, stage, pair, arm) {
  const context = await browser.newContext({ viewport: d.phone ? protocol.phone : protocol.desktop,
    reducedMotion: d.id === 'phone-reduced' ? 'reduce' : protocol.reducedMotion, serviceWorkers: 'block' });
  const id = `${stage}-${d.id}-${pair}-${arm}`, errors = [];
  let page, trace, diagnostics, failure;
  try {
    await context.addInitScript({ path: path.resolve('tools/benchmark/presentation-probe.js') });
    await context.addInitScript(({ key, model }) => {
      sessionStorage.setItem('cube-performance-record-next-load', '1');
      if (model) sessionStorage.setItem(key, JSON.stringify(model));
    }, { key: COMPARISON_KEY, model: fixture(d) });
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    const fake = await server(build, d.profile);
    await page.goto(fake.url + '/' + d.hash);
    await page.waitForFunction(() => document.querySelector('#ol-loading')?.hidden && !document.querySelector('#ol-canvas[data-startup]'), null, { timeout: 30000 });
    await fake.idle({ quietMs: 300, timeoutMs: 20000 }); await settle(page);
    await prepare(page, d); await act(page, d); await settle(page); // Unrecorded warm-up.
    await prepare(page, d);
    await page.evaluate(settings => window.__presentation212.begin(settings), { ...protocol, ...d });
    const transportStarted = performance.now();
    await act(page, d);
    const transportReturnedMs = performance.now() - transportStarted;
    trace = await page.evaluate(() => window.__presentation212.done);
    trace = validate(trace, d); trace.toolActionReturnedMs = transportReturnedMs;
    trace.errors = errors; if (errors.length) trace.invalidReasons.push('pageerror');
    trace.build = { sha: build.sha, sourceIndexSha256: build.indexSha256, instrumentedIndexSha256: build.instrumentedIndexSha256 };
    if (d.group === 'continuity') {
      // The primary endpoint is not attributed to a superseded request. Keep
      // the whole trajectory, but score the final request over its actual window.
      trace.superseded = trace.acks.slice(0, -1).map(ack => ack.input);
    }
    const scored = d.group === 'continuity' ? { ...trace, ack: trace.acks.at(-1) } : trace;
    const scoringProtocol = d.group === 'continuity' ? { ...protocol, captureMs: protocol.captureMs - (scored.ack.at - trace.ack.at) } : protocol;
    const metric = analyze(scored, scoringProtocol);
    const record = { stage, case: d.id, group: d.group, pair, arm, build: build.sha, ...metric,
      compatibility: trace.compatibility, validation: trace.validation, environment: trace.capabilities,
      observer: { medianMs: median(trace.frames.map(frame => frame.probeMs)), p95Ms: p95(trace.frames.map(frame => frame.probeMs)) },
      cssAnimations: trace.cssAnimations.length, ghostCount: trace.actors.filter(actor => actor.ghost).length,
      targetChanges: trace.channels.filter(event => event.type === 'target').length, callbackCount: trace.channels.filter(event => event.type === 'callback').length,
      raw: id + '.json.gz' };
    samples.push(record);
    // Export after the independent observation. This can change the drawer,
    // and therefore must never be included in that action's measured window.
    const download = page.waitForEvent('download');
    await page.locator('#ol-diagnostics-export').evaluate(node => node.click());
    await download;
    diagnostics = await page.locator('#ol-diagnostics-output').evaluate(node => JSON.parse(node.value));
    record.diagnosticsTruncated = diagnostics.truncated;
    if (pair === 0 && arm === 'A') {
      const screenshot = `${stage}-${d.id}.png`;
      await page.screenshot({ path: path.join(out, screenshot) });
      const bytes = fs.readFileSync(path.join(out, screenshot)); artifacts.push({ path: screenshot, bytes: bytes.length, sha256: hash(bytes) });
    }
    return record;
  } catch (error) {
    failure = String(error.stack ?? error);
    const record = { stage, case: d.id, group: d.group, pair, arm, build: build.sha, outcome: 'inconclusive', reason: failure, raw: id + '.json.gz' };
    samples.push(record); return record;
  } finally {
    retain(id + '.json.gz', { trace, diagnostics, failure, errors });
    await context.close();
  }
}
function paired(stage, id) {
  return Array.from({ length: protocol.pairs }, (_, pair) => ['A', 'B'].map(arm => samples.find(sample => sample.stage === stage && sample.case === id && sample.pair === pair && sample.arm === arm)));
}
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  for (const stage of compare ? ['aa', 'ab'] : ['aa']) {
    for (const d of all) {
      const pairs = d.group === 'primary' || d.id === 'phone-reduced' ? protocol.pairs : 1;
      for (let pair = 0; pair < pairs; pair++) {
        for (const arm of pair % 2 ? ['B', 'A'] : ['A', 'B']) {
          const build = stage === 'ab' && arm === 'B' ? sources[1] : sources[0];
          const result = await trial(build, d, stage, pair, arm);
          process.stderr.write(JSON.stringify({ stage, case: d.id, pair, arm, outcome: result.outcome, presentationMs: result.presentationMs, reason: result.reason }) + '\n');
        }
      }
    }
  }
} finally {
  await browser?.close(); for (const fake of servers.values()) await fake.close();
  const floors = Object.fromEntries([...primary, controls.find(d => d.id === 'phone-reduced')].map(d => [d.id, noiseFloor(paired('aa', d.id).map(pair => pair.map(value => value ?? { outcome: 'missing' })))]));
  const comparisons = compare ? primary.map(d => {
    const current = floors[d.id], original = initial.floors[d.id];
    const floor = current.outcome === 'complete' && original?.outcome === 'complete' ? { ...current, floorMs: Math.max(current.floorMs, original.floorMs) } : { outcome: 'inconclusive' };
    // Work evidence must be assessed from retained traces. A faster number
    // cannot automatically manufacture a claimed unnecessary-work reduction.
    return { case: d.id, ...improvement(paired('ab', d.id).map(pair => pair.map(value => value ?? { outcome: 'missing' })), floor, false) };
  }) : [];
  const summary = { schema: protocol.schema, kind: compare ? 'paired-AA-then-AB' : 'pre-candidate-AA', protocol,
    runnerCommit: head, prHead: process.env.PRESENTATION_PR_HEAD ?? null, instrumentation: hashes, frozen,
    builds: sources.map(({ dir, ...build }) => build), floors, comparisons, samples,
    environment: { os: os.platform(), cpu: os.cpus()[0]?.model, node: process.version, browser: browser?.version(), actionsRun: process.env.GITHUB_RUN_ID },
    limitations: ['Styled-DOM submission is not physical display presentation.', 'Identical observers add DOM/style reads; per-sample observer cost is retained.', 'Shared CI worker does not certify designated-host or cumulative #96 budgets.', 'Compatibility observations are separate from latency gains.'],
    complete: all.every(d => samples.filter(sample => sample.case === d.id).length === (d.group === 'primary' || d.id === 'phone-reduced' ? protocol.pairs : 1) * 2 * (compare ? 2 : 1)) && samples.every(sample => sample.outcome === 'complete' && !sample.diagnosticsTruncated) };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ runnerCommit: head, instrumentation: hashes, files: [...artifacts, { path: 'summary.json', sha256: hash(fs.readFileSync(path.join(out, 'summary.json'))) }] }, null, 2) + '\n');
  console.log(JSON.stringify({ complete: summary.complete, floors, comparisons }, null, 2));
  if (!summary.complete) process.exitCode = 1;
}
