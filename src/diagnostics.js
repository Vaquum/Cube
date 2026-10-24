/* Optional page-owned measurements. No prototype patches, requests, or work while stopped. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const LIMITS = Object.freeze({ events: 10000, milliseconds: 120000 });
  const DEFINITIONS = Object.freeze({
    clock: "performance.now() milliseconds relative to performance.timeOrigin; browser entries use the same origin",
    acknowledgment: "Zero-delay task after input dispatch; records post-handler requested state including task-queue delay, not a verified paint",
    draw: "Application draw() entry to completed canvas/DOM submission; includes CPU work, excludes compositor presentation",
    presentation: "Two consecutive sampled animation frames with no relevant scope motion/busy state; chart scope additionally requires a completed requested draw or explicit terminal result",
    frames: "Native requestAnimationFrame intervals while recording, including the recorder's own overhead; hidden intervals are labelled",
    resources: "Browser ResourceTiming/NavigationTiming; cross-origin fields can be zero without Timing-Allow-Origin",
    eventTiming: "Raw supported EventTiming entries, durationThreshold=16ms; incomplete population, not INP",
    unavailable: ["compositor presentation", "INP", "LCP", "CPU/GPU profile", "heap profile", "cache-cold certificate"],
    overhead: "Opt-in observer, frame sampling and export overhead are included. No acceptance budgets are changed."
  });
  function readiness(state) {
    if (!state.rendered) return state.error ? "terminal-unavailable" : "pending-data";
    if (state.requested.revision !== state.rendered.revision) return "pending-data";
    if (state.refinement) return "pending-refinement";
    if (state.pending || state.movement?.updating || state.movement?.state === "pending") return "pending-data";
    if (state.error) return "terminal-fallback";
    if (state.requested.n !== state.rendered.n || state.requested.m !== state.rendered.m) return "loaded-fallback";
    return "requested-output-submitted";
  }
  function create({ now, setTimer, clearTimer, changed = () => {}, limits = LIMITS }) {
    let active = false, session = 0, serial = 0, timer, report = null;
    const pending = new Map();
    function stop(reason = "user") {
      if (!active) return;
      active = false; clearTimer(timer);
      report.ended = now(); report.stopReason = reason;
      report.unfinishedInteractions = [...pending.values()].map(p => p.id);
      pending.clear(); changed();
    }
    function mark(type, detail = {}) {
      if (!active) return;
      if (now() - report.started >= limits.milliseconds) { stop("time-limit"); return; }
      if (report.events.length >= limits.events) { stop("event-limit"); return; }
      report.events.push({ type, at: now(), ...detail });
    }
    function start(identity) {
      stop("restarted"); session++; serial = 0; active = true;
      report = { schema: "cube-performance@1", identity, limits: { ...limits }, definitions: DEFINITIONS, started: now(), events: [] };
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
      const p = { id: ++serial, session, scope, owner, inputAt: now(), quiet: 0 };
      pending.set(owner, p); mark("input", { id: p.id, scope, ...detail }); return p;
    }
    const owns = p => active && p && p.session === session && pending.get(p.owner) === p;
    function acknowledge(p, requested) {
      if (!owns(p)) return;
      p.requested = requested;
      mark("acknowledgment", { id: p.id, duration: now() - p.inputAt, requested });
    }
    function draw(state, duration) {
      if (!active) return;
      const status = readiness(state);
      mark("draw", { duration, status, ...state });
      for (const p of pending.values()) {
        if (p.scope !== "ol-canvas" || !p.requested || p.requested.revision > state.requested.revision) continue;
        if (!p.drawn) { p.drawn = true; mark("interaction-draw", { id: p.id, duration: now() - p.inputAt, status }); }
        if (!p.ready && ["requested-output-submitted", "terminal-fallback", "terminal-unavailable"].includes(status)) {
          p.ready = true; mark("interaction-data-ready", { id: p.id, duration: now() - p.inputAt, status });
        }
      }
    }
    function frame({ interval, hidden, scopes, chart }) {
      if (!active) return;
      mark("frame", { interval, hidden });
      for (const p of pending.values()) {
        const state = scopes(p.scope), relevantChart = p.scope === "ol-canvas";
        if (state.unavailable) {
          mark("interaction-unavailable", { id: p.id, scope: p.scope, reason: "scope closed or removed before completion" });
          pending.delete(p.owner); continue;
        }
        const current = !relevantChart || chart && chart.requested.revision >= p.requested?.revision;
        const status = relevantChart && chart ? readiness(chart) : "scope-submitted";
        const terminal = ["requested-output-submitted", "terminal-fallback", "terminal-unavailable"].includes(status);
        const quiet = !hidden && p.requested && current && !state.moving && !state.busy && (!relevantChart || terminal);
        p.quiet = quiet ? p.quiet + 1 : 0;
        if (p.quiet < 2) continue;
        mark("presentation-proxy", { id: p.id, scope: p.scope, duration: now() - p.inputAt, status });
        pending.delete(p.owner);
      }
    }
    return Object.freeze({ start, stop, mark, phase, input, acknowledge, draw, frame,
      get active() { return active; }, export: () => report && JSON.parse(JSON.stringify(report)) });
  }
  function mount({ root, requested, snapshot, identity, download, reset = () => {} }) {
    const el = id => root.querySelector("#ol-diagnostics-" + id);
    const ignored = node => node.closest('#ol-diagnostics,#ol-help-tooltip,#ol-tip,[role="tooltip"]');
    let raf = 0, lastFrame = null, observers = [], generation = 0, crossedHidden = false;
    const recorder = create({ now: () => performance.now(), setTimer: setTimeout, clearTimer: clearTimeout, changed: refresh });
    function refresh() {
      if (!recorder.active) {
        generation++;
        cancelAnimationFrame(raf); raf = 0;
        for (const observer of observers) observer.disconnect();
        observers = [];
      }
      el("status").textContent = recorder.active ? "Recording · stops after two minutes or 10,000 events" : "Stopped · recording stays in this page until replaced or reloaded";
    }
    function scopeState(id) {
      const node = document.getElementById(id);
      if (!node || node.closest("[hidden],[inert]") || !node.getClientRects().length) return { unavailable: true };
      const moving = [node, ...node.querySelectorAll("[data-motion-running]")].some(n => n.hasAttribute("data-motion-running") && !ignored(n));
      // Opening a panel is independent of optional work inside it. Study/table
      // controls use their own scope and retain their own busy contract.
      const busy = !["ol-controls", "ol-drawer-body", "ol-side-body", "ol-reference"].includes(id) &&
        [node, ...node.querySelectorAll('[aria-busy="true"]')].some(n => n.getAttribute("aria-busy") === "true" && !ignored(n));
      return { moving, busy };
    }
    function tick(time, owned) {
      if (!recorder.active || generation !== owned) return;
      recorder.frame({ interval: lastFrame === null ? null : time - lastFrame, hidden: document.hidden || crossedHidden, scopes: scopeState, chart: snapshot() });
      crossedHidden = document.hidden;
      lastFrame = time;
      if (recorder.active) raf = requestAnimationFrame(time => tick(time, owned));
    }
    function timing(entry) {
      const out = { entryType: entry.entryType, name: entry.name, startTime: entry.startTime, duration: entry.duration };
      if (["resource", "navigation"].includes(entry.entryType)) {
        try { out.name = new URL(entry.name).pathname; } catch { out.name = "resource"; }
        for (const key of ["initiatorType", "fetchStart", "domainLookupStart", "domainLookupEnd", "connectStart", "connectEnd", "requestStart", "responseStart", "responseEnd", "transferSize", "encodedBodySize", "decodedBodySize"]) out[key] = entry[key];
      }
      if (entry.entryType === "event") for (const key of ["processingStart", "processingEnd", "interactionId", "cancelable"]) out[key] = entry[key];
      return out;
    }
    function start() {
      const supported = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
      reset();
      recorder.start({ ...identity(), browser: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, supportedEntryTypes: supported } });
      const owned = ++generation;
      for (const entry of performance.getEntriesByType("navigation")) recorder.mark("browser-timing", timing(entry));
      for (const type of ["resource", "longtask", "event", "paint"]) {
        if (!supported.includes(type)) { recorder.mark("metric-unavailable", { metric: type }); continue; }
        try {
          const observer = new PerformanceObserver(list => {
            if (generation === owned && recorder.active) for (const entry of list.getEntries()) recorder.mark("browser-timing", timing(entry));
          });
          observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) }); observers.push(observer);
        } catch { recorder.mark("metric-unavailable", { metric: type }); }
      }
      lastFrame = null; crossedHidden = document.hidden; raf = requestAnimationFrame(time => tick(time, owned));
    }
    function capture(event) {
      if (!recorder.active || !(event.target instanceof Element) || ignored(event.target)) return;
      if (event.type === "pointermove" && !event.buttons) return;
      const target = event.target.closest("button,input,select,summary,a,canvas") ?? event.target;
      const controlled = target.getAttribute("aria-controls"), drawer = target.hasAttribute("data-drawer");
      const key = event.type === "keydown" ? (event.key ?? "").toLowerCase() : "";
      const bounds = target.closest("#ol-bounds-form"), appliesBounds = bounds &&
        (event.type === "submit" || target.matches('button[type="submit"]') || key === "enter");
      const studyScope = target.id === "ol-evidence-tab" ? "ol-evidence" : target.id === "ol-context-tab" ? "ol-context" :
        target.id === "ol-canvas" && key === "c" ? root.querySelector("#ol-evidence-tab").getAttribute("aria-pressed") === "true" ? "ol-context" : "ol-evidence" : null;
      const explicit = appliesBounds ? "ol-canvas" : studyScope ?? (drawer || target.id === "ol-canvas" && key === "t" ? "ol-drawer-body" :
        target.id === "ol-canvas" && key === "i" ? "ol-side-body" : controlled && document.getElementById(controlled) ? controlled : null);
      const container = target.closest("#ol-comparisonWorkspace,#ol-evidence,.ol-panel,#ol-controls,#ol-side-body");
      const scope = explicit ?? (container && container.id !== "ol-controls" ? container.id : "ol-canvas");
      const p = recorder.input(scope, { owner: studyScope ? "inspector-tab" : scope, event: event.type, target: target.id || target.tagName.toLowerCase(), trusted: event.isTrusted, eventTime: event.timeStamp });
      // Native dispatch may checkpoint microtasks between capture and bubble
      // listeners. A task observes the application handlers after dispatch.
      setTimeout(() => recorder.acknowledge(p, requested()), 0);
    }
    // Listeners are inert until explicitly started. No input text, clipboard,
    // query strings or credentials are included in the export.
    for (const type of ["click", "change", "submit", "keydown", "wheel", "pointerdown", "pointermove"]) root.addEventListener(type, capture, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!recorder.active) return;
      crossedHidden ||= document.hidden;
      recorder.mark("visibility", { hidden: document.hidden });
    });
    root.addEventListener("comparison-render", event => {
      if (recorder.active) recorder.mark("comparison-render", { revision: event.detail.revision });
    });
    el("start").addEventListener("click", start);
    el("stop").addEventListener("click", () => recorder.stop());
    el("export").addEventListener("click", () => {
      recorder.stop("export");
      const data = recorder.export();
      if (!data) { el("status").textContent = "Start a recording first"; return; }
      const text = JSON.stringify(data, null, 2);
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
  return Object.freeze({ LIMITS, DEFINITIONS, readiness, create, mount });
});
