/* Test-page observer only. Never included in the shipped page or normal test configuration. */
(() => {
  'use strict';
  const raf = requestAnimationFrame.bind(window), timer = setTimeout.bind(window);
  let options, trace, started = 0, deadline = 0, recording = false, resolve;
  let ids = new WeakMap(), nodes = new Map(), ghosts = new WeakSet(), animations = new Map();
  let semanticIds = new WeakMap(), semanticSerial = 0;
  let channelIds = new WeakMap(), channelSerial = 0;
  let pendingInputs = new WeakMap();
  const ignored = node => node?.closest?.('#ol-help-tooltip,#ol-tip,[role="tooltip"],[data-flow-measuring]');
  const now = () => Math.round((performance.now() - started) * 100) / 100;
  const relevant = node => node instanceof Element && !ignored(node) &&
    (ghosts.has(node) || ghosts.has(node.closest('[data-flow-retiring]')) || options.selectors.some(selector => node.closest(selector)));
  function identify(node, role = 'actor', original = null) {
    if (!ids.has(node)) {
      const id = nodes.size + 1;
      if (id > options.caps.actors) { trace.truncated = 'actor-limit'; return null; }
      ids.set(node, id); nodes.set(id, node);
      const source = original ?? node, row = source.matches('[data-cell-key],[data-capture-id]') ? source : source.querySelector('[data-cell-key],[data-capture-id]');
      trace.actors.push({ id, role, tag: node.tagName, domId: node.id, key: row?.dataset.cellKey ?? row?.dataset.captureId ?? null,
        ghost: ghosts.has(node), ghostSafe: !ghosts.has(node) || node.inert && node.getAttribute('aria-hidden') === 'true' && !node.querySelector('[id]') });
    }
    return ids.get(node);
  }
  function event(type, owner, name, detail = {}) {
    if (!recording || !relevant(owner)) return;
    if (trace.channels.length >= options.caps.channelEvents) { trace.truncated = 'channel-limit'; return; }
    trace.channels.push({ type, at: now(), owner: identify(owner), name, ...detail });
  }
  const channelId = channel => { if (!channelIds.has(channel)) channelIds.set(channel, ++channelSerial); return channelIds.get(channel); };
  const copy = channel => channel ? { channel: channelId(channel), active: channel.active, generation: channel.generation, value: { ...channel.value }, velocity: { ...channel.velocity }, target: { ...channel.target } } : null;
  const semanticId = node => { if (!semanticIds.has(node)) semanticIds.set(node, ++semanticSerial); return semanticIds.get(node); };
  function semantic() {
    const active = document.activeElement;
    return { sheet: document.querySelector('#origo-lens')?.dataset.sheet,
      sheetExpanded: document.querySelector('#ol-sheet-toggle')?.getAttribute('aria-expanded'),
      sheetInteractivity: document.querySelector('#ol-controls') ? getComputedStyle(document.querySelector('#ol-controls')).getPropertyValue('interactivity') : null,
      sideExpanded: document.querySelector('#ol-side-toggle')?.getAttribute('aria-expanded'),
      drawer: [...document.querySelectorAll('[data-drawer][aria-expanded="true"]')].map(node => node.id),
      focus: active?.id || active?.getAttribute('data-focus-key') || active?.tagName,
      rows: [...document.querySelectorAll('#ol-table-body tr')].map(node => ({ key: node.dataset.cellKey, node: semanticId(node), text: node.textContent })),
      cards: [...document.querySelectorAll('.ol-comparison-card')].map(node => ({ key: node.dataset.captureId, node: semanticId(node), text: node.textContent,
        metrics: [...node.querySelectorAll('[data-metric]')].map(metric => ({ key: metric.dataset.metric, canonical: metric.dataset.canonical, primary: metric.classList.contains('ol-comparison-primary') })) })),
      tableSort: [...document.querySelectorAll('th[aria-sort]')].map(node => [node.textContent.trim(), node.getAttribute('aria-sort')]),
      tablePage: document.querySelector('#ol-table-page')?.textContent,
      tableTitle: document.querySelector('#ol-table-page')?.title,
      comparison: Object.fromEntries([...document.querySelectorAll('[data-comparison-control]')].map(node => [node.dataset.comparisonControl, node.value])),
      comparisonDirection: document.querySelector('[data-comparison-action="direction"]')?.textContent,
      comparisonSummary: document.querySelector('.ol-comparison-summary')?.textContent,
      keysOpen: document.querySelector('#ol-keys')?.open };
  }
  function finish(reason = 'window-complete') {
    if (!recording) return;
    recording = false;
    trace.reason = reason; trace.semantic = { before: trace.before, after: semantic() }; delete trace.before;
    resolve(trace);
  }
  function sample() {
    if (!recording) return;
    const sampleStarted = performance.now();
    const ancestors = new Set();
    for (const node of document.querySelectorAll(options.selectors.join(','))) if (!ignored(node)) identify(node);
    for (const node of nodes.values()) if (node.isConnected) for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
    const running = document.getAnimations().filter(animation => {
      const node = animation.effect?.target;
      return node instanceof Element && !ignored(node) && (relevant(node) || ancestors.has(node)) && (animation.playState === 'running' || animation.pending);
    });
    for (const animation of running) {
      const node = animation.effect.target;
      identify(node);
      if (!animations.has(animation)) {
        const id = animations.size + 1; animations.set(animation, id);
        const timing = animation.effect.getTiming();
        trace.cssAnimations.push({ id, owner: identify(node), property: animation.transitionProperty ?? animation.animationName ?? 'unknown',
          startTime: animation.startTime, duration: timing.duration, delay: timing.delay, iterations: timing.iterations });
      }
    }
    for (const node of ancestors) identify(node, 'ancestor');
    const cache = new Map();
    const read = node => {
      if (cache.has(node)) return cache.get(node);
      if (!node?.isConnected || !node.getClientRects().length) return { box: { x: 0, y: 0, width: 0, height: 0 }, alpha: 0, opacity: 0, rotation: 0, clip: [0, 0, 0, 0], childClip: [0, 0, 0, 0] };
      const style = getComputedStyle(node), box = node.getBoundingClientRect(), parent = node.parentElement ? read(node.parentElement) : null;
      let inherited = [...(parent?.childClip ?? [0, 0, innerWidth, innerHeight])];
      const inset = /^inset\(([^)]*)\)$/.exec(style.clipPath);
      if (style.clipPath !== 'none' && !inset && !trace.invalidReasons.includes('unsupported-clip-path')) trace.invalidReasons.push('unsupported-clip-path');
      if (inset) {
        const values = inset[1].split('round')[0].trim().split(/\s+/), [top, right = top, bottom = top, left = right] = values;
        const length = (text, size) => Number.parseFloat(text) * (text.endsWith('%') ? size / 100 : 1);
        inherited = [Math.max(inherited[0], box.left + length(left, box.width)), Math.max(inherited[1], box.top + length(top, box.height)),
          Math.min(inherited[2], box.right - length(right, box.width)), Math.min(inherited[3], box.bottom - length(bottom, box.height))];
      }
      const clip = [Math.max(box.left, inherited[0]), Math.max(box.top, inherited[1]), Math.min(box.right, inherited[2]), Math.min(box.bottom, inherited[3])], childClip = [...inherited];
      const sx = box.width / (node.offsetWidth || box.width || 1), sy = box.height / (node.offsetHeight || box.height || 1);
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
        childClip[0] = Math.max(childClip[0], box.left + node.clientLeft * sx);
        childClip[2] = Math.min(childClip[2], box.left + (node.clientLeft + node.clientWidth) * sx);
      }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
        childClip[1] = Math.max(childClip[1], box.top + node.clientTop * sy);
        childClip[3] = Math.min(childClip[3], box.top + (node.clientTop + node.clientHeight) * sy);
      }
      const matrix = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform);
      if (matrix && !matrix.is2D && !trace.invalidReasons.includes('unsupported-3d-transform')) trace.invalidReasons.push('unsupported-3d-transform');
      const rotation = (style.rotate === 'none' ? 0 : Number.parseFloat(style.rotate.split(' ').at(-1))) + (matrix ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : 0);
      const opacity = Number(style.opacity) * (parent?.opacity ?? 1);
      const value = { box, opacity, alpha: style.visibility === 'visible' ? opacity : 0, rotation, clip, childClip };
      cache.set(node, value); return value;
    };
    const round = (value, step) => Math.round(value / step) * step;
    const poses = [...nodes].map(([id, node]) => {
      const { box, alpha, rotation, clip } = read(node), p = options.samplingPrecision;
      return [id, ...[box.x, box.y, box.width, box.height].map(v => round(v, p.positionCssPx)), round(alpha, p.opacity), round(rotation, p.rotationDeg),
        round(Math.max(0, clip[2] - clip[0]), p.positionCssPx), round(Math.max(0, clip[3] - clip[1]), p.positionCssPx)];
    });
    if (poses.some(pose => pose.some(value => !Number.isFinite(value))) && !trace.invalidReasons.includes('non-finite-pose')) trace.invalidReasons.push('non-finite-pose');
    trace.actorSamples += poses.length;
    trace.frames.push({ at: now(), poses, marked: [...document.querySelectorAll('[data-motion-running]')].filter(node => relevant(node) || ancestors.has(node)).length,
      css: running.length, cssIds: running.map(animation => animations.get(animation)), focus: document.activeElement?.id || document.activeElement?.tagName,
      sheet: document.querySelector('#origo-lens')?.dataset.sheet, probeMs: Math.round((performance.now() - sampleStarted) * 100) / 100 });
    if (trace.actorSamples > options.caps.actorSamples) trace.truncated = 'sample-limit';
    if (trace.truncated) return finish('truncated');
    if (deadline && now() >= deadline) return finish();
    if (!deadline && now() > 10000) return finish('missing-input');
    raf(() => timer(sample, 0));
  }
  function input(event) {
    if (!recording || !options.inputTypes.includes(event.type) || !(event.target instanceof Element) || ignored(event.target)) return;
    const target = event.target.closest(options.inputSelectors.join(','));
    if (!target) return;
    if (event.type === 'keydown' && event.key !== 'Escape') return;
    const item = { at: now(), event: event.type, nativeTimestamp: event.timeStamp, trusted: event.isTrusted, target: target.id || target.getAttribute('data-comparison-action') || target.getAttribute('data-comparison-control') };
    trace.inputs.push(item);
    const acknowledge = witness => {
      if (item.acknowledged) return;
      item.acknowledged = true;
      if (!recording) return;
      const ack = { at: now(), witness, input: trace.inputs.indexOf(item), state: semantic() };
      trace.acks.push(ack);
      if (!trace.ack) { trace.ack = ack; deadline = ack.at + options.captureMs; }
    };
    pendingInputs.set(event, acknowledge);
    // A microtask from a capturing listener can run before a trusted event's
    // target listener. Witness at window bubble, or the next task if stopped.
    timer(() => acknowledge('after-dispatch-task'), 0);
  }
  for (const type of ['click', 'change', 'keydown']) {
    document.addEventListener(type, input, { capture: true, passive: true });
    window.addEventListener(type, event => { const ack = pendingInputs.get(event); if (ack) queueMicrotask(() => ack('window-bubble-microtask')); }, { passive: true });
  }
  window.__presentation212 = {
    get recording() { return recording; },
    begin(settings) {
      options = settings; ids = new WeakMap(); nodes = new Map(); ghosts = new WeakSet(); animations = new Map(); semanticIds = new WeakMap(); semanticSerial = 0; channelIds = new WeakMap(); channelSerial = 0; pendingInputs = new WeakMap(); started = performance.now(); deadline = 0;
      trace = { schema: 'cube-presentation@1', case: settings.id, clock: { timeOrigin: performance.timeOrigin, started }, inputs: [], acks: [], frames: [], actors: [], channels: [], cssAnimations: [], actorSamples: 0, truncated: false, invalidReasons: [],
        springDuration: window.explorerMotion.SPRING.duration, capabilities: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
          inert: CSS.supports('interactivity', 'inert'), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches } };
      recording = true; trace.before = semantic(); this.done = new Promise(done => resolve = done);
      sample(); return trace.before;
    },
    before(owner, name, channel) { return recording && relevant(owner) ? copy(channel) : null; },
    spring(owner, name, channel, before) { event('spring', owner, name, { channel: channelId(channel), generation: channel.generation, value: { ...channel.value }, velocity: { ...channel.velocity }, target: { ...channel.target }, before }); },
    target(channel, next) {
      if (recording && Object.keys(next).some(key => channel.target[key] !== next[key])) event('target', channel.owner, channel.name, { channel: channelId(channel), generation: channel.generation, target: { ...next } });
    },
    callback(channel, generation) { event('callback', channel.owner, channel.name, { channel: channelId(channel), generation }); },
    retire(original, ghost) { if (recording && relevant(original)) { ghosts.add(ghost); identify(ghost, 'actor', original); } },
    stop: finish
  };
})();
