"use strict";
// B70: genuine coeval Micro response and execution excerpt; protocol harness only.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const { test, expect } = require("./fixtures.js");
const root = path.resolve(__dirname, "../fixtures/micro"),
  profile = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "trades.json.gz")))),
  overview = JSON.parse(fs.readFileSync(path.join(root, "overview.json"))),
  detail = JSON.parse(fs.readFileSync(path.join(root, "detail.json")));
test.use({ reducedMotion: "reduce" });
const hash="#mode=candles&t=2026-10-24T14:24:00Z~2026-10-24T14:32:00Z&p=79900~80400&vis=2&rc=1";

async function declareMicro(page, fake) {
  await page.route(fake.url+"/", async route=>{
    const response=await route.fetch(), text=await response.text();
    await route.fulfill({response,body:text.replace("<head>",'<head><meta name="explorer-micro" content="/cube/micro">')});
  });
}

function excerpt(want, omitAnchor = false) {
  const captured = want.step === 1000 ? detail : overview;
  if (![1000,60000].includes(want.step)) throw new Error("The recorded proof covers only its original one-second and one-minute grids");
  const bins = [];
  for(let at=want.from;at<want.to;at+=want.step) {
    const original = captured.bins.find(b=>b.at===at), eligible = original?.book && original.book.observedAtUs < want.as_of*1000;
    // Outside the captured excerpt is unavailable; no market rows are made up.
    bins.push(original ? {...original, book: eligible ? original.book : null} :
      {at,until:at+want.step,book:null,flow:null,groups:null,coveredMs:{trades:0,groups:0,book:0}});
  }
  return {...captured,from:want.from,to:want.to,step:want.step,asOf:want.as_of,bins,
    anchor:!omitAnchor&&want.from===detail.from&&want.step===1000 ? detail.anchor : null};
}

async function hoverAt(page, time, band = true) {
  const canvas=page.locator("#ol-canvas"), box=await canvas.boundingBox(), layout=await canvas.evaluate(n=>n.dataset.layout.split(",").map(Number)),
    times=await page.evaluate(()=>new URLSearchParams(location.hash.slice(1)).get("t").split("~").map(Date.parse));
  await page.mouse.move(box.x+layout[0]+(time-times[0])/(times[1]-times[0])*layout[2],box.y+(band?layout[14]+23:layout[1]+layout[3]/2));
}

test("Micro is lazy, restores its address and paints genuine flow/response in hover and Inspect", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor(profile,{strip:"off"}), calls=[];
  let omitAnchor=false;
  await declareMicro(page, fake);
  await page.route("**/cube/micro?**",async route=>{
    const want=route.request().postDataJSON();calls.push(want);
    await route.fulfill({json:excerpt(want,omitAnchor)});
  });
  await page.goto(fake.url+"/"+hash);await probe.waitForReady();
  expect(calls).toHaveLength(0);
  await page.locator("#ol-strip").click();
  await page.locator('#ol-strip-menu [data-strip="micro"]').click();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  await expect.poll(()=>calls.filter(c=>c.step===60000).length).toBeGreaterThan(0);
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("strip")).toBe("micro");
  await hoverAt(page,detail.to+500);
  const card=page.locator('#ol-tip[data-presentation="strip-micro"]');
  await expect(card.locator(".ol-micro-plot")).toBeVisible();
  const net=detail.bins.reduce((s,b)=>s+b.flow.buy-b.flow.sell,0), latest=detail.bins.filter(b=>b.book).at(-1).book,
    baseline=detail.anchor??detail.bins.find(b=>b.book).book, move=(latest.mid/baseline.mid-1)*10000;
  await expect(card.locator(".ol-micro-hero strong")).toHaveText(`${move<0?"−":"+"}${Math.abs(move).toFixed(2)} bp`);
  expect(Math.sign(net)).toBe(-1);
  await expect(card).toContainText("exchange groups");
  await expect(card.locator("svg")).toHaveAttribute("aria-label",/trade VWAPs/);
  await card.screenshot({path:"reports/micro-hover.png"});
  // The same owned cursor switches to the deeper response trajectory through native Inspect.
  await page.keyboard.press("e");
  await expect(page.locator('#ol-inspect [data-presentation="strip-micro"] svg')).toHaveAttribute("aria-label",/Cumulative net aggressive/);
  const inspector=page.locator("#ol-inspect-readout");
  expect(await inspector.evaluate(n=>n.getBoundingClientRect().right-window.innerWidth),"Micro Inspect fits the viewport").toBeLessThanOrEqual(1);
  const clipped=await inspector.evaluate(n=>{
    const box=n.getBoundingClientRect(), walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),bad=[];
    while(walker.nextNode()){
      const text=walker.currentNode;if(!text.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(text);
      for(const r of range.getClientRects())if(r.width&& (r.right>box.right+1||r.left<box.left-1))bad.push(text.textContent);
    }
    return bad;
  });
  expect(clipped,"Micro labels and values fit the existing Inspect panel").toEqual([]);
  await inspector.screenshot({path:"reports/micro-response.png"});
  expect(await inspector.evaluate(n=>n.getBoundingClientRect().right<=n.parentElement.getBoundingClientRect().right+1)).toBe(true);
  await page.locator("#ol-inspect-strip-view").selectOption("sources");
  await expect(inspector).toContainText(detail.sources.book.partitions[0][1]);
  await expect(inspector.locator("svg")).toHaveCount(0);
  expect(calls.every(c=>c.to<=c.as_of)).toBe(true);
  // Deliberate protocol omission: withhold only the genuine pre-window anchor.
  // The response must start at its first observed quote, never an invented origin.
  omitAnchor=true;
  await page.reload(); await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("aria-label","Strip: Micro");
  await hoverAt(page,detail.to+500);
  await expect(card).toContainText("Price baseline: first captured quote");
  await page.keyboard.press("e");
  await expect(inspector.locator("svg")).toContainText("First quote");
});

test("Micro retries failed overview and uncached Inspect reads, then refreshes Response map and Sources without cursor movement", async ({page, fakeFor, probe, allowConsole})=>{
  allowConsole(/503/);
  const fake=await fakeFor(profile,{strip:"off"});
  await declareMicro(page,fake);
  const failNext=()=>fake.on({route:"/cube/micro",times:1}).fail({status:503,body:{error:"query_busy"}});
  failNext();
  let overviewCalls=0,detailCalls=0,release;
  let gate=new Promise(resolve=>{release=resolve;});
  await page.route("**/cube/micro?**",async route=>{
    const want=route.request().postDataJSON();
    // Deliberate transport faults: omit no captured market rows or values.
    const first=want.step===1000?++detailCalls===1:++overviewCalls===1;
    if(first){const response=await route.fetch();expect(response.status()).toBe(503);await route.fulfill({response});return;}
    if(want.step===1000)await gate;
    await route.fulfill({json:excerpt(want)});
  });
  for(const part of ["forces","sources"]){
    if(part==="sources"){
      detailCalls=0;gate=new Promise(resolve=>{release=resolve;});
      await page.reload();
    }else await page.goto(fake.url+"/"+hash+"&strip=micro");
    await probe.waitForReady();
    await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready",{timeout:15000});
    failNext();
    await hoverAt(page,detail.to+500,false);
    await page.keyboard.press("e");
    await page.locator('#ol-inspect-surfaces [data-surface="strip"]').click();
    if(part==="sources")await page.locator("#ol-inspect-strip-view").selectOption(part);
    const readout=page.locator("#ol-inspect-readout");
    await expect(readout).toContainText("Micro unavailable");
    await expect.poll(()=>detailCalls,{timeout:15000}).toBe(2);
    release();
    if(part==="sources")await expect(readout).toContainText(detail.sources.book.partitions[0][1]);
    else await expect(readout.locator("svg")).toHaveAttribute("aria-label",/Cumulative net aggressive/);
  }
  expect(overviewCalls).toBeGreaterThanOrEqual(2);
});

test("Micro caps wide-view pages at 4096 bins and the Query summary and copied view name its own book receipt",async({page,fakeFor,probe})=>{
  await page.setViewportSize({width:3000,height:950});
  // Extend only the protocol's held cutoff to exercise a three-day viewport.
  // The immutable captured executions are unchanged; all other market bins stay unavailable.
  const fake=await fakeFor({...profile,cutoffIso:"2026-10-27T14:32:00Z"},{strip:"off"}),calls=[];
  await declareMicro(page,fake);
  await page.route("**/cube/micro?**",async route=>{
    const want=route.request().postDataJSON();calls.push(want);
    expect(want.step,"The wide viewport must retain one-minute book bins").toBe(60000);
    await route.fulfill({json:excerpt(want)});
  });
  await page.goto(fake.url+"/#mode=candles&t=2026-10-24T14:24:00Z~2026-10-27T14:24:00Z&p=79900~80400&vis=2&rc=1&strip=micro");
  await probe.waitForReady();
  await expect(page.locator("#ol-strip")).toHaveAttribute("data-state","ready");
  await expect.poll(()=>calls.length).toBeGreaterThan(1);
  expect(calls.every(w=>(w.to-w.from)/w.step<=4096&&w.to-w.from<=31*86400000)).toBe(true);
  await page.locator("#ol-tab-query").click();
  const row=page.locator('#ol-summary [data-field="strip"]');
  await expect(row).toHaveAttribute("data-value","micro");
  await expect(row).toContainText("Micro");
  await expect(row).not.toContainText("Forces");
  await expect(row).not.toContainText("field data");
  await expect(row).toContainText(new Date(Math.max(...overview.bins.filter(b=>b.book).map(b=>b.book.observedAtUs))/1000).toISOString());
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.copiedMicroSummary=text;}}}));
  await page.locator("#ol-copy-summary").click();
  await expect.poll(()=>page.evaluate(()=>window.copiedMicroSummary)).toContain("Strip: Micro");
});
