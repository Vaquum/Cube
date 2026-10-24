"use strict";
const {test,expect}=require("./fixtures.js");
// Hand sum: 2 BTC in row 201 outweighs 1 BTC in row 200; row centres are 25,187.5 and 25,062.5.
const VIEW="#t=2021-01-01T00:00Z~2021-01-02T00:00Z&p=24000~26000&r=12,3&auto=0&vis=2&lines=devpoc";
function input(reverse=false) {return {cutoffIso:"2021-03-02T00:00:00Z",trades:[
  {t_ms:60000,price:2500000,qty:reverse?300000000:100000000,takerBuy:true},
  {t_ms:960000,price:2512500,qty:reverse?100000000:200000000,takerBuy:true},
  {t_ms:60*86400000-3600000,price:2500000,qty:100000000,takerBuy:true}
]};}
async function value(page,expected) {
  await page.locator("#ol-lines").click();
  await expect(page.locator('[data-line-value="devpoc"]')).toHaveText(expected);
  await page.keyboard.press("Escape");
}
async function open(page,fake,probe,expected) {await page.goto(fake.url+"/"+VIEW);await probe.waitForReady();await value(page,expected);}
test("a dedicated old-session POC read survives Share and fresh-context restore without live reads",async({page,fakeFor,probe,freshContext})=>{
  const fake=await fakeFor(input());await open(page,fake,probe,"25,187.5");
  const doc=await page.evaluate(()=>window.cubeAgent.export()),link=await page.evaluate(()=>window.cubeAgent.share());
  expect(doc.snapshot.cache.developingPocReads.cubeMap).toHaveLength(1);
  const other=await (await freshContext()).newPage(),reads=[];
  other.on("request",r=>{if(/\/cube\/(tile|query)/.test(new URL(r.url()).pathname))reads.push(r.url());});
  await other.goto(link);await expect(other.locator("#ol-analysis-status")).toContainText("Captured evidence");
  await value(other,"25,187.5");expect(reads).toEqual([]);
  expect(await other.evaluate(()=>window.cubeAgent.export()).then(d=>d.snapshot.cache.developingPocReads)).toEqual(doc.snapshot.cache.developingPocReads);
});
test("restoring a POC capture replaces a warm tab's different session and memo",async({page,fakeFor,probe})=>{
  const first=await fakeFor(input());await open(page,first,probe,"25,187.5");const doc=await page.evaluate(()=>window.cubeAgent.export());
  const second=await fakeFor(input(true));await open(page,second,probe,"25,062.5");
  await page.evaluate(d=>window.cubeAgent.apply(d),doc);await value(page,"25,187.5");
});
test("a legacy capture missing its POC read discloses unavailable support and clears warm data",async({page,fakeFor,probe})=>{
  const fake=await fakeFor(input());await open(page,fake,probe,"25,187.5");
  await page.evaluate(async()=>{const d=await window.cubeAgent.export();delete d.snapshot.cache.developingPocReads;await window.cubeAgent.apply(window.explorerAgent.seal(d));});
  await value(page,"not captured");
});
test("a captured latest POC discloses an earlier admitted session that was still loading at Share",async({page,fakeFor,probe,freshContext})=>{
  const data=input();data.trades.splice(2,0,{t_ms:86400000+60000,price:2450000,qty:100000000,takerBuy:true});
  const fake=await fakeFor(data),gate=fake.on({route:"/cube/tile",when:q=>q.n?.[0]==="4"&&q.m?.[0]==="0"&&q.b0?.[0]==="0",times:1}).gate();
  await page.goto(fake.url+"/"+VIEW.replace("2021-01-02T00:00Z","2021-01-03T00:00Z"));await gate.arrived();
  await value(page,"24,562.5");const doc=await page.evaluate(()=>window.cubeAgent.export()),link=await page.evaluate(d=>window.cubeAgent.share(d),doc);gate.open();
  const other=await (await freshContext()).newPage(),reads=[];other.on("request",r=>{if(/\/cube\/(tile|query)/.test(new URL(r.url()).pathname))reads.push(r.url());});
  await other.goto(link);await expect(other.locator("#ol-analysis-status")).toContainText("Captured evidence");
  await value(other,"24,562.5 · 1 of 2 sessions not captured");expect(reads).toEqual([]);
});
test("invalid dedicated support is rejected before the outgoing investigation mutates",async({page,fakeFor,probe})=>{
  const fake=await fakeFor(input());await open(page,fake,probe,"25,187.5");const before=await page.evaluate(()=>window.cubeAgent.export()),url=page.url();
  const error=await page.evaluate(async d=>{const block=d.snapshot.cache.developingPocReads.cubeMap[0][1];block.b1=16;block.col1=1;try{await window.cubeAgent.apply(window.explorerAgent.seal(d));return "unexpected success";}catch(e){return e.message;}},before);
  expect(error).toMatch(/developing POC coverage/);await value(page,"25,187.5");expect(page.url()).toBe(url);expect((await page.evaluate(()=>window.cubeAgent.export())).snapshot.cache.developingPocReads).toEqual(before.snapshot.cache.developingPocReads);
});
