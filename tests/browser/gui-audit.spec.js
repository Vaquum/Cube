"use strict";
// #126: independently specified GUI contracts. Oracles: unchanged-edge identity, the published
// eleven-field candle schema, full-table/CSV agreement, and validated file round trips.
const { test, expect } = require("./fixtures.js");
const fs = require("node:fs/promises");
async function open(page, fakeFor, probe, extra="") {
  const fake=await fakeFor("standard");
  await page.goto(fake.url+"/#w=24h&vis=2&r=4,0"+extra);
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
  const target=current.slice(0,10)+"T00:00:56.250";
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
  const caption=await page.locator("#ol-table-caption").textContent(), match=caption.match(/([\d,]+) cells/);
  expect(match).not.toBeNull();const count=Number(match[1].replaceAll(",",""));
  const waiting=page.waitForEvent("download");await page.locator("#ol-export-cells").click();
  const download=await waiting, raw=await fs.readFile(await download.path(),"utf8"), lines=raw.trimEnd().split("\r\n");
  expect(lines[0]).toContain('"Source cutoff · UTC"');expect(lines[0]).toContain('"Volume · USDT"');
  expect(lines.length-1).toBe(count);
});
test("reference search retains Purpose / Read / Use and actual candle colours",async({page,fakeFor,probe})=>{
  await open(page,fakeFor,probe);await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-search").fill("retracement");await expect(page.locator("#ol-reference-article")).toContainText("Retracements");
  await expect(page.locator("#ol-reference-article dt")).toHaveText(["Purpose","Read","Use"]);
  await page.locator("#ol-reference-search").fill("");await page.locator("#ol-reference-topic").selectOption("candles");
  await expect(page.locator("#ol-reference-colours")).toContainText("Up · hollow body");
  expect(await page.locator(".ol-reference-colour-swatch").first().evaluate(el=>getComputedStyle(el).color)).toBe("rgb(45, 118, 156)");
});

