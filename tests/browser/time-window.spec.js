"use strict";
// Oracles: literal UTC dates and day arithmetic (24 hours), read against the
// public Query bounds. The fake cutoff is pinned; no expected range uses app code.
const { test, expect } = require("./fixtures.js");
const cutoff = "2026-09-24T12:00:00Z", dayMs = 86400000;
const query = async page => JSON.parse(await page.locator("#ol-query-text").inputValue());
const windowKey = page => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("w"));
test.use({ timezoneId: "America/Los_Angeles", reducedMotion: "reduce" });

test("long day presets select exact rolling periods and keep existing shortcuts", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini", { cutoff });
  await page.goto(`${fake.url}/#w=24h`);
  await probe.waitForReady();
  for (const days of [45, 90, 180, 270]) {
    await page.locator("#ol-window").click();
    await page.locator(`#ol-window-menu [data-window="${days}d"]`).click();
    await probe.waitForReady();
    expect(await windowKey(page)).toBe(`${days}d`);
    expect(Date.parse((await query(page)).t1)).toBe(Date.parse(cutoff) - days * dayMs);
    expect(Date.parse((await query(page)).t2)).toBe(Date.parse(cutoff));
    await page.reload();
    await probe.waitForReady();
    await expect(page.locator("#ol-window-text")).toHaveText(`${days}d`);
  }
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("8");
  await expect.poll(() => windowKey(page)).toBe("30d");
  await page.keyboard.press("9");
  await expect.poll(() => windowKey(page)).toBe("1y");
});

test("Since validates dates, starts at UTC midnight, reloads and follows new data", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini", { cutoff });
  await page.goto(`${fake.url}/#w=24h`);
  await probe.waitForReady();
  await page.locator("#ol-window").click();
  const input = page.getByLabel("Since (UTC)", { exact: true });
  await expect(input).toHaveAttribute("min", "2021-01-01");
  await expect(input).toHaveAttribute("max", "2026-09-24");
  for (const value of ["", "2020-12-31", "2026-09-25"]) {
    await input.fill(value);
    await page.getByRole("menuitem", { name: "Apply since date" }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(await windowKey(page)).toBe("24h");
  }
  await input.fill("2026-09-23");
  await input.press("Enter");
  await probe.waitForReady();
  expect(await windowKey(page)).toBe("2026-09-23");
  await expect(page.locator("#ol-window-text")).toHaveText("Since 2026-09-23");
  expect(Date.parse((await query(page)).t1)).toBe(Date.parse("2026-09-23T00:00:00Z"));
  await page.reload();
  await probe.waitForReady();
  await page.locator("#ol-window").click();
  await expect(input).toHaveValue("2026-09-23");
  await input.press("Escape");
  await expect(page.locator("#ol-window-menu")).toBeHidden();
  await expect(page.locator("#ol-window")).toBeFocused();
  fake.advance({ minutes: 1440, trades: [] });
  await expect.poll(async () => Date.parse((await query(page)).t2), { timeout: 15000 }).toBe(Date.parse("2026-09-25T12:00:00Z"));
  expect(Date.parse((await query(page)).t1)).toBe(Date.parse("2026-09-23T00:00:00Z"));
  expect(await windowKey(page)).toBe("2026-09-23");
});

test("phone menu scrolls to Since and its date field keeps native keyboard navigation", async ({ page, fakeFor, probe }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fake = await fakeFor("mini", { cutoff });
  await page.goto(`${fake.url}/#w=24h`);
  await probe.waitForReady();
  await page.locator("#ol-window").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("menuitem", { name: "Apply since date" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const input = page.getByLabel("Since (UTC)", { exact: true });
  await expect(input).toBeFocused();
  await input.fill("2021-01-01");
  const before = await windowKey(page);
  await input.press("ArrowRight");
  expect(await windowKey(page)).toBe(before);
  await input.fill("2021-01-01");
  await page.screenshot({ path: testInfo.outputPath("phone-since.png") });
  const box = await page.locator("#ol-window-menu").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.getByRole("menuitem", { name: "Apply since date" }).click();
  await probe.waitForReady();
  expect(Date.parse((await query(page)).t1)).toBe(Date.parse("2021-01-01T00:00:00Z"));
  await page.screenshot({ path: testInfo.outputPath("phone-selected.png") });
});

test("a midnight cutoff excludes its empty UTC day from Since choices", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini", { cutoff: "2026-09-24T00:00:00Z" });
  await page.goto(`${fake.url}/#w=24h`);
  await probe.waitForReady();
  await page.locator("#ol-window").click();
  await expect(page.getByLabel("Since (UTC)", { exact: true })).toHaveAttribute("max", "2026-09-23");
});
