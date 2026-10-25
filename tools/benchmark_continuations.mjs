#!/usr/bin/env node
// Browser execution is restricted to remote GitHub Actions. For native local
// collection use diagnose_continuations --serve in the existing side panel.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { serveStudy, hash } from './benchmark/continuations-page.mjs';
const require=createRequire(import.meta.url), {startFake}=require('../tests/support/cube-fake.js'), {materialise}=require('../tests/support/builds.js');
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Remote GitHub Actions only; local browser access is limited to the existing side panel.');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
if(git('status','--porcelain','--untracked-files=no'))throw Error('Commit the measurement definition and harness first.');
const head=git('rev-parse','HEAD'), protocol=JSON.parse(fs.readFileSync('tools/benchmark/continuations.v1.json')), candidate=process.argv.includes('--candidate');
const out='reports/continuations', files=[], samples=[];fs.mkdirSync(out,{recursive:true});
const instrumentFiles=['tools/benchmark/continuations.v1.json','tools/benchmark/continuations-page.mjs','tools/benchmark_continuations.mjs','tests/support/evidence-study.js'];
const instrumentation=Object.fromEntries(instrumentFiles.map(file=>[file,hash(fs.readFileSync(file))]));
const golden=JSON.parse(fs.readFileSync('tests/fixtures/evidence-study.json'));
const initialPath='docs/evidence/213/baseline/summary.json',initial=fs.existsSync(initialPath)?JSON.parse(fs.readFileSync(initialPath)):null;
if(candidate&&(!initial||Object.entries(instrumentation).some(([file,value])=>initial.instrumentation[file]!==value)))throw Error('A candidate requires an identical-instrument pre-edit A/A baseline.');
if(!candidate)for(const file of ['src/encoding.js','src/evidence.js','src/explorer.js','index.html']){
  if(git('rev-parse',head+':'+file)!==git('rev-parse',protocol.implementationParent+':'+file))throw Error('Initial baseline must precede product edits: '+file);
}
function retain(id,value){const bytes=zlib.gzipSync(JSON.stringify(value)+'\n',{level:9}),file=id+'.json.gz';fs.writeFileSync(path.join(out,file),bytes);files.push({file,bytes:bytes.length,sha256:hash(bytes)});}
function appBuild(ref,label){const build=materialise(ref,label),original=fs.readFileSync(path.join(build.dir,'index.html'),'utf8');let html=original;
  for(const [name,value]of [['explorer-commit',build.sha],['explorer-committed-at',git('show','-s','--format=%cI',build.sha)],['explorer-pr','https://github.com/Vaquum/Market-State-Cube-Explorer/issues/213']]){
    const before='<meta name="'+name+'" content="">';if(html.split(before).length!==2)throw Error('Missing build metadata');html=html.replace(before,'<meta name="'+name+'" content="'+value+'">');}
  fs.writeFileSync(path.join(build.dir,'index.html'),html);return {...build,stampedIndexSha256:hash(html)};
}
function appProfile(){const step=900000,epoch=Date.parse('2021-01-01T00:00:00Z'),trades=[];let x=12345;
  for(let c=0;c<100000;c++){x=(Math.imul(1664525,x)+1013904223)>>>0;const price=(198+x%5)*12500+6250,v=10+x%10,bv=3+x%7;
    for(const [offset,volume,takerBuy] of [[60000,bv,true],[120000,v-bv,false]])trades.push({t_ms:c*step+offset,price,qty:Math.max(1,Math.round(volume/(price/100)*1e8)),takerBuy});}
  return {name:'SYNTHETIC 100k n4 complete study, seed 12345',cutoffIso:new Date(epoch+100000*step).toISOString(),trades};
}
const profile=appProfile(), servers=new Map(), builds=new Map(), browser=await chromium.launch({headless:true,channel:'chromium'});
async function kernel(ref,id,name){
  if(!servers.has(ref))servers.set(ref,await serveStudy(ref));const server=servers.get(ref), context=await browser.newContext({viewport:protocol.viewport,deviceScaleFactor:protocol.dpr,serviceWorkers:'block'}),errors=[];
  try{const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));await page.goto(server.url);await page.locator('#case').selectOption(name);await page.locator('#run').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='Complete'||document.querySelector('#status').textContent.startsWith('Failed:'),null,{timeout:120000});
    const raw=await page.locator('#report').inputValue(),report=JSON.parse(raw),sample=report.samples[0],expected=golden.cases.find(x=>x.name===name);
    const valid=errors.length===0&&report.identity.sha===ref&&sample?.outcome==='whole-study-completed'&&sample?.fingerprint.root===expected.root&&JSON.stringify(sample.population)===JSON.stringify(expected.population)&&sample.visibility.every(x=>x.state==='visible');
    retain(id,{...report,htmlSha256:server.htmlSha256,errors,valid});samples.push({id,kind:'kernel',case:name,ref,wallMs:sample?.computeWallMs,outcome:sample?.outcome,valid,root:sample?.fingerprint.root});if(!valid)throw Error('Invalid whole-study kernel observation '+id);
  }finally{await context.close();}
}
async function application(ref,id){
  if(!builds.has(ref))builds.set(ref,appBuild(ref,'continuations-app'));const build=builds.get(ref),fake=await startFake({profile,pageRoot:build.dir,quiet:3600,next:3600}),context=await browser.newContext({viewport:protocol.viewport,deviceScaleFactor:protocol.dpr,serviceWorkers:'block'}),errors=[];
  try{await context.addInitScript(()=>sessionStorage.setItem('cube-performance-record-next-load','1'));const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
    const navigationAt=performance.now();await page.goto(fake.url+'/#w=24h&r=4,0&auto=0&vis=2');
    await page.waitForFunction(()=>document.getElementById('ol-loading')?.hidden&&!document.querySelector('#ol-canvas[data-startup]'),null,{timeout:60000});const loadReturnedMs=performance.now()-navigationAt;
    const endpoints=[];
    for(const name of ['first','warm']){if(name==='warm')await page.locator('#ol-context-tab').click();const at=performance.now();await page.locator('#ol-evidence-tab').click();
      await page.waitForFunction(()=>document.getElementById('ol-evidence')?.getAttribute('aria-busy')==='false'&&document.getElementById('ol-evidence-intervals')?.dataset.bootstrap,null,{timeout:120000});
      endpoints.push({name,automationWallMs:performance.now()-at,bootstrap:JSON.parse(await page.locator('#ol-evidence-intervals').getAttribute('data-bootstrap'))});}
    await page.locator('#ol-tab-query').click();await page.locator('#ol-diagnostics summary').click();await page.locator('#ol-diagnostics-export').click();
    const report=JSON.parse(await page.locator('#ol-diagnostics-output').inputValue()), output=report.events.filter(x=>x.type==='continuations-output').at(-1), inputs=report.events.filter(x=>x.type==='input'&&x.target==='ol-evidence-tab'&&x.event==='click');
    const completions=report.events.filter(x=>x.type==='phase-end'&&x.name==='continuations'&&x.outcome==='completed'),first=completions.find(x=>x.at>=inputs[0]?.at&&x.at<inputs[1]?.at),warm=report.events.find(x=>x.type==='continuations-cache-hit'&&x.at>=inputs[1]?.at);
    const valid=!errors.length&&!report.truncated&&output?.n===4&&output?.ledger===100000&&endpoints.every(x=>x.bootstrap.fullMatched>=20&&Object.values(x.bootstrap.intervals).every(parts=>Object.values(parts).every(value=>value.validDraws===2000)))&&inputs.length===2&&first&&warm&&warm.at>=inputs[1].at;
    const firstMs=first?first.at-inputs[0]?.at:null,warmMs=warm?warm.at-inputs[1]?.at:null;
    retain(id,{kind:'whole-app',build,loadReturnedMs,endpoints,report,reads:fake.log(),errors,valid,firstMs,warmMs,limitation:'firstMs is input click to complete compute phase; actual busy-clear/DOM result separately observed by the wait and bootstrap. Not compositor presentation or backend CPU.'});
    samples.push({id,kind:'application',ref,case:'cap-first-and-warm',firstMs,warmMs,valid});if(!valid)throw Error('Invalid whole-app observation '+id);
  }finally{await context.close();await fake.close();}
}
let failure;
try{
  for(const stage of candidate?['aa','ab']:['aa'])for(let pair=0;pair<protocol.pairs;pair++)for(const arm of pair%2?['B','A']:['A','B']){
    const ref=stage==='ab'&&arm==='B'?head:protocol.baseline;
    for(const name of protocol.kernelCases)await kernel(ref,`${stage}-${pair}-${arm}-${name}`,name);
    await application(ref,`${stage}-${pair}-${arm}-app`);
  }
}catch(error){failure=String(error.stack??error);}
finally{
  await browser.close();for(const server of servers.values())await server.close();
  const summary={schema:protocol.schema,stage:candidate?'paired-candidate':'pre-candidate-aa',producer:head,complete:!failure,protocol,instrumentation,browser:browser.version(),host:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,node:process.version},samples,files,failure};
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
}
if(failure)throw Error(failure);
