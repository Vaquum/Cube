"use strict";
const { test, expect } = require("./fixtures.js");

async function open(page, fakeFor, probe) {
  const fake = await fakeFor("recorded");
  await page.goto(`${fake.url}/#w=24h&vis=2`);
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await probe.waitForQuiet({ quietMs: 400 });
}
async function settled(page) {
  await expect.poll(() => page.evaluate(() => window.explorerMotion.motionActive())).toBe(false);
}
async function geometry(page) {
  return page.evaluate(() => [".ol-status", "#ol-canvas"].map(selector => {
    const { y, height } = document.querySelector(selector).getBoundingClientRect();
    return { y, height };
  }));
}
async function addKeys(page, count = 24) {
  await page.locator("#ol-status-key-list").evaluate((list, count) => {
    for (let index = 0; index < count; index++) {
      const key = document.createElement("span");
      key.dataset.testLegend = "";
      key.textContent = `Window ${index + 1} · observed or derived levels`;
      list.append(key);
    }
  }, count);
}
async function fades(page, start, end) {
  await expect.poll(() => page.locator(".ol-status > .ol-status-keys").evaluate(node =>
    ["::before", "::after"].map(pseudo => Number(getComputedStyle(node, pseudo).opacity))
  )).toEqual([start, end]);
}

for (const colorScheme of ["light", "dark"]) {
  test(`legend keeps chart geometry and dims arrows at each limit (${colorScheme})`, async ({ page, fakeFor, probe }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 2400, height: 950 });
    await open(page, fakeFor, probe);
    const previous = page.getByRole("button", { name: "Scroll legend left", exact: true });
    const next = page.getByRole("button", { name: "Scroll legend right", exact: true });
    const viewport = page.getByRole("region", { name: "Chart legend", exact: true });
    await expect(previous).toBeDisabled();
    await expect(next).toBeDisabled();
    await fades(page, 0, 0);
    const before = await geometry(page);
    await addKeys(page);
    await expect(next).toBeEnabled();
    await expect(previous).toBeDisabled();
    await fades(page, 0, 1);
    expect(await geometry(page)).toEqual(before);
    expect(await viewport.evaluate(node => ({
      scrollbar: getComputedStyle(node).scrollbarWidth,
      verticalSpace: node.offsetHeight - node.clientHeight,
      wraps: getComputedStyle(node.firstElementChild).flexWrap,
    }))).toEqual({ scrollbar: "none", verticalSpace: 0, wraps: "nowrap" });
    await next.click();
    await settled(page);
    await expect(previous).toBeEnabled();
    await expect(next).toBeEnabled();
    await fades(page, 1, 1);
    await page.locator(".ol-status").screenshot({ path: `reports/legend-overflow-${colorScheme}.png` });
    await viewport.focus();
    await page.keyboard.press("End");
    await settled(page);
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    await fades(page, 1, 0);
    expect(await viewport.evaluate(node => {
      const last = node.querySelector("[data-test-legend]:last-child").getBoundingClientRect();
      return last.right - node.getBoundingClientRect().right;
    })).toBeLessThanOrEqual(1);
    await page.keyboard.press("Home");
    await settled(page);
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    await page.locator("[data-test-legend]").evaluateAll(nodes => nodes.forEach(node => node.remove()));
    await expect(next).toBeDisabled();
    await fades(page, 0, 0);
    expect(await geometry(page)).toEqual(before);
    await page.locator(".ol-status").screenshot({ path: `reports/legend-fit-${colorScheme}.png` });
  });
}

test("legend keyboard focus is visible inside its clipped viewport", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  const viewport = page.getByRole("region", { name: "Chart legend", exact: true });
  await viewport.focus();
  const focus = await viewport.evaluate(node => {
    const style = getComputedStyle(node);
    return { visible: node.matches(":focus-visible"), width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), style: style.outlineStyle };
  });
  expect(focus.visible).toBe(true);
  expect(focus.style).toBe("solid");
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.offset + focus.width).toBeLessThanOrEqual(0);
});

test("legend uses the shared spring, accepts reversal and yields to trackpad scrolling", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await addKeys(page);
  await expect(page.locator("#ol-status-next")).toBeEnabled();
  const before = await geometry(page);
  const motion = await page.evaluate(async () => {
    const viewport = document.querySelector("#ol-status-scroll");
    document.querySelector("#ol-status-next").click();
    const active = window.explorerMotion.motionValue(viewport, "scroll");
    const positions = [], heights = [];
    for (let frame = 0; frame < 8; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      positions.push(viewport.scrollLeft);
      heights.push(document.querySelector("#ol-canvas").getBoundingClientRect().height);
    }
    const from = viewport.scrollLeft;
    document.querySelector("#ol-status-prev").click();
    return { active: !!active, positions, heights, jump: viewport.scrollLeft - from };
  });
  expect(motion.active).toBe(true);
  expect(new Set(motion.positions).size).toBeGreaterThan(2);
  expect(new Set(motion.heights)).toEqual(new Set([before[1].height]));
  expect(Math.abs(motion.jump)).toBeLessThanOrEqual(1);
  await settled(page);
  await page.locator("#ol-status-scroll").hover();
  await page.mouse.wheel(150, 0);
  await expect(page.locator("#ol-status-prev")).toBeEnabled();
  await fades(page, 1, 1);
  expect(await geometry(page)).toEqual(before);
  await page.locator(".ol-status").screenshot({ path: "reports/legend-overflow-light.png" });
});

test("legend remeasures after resizing and settles immediately with reduced motion", async ({ page, fakeFor, probe }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1000, height: 950 });
  await open(page, fakeFor, probe);
  await addKeys(page, 3);
  await expect(page.locator("#ol-status-next")).toBeEnabled();
  await page.locator("#ol-status-scroll").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#ol-status-next")).toBeDisabled();
  expect(await page.locator("#ol-status-scroll").evaluate(node => window.explorerMotion.motionValue(node, "scroll"))).toBeNull();
  await page.setViewportSize({ width: 3000, height: 950 });
  await expect(page.locator("#ol-status-prev")).toBeDisabled();
  await expect(page.locator("#ol-status-next")).toBeDisabled();
  await fades(page, 0, 0);
  await page.setViewportSize({ width: 1000, height: 950 });
  await expect(page.locator("#ol-status-next")).toBeEnabled();
  await expect(page.locator("#ol-status-prev")).toBeDisabled();
});

test.describe("touch legend", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  test("phone legend scrolls with usable touch targets and wraps inside Help", async ({ page, fakeFor, probe }) => {
    await open(page, fakeFor, probe);
    const before = await geometry(page);
    await addKeys(page);
    await expect(page.locator("#ol-status-next")).toBeEnabled();
    for (const id of ["prev", "next"]) {
      const box = await page.locator(`#ol-status-${id}`).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator("#ol-status-next").tap();
    await expect(page.locator("#ol-status-prev")).toBeEnabled();
    expect(await geometry(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.locator(".ol-status").screenshot({ path: "reports/legend-phone.png" });
    await page.evaluate(() => {
      for (const id of ["ol-keys-ref", "ol-keys-scale"]) {
        const group = document.getElementById(id);
        for (let index = 0; index < 8; index++) {
          const key = document.createElement("span");
          key.textContent = `Observed reference ${index + 1}`;
          group.append(key);
        }
      }
    });
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("Shift+J");
    await page.locator("#ol-key-guide").click();
    const copy = page.locator("#ol-reference-colours .ol-status-key-list");
    await expect(copy).toBeVisible();
    expect(await copy.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    const groups = await copy.locator(".ol-keys-scale").evaluateAll(nodes => nodes.map(node => node.scrollWidth - node.clientWidth));
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const overflow of groups) expect(overflow).toBeLessThanOrEqual(1);
  });
});
