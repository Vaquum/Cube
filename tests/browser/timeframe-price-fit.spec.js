"use strict";
// Issue #183. Oracle: the fixture's two visible trades and hand-calculated
// 5% margins; browser history, exported viewports and shared motion ownership.
const { test, expect } = require("./fixtures.js");
const { EPOCH_MS } = require("../support/profiles.js");
const fixture = require("../fixtures/regressions/timeframe-price-fit/profile.json");
const profile = { ...fixture, trades: fixture.trades.map(({ time, price }) => ({
  t_ms: Date.parse(time) - EPOCH_MS, price: price * 100, qty: 100000000, takerBuy: true,
})) };
const camera = page => page.evaluate(async () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const { viewport } = (await window.cubeAgent.export()).scene.view;
  return { window: params.get("w"), time: viewport.slice(0, 2), price: viewport.slice(2).map(value => value * 125) };
});
async function choose(page, key) {
  await page.locator("#ol-window").click();
  await page.locator(`#ol-window-menu [data-window="${key}"]`).click();
}
async function open(page, fakeFor, probe, mode, follow = "free", prices = "20000~40000") {
  const fake = await fakeFor(profile);
  await page.goto(`${fake.url}/#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=${prices}&r=6,0&mode=${mode}&follow=${follow}`);
  await probe.waitForReady();
  await expect.poll(() => page.evaluate(() => typeof window.cubeAgent?.export)).toBe("function");
  return fake;
}
async function fitted(page, mode, key = "24h") {
  await expect.poll(async () => (await camera(page)).window).toBe(key);
  await expect.poll(async () => (await camera(page)).price).toEqual(fixture.expected[mode]);
}

for (const mode of ["volume", "candles"]) {
  for (const follow of ["free", "refit", "coupled", "diagonal"]) {
    test(`timeframe menu fits ${mode} from ${follow} and Back restores both axes`, async ({ page, fakeFor, probe }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, fakeFor, probe, mode, follow, follow === "coupled" ? "25025~25050" : "20000~40000");
      const before = await camera(page);
      await choose(page, "24h");
      await fitted(page, mode);
      await probe.waitForReady();
      const after = await camera(page), box = await page.locator("#ol-canvas").boundingBox();
      await page.mouse.dblclick(box.x + 20, box.y + 100);
      expect(await camera(page), "the price-axis fit has nothing further to change").toEqual(after);
      await page.goBack();
      await probe.waitForReady();
      expect(await camera(page)).toEqual(before);
    });
  }

  test(`Since fits ${mode} after its destination reads`, async ({ page, fakeFor, probe }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, fakeFor, probe, mode);
    await page.locator("#ol-window").click();
    await page.getByLabel("Since (UTC)", { exact: true }).fill("2026-09-24");
    await page.getByRole("menuitem", { name: "Apply since date" }).click();
    await fitted(page, mode, "2026-09-24");
  });

  test(`timeframe ${mode} fit completes after a held destination read`, async ({ page, fakeFor, probe }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fake = await open(page, fakeFor, probe, mode);
    const gate = fake.on({ route: mode === "candles" ? "/cube/bars" : "/cube/tile" }).gate();
    try {
      await choose(page, "15m");
      await gate.arrived();
      expect(gate.held).toBeGreaterThan(0);
      gate.open();
      await fitted(page, mode, "15m");
      await probe.waitForReady();
      expect(await page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).toBeNull();
    } finally { gate.open(); }
  });

  test(`pending timeframe ${mode} fit yields to a manual price pan`, async ({ page, fakeFor, probe }) => {
    const fake = await open(page, fakeFor, probe, mode);
    const gate = fake.on({ route: mode === "candles" ? "/cube/bars" : "/cube/tile" }).gate();
    try {
      await choose(page, "15m");
      await gate.arrived();
      await page.locator("#ol-canvas").focus();
      await page.keyboard.press("ArrowUp");
      const manual = await camera(page);
      gate.open();
      await probe.waitForReady();
      expect(await camera(page)).toEqual(manual);
    } finally { gate.open(); }
  });
}

test("a rapid timeframe replacement owns the final fit", async ({ page, fakeFor, probe }) => {
  const fake = await open(page, fakeFor, probe, "candles");
  const gate = fake.on({ route: "/cube/bars" }).gate();
  try {
    await choose(page, "7d");
    await gate.arrived();
    await choose(page, "15m");
    gate.open();
    await fitted(page, "candles", "15m");
    await probe.waitForReady();
    expect((await camera(page)).price).toEqual(fixture.expected.candles);
  } finally { gate.open(); }
});

test("a timeframe choice releases an active cell spring before its destination paints", async ({ page, fakeFor, probe }) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, "explorerMotion", { get: () => api, set: motion => {
      api = { ...motion, spring(owner, name, options) {
        return motion.spring(owner, name, name === "cells" ? { ...options, canComplete: () => false } : options);
      } };
    } });
  });
  await open(page, fakeFor, probe, "volume");
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("]");
  expect(await page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).not.toBeNull();
  await choose(page, "24h");
  expect(await page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).toBeNull();
  await fitted(page, "volume");
  await probe.waitForReady();
  expect(await page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).toBeNull();
});
