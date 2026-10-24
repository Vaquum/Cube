"use strict";
// Issue #135. Oracle: the hand-computed trade and motion cells in nonvalues.json.
const { test, expect } = require("./fixtures.js");
const { addRecorder, lastDraw, rectOf, boxOf } = require("./cells-support.js");

const VIEW = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:08Z", low: 24750, high: 25750 };
const HASH = `#t=${VIEW.from}~${VIEW.to}&p=${VIEW.low}~${VIEW.high}&r=0,0&auto=0&vis=2&lines=`;
test.use({ reducedMotion: "reduce" });

async function atCell(page, c, r) {
  const canvas = await page.locator("#ol-canvas").boundingBox();
  const draw = await lastDraw(page), box = boxOf(draw.plot, rectOf(VIEW), 0, 0, c, r);
  await page.mouse.move(canvas.x + (box.x0 + box.x1) / 2, canvas.y + (box.y0 + box.y1) / 2);
}

for (const mode of ["path", "dwell"]) {
  test(`${mode}: a stationary pointer gets its card when motion data arrives`, async ({ page, fakeFor, probe }) => {
    await addRecorder(page);
    const fake = await fakeFor("micro:nonvalues");
    const gate = fake.on({ route: "/cube/motion" }).gate();
    await page.goto(fake.url + "/" + HASH + "&mode=" + mode);
    await expect.poll(() => fake.log().some(x => x.path === "/cube/motion")).toBe(true);
    await atCell(page, 2, 201); // Movement-only: absent until the held read arrives.
    await expect(page.locator("#ol-tip")).toBeHidden();

    gate.open();
    await probe.waitForReady();
    await expect(page.locator("#ol-tip")).toBeVisible();
    await expect(page.locator("#ol-tip")).toHaveAttribute("data-readout", "0:0:2:201");
  });
}

for (const mode of ["volume", "trades", "size", "delta", "flow", "flowtrades", "cascade", "geometry", "path", "dwell"]) {
  test(`${mode}: cards follow data-bearing cells and disappear over empty space`, async ({ page, fakeFor, probe }) => {
    await addRecorder(page);
    const fake = await fakeFor("micro:nonvalues");
    await page.goto(fake.url + "/" + HASH + "&mode=" + mode);
    await probe.waitForReady();
    const tip = page.locator("#ol-tip");

    await atCell(page, 0, 200); // One trade at 25,000 USDT.
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute("data-readout", "0:0:0:200");

    await atCell(page, 0, 205); // No trade or motion at this price.
    await expect(tip).toBeHidden();
    await expect(tip).toHaveAttribute("data-readout", "");
    await expect(page.locator("#ol-legend-marker")).toBeHidden();

    await atCell(page, 2, 201); // Price crossed this row without a trade.
    if (["path", "dwell"].includes(mode)) {
      await expect(tip).toBeVisible();
      await expect(tip).toHaveAttribute("data-readout", "0:0:2:201");
    } else await expect(tip).toBeHidden();

    await atCell(page, 2, 203); // The next traded cell restores the card.
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute("data-readout", "0:0:2:203");

    await atCell(page, 7, 203); // Beyond the six-minute data cutoff.
    await expect(tip).toBeHidden();
    await expect(tip).toHaveAttribute("data-readout", "");
  });
}
