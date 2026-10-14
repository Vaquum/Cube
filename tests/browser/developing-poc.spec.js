"use strict";
const { test: base, expect } = require("./fixtures.js");
const canvas = require("./pane-canvas.js");
const test = base.extend({ pane: async ({ page }, use) => { await canvas.addRecorder(page); await use(canvas.forPage(page)); } });
test.use({ reducedMotion: "reduce" });
const EPOCH = Date.parse("2021-01-01T00:00Z"), BASE = 56250;
const trades = [
  ["2021-01-01T00:01Z", 2500000, 100000000], ["2021-01-01T00:16Z", 2512500, 200000000],
  ["2021-01-01T00:31Z", 2500000, 101000000], ["2021-01-01T00:46Z", 2512500, 100000000],
  ["2021-01-02T00:01Z", 2475000, 100000000],
].map(([time, price, qty]) => ({ t_ms: Date.parse(time) - EPOCH, price, qty, takerBuy: true }));
const profile = { name: "developing-poc", cutoffIso: "2021-01-02T02:00Z", trades };
const view = "#t=2021-01-01T00:00Z~2021-01-01T02:00Z&p=24000~26000&r=4,0&follow=free";
const checkbox = page => page.locator('input[data-line="devpoc"]');
const value = page => page.locator('[data-line-value="devpoc"]');
async function menu(page) { if (await page.locator("#ol-lines-pop").isHidden()) await page.keyboard.press("p"); }
async function close(page) { if (await page.locator("#ol-lines-pop").isVisible()) await page.keyboard.press("Escape"); }
const quote = page => value(page).textContent().then(v => Number(v.replace(/[^\d.-]/g, "")));
async function trailStroke(pane) {
  const ink = (await pane.colours()).poc, frame = await pane.last();
  return frame.strokes.find(s => s.stroke === ink && s.path.length >= 7 && s.path.some((p, i) => i && p[0] === s.path[i - 1][0] && p[1] !== s.path[i - 1][1]));
}
test("default-off toggle sits below Daily POC, persists, and draws a causal gold staircase", async ({ page, fakeFor, probe, pane }, info) => {
  const fake = await fakeFor(profile);
  await page.goto(`${fake.url}/${view}`); await probe.waitForReady();
  await menu(page); await expect(checkbox(page)).not.toBeChecked();
  const order = await page.locator('#ol-family-profile input[data-line]').evaluateAll(nodes => nodes.map(n => n.dataset.line));
  expect(order.indexOf("devpoc")).toBe(order.indexOf("dpoc") + 1);
  await checkbox(page).check(); await probe.waitForReady();
  await expect.poll(() => quote(page)).toBe(25187.5);
  await close(page); await probe.waitForQuiet({ quietMs: 300 });
  const stroke = await trailStroke(pane); expect(stroke).toBeDefined();
  for (let i = 1; i < stroke.path.length; i++) expect(stroke.path[i][0] === stroke.path[i - 1][0] || stroke.path[i][1] === stroke.path[i - 1][1], "every segment is horizontal or vertical").toBe(true);
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + (stroke.path[0][0] + stroke.path[1][0]) / 2, box.y + stroke.path[0][1]);
  const tip = page.locator("#ol-tip");
  await expect(tip).toHaveAttribute("data-reference-family", "developing-poc");
  expect(JSON.parse(await tip.getAttribute("data-observation")).result.value).toBe(25062.5);
  await expect(tip).toHaveAttribute("data-reference-known-at", "16");
  const jump = stroke.path.findIndex((p, i) => i && p[0] === stroke.path[i - 1][0] && p[1] !== stroke.path[i - 1][1]);
  expect(Math.abs(stroke.path[jump][1] - stroke.path[jump - 1][1])).toBeGreaterThan(8);
  await page.mouse.move(box.x + stroke.path[jump][0], box.y + (stroke.path[jump][1] + stroke.path[jump - 1][1]) / 2);
  await expect(tip).toHaveAttribute("data-reference-family", "developing-poc");
  expect(JSON.parse(await tip.getAttribute("data-observation")).result.value).toBe(25187.5);
  await expect(tip).toHaveAttribute("data-reference-known-at", "32");
  await page.mouse.move(0, 0); await page.reload(); await probe.waitForReady();
  await menu(page); await expect(checkbox(page)).toBeChecked();
  await close(page); await page.screenshot({ path: info.outputPath("developing-daily-poc.png") });
});
test("equal-height sample boundaries preserve the volume already known at the cursor", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor({ ...profile, trades: [...trades, { t_ms: 61 * 60000, price: 2512500, qty: 100000000, takerBuy: true }].sort((a, b) => a.t_ms - b.t_ms) });
  await page.goto(`${fake.url}/${view}&lines=devpoc`); await probe.waitForReady();
  await probe.waitForQuiet({ quietMs: 300 });
  const stroke = await trailStroke(pane), box = await page.locator("#ol-canvas").boundingBox();
  const boundary = stroke.path.findIndex((p, i) => i && p[0] === stroke.path[i - 1][0] && p[1] === stroke.path[i - 1][1]);
  expect(boundary).toBeGreaterThan(0);
  const tip = page.locator("#ol-tip"), point = stroke.path[boundary];
  await page.mouse.move(box.x + point[0] - 2, box.y + point[1]);
  await expect(tip).toHaveAttribute("data-reference-family", "developing-poc");
  await expect(tip).toHaveAttribute("data-reference-known-at", "64");
  await expect(tip).toContainText("125,625");
  await page.mouse.move(box.x + point[0] + 2, box.y + point[1]);
  await expect(tip).toHaveAttribute("data-reference-known-at", "80");
  await expect(tip).toContainText("150,750");
});
test("replay withholds unfinished samples and the next UTC session resets accumulation", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor(profile);
  await page.goto(`${fake.url}/${view.replace("02:00Z", "00:25Z")}&lines=devpoc`); await probe.waitForReady();
  await menu(page); await expect.poll(() => quote(page)).toBe(25062.5);
  await page.goto(`${fake.url}/${view}&lines=devpoc&replay=1&at=2021-01-01T00:44Z`); await probe.waitForReady();
  await menu(page); await expect.poll(() => quote(page)).toBe(25187.5);
  await page.goto(`${fake.url}/${view}&lines=devpoc&replay=1&at=2021-01-01T00:05Z`); await probe.waitForReady();
  await menu(page); await expect(value(page)).toHaveText("no completed sample");
  await page.goto(`${fake.url}/#t=2021-01-02T00:00Z~2021-01-02T02:00Z&p=24000~26000&r=4,0&lines=devpoc`); await probe.waitForReady();
  await menu(page); await expect.poll(() => quote(page)).toBe(24812.5);
});
test("historical trail fetches 15-minute rows independently of chart resolution and stops reading when disabled", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ ...profile, cutoffIso: "2026-09-24T12:02Z" });
  await page.goto(`${fake.url}/${view.replace("r=4,0", "r=9,3")}`); await probe.waitForReady();
  const gate = fake.on({ route: "/cube/tile", when: q => q.n === "4" && q.m === "0" }).gate();
  try {
    await menu(page); await checkbox(page).check(); await gate.arrived();
    await expect(value(page)).toHaveText("…");
    gate.open(); await probe.waitForReady(); await expect.poll(() => quote(page)).toBe(25187.5);
    const reads = fake.log().filter(r => r.path === "/cube/tile" && r.query.n === "4" && r.query.m === "0");
    expect(reads.length).toBeGreaterThan(0); expect(Number(reads.at(-1).query.b0)).toBe(0); expect(Number(reads.at(-1).query.b1)).toBe(1536);
    await checkbox(page).uncheck(); await probe.waitForReady(); fake.clearLog();
    await close(page); await page.keyboard.press("ArrowRight"); await probe.waitForReady();
    expect(fake.log().filter(r => r.path === "/cube/tile" && r.query.n === "4" && r.query.m === "0")).toHaveLength(0);
  } finally { gate.open(); }
});
test("live endpoint updates with arriving volume and whole-pack replacement", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ ...profile, cutoffIso: "2021-01-01T00:05Z", trades: trades.slice(0, 1) }, { next: 3 });
  await page.goto(`${fake.url}/${view}&lines=devpoc`); await probe.waitForReady();
  await menu(page); await expect.poll(() => quote(page)).toBe(25062.5);
  fake.holdPacks(1); fake.advance({ toIso: "2021-01-01T00:10Z", trades: [{ t_ms: 6 * 60000, price: 2512500, qty: 200000000, takerBuy: true }] });
  await expect.poll(() => quote(page), { timeout: 15000 }).toBe(25187.5);
  await close(page); await page.keyboard.press("r"); await probe.waitForReady();
});
test("recorded snapshots clearly mark the trail as Live cube only", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded"); await page.goto(fake.url); await probe.waitForReady(); await menu(page);
  await expect(checkbox(page)).toBeDisabled(); await expect(value(page)).toHaveText("Live cube only");
});
