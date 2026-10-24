/* Optional page-owned measurements. No prototype patches, requests, or work while stopped. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const LIMITS = Object.freeze({ events: 10000, milliseconds: 120000, bytes: 2097152 });
  const DEFINITIONS = Object.freeze({
    clock: "performance.now() milliseconds relative to performance.timeOrigin; browser entries use the same origin",
    acknowledgment: "Zero-delay task after input dispatch; records post-handler requested state including task-queue delay, not a verified paint",
    draw: "Application draw() entry to completed canvas/DOM submission; includes CPU work, excludes compositor presentation. Attribution deferred until acknowledgment retains its original at timestamp",
    presentation: "Two consecutive sampled animation frames with no relevant scope motion/busy state; chart scope additionally requires a completed requested draw or explicit terminal result",
    frames: "Native requestAnimationFrame intervals while recording, including the recorder's own overhead; hidden intervals are labelled",
    resources: "Browser ResourceTiming/NavigationTiming; cross-origin fields can be zero without Timing-Allow-Origin",
    eventTiming: "Raw EventTiming entries: threshold 16ms, durations rounded to 8ms, no wheel/pointermove coverage. Missing entries do not establish fast input; not INP or async completion",
    nativePaint: "Feature-detected paintTime/presentationTime on native paint/long-animation-frame entries; engine-reported frame data, not a physical-display certificate or requested-grid completion",
    phases: "Async wall-clock spans include yields/waits and can overlap; do not sum them as CPU time",
    relatedBudgets: "See navigation.v4.json draw/frame/input keys; these differently scoped side-panel diagnostics do not score that benchmark's environment or acceptance",
    unavailable: ["physical presentation certificate", "INP", "LCP", "CPU/GPU profile", "retained heap/GC certificate", "cache-cold certificate"],
    overhead: "Opt-in observer, frame sampling and export overhead are included. No acceptance budgets are changed."
  });
  function readiness(state) {
    if (state.applicable === false) return "not-applicable";
    if (!state.rendered) return state.error ? "terminal-unavailable" : "pending-data";
    if (state.error) return "terminal-fallback";
    if (state.requested.intent !== state.rendered.intent) return "pending-data";
    if (state.refinement) return "pending-refinement";
    const target = state.target ?? state.requested,
      gap = target.n !== state.rendered.n || target.m !== state.rendered.m;
    if (gap && state.fallbackReason) return "terminal-fallback";
    if (state.pending || state.requested.pendingAction || state.movement?.updating || state.movement?.state === "pending") return gap ? "coarse-loaded" : "pending-data";
    return gap ? "stalled" : "target-output-submitted";
  }
  function create({ now, setTimer, clearTimer, changed = () => {}, limits = LIMITS }) {
    limits = { ...LIMITS, ...limits };
    let active = false, session = 0, serial = 0, timer, report = null, dispatching = null, lastReadiness = null, bytes = 0;
    const size = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const pending = new Map();
    function stop(reason = "user") {
      if (!active) return;
      active = false; clearTimer(timer);
      report.ended = now(); report.stopReason = reason;
      report.truncated = ["event-limit", "time-limit", "byte-limit"].includes(reason);
      report.unfinishedInteractions = [...pending.values()].map(p => p.id);
      report.unfinishedState = "ended-incomplete";
      pending.clear(); dispatching = null; changed();
    }
    function mark(type, detail = {}) {
      if (!active) return;
      if (now() - report.started >= limits.milliseconds) { stop("time-limit"); return; }
      if (report.events.length >= limits.events) { stop("event-limit"); return; }
      const event = { type, at: now(), ...detail }, length = size(event) + 1,
        reserve = 1024 + (pending.size + 1) * (String(limits.events).length + 1);
      if (bytes + length + reserve > limits.bytes) { stop("byte-limit"); return; }
      report.events.push(event); bytes += length;
    }
    function start(identity) {
      stop("restarted"); pending.clear(); session++; serial = 0; active = true;
      lastReadiness = null;
      report = { schema: "cube-performance@2", identity, limits: { ...limits }, definitions: DEFINITIONS, started: now(), truncated: false, events: [] };
      bytes = size(report);
      if (bytes + 1024 > limits.bytes) {
        report.identity = { omitted: "identity exceeded recording byte limit" };
        stop("byte-limit"); return;
      }
      timer = setTimer(() => stop("time-limit"), limits.milliseconds);
      mark("recording-start"); changed();
    }
    function phase(name, identity = {}) {
      if (!active) return () => {};
      const owned = session, id = ++serial, start = now();
      mark("phase-start", { id, name, identity });
      let ended = false;
      return (outcome = "completed") => {
        if (ended || !active || session !== owned) return;
        ended = true; mark("phase-end", { id, name, outcome, duration: now() - start });
      };
    }
    function input(scope, detail) {
      if (!active) return null;
      const owner = detail.owner ?? scope, previous = pending.get(owner);
      if (previous) mark("interaction-superseded", { id: previous.id });
      if (!active) return null;
      const p = { id: ++serial, session, scope, owner, expectsRequest: Boolean(detail.expectsRequest), inputAt: now(), quiet: 0 };
      mark("input", { id: p.id, scope, ...detail });
      if (!active) return null;
      pending.set(owner, p); return p;
    }
    const owns = p => active && p && p.session === session && pending.get(p.owner) === p;
    const chartScope = p => ["ol-canvas", "ol-evidence", "ol-context"].includes(p.scope);
    function owner() {
      return dispatching?.event.eventPhase && owns(dispatching.p) && chartScope(dispatching.p) ? dispatching.p : null;
    }
    function dispatch(p, event) { if (owns(p)) dispatching = { p, event }; }
    function beginAction(name) {
      const p = owner();
      if (!p) return null;
      p.pendingAction = true; mark("action-start", { id: p.id, name }); return p;
    }
    function endAction(p, applied) {
      if (!owns(p)) return;
      p.pendingAction = false;
      mark("action-end", { id: p.id, applied });
      if (!applied) { mark("interaction-rejected", { id: p.id }); pending.delete(p.owner); }
    }
    function supersede(p, reason) {
      if (!owns(p)) return;
      mark("interaction-superseded", { id: p.id, reason }); pending.delete(p.owner);
    }
    function request(requested, cause = owner()) {
      if (!active) return;
      if (!owns(cause) || !chartScope(cause)) cause = null;
      mark("request", { id: cause?.id ?? null, requested });
      for (const p of pending.values()) {
        if (!chartScope(p)) continue;
        if (p === cause) {
          p.boundRequested = requested;
          if (p.requested) p.requested = requested;
        } else {
          const expected = p.requested ?? p.boundRequested;
          if (expected && expected.intent !== requested.intent) supersede(p, "requested intent replaced");
        }
      }
    }
    function acknowledge(p, requested, presentation = null) {
      if (!owns(p)) return;
      p.presentation = presentation;
      p.requested = p.boundRequested ?? requested;
      mark("acknowledgment", { id: p.id, duration: now() - p.inputAt, requested: p.requested, presentation });
      if (p.expectsRequest && !p.boundRequested && !p.pendingAction) {
        mark("interaction-no-request", { id: p.id }); pending.delete(p.owner); return;
      }
      const early = p.earlyDraws ?? []; delete p.earlyDraws;
      for (const draw of early) attributeDraw(p, draw);
    }
    function attributeDraw(p, { state, status, at }) {
      if (!owns(p) || !p.requested || p.requested.intent !== state.requested.intent) return;
      if (!p.drawn) { p.drawn = true; mark("interaction-draw", { at, id: p.id, duration: at - p.inputAt, status }); }
      if (!p.ready && !p.pendingAction && ["target-output-submitted", "terminal-fallback", "terminal-unavailable"].includes(status)) {
        p.ready = true; mark("interaction-data-ready", { at, id: p.id, duration: at - p.inputAt, status });
      }
    }
    function draw(state, duration) {
      if (!active) return;
      const status = readiness(state);
      mark("draw", { duration, status, ...state });
      for (const p of pending.values()) {
        if (p.scope !== "ol-canvas") continue;
        const draw = { state, status, at: now() };
        // Only the current canvas owner retains references, bounded by the
        // recording's event limit. A frame may precede the acknowledgment task.
        if (!p.requested) (p.earlyDraws ??= []).push(draw);
        else attributeDraw(p, draw);
      }
    }
    function frame({ interval, hidden, scopes, chart }) {
      if (!active) return;
      mark("frame", { interval, hidden });
      const readinessKey = chart && chart.requested.intent + ":" + readiness(chart);
      if (readinessKey && readinessKey !== lastReadiness) { availability(chart); lastReadiness = readinessKey; }
      for (const p of pending.values()) {
        if (!p.requested) continue;
        const state = scopes(p.scope, p.presentation), relevantChart = p.scope === "ol-canvas";
        if (state.unavailable) {
          mark("interaction-unavailable", { id: p.id, scope: p.scope, reason: "scope closed or removed before completion" });
          pending.delete(p.owner); continue;
        }
        const current = !relevantChart || chart && chart.requested.intent === p.requested.intent;
        if (!current) { supersede(p, "requested intent replaced"); continue; }
        const status = relevantChart && chart ? readiness(chart) : p.presentation?.open === false && state.closed ? "scope-closed" : "scope-submitted";
        if (status === "not-applicable") { mark("interaction-not-applicable", { id: p.id }); pending.delete(p.owner); continue; }
        const terminal = ["target-output-submitted", "terminal-fallback", "terminal-unavailable"].includes(status),
          failed = ["terminal-fallback", "terminal-unavailable"].includes(status);
        if (relevantChart && terminal && p.drawn && !p.ready) attributeDraw(p, { state: chart, status, at: now() });
        const matches = !p.presentation || (p.presentation.open ? !state.closed : state.closed);
        const quiet = !hidden && matches && !p.pendingAction && !state.moving && (!state.busy || failed) && (!relevantChart || terminal);
        p.quiet = quiet ? p.quiet + 1 : 0;
        if (p.quiet < 2) continue;
        mark("presentation-proxy", { id: p.id, scope: p.scope, duration: now() - p.inputAt, status });
        pending.delete(p.owner);
      }
    }
    function availability(state) { if (active) mark("readiness", { status: readiness(state), ...state }); }
    return Object.freeze({ start, stop, mark, phase, input, acknowledge, draw, frame, owner, owns, dispatch, request, beginAction, endAction, availability,
      get active() { return active; }, get session() { return session; }, export: () => report && JSON.parse(JSON.stringify(report)) });
  }
  function timing(entry) {
    const out = { entryType: entry.entryType, name: entry.name, startTime: entry.startTime, duration: entry.duration };
    const path = value => { try { return new URL(value).pathname; } catch { return "inline-or-unknown"; } };
    if (["resource", "navigation"].includes(entry.entryType)) {
      out.name = path(entry.name);
      for (const key of ["initiatorType", "fetchStart", "domainLookupStart", "domainLookupEnd", "connectStart", "connectEnd", "requestStart", "responseStart", "responseEnd", "transferSize", "encodedBodySize", "decodedBodySize"]) out[key] = entry[key];
    }
    if (entry.entryType === "event") for (const key of ["processingStart", "processingEnd", "interactionId", "cancelable"]) out[key] = entry[key];
    if (["paint", "long-animation-frame"].includes(entry.entryType)) {
      out.fieldSupport = {};
      for (const key of ["paintTime", "presentationTime", "blockingDuration", "renderStart", "styleAndLayoutStart", "firstUIEventTimestamp"]) {
        out.fieldSupport[key] = key in entry;
        out[key] = key in entry ? entry[key] ?? null : null;
      }
    }
    if (entry.entryType === "long-animation-frame") {
      out.scripts = [...(entry.scripts ?? [])].slice(0, 16).map(script => {
        const item = { sourcePath: path(script.sourceURL) };
        for (const key of ["startTime", "duration", "executionStart", "forcedStyleAndLayoutDuration", "pauseDuration", "sourceFunctionName", "sourceCharPosition", "invokerType", "windowAttribution"]) {
          if (key in script) item[key] = typeof script[key] === "string" ? script[key].slice(0, 128) : script[key];
        }
        return item;
      });
      out.omittedScripts = Math.max(0, (entry.scripts?.length ?? 0) - 16);
    }
    return out;
  }
  function mount({ root, requested, snapshot, identity, download, reset = () => {} }) {
    const el = id => root.querySelector("#ol-diagnostics-" + id);
    const ignored = node => Boolean(node?.closest?.('#ol-diagnostics,#ol-help-tooltip,#ol-tip,[role="tooltip"]'));
    const inputs = ["click", "change", "submit", "keydown", "wheel", "pointerdown", "pointermove"], acknowledgments = new Set();
    let raf = 0, lastFrame = null, observers = [], generation = 0, crossedHidden = false, listening = false;
    const recorder = create({ now: () => performance.now(), setTimer: setTimeout, clearTimer: clearTimeout, changed: refresh });
    function refresh() {
      if (!recorder.active) {
        generation++;
        cancelAnimationFrame(raf); raf = 0;
        for (const observer of observers) observer.disconnect();
        observers = [];
        for (const timer of acknowledgments) clearTimeout(timer);
        acknowledgments.clear();
        if (listening) {
          for (const type of inputs) root.removeEventListener(type, capture, true);
          root.removeEventListener("comparison-render", comparison);
          document.removeEventListener("visibilitychange", visibility);
          listening = false;
        }
      }
      el("status").textContent = recorder.active ? "Recording · stops after two minutes, 10,000 events or 2 MiB" : "Stopped · recording stays in this page until replaced or reloaded";
    }
    function scopeState(id, presentation) {
      const node = document.getElementById(id);
      const closed = !node || !node.getClientRects().length || Boolean(node.closest("[hidden],[inert]") && !node.closest("[data-flow-retained]"));
      if (closed && presentation?.open !== false) return { unavailable: true, closed };
      const ancestors = id === "ol-side-body" ? [document.getElementById("ol-main")] : id === "ol-drawer-body" ? [document.getElementById("ol-drawer")] : [],
        controller = presentation?.controller && document.getElementById(presentation.controller),
        nodes = node ? [node, ...node.querySelectorAll("[data-motion-running]")] : [],
        moving = [...nodes, ...ancestors].some(n => n?.hasAttribute("data-motion-running") && !ignored(n)) ||
          [node, controller].some(n => n?.getAnimations?.({ subtree: true }).some(a => (a.playState === "running" || a.pending) && !ignored(a.effect?.target ?? n)));
      // Opening a panel is independent of optional work inside it. Study/table
      // controls use their own scope and retain their own busy contract.
      const busy = !["ol-controls", "ol-drawer-body", "ol-side-body", "ol-reference"].includes(id) &&
        (node ? [node, ...node.querySelectorAll('[aria-busy="true"]')] : []).some(n => n.getAttribute("aria-busy") === "true" && !ignored(n));
      return { moving, busy, closed };
    }
    function presentation(scope, target) {
      const node = document.getElementById(scope);
      if (scope === "ol-drawer-body") return { open: document.getElementById("ol-drawer").dataset.open === "true", controller: target.id };
      if (scope === "ol-side-body") return { open: document.getElementById("ol-main").dataset.side === "open", controller: "ol-side-toggle" };
      if (scope === "ol-controls") return { open: !matchMedia("(max-width:760px)").matches || root.dataset.sheet === "open", controller: "ol-sheet-toggle" };
      if (scope === "ol-reference") return { open: !node.hidden, controller: target.id };
      if (node?.tagName === "DIALOG") return { open: node.open, controller: target.id };
      if (node?.classList.contains("ol-pop")) return { open: !node.hidden && !node.inert, controller: target.id };
      return null;
    }
    function tick(time, owned) {
      if (!recorder.active || generation !== owned) return;
      recorder.frame({ interval: lastFrame === null ? null : time - lastFrame, hidden: document.hidden || crossedHidden, scopes: scopeState, chart: snapshot() });
      crossedHidden = document.hidden;
      lastFrame = time;
      if (recorder.active) raf = requestAnimationFrame(time => tick(time, owned));
    }
    function drain() {
      for (const observer of [...observers]) for (const entry of observer.takeRecords?.() ?? []) recorder.mark("browser-timing", timing(entry));
    }
    function start() {
      const supported = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
      reset();
      recorder.start({ ...identity(), browser: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, supportedEntryTypes: supported,
        interactivityInert: globalThis.CSS?.supports?.("interactivity", "inert") ?? false } });
      if (!recorder.active) return;
      for (const type of inputs) root.addEventListener(type, capture, { capture: true, passive: true });
      root.addEventListener("comparison-render", comparison); document.addEventListener("visibilitychange", visibility); listening = true;
      const owned = ++generation;
      for (const entry of performance.getEntriesByType("navigation")) recorder.mark("browser-timing", timing(entry));
      for (const type of ["resource", "longtask", "long-animation-frame", "event", "paint"]) {
        if (!recorder.active) break;
        if (!supported.includes(type)) { recorder.mark("metric-unavailable", { metric: type, reason: "entry type unsupported" }); continue; }
        try {
          const observer = new PerformanceObserver(list => {
            if (generation === owned && recorder.active) for (const entry of list.getEntries()) recorder.mark("browser-timing", timing(entry));
          });
          observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) }); observers.push(observer);
        } catch { recorder.mark("metric-unavailable", { metric: type, reason: "observer registration failed" }); }
      }
      lastFrame = null; crossedHidden = document.hidden;
      if (recorder.active) raf = requestAnimationFrame(time => tick(time, owned));
    }
    function capture(event) {
      if (!recorder.active || !(event.target instanceof Element) || ignored(event.target)) return;
      if (event.type === "pointermove" && !event.buttons) return;
      const target = event.target.closest("button,input,select,summary,a,canvas") ?? event.target;
      const controlled = target.getAttribute("aria-controls"), drawer = target.hasAttribute("data-drawer");
      const key = event.type === "keydown" ? (event.key ?? "").toLowerCase() : "";
      const escapeScope = key === "escape" ? target.closest("dialog[open],.ol-pop") ?? root.querySelector("dialog[open]") ?? [...root.querySelectorAll(".ol-pop")].find(n => !n.hidden && !n.inert && !ignored(n)) : null;
      const bounds = target.closest("#ol-bounds-form"), appliesBounds = bounds &&
        (event.type === "submit" || target.matches('button[type="submit"]') || key === "enter");
      const studyScope = target.id === "ol-evidence-tab" ? "ol-evidence" : target.id === "ol-context-tab" ? "ol-context" :
        target.id === "ol-canvas" && key === "c" ? root.querySelector("#ol-evidence-tab").getAttribute("aria-pressed") === "true" ? "ol-context" : "ol-evidence" : null;
      const closeScope = target.id === "ol-sheet-close" ? "ol-controls" : target.id === "ol-reference-close" ? "ol-reference" :
        target.id === "ol-keys-close" ? "ol-keys" : null;
      const explicit = closeScope ?? escapeScope?.id ?? (key === "escape" && root.dataset.sheet === "open" ? "ol-controls" : null) ??
        (appliesBounds || target.id === "ol-import-apply" ? "ol-canvas" : studyScope ?? (drawer || target.id === "ol-canvas" && key === "t" ? "ol-drawer-body" :
        target.id === "ol-canvas" && key === "i" ? "ol-side-body" : controlled && document.getElementById(controlled) ? controlled : null));
      const container = target.closest("#ol-comparisonWorkspace,#ol-evidence,.ol-panel,#ol-controls,#ol-side-body");
      const scope = explicit ?? (container && container.id !== "ol-controls" ? container.id : "ol-canvas");
      const p = recorder.input(scope, { owner: ["ol-evidence", "ol-context"].includes(scope) ? "inspector-content" : scope,
        expectsRequest: scope === "ol-canvas", event: event.type, target: target.id || target.tagName.toLowerCase(), trusted: event.isTrusted, eventTime: event.timeStamp });
      recorder.dispatch(p, event);
      // Native dispatch may checkpoint microtasks between capture and bubble
      // listeners. A task observes the application handlers after dispatch.
      if (p) {
        const timer = setTimeout(() => {
          acknowledgments.delete(timer);
          if (recorder.active) recorder.acknowledge(p, requested(), presentation(scope, target));
        }, 0);
        acknowledgments.add(timer);
      }
    }
    function visibility() {
      if (!recorder.active) return;
      crossedHidden ||= document.hidden;
      recorder.mark("visibility", { hidden: document.hidden });
    }
    function comparison(event) {
      if (recorder.active) recorder.mark("comparison-render", { revision: event.detail.revision });
    }
    el("start").addEventListener("click", start);
    el("stop").addEventListener("click", () => { drain(); recorder.stop(); });
    el("export").addEventListener("click", () => {
      drain(); recorder.stop("export");
      const data = recorder.export();
      if (!data) { el("status").textContent = "Start a recording first"; return; }
      const text = JSON.stringify(data);
      el("output").value = text; el("output").hidden = false;
      download("cube-performance.json", text, "application/json");
    });
    const armKey = "cube-performance-record-next-load";
    el("reload").addEventListener("click", () => {
      try { sessionStorage.setItem(armKey, "1"); location.reload(); }
      catch { el("status").textContent = "Reload recording unavailable: session storage is disabled"; }
    });
    refresh();
    try { if (sessionStorage.getItem(armKey) === "1") { sessionStorage.removeItem(armKey); start(); } } catch { /* Optional one-shot reload recording. */ }
    return recorder;
  }
  return Object.freeze({ LIMITS, DEFINITIONS, readiness, timing, create, mount });
});
