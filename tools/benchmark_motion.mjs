#!/usr/bin/env node
// Paired local UX guard. Motion stays enabled; committed pages and identical fixtures
// are compared. This is a local diagnostic, not a designated-machine certificate.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { COMPARISON_KEY, comparisonFixture } from './benchmark/comparison.mjs';
const require = createRequire(import.meta.url);
const { materialise } = require('../tests/support/builds.js');
const { startFake } = require('../tests/support/cube-fake.js');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const baseline = process.argv[2] || '6a17b7cefb2ee2447bb2deffb924a4aaf61a61ae';
const candidate = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Commit and publish before measuring.');
const protocol = {
  version: 1, pairs: 5, viewport: { width: 1500, height: 950 }, reducedMotion: 'no-preference',
  budgets: { drawMs: 10, frameMs: 20, inputMs: 50, drawDeltaMs: .5, frameDeltaMs: 2, inputDeltaMs: 5, slowFrameShareDelta: .01 },
  definition: 'All samples retained. p95 draw callback, frame intervals and event to first canvas callback; DOM input to two frame boundaries. Paired medians compare p95; layout/task totals and measuring clones are reported.',
};
const cases = [
  { id: 'zoom-24h', hash: '#w=24h', action: 'navigate' },
  { id: 'zoom-all', hash: '#w=all', action: 'navigate' },
  { id: 'rows-lines', hash: '#w=30d&rows=volume&lines=1d,7d,30d,ema21,sma50,bb1d,svwap', action: 'navigate' },
  { id: 'candles', hash: '#w=7d&mode=candles', action: 'navigate' },
  { id: 'level-reversal', hash: '#w=24h', action: 'levels' },
  { id: 'inspector', hash: '#w=24h', action: 'side' },
  { id: 'disclosure', hash: '#w=24h&mode=path', action: 'details' },
  { id: 'comparison-128', hash: '#w=24h&tab=compare', action: 'comparison', captures: 128 },
  { id: 'phone-sheet', hash: '#w=24h', action: 'sheet', phone: true },
];
const p95 = xs => xs.length ? [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*.95)-1] : 0;
const median = xs => { const a=[...xs].sort((a,b)=>a-b); return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2; };
const pause = async page => { await page.waitForTimeout(850); };
async function trial(browser, build, definition) {
  const context = await browser.newContext({ viewport: definition.phone ? {width:390,height:844} : protocol.viewport,
    reducedMotion: protocol.reducedMotion, serviceWorkers: 'block' });
  try {
    await context.addInitScript({ path: path.resolve('tools/benchmark/instrument.js') });
    await context.addInitScript(({key, captures}) => {
      if (captures) sessionStorage.setItem(key, JSON.stringify(captures));
      const native = requestAnimationFrame;
      window.__motionPerf = { callbacks: [], domInput: [], measuringClones: 0, recording: false };
      window.requestAnimationFrame = callback => native(timestamp => {
        const start=performance.now();
        try { return callback(timestamp); }
        finally { if (window.__motionPerf.recording) window.__motionPerf.callbacks.push(performance.now()-start); }
      });
      addEventListener('click', event => {
        if (window.__motionPerf.recording) native(()=>native(()=>window.__motionPerf.domInput.push(performance.now()-event.timeStamp)));
      },{capture:true,passive:true});
      new MutationObserver(records => {
        if (window.__motionPerf.recording) for (const record of records) for (const node of record.addedNodes)
          if (node.matches?.('[data-flow-measuring]')) window.__motionPerf.measuringClones++;
      }).observe(document,{subtree:true,childList:true});
    }, {key:COMPARISON_KEY,captures:definition.captures ? comparisonFixture(definition.captures) : null});
    const page = await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    await page.goto(build.fake.url+'/'+definition.hash);
    await page.waitForFunction(()=>document.querySelector('#ol-loading').hidden);
    await build.fake.idle({quietMs:300,timeoutMs:20000});
    if(definition.captures) await page.locator('#ol-tab-compare').click();
    await pause(page);
    const counters=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const before=await counters();
    await page.evaluate(()=>{__bench.begin();__motionPerf.recording=true;});
    const box=await page.locator('#ol-canvas').boundingBox(), x=box.x+box.width/2,y=box.y+box.height/2;
    if(definition.action==='navigate') {
      await page.mouse.move(x,y);
      for(const direction of [1,-1]) for(let i=0;i<12;i++){await page.mouse.wheel(0,direction*100);await page.waitForTimeout(40);}
      await page.mouse.down();
      for(let i=0;i<20;i++){await page.mouse.move(x+Math.sin(i/19*Math.PI)*200,y+i*3);await page.waitForTimeout(16);}
      await page.mouse.up();
    } else if(definition.action==='levels') {
      await page.locator('#ol-canvas').focus();
      for(let i=0;i<12;i++){await page.keyboard.press(i%2?'[':']');await page.waitForTimeout(50);}
    } else if(definition.action==='side' || definition.action==='sheet') {
      const button=definition.action==='side'?'#ol-side-toggle':'#ol-sheet-toggle';
      for(let i=0;i<6;i++){await page.locator(button).click();await page.waitForTimeout(i%2?650:70);}
    } else if(definition.action==='details') {
      const button=page.locator('#ol-context details > summary').filter({hasText:'Cell counts'});
      for(let i=0;i<6;i++){await button.click();await page.waitForTimeout(i%2?650:70);}
    } else if(definition.action==='comparison') {
      const workspace=page.locator('#ol-comparisonWorkspace');
      for(const action of ['sort','matrix','expand','expand','cards','sort']) {
        const button=workspace.locator(action==='sort'?'[data-comparison-control="sort"]':action==='matrix'||action==='cards'?`[data-comparison-action="view"][data-value="${action==='cards'?'grid':'matrix'}"]`:`[data-comparison-action="${action}"]`).first();
        if(action==='sort') await button.selectOption('volume'); else await button.click();
        await page.waitForTimeout(650);
      }
    }
    await pause(page);
    const values=await page.evaluate(()=>{__motionPerf.recording=false;return {canvas:__bench.end(),...__motionPerf};});
    const after=await counters();
    if(errors.length)throw new Error(errors.join('\n'));
    return { draw:p95(values.canvas.draws), frame:p95(values.canvas.frameIntervals), input:p95([...values.canvas.inputToPaint,...values.domInput]),
      slowFrames:values.canvas.frameIntervals.filter(x=>x>33.3).length/values.canvas.frameIntervals.length,
      callbacks:p95(values.callbacks), measuringClones:values.measuringClones,
      layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000, styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,
      taskMs:(after.TaskDuration-before.TaskDuration)*1000, samples:{draws:values.canvas.draws.length,frames:values.canvas.frameIntervals.length,input:values.canvas.inputToPaint.length+values.domInput.length} };
  } finally { await context.close(); }
}
const builds = [materialise(baseline,'motion-baseline'),materialise(candidate,'motion-candidate')];
const samples=[];let browser;
try {
  for(const build of builds) build.fake=await startFake({mode:'live',profile:'bench',seed:20260924,cutoff:'2026-09-24T12:02:00.000000Z',pageRoot:build.dir});
  browser=await chromium.launch({channel:'chromium',headless:true});
  for(const definition of cases) for(let pair=0;pair<protocol.pairs;pair++) {
    const arms=pair%2?[1,0]:[0,1];
    for(const arm of arms) samples.push({case:definition.id,pair,arm:arm?'candidate':'baseline',...await trial(browser,builds[arm],definition)});
    process.stderr.write(`${definition.id} pair ${pair+1}/${protocol.pairs}\n`);
  }
  const summary=cases.map(definition=>{
    const rows=samples.filter(s=>s.case===definition.id), a=rows.filter(s=>s.arm==='baseline'),b=rows.filter(s=>s.arm==='candidate');
    const result={case:definition.id,baseline:{},candidate:{},pass:true};
    for(const field of ['draw','frame','input','slowFrames','callbacks','measuringClones','layoutMs','styleMs','taskMs']) {
      result.baseline[field]=median(a.map(s=>s[field]));result.candidate[field]=median(b.map(s=>s[field]));
    }
    for(const field of ['draw','frame','input']) {
      const cap=Math.max(protocol.budgets[field+'Ms'],result.baseline[field]+protocol.budgets[field+'DeltaMs']);
      if(result.candidate[field]>cap)result.pass=false;
    }
    if(result.candidate.slowFrames>result.baseline.slowFrames+protocol.budgets.slowFrameShareDelta)result.pass=false;
    return result;
  });
  const report={kind:'paired-local-motion-guard',baseline:builds[0],candidate:builds[1],protocol,cases,summary,samples,
    environment:{os:os.platform(),cpu:os.cpus()[0].model,browser:browser.version(),node:process.version},pass:summary.every(s=>s.pass)};
  report.baseline={sha:builds[0].sha,indexSha256:builds[0].indexSha256};report.candidate={sha:builds[1].sha,indexSha256:builds[1].indexSha256};
  fs.mkdirSync('reports/motion',{recursive:true});fs.writeFileSync('reports/motion/performance.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass:report.pass,summary},null,2));if(!report.pass)process.exitCode=1;
} finally { await browser?.close();for(const build of builds)await build.fake?.close(); }
