"use strict";
// #206: independent hand sums and actual partial support, including delayed and failed reads.
const { test, expect } = require("./fixtures.js");
const fixture = require("../fixtures/regressions/clipped-capture-support/cases.json");
const EPOCH = 1609459200000, BASE = 56250;
const iso = c => new Date(EPOCH + c * BASE).toISOString();
const metric = (capture, name) => capture.metrics[name + ".amount"].value;

for (const phase of ["pending", "failed"]) for (const sample of fixture.cases) {
  test(`${phase} ${sample.name} boundary never exports whole-cell counters as a partial capture`, async ({ page, fakeFor, probe, allowConsole, freshContext }) => {
    const fake = await fakeFor({ cutoffIso: iso(fixture.cutoffBase), trades: fixture.trades.map(({base, offsetMs, ...trade}) => ({...trade, t_ms:base * BASE + offsetMs})) });
    const gate = fake.on({route:"/cube/query", times:1}).gate();
    const [a,b,low,high] = sample.bounds;
    const view = `#t=${iso(0)}~${iso(8192)}&p=24000~27000&r=12,3&auto=0&vis=2&lines=&sel=${iso(a)}~${iso(b)},${low*125}~${high*125}`;
    await page.goto(fake.url + "/" + view);
    await gate.arrived();
    await expect(page.locator("#ol-focus-title")).toHaveText("Measuring…");
    if (phase === "failed") {
      allowConsole(/Failed to load resource/);
      gate.fail(502, {error:"exact_rectangle_unavailable"});
      await expect(page.locator("#ol-focus-title")).toHaveText("Not measured");
    }
    const waiting = await page.evaluate(() => window.cubeAgent.export("selection"));
    expect(waiting.selection.state).toBe(phase);
    expect(waiting.comparison.captures).toEqual([]);
    await page.locator("#ol-tab-cells").click();
    await expect(page.locator("#ol-table-body").getByRole("button", {name:"Add to comparison", exact:true})).toHaveCount(0);
    // The human Copy selection route shares the same exporter and portable validation.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {configurable:true,value:{writeText:async text=>{window.copiedSelection=text;}}}));
    await page.locator("#ol-tab-query").click();
    await page.locator("#ol-copy-selection").click();
    await expect.poll(() => page.evaluate(() => Boolean(window.copiedSelection))).toBe(true);
    expect(await page.evaluate(() => window.explorerAgent.parse(window.copiedSelection).comparison.captures)).toEqual([]);

    if (phase === "failed") await page.reload(); else gate.open();
    await probe.waitForReady();
    const measured = await page.evaluate(() => window.cubeAgent.export("selection"));
    expect(measured.comparison.captures).toHaveLength(1);
    const capture = measured.comparison.captures[0];
    expect(metric(capture,"volume")).toBe(sample.volume);
    expect(metric(capture,"delta")).toBe(sample.delta);
    expect(metric(capture,"trades")).toBe(sample.trades);
    expect(capture.observed).toEqual({t0:EPOCH+a*BASE,t1:EPOCH+b*BASE,low:low*125,high:high*125,seconds:(b-a)*56.25,width:(high-low)*125});
    expect(capture.metrics["volume.intensity"].value).toBe(sample.volume / ((b-a)*56.25/60*(high-low)));
    expect(await page.evaluate(doc => window.explorerAgent.parse(window.explorerAgent.text(doc)).comparison.captures, measured)).toEqual(measured.comparison.captures);
    if (phase === "pending" && sample.name === "time and price") {
      const context = await freshContext(), other = await context.newPage();
      await other.goto(fake.url + "/#w=24h&lines=");
      await expect.poll(() => other.evaluate(() => typeof window.cubeAgent?.apply)).toBe("function");
      await other.evaluate(doc => window.cubeAgent.apply(doc), measured);
      await expect(other.locator("#ol-analysis-status")).toContainText("Captured evidence");
      expect((await other.evaluate(() => window.cubeAgent.export("comparison"))).comparison.captures).toEqual(measured.comparison.captures);
    }
  });
}
