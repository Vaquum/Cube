"use strict";
const {test,expect}=require("./fixtures.js");
test.use({reducedMotion:"reduce"});
const HASH="#w=24h&vis=2&rc=1&strip=forces&lines=",NOW=new Date("2026-10-24T12:00:00Z");
const reads=fake=>fake.log().filter(r=>r.path==="/cube/strip");
const history=r=>Number(r.query.to)-Number(r.query.from)>60*86400000;
async function freeze(page) {await page.clock.setFixedTime(NOW);await page.clock.pauseAt(NOW);await page.clock.setSystemTime(NOW);}
async function start(page,fake,probe,hash=HASH) {await page.clock.install({time:NOW});await page.goto(fake.url+"/"+hash);await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout",/,/);}
async function off(page) {await page.locator("#ol-strip").click();await page.locator('#ol-strip-menu [data-strip="off"]').click();}
for(const fault of ["view","loading","history"]) test(`${fault} retries at its own deadline while cube polls stay current`,async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("mini"),initial=fault==="history"?2:1,delay=fault==="loading"?15000:60000;
  fake.on({route:"/cube/strip",after:initial-1,times:1}).fail({status:503,body:{error:fault==="loading"?"strip_loading":"temporary_strip_failure"}});allowConsole(/Failed to load resource/);
  await start(page,fake,probe);await expect.poll(()=>reads(fake).filter(r=>r.status===503).length).toBe(1);await freeze(page);
  const cutoff=fake.info().cutoff;await page.clock.fastForward(delay-1000);expect(reads(fake)).toHaveLength(initial);
  await page.clock.fastForward(2000);await expect.poll(()=>reads(fake).some((r,i)=>i>=initial&&r.status===200)).toBe(true);
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  await page.clock.runFor(250);await expect.poll(()=>reads(fake).filter(r=>history(r)&&r.status===200).length).toBe(1);
  expect(reads(fake)[initial].query).toEqual(reads(fake)[initial-1].query);
  expect(fake.log().some(r=>r.path==="/cube/pack"&&r.answer==="current")).toBe(true);expect(fake.info().cutoff).toBe(cutoff);
});
test("persistent failures retain a full backoff after every response",async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("mini");fake.on({route:"/cube/strip"}).fail({status:502,body:{error:"still_unavailable"}});allowConsole(/Failed to load resource/);
  await start(page,fake,probe);await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","failed");await freeze(page);
  await page.clock.fastForward(61000);await expect.poll(()=>reads(fake).filter(r=>r.status===502).length).toBe(2);
  await page.clock.fastForward(59000);expect(reads(fake)).toHaveLength(2);
  await page.clock.fastForward(2000);await expect.poll(()=>reads(fake).length).toBe(3);
});
test("a slow failed request starts its retry backoff when the response finishes",async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("mini"),gate=fake.on({route:"/cube/strip",times:1}).gate();allowConsole(/Failed to load resource/);
  await start(page,fake,probe);await gate.arrived();await freeze(page);await page.clock.fastForward(20000);gate.fail(502,{error:"slow_failure"});
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","failed");
  await page.clock.fastForward(59000);expect(reads(fake)).toHaveLength(1);
  await page.clock.fastForward(2000);await expect.poll(()=>reads(fake).filter(r=>r.status===200).length).toBe(1);
});
test("healthy view and history grids retain their five- and thirty-minute refresh deadlines",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("mini");await start(page,fake,probe);await expect.poll(()=>reads(fake).filter(r=>r.status===200).length).toBe(2);await freeze(page);
  await page.clock.fastForward(299000);expect(reads(fake)).toHaveLength(2);
  await page.clock.fastForward(2000);await expect.poll(()=>reads(fake).filter(r=>!history(r)&&r.status===200).length).toBe(2);
  await page.clock.runFor(250);await page.clock.fastForward(1500000);
  await expect.poll(()=>reads(fake).filter(r=>!history(r)&&r.status===200).length).toBe(3);
  await page.clock.runFor(250);await expect.poll(()=>reads(fake).filter(r=>history(r)&&r.status===200).length).toBe(2);
  const count=reads(fake).length;await page.clock.fastForward(1000);expect(reads(fake)).toHaveLength(count);
});
for(const stop of ["off","captured","unconfigured"]) test(`${stop} cancels future Strip wake-ups`,async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor("mini");
  if(stop!=="captured") {fake.on({route:"/cube/strip",times:1}).fail({status:503,body:{error:stop==="unconfigured"?"strip_not_configured":"temporary_strip_failure"}});allowConsole(/Failed to load resource/);}
  await start(page,fake,probe);await expect(page.locator("#ol-strip")).toHaveAttribute("data-state",stop==="unconfigured"?"unconfigured":stop==="off"?"failed":"ready");
  await freeze(page);
  if(stop==="off")await off(page);
  if(stop==="captured") {await page.evaluate(async()=>window.cubeAgent.apply(await window.cubeAgent.export()));await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","uncaptured");}
  const count=reads(fake).length;await page.clock.fastForward(1860000);expect(reads(fake)).toHaveLength(count);
});

test("a historical view has no five-minute refresh while history retains its deadline",async({page,fakeFor,probe})=>{
  const fake=await fakeFor("mini"),cut=Date.parse(fake.info().cutoff),iso=ms=>new Date(ms).toISOString(),[low,high]=fake.info().priceBand.usdt;
  const hash=`#t=${iso(cut-2*86400000)}~${iso(cut-86400000)}&p=${low}~${high}&vis=2&rc=1&strip=forces&lines=`;
  await start(page,fake,probe,hash);await expect.poll(()=>reads(fake).filter(r=>r.status===200).length).toBe(2);await freeze(page);
  await page.clock.fastForward(301000);expect(reads(fake)).toHaveLength(2);
});
