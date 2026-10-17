"use strict";
// Oracles: native frame geometry/opacity, the displayed calibration state, and
// independently held cube responses. Reload uses the same browser's saved view.
const { test, expect } = require("./fixtures.js");

function recordStartup() {
  const native = requestAnimationFrame.bind(window);
  window.startupFrames = [];
  window.startupReveals = [];
  let api;
  Object.defineProperty(window, "explorerMotion", {
    get: () => api,
    set: motion => {
      api = { ...motion, reveal(element, options) {
        window.startupReveals.push({ id: element.id, opacity: Number(getComputedStyle(element).opacity),
          state: document.getElementById("ol-legend")?.dataset.state, distance: options?.distance });
        return motion.reveal(element, options);
      } };
    },
  });
  function sample() {
    const canvas = document.getElementById("ol-canvas"), controls = document.getElementById("ol-controls");
    if (canvas && controls) {
      const box = canvas.getBoundingClientRect();
      window.startupFrames.push({ geometry: [box.x, box.y, box.width, box.height], painted: Boolean(canvas.dataset.layout),
        opacity: Number(getComputedStyle(canvas).opacity), controls: Number(getComputedStyle(controls).opacity),
        state: document.getElementById("ol-legend")?.dataset.state });
    }
    if (!window.stopStartupRecording) native(sample);
  }
  native(sample);
}

for (const profile of ["recorded", "mini"]) for (const phone of [false, true]) {
  test(`${profile} ${phone ? "phone" : "desktop"}: first load and refresh reveal a stable calibrated chart`, async ({ fakeFor, freshContext }, testInfo) => {
    const fake = await fakeFor(profile, { next: 300 });
    const context = await freshContext({ probe: false, viewport: phone ? { width: 390, height: 844 } : { width: 1500, height: 950 } });
    await context.addInitScript(recordStartup);
    const page = await context.newPage();
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      else await page.goto(fake.url + "/#w=24h");
      await page.waitForFunction(() => window.cubeAgent && !document.getElementById("ol-canvas").hasAttribute("data-startup") && !window.explorerMotion.motionActive());
      // The sampler runs before the spring's callback; capture the next native
      // frame so its final sample includes the completed opacity write.
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const { frames, reveals } = await page.evaluate(() => {
        window.stopStartupRecording = true;
        return { frames: window.startupFrames, reveals: window.startupReveals };
      });
      const painted = frames.filter(frame => frame.painted);
      expect(painted.length).toBeGreaterThan(0);
      expect(new Set(painted.map(frame => JSON.stringify(frame.geometry))).size, "status removal must not move or resize painted data").toBe(1);
      const visible = painted.filter(frame => frame.opacity > 0);
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every(frame => frame.state === "ready"), "uncalibrated outlines must not flash before color").toBe(true);
      for (const id of ["ol-controls", "ol-canvas"]) {
        const entries = reveals.filter(reveal => reveal.id === id);
        expect(entries).toHaveLength(1);
        expect(entries[0].opacity, "entrance starts transparent, including before its first spring write").toBe(0);
        expect(entries[0].distance, "chart and controls enter in place").toBe(0);
      }
      expect(painted.at(-1).opacity).toBe(1);
      if (reload) await page.screenshot({ path: testInfo.outputPath("startup-settled.png") });
      // A multiline status must also preserve geometry after startup.
      const before = await page.locator("#ol-canvas").boundingBox();
      await page.locator("#ol-loading").evaluate(node => { node.textContent = "Unavailable data. ".repeat(30); node.hidden = false; });
      expect(await page.locator("#ol-canvas").boundingBox()).toEqual(before);
    }
  });
}

test("reduced motion presents the first calibrated chart without intermediate opacity", async ({ fakeFor, freshContext }) => {
  const fake = await fakeFor("recorded");
  const context = await freshContext({ probe: false, reducedMotion: "reduce" });
  await context.addInitScript(recordStartup);
  const page = await context.newPage();
  await page.goto(fake.url + "/#w=24h");
  await page.waitForFunction(() => window.cubeAgent && !document.getElementById("ol-canvas").hasAttribute("data-startup"));
  const frames = await page.evaluate(() => { window.stopStartupRecording = true; return window.startupFrames; });
  expect(frames.every(frame => [0, 1].includes(frame.opacity) && [0, 1].includes(frame.controls))).toBe(true);
  await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "1");
});

test("a failed initial tile reveals the fallback and keeps its error visible", async ({ page, fakeFor, allowConsole }) => {
  const fake = await fakeFor("standard", { next: 300 });
  const gate = fake.on({ route: "/cube/tile" }).gate();
  allowConsole(/Failed to load resource/);
  try {
    await page.goto(fake.url + "/#w=7d&r=2,0");
    await gate.arrived();
    await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "0");
    await expect(page.locator("#ol-controls")).toHaveCSS("opacity", "1");
    const before = await page.locator("#ol-canvas").boundingBox();
    gate.fail(503);
    gate.open();
    await expect(page.locator("#ol-loading")).toContainText("unavailable");
    await expect(page.locator("#ol-loading")).toHaveAttribute("role", "alert");
    await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "1");
    expect(await page.locator("#ol-canvas").boundingBox()).toEqual(before);
  } finally {
    gate.open();
  }
});
