"use strict";
// B71: native ETF strip, source contract, publication edge and fixed card geometry.
const {test,expect}=require('./fixtures.js');
test.use({reducedMotion:'reduce'});
const DAY=86400000;
async function setup(page,fakeFor,strip='etf',partial=false){
 const fake=await fakeFor('mini',{strip:'off'}),to=Math.floor(Date.parse(fake.info().cutoff)/900000)*900000,from=to-DAY,calls=[];
 await page.route(fake.url+'/',async route=>{const response=await route.fetch(),html=await response.text();await route.fulfill({response,body:html.replace('<head>','<head><meta name="explorer-micro" content="/cube/micro"><meta name="explorer-etf" content="/cube/etf">')});});
 await page.route('**/cube/etf?**',async route=>{
  const q=Object.fromEntries(new URL(route.request().url()).searchParams),want={from:Number(q.from),to:Number(q.to),asOf:Number(q.as_of)};calls.push(want);
  const r={knownAt:to-2*3600000,date:'2026-09-23',complete:!partial,inflow:612e6,outflow:partial?0:140e6,net:partial?null:472e6,magnitude:partial?null:752e6,
   normal:null,normalReports:0,reported:partial?2:3,expected:3,universe:'selected',allCurrentFunds:true,funds:[{ticker:'A',net:612e6},{ticker:'B',net:partial?null:-140e6},{ticker:'C',net:0}]};
  await route.fulfill({json:{schema:'cube-etf@1',model:'etf-fund-flows@1',...want,source:{state:'ok'},snapshot:{id:'a'.repeat(64)},scaleUsd:1e9,historyReady:true,states:r.knownAt<Math.min(want.to,want.asOf)?[r]:[]}});
 });
 const [p0,p1]=fake.info().priceBand.usdt;
 const hash=`#t=${new Date(from).toISOString()}~${new Date(to).toISOString()}&p=${p0}~${p1}&mode=candles&strip=${strip}&vis=2&rc=1`;
 await page.goto(fake.url+'/'+hash);
 return {fake,to,from,calls,hash};
}
async function hoverReport(page){
 const canvas=page.locator('#ol-canvas'),box=await canvas.boundingBox(),g=await canvas.evaluate(n=>n.dataset.layout.split(',').map(Number));
 await page.mouse.move(box.x+g[0]+g[2]*23/24,box.y+g[14]+12+20);
 return page.locator('#ol-tip');
}
for(const scheme of ['light','dark'])test(`ETF native strip and hover preserve independent amounts in ${scheme}`,async({page,fakeFor,probe})=>{
 await page.emulateMedia({colorScheme:scheme});await setup(page,fakeFor);await probe.waitForReady();
 await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready');
 const g=await page.locator('#ol-canvas').evaluate(n=>n.dataset.layout.split(',').map(Number));expect(g[15]).toBe(52);
 const tip=await hoverReport(page);await expect(tip).toHaveAttribute('data-presentation','strip-etf');
 await expect(tip).toContainText('472');await expect(tip).toContainText('752');await expect(tip).toContainText('3/3');
 await expect(tip).toContainText('Normal: 0/20');expect(await tip.locator('svg text').allTextContents()).toContain('B');
 const rect=await tip.boundingBox();expect(rect.height).toBe(484);
 await page.keyboard.press('e');await expect(page.locator('#ol-inspect-readout')).toContainText('472');
});
test('ETF is third after Forces and Micro, is lazy while off, and restores through the address',async({page,fakeFor,probe})=>{
 const {calls,fake,hash}=await setup(page,fakeFor,'off');await probe.waitForReady();expect(calls).toHaveLength(0);
 await page.locator('#ol-strip').click();await expect(page.locator('#ol-strip-menu [data-strip]')).toHaveCount(4);
 expect(await page.locator('#ol-strip-menu [data-strip]').evaluateAll(nodes=>nodes.map(n=>n.dataset.strip))).toEqual(['off','forces','micro','etf']);
 await page.locator('#ol-strip-menu [data-strip="etf"]').click();await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready');
 expect(calls.length).toBeGreaterThan(0);await expect(page).toHaveURL(/strip=etf/);
 await page.goto(fake.url+'/'+hash.replace('strip=off','strip=etf'));await expect(page.locator('#ol-strip-text')).toHaveText('ETF');
});
test('ETF unsettled reports withhold both combined amounts but retain fund coverage',async({page,fakeFor,probe})=>{
 await setup(page,fakeFor,'etf',true);await probe.waitForReady();await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready');
 const tip=await hoverReport(page);await expect(tip).toContainText('Unsettled');await expect(tip).toContainText('2/3');
 const figures=await tip.locator('[data-strip-slot="summary"] dd').allTextContents();expect(figures).toEqual(['—','—','2/3']);
 await expect(tip).toContainText('Pending');await expect(tip).toContainText('combined totals withheld');
});
