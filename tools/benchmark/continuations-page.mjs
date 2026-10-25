// The same exact-module kernel page is used in remote CI and the authorized
// native side panel. It is a diagnostic fixture, never a production endpoint.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function studyPage(ref) {
  const sha = execFileSync('git', ['rev-parse', ref + '^{commit}'], { encoding: 'utf8' }).trim();
  const source = file => execFileSync('git', ['show', sha + ':' + file], { maxBuffer: 16 * 1024 * 1024 }).toString();
  const modules = { 'src/encoding.js': source('src/encoding.js'), 'src/evidence.js': source('src/evidence.js'),
    'tests/support/evidence-study.js': fs.readFileSync('tests/support/evidence-study.js', 'utf8') };
  const identity = { sha, modules: Object.fromEntries(Object.entries(modules).map(([file, text]) => [file, hash(text)])) };
  const scripts = Object.values(modules).map(text => '<script>' + text.replaceAll('</script', '<\\/script') + '</script>').join('\n');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continuations kernel diagnostic</title>
<style>body{font:16px system-ui;max-width:70rem;margin:2rem auto;padding:1rem;background:#101c2b;color:#dae5f5}button,select{font:inherit;padding:.6rem;margin:.3rem}textarea{width:100%;height:15rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>Continuations kernel diagnostic</h1><p>Synthetic fixed inputs; complete existing study including intervals. Excludes transport and explorer preparation/digest. Input construction and whole-result fingerprinting are timed separately. No production data.</p>
<pre id="identity">${JSON.stringify(identity)}</pre>
<label>Case <select id="case"><option>cap-qualified</option><option>floor-failure</option><option>partial-coverage</option></select></label>
<label>Repeats <select id="repeats"><option>1</option><option>3</option></select></label>
<button id="run">Run complete study</button><button id="cancel">Cancel</button><button id="clear">Clear retained report</button>
<p id="status" role="status">Ready</p><pre id="summary"></pre><textarea id="report" aria-label="Complete timing report" readonly></textarea>
${scripts}
<script>(${kernelUI.toString()})(${JSON.stringify(identity)});</script>`;
  return { identity, html, htmlSha256: hash(html) };
}
function kernelUI(identity) {
  const $ = id => document.getElementById(id), samples = [];
  let owned = null;
  const finishReport = () => { $('report').value = JSON.stringify({ schema:'continuations-kernel@1', identity, userAgent:navigator.userAgent, viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,
    supportedEntryTypes:PerformanceObserver.supportedEntryTypes, limitation:'Kernel async walls include yields and cannot be summed as CPU; fingerprint/preparation excluded from compute wall. No compositor, whole-page input or server CPU certificate.', samples }); };
  $('cancel').onclick = () => { if (owned) owned.cancelled = true; };
  $('clear').onclick = () => { if (!owned) { samples.length = 0; $('report').value = ''; $('summary').textContent = ''; } };
  $('run').onclick = async () => {
    if (owned) return;
    const job = owned = { cancelled:false }, name = $('case').value, count = Number($('repeats').value);
    $('run').disabled = true;
    try {
      for (let repeat = 0; repeat < count && !job.cancelled; repeat++) {
        $('status').textContent = 'Preparing ' + name + ' ' + (repeat + 1) + '/' + count;
        const prepareAt = performance.now(), args = evidenceStudyFixture.input(explorerEncoding, name), prepareMs = performance.now() - prepareAt;
        const events = [], yields = {}, costs = {}, frames = [], longTasks = [], visibility = [{at:performance.now(),state:document.visibilityState}];
        const accumulator = (map,stage,elapsed) => { const group = map[stage] ??= {count:0,total:0,max:0}; group.count++; group.total += elapsed; group.max = Math.max(group.max,elapsed); };
        const changed = () => visibility.push({at:performance.now(),state:document.visibilityState});
        document.addEventListener('visibilitychange',changed);
        let raf = 0, previous = null, recording = true;
        const frame = at => { if (!recording) return; if (frames.length < 4096) frames.push({at,interval:previous === null ? null : at-previous,hidden:document.hidden}); previous=at;raf=requestAnimationFrame(frame); };
        raf=requestAnimationFrame(frame);
        const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
        const observer = supported ? new PerformanceObserver(list => { for (const x of list.getEntries()) if (longTasks.length < 1024) longTasks.push({startTime:x.startTime,duration:x.duration}); }) : null;
        observer?.observe({type:'longtask'});
        const heapBefore = performance.memory ? {usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize} : null;
        $('status').textContent = 'Computing ' + name + ' ' + (repeat + 1) + '/' + count;
        const began=performance.now(), result = await explorerEvidence.compute(args,{cancelled:()=>job.cancelled,now:()=>performance.now(),
          phase:stage=>{ events.push({stage,event:'start',at:performance.now()}); $('status').textContent='Computing '+stage; return outcome=>events.push({stage,event:'end',at:performance.now(),outcome:outcome??'completed'}); },
          yield:(stage,ms)=>accumulator(yields,stage,ms),cost:(stage,ms)=>accumulator(costs,stage,ms)});
        const ended=performance.now(), heapAfter=performance.memory ? {usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize} : null;
        recording=false;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',changed);
        if(observer) { for(const x of observer.takeRecords()) if(longTasks.length<1024) longTasks.push({startTime:x.startTime,duration:x.duration}); observer.disconnect(); }
        $('status').textContent='Fingerprinting complete output (excluded from compute time)';
        const fingerprintAt=performance.now(), fingerprint=result ? await evidenceStudyFixture.fingerprint(result,async text=>{
          const bytes=new TextEncoder().encode(text), digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
        }) : null;
        const sample={name,repeat,prepareMs,began,ended,computeWallMs:ended-began,inputDigest:args.provenance.sourceDigest,visibility,events,yields,synchronousCosts:costs,frames,longTasks: supported ? longTasks : null,
          heap:{before:heapBefore,after:heapAfter,note:'Engine-exposed nonstandard estimate, no forced collection or retained-heap/GC attribution'},outcome:result ? 'whole-study-completed' : 'cancelled',
          population:result ? evidenceStudyFixture.population(result) : null,fingerprint,fingerprintMs:performance.now()-fingerprintAt};
        samples.push(sample);finishReport();
        $('summary').textContent=JSON.stringify(samples.map(({name,repeat,computeWallMs,outcome,population})=>({name,repeat,computeWallMs,outcome,ledger:population?.ledger,cases:population?.cases[1],fullMatched:population?.fullMatched,drawsRan:population?.drawsRan})),null,2);
      }
      $('status').textContent=job.cancelled ? 'Cancelled; retained report includes completed observations' : 'Complete';
    } catch(error) { $('status').textContent='Failed: '+error.message;finishReport(); }
    finally { if(owned===job) owned=null; $('run').disabled=false; }
  };
}
export async function serveStudy(ref, port=0) {
  const page=studyPage(ref), server=http.createServer((request,response)=>{
    if(request.url!=='/' && request.url!=='/index.html') {response.writeHead(404);response.end();return;}
    response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(page.html);
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {...page,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
