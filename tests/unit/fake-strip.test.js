"use strict";
// The fake cube's synthetic Strip at /cube/strip (tests/support/strip.js), over real HTTP. Oracles: the bridge's own check of the
// contract (tools/strip_relay.py `check`, run in Python on every answer), the bridge's refusals copied as literals from
// tests/unit/strip-relay.test.js, the profile's trades scanned in order here for the closes, docs/strip.md's known-at rules, and the
// declaration the bridge writes into the page (tools/strip_relay.py DECLARATION, as a literal).
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { startFake } = require("../support/cube-fake.js");
const { resolveProfile, EPOCH_MS } = require("../support/profiles.js");

const DECLARATION = '<meta name="explorer-strip" content="/cube/strip">';

const ROOT = path.resolve(__dirname, "..", ".."), GRID = 900000, HOUR = 3600000, DAY = 86400000;

// The bridge's verdict on an answer for a grid: "ok", or its error text.
function bridgeCheck(answer, from, to, step) {
  const script = "import json, sys; sys.path.insert(0, 'tools'); import strip_relay as s\n" +
    "d = json.load(sys.stdin)\ntry:\n    s.check(d['answer'], d['from'], d['to'], d['step']); print('ok')\nexcept ValueError as e:\n    print(e)";
  const run = spawnSync("python3", ["-c", script], { cwd: ROOT, input: JSON.stringify({ answer, from, to, step }), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

async function strip(fake, query) {
  const response = await fetch(`${fake.url}/cube/strip?proto=2&${query}`);
  return { status: response.status, body: await response.json() };
}

describe("the fake's synthetic strip", () => {
  let fake, profile, cutoff;
  before(async () => {
    fake = await startFake({ profile: "mini" });
    profile = resolveProfile("mini");
    // The fake's clock counts from 2021-01-01; the strip speaks epoch ms.
    cutoff = EPOCH_MS + profile.cutoffMs;
  });
  after(() => fake.close());

  it("answers every grid step with a cube-strip@1 the bridge passes, the same for the same seed", async () => {
    for (const step of [900000, 3600000, 21600000, 86400000]) {
      const to = Math.ceil(cutoff / step) * step + step, from = to - 40 * step;
      const a = await strip(fake, `from=${from}&to=${to}&step=${step}`), b = await strip(fake, `from=${from}&to=${to}&step=${step}`);
      assert.equal(a.status, 200);
      assert.equal(bridgeCheck(a.body, from, to, step), "ok");
      assert.deepEqual(a.body, b.body);
      assert.match(a.body.model, /SYNTHETIC/);
      assert.equal(a.body.cutoff, cutoff);
    }
  });

  it("reads its closes from the profile's own trades, and knows nothing after the cutoff", async () => {
    const step = GRID, to = Math.floor(cutoff / step) * step + 4 * step, from = to - 96 * step, { body } = await strip(fake, `from=${from}&to=${to}&step=${step}`);
    const { t, price } = profile.store;
    body.grid.close.forEach((close, k) => {
      const at = from + k * step;
      let last = null;
      for (let i = 0; i < t.length && EPOCH_MS + t[i] <= at; i++) last = price[i] / 100;
      assert.equal(close, at > cutoff ? null : last, `close at ${new Date(at).toISOString()}`);
      for (const force of ["macro", "positioning", "news", "social"]) if (at > cutoff) assert.equal(body.grid.forces[force][k], null);
      if (at + DAY > cutoff) assert.equal(body.grid.next24h[k], null);
    });
    assert.deepEqual(Object.keys(body.sources), ["macro", "positioning", "news", "social", "attention", "calendar", "history", "options"]);
    for (const e of body.events) {
      const last = e.schedule[e.schedule.length - 1].at;
      for (const s of e.schedule) assert.ok(s.knownAt <= cutoff && (s.at === null || s.knownAt <= s.at), `${e.id}'s schedule is known by the cutoff`);
      assert.ok(e.prior.at <= cutoff, `${e.id}'s prior is known by the cutoff`);
      for (const x of e.estimates) assert.ok(x.at <= cutoff && last !== null && x.at < last, `${e.id}'s estimates are made before it, by the cutoff`);
      if (e.measured) assert.ok(e.measured.from === last && e.measured.at === last + e.window * 60000 && e.measured.at <= cutoff, `${e.id} is measured once its window closed`);
      else assert.ok(last === null || last + e.window * 60000 > cutoff, `${e.id} is unmeasured only while its window is open, or once cancelled`);
    }
    // The events reach 90 days past the grid's end, for the horizon.
    assert.ok(body.events.some((e) => e.schedule.at(-1).at > cutoff + 30 * DAY));
    assert.ok(body.events.every((e) => e.schedule.some((s) => s.at !== null && s.at >= from - DAY && s.at < to + 90 * DAY)));
  });

  it("moves and cancels events as they were announced, estimates them as the options did, and counts a prior's releases", async () => {
    const standard = await startFake({ profile: "standard" });
    try {
      const at = EPOCH_MS + resolveProfile("standard").cutoffMs, to = Math.ceil(at / HOUR) * HOUR + HOUR, from = to - 400 * DAY;
      const { body } = await strip(standard, `from=${from}&to=${to}&step=${HOUR}`);
      assert.equal(bridgeCheck(body, from, to, HOUR), "ok");
      const moved = body.events.find((e) => e.kind === "cpi" && e.schedule.length === 2);
      assert.ok(moved, "a CPI was moved");
      const [first, then] = moved.schedule;
      assert.deepEqual([then.knownAt, then.at], [first.at - 3 * DAY, first.at + DAY]);
      const cancelled = body.events.find((e) => e.kind === "jobs" && e.schedule.at(-1).at === null);
      assert.ok(cancelled, "a Jobs release was cancelled");
      assert.deepEqual([cancelled.estimates, cancelled.measured], [[], null]);
      // Estimates come daily from 14 days before an event and every 6 hours in its last two days, in order.
      const priced = body.events.find((e) => e.measured && e.kind === "fomc"), gaps = priced.estimates.slice(1).map((x, k) => x.at - priced.estimates[k].at);
      assert.ok(priced.estimates.length >= 14 && gaps.every((g) => g === DAY || g === 6 * HOUR), `${priced.id}'s estimates`);
      // A prior counts the releases of its kind since the cube's history began: GDP's quarterly ones are fewer than 30.
      assert.ok(body.events.filter((e) => e.kind === "gdp").every((e) => e.prior.n < 30));
      assert.ok(body.events.filter((e) => e.kind === "fomc").every((e) => e.prior.n >= 30));
    } finally {
      await standard.close();
    }
  });

  it("declares the strip in its live page, as a bridge with STRIP_URL does, and not with strip off or in the recorded page", async () => {
    assert.ok((await (await fetch(`${fake.url}/`)).text()).includes(`<head>\n    ${DECLARATION}`));
    for (const opts of [{ profile: "mini", strip: "off" }, { mode: "recorded" }]) {
      const other = await startFake(opts);
      try {
        assert.ok(!(await (await fetch(`${other.url}/`)).text()).includes("explorer-strip"), JSON.stringify(opts));
      } finally {
        await other.close();
      }
    }
  });

  it("refuses a query in the bridge's words, and is unconfigured with strip off", async () => {
    const T0 = Math.floor(cutoff / GRID) * GRID;
    const refusals = await Promise.all(["from=x&to=1&step=900000", `from=${T0}&to=${T0 + GRID}&step=60000`, `from=${T0 + 1}&to=${T0 + GRID}&step=${GRID}`,
      `from=${T0}&to=${T0}&step=${GRID}`, `from=0&to=${20001 * GRID}&step=${GRID}`].map((q) => strip(fake, q)));
    assert.deepEqual(refusals.map((r) => [r.status, r.body.error, r.body.detail]), [
      [400, "invalid_strip_request", "from must be a whole number of milliseconds"],
      [400, "invalid_strip_request", "step must be 900000, 3600000, 21600000 or 86400000"],
      [400, "invalid_strip_request", "from must be a multiple of step"],
      [400, "invalid_strip_request", "to must be after from"],
      [400, "invalid_strip_request", "more than 20000 grid times"],
    ]);
    const off = await startFake({ profile: "mini", strip: "off" });
    try {
      assert.deepEqual(await strip(off, `from=${T0}&to=${T0 + HOUR}&step=${GRID}`), { status: 503, body: { error: "strip_not_configured" } });
    } finally {
      await off.close();
    }
  });

  it("takes a slot of its own, so it never overlaps a cube read", async () => {
    const T0 = Math.floor(cutoff / GRID) * GRID;
    await strip(fake, `from=${T0 - DAY}&to=${T0}&step=${GRID}`);
    const entry = fake.log().filter((e) => e.path === "/cube/strip").pop();
    assert.equal(entry.slot, "strip");
    assert.equal(entry.unexpected, null);
  });
});
