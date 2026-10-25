"use strict";
// Controlled suspension/visibility tests prove ownership, never timing budgets.
const {test,expect}=require('./fixtures.js');
test.use({reducedMotion:'reduce',viewport:{width:1920,height:1080}});
async function instrument(page,firstGate=false,fallback=false){
  await page.addInitScript(({firstGate,fallback})=>{
    const state=window.__evidenceOwnership={gate:firstGate?{armed:true,outcome:'continue'}:null,digest:null,compute:[],retarget:false,stop:null,stopObserved:null};let api;
    Object.defineProperty(window,'explorerEvidence',{configurable:true,get:()=>api,set:value=>{
      api={...value,sourceDigest:async(args,hash,control)=>{
        const gate=state.gate;
        if(gate?.armed){gate.armed=false;gate.entered=true;try{await new Promise(resolve=>gate.release=resolve);if(gate.outcome==='failure')throw Error('obsolete digest failure');if(gate.outcome==='success')return state.digest;}finally{gate.released=true;}}
        if(state.stop&&!state.stopObserved){
          const original=control.digestBytes;
          if(original)control.digestBytes=async bytes=>{document.getElementById('ol-diagnostics-stop').click();if(state.stop==='restart')document.getElementById('ol-diagnostics-start').click();state.stopObserved={stopped:true};return original(bytes);};
        }
        let owner=control;if(fallback){owner=Object.create(control);Object.defineProperty(owner,'digestBytes',{value:undefined});}
        const digest=await value.sourceDigest(args,hash,owner);if(digest)state.digest=digest;return digest;
      },compute:async(input,control)=>{
        if(state.stopObserved){state.stopObserved.clock=typeof control.now;state.stopObserved.remaining=Object.getOwnPropertyNames(control);}
        const child=Object.create(control);
        Object.defineProperty(child,'now',{value:()=>performance.now()});
        Object.defineProperty(child,'yield',{value:(stage,elapsed)=>{
          control.yield?.(stage,elapsed);
          if(state.retarget&&input.horizon===4&&stage==='summaries'){
            state.retarget=false;state.retargeted=true;
            const select=document.getElementById('ol-horizon');select.value='8';select.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }});
        const record={horizon:input.horizon,kind:input.kind,complete:false};state.compute.push(record);
        const out=await value.compute(input,child);record.complete=Boolean(out);record.cancelled=control.cancelled();return out;
      }};
    }});
  },{firstGate,fallback});
}
async function source(fakeFor){const {evidenceFixture}=await import('../../tools/benchmark/evidence-fixture.mjs');return fakeFor(evidenceFixture(1800));}
const url=fake=>fake.url+'/#w=30d&r=9,0&auto=0&vis=2&tab=continuations';
async function complete(page,horizon=1,kind='next-poc'){
  await expect.poll(async()=>{const raw=await page.locator('#ol-evidence-intervals').getAttribute('data-bootstrap');if(!raw||await page.locator('#ol-evidence').getAttribute('aria-busy')!=='false')return null;const x=JSON.parse(raw);return [x.key[15],x.key[2]];},{timeout:60000}).toEqual([horizon,kind]);
  return page.evaluate(()=>({bootstrap:JSON.parse(document.getElementById('ol-evidence-intervals').dataset.bootstrap),ledgers:['ol-evidence-ledger','ol-cases-ledger'].map(id=>document.querySelector('#'+id+' .ol-ledger-content')?.dataset.counts??null)}));
}
for(const parameter of ['horizon','kind'])for(const outcome of ['success','failure'])test(`cached A owns publication after abandoned ${parameter} B ${outcome}`,async({page,fakeFor,probe})=>{
  test.setTimeout(90000);await instrument(page);const fake=await source(fakeFor);await page.goto(url(fake));const before=await complete(page);await probe.waitForReady();
  await page.evaluate(outcome=>window.__evidenceOwnership.gate={armed:true,outcome},outcome);
  if(parameter==='horizon')await page.locator('#ol-horizon').selectOption('4');else await page.locator('[data-evidence-kind="barrier"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__evidenceOwnership.gate.entered)).toBe(true);
  await expect(page.locator('#ol-evidence')).toHaveAttribute('aria-busy','true');
  if(parameter==='horizon')await page.locator('#ol-horizon').selectOption('1');else await page.locator('[data-evidence-kind="poc"]').click();
  expect(await complete(page)).toEqual(before);
  await page.evaluate(()=>window.__evidenceOwnership.gate.release());
  await expect.poll(()=>page.evaluate(()=>window.__evidenceOwnership.gate.released)).toBe(true);await probe.waitForReady();
  expect(await complete(page)).toEqual(before);
  expect(await page.evaluate(()=>window.__evidenceOwnership.compute.filter(x=>x.complete))).toHaveLength(1);
  expect(fake.log().filter(x=>x.path==='/cube/columns')).toHaveLength(1);
});
test('a horizon changed inside summary work owns the intervals and both ledgers',async({page,fakeFor,probe})=>{
  test.setTimeout(90000);await instrument(page);const fake=await source(fakeFor);await page.goto(url(fake));await complete(page);await probe.waitForReady();
  await page.evaluate(()=>window.__evidenceOwnership.retarget=true);await page.locator('#ol-horizon').selectOption('4');
  const result=await complete(page,8);expect(await page.evaluate(()=>window.__evidenceOwnership.retargeted)).toBe(true);
  expect(result.ledgers[0]).toBe(result.ledgers[1]);expect(JSON.parse(result.ledgers[0]).baselineCompleted).toBeGreaterThan(0);
  const runs=await page.evaluate(()=>window.__evidenceOwnership.compute);
  expect(runs.find(x=>x.horizon===4)).toMatchObject({complete:false,cancelled:true});expect(runs.at(-1)).toMatchObject({horizon:8,complete:true,cancelled:false});
});
for(const casesOpen of [false,true])test(`tab departure retains bounded completion ${casesOpen?'with Cases as consumer':'for unchanged reopening'}`,async({page,fakeFor,probe})=>{
  test.setTimeout(90000);await instrument(page,true);const fake=await source(fakeFor);await page.goto(url(fake));
  await expect.poll(()=>page.evaluate(()=>window.__evidenceOwnership.gate.entered)).toBe(true);
  if(casesOpen)await page.locator('#ol-open-cases').click();await page.locator('#ol-context-tab').click();
  await page.evaluate(()=>window.__evidenceOwnership.gate.release());
  await expect.poll(()=>page.evaluate(()=>window.__evidenceOwnership.compute.some(x=>x.complete)),{timeout:60000}).toBe(true);await probe.waitForReady();
  await expect(page.locator('#ol-context-tab')).toHaveAttribute('aria-pressed','true');
  if(casesOpen)await expect(page.locator('#ol-case-list tr')).toHaveCount(50);
  await page.locator('#ol-evidence-tab').click();await complete(page);
  expect(await page.evaluate(()=>window.__evidenceOwnership.compute)).toHaveLength(1);
});
test('synthetic hidden/show transition preserves bounded study ownership',async({page,fakeFor,probe})=>{
  test.setTimeout(90000);await instrument(page,true);const fake=await source(fakeFor);await page.goto(url(fake));
  await expect.poll(()=>page.evaluate(()=>window.__evidenceOwnership.gate.entered)).toBe(true);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.__evidenceOwnership.gate.release();});
  await expect.poll(()=>page.evaluate(()=>window.__evidenceOwnership.compute.some(x=>x.complete)),{timeout:60000}).toBe(true);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await complete(page);await probe.waitForReady();
  expect(await page.evaluate(()=>window.__evidenceOwnership.compute)).toEqual([{horizon:1,kind:'next-poc',complete:true,cancelled:false}]);
});
for(const stop of ['stop','restart'])test(`digest ${stop} detaches measurement without stopping the requested result`,async({page,fakeFor})=>{
  test.setTimeout(90000);await instrument(page);const fake=await source(fakeFor);await page.goto(url(fake).replace('&tab=continuations',''));await page.locator('#ol-tab-query').click();await page.locator('#ol-diagnostics summary').click();await page.locator('#ol-diagnostics-start').click();
  await page.evaluate(stop=>window.__evidenceOwnership.stop=stop,stop);await page.locator('#ol-evidence-tab').click();await complete(page);
  expect(await page.evaluate(()=>window.__evidenceOwnership.stopObserved)).toEqual({stopped:true,clock:'undefined',remaining:['cancelled']});
  if(stop==='restart'){
    await page.locator('#ol-diagnostics-export').click();const report=JSON.parse(await page.locator('#ol-diagnostics-output').inputValue());
    expect(report.events.filter(x=>x.type==='phase-start'&&x.name.startsWith('continuations.'))).toEqual([]);
    expect(report.events.some(x=>['continuations-input','continuations-output','continuations-work','continuations-bootstrap'].includes(x.type))).toBe(false);
  }
});

test('whole browser results agree with native SHA unavailable',async({page,fakeFor,freshContext})=>{
  test.setTimeout(90000);await instrument(page);const fake=await source(fakeFor);await page.goto(url(fake));const native=await complete(page);
  const other=await(await freshContext()).newPage();await instrument(other,false,true);await other.goto(url(fake));
  expect(await complete(other)).toEqual(native);
  expect(await other.evaluate(()=>window.__evidenceOwnership.digest)).toBe(await page.evaluate(()=>window.__evidenceOwnership.digest));
});
