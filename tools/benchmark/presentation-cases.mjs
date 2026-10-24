// Fixed inputs and independent semantic expectations for cube-presentation@1.
import assert from 'node:assert/strict';
import { comparisonFixture } from './comparison.mjs';

const sheet = '#ol-sheet-toggle', close = '#ol-sheet-close', side = '#ol-side-toggle';
const sort = '[data-comparison-control="sort"]', basis = '[data-comparison-control="basis"]';
const direction = '[data-comparison-action="direction"]', price = '[data-sort="price"]';
const next = '[data-comparison-action="page"][data-value="next"]';
const cellStart = '2026-09-24T11:05:37.500Z', cellEnd = '2026-09-24T12:01:52.500Z';
const baseMs = 56250, origin = Date.parse('2021-01-01T00:00:00Z');
const keys = rows => rows.map(row => row.key);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparisonIds = (count, reverse = false) => Array.from({ length: count }, (_, i) => 'bench-cell-' + (reverse ? count - i - 1 : i));

export function fixture(definition) {
  if (!definition.id.startsWith('comparison-')) return null;
  const model = comparisonFixture(definition.captures ?? 24);
  model.basis = 'amount';
  if (definition.id === 'comparison-basis-reorder') {
    model.sort = { key: 'volume', direction: 'desc' };
    for (const [i, capture] of model.captures.entries()) {
      const seconds = [56, 28, 14, 7][i % 4];
      capture.observed.t0 = capture.observed.t1 - seconds * 1000;
      capture.observed.seconds = seconds; capture.completeness = 'Partial observed duration';
      for (const metric of ['volume', 'trades', 'delta']) {
        const reading = capture.metrics[metric + '.intensity'];
        reading.value = reading.numerator = capture.metrics[metric + '.amount'].value * 60 / seconds;
      }
    }
  }
  return model;
}

export function definition(raw, group = 'primary') {
  const id = raw.id, phone = id.startsWith('phone-'), cells = id.startsWith('cells-'), comparison = id.startsWith('comparison-');
  let hash = '#w=24h&vis=2', profile = 'bench';
  if (cells) {
    const start = id === 'cells-sort' || id === 'cells-resort-during-motion' ? '2026-09-24T11:43:07.500Z' : cellStart;
    hash = `#t=${start}~${cellEnd}&p=25000~25625&r=0,0&vis=2&tab=cells`; profile = 'uniform';
  }
  if (comparison) hash += '&tab=compare';
  const selectors = phone ? ['#ol-controls', sheet, sheet + ' svg'] :
    id.startsWith('inspector-') ? ['#ol-main', '#ol-canvas', '#ol-side', '#ol-side-body', side, side + ' svg'] :
    cells ? ['#ol-table-body tr', '#ol-table', '#ol-panel-cells', '#ol-table-page', price] :
    comparison ? ['.ol-comparison-card', '.ol-comparison-grid', '.ol-comparison-panes', '.ol-comparison-focus', '#ol-comparisonWorkspace'] :
    id === 'help-css' ? ['#ol-keys', '#ol-help'] : ['.ol-drawer-body', '#ol-panel-cells', '#ol-panel-query', '#ol-main', '#ol-canvas', '[data-drawer]'];
  return { ...raw, group, phone, cells, comparison, hash, profile, selectors,
    inputTypes: ['click', 'change', 'keydown'],
    inputSelectors: phone ? [sheet, close, '#ol-controls', '#ol-canvas'] : comparison ? [sort, basis, direction, next, '[data-comparison-control="selectedMetric"]'] :
      cells ? [price, '#ol-table-next', '#ol-table-back'] : id.startsWith('inspector-') ? [side] : id === 'help-css' ? ['#ol-help'] : ['[data-drawer]'] };
}

export async function settle(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-motion-running]')].some(node => !node.closest('#ol-help-tooltip,#ol-tip,[role="tooltip"]')) &&
    !document.getAnimations().some(a => (a.playState === 'running' || a.pending) && !a.effect?.target?.closest?.('#ol-help-tooltip,#ol-tip,[role="tooltip"]')), null, { timeout: 12000 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function expanded(page, selector, wanted) {
  if ((await page.locator(selector).getAttribute('aria-expanded') === 'true') !== wanted) await page.locator(selector).click();
  await settle(page);
}
export async function prepare(page, d) {
  if (d.phone) {
    await expanded(page, sheet, !['phone-open', 'phone-reduced', 'phone-reverse-100', 'phone-reverse-400'].includes(d.id));
    if (d.id.includes('outside')) await page.locator('#ol-canvas').focus();
    else if (d.id.includes('escape')) await page.locator(close).focus();
  } else if (d.id.startsWith('inspector-')) {
    await expanded(page, side, d.id === 'inspector-close');
  } else if (d.cells) {
    await expanded(page, '#ol-tab-cells', true);
    const heading = page.locator('th').filter({ has: page.locator(price) });
    for (let attempt = 0; attempt < 2 && await heading.getAttribute('aria-sort') !== 'ascending'; attempt++) {
      await page.locator(price).click(); await settle(page);
    }
    assert.equal(await heading.getAttribute('aria-sort'), 'ascending');
    while (!(await page.locator('#ol-table-back').isDisabled())) { await page.locator('#ol-table-back').click(); await settle(page); }
    if (d.id === 'cells-previous') { await page.locator('#ol-table-next').click(); await settle(page); }
    assert.equal(await page.locator('#ol-table-body tr').count(), 100, 'The measured page must contain 100 real rows');
    const count = d.id === 'cells-sort' || d.id === 'cells-resort-during-motion' ? 100 : 300;
    assert.match(await page.locator('#ol-table-page').getAttribute('title'), new RegExp('of ' + count + '$'));
  } else if (d.comparison) {
    await expanded(page, '#ol-tab-compare', true);
    await expanded(page, '[data-comparison-action="expand"]', true);
    await page.locator(sort).selectOption(d.id === 'comparison-basis-reorder' ? 'volume' : 'time');
    await page.locator(basis).selectOption('amount');
    const wanted = d.id === 'comparison-basis-reorder' ? 'Descending' : 'Ascending';
    if (!(await page.locator(direction).textContent()).includes(wanted)) await page.locator(direction).click();
    await page.locator('[data-comparison-control="selectedMetric"]').selectOption('volume');
    const previous = page.locator('[data-comparison-action="page"][data-value="previous"]');
    while (!await previous.isDisabled()) { await previous.click(); await settle(page); }
    await settle(page); assert.equal(await page.locator('.ol-comparison-card').count(), 24);
    assert.match(await page.locator('.ol-comparison-summary').textContent(), new RegExp('^' + (d.captures ?? 24) + ' cells'));
  } else if (d.id === 'help-css') {
    if (await page.locator('#ol-keys').evaluate(node => node.open)) { await page.keyboard.press('Escape'); await settle(page); }
  } else {
    if (d.id === 'drawer-open') {
      const active = page.locator('[data-drawer][aria-expanded="true"]');
      if (await active.count()) { await active.click(); await settle(page); }
    }
    await expanded(page, '#ol-tab-cells', d.id !== 'drawer-open');
  }
  await page.mouse.move(0, 0); await settle(page);
}
export async function act(page, d) {
  if (d.group === 'continuity') {
    // Native locator actionability waits for stability. Controlled dispatch is
    // deliberately untrusted here so reversals can interrupt moving controls.
    return page.evaluate(async ({ id, delay }) => {
      const click = selector => document.querySelector(selector).click();
      const select = (selector, value) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
      const pause = () => new Promise(done => setTimeout(done, delay));
      if (id.startsWith('phone-') || id.startsWith('inspector-')) {
        const selector = id.startsWith('phone-') ? '#ol-sheet-toggle' : '#ol-side-toggle';
        click(selector); await pause(); click(selector); await pause(); click(selector);
      } else if (id === 'cells-resort-during-motion') { click('[data-sort="price"]'); await pause(); click('[data-sort="price"]'); }
      else if (id === 'cells-page-during-retirement') { click('#ol-table-next'); await pause(); click('#ol-table-back'); }
      else { select('[data-comparison-control="sort"]', 'volume'); await pause(); select('[data-comparison-control="sort"]', 'time'); }
    }, { id: d.id, delay: d.delayMs });
  }
  if (d.id === 'phone-close-outside') return page.locator(close).evaluate(node => node.click());
  if (d.id.includes('escape')) return page.keyboard.press('Escape');
  if (d.phone) return page.locator(d.id === 'phone-close' ? close : sheet).click();
  if (d.id.startsWith('inspector-')) return page.locator(side).click();
  if (d.cells) return page.locator(d.id === 'cells-sort' ? price : d.id === 'cells-previous' ? '#ol-table-back' : '#ol-table-next').click();
  if (d.id === 'comparison-sort' || d.id === 'comparison-membership') return page.locator(sort).selectOption('volume');
  if (d.id === 'comparison-direction') return page.locator(direction).click();
  if (d.id === 'comparison-basis-reorder') return page.locator(basis).selectOption('intensity');
  if (d.id === 'comparison-reading') return page.locator('[data-comparison-control="selectedMetric"]').selectOption('size');
  if (d.id === 'comparison-next') return page.locator(next).click();
  return page.locator(d.id === 'help-css' ? '#ol-help' : d.id === 'drawer-tab' ? '#ol-tab-query' : '#ol-tab-cells').click();
}

function cellOrder(d, descending, page = 0) {
  const count = d.id === 'cells-sort' || d.id === 'cells-resort-during-motion' ? 20 : 60;
  const end = Math.round((Date.parse(cellEnd) - origin) / baseMs), result = [];
  for (let r = descending ? 204 : 200; descending ? r >= 200 : r <= 204; r += descending ? -1 : 1)
    for (let c = end - 1; c >= end - count; c--) result.push(`0:0:${c}:${r}`);
  return result.slice(page * 100, (page + 1) * 100);
}
export function validate(trace, d) {
  const { before: a, after: b } = trace.semantic, checks = [];
  const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  let expected;
  if (d.phone) {
    expected = ['phone-open', 'phone-reduced', 'phone-reverse-100', 'phone-reverse-400'].includes(d.id) ? 'open' : 'closed';
    check('logical sheet destination', b.sheet === expected && b.sheetExpanded === String(expected === 'open'));
    trace.compatibility = { immediateFocus: trace.ack?.state.focus, firstFrameFocus: trace.frames.find(frame => frame.at >= trace.ack?.at)?.focus,
      finalFocus: b.focus, immediateInteractivity: trace.ack?.state.sheetInteractivity, expectedCloseFocus: d.id.includes('outside') ? 'ol-canvas' : 'ol-sheet-toggle' };
  } else if (d.id.startsWith('inspector-')) check('inspector destination', b.sideExpanded === String(d.id !== 'inspector-close'));
  else if (d.cells) {
    const page = d.id === 'cells-next' ? 1 : 0, descending = d.id === 'cells-sort';
    check('100 real destination rows in exact independent order', b.rows.length === 100 && eq(keys(b.rows), cellOrder(d, descending, page)));
    if (d.id === 'cells-sort' || d.id === 'cells-resort-during-motion')
      check('retained row identity and direct readings', b.rows.every(row => a.rows.some(old => old.key === row.key && old.node === row.node && old.text === row.text)));
  } else if (d.comparison) {
    expected = comparisonIds(24);
    if (['comparison-sort', 'comparison-direction'].includes(d.id)) expected.reverse();
    if (d.id === 'comparison-membership') expected = comparisonIds(128, true).slice(0, 24);
    if (d.id === 'comparison-next') expected = comparisonIds(128).slice(24, 48);
    if (d.id === 'comparison-basis-reorder') expected = Array.from({ length: 24 }, (_, i) => i).sort((a, b) => (b + 1) / [56, 28, 14, 7][b % 4] - (a + 1) / [56, 28, 14, 7][a % 4] || a - b).map(i => 'bench-cell-' + i);
    check('24 cards with exact independent destination order', b.cards.length === 24 && eq(keys(b.cards), expected));
    if (!['comparison-membership', 'comparison-next'].includes(d.id)) check('retained capture identity', b.cards.every(row => a.cards.some(old => old.key === row.key && old.node === row.node)));
    if (d.id === 'comparison-reading') check('immediate size reading with unchanged order', trace.ack?.state.cards.every(row => row.metrics.some(m => m.primary && m.key === 'size' && Number(m.canonical) === 1)) && eq(keys(a.cards), keys(b.cards)));
    if (d.id === 'comparison-basis-reorder') check('immediate intensity readings', trace.ack?.state.comparison.basis === 'intensity' && trace.ack.state.cards.every(row => row.metrics.some(m => m.primary && m.key === 'volume' && Math.abs(Number(m.canonical) - (Number(row.key.split('-').at(-1)) + 1) * 60 / [56, 28, 14, 7][Number(row.key.split('-').at(-1)) % 4]) < 1e-9)));
  } else if (d.id === 'help-css') check('CSS help destination and observer positive control', b.keysOpen && trace.cssAnimations.length > 0);
  else check('drawer logical destination', eq(b.drawer, d.id === 'drawer-close' ? [] : [d.id === 'drawer-tab' ? 'ol-tab-query' : 'ol-tab-cells']));
  check('retirement ghosts are inert and stripped of descendant IDs', trace.actors.filter(actor => actor.ghost).every(actor => actor.ghostSafe));
  const generations = new Map();
  for (const event of trace.channels) {
    if (event.type === 'spring' && event.before?.active) check('retarget retains existing velocity', Object.entries(event.before.velocity).every(([key, value]) => Math.abs(event.velocity[key] - value) < 1e-9));
    if (event.type === 'spring') generations.set(event.channel, event.generation);
    if (event.type === 'callback') check('completion belongs to latest channel generation', generations.get(event.channel) === event.generation);
  }
  trace.validation = checks;
  trace.semantic.changed = d.group === 'continuity' ? trace.acks.some(ack => !eq(d.phone ? ack.state.sheet : d.comparison ? keys(ack.state.cards) : d.cells ? keys(ack.state.rows) : ack.state.sideExpanded, d.phone ? a.sheet : d.comparison ? keys(a.cards) : d.cells ? keys(a.rows) : a.sideExpanded)) :
    d.phone ? a.sheet !== b.sheet : d.cells ? !eq(keys(a.rows), keys(b.rows)) : d.comparison ? !eq(keys(a.cards), keys(b.cards)) || d.id === 'comparison-reading' && a.comparison.selectedMetric !== b.comparison.selectedMetric : d.id.startsWith('inspector-') ? a.sideExpanded !== b.sideExpanded : d.id === 'help-css' ? a.keysOpen !== b.keysOpen : !eq(a.drawer, b.drawer);
  for (const failed of checks.filter(check => !check.ok)) trace.invalidReasons.push(failed.name);
  return trace;
}
