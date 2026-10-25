"use strict";
const path=require('node:path');
const {test,expect}=require('./fixtures.js');
test.use({reducedMotion:'reduce',viewport:{width:1920,height:1080}});
async function capture(page){
  await page.addInitScript({path:path.resolve('tests/support/evidence-study.js')});
  await page.addInitScript(()=>{
    let api;
    Object.defineProperty(window,'explorerEvidence',{configurable:true,get:()=>api,set:value=>{
      api={...value,compute:async(args,control)=>{const result=await value.compute(args,control);if(result){window.__freshnessStudy=result;window.__freshnessInput={b0:args.b0,b1:args.b1,n:args.n,m:args.m};}return result;}};
    }});
  });
}
async function settled(page,edge,previousDigest=null){
  await expect.poll(async()=>{
    const raw=await page.locator('#ol-evidence-intervals').getAttribute('data-bootstrap');
    const data=raw&&JSON.parse(raw);
    return data&&data.key[10]!==previousDigest&&await page.locator('#ol-evidence').getAttribute('aria-busy')==='false'?data.key[8]:null;
  },{timeout:60000}).toBe(edge);
  return page.evaluate(async()=>{
    const visible=JSON.parse(document.getElementById('ol-evidence-intervals').dataset.bootstrap),study=window.__freshnessStudy;
    if(!study||JSON.stringify(study.uncertainty)!==JSON.stringify({...study.uncertainty,key:visible.key,seed:visible.seed,intervals:visible.intervals}))throw Error('Captured result does not own visible intervals');
    const fingerprint=await window.evidenceStudyFixture.fingerprint(study,async text=>{
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
    });
    return {root:fingerprint.root,input:window.__freshnessInput,bootstrap:visible,counts:JSON.parse(document.querySelector('#ol-evidence-ledger .ol-ledger-content').dataset.counts)};
  });
}
function append35days(fake){
  const epoch=Date.parse('2021-01-01T00:00:00Z'),step=8*3600000,from=Date.parse(fake.info().cutoff)-epoch,to=from+35*86400000,trades=[];
  let random=123456789;for(let i=0;i<5400;i++)random=(Math.imul(random,1664525)+1013904223)>>>0;
  for(let c=Math.ceil(from/step);c<to/step;c++){
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    const price=(25000+(random%5-2)*125)*100,quantity=(1+c%3)*1e8,buy=[.2,.5,.8][Math.floor(c/3)%3];
    trades.push({t:c*step+60000,price,qty:Math.round(quantity*buy),buy:true},{t:c*step+120000,price,qty:Math.round(quantity*(1-buy)),buy:false});
  }
  fake.advance({toIso:new Date(epoch+to).toISOString(),trades});
}
for(const scenario of [{name:'append across seasonal matches',n:9,route:'delta'},{name:'append moves the 100k history support',n:4,route:'delta'},{name:'whole-pack historical revision',n:9,route:'pack'}]){
  test('retained and fresh complete studies agree after '+scenario.name,async({page,fakeFor,freshContext})=>{
    test.setTimeout(120000);
    const {evidenceFixture}=await import('../../tools/benchmark/evidence-fixture.mjs'),fake=await fakeFor(evidenceFixture(1800)),url=fake.url+'/#w=30d&r='+scenario.n+',0&auto=0&vis=2&tab=continuations';
    const edge=()=>Math.floor(fake.info().cutoffBase/2**scenario.n)*2**scenario.n;
    await capture(page);await page.goto(url);const before=await settled(page,edge());
    expect(fake.log().filter(x=>x.path==='/cube/columns')).toHaveLength(1);
    const oldPack=fake.info().packToken;
    if(scenario.route==='delta')append35days(fake);else fake.revise({day:'2026-08-01',factor:1.125});
    await expect.poll(()=>fake.log().filter(x=>x.path==='/cube/pack'&&x.answer===scenario.route).length,{timeout:30000}).toBe(1);
    const currentPack=fake.info().packToken;expect(currentPack).not.toBe(oldPack);
    await expect.poll(()=>fake.log().filter(x=>x.path==='/cube/columns'&&x.packToken===currentPack&&x.status===200).length,{timeout:30000}).toBe(1);
    const retained=await settled(page,edge(),before.bootstrap.key[10]);expect(retained.bootstrap.key[10]).not.toBe(before.bootstrap.key[10]);
    const fresh=await(await freshContext()).newPage();await capture(fresh);await fresh.goto(url);const independent=await settled(fresh,edge());
    expect(retained).toEqual(independent);
    expect(retained.input.b1).toBe(edge());
    if(scenario.n===4){expect(retained.input.b1-retained.input.b0).toBe(100000*16);expect(retained.input.b0).toBeGreaterThan(before.input.b0);}
    // One distinct n,m history per context/update, never a read per case.
    expect(fake.log().filter(x=>x.path==='/cube/columns')).toHaveLength(3);
  });
}
