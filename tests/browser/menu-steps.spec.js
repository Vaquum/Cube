"use strict";
const { test, expect } = require("./fixtures.js");

test.use({ reducedMotion: "reduce" });

test("Rows chooses measure then period, completes and preserves both after reload", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h&rc=1");
  await probe.waitForReady();
  const menu = page.locator("#ol-rows-menu");
  await page.locator("#ol-rows").press("ArrowDown");
  await menu.locator('[data-rows="volume"]').click();
  await expect(menu).toHaveAttribute("data-step", "period");
  expect(await menu.locator("[data-rows-step]").evaluateAll(nodes => nodes.map(n => n.dataset.rowsStep))).toEqual(["dataset", "period"]);
  await menu.locator('[data-period="7d"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-rows")).toBeFocused();
  await expect(page.locator("#ol-rows-text")).toHaveText("Volume · 7 days");
  await expect(page.locator("#ol-period")).toHaveCount(0);
  await page.reload();
  await probe.waitForReady();
  await page.locator("#ol-rows").click();
  await expect(menu.locator('[data-rows="volume"]')).toHaveAttribute("aria-checked", "true");
  await menu.locator('[data-rows-step="period"]').click();
  await expect(menu.locator('[data-period="7d"]')).toHaveAttribute("aria-checked", "true");
  await menu.locator('[data-rows-nav="back"]').click();
  await expect(menu).toHaveAttribute("data-step", "dataset");
});

test("Rows right-click completes either step and Off preserves its period", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h&rc=1&rows=volume&period=7d");
  await probe.waitForReady();
  const menu = page.locator("#ol-rows-menu");
  for (const [step, selector] of [["period", '[data-period="30d"]'], ["dataset", '[data-rows="delta"]']]) {
    await page.locator("#ol-rows").click();
    await menu.locator(`[data-rows-step="${step}"]`).click();
    await menu.locator(selector).click({ button: "right" });
    await expect(menu).toBeHidden();
    await expect(page.locator("#ol-rows")).toBeFocused();
  }
  await expect(page.locator("#ol-rows-text")).toHaveText("Delta · 30 days");
  await page.locator("#ol-rows").click();
  await menu.locator('[data-rows="off"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-rows-text")).toHaveText("Off · 30 days");
  await page.locator("#ol-rows").click();
  await expect(menu).toHaveAttribute("data-step", "dataset");
  await expect(menu.locator("[data-rows-step]")).toHaveCount(0);
});

test("Rows custom day validates, keeps native editing keys and supports immediate completion", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h&rows=volume");
  await probe.waitForReady();
  const menu = page.locator("#ol-rows-menu");
  await page.locator("#ol-rows").click();
  await menu.locator('[data-rows-step="period"]').click();
  await menu.getByRole("menuitem", { name: "Since this day", exact: true }).click();
  await expect(menu).toHaveAttribute("data-step", "period");
  const input = menu.getByLabel("Since a UTC day");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("2026-01-01");
  const before = new URL(page.url()).hash;
  await input.press("ArrowRight");
  await expect(input).toBeFocused();
  expect(new URL(page.url()).hash).toBe(before);
  await input.press("Tab");
  // Native date inputs may tab through their component fields before leaving the input.
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Since this day", exact: true }).click({ button: "right" });
  await expect(menu).toBeHidden();
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get("period")).toBe("2026-01-01");
  await page.reload();
  await probe.waitForReady();
  await page.locator("#ol-rows").click();
  await menu.locator('[data-rows-step="period"]').click();
  await expect(menu.locator('[data-period="2026-01-01"]')).toHaveAttribute("aria-checked", "true");
  await menu.getByLabel("Since a UTC day").press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-rows")).toBeFocused();
});

test("Columns separates RSI timeframe, persists it and completes datasets with no further choices", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h");
  await probe.waitForReady();
  const menu = page.locator("#ol-pane-menu");
  await page.locator("#ol-pane").click();
  await menu.locator('[data-pane="rsi"]').click();
  await expect(menu).toHaveAttribute("data-step", "timeframe");
  await menu.locator('[data-timeframe="rsi4h"]').press("Enter");
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-pane")).toBeFocused();
  await expect(page.locator("#ol-pane-text")).toHaveText("RSI 14 · 4h");
  await page.reload();
  await probe.waitForReady();
  await page.locator("#ol-pane").click();
  await expect(menu.locator('[data-pane="rsi"]')).toHaveAttribute("aria-checked", "true");
  await menu.locator('[data-pane-step="timeframe"]').click();
  await expect(menu.locator('[data-timeframe="rsi4h"]')).toHaveAttribute("aria-checked", "true");
  await menu.locator('[data-timeframe="rsi1d"]').click({ button: "right" });
  await expect(menu).toBeHidden();
  await page.locator("#ol-pane").click();
  await menu.locator('[data-pane="volume"]').click();
  await expect(menu).toBeHidden();
  await page.locator("#ol-pane").click();
  await menu.locator('[data-pane="rsi"]').click({ button: "right" });
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-pane-text")).toHaveText("RSI 14 · 1D");
});

test("recorded-only restrictions in Columns and Rows cannot advance or finish either chooser", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded");
  await page.goto(fake.url + "/#w=24h");
  await probe.waitForReady();
  for (const [id, key] of [["pane", "choppiness"], ["rows", "time"], ["background", "time"]]) {
    const menu = page.locator(`#ol-${id}-menu`);
    await page.locator(`#ol-${id}`).click();
    const choice = menu.locator(`[data-${id}="${key}"]`);
    await expect(choice).toHaveAttribute("aria-disabled", "true");
    await choice.press("Enter");
    await expect(menu).toHaveAttribute("data-step", "dataset");
    await choice.click({ button: "right", force: true });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

for (const width of [375, 1500]) {
  test(`Columns and Rows keep choices and navigation within the ${width}px viewport`, async ({ page, fakeFor, probe }) => {
    await page.setViewportSize({ width, height: 812 });
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/#w=24h&rows=volume&pane=rsi4h");
    await probe.waitForReady();
    if (width <= 760) await page.locator("#ol-sheet-toggle").click();
    for (const [id, step] of [["pane", "dataset"], ["pane", "timeframe"], ["rows", "dataset"], ["rows", "period"], ["background", "dataset"], ["background", "period"]]) {
      const menu = page.locator(`#ol-${id}-menu`);
      await page.locator(`#ol-${id}`).click();
      await menu.locator(`[data-${id}-step="${step}"]`).click();
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(812);
      await expect(menu.locator(`[data-${id}-nav="next"]`)).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
    }
  });
}
