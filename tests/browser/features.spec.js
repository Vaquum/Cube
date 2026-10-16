"use strict";
// Find features in the page, against Mill's recorded answers on real 1-hour bars (tests/fixtures/features). The page is served
// the way tools/features_dev.py serves it, its document declaring Mill with <meta name="explorer-mill">, and /mill/ is answered
// in the browser, so the fake cube never sees a request it does not serve.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./fixtures.js");
const events = require("../fixtures/features/events.json");
const description = require("../fixtures/features/description.json");

const VIEW = "#t=2025-03-01T00:00Z~2025-03-08T00:00Z&p=76000~98000";
const CONFIG = { data_window: { start: "2024-01-01", end: "2026-05-15" }, views: ["ochlv"] };
const layout = async (page) => (await page.locator("#ol-canvas").getAttribute("data-layout")).split(",").map(Number);

async function servedWithMill(page, fake, answer) {
  const asked = [];
  await page.route(`${fake.url}/`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("<head>", '<head>\n    <meta name="explorer-mill" content="/mill/">');
    await route.fulfill({ response, body });
  });
  await page.route("**/mill/**", async (route) => {
    const request = route.request(), name = new URL(request.url()).pathname;
    asked.push({ name: `${request.method()} ${name}`, body: request.postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(name === "/mill/app-config" ? CONFIG : answer) });
  });
  return asked;
}
// A selection across the middle of the plot, from 3 Mar to about 3 Mar 21:00 of the week in view.
async function mark(page) {
  const [x, y, w, h] = await layout(page), box = await page.locator("#ol-canvas").boundingBox();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("s");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(box.x + x + w * (2 / 7), box.y + y + h * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w * (2.9 / 7), box.y + y + h * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.locator("#ol-features-add").click();
  await expect(page.locator("#ol-features-windows li")).toHaveCount(1);
}

test("the tab is offered only where the page is served with Mill, and opening it asks Mill nothing", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini");
  await page.goto(`${fake.url}/${VIEW}`);
  await expect(page.locator("#ol-tab-rallies")).toBeVisible();
  await expect(page.locator("#ol-tab-features")).toHaveCount(0);
  const asked = await servedWithMill(page, fake, events);
  // The same address again is a same-document navigation: a reload fetches the document, now declaring Mill.
  await page.reload();
  await page.locator("#ol-tab-features").click();
  await expect(page.locator("#ol-panel-features")).toBeVisible();
  await expect(page.locator("#ol-features-status")).toHaveText("Select a rectangle on the chart, then Add selection. Mill is asked when you press Find features.");
  await expect(page.locator("#ol-features-find")).toBeDisabled();
  expect(asked).toEqual([]);
});

test("a marked window is found, its leader previewed with its rule's hits, and the rule copied as Limen YAML", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini");
  const asked = await servedWithMill(page, fake, events);
  await page.goto(`${fake.url}/${VIEW}`);
  await page.locator("#ol-tab-features").click();
  await mark(page);
  // The Marked lane is the strip's one lane until a leader is previewed.
  await expect.poll(async () => (await layout(page))[10]).toBe(14);
  await page.locator("#ol-features-mode").selectOption("lead");
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-results")).toBeVisible();
  expect(asked.map((a) => a.name)).toEqual(["GET /mill/app-config", "POST /mill/discover"]);
  const body = asked[1].body;
  expect(body.mode).toBe("lead");
  expect(body.lead_bars).toBe(4);
  expect(body.context).toEqual({ start: "2024-01-01T00:00:00Z", end: "2026-05-16T00:00:00Z" });
  expect(body.windows).toHaveLength(1);
  await expect(page.locator("#ol-features-rows tr")).toHaveCount(events.candidates.length);
  await expect(page.locator("#ol-features-rows tr").first()).toContainText("garman_klass_volatility");
  await expect(page.locator("#ol-features-rows tr").first()).toContainText("beyond chance · p 0.0095");
  await expect(page.locator("#ol-features-chance")).toContainText("Across 8593 shifted labelings, a column is beyond chance when it separates by more than 0.171");
  // The first leader previews at once: the Rule hits lane joins the strip.
  await expect(page.locator("#ol-features-status")).toContainText("Previewing garman_klass_volatility in the Columns pane");
  await expect.poll(async () => (await layout(page))[10]).toBe(28);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedManifest = text; } } }));
  await page.locator("#ol-features-copy").click();
  await expect(page.locator("#ol-features-status")).toContainText("Copied garman_klass_volatility's rule as a Limen manifest");
  const golden = fs.readFileSync(path.join(__dirname, "../fixtures/features/manifest.yaml"), "utf8");
  expect(await page.evaluate(() => window.copiedManifest)).toBe(golden);
  // Ending the preview gives the pane back and takes the Rule hits lane away; the Marked lane stays.
  await page.locator("#ol-features-unpreview").click();
  await expect.poll(async () => (await layout(page))[10]).toBe(14);
  await expect(page.locator("#ol-features-status")).toHaveText("Select a leader to preview it.");
});

test("one window is read as a description, with nothing beyond chance", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini");
  await servedWithMill(page, fake, description);
  await page.goto(`${fake.url}/${VIEW}`);
  await page.locator("#ol-tab-features").click();
  await mark(page);
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-chance")).toContainText("One window describes, it does not test");
  for (const row of await page.locator("#ol-features-rows tr").all()) await expect(row).toContainText("within chance");
  await expect(page.locator("#ol-features-rows tr").first()).toContainText("withheld");
});
