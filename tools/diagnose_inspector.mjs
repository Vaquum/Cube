// Remote-CI attribution only. The frozen guard remains byte-for-byte unchanged.
// Run --check locally to validate this adapter without starting a browser.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frozenRef = 'd8449f3acab8af9fd2d0dd46bd2a95f148a189c6';
const checkOnly = process.argv.includes('--check');
const baseline = process.argv.slice(2).find(arg => arg !== '--check') || frozenRef;
assert.match(baseline, /^[a-f0-9]{40}$/);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const guard = path.join(root, 'tools/benchmark_motion.mjs');
const original = fs.readFileSync(guard, 'utf8');
assert.equal(original, execFileSync('git', ['show', frozenRef + ':tools/benchmark_motion.mjs'], { cwd: root, encoding: 'utf8' }));
let adapted = original;
function replaceOnce(before, after) {
  const parts = adapted.split(before);
  assert.equal(parts.length, 2, 'Frozen diagnostic adaptation no longer matches: ' + before);
  adapted = parts.join(after);
}
replaceOnce('if(profile) cases.splice(1);',
  "if(profile) { const selected = cases.find(row => row.id === 'inspector'); if (!selected) throw Error('Inspector case missing'); cases.splice(0, cases.length, selected); }");
replaceOnce('events:values.inputEvents, samples:', 'events:values.inputEvents, raw:values, samples:');
const temporary = path.join(root, 'tools/.inspector-profile-' + process.pid + '.mjs');
try {
  fs.writeFileSync(temporary, adapted);
  const args = checkOnly ? ['--check', temporary] : [temporary, baseline, '--profile'];
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Diagnostic collection failed');
  if (checkOnly) {
    console.log('Adapter syntax and frozen-source admissions verified; no browser started.');
  } else {
    const out = path.join(root, 'reports/motion');
    const report = JSON.parse(fs.readFileSync(path.join(out, 'diagnostic-profile.json')));
    assert.equal(report.kind, 'cpu-diagnostic-not-budget-evidence');
    assert.equal(report.protocol.pairs, 1);
    assert.equal(report.cases.length, 1);
    assert.equal(report.cases[0].id, 'inspector');
    assert.equal(report.samples.length, 2);
    assert.ok(report.samples.every(row => row.raw?.canvas?.frameIntervals?.length && row.raw.canvas.draws.length));
    for (const build of [report.baseline, report.candidate])
      assert.ok(JSON.parse(fs.readFileSync(path.join(out, 'cpu-' + build.sha + '.json'))).nodes.length);
    const files = fs.readdirSync(out).filter(name => name.endsWith('.json') && name !== 'inspector-manifest.json').sort().map(name => {
      const bytes = fs.readFileSync(path.join(out, name));
      return { path: name, bytes: bytes.length, sha256: hash(bytes) };
    });
    fs.writeFileSync(path.join(out, 'inspector-manifest.json'), JSON.stringify({
      schema: 'cube-inspector-attribution@1', kind: 'profile-only-not-budget-evidence',
      head: git('rev-parse', 'HEAD'), frozenGuardRef: frozenRef,
      frozenGuardSha256: hash(original), adaptedDiagnosticSha256: hash(adapted),
      adapterSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
      adaptations: ['Select the existing Inspector case for the existing one-pair CPU profile mode.', 'Retain complete existing frame/draw/callback/input arrays.'],
      limits: ['CPU profiling changes execution costs. These samples cannot pass or replace the unchanged motion guard.', 'The profile-mode pass field means collection succeeded; it is not budget acceptance.'],
      files,
    }, null, 2) + '\n');
  }
} finally {
  fs.rmSync(temporary, { force: true });
  assert.equal(fs.readFileSync(guard, 'utf8'), original);
}
