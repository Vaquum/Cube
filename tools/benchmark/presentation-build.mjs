import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url), { materialise } = require('../../tests/support/builds.js');
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function instrument(html) {
  const edits = [
    ['  function spring(owner, name, options) {', '  function spring(owner, name, options) {\n      const presentationBefore212 = scope.__presentation212?.before(owner, name, channels.get(owner)?.get(name));'],
    ['      channel.active = true;', '      channel.active = true;\n      scope.__presentation212?.spring(owner, name, channel, presentationBefore212);'],
    ['      channel.target = { ...next };', '      scope.__presentation212?.target(channel, next);\n      channel.target = { ...next };'],
    ["      ghost.dataset.flowRetiring = '';", "      ghost.dataset.flowRetiring = '';\n      scope.__presentation212?.retire(element, ghost);"],
    ['      if (channel.generation === generation)\n          channel.options.complete?.();', '      if (channel.generation === generation) {\n          scope.__presentation212?.callback(channel, generation);\n          channel.options.complete?.();\n      }']
  ];
  for (const [before, after] of edits) {
    if (html.split(before).length !== 2) throw Error('Presentation hook is not unique: ' + before);
    html = html.replace(before, after);
  }
  return html;
}
export function presentationBuild(sha, label) {
  const build = materialise(sha, label), source = fs.readFileSync(path.join(build.dir, 'index.html'), 'utf8');
  let html = instrument(source);
  const committedAt = execFileSync('git', ['show', '-s', '--format=%cI', build.sha], { encoding: 'utf8' }).trim();
  for (const [name, value] of [['explorer-commit', build.sha], ['explorer-committed-at', committedAt]])
    html = html.replace(new RegExp('(<meta name="' + name + '" content=")[^"]*(">)'), (_, a, b) => a + value + b);
  fs.writeFileSync(path.join(build.dir, 'index.html'), html);
  return { ...build, instrumentedIndexSha256: hash(html), committedAt,
    modification: 'Exact committed index/vendor with deployment-style build metadata and five test-only motion hooks. Independent DOM observer supplied through the test context; no production source is modified.' };
}
