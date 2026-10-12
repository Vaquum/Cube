"use strict";
// Oracle: micro:mixed hand facts (cell 0/200: 300 USDT, 2 trades); fresh contexts
// prove portable state, exact evidence retention and rollback on invalid content.
const { test, expect } = require("./fixtures.js");
const { atRest } = require("./rows-support.js");
const VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=";
async function ready(page, fake, probe) {
  await page.goto(fake.url + "/" + VIEW); await atRest(page, fake, probe);
  await expect.poll(() => page.evaluate(() => typeof window.cubeAgent?.export)).toBe("function");
}
async function add(page, c, r) {
  await page.locator("#ol-tab-cells").click();
  await page.locator(`#ol-table-body tr[data-c="${c}"][data-r="${r}"]`).getByRole("button", { name: "Add to comparison" }).click();
}
test("single-cell copy contains instant text and complete typed JSON", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedAgent = text; } } }));
  await page.locator("#ol-tab-cells").click();
  await page.locator('#ol-table-body tr[data-c="0"][data-r="200"]').getByRole("button", { name: "Copy cell" }).click();
  await expect.poll(() => page.evaluate(() => window.copiedAgent)).toContain("Volume: 300 usdt");
  const packet = await page.evaluate(() => window.explorerAgent.parse(window.copiedAgent));
  expect(packet.schema).toBe("cube-analysis@1");
  expect(packet.comparison.captures[0].metrics.size.value).toBe(150);
  expect(Array.isArray(packet.comparison.captures[0].context.histories)).toBe(true);
  expect(await page.evaluate(() => window.copiedAgent)).toContain("Frozen histories not captured");
  expect(packet.snapshot.sources[0].cells[0].v).toBe(300);
  expect(packet.selection.metrics.volume).toBe(300);
  expect(packet.selection.metrics.trades).toBe(2);
});
test("agent configuration keeps live reads available", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await page.evaluate(() => window.cubeAgent.configure({ mode: "delta" }));
  await expect(page.locator("#ol-analysis-status")).toContainText("Live query");
  fake.revise({ day: "2021-01-01", factor: 2 });
  await expect.poll(() => fake.log().filter((request) => request.path === "/cube/pack" && request.answer === "pack").length, { timeout: 20000 }).toBeGreaterThan(0);
});
test("comparison and labeled drawings reopen from complete links in a fresh context", async ({ page, fakeFor, probe, freshContext }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await add(page, 0, 200); await add(page, 1, 201);
  fake.revise({ day: "2021-01-01", factor: 2 });
  await expect.poll(() => fake.log().filter((request) => request.path === "/cube/pack" && request.answer === "pack").length, { timeout: 20000 }).toBeGreaterThan(0);
  await atRest(page, fake, probe);
  await page.evaluate(() => window.cubeAgent.annotate({ a: { timeMs: 1609459200000, priceCents: 2500000 }, b: { timeMs: 1609459312500, priceCents: 2512500 }, color: "#aa5533", label: "Agent evidence" }));
  const before = await page.evaluate(() => window.cubeAgent.export()), href = await page.evaluate(() => window.cubeAgent.share());
  expect(before.snapshot.generation).toBeGreaterThan(0);
  fake.revise({ day: "2021-01-01", factor: 2 });
  const context = await freshContext(), other = await context.newPage();
  await other.goto(href);
  await expect(other.locator("#ol-analysis-status")).toContainText("Captured evidence");
  const after = await other.evaluate(() => window.cubeAgent.export());
  expect(after.comparison.captures.map((c) => c.metrics["volume.amount"].value)).toEqual(before.comparison.captures.map((c) => c.metrics["volume.amount"].value));
  expect(after.scene.drawings.objects[0].label).toBe("Agent evidence");
  expect(after.scene.view.viewport).toEqual(before.scene.view.viewport);
  expect(after.snapshot.token).toBe(before.snapshot.token);
  expect(after.snapshot.generation).toBe(before.snapshot.generation);
});
test("Markdown evidence links select the exact supporting cell", async ({ page, fakeFor, probe, freshContext }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await add(page, 0, 200); await add(page, 1, 201);
  const href = await page.evaluate(async () => { const d = await window.cubeAgent.export(); return window.cubeAgent.share(d, d.comparison.captures[1].id); });
  const context = await freshContext(), other = await context.newPage(); await other.goto(href);
  await expect(other.locator("#ol-analysis-status")).toContainText("Captured evidence");
  const d = await other.evaluate(() => window.cubeAgent.export());
  expect(d.scene.view.selection).toEqual([1, 2, 201, 202]);
  expect(d.comparison.focus).toBe(d.comparison.captures[1].id);
});
test("rectangle copy exports every measured cell and zero remains distinct from missing", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await page.evaluate(() => window.cubeAgent.configure({ selection: [0, 2, 200, 202] }));
  await atRest(page, fake, probe);
  const d = await page.evaluate(() => window.cubeAgent.export("selection"));
  expect(d.comparison.captures.length).toBeGreaterThan(1);
  expect(d.selection.metrics.volume).toBeGreaterThan(0);
  expect(d.scene.view.selection).toEqual([0, 2, 200, 202]);
});
test("invalid import leaves the canvas, captures and drawings intact", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe); await add(page, 0, 200);
  const result = await page.evaluate(async () => {
    const before = await window.cubeAgent.export(), invalid = structuredClone(before); invalid.comparison.captures[0].metrics.size.value = 999;
    let error; try { await window.cubeAgent.apply(invalid); } catch (e) { error = e.message; }
    const after = await window.cubeAgent.export(); return { error, before: before.comparison, after: after.comparison };
  });
  expect(result.error).toContain("integrity"); expect(result.after).toEqual(result.before);
});
test("explicit refresh reports changed values and retains previous evidence", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe); await add(page, 0, 200);
  await page.evaluate(async () => window.cubeAgent.apply(await window.cubeAgent.export()));
  fake.revise({ day: "2021-01-01", factor: 2 });
  const result = await page.evaluate(async () => { const update = await window.cubeAgent.refresh(); return { update, previous: window.cubeAgent.previous.comparison.captures[0].metrics["volume.amount"].value }; });
  expect(result.previous).toBe(300);
  expect(result.update.changes.some((change) => change.metric === "volume.amount" && change.after.value === 600)).toBe(true);
  await page.locator("#ol-tab-query").click();
  await page.getByRole("button", { name: "Restore previous capture" }).click();
  await expect(page.locator("#ol-analysis-status")).toContainText("Captured evidence");
  expect((await page.evaluate(() => window.cubeAgent.export())).comparison.captures[0].metrics["volume.amount"].value).toBe(300);
});
