#!/usr/bin/env node
// Offline audit only. The declared complete-DOM endpoint is the original
// endpoints[].automationWallMs, not firstMs (a secondary compute-phase wall).
"use strict";
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),same=(a,b)=>assert.deepEqual(a,b);
const median=xs=>{const s=xs.slice().sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const p95=xs=>xs.slice().sort((a,b)=>a-b)[Math.ceil(xs.length*.95)-1];
const source=(sha,file)=>{assert.match(sha,/^[a-f0-9]{40}$/);return execFileSync('git',['show',sha+':'+file],{maxBuffer:32*1024*1024});};
const golden=new Map(require('../../tests/fixtures/evidence-study.json').cases.map(x=>[x.name,x]));
function fingerprint(tree){
  same(tree.version,'study-tree-sha256@1');same(tree.recordsPerChunk,128);
  for(const value of Object.values(tree.fields))for(const part of Array.isArray(value)?value:[value])if(part.chunks){same(part.chunks.length,Math.ceil(part.count/128));same(hash(JSON.stringify(part.chunks)),part.root);}
  same(hash(JSON.stringify(tree.fields)),tree.root);
}
function collection(root,expected){
  const summary=JSON.parse(fs.readFileSync(path.join(root,'summary.json'))),raw=new Map();
  same(summary.complete,true);same(summary.samples.length,expected);same(summary.files.length,expected);
  for(const [file,digest]of Object.entries(summary.instrumentation))same(hash(fs.readFileSync(file)),digest);
  for(const item of summary.files){
    assert.equal(path.basename(item.file),item.file);const bytes=fs.readFileSync(path.join(root,item.file));same(bytes.length,item.bytes);same(hash(bytes),item.sha256);
    const report=JSON.parse(zlib.gunzipSync(bytes)),id=item.file.replace(/\.json\.gz$/,'');assert.ok(!raw.has(id));raw.set(id,report);same(report.valid,true);same(report.errors,[]);
    const declared=summary.samples.find(x=>x.id===id);assert.ok(declared);same(declared.valid,true);
    if(declared.kind==='kernel'){
      same(report.identity.sha,declared.ref);same(report.samples.length,1);same(report.viewport,[1500,950]);same(report.dpr,1);
      for(const file of ['src/encoding.js','src/evidence.js'])same(hash(source(report.identity.sha,file)),report.identity.modules[file]);
      same(report.identity.modules['tests/support/evidence-study.js'],summary.instrumentation['tests/support/evidence-study.js']);
      const x=report.samples[0],g=golden.get(x.name);same(x.outcome,'whole-study-completed');same(x.inputDigest,g.inputDigest);same(x.population,g.population);fingerprint(x.fingerprint);same(x.fingerprint.root,g.root);
      assert.ok(x.visibility.every(x=>x.state==='visible'));same(x.computeWallMs,x.ended-x.began);same(declared.wallMs,x.computeWallMs);
    }else{
      same(declared.kind,'application');same(report.kind,'whole-app');same(report.build.sha,declared.ref);same(hash(source(report.build.sha,'index.html')),report.build.indexSha256);
      same(report.report.identity.commit,report.build.sha);same(report.report.schema,'cube-performance@2');same(report.report.truncated,false);same(report.report.identity.browser.viewport,[1500,950]);same(report.report.identity.browser.dpr,1);
      same(report.endpoints.map(x=>x.name),['first','warm']);same(report.endpoints[0].bootstrap,report.endpoints[1].bootstrap);
      for(const e of report.endpoints){assert.ok(Number.isFinite(e.automationWallMs)&&e.automationWallMs>0);same(e.bootstrap.key.slice(4,6),[4,0]);same(e.bootstrap.resamples,2000);assert.ok(e.bootstrap.fullMatched>=20);for(const parts of Object.values(e.bootstrap.intervals))for(const value of Object.values(parts))same(value.validDraws,2000);}
      const es=report.report.events,inputs=es.filter(x=>x.type==='input'&&x.target==='ol-evidence-tab'&&x.event==='click');same(inputs.length,2);
      const end=es.find(x=>x.type==='phase-end'&&x.name==='continuations'&&x.outcome==='completed'&&x.at>=inputs[0].at&&x.at<inputs[1].at),hit=es.find(x=>x.type==='continuations-cache-hit'&&x.at>=inputs[1].at);
      same(end.at-inputs[0].at,report.firstMs);same(hit.at-inputs[1].at,report.warmMs);
      const output=es.filter(x=>x.type==='continuations-output').at(-1);same(output.n,4);same(output.m,0);same(output.ledger,100000);same(output.sourceDigest,report.endpoints[0].bootstrap.key[10]);
      for(const input of inputs){const proxy=es.find(x=>x.type==='presentation-proxy'&&x.id===input.id);assert.ok(proxy);same(proxy.scope,'ol-evidence');same(proxy.status,'scope-submitted');assert.ok(Number.isFinite(proxy.duration)&&proxy.duration>=0&&proxy.at>=input.at);}
      assert.ok(es.filter(x=>x.type==='frame').every(x=>!x.hidden));
    }
  }
  same(raw.size,expected);return {summary,raw};
}
function value(report,metric){
  if(metric.startsWith('kernel:'))return report.samples[0].computeWallMs;
  const which=metric.includes('warm')?'warm':'first',index=which==='warm'?1:0;
  if(metric.endsWith('complete'))return report.endpoints[index].automationWallMs;
  if(metric.endsWith('compute'))return which==='warm'?report.warmMs:report.firstMs;
  const es=report.report.events,input=es.filter(x=>x.type==='input'&&x.target==='ol-evidence-tab'&&x.event==='click')[index];return es.find(x=>x.type==='presentation-proxy'&&x.id===input.id).duration;
}
function frames(report){return(report.samples?report.samples[0].frames:report.report.events.filter(x=>x.type==='frame')).filter(x=>!x.hidden&&Number.isFinite(x.interval)&&x.interval>0).map(x=>x.interval);}
function work(report){const groups=report.samples?[report.samples[0]]:report.report.events.filter(x=>x.type==='continuations-work');return groups.reduce((total,x)=>total+Object.values(x.yields).reduce((n,x)=>n+x.count,0),0);}
function pairs(collection,stage,metric){
  const name=metric.startsWith('kernel:')?metric.slice(7):'app',out=[];
  for(let pair=0;pair<5;pair++){const a=collection.raw.get(`${stage}-${pair}-A-${name}`),b=collection.raw.get(`${stage}-${pair}-B-${name}`);assert.ok(a&&b);out.push({pair,A:value(a,metric),B:value(b,metric),gain:value(a,metric)-value(b,metric),yieldCountA:work(a),yieldCountB:work(b),frames:frames(a).concat(frames(b))});}
  return out;
}
function floor(pairs){const intervals=pairs.flatMap(x=>x.frames);assert.ok(intervals.length);return Math.max(p95(pairs.map(x=>Math.abs(x.gain))),2*median(intervals));}
const initial=collection(process.argv[2],40),candidate=collection(process.argv[3],80);same(initial.summary.instrumentation,candidate.summary.instrumentation);same(initial.summary.protocol,candidate.summary.protocol);
for(let i=0;i<5;i++){
  const a=candidate.raw.get(`ab-${i}-A-app`),b=candidate.raw.get(`ab-${i}-B-app`);same(a.endpoints[0].bootstrap,b.endpoints[0].bootstrap);
  const output=r=>r.report.events.filter(x=>x.type==='continuations-output').map(({at,...x})=>x);same(output(a),output(b));
  const input=r=>r.report.events.filter(x=>x.type==='continuations-input').map(({at,...x})=>x);same(input(a),input(b));
}
const metrics={};
for(const metric of [...initial.summary.protocol.kernelCases.map(x=>'kernel:'+x),'app:first-complete','app:first-compute','app:first-presentation','app:warm-complete','app:warm-compute','app:warm-presentation']){
  const aa0=pairs(initial,'aa',metric),aa=pairs(candidate,'aa',metric),ab=pairs(candidate,'ab',metric),noiseFloorMs=Math.max(floor(aa0),floor(aa)),gainMs=median(ab.map(x=>x.gain)),positivePairs=ab.filter(x=>x.gain>0).length;
  const reducedWork=!metric.includes('warm')&&ab.every(x=>x.yieldCountB<x.yieldCountA);
  metrics[metric]={baselineMedianMs:median(ab.map(x=>x.A)),candidateMedianMs:median(ab.map(x=>x.B)),medianPairedGainMs:gainMs,initialFloorMs:floor(aa0),currentFloorMs:floor(aa),noiseFloorMs,positivePairs,reducedWork,material:gainMs>noiseFloorMs&&positivePairs>=4&&reducedWork,
    pairs:ab.map(({frames,...x})=>x)};
}
const report={schema:'continuations-candidate-audit@1',initialProducer:initial.summary.producer,producer:candidate.summary.producer,host:candidate.summary.host,browser:candidate.summary.browser,verifiedPayloads:120,candidatePayloads:80,kernelWholeOutputs:90,wholeAppBeforeAfterIdenticalPairs:5,metrics,
  correction:'The earlier assessment labeled firstMs as first-result latency. That field ends at compute completion. The declared complete-DOM endpoint was already captured in endpoints[].automationWallMs in all pre-edit and candidate raw trials; it is primary here. Compute and native two-frame presentation proxies remain separately reported. No collection/instrumentation/endpoint or raw observation is changed, discarded or replaced.',
  limitations:['Complete-DOM wall includes automation input/polling transport; identical paired harness and A/A floor, not a clean user latency/INP certificate','Native presentation-proxy is two quiet visible frames, not physical display presentation','Warm data/compute completion is separate from intended tab motion; no first-use claim from a warm hit','Nested walls/yield waits are not additive CPU; existing absolute/cumulative #96 acceptance is not waived']};
fs.writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([key,x])=>[key,{baseline:x.baselineMedianMs,candidate:x.candidateMedianMs,gain:x.medianPairedGainMs,floor:x.noiseFloorMs,material:x.material}])),null,2)+'\n');
