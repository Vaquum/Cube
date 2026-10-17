"use strict";
// Oracles: explicit saved names/order, chart mode, authored coordinates and stored bytes.
// Row Save must retain complete snapshots and failures must preserve prior publications.
const { test, expect } = require("./fixtures.js");
const S = require("./persistence-support.js");
const PREFIX = "market-state-cube-explorer:";
const PUBLICATION = "drawing-views:v2:record:";
const legacyViews = ["A", "B"].map((name) => ({
  name, live: false, span: 10, lead: 0, auto: true, mode: "volume", pane: "cells",
  rows: "off", period: "90d", hash: "#w=24h&vis=2&ap=" + S.AP,
  tA: 1, tB: 2, cut: 3, n: 6, m: 0, window: "24h", replay: false, visualVersion: 2,
}));
const rawLegacy = JSON.stringify(legacyViews);
const rowNames = (page) => page.locator("#ol-saved .ol-entry-main");
async function openSeeded(page, context, fake) {
  await context.addInitScript(({ prefix, raw }) => {
    try {
      if (localStorage.getItem("__named_seeded")) return;
      localStorage.setItem("__named_seeded", "1");
      localStorage.setItem(prefix + "views:v1", raw);
    } catch { /* about:blank has no origin storage */ }
  }, { prefix: PREFIX, raw: rawLegacy });
  await page.goto(fake.url + "/");
  await fake.idle();
  await S.openViews(page);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
}
async function upgradeA(page) {
  await page.getByRole("button", { name: "Save “A”", exact: true }).click();
  await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.visualVersion)).toEqual([3, 2]);
}

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map((p) => p.close().catch(() => {})));
});

test("upgrading and updating first legacy name retains A, B order and unchanged legacy bytes", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini");
  await openSeeded(page, context, fake);
  await upgradeA(page);
  const entries = await S.namedEntries(page);
  expect(entries.map((x) => x.name)).toEqual(["A", "B"]);
  expect(entries[0].payload).toMatchObject({ visualVersion: 3, drawings: { schemaVersion: 1, objects: [] } });
  expect(entries[1]).toEqual(legacyViews[1]);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  await page.reload();
  await fake.idle();
  await S.openViews(page);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  expect(await S.namedEntries(page)).toEqual(entries);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  // Updating an existing protected entry must publish its changed complete snapshot.
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect.poll(async () => {
    const mode = S.param((await S.where(page)).hash, "mode");
    return mode !== null && mode !== entries[0].payload.view.mode;
  }).toBe(true);
  const newMode = S.param((await S.where(page)).hash, "mode");
  await S.openViews(page);
  await page.locator("#ol-view-name").fill("This name must not be saved");
  await page.getByRole("button", { name: "Save “A”", exact: true }).click();
  await expect(page.locator("#ol-views-status")).toHaveText("Updated “A”.");
  await expect.poll(async () => (await S.namedEntries(page))[0].payload.view.mode).toBe(newMode);
  expect((await S.namedEntries(page)).map((x) => x.name)).toEqual(["A", "B"]);
  expect((await S.namedEntries(page))[1]).toEqual(legacyViews[1]);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  const updated = await S.namedEntries(page);
  await page.reload(); await fake.idle(); await S.openViews(page);
  expect(await S.namedEntries(page)).toEqual(updated);
  await page.locator("#ol-saved .ol-entry").filter({ hasText: "A" }).click();
  await expect.poll(async () => S.param((await S.where(page)).hash, "mode")).toBe(newMode);
});

test("row Save failure preserves the previous snapshot and can be retried", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini");
  await openSeeded(page, context, fake); await upgradeA(page);
  const previous = await S.namedEntries(page), stored = await S.namedStorage(page);
  await page.keyboard.press("Escape"); await page.keyboard.press("m");
  await S.openViews(page);
  await page.evaluate((key) => {
    window.__namedOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith(key)) throw new DOMException("Named update quota fixture", "QuotaExceededError");
      return window.__namedOriginalSetItem.call(this, name, value);
    };
  }, PREFIX + PUBLICATION);
  await page.getByRole("button", { name: "Save “A”", exact: true }).click();
  await expect(page.locator("#ol-views-status")).toContainText("views can't be saved");
  expect(await S.namedEntries(page)).toEqual(previous);
  expect(await S.namedStorage(page)).toEqual(stored);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  await page.evaluate(() => { Storage.prototype.setItem = window.__namedOriginalSetItem; });
  await page.getByRole("button", { name: "Save “A”", exact: true }).click();
  await expect(page.locator("#ol-views-status")).toHaveText("Updated “A”.");
  expect((await S.namedEntries(page))[0].payload.view.mode).not.toBe(previous[0].payload.view.mode);
  expect((await S.namedEntries(page))[1]).toEqual(previous[1]);
});

test("row Save replaces the complete drawing snapshot and restores it after reload", async ({ page, fakeFor }) => {
  const D = require("./drawings-support.js"), fake = await fakeFor("mini");
  await D.open(page, fake); await S.openViews(page);
  await page.locator("#ol-view-name").fill("Drawing view");
  await page.locator("#ol-view-form button[type=submit]").click();
  await expect(page.locator("#ol-views-status")).toHaveText("Saved “Drawing view”.");
  await page.keyboard.press("Escape"); await D.drawing(page);
  const authored = await D.rows(page);
  await S.openViews(page);
  await page.getByRole("button", { name: "Save “Drawing view”", exact: true }).click();
  await expect(page.locator("#ol-views-status")).toHaveText("Updated “Drawing view”.");
  expect((await S.namedEntries(page))[0].payload.drawings.objects).toHaveLength(1);
  await page.reload(); await D.ready(page);
  await D.action(page, authored[0].id, "delete");
  await expect.poll(() => D.count(page)).toBe(0);
  await S.openViews(page);
  await page.locator("#ol-saved .ol-entry").filter({ hasText: "Drawing view" }).click();
  await expect.poll(() => D.rows(page)).toEqual(authored);
});

for (const phone of [false, true]) test(`tab history starts collapsed and expands for keyboard navigation (${phone ? "phone" : "desktop"})`, async ({ page, fakeFor, probe }) => {
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h&vis=2"); await probe.waitForReady();
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("2");
  await probe.waitForReady();
  if (phone) await page.locator("#ol-sheet-toggle").click();
  await S.openViews(page);
  const heading = page.locator("#ol-tab-history summary"), history = page.locator("#ol-breadcrumbs");
  await expect(heading).toBeVisible(); await expect(history).toBeHidden();
  await expect(history.locator("button")).toHaveCount(2);
  await heading.focus(); await page.keyboard.press("Enter");
  await expect(history).toBeVisible();
  await history.locator("button").last().click();
  await expect(page.locator("#ol-hist-pop")).toBeHidden();
  await expect.poll(async () => S.param((await S.where(page)).hash, "w")).toBe("24h");
  await S.openViews(page); await expect(history).toBeHidden();
  await heading.click(); await expect(history).toBeVisible();
  await heading.focus(); await page.keyboard.press("Space"); await expect(history).toBeHidden();
});

test("quota during named Delete Undo keeps the authoritative deletion and allows one retry in place", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini");
  await openSeeded(page, context, fake);
  await upgradeA(page);
  const savedA = (await S.namedEntries(page))[0];
  await page.getByRole("button", { name: "Delete “A”", exact: true }).click();
  await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.name)).toEqual(["B"]);
  await expect(rowNames(page)).toHaveText(["B"]);
  const deletedStorage = await S.namedStorage(page);
  await page.evaluate((key) => {
    window.__namedOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith(key)) throw new DOMException("Named publication quota fixture", "QuotaExceededError");
      return window.__namedOriginalSetItem.call(this, name, value);
    };
  }, PREFIX + PUBLICATION);
  await page.locator("#ol-views-status").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#ol-views-status")).toContainText("Retry Undo");
  await expect(rowNames(page)).toHaveText(["B"]);
  expect(await S.namedStorage(page)).toEqual(deletedStorage);
  expect((await S.namedEntries(page)).map((x) => x.name)).toEqual(["B"]);
  expect(await S.noticeCodes(page)).toContain("storage-failed");
  await page.evaluate(() => { Storage.prototype.setItem = window.__namedOriginalSetItem; });
  await page.locator("#ol-views-status").getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.name)).toEqual(["A", "B"]);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  expect((await S.namedEntries(page))[0]).toEqual(savedA);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  await page.reload();
  await fake.idle();
  await S.openViews(page);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
});
