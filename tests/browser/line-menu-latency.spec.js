"use strict";
const { test, expect } = require("./fixtures.js");
test.use({ reducedMotion: "reduce" });
const bars = (fake, n) => fake.log().filter((r) => r.path === "/cube/bars" && Number(r.query.n) === n);
const VIEW = "#w=24h&rows=off&lines=&marks=none";

test("browsing averages prepares shared daily bars; toggles reuse them without reads", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("deep", { next: 300 });
  await page.goto(fake.url + "/" + VIEW);
  await probe.waitForReady(); await fake.idle();
  expect(bars(fake, 9)).toHaveLength(0);
  const gate = fake.on({ route: /^\/cube\/bars/, times: 1 }).gate();
  await page.locator("#ol-lines").click();
  await page.locator("#ol-family-average-head").click();
  await expect.poll(() => bars(fake, 9).length).toBe(1);
  await expect(page.locator('[data-line="ema21"]')).not.toBeChecked();
  await page.locator('[data-line="ema21"]').check();
  await expect(page.locator('[data-ref-key="ema21"] .ol-line-reason')).toHaveText("Loading…");
  gate.open(); await fake.idle();
  await expect(page.locator('[data-line-value="ema21"]')).toHaveText(/[\d,]+/);
  const before = bars(fake, 9).length;
  for (const key of ["sma50", "sma100", "sma200", "bmsb"]) {
    await page.locator(`[data-line="${key}"]`).check();
    // Selection must synchronously render a cached value, before another read can finish.
    expect(await page.locator(`[data-line-value="${key}"]`).textContent()).toMatch(/[\d,]+/);
  }
  expect(bars(fake, 9)).toHaveLength(before);
});

for (const [key, n, replay = ""] of [["ema1h", 6], ["ema4h", 8], ["ema1h", 6, "&replay=1&at=2026-09-23T12:30Z"]]) {
  test(`${key}${replay}: cold recent view skips unrelated history and retains full-history EMA values`, async ({ page, fakeFor, probe, baselinePage }) => {
    const hash = VIEW.replace("lines=", `lines=${key}`) + replay;
    const fake = await fakeFor("deep", { next: 300 });
    await page.goto(fake.url + "/" + hash);
    await probe.waitForReady(); await fake.idle();
    const reads = bars(fake, n);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(Math.min(...reads.map((r) => Number(r.query.b0)))).toBeGreaterThan(0);
    await page.locator("#ol-lines").click();
    const actual = await page.locator(`[data-line-value="${key}"]`).textContent();
    expect(actual).toMatch(/\d/);
    // The original page computes from the history's first bar, independently of the bounded implementation.
    const original = await baselinePage({ mode: "live", profile: "deep", url: "/" + hash });
    await original.fake.idle({ timeoutMs: 30000 });
    await original.page.locator("#ol-lines").click();
    await expect(original.page.locator(`[data-line-value="${key}"]`)).toHaveText(actual);
  });
}


test("sparse hourly inputs extend warm-up through all available history", async ({ page, fakeFor, probe }) => {
  const day = 86400000, days = 2100;
  // One traded hourly bar per day: calendar chunks cannot stand in for enough closes.
  const trades = Array.from({ length: days }, (_, d) => ({ t_ms: d * day + 60000,
    price: (10000 + d) * 100, qty: 100000000, takerBuy: true }));
  const fake = await fakeFor({ trades, cutoffIso: new Date(Date.UTC(2021, 0, 1) + days * day).toISOString() }, { next: 300 });
  await page.goto(fake.url + "/" + VIEW.replace("lines=", "lines=ema1h"));
  await probe.waitForReady(); await fake.idle();
  expect(Math.min(...bars(fake, 6).map((r) => Number(r.query.b0)))).toBe(0);
  await page.locator("#ol-lines").click();
  // A unit ramp seeded by its first N closes has EMA = last − (N−1)/2 exactly.
  await expect(page.locator('[data-line-value="ema1h"]')).toHaveText("12,075 · 12,000");
});


for (const key of ["fib:2026-09-01", "vwap:2026-09-01"]) {
  test(`${key}: opening a menu during a cold anchor read preserves its own data state`, async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("deep", { next: 300 });
    const gate = fake.on({ route: /^\/cube\/bars/, times: 1 }).gate();
    try {
      await page.goto(fake.url + "/" + VIEW.replace("lines=", `lines=${key}`));
      await gate.arrived();
      await page.locator("#ol-lines").click();
      await expect(page.locator(`[data-ref-key="${key}"]`)).toBeVisible();
      await expect(page.locator("#ol-lines-pop")).toBeVisible();
    } finally { gate.open(); }
    await probe.waitForReady(); await fake.idle();
  });
}
