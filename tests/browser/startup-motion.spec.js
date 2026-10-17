"use strict";
// Oracles: native frame geometry/opacity, the displayed calibration state, and
// independently held cube responses. Reload uses the same browser's saved view.
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");

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
        statusHeight: document.getElementById("ol-loading").offsetHeight,
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
      const normalized = painted.map(frame => {
        const [x, y, width, height] = frame.geometry;
        return [x, y - frame.statusHeight, width, height + (phone ? 0 : frame.statusHeight)];
      });
      expect(new Set(normalized.map(geometry => JSON.stringify(geometry))).size, "only the active status row may consume chart space").toBe(1);
      expect(painted.at(-1).statusHeight, "idle startup must leave no empty row").toBe(0);
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
      // Measure a long status in one layout transaction, before the application's
      // state-derived status renderer handles the next resize observation.
      const layout = await page.locator("#ol-loading").evaluate(node => {
        const canvas = document.getElementById("ol-canvas"), before = canvas.getBoundingClientRect().toJSON(), text = node.textContent;
        node.textContent = "Unavailable data. ".repeat(30); node.hidden = false;
        const status = node.getBoundingClientRect().toJSON(), shown = canvas.getBoundingClientRect().toJSON();
        node.hidden = true; node.textContent = text;
        return { before, status, shown, after: canvas.getBoundingClientRect().toJSON(), idleHeight: node.offsetHeight };
      });
      expect(layout.status.height).toBe(32);
      expect(layout.shown.y).toBe(layout.before.y + layout.status.height);
      expect(layout.shown.height).toBe(layout.before.height - (phone ? 0 : layout.status.height));
      expect(layout.status.bottom, "status must not cover market marks or floating controls").toBeLessThanOrEqual(layout.shown.y);
      expect(layout.after).toEqual(layout.before);
      expect(layout.idleHeight).toBe(0);
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

test("a changed cube with a failed pack refresh still reveals its held snapshot", async ({ page, fakeFor, allowConsole }) => {
  const fake = await fakeFor("standard", { next: 300 });
  fake.on({ route: "/cube/tile" }).fail({ status: 409, body: { error: "cube_changed" } });
  fake.on({ route: "/cube/pack" }).fail({ status: 503, body: { error: "refresh unavailable" } });
  allowConsole(/Failed to load resource/);
  await page.goto(fake.url + "/#w=7d&r=2,0");
  await expect.poll(() => fake.log().some(entry => entry.path === "/cube/pack" && entry.status === 503)).toBe(true);
  await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "1");
  await expect(page.locator("#ol-controls")).toHaveCSS("opacity", "1");
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /\d/);
});

test("a fatal startup decode leaves its error and controls visible", async ({ page, fakeFor }) => {
  const fake = await fakeFor("recorded");
  await page.route(fake.url + "/", async route => {
    const response = await route.fetch(), html = await response.text();
    const match = html.match(/(<script type="application\/json" id="origo-lens-data">)([\s\S]*?)(<\/script>)/);
    const pack = JSON.parse(match[2]);
    pack.blocks.recent.gzip_base64 = "AA==";
    await route.fulfill({ response, body: html.replace(match[0], match[1] + JSON.stringify(pack) + match[3]) });
  });
  await page.goto(fake.url + "/");
  await expect(page.locator("#ol-loading")).toContainText("Recorded data unavailable");
  await expect(page.locator("#ol-loading")).toHaveAttribute("role", "alert");
  await expect(page.locator("#ol-controls")).toHaveCSS("opacity", "1");
  await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "1");
});

test("status stays visible outside the plot when Compare expands", async ({ page, fakeFor }) => {
  const fake = await fakeFor("recorded");
  await page.goto(fake.url + "/#w=24h");
  await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "1");
  await page.locator("#ol-tab-compare").click();
  await page.locator('[data-comparison-action="expand"]').click();
  await expect(page.locator("#origo-lens")).toHaveAttribute("data-comparison-expanded", "true");
  await page.locator("#ol-loading").evaluate(node => { node.textContent = "Live updates stopped"; node.hidden = false; });
  await expect(page.locator("#ol-loading")).toBeVisible();
  expect(await page.locator("#ol-loading").evaluate(node => Boolean(node.closest("[inert]")))).toBe(false);
});

test("clearing a real status reclaims space with a maximized drawer", async ({ page, fakeFor, allowConsole }) => {
  const fake = await fakeFor("standard");
  fake.on({ route: "/cube/tile", when: query => Number(query.n) === 11 }).fail({ status: 503 });
  allowConsole(/Failed to load resource/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fake.url + "/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2");
  await expect(page.locator("#ol-loading")).toContainText("unavailable");
  await expect(page.locator("#ol-canvas")).toHaveCSS("opacity", "1");
  await page.locator("#ol-tab-cells").click();
  const grip = page.locator("#ol-drawer-grip");
  for (let step = 0; step < 30; step++) await grip.press("ArrowUp");
  const before = await page.locator("#ol-canvas").boundingBox();
  const statusHeight = await page.locator("#ol-loading").evaluate(node => node.offsetHeight);
  await page.locator("#ol-window").click();
  await page.locator('#ol-window-menu [data-window="24h"]').click();
  await expect(page.locator("#ol-loading")).toBeHidden();
  expect(await page.locator("#ol-loading").evaluate(node => node.offsetHeight)).toBe(0);
  await expect.poll(async () => (await page.locator("#ol-canvas").boundingBox()).y).toBe(before.y - statusHeight);
  for (let step = 0; step < 3; step++) await grip.press("ArrowUp");
  await expect.poll(async () => (await page.locator("#ol-canvas").boundingBox()).height).toBe(before.height);
  const chart = await page.locator(".ol-chart").boundingBox(), status = await page.locator(".ol-status").boundingBox();
  expect(status.y + status.height).toBeLessThanOrEqual(chart.y + chart.height);
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

test("a status-only resize cannot oscillate Auto between a cached coarse tile and a failed fine tile", async ({ page, fakeFor, allowConsole }) => {
  const fake = await fakeFor("standard", { next: 300 });
  allowConsole(/Failed to load resource/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1500, height: 600 });
  const time = "t=2026-05-28T00:00Z~2026-09-24T00:00Z";
  await page.goto(fake.url + "/#" + time + "&p=22000~27000&r=11,1&vis=2");
  await page.waitForFunction(() => window.cubeAgent);
  await expect(page.locator("#ol-loading")).toBeHidden();
  await fake.idle({ quietMs: 300 });
  expect(fake.log().some(entry => entry.path === "/cube/tile" && entry.query.m === "1" && entry.status === 200)).toBe(true);
  const canvasHeight = (await page.locator("#ol-canvas").boundingBox()).height, height = 600 + 252 - canvasHeight;
  const heatmapHeight = async viewportHeight => {
    await page.setViewportSize({ width: 1500, height: viewportHeight });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.locator("#ol-canvas").evaluate(node => Number(node.dataset.layout.split(",")[3]));
  };
  const idle = await heatmapHeight(height), active = await heatmapHeight(height - 32);
  await heatmapHeight(height);
  expect(idle / active, "the 32px status row straddles Auto's 8/18px hysteresis").toBeGreaterThan(9 / 8);
  const basePrice = await page.locator("#origo-lens-data").evaluate(node => JSON.parse(node.textContent).base_price),
    span = basePrice * (active / 8 + idle / 9) / 2;
  await page.evaluate(hash => { location.hash = hash; }, `#${time}&p=${(25000 - span / 2).toFixed(2)}~${(25000 + span / 2).toFixed(2)}&r=11,1&vis=2`);
  await expect(page.locator("#ol-loading")).toBeHidden();
  await fake.idle({ quietMs: 300 });
  fake.on({ route: "/cube/tile", when: query => query.n === "11" && query.m === "0" }).fail({ status: 503 });
  await page.locator("#ol-res").click();
  await page.locator("#ol-auto").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-loading")).toContainText("unavailable");
  const frames = await page.evaluate(() => new Promise(resolve => {
    const frames = [];
    function sample() {
      frames.push([document.getElementById("ol-m").textContent, document.getElementById("ol-loading").hidden]);
      if (frames.length === 90) resolve(frames); else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  expect([...new Set(frames.map(frame => JSON.stringify(frame)))]).toEqual([JSON.stringify(["m 0", false])]);
  expect(fake.log().filter(entry => entry.path === "/cube/tile" && entry.query.m === "0" && entry.status === 503)).toHaveLength(1);
});

for (const operation of ["create", "endpoint", "cancel"]) test(`a completing read preserves an active drawing ${operation} gesture`, async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini", { next: 300 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await D.open(page, fake);
  await page.waitForFunction(() => window.cubeAgent);
  await fake.idle({ quietMs: 300 });
  const made = operation === "endpoint" ? await D.drawing(page) : null;
  await D.trend(page);
  const gate = fake.on({ route: "/cube/tile", when: query => query.n === "3" && query.m === "0" }).gate();
  try {
    await page.evaluate(() => { const query = new URLSearchParams(location.hash.slice(1)); query.set("r", "3,0"); location.hash = query.toString(); });
    await gate.arrived();
    await expect(page.locator("#ol-loading")).toBeVisible();
    await D.trend(page);
    const plot = await D.plot(page), a = D.point(plot, .25, .75), b = D.point(plot, ...(operation === "endpoint" ? [.3125, .6875] : [.75, .25]));
    const before = await page.locator("#ol-canvas").boundingBox(), revision = await page.locator("#ol-canvas").getAttribute("data-drawing-revision");
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 });
    gate.open();
    await expect(page.locator("#ol-loading")).toHaveText("Ready");
    expect(await page.locator("#ol-canvas").boundingBox(), "read completion cannot resize the held drawing surface").toEqual(before);
    expect(await page.locator("#ol-canvas").getAttribute("data-drawing-revision")).toBe(revision);
    if (operation === "cancel") await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("#ol-loading")).toBeHidden();
    expect(await page.locator("#ol-loading").evaluate(node => node.offsetHeight)).toBe(0);
    await expect.poll(() => D.count(page)).toBe(operation === "cancel" ? 0 : 1);
    if (operation !== "cancel") {
      const row = await D.row(page, made?.id ?? await D.active(page));
      expect(row.a).toEqual(D.expected(operation === "endpoint" ? .3125 : .25, operation === "endpoint" ? .6875 : .75));
      expect(row.b).toEqual(D.expected(.75, .25));
    }
  } finally { gate.open(); await page.mouse.up(); }
});
