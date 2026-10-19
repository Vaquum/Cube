"use strict";
// Independent oracles: the public chooser catalog, canvas-drawn strip/profile records,
// persisted URL settings and observation formula/support on each inspected surface.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page);
  await use(paneCanvas.forPage(page));
} });
test.use({ reducedMotion: "reduce" });
const PERIODS = ["visible", "1d", "wk", "7d", "mo", "30d", "90d", "yr", "1y", "3y", "all"];
const MEASURES = ["off", "volume", "delta", "relvol", "time"];
const view = [196, 214], cols = [S.END_COL - S.DAY_COLS, S.END_COL];
const address = (extra = "") => S.address({ cols, rows: view, rowsKind: "delta", period: "visible", extra: `&rc=1&background=volume&backgroundPeriod=7d&vis=2${extra}` });
async function open(page, fakeFor, probe, hash = address()) {
  const stream = S.disjoint();
  const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet();
  return fake;
}
async function choose(page, id, kind, period) {
  const menu = page.locator(`#ol-${id}-menu`);
  await page.locator(`#ol-${id}`).click();
  await menu.locator(`[data-${id}="${kind}"]`).click();
  if (kind !== "off") await menu.locator(`[data-period="${period}"]`).click();
  await expect(menu).toBeHidden();
}
async function snapshot(page, pane) {
  const layout = await page.locator("#ol-canvas").evaluate(n => n.dataset.layout.split(",").map(Number));
  const frame = await pane.last(), refX = layout[7] + 66;
  const strip = frame.rects.filter(r => Math.abs(r.x - layout[4]) < .01 && r.w === 12 && r.h < layout[3] - 1 && r.alpha === 1)
    .map(({ y, h, fill }) => ({ y, h, fill }));
  const bars = frame.rects.filter(r => Math.abs(r.x - refX) < .01 && r.w > 0 && r.w <= 48 && r.h > 0 && Math.abs(r.alpha - .7) < 1e-9)
    .map(({ y, h, w, fill }) => ({ y, h, w, fill }));
  const profile = await page.locator("#ol-profile-chip").evaluate(n => ({ reference: n.dataset.reference, domain: n.dataset.referenceDomain, tracks: n.dataset.tracks }));
  return { strip, bars, profile, layout };
}
const observation = locator => locator.evaluate(n => JSON.parse(n.dataset.observation));

for (const source of ["mini", "recorded"]) test(`${source}: Rows and Background share their complete measure and period catalog`, async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor(source);
  await page.goto(`${fake.url}/#w=24h&rc=1&rows=volume&background=volume`);
  await probe.waitForReady();
  const catalogs = [];
  for (const id of ["rows", "background"]) {
    const menu = page.locator(`#ol-${id}-menu`);
    await page.locator(`#ol-${id}`).click();
    const measures = await menu.locator(`[data-${id}]`).evaluateAll((nodes, id) => nodes.map(n => ({
      key: n.dataset[id], name: document.getElementById(n.getAttribute("aria-labelledby"))?.textContent,
      description: document.getElementById(n.getAttribute("aria-describedby"))?.textContent,
      disabled: n.getAttribute("aria-disabled") === "true",
    })), id);
    expect(measures.map(m => m.key)).toEqual(MEASURES);
    expect(measures.find(m => m.key === "time").disabled).toBe(source === "recorded");
    expect(await menu.locator(`[data-${id}-step]`).evaluateAll((nodes, id) => nodes.map(n => n.dataset[`${id}Step`]), id)).toEqual(["dataset", "period"]);
    await menu.locator(`[data-${id}-step="period"]`).click();
    const periods = await menu.locator("[data-period]").evaluateAll(nodes => nodes.map(n => ({
      key: n.dataset.period, name: document.getElementById(n.getAttribute("aria-labelledby"))?.textContent,
      description: document.getElementById(n.getAttribute("aria-describedby"))?.textContent,
      disabled: n.getAttribute("aria-disabled") === "true",
    })));
    expect(periods.map(p => p.key)).toEqual(PERIODS);
    await expect(menu.getByRole("menuitem", { name: "Since this day", exact: true })).toHaveCount(1);
    const date = menu.getByLabel("Since a UTC day");
    const bounds = [await date.getAttribute("min"), await date.getAttribute("max")];
    await expect(menu.locator("[data-scale-item]")).toHaveCount(0);
    catalogs.push({ measures, periods, bounds });
    await page.keyboard.press("Escape");
  }
  expect(catalogs[1]).toEqual(catalogs[0]);
  await expect(page.locator("#ol-period")).toHaveCount(0);
});

test("fresh controls default to independent Off periods and reveal them before enabling", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "#w=24h&rc=1");
  await expect(page.locator("#ol-rows-text")).toHaveText("Off · Visible range");
  await expect(page.locator("#ol-background-text")).toHaveText("Off · 90 days");
  await choose(page, "rows", "volume", "visible");
  await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-reference", "volume:visible");
  await expect(page.locator("#ol-background-text")).toHaveText("Off · 90 days");
  await expect(page.locator("#ol-rows-legend")).toBeHidden();
  await choose(page, "background", "volume", "90d");
  await expect(page.locator("#ol-rows-text")).toHaveText("Volume · Visible range");
  await expect(page.locator("#ol-background-text")).toHaveText("Volume · 90 days");
});

test("Rows changes leave Background pixels and calibration intact; Background changes leave profile bars intact", async ({ page, fakeFor, probe, pane, surface }) => {
  const fake = await open(page, fakeFor, probe);
  const initial = await snapshot(page, pane);
  expect(initial.strip.length).toBeGreaterThan(0);
  const calibration = (await surface.chip("rows")).data;
  await choose(page, "rows", "volume", "30d");
  await S.atRest(page, fake, probe); await probe.waitForQuiet();
  const rowChange = await snapshot(page, pane);
  expect(rowChange.strip).toEqual(initial.strip);
  expect(rowChange.profile.reference).toBe("volume:30d");
  const after = (await surface.chip("rows")).data;
  for (const key of ["context", "mappingId", "fitSeq"]) expect(after[key], `Background ${key}`).toBe(calibration[key]);
  expect(rowChange.bars.length).toBeGreaterThan(0);
  await choose(page, "background", "time", "1d");
  await S.atRest(page, fake, probe); await probe.waitForQuiet();
  const backgroundChange = await snapshot(page, pane);
  expect(backgroundChange.profile).toEqual(rowChange.profile);
  expect(backgroundChange.bars).toEqual(rowChange.bars);
  expect(backgroundChange.strip).not.toEqual(rowChange.strip);
  await choose(page, "background", "off");
  await S.atRest(page, fake, probe);
  expect((await snapshot(page, pane)).layout[5]).toBe(0);
  await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-tracks", "2");
  await choose(page, "background", "volume", "7d");
  await choose(page, "rows", "off");
  await S.atRest(page, fake, probe);
  expect((await snapshot(page, pane)).strip.length).toBeGreaterThan(0);
  await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-tracks", "1");
});

test("each custom date and period persists independently through reload", async ({ page, fakeFor, probe }) => {
  const fake = await open(page, fakeFor, probe);
  await page.locator("#ol-rows").click();
  const menu = page.locator("#ol-rows-menu");
  await menu.locator('[data-rows-step="period"]').click();
  await menu.getByLabel("Since a UTC day").fill("2026-01-01");
  await menu.getByRole("menuitem", { name: "Since this day", exact: true }).click();
  await expect(menu).toBeHidden();
  await choose(page, "background", "volume", "30d");
  await page.reload(); await S.atRest(page, fake, probe);
  const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(params.get("rc")).toBe("1");
  expect(params.get("period")).toBe("2026-01-01");
  expect(params.get("backgroundPeriod")).toBe("30d");
  await expect(page.locator("#ol-rows-text")).toContainText("Delta");
  await expect(page.locator("#ol-background-text")).toHaveText("Volume · 30 days");
  for (const [id, selected] of [["rows", "2026-01-01"], ["background", "30d"]]) {
    await page.locator(`#ol-${id}`).click();
    await page.locator(`#ol-${id}-menu [data-${id}-step="period"]`).click();
    await expect(page.locator(`#ol-${id}-menu [data-period="${selected}"]`)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  }
});

test("hover and Inspect attribute the strip to Background and the second profile to Rows, including replay support", async ({ page, fakeFor, probe, pane }) => {
  await open(page, fakeFor, probe, address("&replay=1&at=2026-09-24T06:00Z"));
  const { layout } = await snapshot(page, pane), box = await page.locator("#ol-canvas").boundingBox();
  const y = box.y + layout[1] + layout[3] / 2;
  await page.mouse.move(box.x + layout[4] + 6, y);
  await expect(page.locator("#ol-tip")).toBeVisible();
  expect((await observation(page.locator("#ol-tip"))).formula).toBe("rows.volume.amount@1");
  await page.mouse.move(box.x + layout[7] + 66 + 20, y);
  await expect.poll(async () => (await observation(page.locator("#ol-tip"))).formula).toBe("rows.delta.amount@1");
  await page.keyboard.press("e");
  const records = {};
  for (const id of ["rows", "background"]) {
    await page.locator(`button[data-surface="${id}"]`).click();
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", id);
    const card = page.locator("#ol-inspect-readout");
    await expect(card).toHaveAttribute("data-observation", /./);
    records[id] = await observation(card);
    await expect(card).toContainText(id === "rows" ? "Rows · Visible range" : "Background · 7 days");
  }
  expect(records.rows.formula).toBe("rows.delta.amount@1");
  expect(records.background.formula).toBe("rows.volume.amount@1");
  expect(records.rows.time[0]).toBe(cols[0]);
  expect(records.background.time[0]).toBeLessThan(records.rows.time[0]);
  const cutoff = (Date.parse("2026-09-24T06:00Z") - Date.parse("2021-01-01T00:00Z")) / S.BASE_MS;
  for (const record of Object.values(records)) {
    expect(record.time[1]).toBeLessThanOrEqual(cutoff);
    expect(record.measuredThrough).toBeLessThanOrEqual(cutoff);
  }
  expect(records.background.time[1]).toBe(records.rows.time[1]);
});

test("Background colour transform cannot alter the Rows profile's drawn lengths", async ({ page, fakeFor, probe, pane, surface }) => {
  await page.setViewportSize({ width: 1960, height: 950 });
  const fake = await open(page, fakeFor, probe, address().replace("rows=delta", "rows=volume"));
  const opened = await surface.openLegendDetails("rows");
  await S.atRest(page, fake, probe); await probe.waitForQuiet();
  const before = await snapshot(page, pane);
  expect(before.bars.length).toBeGreaterThan(0);
  await opened.popover.locator('[data-action="colour-transform"][data-value="linear"]').click();
  await S.atRest(page, fake, probe); await probe.waitForQuiet();
  const after = await snapshot(page, pane);
  expect(after.profile).toEqual(before.profile);
  expect(after.bars).toEqual(before.bars);
  expect(after.strip).not.toEqual(before.strip);
});
