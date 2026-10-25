"use strict";
// An actual pre-change exporter supplies the legacy document and the independent
// captured-study oracle. This does not synthesize or rename freshness metadata.
const {test,expect}=require('./fixtures.js');
const {materialise}=require('../support/builds.js');
test.use({reducedMotion:'reduce',viewport:{width:1920,height:1080}});
async function complete(page){
  await expect.poll(async()=>await page.locator('#ol-evidence').getAttribute('aria-busy')==='false'&&Boolean(await page.locator('#ol-evidence-intervals').getAttribute('data-bootstrap')),{timeout:60000}).toBe(true);
  return page.evaluate(()=>({bootstrap:JSON.parse(document.getElementById('ol-evidence-intervals').dataset.bootstrap),state:document.getElementById('ol-state').textContent,
    ledgers:['ol-evidence-ledger','ol-cases-ledger'].map(id=>JSON.parse(document.querySelector('#'+id+' .ol-ledger-content').dataset.counts))}));
}
test('pre-change live-source investigations restore their frozen Continuations without reads',async({page,fakeFor,freshContext,probe},testInfo)=>{
  test.setTimeout(90000);
  const {evidenceFixture}=await import('../../tools/benchmark/evidence-fixture.mjs'),profile=evidenceFixture(1800),build=materialise('d944f503b48de7f746c369b440f331294ef23654','legacy-evidence-capture');
  const oldFake=await fakeFor(profile,{pageRoot:build.dir,quiet:3600,next:3600}),oldPage=await(await freshContext()).newPage(),view='/#w=30d&r=9,0&auto=0&vis=2&tab=continuations';
  await oldPage.goto(oldFake.url+view);await complete(oldPage);
  const document=await oldPage.evaluate(()=>window.cubeAgent.export());expect(document.schema).toBe('cube-analysis@1');expect(document.snapshot.live).toBe(true);
  const histories=document.snapshot.cache.histories.cubeMap;expect(histories.length).toBeGreaterThan(0);expect(histories.every(([,held])=>!Object.hasOwn(held,'canonicalThrough'))).toBe(true);
  await testInfo.attach('legacy-live-source-investigation',{body:Buffer.from(JSON.stringify(document)),contentType:'application/json'});
  await oldPage.evaluate(document=>window.cubeAgent.apply(document),document);const expected=await complete(oldPage);
  const fake=await fakeFor(profile,{quiet:3600,next:3600});await page.goto(fake.url+'/#w=30d&r=9,0&auto=0&vis=2');await probe.waitForReady();
  const reads=()=>fake.log().filter(x=>x.path==='/cube/columns').length,before=reads();
  await page.evaluate(document=>window.cubeAgent.apply(document),document);await page.locator('#ol-evidence-tab').click();
  expect(await complete(page)).toEqual(expected);await probe.waitForReady();expect(reads()).toBe(before);
  const restored=await page.evaluate(()=>window.cubeAgent.export());expect(restored.snapshot.cache.histories.cubeMap).toEqual(histories);
});
