// Offline interpretation of the unchanged cube-presentation@1 observations.
// Usage: node tools/benchmark/presentation-assessment.mjs INITIAL_SUMMARY RUN_DIR OUTPUT_JSON
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { analyze, noiseFloor, improvement, median } = require('./presentation-metrics.cjs');
const [initialFile, runDir, output] = process.argv.slice(2);
if (!initialFile || !runDir || !output) throw Error('Supply initial summary, extracted run directory and output JSON.');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const initial = JSON.parse(fs.readFileSync(initialFile)), current = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json')));
assert.equal(initial.kind, 'pre-candidate-AA');
assert.equal(initial.complete, true, 'The complete pre-candidate baseline is required');
assert.equal(current.kind, 'paired-AA-then-AB');
assert.equal(current.complete, true, 'The complete candidate collection is required');
assert.equal(current.schema, initial.schema);
assert.deepEqual(current.instrumentation, initial.instrumentation, 'The measurement implementation must be identical');
assert.deepEqual(current.protocol, initial.protocol, 'The predeclared protocol must be identical');
for (const [file, expected] of Object.entries(initial.instrumentation)) assert.equal(hash(fs.readFileSync(file)), expected, file);
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'))), traces = new Map();
assert.equal(hash(fs.readFileSync(path.join(runDir, 'summary.json'))), manifest.files.find(file => file.path === 'summary.json')?.sha256);
for (const file of manifest.files.filter(file => file.path.endsWith('.json.gz'))) {
  assert.equal(path.basename(file.path), file.path);
  const bytes = fs.readFileSync(path.join(runDir, file.path));
  assert.equal(hash(bytes), file.sha256, file.path);
  traces.set(file.path, JSON.parse(zlib.gunzipSync(bytes)).trace);
}
let reanalyzed = 0;
for (const row of current.samples) {
  const trace = traces.get(row.raw);
  if (!trace) { assert.notEqual(row.outcome, 'complete', row.raw); continue; }
  const build = current.builds[row.stage === 'ab' && row.arm === 'B' ? 1 : 0];
  assert.equal(row.build, build.sha, row.raw);
  assert.equal(trace.build.sha, build.sha, row.raw);
  assert.equal(trace.build.sourceIndexSha256, build.indexSha256, row.raw);
  assert.equal(trace.build.instrumentedIndexSha256, build.instrumentedIndexSha256, row.raw);
  const ack = row.group === 'continuity' ? trace.acks.at(-1) : trace.ack;
  const protocol = row.group === 'continuity' ? { ...current.protocol, captureMs: current.protocol.captureMs - (ack.at - trace.ack.at) } : current.protocol;
  const actual = analyze({ ...trace, ack }, protocol);
  assert.equal(actual.outcome, row.outcome, row.raw);
  if (row.outcome === 'complete') assert.ok(Math.abs(actual.presentationMs - row.presentationMs) < 1e-8, row.raw);
  reanalyzed++;
}
assert.equal(reanalyzed, current.samples.length, 'Every candidate trial must have a raw observation');
const paired = (stage, id) => Array.from({ length: current.protocol.pairs }, (_, pair) => ['A', 'B'].map(arm => {
  const rows = current.samples.filter(row => row.stage === stage && row.case === id && row.pair === pair && row.arm === arm);
  assert.ok(rows.length <= 1, 'Duplicate trial: ' + [stage, id, pair, arm].join('/'));
  return rows[0] ?? { outcome: 'missing' };
}));
function headerCycle(row) {
  const trace = traces.get(row.raw), tolerance = current.protocol.tolerances.positionCssPx;
  if (row.outcome !== 'complete' || !trace) return { outcome: 'inconclusive' };
  const headers = trace.actors.filter(actor => actor.tag === 'HEADER' && actor.role === 'ancestor');
  if (headers.length !== 1) return { outcome: 'inconclusive', reason: 'No unique observed toolbar ancestor' };
  const id = headers[0].id, frames = trace.frames.map(frame => ({ at: frame.at, height: frame.poses.find(pose => pose[0] === id)?.[4] }));
  if (!frames.every(frame => Number.isFinite(frame.height))) return { outcome: 'inconclusive', reason: 'Missing toolbar pose' };
  const inputAt = trace.inputs[trace.ack.input]?.at;
  const before = frames.filter(frame => frame.at <= inputAt).at(-1)?.height, final = frames.at(-1).height;
  if (!Number.isFinite(before) || Math.abs(before - final) > tolerance) return { outcome: 'inconclusive', reason: 'Toolbar endpoints differ' };
  let previous = before, transitions = 0;
  const after = frames.filter(frame => frame.at >= inputAt);
  for (const frame of after) if (Math.abs(frame.height - previous) > tolerance) { transitions++; previous = frame.height; }
  return { outcome: 'complete', raw: row.raw, actor: id, beforeHeightCssPx: before, finalHeightCssPx: final,
    maximumExcursionCssPx: Math.max(...after.map(frame => Math.abs(frame.height - final))), transitions };
}
const range = values => values.length ? { median: median(values), minimum: Math.min(...values), maximum: Math.max(...values) } : null;
const cases = current.protocol.primaryCases.map(definition => {
  const pairs = paired('ab', definition.id), fresh = noiseFloor(paired('aa', definition.id)), original = initial.floors[definition.id];
  const floor = original?.outcome === 'complete' && fresh.outcome === 'complete'
    ? { ...fresh, floorMs: Math.max(original.floorMs, fresh.floorMs) } : { outcome: 'inconclusive' };
  let work = { demonstrated: false, reason: 'No separate unnecessary-work removal is claimed for this case' };
  if (definition.id === 'phone-close') {
    const before = pairs.map(pair => headerCycle(pair[0])), after = pairs.map(pair => headerCycle(pair[1]));
    work = { kind: 'temporary-toolbar-layout-cycle',
      preregistration: 'stylesheetAllowance.reason: the 49→139 px toolbar excursion selected before candidate edits',
      demonstrated: before.every(row => row.outcome === 'complete' && row.transitions >= 2 && row.maximumExcursionCssPx > current.protocol.tolerances.positionCssPx) &&
        after.every(row => row.outcome === 'complete' && row.transitions === 0 && row.maximumExcursionCssPx <= current.protocol.tolerances.positionCssPx),
      before, after, limitation: 'Counts observed normal-flow height changes; does not claim a browser-internal layout count or CPU duration.' };
  }
  const result = improvement(pairs, floor, work.demonstrated);
  const rows = arm => pairs.map(pair => pair[arm]).filter(row => row.outcome === 'complete');
  const stats = arm => Object.fromEntries(['presentationMs', 'excessMs', 'markerMs', 'cssMs'].map(key => [key, range(rows(arm).map(row => row[key]).filter(Number.isFinite))]));
  return { case: definition.id, ...result, initialFloor: original, workerFloor: fresh, baseline: stats(0), candidate: stats(1), work };
});
const focus = current.samples.filter(row => row.stage === 'ab' && row.arm === 'B' &&
  ['phone-close', 'phone-escape', 'phone-close-outside', 'phone-escape-outside'].includes(row.case)).map(row => ({
  case: row.case, pair: row.pair, raw: row.raw, ...row.compatibility,
  correct: row.outcome === 'complete' && row.compatibility?.immediateFocus === row.compatibility?.expectedCloseFocus &&
    row.compatibility?.firstFrameFocus === row.compatibility?.expectedCloseFocus && row.compatibility?.finalFocus === row.compatibility?.expectedCloseFocus }));
const assessment = { schema: 'cube-presentation-assessment@1', metric: current.schema,
  initialSummarySha256: hash(fs.readFileSync(initialFile)), runSummarySha256: hash(fs.readFileSync(path.join(runDir, 'summary.json'))),
  implementationSha256: hash(fs.readFileSync(new URL(import.meta.url))),
  initialProducer: initial.runnerCommit, candidateProducer: current.runnerCommit, candidatePrHead: current.prHead,
  allRawTrialHashesVerified: true, rawTrialsReanalyzed: reanalyzed, collectorComplete: current.complete,
  cases, focus, allObservedClosingFocusCorrect: focus.length === 8 && focus.every(row => row.correct),
  limits: ['The producer summary remains unchanged. This separate assessment supplies the declared work evidence to the existing improvement function.',
    'Only phone-close has a claimed unnecessary-layout removal. Numeric gains in other cases cannot manufacture that claim.',
    'Styled-DOM geometry/opacity is not canvas-pixel or physical-display presentation.',
    'This does not replace the unmodified motion guards or waive #96 absolute/cumulative budgets.'] };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(assessment, null, 2) + '\n');
console.log(JSON.stringify({ collectorComplete: assessment.collectorComplete, rawTrialsReanalyzed: reanalyzed,
  focusCorrect: assessment.allObservedClosingFocusCorrect, cases: cases.map(row => ({ case: row.case, outcome: row.outcome, medianGainMs: row.medianGainMs, floorMs: row.floorMs, workReduction: row.workReduction })) }, null, 2));
