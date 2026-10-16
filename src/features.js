/* Find features: which Mill features describe the windows you mark, and whether that beats chance.
   Mill ranks its pool and measures chance on its own bars; this controller keeps the windows, one answer and one preview. */
(function (scope) {
  "use strict";
  const DAY = 86400000;
  const BAR_NAMES = {"15m_time_bars": "15 minutes", "30m_time_bars": "30 minutes", "1h_time_bars": "1 hour", "2h_time_bars": "2 hours", "4h_time_bars": "4 hours"};
  // Within the minute any wait is allowed: a timeframe's first search builds its pool, at most about 16 s, then answers in under a second.
  const DISCOVER_TIMEOUT = 55000, CONFIG_TIMEOUT = 20000;
  function iso(ms) { return new Date(ms).toISOString().replace(".000Z", "Z"); }
  function stamp(ms) { return iso(ms).slice(0, 16).replace("T", " "); }
  function fixed(v, digits = 3) { return v === null || v === undefined ? "—" : Number(v).toFixed(digits); }
  // A p-value to two significant digits, so the smallest one a null of many shifts allows still reads as itself.
  function pValue(p) { return String(+Number(p).toPrecision(2)); }
  // Mill's research window as half-open milliseconds, from the inclusive days of its data window.
  function researchSpan(config) {
    const w = config && config.data_window;
    return w ? [Date.parse(w.start + "T00:00:00Z"), Date.parse(w.end + "T00:00:00Z") + DAY] : null;
  }
  function clip(span, bounds) {
    const a = Math.max(span[0], bounds[0]), b = Math.min(span[1], bounds[1]);
    return a < b ? [a, b] : null;
  }
  // The body of Mill's POST /discover, or why it cannot be asked. Nothing reaches Mill from outside its research
  // window or after the chart's cutoff: the compared span and the returned series both end there.
  function request({windows, bar, mode, lead, against, pool, view, edge, research}) {
    if (!research) return {error: "Mill's research window is not known yet."};
    if (!windows.length) return {error: "Add at least one window: select a rectangle on the chart, then Add selection."};
    const outside = windows.find(w => w.startMs < research[0] || w.endMs > research[1]);
    if (outside) return {error: `The window ${stamp(outside.startMs)} → ${stamp(outside.endMs)} UTC lies outside Mill's research window, ${iso(research[0]).slice(0, 10)} to ${iso(research[1] - DAY).slice(0, 10)}.`};
    const bound = [research[0], Math.min(research[1], edge)];
    if (bound[0] >= bound[1]) return {error: "The chart's cutoff is before Mill's research window starts."};
    const context = against === "view" ? clip(view, bound) : bound;
    if (!context) return {error: "The visible time lies outside Mill's research window. Move the view inside it, or compare against the whole research window."};
    if (!windows.some(w => clip([w.startMs, w.endMs], context))) return {error: "No marked window lies inside what it is compared against, before the cutoff."};
    const display = clip(view, bound) || context, span = ([a, b]) => ({start: iso(a), end: iso(b)});
    return {body: {bar, mode, ...(mode === "lead" ? {lead_bars: lead} : {}), pool, top: 5, max_points: 2000,
      windows: windows.map(w => span([w.startMs, w.endMs])), context: span(context), display: span(display)}};
  }
  // A leader's values as points, each at the end of its bucket of bars, when its last bar has closed. The last bucket
  // may be partial; it is placed at the display's end, never before its value was known.
  function points(series, endMs) {
    if (!series) return [];
    const out = [];
    for (let k = 0; k < series.values.length; k++)
      if (series.values[k] !== null) out.push({ms: Math.min(series.t0 + (k + 1) * series.step_ms, endMs), value: series.values[k]});
    return out;
  }
  // What the chance check can and cannot say. Beyond chance is Mill's exact call, an adjusted p of at most 1 in 20
  // against the best column of every shifted labeling, so below 19 shifts nothing can be beyond chance.
  function chanceText(result) {
    const c = result.chance;
    const bar = c.critical === null
      ? `${c.shifts} shifted labeling${c.shifts === 1 ? " is" : "s are"} too few for any column to be beyond chance.`
      : `Across ${c.shifts} shifted labelings, a column is beyond chance when it separates by more than ${fixed(c.critical)}, which the best of all ${result.screened} ranked columns exceeds by chance in at most 1 in 20.`;
    if (result.evidence === "description")
      return `One window describes, it does not test: a slow level separates any contiguous window from its surroundings. ${bar}`;
    return bar + (result.intervals ? " A column defined on fewer than 30 windows has no interval." : " Intervals are withheld below 30 windows.");
  }
  // YAML for a Limen manifest: maps, lists and scalars, keys in Mill's order. Exponent numbers keep a decimal point,
  // and strings that YAML would read as something else are quoted.
  function yamlScalar(v) {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") { const s = String(v); return /e/.test(s) && !/\./.test(s) ? s.replace("e", ".0e") : s; }
    const s = String(v);
    return /^[A-Za-z_][A-Za-z0-9_./-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(s) ? s : JSON.stringify(s);
  }
  function yaml(value, indent) {
    const pad = " ".repeat(indent);
    if (Array.isArray(value)) {
      if (!value.length) return " []";
      return value.map(item => item && typeof item === "object" && !Array.isArray(item)
        ? "\n" + pad + "- " + yaml(item, indent + 2).replace(/^\n\s*/, "")
        : "\n" + pad + "- " + yamlScalar(item)).join("");
    }
    const keys = Object.keys(value);
    if (!keys.length) return " {}";
    return keys.map(k => value[k] && typeof value[k] === "object" ? "\n" + pad + k + ":" + yaml(value[k], indent + 2) : "\n" + pad + k + ": " + yamlScalar(value[k])).join("");
  }
  function manifestYaml(manifest) { return yaml(manifest, 0).replace(/^\n/, "") + "\n"; }

  function create({root, context, changed}) {
    const el = id => root.querySelector("#ol-features-" + id);
    let config = null, configState = "idle", loading = null, windows = [], result = null, asked = null, selected = -1, busy = false,
      active = null, message = "", serial = 0, synced = "", cache = {candidate: null, list: []}, fallbackFor = null;
    // One request to Mill, answered with JSON of the expected shape, or an error that says what came back instead. Its status is
    // the HTTP status, or "unreachable" and "aborted" when there was no answer.
    async function call(path, {body = null, timeout, shaped}) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort("timeout"), timeout);
      const fail = (words, status) => Object.assign(new Error(words), {status}), name = path.slice(5);
      active = controller;
      try {
        let response, text;
        try {
          response = await fetch(path, {method: body ? "POST" : "GET", headers: body ? {"Content-Type": "application/json"} : {},
            body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: controller.signal});
          text = await response.text();
        } catch (error) {
          if (controller.signal.aborted) throw fail(controller.signal.reason === "user" ? "Stopped waiting. Mill may still finish what it was asked." : "Mill did not answer within the minute.", "aborted");
          throw fail(`Mill could not be reached: ${error.message}.`, "unreachable");
        }
        let reply;
        try { reply = JSON.parse(text); } catch (error) { throw fail(`Mill's ${name} answered ${response.status} without JSON.`, response.status); }
        if (!response.ok) throw fail(response.status < 500 ? `Mill refused the request: ${reply?.detail || reply?.error || response.statusText}.` : `Mill failed: ${reply?.error || response.statusText}.`, response.status);
        if (!shaped(reply)) throw fail(`Mill's ${name} answered with JSON that is not its answer.`, response.status);
        return reply;
      } finally { clearTimeout(timer); if (active === controller) active = null; }
    }
    // Mill is asked only when the operator acts here: the first Find, or opening the pool to choose one of Mill's views.
    function connect() { return loading ??= loadConfig().finally(() => { if (configState !== "ready") loading = null; }); }
    async function loadConfig() {
      configState = "loading"; render();
      try {
        config = await call("/mill/app-config", {timeout: CONFIG_TIMEOUT, shaped: (r) => typeof r?.data_window?.start === "string" && typeof r.data_window.end === "string"});
        configState = "ready"; message = "";
        const pool = el("pool"), group = document.createElement("optgroup");
        group.label = "Mill views";
        for (const name of config.views || []) { const option = document.createElement("option"); option.value = "view:" + name; option.textContent = name; group.append(option); }
        pool.querySelector("optgroup")?.remove(); pool.append(group);
      } catch (error) {
        configState = "failed";
        message = error.status === 404 || error.status === "unreachable"
          ? "Find features needs Mill, served to this page at /mill/. Locally, open the page through python3 tools/features_dev.py."
          : error.message;
      }
      render();
    }
    function addSelection() {
      const s = context().selectionMs;
      if (!s || s[1] <= s[0]) return;
      if (windows.some(w => w.startMs === s[0] && w.endMs === s[1])) { message = "That window is already marked."; render(); return; }
      windows = [...windows, {startMs: s[0], endMs: s[1], key: "w" + (++serial)}].sort((a, b) => a.startMs - b.startMs);
      message = ""; render(); changed();
    }
    function removeWindow(key) { windows = windows.filter(w => w.key !== key); message = ""; render(); changed(); }
    async function find(event) {
      event.preventDefault();
      if (busy) return;
      busy = true; message = ""; render();
      try {
        if (configState !== "ready") { status("Connecting to Mill…"); await connect(); }
        if (configState !== "ready") return;
        const c = context(), poolValue = el("pool").value;
        const ask = request({windows, bar: el("bar").value, mode: el("mode").value, lead: Number(el("lead").value),
          against: el("against").value, pool: poolValue === "catalog" ? {kind: "catalog"} : {kind: "view", name: poolValue.slice(5)},
          view: c.viewMs, edge: c.edgeMs, research: researchSpan(config)});
        if (ask.error) { message = ask.error; return; }
        result = null; selected = -1; render(); changed();
        status(poolValue === "catalog" ? "Ranking every factory at its default parameters. A timeframe's first search builds its pool once: about 4 s on 1 hour, 16 s on 15 minutes." : "Ranking the view's columns…");
        result = await call("/mill/discover", {body: ask.body, timeout: DISCOVER_TIMEOUT, shaped: (r) => Array.isArray(r?.candidates) && Boolean(r.target && r.context && r.chance && r.pool)}); asked = ask.body; selected = result.candidates.length ? 0 : -1;
      } catch (error) { message = error.message; }
      finally { busy = false; render(); changed(); }
    }
    function select(i) { selected = selected === i ? -1 : i; render(); changed(); }
    async function copyRule() {
      const candidate = current(); if (!candidate?.rule) return;
      const text = manifestYaml(candidate.rule.manifest), shown = el("yaml");
      try { await navigator.clipboard.writeText(text); fallbackFor = null; shown.hidden = true; shown.textContent = ""; status("Copied the rule as a Limen manifest. Its threshold was fitted in sample; run it in Furnace to test it."); }
      catch (error) { fallbackFor = candidate; shown.hidden = false; shown.textContent = text; status("The clipboard refused the copy; the manifest is shown below to select by hand."); }
    }
    function status(words) { el("status").textContent = words; }
    function current() { return result && selected >= 0 ? result.candidates[selected] : null; }
    // The current leader's points, made once for it.
    function known() {
      const candidate = current();
      if (cache.candidate !== candidate) cache = {candidate, list: candidate ? points(candidate.series, Date.parse(asked.display.end)) : []};
      return cache.list;
    }
    function controls() {
      const c = context();
      el("lead-label").hidden = el("mode").value !== "lead";
      el("add").disabled = busy || !c.selectionMs;
      el("find").disabled = busy || !windows.length;
      el("find").textContent = busy ? "Finding…" : result ? "Find again" : "Find features";
      el("cancel").hidden = !busy;
      for (const node of el("form").querySelectorAll("select, input")) node.disabled = busy;
      el("lead").disabled = busy || el("mode").value !== "lead";
    }
    function cell(text) { const td = document.createElement("td"); td.textContent = text; return td; }
    function renderWindows() {
      const list = el("windows"), fragment = document.createDocumentFragment();
      for (const w of windows) {
        const item = document.createElement("li"), label = document.createElement("span"), remove = document.createElement("button");
        item.dataset.flowKey = w.key; label.textContent = `${stamp(w.startMs)} → ${stamp(w.endMs)} UTC`;
        remove.type = "button"; remove.className = "ol-action ol-s cursor-interaction"; remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove the window ${label.textContent}`); remove.onclick = () => removeWindow(w.key);
        item.append(label, remove); fragment.append(item);
      }
      window.explorerMotion.replaceChildren(list, fragment);
      el("count").textContent = windows.length ? `${windows.length} window${windows.length > 1 ? "s" : ""} marked` : "No window marked";
      el("clear-windows").disabled = busy || !windows.length;
    }
    function renderResult() {
      const body = el("rows"), fragment = document.createDocumentFragment(), mode = asked?.mode;
      el("results").hidden = !result;
      if (!result) { window.explorerMotion.replaceChildren(body); el("detail").hidden = true; fallbackFor = null; el("yaml").hidden = true; el("yaml").textContent = ""; return; }
      const t = result.target, x = result.context, pool = result.pool;
      el("summary").textContent = `${t.marked_bars} marked bars in ${t.events} window${t.events > 1 ? "s" : ""} · ${x.unmarked_bars} compared · ${result.screened} of ${pool.columns} columns ranked · ${BAR_NAMES[result.bar]} bars · ${Math.round(result.timing_ms.total)} ms` +
        (pool.cached ? "" : ` · pool built in ${(pool.built_ms / 1000).toFixed(1)} s`) + (pool.skipped.length ? ` · ${pool.skipped.length} factories need inputs the bars lack` : "");
      el("chance").textContent = chanceText(result);
      result.candidates.forEach((candidate, i) => {
        const tr = document.createElement("tr"), name = document.createElement("td"), button = document.createElement("button");
        button.type = "button"; button.className = "ol-action ol-s cursor-interaction"; button.textContent = candidate.column;
        button.setAttribute("aria-pressed", String(i === selected)); button.title = `${candidate.source}.${candidate.factory} · select to preview`;
        button.onclick = () => select(i); name.append(button); tr.dataset.flowKey = candidate.column;
        tr.append(name, cell(fixed(candidate.auc)), cell(candidate.ci90 ? `${fixed(candidate.ci90[0])}–${fixed(candidate.ci90[1])}` : "withheld"),
          cell(`${candidate.direction} ${mode === "lead" ? "before" : "inside"}`), cell(`${candidate.beyond_chance ? "beyond chance" : "within chance"} · p ${pValue(candidate.p_adjusted)}`),
          cell(candidate.rule ? candidate.rule.text : "no rule"));
        fragment.append(tr);
      });
      window.explorerMotion.replaceChildren(body, fragment);
      const candidate = current();
      if (fallbackFor !== candidate) { fallbackFor = null; el("yaml").hidden = true; el("yaml").textContent = ""; }
      el("detail").hidden = !candidate;
      if (!candidate) return;
      const r = candidate.rule;
      el("detail-text").textContent = r
        ? `Rule: ${r.text}. In sample it flags ${fixed(100 * r.tpr, 1)}% of the marked bars and ${fixed(100 * r.fpr, 1)}% of the others; precision ${r.precision === null ? "—" : fixed(100 * r.precision, 1) + "%"}; it hits ${fixed(100 * r.events_hit, 0)}% of the windows.`
        : "No threshold separates these bars, so there is no rule to copy.";
      el("similar").textContent = candidate.similar.length ? `Moves with it (|ρ| > 0.9): ${candidate.similar.join(", ")}.` : "No other ranked column moves with it.";
      el("copy").disabled = !r;
    }
    function render() {
      controls(); renderWindows(); renderResult();
      if (busy) return;
      if (message) status(message);
      else if (configState === "loading") status("Connecting to Mill…");
      else if (result) status(current() ? `Previewing ${current().column} in the Columns pane; its rule's hits are a lane under the chart. Nothing is saved.` : "Select a leader to preview it.");
      else if (configState === "ready") status(`Mill reads bars from ${config.data_window.start} to ${config.data_window.end}. Mark windows inside it, then Find features.`);
      else status("Select a rectangle on the chart, then Add selection. Mill is asked when you press Find features.");
    }
    function sync() {
      const c = context(); if (!c.ready) return;
      // An answer is kept only while the chart's cutoff lies at or after the end of what Mill compared against.
      if (result && c.edgeMs < Date.parse(asked.context.end)) {
        result = null; selected = -1;
        message = "The cutoff moved before the end of what Mill compared against, so its answer used later bars. Find again.";
        render(); changed();
        return;
      }
      const key = String(Boolean(c.selectionMs));
      if (key !== synced) { synced = key; controls(); }
    }
    // The Columns pane while a leader is previewed: its values on Mill's bars along the chart's time axis, each at the end
    // of its bucket, on an Auto axis over the values in view, and nothing after the cutoff.
    function paintPane(ctx, G, h) {
      const candidate = current(), top = G.ay, height = G.ah, right = G.x + G.w;
      if (!candidate || !(height > 0)) return;
      const cutX = Math.max(G.x, Math.min(right, h.X(h.baseOf(h.edgeMs))));
      ctx.fillStyle = h.colors.surface;
      ctx.fillRect(G.x, top, G.w, height);
      ctx.save();
      ctx.beginPath(); ctx.rect(G.x, top, G.w, height); ctx.clip();
      // After the cutoff, as the pane has it: hidden in replay, otherwise plain.
      if (h.replay) h.hatchRect(cutX, top, right - cutX, height, h.colors.state, 11, 0.3);
      else { ctx.fillStyle = h.colors.bg; ctx.fillRect(cutX, top, right - cutX, height); }
      h.timeGrid(top, top + height);
      const list = known();
      let last = list.length - 1;
      while (last >= 0 && list[last].ms > h.edgeMs) last--;
      // The points in view, a to b, and one either side so the line meets the pane's edges; with none in view, the two
      // the view lies between. The axis spans the points in view, or those two.
      let a = 0;
      while (a <= last && h.X(h.baseOf(list[a].ms)) < G.x) a++;
      let b = a - 1;
      while (b < last && h.X(h.baseOf(list[b + 1].ms)) <= right) b++;
      const inView = b >= a, across = !inView && a > 0 && a <= last;
      const from = inView ? Math.max(0, a - 1) : across ? a - 1 : 0, to = inView ? Math.min(last, b + 1) : across ? a : -1;
      let lo = Infinity, hi = -Infinity;
      for (let i = inView ? a : from; i <= (inView ? b : to); i++) { lo = Math.min(lo, list[i].value); hi = Math.max(hi, list[i].value); }
      const any = lo <= hi, signed = any && lo < 0 && hi > 0, m = Math.max(Math.abs(lo), Math.abs(hi)), span = hi - lo;
      const y = signed ? v => top + height / 2 - (v / m) * (height / 2 - 4)
        : span > 0 ? v => top + height - 4 - ((v - lo) / span) * (height - 8) : () => top + height / 2;
      if (signed) h.line(G.x, top + height / 2, right, top + height / 2, h.colors.line, 1);
      if (any && to > from) {
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const px = h.X(h.baseOf(list[i].ms)), py = y(list[i].value);
          if (i === from) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = h.colors.ink; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
      const domain = !any ? "no value in view" : signed ? `Auto axis ±${h.compact(m)}` : span > 0 ? `Auto axis ${h.compact(lo)} to ${h.compact(hi)}` : `constant ${h.compact(lo)}`;
      h.label(`Preview · ${candidate.column} · ${BAR_NAMES[result.bar]} bars · ${domain} · not saved`, top);
    }
    // The pane's tooltip while previewing: the value whose bucket end is nearest the pointer, known by the cutoff.
    function tip(node, t, h) {
      const candidate = current(), list = known(), ms = h.msOf(t);
      let near = null;
      for (const p of list) if (p.ms <= h.edgeMs && (!near || Math.abs(p.ms - ms) < Math.abs(near.ms - ms))) near = p;
      const note = "A temporary preview from Find features, computed by Mill on its own bars, not on the cube's.";
      if (!near) { h.tipRows(node, `Preview · ${candidate.column}`, "No value known here", [], note); return; }
      h.tipRows(node, `Preview · ${candidate.column}`, `${h.when(h.baseOf(near.ms))} UTC · known when its bar closed`,
        [["Value", String(+near.value.toPrecision(6))], ["Bars per point", String(candidate.series.bucket_bars)], ["Factory", `${candidate.source}.${candidate.factory}`], ["Bars", `Mill · ${BAR_NAMES[result.bar]}`]], note);
    }
    el("form").addEventListener("submit", find);
    el("add").onclick = addSelection;
    el("clear-windows").onclick = () => { windows = []; message = ""; render(); changed(); };
    el("cancel").onclick = () => active?.abort("user");
    el("mode").addEventListener("change", controls);
    for (const type of ["focus", "pointerdown"]) el("pool").addEventListener(type, () => { if (configState === "idle") connect(); });
    el("copy").onclick = copyRule;
    el("unpreview").onclick = () => select(-1);
    render();
    return {sync, paintPane, tip,
      get previewing() { return Boolean(current()?.series); },
      get lanes() {
        const rule = current()?.rule;
        return {windows: windows.map(w => [w.startMs, w.endMs]), hits: rule ? rule.hits : null, rule: rule ? rule.text : "", stepMs: result ? result.step_ms : 0};
      }};
  }
  scope.explorerFeatures = {create, request, researchSpan, points, chanceText, manifestYaml, clip, iso};
  if (typeof module !== "undefined") module.exports = scope.explorerFeatures;
})(typeof window === "undefined" ? globalThis : window);
