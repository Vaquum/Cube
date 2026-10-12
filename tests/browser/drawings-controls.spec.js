"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
test.use({ reducedMotion: "reduce" });

const inventoryRow = (page, id) => page.locator(`[data-drawing-row="${id}"]`);
const committed = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("market-state-cube-explorer:drawings:v1:session")).collection.objects);
async function nameLine(page, id, name, label = "") {
  await D.edit(page, id);
  await page.locator("#ol-drawing-name").fill(name);
  await page.locator("#ol-drawing-label").fill(label);
  await page.locator("#ol-drawing-apply").click();
  await D.closeManager(page);
}

test("editor Delete removes the chosen committed line, discards invalid draft edits and remains undoable when locked", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const first = await D.drawing(page), second = await D.drawing(page, [.125, .25], [.375, .375]);
  await nameLine(page, first.id, "Support", "Separate canvas label");
  await D.action(page, first.id, "lock");
  const before = await committed(page);
  await D.edit(page, first.id);
  const remove = page.locator("#ol-drawing-editor-delete");
  await expect(remove).toBeVisible(); await expect(remove).toBeEnabled();
  await expect(remove).toHaveAccessibleName("Delete line");
  await page.locator("#ol-drawing-name").fill("");
  await page.locator("#ol-drawing-label").fill("Unapplied draft");
  await remove.click();
  await expect(page.locator("#ol-drawing-editor")).toBeHidden();
  await expect.poll(() => D.count(page)).toBe(1);
  expect((await committed(page)).map((object) => object.id)).toEqual([second.id]);
  await expect(page.locator("#ol-drawing-confirm")).toBeHidden();
  await D.command(page, "undo");
  expect(await committed(page)).toEqual(before);
  await D.command(page, "redo");
  await page.reload(); await D.ready(page);
  expect((await committed(page)).map((object) => object.id)).toEqual([second.id]);
});

test("new exact drafts have no Delete action", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  await D.manager(page); await page.locator("#ol-drawing-new-exact").click();
  await expect(page.locator("#ol-drawing-editor")).toBeVisible();
  await expect(page.locator("#ol-drawing-editor-delete")).toBeHidden();
  await page.locator("#ol-drawing-cancel").click();
  expect(await D.count(page)).toBe(0);
});

test("Lines prefers custom Name, then optional Label, then the generated Trend line name", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const first = await D.drawing(page), second = await D.drawing(page, [.125, .25], [.375, .375]);
  await D.lines(page);
  await expect(inventoryRow(page, first.id).locator(".ol-line-name")).toHaveText("Trend line 1");
  await expect(inventoryRow(page, second.id).locator(".ol-line-name")).toHaveText("Trend line 2");
  await nameLine(page, first.id, "Trend line 1", "Support label"); await D.lines(page);
  await expect(inventoryRow(page, first.id).locator(".ol-line-name")).toHaveText("Support label");
  const name = '<img src=x onerror="alert(1)"> & retest';
  await nameLine(page, first.id, name, "Separate canvas label"); await D.lines(page);
  const row = inventoryRow(page, first.id);
  await expect(row.locator(".ol-line-name")).toHaveText(name);
  await expect(row.getByRole("checkbox", { name: `Show ${name}`, exact: true })).toBeChecked();
  await expect(row.getByRole("button", { name: `Delete ${name}`, exact: true })).toBeVisible();
  await expect(row.locator("img")).toHaveCount(0);
  await page.reload(); await D.ready(page); await D.lines(page);
  await expect(inventoryRow(page, first.id).locator(".ol-line-name")).toHaveText(name);
  await expect(inventoryRow(page, second.id).locator(".ol-line-name")).toHaveText("Trend line 2");
  await nameLine(page, first.id, name, "   "); await D.lines(page);
  await expect(inventoryRow(page, first.id).locator(".ol-line-name")).toHaveText(name);
  expect((await committed(page)).find((object) => object.id === first.id)).not.toHaveProperty("label");
});

for (const [surface, options] of [["desktop", { viewport: { width: 1500, height: 950 } }], ["phone touch", { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true }]]) test.describe(`inventory Delete on ${surface}`, () => {
  test.use(options);
  test("each custom line has an inline trash icon that deletes only that line, including hidden locked lines", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini"), touch = Boolean(options.hasTouch);
    await page.goto(fake.url + "/" + D.HASH);
    await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /\d/);
    if (await page.locator("#ol-trend").isHidden()) await page.locator("#ol-sheet-toggle").click();
    await D.ready(page);
    const first = await D.drawing(page, [.25, .75], [.75, .25], { touch }), second = await D.drawing(page, [.125, .25], [.375, .375], { touch });
    await nameLine(page, first.id, "Support");
    await D.action(page, first.id, "lock"); await D.action(page, first.id, "visible");
    const before = await committed(page);
    await D.lines(page);
    for (const [id, name] of [[first.id, "Support"], [second.id, "Trend line 2"]]) {
      const row = inventoryRow(page, id), remove = row.getByRole("button", { name: `Delete ${name}`, exact: true });
      await expect(remove).toBeVisible(); await expect(remove).toBeEnabled();
      await expect(remove.locator("svg[aria-hidden=true]")).toBeVisible();
      await expect(remove).toHaveText("");
      const [labelBox, buttonBox] = await Promise.all([row.locator(".ol-line-name").boundingBox(), remove.boundingBox()]);
      expect(buttonBox.x, "trash action follows the line name").toBeGreaterThanOrEqual(labelBox.x + labelBox.width - 1);
      expect(Math.min(labelBox.y + labelBox.height, buttonBox.y + buttonBox.height) - Math.max(labelBox.y, buttonBox.y), "trash action shares its name's row").toBeGreaterThan(0);
      if (touch) { expect(buttonBox.width).toBeGreaterThanOrEqual(44); expect(buttonBox.height).toBeGreaterThanOrEqual(44); }
    }
    const remove = inventoryRow(page, first.id).getByRole("button", { name: "Delete Support", exact: true });
    if (touch) await remove.tap();
    else { await remove.focus(); await page.keyboard.press("Enter"); }
    await expect.poll(() => D.count(page)).toBe(1);
    await expect(page.locator("#ol-lines-pop")).toBeVisible();
    await expect(page.locator("#ol-drawing-confirm")).toBeHidden();
    expect(await committed(page)).toEqual(before.filter((object) => object.id === second.id));
    await expect(inventoryRow(page, second.id).getByRole("button", { name: "Delete Trend line 2", exact: true })).toBeFocused();
    await D.closeManager(page);
    if (await page.locator("#ol-sheet-close").isVisible()) await page.locator("#ol-sheet-close").click();
    await D.command(page, "undo"); expect(await committed(page)).toEqual(before);
    await D.lines(page);
    await expect(inventoryRow(page, first.id).locator(".ol-line-name")).toHaveText("Support");
    await expect(inventoryRow(page, first.id).getByRole("checkbox")).not.toBeChecked();
  });
});
