"use strict";
// Oracles: hand-authored time fractions and the recorded Mill answer (candidate values only).
// This checks chart integration and request ownership; live Mill arithmetic is verified separately.
const {test, expect} = require("./fixtures.js");
const {addRecorder, forPage} = require("./pane-canvas.js");
const answer = require("../fixtures/features/events.json");
const START = Date.parse("2025-03-06T00:00:00Z"), SPAN = 2 * 86400000;
const VIEW = "#vis=2&t=2025-03-06T00:00Z~2025-03-08T00:00Z&p=23000~27000&r=4,0";
const cases = [
  ["volume", "volume", "15m_time_bars"], ["delta", "delta", "30m_time_bars"],
  ["trades", "trades", "1h_time_bars"], ["size", "size", "2h_time_bars"],
  ["candles", "volume", "4h_time_bars"],
];
async function serve(page, fake, reply = answer) {
  const requests = [];
  await page.route(`${fake.url}/`, async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: (await response.text()).replace("<head>", '<head><meta name="explorer-mill" content="/mill/">')});
  });
  await page.route("**/mill/**", async route => {
    if (route.request().method() === "POST") {
      requests.push(route.request().postDataJSON());
      await route.fulfill({json: reply});
    } else await route.fulfill({json: {data_window: {start: "2024-01-01", end: "2025-03-08"}, views: ["ochlv"]}});
  });
  return requests;
}
async function mark(page, from, to, expectedCount) {
  const canvas = page.locator("#ol-canvas");
  await canvas.focus();
  if (await page.locator('[data-tool="select"]').getAttribute("aria-pressed") !== "true") await page.keyboard.press("s");
  const [x, y, w, h] = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + x + w * from, box.y + y + h * .35);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w * to, box.y + y + h * .65, {steps: 4});
  await page.mouse.up();
  await page.locator("#ol-features-add").click();
  await expect(page.locator("#ol-features-windows li")).toHaveCount(expectedCount);
}
for (const [mode, pane, bar] of cases) for (const count of [1, 3, 8]) {
  test(`${mode}/${pane}: ${count} mixed-width windows on ${bar}`, async ({page, fakeFor, probe}, info) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    await addRecorder(page);
    const fake = await fakeFor("mini", {cutoff: "2025-03-08T00:00:00Z"});
    const requests = await serve(page, fake);
    await page.goto(`${fake.url}/${VIEW}&mode=${mode}&pane=${pane}`);
    await probe.waitForReady();
    if (mode === "candles") await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state", "ready");
    await page.locator("#ol-tab-features").click();
    const spans = [];
    for (let i = 0; i < count; i++) {
      const from = .04 + i * .11, to = from + [.012, .04, .085][i % 3];
      spans.push([from, to]);
      await mark(page, from, to, i + 1);
    }
    await page.locator("#ol-features-bar").selectOption(bar);
    await page.locator("#ol-features-against").selectOption("view");
    if (count === 3) {
      await page.locator("#ol-features-mode").selectOption("lead");
      await page.locator("#ol-features-lead").fill("1");
    }
    await page.locator("#ol-features-find").click();
    await expect(page.locator("#ol-features-results")).toBeVisible();
    expect(requests).toHaveLength(1);
    const sent = requests[0];
    expect(sent.bar).toBe(bar);
    expect(sent.mode).toBe(count === 3 ? "lead" : "inside");
    expect(sent.lead_bars).toBe(count === 3 ? 1 : undefined);
    expect(sent.context).toEqual({start: "2025-03-06T00:00:00Z", end: "2025-03-08T00:00:00Z"});
    expect(sent.windows).toHaveLength(count);
    sent.windows.forEach((window, i) => {
      // Pointer pixels and base-cell snapping can shift either boundary by under two base cells.
      expect(Math.abs(Date.parse(window.start) - (START + SPAN * spans[i][0]))).toBeLessThan(112500);
      expect(Math.abs(Date.parse(window.end) - (START + SPAN * spans[i][1]))).toBeLessThan(112500);
    });
    await probe.waitForReady();
    const frame = await forPage(page).last();
    // Axis settings live in the separately opened System reference; test the pane's own hidden state.
    await expect(page.locator("#ol-axis-chip")).toHaveJSProperty("hidden", true);
    expect(frame.texts.some(t => t.text.startsWith("Preview · garman_klass_volatility"))).toBe(true);
    expect(frame.strokes.some(s => s.width === 1.5 && s.path.length > 2 && s.clip)).toBe(true);
    if (count === 3) await page.screenshot({path: info.outputPath(`${mode}-mill-preview.png`)});
    await page.locator("#ol-features-unpreview").click();
    await probe.waitForReady();
    expect((await forPage(page).last()).texts.some(t => t.text.startsWith("Preview ·"))).toBe(false);
    await expect(page.locator("#ol-axis-chip")).toHaveJSProperty("hidden", false);
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("pane")).toBe(pane);
  });
}

test("editing windows and settings clears the displayed answer and searches the revised inputs", async ({page, fakeFor}) => {
  const fake = await fakeFor("mini", {cutoff: "2025-03-08T00:00:00Z"});
  const requests = await serve(page, fake);
  await page.goto(`${fake.url}/${VIEW}`);
  await page.locator("#ol-tab-features").click();
  await mark(page, .1, .2, 1);
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-results")).toBeVisible();
  await mark(page, .4, .6, 2);
  await expect(page.locator("#ol-features-results")).toBeHidden();
  await page.locator("#ol-features-pool").selectOption("view:ochlv");
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-results")).toBeVisible();
  expect(requests[1].windows).toHaveLength(2);
  expect(requests[1].pool).toEqual({kind: "view", name: "ochlv"});
  await page.locator("#ol-features-clear-windows").click();
  await expect(page.locator("#ol-features-results")).toBeHidden();
  await expect(page.locator("#ol-features-find")).toBeDisabled();
});

test("a duplicate window stays single, and overlapping windows retain their authored bounds", async ({page, fakeFor}) => {
  const fake = await fakeFor("mini", {cutoff: "2025-03-08T00:00:00Z"});
  const requests = await serve(page, fake);
  await page.goto(`${fake.url}/${VIEW}`);
  await page.locator("#ol-tab-features").click();
  await mark(page, .1, .3, 1);
  await page.locator("#ol-features-add").click();
  await expect(page.locator("#ol-features-windows li")).toHaveCount(1);
  await expect(page.locator("#ol-features-status")).toHaveText("That window is already marked.");
  await mark(page, .2, .4, 2);
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-results")).toBeVisible();
  expect(requests[0].windows).toHaveLength(2);
  expect(Date.parse(requests[0].windows[0].end)).toBeGreaterThan(Date.parse(requests[0].windows[1].start));
});

test("stopping a pending search keeps no late answer and allows a fresh search", async ({page, fakeFor}) => {
  const fake = await fakeFor("mini", {cutoff: "2025-03-08T00:00:00Z"});
  await serve(page, fake);
  let release, started;
  const pending = new Promise(resolve => { started = resolve; });
  await page.route("**/mill/discover", async route => {
    started();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({json: answer});
  });
  await page.goto(`${fake.url}/${VIEW}`);
  await page.locator("#ol-tab-features").click();
  await mark(page, .1, .2, 1);
  await page.locator("#ol-features-find").click();
  await pending;
  await page.locator("#ol-features-cancel").click();
  await expect(page.locator("#ol-features-status")).toContainText("Stopped waiting");
  await expect(page.locator("#ol-features-results")).toBeHidden();
  release();
  await page.unroute("**/mill/discover");
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-results")).toBeVisible();
});

test("rewinding before the searched cutoff discards the answer and its preview", async ({page, fakeFor, probe}) => {
  const fake = await fakeFor("mini", {cutoff: "2025-03-08T00:00:00Z"});
  await serve(page, fake);
  await page.goto(`${fake.url}/${VIEW}`);
  await page.locator("#ol-tab-features").click();
  await mark(page, .1, .2, 1);
  await page.locator("#ol-features-find").click();
  await expect(page.locator("#ol-features-results")).toBeVisible();
  await page.evaluate(() => { location.hash += "&replay=1&at=2025-03-07T00:00Z"; });
  await probe.waitForReady();
  await expect(page.locator("#ol-features-results")).toBeHidden();
  await expect(page.locator("#ol-features-status")).toContainText("its answer used later bars");
});
