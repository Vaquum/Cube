"use strict";
const {test,expect}=require("./fixtures.js");
const fixture=require("../fixtures/regressions/clipped-capture-support/cases.json");
const EPOCH=1609459200000,BASE=56250,iso=c=>new Date(EPOCH+c*BASE).toISOString();
async function hover(page,a,b,low,high) {
  const canvas=page.locator("#ol-canvas"),box=await canvas.boundingBox(),layout=(await canvas.getAttribute("data-layout")).split(",").map(Number);
  const params=new URLSearchParams(new URL(page.url()).hash.slice(1));
  const [t0,t1]=params.get("t").split("~").map(Date.parse),[p0,p1]=params.get("p").split("~").map(Number);
  const point={x:box.x+layout[0]+layout[2]*(EPOCH+(a+b)/2*BASE-t0)/(t1-t0),y:box.y+layout[1]+layout[3]*(p1-(low+.5)*125)/(p1-p0)};
  await page.mouse.move(point.x,point.y);
  await expect(page.locator("#ol-tip")).toBeVisible();
  return point;
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

const input = () => ({cutoffIso:iso(fixture.cutoffBase),trades:fixture.trades.map(({base,offsetMs,...t})=>({...t,t_ms:base*BASE+offsetMs}))});
const selected = (low=200) => `#t=${iso(0)}~${iso(8192)}&p=24000~27000&r=12,3&auto=0&vis=2&lines=&sel=${iso(1600)}~${iso(1601)},${low*125}~${(low+1)*125}`;
test("a lower-price-clipped card keeps its displayed histories when captured",async({page,fakeFor,probe})=>{
  const fake=await fakeFor(input());await page.goto(fake.url+"/"+selected(201));await probe.waitForReady();
  const p=await hover(page,1600,1601,201,202),observation=JSON.parse(await page.locator("#ol-tip").getAttribute("data-observation"));
  expect(observation.price).toEqual([25125,25250]);expect(observation.result.value).toBe(502.5);
  await page.mouse.click(p.x,p.y,{button:"right"});await page.getByRole("menuitem",{name:"Add to comparison",exact:true}).click();
  const capture=(await page.evaluate(()=>window.cubeAgent.export("comparison"))).comparison.captures[0];
  expect(capture.context.histories.length).toBeGreaterThan(0);
  expect(capture.originatingObservation.result).toEqual(observation.result);
  expect(capture.context.supports.observation.price).toEqual(observation.price);
});
for(const mode of ["path","dwell"]) test(`${mode} retains independently measured partial motion after activity fails`,async({page,fakeFor,probe,allowConsole})=>{
  const fake=await fakeFor(input()),gate=fake.on({route:"/cube/query",when:q=>q.motion!=="1"&&"r0" in q,times:1}).gate();
  allowConsole(/Failed to load resource/);
  await page.goto(fake.url+"/"+selected()+"&mode="+mode);await gate.arrived();gate.fail(502,{error:"activity_unavailable"});
  await expect(page.locator("#ol-focus-title")).toHaveText("Not measured");await expect.poll(()=>fake.log().some(r=>r.path==="/cube/query"&&r.query.motion==="1"&&r.status===200)).toBe(true);
  await hover(page,1600,1601,200,201);
  const obs=()=>page.locator("#ol-tip").evaluate(n=>JSON.parse(n.dataset.observation));
  await expect.poll(async()=>(await obs()).result.tag).toBe("finite");
  // One 125-USDT move into the band; the first price holds there for exactly one second.
  expect((await obs()).result.value).toBe(mode==="path"?1:1/56.25);
  await expect(page.locator('#ol-tip [data-field="trades"]')).toHaveCount(0);
  await page.keyboard.press("e");
  await expect.poll(async()=>JSON.parse(await page.locator("#ol-inspect-readout").getAttribute("data-observation")).result).toEqual((await obs()).result);
});
