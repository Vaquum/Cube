"use strict";
const {test,expect}=require("./fixtures.js");
const fixture=require("../fixtures/regressions/clipped-capture-support/cases.json");
const EPOCH=1609459200000,BASE=56250,iso=c=>new Date(EPOCH+c*BASE).toISOString();
async function hover(page,a,b,low,high) {
  const canvas=page.locator("#ol-canvas"),box=await canvas.boundingBox(),layout=(await canvas.getAttribute("data-layout")).split(",").map(Number);
  const params=new URLSearchParams(new URL(page.url()).hash.slice(1));
  const [t0,t1]=params.get("t").split("~").map(Date.parse),[p0,p1]=params.get("p").split("~").map(Number);
  await page.mouse.move(box.x+layout[0]+layout[2]*(EPOCH+(a+b)/2*BASE-t0)/(t1-t0),box.y+layout[1]+layout[3]*(p1-(low+.5)*125)/(p1-p0));
  await expect(page.locator("#ol-tip")).toBeVisible();
}
for(const phase of ["pending","failed"]) for(const basis of ["amount","intensity"]) for(const sample of fixture.cases) {
  test(`${phase} ${sample.name} hover with ${basis} withholds unsupported counters and recovers`,async({page,fakeFor,probe,allowConsole})=>{
    const cutoff=sample.cutoffBase??fixture.cutoffBase;
    const trades=[...fixture.trades.filter(t=>t.base<cutoff),...(sample.extraTrades??[])].map(({base,offsetMs,...t})=>({...t,t_ms:base*BASE+offsetMs})).sort((a,b)=>a.t_ms-b.t_ms);
    const fake=await fakeFor({cutoffIso:iso(cutoff),trades}),gate=fake.on({route:"/cube/query",times:1}).gate();
    const [a,b,low,high]=sample.bounds;
    const view=sample.selection===false
      ? `#t=${iso(a)}~${iso(b)}&p=${low*125}~${high*125}&r=12,3`
      : `#t=${iso(0)}~${iso(8192)}&p=24000~27000&r=${(sample.resolution??[12,3]).join(",")}&sel=${iso(a)}~${iso(b)},${low*125}~${high*125}`;
    await page.goto(fake.url+"/"+view+`&auto=0&vis=2&lines=&bs=${basis==="intensity"?"i":"a"}`);
    await gate.arrived();await expect(page.locator("#ol-focus-title")).toHaveText("Measuring…");
    if(phase==="failed") {allowConsole(/Failed to load resource/);gate.fail(502,{error:"exact_rectangle_unavailable"});await expect(page.locator("#ol-focus-title")).toHaveText("Not measured");}
    await hover(page,a,b,low,high);
    const tip=page.locator("#ol-tip"),observation=()=>tip.evaluate(n=>JSON.parse(n.dataset.observation));
    expect((await observation()).result.tag).toBe(phase);
    await expect(tip).not.toContainText("Complete");
    expect(await tip.locator(".ol-cell-stats dd[data-canonical]").evaluateAll(nodes=>nodes.map(n=>n.dataset.canonical))).toEqual([phase]);
    if(phase==="failed")await page.reload();else gate.open();
    await probe.waitForReady();await hover(page,a,b,low,high);
    await expect.poll(async()=>(await observation()).result.tag).toBe("finite");
    const obs=await observation();
    const value=basis==="amount"?sample.volume:sample.volume/((b-a)*56.25/60*(high-low));
    expect(obs.result.value).toBe(value);
    expect(obs.time).toEqual([a,b]);
    expect(obs.price).toEqual([low*125,high*125]);
    await expect(tip.locator(".ol-tip-sub")).toHaveText(`${(low*125).toLocaleString("en-US")}–${(high*125).toLocaleString("en-US")} USDT`);
    expect(obs.exposure.seconds).toBe((b-a)*56.25);
  });
}
