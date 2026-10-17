// Local paired diagnostics for delegated help. Fixed before measurements: 8 A/B
// pairs, alternating order, 2,000 targets and 12 navigation actions per page.
// Bounds are incremental (0.25 ms/target and 8 ms/action), not a claim of zero
// overhead or a designated-machine navigation certificate.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const { materialise } = require("../tests/support/builds.js");
const { startFake } = require("../tests/support/cube-fake.js");
const root = path.resolve(import.meta.dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const baseline = process.argv[2];
if (!/^[0-9a-f]{7,40}$/.test(baseline || "")) throw new Error("Pass the pinned pre-change baseline commit.");
if (git("status", "--porcelain")) throw new Error("Publish the working tree before benchmarking.");
const candidate = git("rev-parse", "HEAD");
const builds = { baseline: materialise(baseline, "tooltip-baseline"), candidate: materialise(candidate, "tooltip-candidate") };
const servers = {};
const browser = await chromium.launch({ headless: true });
const samples = [];
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; };
try {
  for (const kind of ["baseline", "candidate"]) servers[kind] = await startFake({ profile: "mini", port: 0, host: "127.0.0.1", pageRoot: builds[kind].dir });
  // Warm both exact builds and the fixture outside measured pairs.
  for (const kind of ["baseline", "candidate"]) {
    const page = await browser.newPage(); await page.goto(servers[kind].url); await page.locator("#ol-canvas[data-layout]").waitFor({ state: "attached" }); await page.close();
  }
  for (let pair = 0; pair < 8; pair++) {
    for (const kind of pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(servers[kind].url + "/#w=24h&vis=2");
      await page.locator("#ol-canvas[data-layout]").waitFor({ state: "attached" });
      await servers[kind].idle({ quietMs: 200, timeoutMs: 30000 });
      const result = await page.evaluate(async () => {
        const root = document.querySelector("#origo-lens"), host = document.createElement("div"), fragment = document.createDocumentFragment();
        // Fixed offscreen DOM keeps chart geometry unchanged; real target routing
        // still runs, and no description is read before the delay.
        host.style.cssText = "position:fixed;left:-10000px;top:0";
        let registrations = 0;
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (...args) { registrations++; return add.apply(this, args); };
        for (let i = 0; i < 2000; i++) { const node = document.createElement("span"); node.dataset.field = "volume"; node.textContent = "10"; fragment.append(node); }
        host.append(fragment); root.append(host);
        const times = [];
        for (const node of host.children) {
          const event = new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" });
          const start = performance.now(); node.dispatchEvent(event); times.push(performance.now() - start);
        }
        host.lastElementChild.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
        host.remove(); EventTarget.prototype.addEventListener = add;
        const canvas = document.querySelector("#ol-canvas"), rect = canvas.getBoundingClientRect(), actions = [];
        const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await paint();
        for (let i = 0; i < 12; i++) {
          const start = performance.now();
          canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: rect.x + rect.width * .5, clientY: rect.y + rect.height * .5, deltaY: i % 2 ? -30 : 30 }));
          await paint(); actions.push(performance.now() - start);
        }
        return { times, actions, registrations, bubbles: root.querySelectorAll('.ol-hint').length };
      });
      samples.push({ pair, kind, hoverP95Ms: percentile(result.times, .95), actionP95Ms: percentile(result.actions, .95), addedTargetListeners: result.registrations, tooltipNodes: result.bubbles });
      console.log(JSON.stringify(samples.at(-1)));
      await context.close();
    }
  }
  const differences = samples.filter(s => s.kind === "candidate").map(c => { const b = samples.find(s => s.kind === "baseline" && s.pair === c.pair); return { hoverP95Ms: c.hoverP95Ms - b.hoverP95Ms, actionP95Ms: c.actionP95Ms - b.actionP95Ms }; });
  const hoverDelta = percentile(differences.map(d => d.hoverP95Ms), .5), actionDelta = percentile(differences.map(d => d.actionP95Ms), .5);
  const passed = hoverDelta <= .25 && actionDelta <= 8 && samples.every(s => s.addedTargetListeners === 0 && s.tooltipNodes <= 1);
  const report = { baseline: builds.baseline, candidate: builds.candidate, browser: browser.version(), environment: "local headless Chromium; diagnostic only", protocol: { pairs: 8, targets: 2000, actionsPerPage: 12, order: "alternating AB/BA", maxMedianPairedHoverP95DeltaMs: .25, maxMedianPairedActionP95DeltaMs: 8 }, samples, medianPairedHoverP95DeltaMs: hoverDelta, medianPairedActionP95DeltaMs: actionDelta, verdict: passed ? "no material regression detected within declared local diagnostic bounds" : "blocking local diagnostic regression" };
  const out = path.join(root, "reports", "tooltip-performance.json"); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, hoverDelta, actionDelta, report: out }));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close(); for (const server of Object.values(servers)) await server.close();
}
