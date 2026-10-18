/* Tactile flow: the 180/20/1 model and lifecycle from Poise at 47c903c.
 * Presentation channels retain position/velocity; authoritative data stays immediate. */
(function (scope) {
  "use strict";
  /** Pure presentation model shared by the gateway renderer and browser client. */
  const MOTION = Object.freeze({ stiffness: 180, damping: 20, mass: 1, travel: 20, information: 8, feedback: 100 });
  function integrate(position, velocity, target, seconds) {
      if (![position, velocity, target, seconds].every(Number.isFinite) || seconds < 0)
          throw new Error('Motion requires finite positions and a non-negative time step.');
      const steps = Math.max(1, Math.ceil(seconds / .008));
      const dt = seconds / steps;
      for (let step = 0; step < steps; step++) {
          velocity += (-MOTION.stiffness * (position - target) - MOTION.damping * velocity) / MOTION.mass * dt;
          position += velocity * dt;
      }
      return { position, velocity };
  }
  function curve() {
      const samples = [0];
      let position = 0, velocity = 0;
      do {
          const next = integrate(position, velocity, 1, .008);
          position = next.position;
          velocity = next.velocity;
          samples.push(position);
      } while (Math.abs(position - 1) > .0008 || Math.abs(velocity) > .008);
      samples[samples.length - 1] = 1;
      return { duration: (samples.length - 1) * 8, easing: `linear(${samples.map(value => value.toFixed(5)).join(',')})` };
  }
  const CALLBACKS = ['onclick','onchange','oninput','onsubmit','onkeydown','oncontextmenu'];
  const SPRING = Object.freeze(curve());
  const MOTION_CSS = `--flow-settle:${SPRING.duration}ms;--flow-spring:${SPRING.easing};--flow-feedback:${MOTION.feedback}ms;--flow-feedback-ease:ease-out;`;
  const channels = new WeakMap();
  const moving = new Set();
  const listeners = new Set();
  const disclosurePadding = new WeakMap();
  const nativeDetails = new WeakSet();
  const measurements = new WeakMap();
  let retirementGeometry = new Map();
  let rootElement;
  let presentationHeld = false;
  let preference;
  let frame = 0, previousTime = 0;
  const bounded = (value) => Math.max(0, Math.min(1, value));
  function reducedMotion() { return (preference ?? window.matchMedia('(prefers-reduced-motion: reduce)')).matches; }
  function motionActive() { return moving.size > 0; }
  function motionValue(owner, name) {
      const channel = channels.get(owner)?.get(name);
      return channel?.active ? { ...channel.value } : null;
  }
  function mark(owner) {
      owner.toggleAttribute('data-motion-running', [...(channels.get(owner)?.values() ?? [])].some(channel => channel.active));
  }
  function target(channel) {
      const next = typeof channel.options.to === 'function' ? channel.options.to() : channel.options.to;
      for (const key of Object.keys(next)) {
          if (!Number.isFinite(next[key]) || !Number.isFinite(channel.value[key]))
              throw new Error(`Motion received non-finite ${channel.name}.${key}.`);
          channel.range[key] = Math.max(channel.range[key] ?? 1, Math.abs(next[key] - channel.value[key]), 1);
      }
      channel.target = { ...next };
  }
  function complete(channel) {
      const generation = channel.generation;
      channel.active = false;
      moving.delete(channel);
      channel.value = { ...channel.target };
      for (const key of Object.keys(channel.velocity))
          channel.velocity[key] = 0;
      channel.options.write({ ...channel.value });
      mark(channel.owner);
      if (channel.generation === generation)
          channel.options.complete?.();
  }
  function tick(now) {
      // Keep wall-clock timing on slow frames. Integration already uses bounded
      // 8 ms steps; a 32 ms frame cap stretched a spring into seconds.
      const elapsed = Math.min(Math.max(0, (now - previousTime) / 1000), 1);
      previousTime = now;
      // Read destinations before any channel writes; avoid alternating style/layout flushes.
      const active = [...moving];
      for (const channel of active) {
          if (!channel.active)
              continue;
          if (channel.options.valid && !channel.options.valid()) {
              cancelMotion(channel.owner, channel.name);
              continue;
          }
          if (!channel.owner.isConnected || !channel.owner.getClientRects().length) {
              if (channel.name === 'scroll')
                  cancelMotion(channel.owner, channel.name);
              else
                  complete(channel);
              continue;
          }
          if (now < channel.start)
              continue;
          target(channel);
      }
      for (const channel of active) {
          if (!channel.active || now < channel.start) continue;
          let resting = true;
          for (const key of Object.keys(channel.target)) {
              const next = integrate(channel.value[key], channel.velocity[key], channel.target[key], elapsed);
              channel.value[key] = next.position;
              channel.velocity[key] = next.velocity;
              if (Math.abs(next.position - channel.target[key]) > channel.range[key] * .0008 || Math.abs(next.velocity) > channel.range[key] * .008)
                  resting = false;
          }
          if (resting && (channel.options.canComplete?.() ?? true))
              complete(channel);
          else
              channel.options.write({ ...channel.value });
      }
      for (const listener of listeners)
          listener();
      frame = moving.size ? requestAnimationFrame(tick) : 0;
  }
  function spring(owner, name, options) {
      let own = channels.get(owner);
      if (!own) {
          own = new Map();
          channels.set(owner, own);
      }
      let channel = own.get(name);
      if (!channel) {
          channel = { owner, name, value: { ...options.from }, velocity: {}, range: {}, target: {}, options, active: false, generation: 0, start: 0 };
          own.set(name, channel);
      }
      else if (!channel.active) {
          channel.value = { ...options.from };
          channel.velocity = {};
      }
      else if (options.rebase)
          channel.value = { ...options.from };
      channel.options = options;
      channel.generation++;
      target(channel);
      for (const key of Object.keys(channel.target))
          channel.velocity[key] ??= 0;
      channel.start = performance.now() + (options.delay ?? 0);
      channel.active = true;
      if (reducedMotion() || presentationHeld || document.hidden) {
          complete(channel);
          return;
      }
      moving.add(channel);
      mark(owner);
      options.write({ ...channel.value });
      if (!frame) {
          previousTime = performance.now();
          frame = requestAnimationFrame(tick);
      }
  }
  function cancelMotion(owner, name) {
      const channel = channels.get(owner)?.get(name);
      if (!channel)
          return;
      channel.active = false;
      channel.generation++;
      moving.delete(channel);
      channels.get(owner).delete(name);
      mark(owner);
  }
  function finishMotion(root, cancelScroll = document.hidden) {
      // Scroll targets depend on the final geometry of panels and disclosures.
      const ordered = [...moving].sort((a, b) => Number(a.name === 'scroll') - Number(b.name === 'scroll') || (a.owner.contains(b.owner) ? 1 : b.owner.contains(a.owner) ? -1 : 0));
      for (const channel of ordered) {
          if (!channel.active)
              continue;
          if (root && channel.owner !== root && !root.contains(channel.owner))
              continue;
          if (channel.options.valid && !channel.options.valid()) {
              cancelMotion(channel.owner, channel.name);
              continue;
          }
          if (channel.name === 'scroll' && (cancelScroll || !channel.owner.getClientRects().length)) {
              cancelMotion(channel.owner, channel.name);
              continue;
          }
          if (channel.owner.getClientRects().length)
              target(channel);
          complete(channel);
      }
  }
  function onMotionFrame(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function reveal(element, { distance = MOTION.travel, delay = 0 } = {}) {
      spring(element, 'entry', { from: { opacity: 0, y: distance }, to: { opacity: 1, y: 0 }, delay,
          write: ({ opacity, y }) => {
              element.style.opacity = String(bounded(opacity));
              if (distance) {
                  element.dataset.flowEnter = '';
                  element.style.setProperty('--flow-enter-y', `${y}px`);
              }
          }, complete: () => {
              element.style.opacity = '';
              element.style.removeProperty('--flow-enter-y');
              delete element.dataset.flowEnter;
              cancelMotion(element, 'entry');
          } });
  }
  function retirementClip(parent, cache = new Map()) {
      if (!parent || parent === document.body || parent === document.documentElement)
          return { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const cached = cache.get(parent);
      if (cached)
          return cached;
      const clip = { ...retirementClip(parent.parentElement, cache) };
      if (parent.getClientRects().length) {
          const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
          const scaleX = parent instanceof HTMLElement && parent.offsetWidth ? box.width / parent.offsetWidth : 1;
          const scaleY = parent instanceof HTMLElement && parent.offsetHeight ? box.height / parent.offsetHeight : 1;
          if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
              const left = box.left + parent.clientLeft * scaleX;
              clip.left = Math.max(clip.left, left);
              clip.right = Math.min(clip.right, left + parent.clientWidth * scaleX);
          }
          if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
              const top = box.top + parent.clientTop * scaleY;
              clip.top = Math.max(clip.top, top);
              clip.bottom = Math.min(clip.bottom, top + parent.clientHeight * scaleY);
          }
      }
      cache.set(parent, clip);
      return clip;
  }
  function retirementOpacity(element, cache = new Map()) {
      if (!element || element === document.body) return 1;
      if (cache.has(element)) return cache.get(element);
      const opacity = Number(getComputedStyle(element).opacity) * retirementOpacity(element.parentElement, cache);
      cache.set(element, opacity);
      return opacity;
  }
  function layout(root, change, selector = ':scope > *', key = element => element) {
      const active = document.activeElement;
      const before = new Map([...root.querySelectorAll(selector)].map((element, index) => [key(element, index), { element, box: element.getBoundingClientRect() }]));
      // Departures share the same pre-mutation geometry as surviving layout actors.
      const previousGeometry = retirementGeometry;
      retirementGeometry = new Map(previousGeometry);
      const clips = new Map(), opacities = new Map(), beforeClip = retirementClip(root, clips);
      const visible = (box, clip) => box.width && box.height && box.right > clip.left && box.left < clip.right && box.bottom > clip.top && box.top < clip.bottom;
      for (const { element, box } of before.values())
          if (!retirementGeometry.has(element))
              retirementGeometry.set(element, {
                  box, clip: retirementClip(element.parentElement, clips),
                  opacity: visible(box, beforeClip) ? retirementOpacity(element, opacities) : 0,
                  zIndex: visible(box, beforeClip) ? getComputedStyle(element).zIndex : 'auto', cellWidths: element instanceof HTMLTableRowElement && visible(box, beforeClip) ? [...element.cells].map(cell => cell.getBoundingClientRect().width) : undefined,
              });
      let result;
      try {
          result = change();
      }
      finally {
          retirementGeometry = previousGeometry;
      }
      if (active instanceof HTMLElement && active.isConnected && root.contains(active) && document.activeElement !== active)
          active.focus({ preventScroll: true });
      const after = [...root.querySelectorAll(selector)];
      // Remove all old layout offsets before measuring any new destination.
      for (const element of after) {
          element.style.removeProperty('--flow-layout-x');
          element.style.removeProperty('--flow-layout-y');
      }
      // Collect every destination before spring() performs its initial style write.
      // Dense tables otherwise force one style/layout flush per actor.
      const afterClip = retirementClip(root);
      const destinations = after.map((element, index) => ({ element, previous: before.get(key(element, index)), next: element.getBoundingClientRect() }));
      for (const { element, previous, next } of destinations) {
          if (!previous) {
              if (visible(next, afterClip)) reveal(element, { distance: MOTION.information });
              continue;
          }
          if (!previous.box.width || !previous.box.height)
              continue;
          if (previous.element !== element)
              throw new Error('Motion layout requires retained semantic actor identity.');
          // Actors outside both clipped viewports need no presentation work.
          if (!visible(previous.box, beforeClip) && !visible(next, afterClip)) {
              cancelMotion(element, 'layout');
              delete element.dataset.flowLayout;
              continue;
          }
          if (!next.width || !next.height)
              continue;
          const x = previous.box.left - next.left, y = previous.box.top - next.top;
          if (Math.abs(x) < .5 && Math.abs(y) < .5 && !motionValue(element, 'layout'))
              continue;
          spring(element, 'layout', { from: { x, y }, to: { x: 0, y: 0 }, rebase: true,
              write: ({ x, y }) => {
                  element.dataset.flowLayout = '';
                  element.style.setProperty('--flow-layout-x', `${x}px`);
                  element.style.setProperty('--flow-layout-y', `${y}px`);
              }, complete: () => {
                  delete element.dataset.flowLayout;
                  element.style.removeProperty('--flow-layout-x');
                  element.style.removeProperty('--flow-layout-y');
                  cancelMotion(element, 'layout');
              } });
      }
      return result;
  }
  /** Logical removal is immediate; the inert visual has no IDs or live controls. */
  function retire(element) {
      const presentedGeometry = retirementGeometry.get(element);
      const box = presentedGeometry?.box ?? element.getBoundingClientRect();
      const clip = presentedGeometry?.clip ?? retirementClip(element.parentElement);
      // Reject clipped actors before any style read. Sibling removals must not
      // force style recalculation for each offscreen departure.
      if (!box.width || !box.height || clip.right <= clip.left || clip.bottom <= clip.top || box.right <= clip.left || box.left >= clip.right || box.bottom <= clip.top || box.top >= clip.bottom || reducedMotion()) {
          finishMotion(element);
          element.remove();
          return;
      }
      const opacity = presentedGeometry?.opacity ?? retirementOpacity(element);
      if (!opacity) { finishMotion(element); element.remove(); return; }
      const zIndex = presentedGeometry?.zIndex ?? getComputedStyle(element).zIndex;
      let ghost = element.cloneNode(true);
      const descendants = [...element.querySelectorAll('*')];
      const copies = [...ghost.querySelectorAll('*')];
      // Static descendants already carry their authored classes and inline styles.
      // Freeze only running presentation; dense matrix exits need no per-cell styles.
      const animated = new Set(element.querySelectorAll('[data-motion-running],[data-flow-layout],[data-flow-enter]'));
      for (const animation of element.getAnimations?.({ subtree: true }) ?? []) {
          const actor = animation.effect?.target;
          if (actor instanceof Element && actor !== element && element.contains(actor)) animated.add(actor);
      }
      for (const node of animated) {
          const index = descendants.indexOf(node);
          if (index < 0) continue;
          const presented = getComputedStyle(node);
          Object.assign(copies[index].style, { translate: presented.translate, transform: presented.transform, opacity: presented.opacity });
      }
      ghost.style.translate = 'none';
      ghost.style.transform = 'none';
      if (element instanceof HTMLTableRowElement) {
          const row = ghost;
          row.style.opacity = '1';
          [...row.cells].forEach((cell, index) => {
              cell.style.boxSizing = 'border-box';
              cell.style.width = `${presentedGeometry?.cellWidths?.[index] ?? element.cells[index].getBoundingClientRect().width}px`;
          });
          ghost = element.closest('table').cloneNode(false);
          const body = document.createElement('tbody');
          body.append(row);
          ghost.append(body);
      }
      ghost.inert = true;
      ghost.setAttribute('aria-hidden', 'true');
      for (const node of [ghost, ...ghost.querySelectorAll('[id],[data-motion-running],[data-flow-layout],[data-flow-enter]')]) {
          node.removeAttribute('id');
          node.removeAttribute('data-motion-running');
          node.removeAttribute('data-flow-layout');
          node.removeAttribute('data-flow-enter');
      }
      ghost.dataset.flowRetiring = '';
      Object.assign(ghost.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: zIndex === 'auto' ? '132' : zIndex, translate: 'none', transform: 'none' });
      finishMotion(element, true);
      element.remove();
      rootElement.appendChild(ghost);
      spring(ghost, 'retirement', { from: { opacity, y: 0 }, to: { opacity: 0, y: -MOTION.information },
          write: ({ opacity, y }) => {
              ghost.style.opacity = String(bounded(opacity));
              ghost.style.translate = `0 ${y}px`;
              ghost.style.clipPath = `inset(${Math.max(0, clip.top - box.top - y)}px ${Math.max(0, box.right - clip.right)}px ${Math.max(0, box.bottom + y - clip.bottom)}px ${Math.max(0, clip.left - box.left)}px)`;
          },
          complete: () => { ghost.remove(); cancelMotion(ghost, 'retirement'); } });
  }
  function contentChanged(records) {
      return records.some(record => !record.target.closest?.('[data-flow-measuring]') &&
          (record.type === 'childList' ? [...record.addedNodes, ...record.removedNodes].some(node => !node.matches?.('[data-flow-measuring]')) :
          record.type === 'characterData' || ['hidden', 'open', 'class'].includes(record.attributeName)));
  }
  /** Fixed measurements never shrink the live document's native scroll bounds. */
  function intrinsicHeight(element, padding) {
      let measurement = measurements.get(element);
      if (!measurement) {
          measurement = { dirty: true, width: -1, height: 0 };
          measurements.set(element, measurement);
          measurement.observer = new MutationObserver(records => { if (contentChanged(records)) measurement.dirty = true; });
          measurement.observer.observe(element,
              { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
      }
      // Callers can run before the observer's invalidation callback. Drain its
      // pending records before trusting a same-width intrinsic measurement.
      if (contentChanged(measurement.observer.takeRecords())) measurement.dirty = true;
      const width = element.getBoundingClientRect().width;
      if (!measurement.dirty && Math.abs(measurement.width - width) < .1) return measurement.height;
      measurement.dirty = false;
      measurement.width = width;
      const clone = element.cloneNode(true);
      clone.dataset.flowMeasuring = '';
      clone.inert = true;
      clone.hidden = false;
      // A checked measuring copy must not join and uncheck its live named group.
      for (const radio of [clone, ...clone.querySelectorAll('input[type="radio"][name]')])
          if (radio.matches('input[type="radio"][name]')) radio.removeAttribute('name');
      Object.assign(clone.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', width: `${width}px`, height: 'auto', translate: 'none', transform: 'none' });
      if (padding) {
          clone.style.paddingTop = `${padding.top}px`;
          clone.style.paddingBottom = `${padding.bottom}px`;
      }
      element.parentElement.appendChild(clone);
      try {
          return measurement.height = clone.getBoundingClientRect().height;
      }
      finally {
          clone.remove();
      }
  }
  /** An intrinsic block keeps its logical hidden state while its old words retire. */
  function disclosure(element, opened, done, presentedHeight = element.getBoundingClientRect().height, native = false) {
      const height = presentedHeight;
      const computed = getComputedStyle(element);
      const display = computed.display;
      const opacity = Number(computed.opacity);
      const padding = disclosurePadding.get(element) ?? { top: parseFloat(computed.paddingTop), bottom: parseFloat(computed.paddingBottom) };
      disclosurePadding.set(element, padding);
      if (!native) element.hidden = !opened;
      element.inert = !opened;
      element.style.setProperty('--flow-display', opened ? getComputedStyle(element).display : display);
      element.dataset.flowDisclosure = '';
      if (!opened)
          element.dataset.flowRetained = '';
      else
          delete element.dataset.flowRetained;
      element.style.overflow = 'hidden';
      spring(element, 'disclosure', { from: { height, opacity: opened && !height ? 0 : opacity, top: opened && !height ? 0 : parseFloat(computed.paddingTop), bottom: opened && !height ? 0 : parseFloat(computed.paddingBottom) },
          to: () => ({ height: opened && !element.hidden ? intrinsicHeight(element, padding) : 0, opacity: opened && !element.hidden ? 1 : 0, top: opened ? padding.top : 0, bottom: opened ? padding.bottom : 0 }),
          write: ({ height, opacity, top, bottom }) => { element.style.height = `${Math.max(0, height)}px`; element.style.opacity = String(bounded(opacity)); element.style.paddingTop = `${Math.max(0, top)}px`; element.style.paddingBottom = `${Math.max(0, bottom)}px`; },
          complete: () => {
              element.style.height = '';
              element.style.opacity = '';
              element.style.overflow = '';
              element.style.paddingTop = '';
              element.style.paddingBottom = '';
              element.style.removeProperty('--flow-display');
              delete element.dataset.flowDisclosure;
              delete element.dataset.flowRetained;
              cancelMotion(element, 'disclosure');
              done?.();
          } });
  }
  /** Changed information settles in place; typing and streaming never call this. */
  function resizeContent(element, change) {
      const height = element.getBoundingClientRect().height;
      const result = change();
      if (!height || !element.getClientRects().length)
          return result;
      element.style.overflow = 'hidden';
      spring(element, 'content-size', { from: { height }, to: () => ({ height: intrinsicHeight(element) }),
          write: ({ height }) => { element.style.height = `${Math.max(0, height)}px`; },
          complete: () => { element.style.height = ''; element.style.overflow = ''; cancelMotion(element, 'content-size'); } });
      return result;
  }
  /** Fixed owners opt in explicitly; descendants and text mutations are ignored. */
  function watchPanel(element, opened, slide = 0, owner = element, attributes = ['class', 'hidden']) {
      let previous = opened();
      let display = getComputedStyle(element).display;
      const update = () => {
          const next = opened();
          if (previous === next)
              return;
          previous = next;
          // CSS inertness follows logical state synchronously, including immediate focus on reopen.
          element.inert = false;
          if (!next && !CSS.supports('interactivity', 'inert')) {
              finishMotion(element);
              delete element.dataset.flowRetained;
              delete element.dataset.flowPanelRetained;
              element.style.removeProperty('--flow-display');
              return;
          }
          if (next) {
              delete element.dataset.flowRetained;
              delete element.dataset.flowPanelRetained;
              element.style.removeProperty('--flow-display');
              display = getComputedStyle(element).display;
          }
          else {
              element.style.setProperty('--flow-display', display);
              element.dataset.flowRetained = '';
              element.dataset.flowPanelRetained = '';
          }
          spring(element, 'panel', { from: { progress: next ? 0 : 1 }, to: { progress: next ? 1 : 0 },
              write: ({ progress }) => {
                  element.style.opacity = String(bounded(progress));
                  if (slide === 2)
                      element.style.transform = `translateY(${(1 - progress) * 100}%)`;
                  else if (slide === -1 || slide === 1)
                      element.style.transform = `translateX(${slide * (1 - progress) * 100}%)`;
                  else if (slide !== 3)
                      element.style.translate = `0 ${(1 - progress) * MOTION.travel}px`;
              }, complete: () => {
                  element.style.opacity = '';
                  element.style.translate = '';
                  if (slide)
                      element.style.transform = '';
                  delete element.dataset.flowRetained;
                  delete element.dataset.flowPanelRetained;
                  element.style.removeProperty('--flow-display');
                  cancelMotion(element, 'panel');
              } });
      };
      new MutationObserver(update).observe(owner, { attributes: true, attributeFilter: attributes });
      window.addEventListener('resize', update);
  }
  /** Bounded scrolling follows live geometry and yields immediately to direct input. */
  function scroll(element, destination, actor) {
      if (document.hidden || !element.getClientRects().length || actor && (!actor.isConnected || !actor.getClientRects().length)) {
          cancelMotion(element, 'scroll');
          return;
      }
      spring(element, 'scroll', { from: { x: element.scrollLeft, y: element.scrollTop }, to: () => ({ x: element.scrollLeft, y: Math.max(0, Math.min(element.scrollHeight - element.clientHeight, destination())) }),
          valid: () => !actor || actor.isConnected && !!actor.getClientRects().length,
          write: ({ x, y }) => { element.scrollLeft = x; element.scrollTop = y; }, complete: () => cancelMotion(element, 'scroll') });
  }
  function scrollToActor(actor, block = 'nearest') {
      let container = actor.parentElement;
      while (container && container !== document.body && !/(auto|scroll)/.test(getComputedStyle(container).overflowY))
          container = container.parentElement;
      const owner = container && container !== document.body ? container : document.documentElement;
      scroll(owner, () => {
          const box = actor.getBoundingClientRect(), top = owner === document.documentElement ? 0 : owner.getBoundingClientRect().top + owner.clientTop;
          const height = owner === document.documentElement ? innerHeight : owner.clientHeight;
          const parent = { top, height, bottom: top + height };
          if (block === 'center')
              return owner.scrollTop + box.top - parent.top - (parent.height - box.height) / 2;
          const above = box.top < parent.top, below = box.bottom > parent.bottom;
          if (above && below)
              return owner.scrollTop;
          const tall = box.height > parent.height;
          if (above)
              return owner.scrollTop + (tall ? box.bottom - parent.bottom : box.top - parent.top);
          if (below)
              return owner.scrollTop + (tall ? box.top - parent.top : box.bottom - parent.bottom);
          return owner.scrollTop;
      }, actor);
  }
  function initMotion(root) {
      rootElement = root;
      if (preference)
          return;
      preference = window.matchMedia('(prefers-reduced-motion: reduce)');
      for (const declaration of MOTION_CSS.split(';').filter(Boolean)) {
          const at = declaration.indexOf(':');
          rootElement.style.setProperty(declaration.slice(0, at), declaration.slice(at + 1));
      }
      preference.addEventListener('change', () => { if (preference?.matches)
          finishMotion(); });
      window.addEventListener('resize', () => { presentationHeld = true; finishMotion(); requestAnimationFrame(() => { presentationHeld = false; }); });
      window.addEventListener('beforeprint', () => { presentationHeld = true; finishMotion(); });
      window.addEventListener('afterprint', () => { presentationHeld = false; });
      document.addEventListener('visibilitychange', () => { if (document.hidden)
          finishMotion(); });
      window.addEventListener('pagehide', () => finishMotion(undefined, true));
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
          document.addEventListener(event, () => {
              for (const channel of [...moving])
                  if (channel.name === 'scroll')
                      cancelMotion(channel.owner, 'scroll');
          }, { capture: true, passive: true });
      rootElement.addEventListener('click', event => {
          const summary = event.target.closest('summary');
          const details = summary?.parentElement;
          if (!(details instanceof HTMLDetailsElement) || summary !== details.querySelector(':scope > summary') || event.defaultPrevented)
              return;
          if (event.target.closest('a, button, input, select, textarea'))
              return;
          const bodies = [...details.children].filter((child) => child instanceof HTMLElement && child !== summary
              && !child.matches('datalist, script, style, template, input[type="hidden"], [hidden]:not([data-flow-retained])'));
          if (!bodies.length)
              return;
          if (!nativeDetails.has(details)) {
              nativeDetails.add(details);
              details.addEventListener('toggle', () => {
                  if (details.hasAttribute('data-flow-details'))
                      return;
                  for (const body of bodies) {
                      body.inert = false;
                  }
              });
          }
          event.preventDefault();
          const opened = !details.open;
          const heights = bodies.map(body => body.getBoundingClientRect().height);
          details.dataset.flowDetails = '';
          details.open = opened;
          let remaining = bodies.length;
          bodies.forEach((body, index) => disclosure(body, opened, () => { body.inert = false; if (!--remaining)
              delete details.dataset.flowDetails; }, heights[index], true));
      });
  }
  

  // Keys describe semantic actors; transient motion attributes never define identity.
  function actorKey(node, index) {
    if (node.nodeType !== 1) return `${node.nodeType}:${index}`;
    if (node.id) return `id:${node.id}`;
    for (const name of ['flowKey', 'cellKey', 'captureId', 'drawingRow', 'rallyId', 'refKey', 'focusKey', 'line', 'lineRemove', 'metric', 'field', 'section', 'comparisonAction', 'drawingAction', 'modeStep', 'paneStep', 'rowsStep', 'modeNav', 'paneNav', 'rowsNav', 'scaleItem', 'mode', 'pane', 'rows', 'period', 'timeframe']) {
      if (node.dataset[name] !== undefined) return `${node.tagName}:${name}:${node.dataset[name]}:${node.dataset.drawingId ?? node.dataset.id ?? node.dataset.value ?? ''}`;
    }
    return `${node.nodeType}:${node.nodeName}:${index}`;
  }
  function patchNode(current, next, staticMarkup = false) {
    if (current === next) return current;
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) return next;
    if (current.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return current;
    }
    // HTML fragments have delegated behavior. Equal static subtrees can retain
    // their native DOM without allocating a JavaScript patch tree every render.
    if (staticMarkup && current.isEqualNode(next)) return current;
    // Equal leaves still receive fresh behavior; native editing retains its full patch path.
    for (const event of CALLBACKS) if (current[event] || next[event]) current[event] = next[event];
    if (!current.childElementCount && !next.childElementCount && !['INPUT','SELECT','TEXTAREA'].includes(current.nodeName) && current.isEqualNode(next)) return current;
    const active = current === document.activeElement;
    const open = current instanceof HTMLDetailsElement ? current.open : null;
    const motionStyles = [...current.style].filter(name => name.startsWith('--flow-') || (current.hasAttribute('data-motion-running') && ['opacity', 'translate', 'height', 'overflow', 'padding-top', 'padding-bottom'].includes(name))).map(name => [name,current.style.getPropertyValue(name)]);
    for (const attr of [...current.attributes]) {
      if (attr.name.startsWith('data-flow-') || attr.name === 'data-motion-running' || attr.name === 'open' && open !== null || ['hidden','inert'].includes(attr.name) && current.hasAttribute('data-flow-disclosure')) continue;
      if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of next.attributes) {
      if (attr.name === 'open' && open !== null || ['hidden','inert'].includes(attr.name) && current.hasAttribute('data-flow-disclosure')) continue;
      if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    }
    for (const [name,value] of motionStyles) current.style.setProperty(name,value);
    // Native editing keeps its draft, selection and IME ownership. Non-editable values update directly.
    if (current instanceof HTMLInputElement) {
      if (!active && current.value !== next.value) current.value = next.value;
      current.checked = next.checked;
    }
    if (current instanceof HTMLTextAreaElement && !active) current.value = next.value;
    if (current.hasAttribute('data-flow-collection')) reconcileChildren(current, [...next.childNodes], staticMarkup);
    else patchChildren(current, [...next.childNodes], staticMarkup);
    if (current instanceof HTMLSelectElement && !active) current.value = next.value;
    if (open !== null) current.open = open;
    return current;
  }
  function patchChildren(host, nextNodes, staticMarkup = false) {
    const old = [...host.childNodes], keyed = new Map(old.map((node,index) => [actorKey(node,index), node]));
    const used = new Set();
    let cursor = host.firstChild;
    nextNodes.forEach((next,index) => {
      const existing = keyed.get(actorKey(next,index));
      const node = existing ? patchNode(existing,next,staticMarkup) : next;
      if (existing && node !== existing) { if (existing instanceof HTMLElement) retire(existing); else existing.remove(); }
      used.add(node);
      if (node !== cursor) host.insertBefore(node,cursor?.parentNode === host ? cursor : null);
      cursor = node.nextSibling;
    });
    for (const node of old) if (!used.has(node) && node.parentNode === host) {
      if (node instanceof HTMLElement) retire(node); else node.remove();
    }
  }
  function replaceChildren(host, ...content) {
    const nodes = content.flatMap(node => node.nodeType === 11 ? [...node.childNodes] : [node]);
    reconcileChildren(host, nodes);
  }
  function reconcileChildren(host, nodes, staticMarkup = false) {
    const before = [...host.childNodes].map(actorKey), after = nodes.map(actorKey);
    const structural = before.length !== after.length || before.some((key,index) => key !== after[index]);
    if (structural && host.getClientRects().length && !reducedMotion()) {
      layout(host, () => patchChildren(host,nodes,staticMarkup), ':scope > *', (node, index) => actorKey(node, index));
    } else patchChildren(host,nodes,staticMarkup);
  }
  function html(host, content) {
    const template = document.createElement('template'); template.innerHTML = content;
    reconcileChildren(host, [...template.content.childNodes], !template.content.querySelector('input,select,textarea'));
  }
  // Capture before logical state changes, then interpolate only presentation dimensions.
  function captureSize(element, animate = true, opened = () => !element.hidden) {
    const before = element.getBoundingClientRect().height;
    return () => {
      const oldHeight = element.style.height, oldOverflow = element.style.overflow;
      element.style.height = ''; element.style.overflow = '';
      const after = opened() ? element.getBoundingClientRect().height : 0;
      if (!animate || reducedMotion() || Math.abs(before-after) < .5 && !motionValue(element,'size')) {
        cancelMotion(element,'size'); delete element.dataset.flowSize; return;
      }
      element.style.height = oldHeight; element.style.overflow = oldOverflow;
      element.dataset.flowSize = '';
      spring(element,'size',{from:{height:before},to:{height:after},write:({height})=>{
        element.style.height = `${Math.max(0,height)}px`; element.style.overflow = 'hidden';
      },complete:()=>{
        element.style.height = ''; element.style.overflow = ''; delete element.dataset.flowSize;
        cancelMotion(element,'size');
      }});
    };
  }
  function captureGrid(main, animate = true) {
    const elements = [...main.children];
    const live = motionValue(main,"grid");
    const before = elements.map((element,index) => live ? live["c"+index] : element.getClientRects().length ? element.getBoundingClientRect().width : 0);
    return () => {
      main.style.gridTemplateColumns = ''; delete main.dataset.flowGrid;
      const retained = elements.filter(element => element.hidden && element.hasAttribute("data-flow-panel-retained"));
      for (const element of retained) { delete element.dataset.flowRetained; delete element.dataset.flowPanelRetained; }
      const after = elements.map(element => !element.hidden && element.getClientRects().length ? element.getBoundingClientRect().width : 0);
      for (const element of retained) { element.dataset.flowRetained=""; element.dataset.flowPanelRetained=""; }
      if (!animate || innerWidth <= 760 || reducedMotion() || before.every((value,index)=>Math.abs(value-after[index])<.5) && !motionValue(main,'grid')) {
        cancelMotion(main,'grid'); return;
      }
      // Each explicit column keeps its native canvas geometry throughout the resize.
      const from=Object.fromEntries(before.map((value,index)=>['c'+index,value]));
      const to=Object.fromEntries(after.map((value,index)=>['c'+index,value]));
      main.dataset.flowGrid = '';
      spring(main,'grid',{from,to,write:values=>{
        main.style.gridTemplateColumns=elements.map((_,index)=>`${Math.max(0,values['c'+index])}px`).join(' ');
      },complete:()=>{
        main.style.gridTemplateColumns=''; delete main.dataset.flowGrid; cancelMotion(main,'grid');
      }});
    };
  }
  function observeSize(element) {
    let height=element.getBoundingClientRect().height;
    // Nested springs change native height through style writes, not content
    // mutations. Remember that presented size without starting another spring.
    new ResizeObserver(() => {
      if (!element.hidden && !motionValue(element,'content-size') && element.getClientRects().length)
        height=element.getBoundingClientRect().height;
    }).observe(element);
    new MutationObserver(records=>{
      if (!contentChanged(records)) return;
      if (!element.getClientRects().length || reducedMotion()) { height=element.getBoundingClientRect().height; return; }
      const natural=intrinsicHeight(element);
      if (Math.abs(natural-height)<.5 && !motionValue(element,'content-size')) return;
      element.style.overflow='hidden';
      spring(element,'content-size',{from:{height},to:()=>({height:intrinsicHeight(element)}),write:value=>{
        height=value.height; element.style.height=`${Math.max(0,height)}px`;
      },complete:()=>{
        element.style.height='';element.style.overflow='';height=element.getBoundingClientRect().height;cancelMotion(element,'content-size');
      }});
    }).observe(element,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','open']});
  }
  // A bounded union of two real dyadic fields. Preparation owns every lookup,
  // allocation and colour parse; painting visits flat arrays with cached inks.
  function subdivisionPlan(before, after, ground, limit = 8192) {
    if (!before || !after) return null;
    // Different causal edges need independent clipped rasters, not a parent
    // colour extended into support that the earlier frame never observed.
    if (before.cut !== undefined && after.cut !== undefined && before.cut !== after.cut) return null;
    const ts = 2 ** Math.min(before.n, after.n), ps = 2 ** Math.min(before.m, after.m);
    const keys = new Set(), maps = [];
    for (const field of [before, after]) {
      const map = new Map(); maps.push(map);
      const ft = 2 ** field.n, fp = 2 ** field.m;
      for (const cell of field.cells) {
        if (cell.outline || !cell.css) return null;
        const count = Math.ceil((cell.end - cell.t) / ts) * Math.ceil((cell.high - cell.p) / ps);
        if (count > limit) return null;
        map.set(`${Math.floor(cell.t / ft)},${Math.floor(cell.p / fp)}`, cell);
        for (let c = Math.floor(cell.t / ts); c < Math.ceil(cell.end / ts); c++)
          for (let r = Math.floor(cell.p / ps); r < Math.ceil(cell.high / ps); r++) {
            keys.add(`${c},${r}`);
            if (keys.size > limit) return null;
          }
      }
    }
    const count = keys.size, boxes = new Float64Array(count * 4), edges = new Uint8Array(count * 2),
      inks = new Uint16Array(count), colours = [], pairs = new Map(), parsed = new Map();
    function rgb(css) {
      if (parsed.has(css)) return parsed.get(css);
      const values = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/.exec(css);
      const hex = /^#([0-9a-f]{6})$/i.exec(css);
      const result = values ? values.slice(1).map(Number) : hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) : null;
      parsed.set(css, result); return result;
    }
    let index = 0;
    for (const key of keys) {
      const comma = key.indexOf(','), t = Number(key.slice(0, comma)) * ts, p = Number(key.slice(comma + 1)) * ps;
      const a = maps[0].get(`${Math.floor(t / 2 ** before.n)},${Math.floor(p / 2 ** before.m)}`),
        b = maps[1].get(`${Math.floor(t / 2 ** after.n)},${Math.floor(p / 2 ** after.m)}`),
        end = Math.min(t + ts, Math.max(a?.end ?? -Infinity, b?.end ?? -Infinity)), high = p + ps;
      boxes.set([t, end, p, high], index * 4);
      for (let side = 0; side < 2; side++) {
        const cell = side ? b : a;
        edges[index * 2 + side] = cell ? (t === cell.t ? 1 : 0) | (end === cell.end ? 2 : 0) |
          (high === cell.high ? 4 : 0) | (p === cell.p ? 8 : 0) : 0;
      }
      const ac = a?.css ?? ground, bc = b?.css ?? ground, pair = `${ac}|${bc}`;
      let ink = pairs.get(pair);
      if (ink === undefined) {
        const av = rgb(ac), bv = rgb(bc);
        if (!av || !bv) return null;
        ink = colours.length; pairs.set(pair, ink);
        colours.push({ a: av, d: bv.map((value, i) => value - av[i]), start: ac, end: bc, bucket: -1, css: ac });
      }
      inks[index++] = ink;
    }
    return { count, boxes, edges, inks, colours, beforeN: before.n, beforeM: before.m,
      afterN: after.n, afterM: after.m, refining: after.n + after.m <= before.n + before.m };
  }
  function paintSubdivision(context, plan, progress, X, Y, gap = 1) {
    const ease = value => { const p = bounded(value); return p * p * p * (p * (p * 6 - 15) + 10); };
    const detail = ease(plan.refining ? (progress - .08) / .92 : progress / .8),
      seams = ease(plan.refining ? progress / .8 : (progress - .15) / .85), bucket = Math.round(detail * 128),
      oldGap = X(2 ** plan.beforeN) - X(0) > 4 && Y(0) - Y(2 ** plan.beforeM) > 4 ? gap / 2 : 0,
      newGap = X(2 ** plan.afterN) - X(0) > 4 && Y(0) - Y(2 ** plan.afterM) > 4 ? gap / 2 : 0;
    for (const ink of plan.colours) if (ink.bucket !== bucket) {
      ink.bucket = bucket;
      ink.css = bucket === 0 ? ink.start : bucket === 128 ? ink.end :
        `rgb(${Math.round(ink.a[0] + ink.d[0] * bucket / 128)},${Math.round(ink.a[1] + ink.d[1] * bucket / 128)},${Math.round(ink.a[2] + ink.d[2] * bucket / 128)})`;
    }
    const from = oldGap * (1 - seams), to = newGap * seams;
    let previous = -1;
    for (let i = 0; i < plan.count; i++) {
      const j = i * 4, a = plan.edges[i * 2], b = plan.edges[i * 2 + 1];
      const x = X(plan.boxes[j]) + (a & 1 ? from : 0) + (b & 1 ? to : 0),
        y = Y(plan.boxes[j + 3]) + (a & 4 ? from : 0) + (b & 4 ? to : 0),
        w = X(plan.boxes[j + 1]) - (a & 2 ? from : 0) - (b & 2 ? to : 0) - x,
        h = Y(plan.boxes[j + 2]) - (a & 8 ? from : 0) - (b & 8 ? to : 0) - y,
        ink = plan.inks[i];
      if (w <= 0 || h <= 0) continue;
      if (ink !== previous) context.fillStyle = plan.colours[ink].css;
      previous = ink; context.fillRect(x, y, w, h);
    }
  }
  function scrollAxis(element, destination, axis = 'y') {
    const property=axis==='x'?'scrollLeft':'scrollTop', size=axis==='x'?'scrollWidth':'scrollHeight', client=axis==='x'?'clientWidth':'clientHeight';
    if (document.hidden) return;
    const coordinate = axis === 'x' ? 'x' : 'y', other = axis === 'x' ? 'y' : 'x';
    spring(element,'scroll',{from:{x:element.scrollLeft,y:element.scrollTop},to:()=>({
      [coordinate]:Math.max(0,Math.min(element[size]-element[client],typeof destination==='function'?destination():destination)),
      [other]: axis === 'x' ? element.scrollTop : element.scrollLeft}),
      write:({x,y})=>{element.scrollLeft=x;element.scrollTop=y;},complete:()=>cancelMotion(element,'scroll')});
  }

  const api = Object.freeze({ subdivisionPlan, paintSubdivision, stationary: () => presentationHeld || reducedMotion() || document.hidden, replaceChildren, html, captureSize, captureGrid, observeSize, scrollAxis, MOTION, SPRING, MOTION_CSS, integrate, reducedMotion, motionActive, motionValue, spring, cancelMotion, finishMotion, onMotionFrame, reveal, layout, retire, intrinsicHeight, disclosure, resizeContent, watchPanel, scroll, scrollToActor, initMotion });
  if (typeof module === "object" && module.exports) module.exports = api;
  else scope.explorerMotion = api;
})(typeof window === "undefined" ? globalThis : window);
