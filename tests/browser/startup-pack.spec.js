"use strict";
// Oracle: the independently held token/cutoff, a gated live poll, and the
// browser's painted chart. A delayed timer cannot stand in for immediate refresh.
const { test, expect } = require("./fixtures.js");

for (const reason of ["expired", "invalidated"]) {
  test(`${reason} initial pack paints while its immediate refresh is held`, async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini", { next: 300, quiet: 400 });
    const held = fake.currentPack();
    if (reason === "expired") fake.bridge.clock += 120;
    else fake.rebuild();
    const gate = fake.on({ route: "/cube/pack" }).gate();
    // The ordinary live timer has a three-second minimum. Keep that timer
    // from firing: only a direct post-paint poll can reach the gate.
    await page.addInitScript(() => {
      const later = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => later(callback, delay === 3000 ? 3600000 : delay, ...args);
    });
    try {
      await page.goto(fake.url + "/#w=24h");
      await expect(page.locator("#ol-loading")).toBeHidden();
      await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /\d/);
      await expect.poll(() => fake.log().filter(r => r.path === "/cube/pack").length).toBe(1);
      expect(gate.held).toBe(1);
      const initial = await page.locator("#origo-lens-data").evaluate(node => JSON.parse(node.textContent));
      expect(initial.state_token).toBe(held.state_token);
      expect(initial.cutoff).toBe(held.cutoff);
      expect(initial.next).toBe(1);
      await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "refreshing");
      await expect(page.locator("#ol-fresh")).toContainText("Refreshing snapshot");
      await expect(page).not.toHaveTitle(/not updating/);
      expect(fake.log().find(r => r.path === "/cube/pack").query.since).toBe(held.state_token);
      gate.open();
      await expect.poll(() => fake.log().find(r => r.path === "/cube/pack")?.status).toBe(200);
      // Only a successful current-cube check can declare that data has stalled.
      await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "stale");
      await expect(page.locator("#ol-fresh")).toContainText("no new data for");
      await expect(page.locator("#ol-loading")).toBeHidden();
    } finally {
      gate.open();
    }
  });
}

test("a failed initial refresh describes the snapshot and retry rather than claiming the cube stalled", async ({ page, fakeFor, allowConsole }) => {
  allowConsole(/Failed to load resource: the server responded with a status of 503/);
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  const fake = await fakeFor("mini", { next: 300, quiet: 400 });
  fake.currentPack(); fake.rebuild();
  fake.on({ route: "/cube/pack" }).fail({ status: 503, body: { error: "test refresh unavailable" } });
  await page.goto(fake.url + "/#w=24h");
  await expect(page.locator("#ol-loading")).toBeHidden();
  await expect(page.locator("#ol-fresh")).toHaveText("snapshot refresh failed; retrying");
  await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "refreshing");
  await expect(page).not.toHaveTitle(/not updating/);
  await page.clock.fastForward(46000);
  await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "stopped");
  await expect(page).toHaveTitle(/not updating/);
});
