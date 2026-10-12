"use strict";
// Oracle: explicit synthetic integer-price/quantity trades, summed directly over
// half-open UTC windows. No production VWAP or bar helper supplies expectations.
const { test: base, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const paneCanvas = require("./pane-canvas.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page); await use(paneCanvas.forPage(page));
} });
test.use({ reducedMotion: "reduce" });
const EPOCH = Date.parse("2021-01-01T00:00Z"), DAY = 86400000, HOUR = 3600000;
const START = Date.parse("2026-09-22T00:00Z"), END = START + 2 * DAY - HOUR / 2;
const KEYS = ["svwap", "asvwap", "euvwap", "usvwap"];
const WINDOWS = { svwap: [0, 24], asvwap: [0, 8], euvwap: [8, 16], usvwap: [13, 21] };
const TRADES = [
  [0, 20000, 1], [8 * HOUR - 1, 22000, 1],
  [8 * HOUR, 24000, 2], [13 * HOUR - 1, 30000, 1],
  [13 * HOUR, 32000, 3], [16 * HOUR - 1, 40000, 1],
  [16 * HOUR, 50000, 2], [21 * HOUR - 1, 60000, 1], [21 * HOUR, 100000, 10],
  [DAY, 10000, 1], [DAY + 8 * HOUR - 1, 12000, 1],
  [DAY + 8 * HOUR, 20000, 1], [DAY + 13 * HOUR, 22000, 1],
  [DAY + 13.5 * HOUR, 24000, 2], [DAY + 16 * HOUR - 1, 26000, 1],
  [DAY + 16 * HOUR, 28000, 1], [DAY + 21 * HOUR - 1, 30000, 1],
  [DAY + 21 * HOUR, 90000, 100],
].map(([t, price, qty]) => ({ t_ms: START - EPOCH + t, price: price * 100, qty: qty * 1e8, takerBuy: true }));
const iso = (ms) => new Date(ms).toISOString();
const profile = (trades = TRADES) => ({ name: "session-vwap-synthetic", trades, cutoffIso: iso(END) });
const hash = (extra = "", a = START, b = END) => `#t=${iso(a)}~${iso(b)}&p=5000~110000&r=0,0&f=free&vis=2&lines=${KEYS.join(",")}${extra}`;
function oracle(key, date, cutoff = END, trades = TRADES) {
  const [a, b] = WINDOWS[key], start = date + a * HOUR, end = Math.min(date + b * HOUR, cutoff);
  if (end <= start) return "not open";
  let quote = 0, base = 0;
  for (const t of trades) if (t.t_ms + EPOCH >= start && t.t_ms + EPOCH < end) {
    quote += t.price * t.qty; base += t.qty;
  }
  return base ? Math.round(quote / base) / 100 : "no trades";
}
async function menu(page) {
  if (await page.locator("#ol-lines-pop").isHidden()) await page.locator("#ol-lines").click();
}
async function values(page, date = START + DAY, cutoff = END, trades = TRADES) {
  await menu(page);
  for (const key of KEYS) {
    const want = oracle(key, date, cutoff, trades), node = page.locator(`[data-line-value="${key}"]`);
    if (typeof want === "string") await expect(node).toHaveText(want);
    else await expect.poll(async () => Number((await node.textContent()).replace(/[^\d.-]/g, ""))).toBe(want);
  }
}
async function references(page) {
  if (await page.locator("#ol-lines-pop").isVisible()) await page.keyboard.press("Escape");
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("e");
  await page.locator('[data-surface="references"]').click();
  return page.locator("#ol-inspect-reference option").allTextContents();
}

test("regional toggles persist and each date has an independent bounded VWAP", async ({ page, fakeFor, pane }) => {
  const fake = await fakeFor(profile());
  await page.goto(fake.url + "/" + hash()); await D.ready(page); await values(page);
  for (const key of KEYS) await expect(page.locator(`[data-line="${key}"]`)).toBeChecked();
  await expect(page.locator('[data-ref-key="euvwap"]')).toHaveAttribute("title", /08:00–16:00 UTC/);
  await expect(page.locator('[data-ref-key="usvwap"]')).toHaveAttribute("title", /13:00–21:00 UTC/);
  const names = await references(page);
  for (const name of ["Session VWAP", "Asia session VWAP", "Europe session VWAP", "US session VWAP"]) {
    expect(names).toContain(`${name} · 22 Sep 2026`); expect(names).toContain(`${name} · 23 Sep 2026`);
  }
  expect(new Set(names).size).toBe(names.length);
  await page.locator("#ol-inspect-reference").selectOption({ label: "US session VWAP · 22 Sep 2026" });
  await expect(page.locator("#ol-inspect-readout")).toContainText("13:00");
  await expect(page.locator("#ol-inspect-readout")).toContainText("21:00");
  await page.reload(); await D.ready(page); await values(page);
  await page.keyboard.press("Escape");
  await expect.poll(async () => paneCanvas.textsOf(await pane.last())).toEqual(expect.arrayContaining(["Asia VWAP", "Europe VWAP", "US VWAP"]));
});

for (const hour of [7, 8, 13, 13.5, 16, 21]) test(`replay at ${hour}h excludes boundary/future trades and stops closed sessions`, async ({ page, fakeFor }) => {
  const cutoff = START + DAY + hour * HOUR, fake = await fakeFor(profile());
  await page.goto(fake.url + "/" + hash(`&replay=1&at=${iso(cutoff)}`)); await D.ready(page);
  await values(page, START + DAY, cutoff);
});

test("coarse and historical views retain exact session sums", async ({ page, fakeFor }) => {
  const fake = await fakeFor(profile());
  // At this scale the ordinary VWAP would use 8-hour bars, crossing US boundaries.
  await page.goto(fake.url + "/" + hash("", Date.parse("2021-01-01T00:00Z"), END));
  await D.ready(page); await values(page);
  await page.goto(fake.url + "/" + hash("", START, START + DAY));
  await D.ready(page); await values(page);
});

test("empty sessions disclose no trades; recorded sources withhold regional VWAP", async ({ page, fakeFor }) => {
  const trades = TRADES.filter((t) => t.t_ms + EPOCH < START + DAY || t.t_ms + EPOCH >= START + DAY + 21 * HOUR);
  const fake = await fakeFor(profile(trades));
  await page.goto(fake.url + "/" + hash()); await D.ready(page); await values(page, START + DAY, END, trades);
  const recorded = await fakeFor("recorded");
  await page.goto(recorded.url + "/" + hash()); await D.ready(page); await menu(page);
  for (const key of KEYS) await expect(page.locator(`[data-line="${key}"]`)).toBeDisabled();
});
