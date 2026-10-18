"use strict";
// #186. Independent oracle: enumerate the dyadic grid using the rendered plot
// and exported fitted camera; compare aspect ratios first, 12 px density second.
const { test, expect } = require("./fixtures.js");
const { EPOCH_MS } = require("../support/profiles.js");
const fixture = require("../fixtures/regressions/timeframe-price-fit/profile.json");
const profile = { ...fixture, name: "window-grid", trades: fixture.trades.map(({ time, price }, i) => ({
  t_ms: Date.parse(i < 2 ? `2026-08-10T${13 + i}:00:00Z` : time) - EPOCH_MS,
  price: price * 100, qty: 100000000, takerBuy: true,
})) };
const presets = ["15m", "30m", "1h", "4h", "12h", "24h", "7d", "30d", "45d", "90d", "180d", "270d", "1y", "ytd", "lastyear", "all", "2026-08-11"];
test.use({ reducedMotion: "reduce" });
async function choose(page, key) {
  await page.locator("#ol-window").click();
  if (key.includes("-")) {
    await page.getByLabel("Since (UTC)", { exact: true }).fill(key);
    await page.getByRole("menuitem", { name: "Apply since date" }).click();
  } else await page.locator(`#ol-window-menu [data-window="${key}"]`).click();
}
async function state(page) {
  return page.evaluate(async () => {
    const { scene } = await window.cubeAgent.export();
    const layout = document.querySelector("#ol-canvas").dataset.layout.split(",").map(Number);
    return { ...scene.view, n: scene.query.tR, m: scene.query.pR, layout };
  });
}
function score(s, n, m) {
  const [a, b, p, q] = s.viewport, [, , width, height] = s.layout;
  const x = 2 ** n * width / (b - a), y = 2 ** m * height / (q - p);
  return [Math.abs(Math.log2(x / y)), Math.abs(Math.log2(Math.sqrt(x * y) / 12))];
}
function assertBest(s, nMin = 0, mMin = 0, diagonal = false) {
  const chosen = score(s, s.n, s.m);
  expect(s.n).toBeGreaterThanOrEqual(nMin); expect(s.m).toBeGreaterThanOrEqual(mMin);
  for (let n = nMin; n <= 20; n++) for (let m = mMin; m <= 9; m++) {
    if (diagonal && m !== Math.max(0, Math.min(9, Math.round(-1.06 + 0.486 * n)))) continue;
    const other = score(s, n, m);
    expect(chosen[0], `shape n${s.n},m${s.m} vs n${n},m${m}`).toBeLessThanOrEqual(other[0] + 1e-8);
    if (Math.abs(chosen[0] - other[0]) < 1e-8) expect(chosen[1]).toBeLessThanOrEqual(other[1] + 1e-8);
  }
}
async function settled(page, probe) {
  await probe.waitForReady();
  await expect.poll(async () => (await state(page)).auto).toBe(true);
  await expect(page.locator("#ol-loading")).toBeHidden();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
for (const width of [1500, 390]) {
  test(`all time-menu defaults use the nearest square in a ${width}px viewport`, async ({ page, fakeFor, probe }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
    const fake = await fakeFor("standard", { cutoff: "2026-09-24T12:00:00Z" });
    await page.goto(`${fake.url}/#w=24h&vis=2`); await settled(page, probe);
    for (const key of presets) {
      await choose(page, key); await settled(page, probe);
      // A tile holds at most 4096 aligned columns; future spare space has no data.
      const s = await state(page), [a, b] = s.viewport;
      expect(s.window, key).toBe(key);
      const cut = (Date.parse("2026-09-24T12:00:00Z") / 1000 - 1609459200) / 56.25;
      let floor = 0;
      while (Math.ceil(Math.min(b, cut) / 2 ** floor) - Math.floor(a / 2 ** floor) > 4096) floor++;
      assertBest(s, floor);
    }
  });
}

test("manual grid locks survive timeframe changes and Back restores the prior view", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(`${fake.url}/#w=24h&r=6,2&vis=2`); await probe.waitForReady();
  const before = await state(page);
  await choose(page, "7d"); await probe.waitForReady();
  expect(await state(page)).toMatchObject({ window: "7d", auto: false, n: 6, m: 2 });
  await page.goBack(); await probe.waitForReady();
  expect(await state(page)).toEqual(before);
});

test("finer destination fitting and layout changes recompute the automatic grid", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor(profile);
  await page.goto(`${fake.url}/#w=24h&vis=2`); await settled(page, probe);
  const gate = fake.on({ route: "/cube/tile" }).gate();
  try {
    await choose(page, "2026-08-11"); await gate.arrived();
    await page.setViewportSize({ width: 800, height: 1000 });
    gate.open(); await settled(page, probe);
    await expect.poll(async () => (await state(page)).viewport.slice(2)).toEqual([198, 204]);
    assertBest(await state(page));
    await page.setViewportSize({ width: 390, height: 844 }); await settled(page, probe);
    assertBest(await state(page));
  } finally { gate.open(); }
});

test("automatic diagonal time defaults remain on the empirical path", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(`${fake.url}/#w=24h&f=diagonal&vis=2`); await settled(page, probe);
  for (const key of ["1h", "7d", "all"]) {
    await choose(page, key); await settled(page, probe);
    const s = await state(page);
    expect(s.m).toBe(Math.max(0, Math.min(9, Math.round(-1.06 + 0.486 * s.n))));
    assertBest(s, key === "all" ? 10 : key === "7d" ? 2 : 0, 0, true);
  }
});

test("recorded history defaults respect the available source resolution", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded");
  await page.goto(`${fake.url}/#w=all&vis=2`); await settled(page, probe);
  assertBest(await state(page), 12, 3);
});
