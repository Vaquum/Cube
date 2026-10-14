"use strict";
const { test, expect } = require("./fixtures.js");
const { EPOCH_MS } = require("../support/profiles.js");

const camera = (page) => page.evaluate(() => {
  const p = new URLSearchParams(location.hash.slice(1));
  return { time: p.get("t")?.split("~").map(Date.parse), price: p.get("p")?.split("~").map(Number) };
});
const start = Date.parse("2026-09-23T12:00Z"), span = 12 * 3600000;

for (const [mode, expected] of [["volume", [24968.75, 25656.25]], ["candles", [25037.5, 25587.5]]]) {
  for (const follow of ["free", "refit", "coupled", "diagonal"]) {
    test(`Shift+horizontal arrows step a full window and fit ${mode} in ${follow}`, async ({ page, fakeFor, probe }) => {
      const fake = await fakeFor("uniform");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fake.url}/#t=2026-09-23T12:00Z~2026-09-24T00:00Z&p=20000~30000&r=4,0&mode=${mode}&follow=${follow}`);
      await probe.waitForReady();
      const before = await camera(page);
      await page.locator("#ol-canvas").focus();
      await page.keyboard.press("Shift+ArrowRight");
      await expect.poll(() => camera(page)).toEqual({ time: [start + span, start + 2 * span], price: expected });
      await probe.waitForReady();
      const box = await page.locator("#ol-canvas").boundingBox();
      await page.mouse.dblclick(box.x + 20, box.y + 100);
      expect(await camera(page), "the axis double-click has nothing further to fit").toEqual({ time: [start + span, start + 2 * span], price: expected });
      await page.goBack();
      await probe.waitForReady();
      expect(await camera(page), "one Back restores both axes").toEqual(before);
      await page.locator("#ol-canvas").focus();
      await page.keyboard.press("Shift+ArrowLeft");
      await expect.poll(() => camera(page)).toEqual({ time: [start - span, start], price: expected });
    });
  }
}

// Three adjacent seven-day ranges have different prices. The next range is
// fetched after navigation; the fit must use those prices, not the old range.
const week = 7 * 86400000, first = Date.parse("2026-09-03T00:00Z");
const weeklyProfile = {
  name: "window-step-weeks", cutoffIso: "2026-09-24T12:02Z",
  trades: [24000, 25000, 26000].flatMap((price, i) => [0, 100].map((offset, j) => ({
    t_ms: first - EPOCH_MS + i * week + (j + 1) * 86400000,
    price: (price + offset) * 100, qty: 100000000, takerBuy: true,
  }))),
};

for (const mode of ["volume", "candles"]) {
  test(`seven-day ${mode} steps fit the fetched destination and repeat`, async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor(weeklyProfile);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fake.url}/#t=2026-09-10T00:00Z~2026-09-17T00:00Z&p=20000~30000&r=9,0&mode=${mode}&follow=free`);
    await probe.waitForReady();
    const before = await camera(page);
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await probe.waitForReady();
    await expect.poll(async () => (await camera(page)).time).toEqual([first, first + week]);
    if (mode === "candles") await expect.poll(async () => (await camera(page)).price).toEqual([23995, 24105]);
    const fitted = await camera(page), box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.dblclick(box.x + 20, box.y + 100);
    expect(await camera(page)).toEqual(fitted);
    await page.goBack();
    await probe.waitForReady();
    expect(await camera(page)).toEqual(before);
    await page.locator("#ol-canvas").focus();
    await page.keyboard.down("Shift");
    await page.keyboard.down("ArrowRight");
    await probe.waitForReady();
    if (mode === "candles") await expect.poll(async () => (await camera(page)).price).toEqual([25995, 26105]);
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("Shift");
    await probe.waitForReady();
    await expect.poll(async () => (await camera(page)).time).toEqual([first + 3 * week, first + 4 * week]);
  });
}

test("plain arrows retain the 15% pan; text fields and browser modifiers keep Shift+arrows", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("uniform");
  await page.goto(`${fake.url}/#t=2026-09-23T12:00Z~2026-09-24T00:00Z&p=20000~30000&r=4,0&follow=free`);
  await probe.waitForReady();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => camera(page)).toEqual({ time: [start - span * 0.15, start + span * 0.85], price: [20000, 30000] });
  const before = await camera(page);
  await page.keyboard.press("Shift+S");
  await page.locator("#ol-view-name").fill("test");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await camera(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("Control+Shift+ArrowRight");
  await page.keyboard.press("Meta+Shift+ArrowLeft");
  expect(await camera(page)).toEqual(before);
});

test("a delayed candle fit cannot overwrite a later manual price pan", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("uniform");
  await page.goto(`${fake.url}/#t=2026-09-23T12:00Z~2026-09-24T00:00Z&p=20000~30000&r=4,0&mode=candles&follow=free`);
  await probe.waitForReady();
  const gate = fake.on({ route: "/cube/bars" }).gate();
  try {
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await gate.arrived();
    await page.keyboard.press("ArrowUp");
    const manual = await camera(page);
    gate.open();
    await probe.waitForReady();
    expect(await camera(page)).toEqual(manual);
  } finally { gate.open(); }
});

// The overview's 64-hour columns include wide prices outside the destination;
// its exact 12-hour tile contains only 25,000 and 25,150 USDT.
const historicalProfile = {
  name: "window-step-refinement", cutoffIso: "2026-09-24T12:02Z",
  trades: [
    ["2026-08-10T13:00Z", 10000], ["2026-08-10T14:00Z", 40000],
    ["2026-08-11T01:00Z", 25000], ["2026-08-11T02:00Z", 25150],
    ["2026-08-11T13:00Z", 10000], ["2026-08-11T14:00Z", 40000],
  ].map(([time, price]) => ({ t_ms: Date.parse(time) - EPOCH_MS, price: price * 100, qty: 100000000, takerBuy: true })),
};
const historicalTime = "2026-08-10T12:00Z~2026-08-11T00:00Z";
const destination = [Date.parse("2026-08-11T00:00Z"), Date.parse("2026-08-11T12:00Z")];

for (const mode of ["volume", "candles"]) {
  for (const refresh of ["delta", "pack"]) {
    test(`pending ${mode} window fit survives a live ${refresh} refresh`, async ({ page, fakeFor, probe, allowConsole }) => {
      const fake = await fakeFor(historicalProfile, { next: 3 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fake.url}/#t=${historicalTime}&p=10000~40000&r=4,0&mode=${mode}&follow=free`);
      await probe.waitForReady();
      const before = await camera(page), oldToken = fake.info().packToken;
      const gate = fake.on({ route: mode === "candles" ? "/cube/bars" : "/cube/tile" }).gate();
      try {
        await page.locator("#ol-canvas").focus();
        await page.keyboard.press("Shift+ArrowRight");
        await gate.arrived();
        fake.clearLog();
        if (refresh === "pack") {
          allowConsole(/Failed to load resource.*409/);
          fake.holdPacks(1);
          fake.advance({ minutes: 2, trades: [] });
        } else fake.rebuild();
        const newToken = fake.info().packToken;
        expect(newToken).not.toBe(oldToken);
        await expect.poll(() => fake.log().some(r => r.path === "/cube/pack" && r.answer === refresh), { timeout: 10000 }).toBe(true);
        // A subsequent poll with the new token proves the page applied it
        // before the held destination read is released.
        await expect.poll(() => fake.log().some(r => r.path === "/cube/pack" && r.query.since === newToken), { timeout: 10000 }).toBe(true);
        gate.open();
        const expected = mode === "candles" ? [24992.5, 25157.5] : [24987.5, 25262.5];
        await expect.poll(() => camera(page), { timeout: 15000 }).toEqual({ time: destination, price: expected });
        await probe.waitForReady();
        const box = await page.locator("#ol-canvas").boundingBox();
        await page.mouse.dblclick(box.x + 20, box.y + 100);
        expect(await camera(page)).toEqual({ time: destination, price: expected });
        await page.goBack();
        await probe.waitForReady();
        expect(await camera(page)).toEqual(before);
      } finally { gate.open(); }
    });
  }
}

test("auto resolution refits every finer destination tile in one history entry", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor(historicalProfile);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${fake.url}/#t=${historicalTime}&p=10000~40000&mode=volume&follow=free`);
  await probe.waitForReady();
  const before = await camera(page);
  fake.clearLog();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => camera(page), { timeout: 15000 }).toEqual({ time: destination, price: [24987.5, 25262.5] });
  await probe.waitForReady();
  const levels = fake.log().filter(r => r.path === "/cube/tile").map(r => Number(r.query.m));
  expect(levels.length, "the scenario fetched multiple progressively finer tiles").toBeGreaterThan(1);
  expect(levels[levels.length - 1]).toBeLessThan(levels[0]);
  const fitted = await camera(page), box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.dblclick(box.x + 20, box.y + 100);
  expect(await camera(page)).toEqual(fitted);
  await page.goBack();
  await probe.waitForReady();
  expect(await camera(page)).toEqual(before);
});
