"use strict";
// #126: independently specified GUI contracts. Oracles: unchanged-edge identity, the published
// eleven-field candle schema, full-table/CSV agreement, and validated file round trips.
const { test, expect } = require("./fixtures.js");
const fs = require("node:fs/promises");
async function open(page, fakeFor, probe, extra="") {
  const fake=await fakeFor("standard");
  const params=new URLSearchParams("w=24h&vis=2&r=4,0");
  for(const [key,value] of new URLSearchParams(extra))params.set(key,value);
  await page.goto(fake.url+"/#"+params);
  await probe.waitForReady(); return fake;
}
test("candle headers describe all eleven values in order", async({page,fakeFor,probe})=>{
  const fake=await fakeFor("micro:bars");
  await page.goto(fake.url+"/#t=2021-01-01T00:00Z~2021-01-01T00:20Z&p=24800~25400&r=2,0&mode=candles");
  await probe.waitForReady(); await page.locator("#ol-tab-cells").click(); await probe.waitForReady();
  await expect(page.locator("#ol-candle-table thead th")).toHaveText(["Interval · UTC","Open · USDT","High · USDT","Low · USDT","Close · USDT","Net move · USDT","High−low · USDT","Net move / daily ATR","High−low / daily ATR","Direction","Status"]);
  await expect(page.locator("#ol-candle-table tbody tr").first().locator("td")).toHaveCount(11);
  await expect(page.locator("#ol-candle-table tbody tr").first().locator("td").nth(9)).toHaveText(/up|down|unchanged/);
});
test("an unchanged fractional replay edge does not step backwards",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe,"&r=0,0");
  await page.locator("#ol-replay").click(); await probe.waitForReady();
  const field=page.locator("#ol-replay-edge"), current=await field.inputValue();
  const target=current.slice(0,10)+"T00:00:56.25";
  await field.fill(target); await page.locator("#ol-replay-jump button").click(); await probe.waitForReady();
  const before=await field.inputValue(), label=await page.locator("#ol-replay-at").textContent();
  expect(Date.parse(before+"Z")%1000).toBe(250);
  await page.locator("#ol-replay-jump button").click(); await probe.waitForReady();
  expect(await field.inputValue()).toBe(before); expect(await page.locator("#ol-replay-at").textContent()).toBe(label);
});
test("full supported volume captures do not inherit absent movement exposure",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);
  await page.locator("#ol-tab-cells").click(); await probe.waitForReady();
  await page.locator('#ol-table-body tr[data-state="complete"]').first().getByRole("button",{name:"Add to comparison",exact:true}).click();
  await expect(page.locator(".ol-comparison-completeness")).toContainText("Complete");
  await expect(page.locator(".ol-comparison-completeness")).not.toContainText("Short exposure");
});
test("hiding the interpretation bar returns focus to Restore chart when Compare is expanded",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-tab-cells").click();await probe.waitForReady();
  await page.locator('#ol-table-body tr[data-state="complete"]').first().getByRole("button",{name:"Add to comparison",exact:true}).click();
  const expand=page.locator('[data-comparison-action="expand"]');await expand.click();
  await page.locator("#ol-reset-canvas").focus();await page.keyboard.press("Shift+J");
  await page.locator("#ol-cell-key").focus();await page.keyboard.press("Shift+J");
  await expect(page.locator("#ol-view-keys")).toBeHidden();await expect(expand).toBeFocused();
  await page.keyboard.press("Enter");await expect(page.locator("#ol-canvas")).toBeVisible();
});
test("comparison export is durable and import validation is atomic; clear has Undo",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe); await page.locator("#ol-tab-cells").click(); await probe.waitForReady();
  await page.locator('#ol-table-body tr[data-state="complete"]').first().getByRole("button",{name:"Add to comparison",exact:true}).click();
  const waiting=page.waitForEvent("download");await page.locator('[data-comparison-action="export"]').click();
  const file=await waiting, raw=await fs.readFile(await file.path(),"utf8"), record=JSON.parse(raw);
  expect(record.comparisonVersion).toBe(2);expect(record.captures).toHaveLength(1);
  await page.locator("[data-comparison-import]").setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from('{"comparisonVersion":999}')});
  await expect(page.locator("[data-comparison-status]")).not.toHaveText("");
  await expect(page.locator(".ol-comparison-card")).toHaveCount(1);
  await page.locator('[data-comparison-action="clear"]').click();await page.getByRole("button",{name:"Confirm",exact:true}).click();
  await expect(page.locator(".ol-comparison-empty")).toBeVisible();
  await page.locator('[data-comparison-action="undo"]').click();await expect(page.locator(".ol-comparison-card")).toHaveCount(1);
  await page.locator('[data-comparison-action="clear"]').click();await page.getByRole("button",{name:"Confirm",exact:true}).click();
  await page.locator("[data-comparison-import]").setInputFiles({name:"saved.json",mimeType:"application/json",buffer:Buffer.from(raw)});
  await expect(page.locator(".ol-comparison-card")).toHaveCount(1);
  await expect(page.locator("[data-comparison-status]")).toContainText("Collection imported");
});
test("CSV exports all listed cells rather than the visible page",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-tab-cells").click();await probe.waitForReady();
  const caption=await page.locator("#ol-table-caption").textContent(), match=caption.match(/([\d,]+) occupied cells/);
  expect(match).not.toBeNull();const count=Number(match[1].replaceAll(",",""));
  const waiting=page.waitForEvent("download");await page.locator("#ol-export-cells").click();
  const download=await waiting, raw=await fs.readFile(await download.path(),"utf8"), lines=raw.trimEnd().split("\r\n");
  expect(lines[0]).toContain('"Source cutoff · UTC"');expect(lines[0]).toContain('"Volume · USDT"');
  expect(lines.length-1).toBe(count);
  const fields=line=>[...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match=>match[1].replaceAll('""','"'));
  const header=fields(lines[0]),volume=header.indexOf("Volume · USDT"),chosen=header.indexOf("Cells value"),state=header.indexOf("Value state");
  const finite=lines.slice(1).map(fields).filter(row=>row[state]==="finite");expect(finite.length).toBeGreaterThan(0);
  for(const row of finite)expect(Number(row[chosen])).toBe(Number(row[volume]));
});
test("reference search retains Purpose / Read / Use and actual candle colours",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-search").fill("retracement");await expect(page.locator("#ol-reference-article")).toContainText("Retracements");
  await expect(page.locator("#ol-reference-article dt")).toHaveText(["Purpose","Read","Use"]);
  await page.locator("#ol-reference-search").fill("");await page.locator("#ol-reference-topic").selectOption("candles");
  await expect(page.locator("#ol-reference-colours")).toContainText("Up · hollow body");
  expect(await page.locator(".ol-reference-colour-swatch").first().evaluate(el=>getComputedStyle(el).color)).toBe("rgb(45, 118, 156)");
});


test("phone Show reveals the control above the reference and Back restores the article",async({page,fakeFor,probe})=>{
  await page.setViewportSize({width:390,height:844}); await open(page,fakeFor,probe);
  await page.locator("#ol-reference-toggle").click(); await page.locator("#ol-reference-topic").selectOption("columns");
  await page.getByRole("button",{name:"Show Columns menu",exact:true}).click();
  await expect(page.locator("#ol-pane")).toBeVisible();
  expect(await page.locator("#ol-pane").evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("#ol-pane")===el;})).toBe(true);
  await page.locator("#ol-reference-back").click(); await expect(page.locator("#ol-reference")).toBeVisible();
  await expect(page.locator("#ol-reference-topic")).toHaveValue("columns");
  await expect(page.locator("#origo-lens")).not.toHaveAttribute("data-sheet","open");
  await page.locator("#ol-reference-topic").selectOption("poc-value");
  await page.getByRole("button",{name:"Show POC overlay",exact:true}).click();
  await expect(page.locator("#ol-lines-pop")).toBeVisible();await expect(page.locator("#ol-poc")).toBeVisible();
  await page.locator("#ol-poc").check();await expect(page.locator("#ol-poc")).toBeChecked();
  await page.locator("#ol-reference-back").click();await expect(page.locator("#ol-reference-topic")).toHaveValue("poc-value");
});

test("Candle Jump preserves an exact sub-base timestamp",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe,"&mode=candles");await page.locator("#ol-replay").click();await probe.waitForReady();
  const field=page.locator("#ol-replay-edge"),value=await field.inputValue(),target=value.slice(0,10)+"T00:00:56.125";
  await field.fill(target);await page.locator("#ol-replay-jump button").click();await probe.waitForReady();
  expect(await field.inputValue()).toBe(target);await expect(page.locator("#ol-replay-jump-status")).toContainText("exact exclusive candle cutoff");
});

test("reference state keys retain the footer's painted glyphs",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);
  for(const id of ["poc","area","untested"])await expect(page.locator("#ol-"+id)).toBeHidden();
  await page.locator("#ol-canvas").focus();await page.keyboard.press("p");
  const overlays=page.locator('#ol-lines-pop [role="group"][aria-labelledby="ol-column-overlays-title"]');
  await expect(overlays).toBeVisible();
  for(const id of ["poc","area","untested"])await overlays.locator("#ol-"+id).check();
  await page.keyboard.press("Escape");await page.locator("#ol-canvas").focus();await page.keyboard.press("Shift+P");
  await expect(page.locator("#ol-poc")).not.toBeChecked();
  for(const id of ["area","untested"])await expect(page.locator("#ol-"+id)).toBeChecked();
  await expect(page.locator("#ol-view-keys")).toBeHidden();
  await page.locator("#ol-canvas").focus();await page.keyboard.press("Shift+J");
  await expect(page.locator("#ol-view-keys")).toBeVisible();
  await page.locator("#ol-cell-key").focus();await page.keyboard.press("Shift+J");
  await expect(page.locator("#ol-view-keys")).toBeHidden();
  await expect(page.locator("#ol-canvas")).toBeFocused();
  await page.keyboard.press("Shift+J");
  await page.locator("#ol-key-guide").click();await probe.waitForReady();
  const painted=await page.evaluate(()=>{
    const originals=[...document.querySelectorAll(".ol-status > .ol-status-keys canvas")],copies=[...document.querySelectorAll("#ol-reference-colours .ol-status-keys canvas")];
    const bytes=c=>[...c.getContext("2d").getImageData(0,0,c.width,c.height).data];
    return {source:originals.map(bytes),copy:copies.map(bytes)};
  });
  expect(painted.source.length).toBeGreaterThan(0);expect(painted.source.some(b=>b.some((v,i)=>i%4===3&&v>0))).toBe(true);
  expect(painted.copy).toEqual(painted.source);
});

test("colour keys explain disabled Rows and retain focus through redraw and Tab",async({page,fakeFor,probe})=>{
  await page.emulateMedia({colorScheme:"light"});await open(page,fakeFor,probe,"&rows=off");
  await page.locator("#ol-reference-toggle").click();await page.locator("#ol-reference-topic").selectOption("rows");
  await expect(page.locator("#ol-reference-colours")).toContainText("Rows is off. Enable Rows to read its fitted colour scale.");
  await page.locator("#ol-reference-topic").selectOption("scales");
  const colours=page.locator("#ol-reference-colours"),action=colours.getByRole("button",{name:"Show fitted colour scale",exact:true});
  await action.focus();await expect(action).toBeFocused();const before=await colours.getAttribute("data-key");
  await page.emulateMedia({colorScheme:"dark"});await expect(colours).not.toHaveAttribute("data-key",before);
  await expect(action).toBeFocused();await page.keyboard.press("Tab");await expect(page.locator("#ol-legend")).toBeFocused();
});
