"use strict";
const { test, expect } = require("./fixtures.js");

const label = cutoff => `Data through ${new Date(cutoff).toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC")}`;
const modeFits = async page => {
  const identity = await page.locator(".ol-id").boundingBox(), mode = await page.locator("#ol-market").boundingBox();
  expect(mode.x).toBeGreaterThanOrEqual(identity.x);
  expect(mode.x + mode.width).toBeLessThanOrEqual(identity.x + identity.width);
};

test("source timestamp advances with data and remains the source cutoff during replay", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url);
  await expect(page.locator("#ol-data-through")).toHaveText(label(fake.info().cutoff));
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await page.locator("#ol-replay").click();
  await expect(page.locator("#ol-market")).toHaveText("REPLAY");
  await expect(page.locator("#ol-data-through")).toHaveText(label(fake.info().cutoff));
  await page.locator("#ol-replay").click();
  fake.advance({ minutes: 1 });
  await expect(page.locator("#ol-data-through")).toHaveText(label(fake.info().cutoff), { timeout: 15000 });
});

test("recorded page identifies its available data and missing version explicitly", async ({ page, fakeFor }) => {
  const fake = await fakeFor("recorded");
  await page.goto(fake.url);
  const cutoff = await page.locator("#origo-lens-data").evaluate(node => JSON.parse(node.textContent).cutoff);
  await expect(page.locator("#ol-data-through")).toHaveText(label(cutoff));
  await expect(page.locator("#ol-version-unknown")).toBeVisible();
  await expect(page.locator("#ol-version")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 950 });
  await modeFits(page);
});

test("deployed commit shows its date and shares one header row at desktop and phone widths", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"), commit = "1234567890abcdef1234567890abcdef12345678",
    pr = "https://github.com/Vaquum/Market-State-Cube-Explorer/pull/153";
  await page.route(`${fake.url}/`, async route => {
    const response = await route.fetch();
    let html = await response.text();
    html = html.replace('<meta name="explorer-commit" content="">', `<meta name="explorer-commit" content="${commit}">`)
      .replace('<meta name="explorer-committed-at" content="">', '<meta name="explorer-committed-at" content="2026-10-17T08:21:00Z">')
      .replace('<meta name="explorer-pr" content="">', `<meta name="explorer-pr" content="${pr}">`);
    await route.fulfill({ response, body: html });
  });
  await page.goto(fake.url);
  await expect(page.locator("#ol-version")).toHaveText("Cube 1234567 · 17 Oct 2026, 08:21 UTC");
  await expect(page.locator("#ol-version")).toHaveAttribute("href", pr);
  await expect(page.locator("#ol-version")).toHaveAttribute("title", new RegExp(commit));
  await expect(page.locator("#ol-version-unknown")).toBeHidden();
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  for (const width of [1500, 1100, 800, 777, 390]) {
    await page.setViewportSize({ width, height: 950 });
    const windowBounds = await page.locator("#ol-window").boundingBox();
    for (const id of ["ol-data-through", "ol-version", "ol-window"]) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      expect(bounds.x, `${id} left at ${width}`).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, `${id} right at ${width}`).toBeLessThanOrEqual(width);
      expect(Math.abs(bounds.y + bounds.height / 2 - windowBounds.y - windowBounds.height / 2), `${id} same row at ${width}`).toBeLessThanOrEqual(1);
    }
    expect(await page.locator(".ol-bar").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await modeFits(page);
  }
  await page.locator("#ol-sheet-toggle").click();
  await page.locator("#ol-replay").click();
  await page.locator("#ol-sheet-close").click();
  await expect(page.locator("#ol-market")).toHaveText("REPLAY");
  await modeFits(page);
});
