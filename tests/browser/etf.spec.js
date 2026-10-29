"use strict";
// B71: native ETF strip, source contract, publication edge and fixed card geometry.
const {test:base,expect}=require('./fixtures.js'),paneCanvas=require('./pane-canvas.js');
const test=base.extend({pane:async({page},use)=>{await paneCanvas.addRecorder(page);await use(paneCanvas.forPage(page));}});
test.use({reducedMotion:'reduce'});
const DAY=86400000;
async function setup(page,fakeFor,strip='etf',partial=false,options={}){
 const fake=await fakeFor('mini',{strip:'off'}),to=Math.floor(Date.parse(fake.info().cutoff)/900000)*900000+(options.offset??0),from=to-(options.span??DAY),calls=[];
 await page.route(fake.url+'/',async route=>{const response=await route.fetch(),html=await response.text();await route.fulfill({response,body:html.replace('<head>','<head><meta name="explorer-micro" content="/cube/micro"><meta name="explorer-etf" content="/cube/etf">')});});
 await page.route('**/cube/etf?**',async route=>{
  const q=Object.fromEntries(new URL(route.request().url()).searchParams),want={from:Number(q.from),to:Number(q.to),asOf:Number(q.as_of)};calls.push(want);
  if(options.delay)await new Promise(resolve=>setTimeout(resolve,options.delay));
  if(options.fail){fake.on({route:'/cube/etf',times:1}).fail({status:503,body:{error:'etf_unavailable'}});await route.fulfill({response:await route.fetch()});return;}
  const r={knownAt:to-2*3600000,date:'2026-09-23',complete:!partial,inflow:612e6,outflow:partial?0:140e6,net:partial?null:472e6,magnitude:partial?null:752e6,
   normal:null,normalReports:0,reported:partial?2:3,expected:3,universe:'selected',allCurrentFunds:true,funds:[{ticker:'A',net:612e6},{ticker:'B',net:partial?null:-140e6},{ticker:'C',net:0}]};
  const states=options.replay?[{...r,knownAt:from,inflow:10e6,outflow:0,net:10e6,magnitude:10e6,funds:[{ticker:'A',net:10e6},{ticker:'B',net:0},{ticker:'C',net:0}]},r]:[r];
  const history=options.history?[[-1,10e6,600e6],[1,650e6,150e6],[4,137e6,0]].map(([offset,inflow,outflow])=>({...r,date:new Date(Math.floor(from/DAY)*DAY+offset*DAY).toISOString().slice(0,10),knownAt:to-3600000,inflow,outflow,net:inflow-outflow,magnitude:inflow+outflow,funds:[{ticker:'A',net:inflow},{ticker:'B',net:-outflow},{ticker:'C',net:0}]})):undefined;
  await route.fulfill({json:{schema:'cube-etf@1',model:'etf-fund-flows@1',...want,source:{state:'ok'},snapshot:{id:'a'.repeat(64)},scaleUsd:1e9,historyReady:true,reports:history,states:states.filter(r=>r.knownAt<Math.min(want.to,want.asOf))}});
 });
 const [p0,p1]=fake.info().priceBand.usdt;
 const hash=`#t=${new Date(from).toISOString()}~${new Date(to).toISOString()}&p=${p0}~${p1}&mode=candles&strip=${strip}&vis=2&rc=1`;
 await page.goto(fake.url+'/'+hash);
 return {fake,to,from,calls,hash,price:[p0,p1]};
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
test('ETF does not carry cached history beyond its queried window after a failed pan',async({page,fakeFor,probe,allowConsole})=>{
 allowConsole(/503/);const options={offset:-DAY},s=await setup(page,fakeFor,'etf',false,options);await probe.waitForReady();await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready');
 options.fail=true;
 const from=Math.ceil(s.to/DAY)*DAY,to=from+10*3600000;
 await page.goto(s.fake.url+`/#t=${new Date(from).toISOString()}~${new Date(to).toISOString()}&p=${s.price[0]}~${s.price[1]}&mode=candles&strip=etf&vis=2&rc=1`);
 await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','failed');
 const tip=await hoverReport(page);await expect(tip).toHaveAttribute('data-presentation','strip-etf');
 expect(await tip.locator('[data-strip-slot="summary"] dd').allTextContents()).toEqual(['—','—','—']);
});
test('ETF delayed reads finish while replay continues at 4x',async({page,fakeFor,probe})=>{
 const options={delay:650,replay:true},s=await setup(page,fakeFor,'off',false,options);await probe.waitForReady();
 await page.goto(s.fake.url+'/'+s.hash.replace('strip=off','strip=etf')+`&replay=1&at=${new Date(s.from+2*3600000).toISOString()}`);
 await expect.poll(()=>s.calls.length).toBeGreaterThan(0);
 await page.locator('#ol-speed').selectOption('4');await page.locator('#ol-play').click();
 await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready',{timeout:2000});
 await expect(page.locator('#ol-play')).toHaveAttribute('aria-pressed','true');
 await page.locator('#ol-play').click();
});
test('ETF failure backoff survives unrelated UI updates and retries after the deadline',async({page,fakeFor,probe,allowConsole})=>{
 await page.clock.install({time:new Date('2026-09-24T12:00:00Z')});allowConsole(/503/);
 const options={fail:true},s=await setup(page,fakeFor,'etf',false,options);await page.locator('#ol-loading').waitFor({state:'hidden'});await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','failed');
 expect(s.calls).toHaveLength(1);
 await page.locator('#ol-canvas').focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');
 await page.clock.fastForward(50000);expect(s.calls).toHaveLength(1);
 options.fail=false;await page.clock.fastForward(15000);
 await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready');expect(s.calls).toHaveLength(2);
});
test('ETF renders historical inflows and outflows instead of hatching their later capture time',async({page,fakeFor,probe,pane})=>{
 await setup(page,fakeFor,'etf',false,{history:true,span:7*DAY});await probe.waitForReady();await expect(page.locator('#ol-strip')).toHaveAttribute('data-state','ready');await probe.waitForQuiet();
 const canvas=page.locator('#ol-canvas'),g=await canvas.evaluate(n=>n.dataset.layout.split(',').map(Number)),top=g[14]+12,middle=top+20,frame=await pane.last();
 const bars=frame.rects.filter(r=>r.alpha===.7&&r.y>=top&&r.y+r.h<=top+40&&r.w>2&&r.fill!=='pattern');
 expect(bars.some(r=>r.y<middle&&r.h>8),'historical inflow has a visible height').toBe(true);
 expect(bars.some(r=>r.y===middle&&r.h>8),'historical outflow has a visible depth').toBe(true);
 expect(frame.rects.filter(r=>r.fill==='pattern'&&r.y===top+1&&r.h===38),'known historical dates are not hatched').toEqual([]);
 const box=await canvas.boundingBox();await page.mouse.move(box.x+g[0]+g[2]*.02,box.y+top+20);
 await expect(page.locator('#ol-tip')).toContainText('590');await expect(page.locator('#ol-tip')).toContainText('610');
});
