"use strict";
// Issue #183. Oracle: the fixture's two visible trades and hand-calculated
// existing Fit margins; browser history, exported viewports and shared motion ownership.
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    await page.getByLabel("Since (UTC)", { exact: true }).fill(key);
    await page.getByRole("menuitem", { name: "Apply since date" }).click();
  } else await page.locator(`#ol-window-menu [data-window="${key}"]`).click();
}
async function open(page, fakeFor, probe, mode, follow = "free", prices = "20000~40000", historical = false) {
  // Move the older outliers into the overview column straddling 11 August.
  // Since that day must fetch a finer tile; the recent tier already covers 15m.
  const source = historical ? { ...profile, name: "timeframe-price-fit-historical", trades: profile.trades.map((trade, i) =>
    i < 2 ? { ...trade, t_ms: Date.parse(`2026-08-10T${13 + i}:00:00Z`) - EPOCH_MS } : trade) } : profile;
  const fake = await fakeFor(source, { next: 3 });
  await page.goto(`${fake.url}/#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=${prices}&r=6,0&mode=${mode}&follow=${follow}`);
  await probe.waitForReady();
  await expect.poll(() => page.evaluate(() => typeof window.cubeAgent?.export)).toBe("function");
  return fake;
}
async function fitted(page, mode, key = "24h") {
  await expect.poll(async () => (await camera(page)).window).toBe(key);
  const expected = mode === "volume" && key === "2026-08-11" ? fixture.expected.historicalVolume : fixture.expected[mode];
  await expect.poll(async () => (await camera(page)).price).toEqual(expected);
}

for (const mode of ["volume", "candles"]) {
  for (const follow of ["free", "refit", "coupled", "diagonal"]) {
    test(`timeframe menu fits ${mode} from ${follow} and Back restores both axes`, async ({ page, fakeFor, probe }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, fakeFor, probe, mode, follow, follow === "coupled" ? "25025~25050" : "20000~40000");
      const before = await camera(page);
      await choose(page, "24h");
      await fitted(page, mode);
      const after = await camera(page);
      await page.locator("#ol-canvas").focus();
      await page.keyboard.press("f");
      expect(await camera(page), "the Fit price command has nothing further to change").toEqual(after);
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

  test(`completed timeframe ${mode} fit keeps its padding after live data advances`, async ({ page, fakeFor, probe }) => {
    const fake = await open(page, fakeFor, probe, mode);
    await choose(page, "24h");
    await fitted(page, mode);
    const before = await camera(page);
    fake.advance({ minutes: 2, trades: [] });
    await expect.poll(async () => (await camera(page)).time[1]).toBeGreaterThan(before.time[1]);
    await fitted(page, mode);
  });

  test(`timeframe ${mode} fit completes after a held destination read`, async ({ page, fakeFor, probe }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fake = await open(page, fakeFor, probe, mode, "free", "20000~40000", true);
    const gate = fake.on({ route: mode === "candles" ? "/cube/bars" : "/cube/tile" }).gate();
    try {
      await choose(page, "2026-08-11");
      await gate.arrived();
      expect(gate.held).toBeGreaterThan(0);
      gate.open();
      await fitted(page, mode, "2026-08-11");
      expect(await page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).toBeNull();
    } finally { gate.open(); }
  });

  test(`pending timeframe ${mode} fit yields to a manual price pan`, async ({ page, fakeFor, probe }) => {
    const fake = await open(page, fakeFor, probe, mode, "free", "20000~40000", true);
    const gate = fake.on({ route: mode === "candles" ? "/cube/bars" : "/cube/tile" }).gate();
    try {
      await choose(page, "2026-08-11");
      await gate.arrived();
      await page.locator("#ol-canvas").focus();
      await page.keyboard.press("ArrowUp");
      const manual = await camera(page);
      gate.open();
      await probe.waitForReady();
      expect(await camera(page)).toEqual(manual);
    } finally { gate.open(); }
  });

  test(`pending timeframe ${mode} fit survives a newer live pack`, async ({ page, fakeFor, probe, allowConsole }) => {
    const fake = await open(page, fakeFor, probe, mode, "free", "20000~40000", true);
    const gate = fake.on({ route: mode === "candles" ? "/cube/bars" : "/cube/tile" }).gate();
    try {
      await choose(page, "2026-08-11");
      await gate.arrived();
      allowConsole(/Failed to load resource.*409/);
      fake.holdPacks(1);
      fake.advance({ minutes: 2, trades: [] });
      const token = fake.info().packToken;
      await expect.poll(() => fake.log().some(row => row.path === "/cube/pack" && row.query.since === token)).toBe(true);
      gate.open();
      await fitted(page, mode, "2026-08-11");
    } finally { gate.open(); }
  });
}

test("Since fits the already-loaded finer reference instead of the previous coarse tile", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor(profile);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${fake.url}/#t=2026-09-10T00:00Z~2026-09-24T12:00Z&p=10000~50000&r=3,3&mode=volume&follow=free`);
  await probe.waitForReady();
  await expect.poll(() => page.evaluate(() => typeof window.cubeAgent?.export)).toBe("function");
  expect(fake.log().some(row => row.path === "/cube/tile" && row.query.n === "3" && row.query.m === "3")).toBe(true);
  await choose(page, "2026-09-10");
  // All four trades: 125-USDT cell edges 20000..40125, plus 17 rows on each side.
  await expect.poll(async () => (await camera(page)).price).toEqual([17875, 42250]);
  const before = await camera(page);
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("f");
  expect(await camera(page), "a subsequent Fit price command has nothing further to change").toEqual(before);
});

test("a rapid timeframe replacement owns the final fit", async ({ page, fakeFor, probe }) => {
  const fake = await open(page, fakeFor, probe, "candles");
  const gate = fake.on({ route: "/cube/bars" }).gate();
  try {
    await choose(page, "7d");
    await gate.arrived();
    await choose(page, "15m");
    gate.open();
    await fitted(page, "candles", "15m");
    expect((await camera(page)).price).toEqual(fixture.expected.candles);
  } finally { gate.open(); }
});

test("a deferred timeframe refit continues the coloured subdivision", async ({ page, fakeFor, probe }) => {
  await page.addInitScript(() => {
    let api; window.__subdivisionCameraStarts = 0;
    Object.defineProperty(window, "explorerMotion", { get: () => api, set: motion => {
      api = { ...motion, spring(owner, name, options) {
        if (name === "cells-camera") window.__subdivisionCameraStarts++;
        return motion.spring(owner, name, options);
      } };
    } });
  });
  const fake = await open(page, fakeFor, probe, "volume", "free", "20000~40000", true);
  await expect(page.locator("#ol-legend")).toHaveAttribute("data-state", "ready");
  const gate = fake.on({ route: "/cube/tile" }).gate();
  try {
    await choose(page, "2026-08-11"); await gate.arrived();
    await expect(page.locator("#ol-canvas")).toHaveAttribute("data-subdivision", /.+/);
    const starts = await page.evaluate(() => window.__subdivisionCameraStarts);
    gate.open(); await fitted(page, "volume", "2026-08-11");
    expect(await page.evaluate(() => window.__subdivisionCameraStarts)).toBeGreaterThan(starts);
    await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/);
  } finally { gate.open(); }
});
test("a timeframe choice replaces an active cell spring with its own subdivision", async ({ page, fakeFor, probe }) => {
  await page.addInitScript(() => {
    let api, generation = 0;
    window.__oldCellWrites = 0;
    Object.defineProperty(window, "explorerMotion", { get: () => api, set: motion => {
      api = { ...motion, spring(owner, name, options) {
        if (name !== "cells") return motion.spring(owner, name, options);
        const id = ++generation;
        return motion.spring(owner, name, id === 1 ? { ...options, canComplete: () => false,
          write(value) { window.__oldCellWrites++; options.write(value); } } : options);
      } };
    } });
  });
  await open(page, fakeFor, probe, "volume");
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("]");
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).not.toBeNull();
  await choose(page, "24h");
  const retiredWrites = await page.evaluate(() => window.__oldCellWrites);
  await fitted(page, "volume");
  await expect(page.locator("#ol-canvas")).not.toHaveAttribute("data-subdivision", /.+/);
  expect(await page.evaluate(() => window.__oldCellWrites)).toBe(retiredWrites);
  expect(await page.evaluate(() => window.explorerMotion.motionValue(document.querySelector("#ol-canvas"), "cells"))).toBeNull();
});
