#!/usr/bin/env node
/**
 * Headless smoke test for index.html.
 *
 * Loads the real page in jsdom, drives the real handlers, and asserts the things
 * that break quietly: counts, progress maths, search/filter results, tour,
 * progress migration, the no-JS fallback and the heading outline.
 *
 *   npm install && npm test
 *
 * jsdom has no layout engine, so canvas, matchMedia, ResizeObserver,
 * IntersectionObserver, scrollIntoView and Blob.text() are stubbed below. Those
 * stubs are test scaffolding, not app behaviour.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'index.html'), 'utf8');
const STORAGE_KEY = 'rll-roadmap-progress-v1:nature-photography-beginner-2026';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function boot({ storage } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (error) => errors.push(error.message.split('\n')[0]));

  const dom = new JSDOM(page, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'https://example.com/',
    beforeParse(window) {
      if (storage) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
      window.matchMedia = (query) => ({
        matches: false, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
      window.Element.prototype.scrollIntoView = function () {};
      const zeroRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      window.Range.prototype.getClientRects = () => [zeroRect];
      window.Range.prototype.getBoundingClientRect = () => zeroRect;
      const makeContext = () => new Proxy(
        { font: '10px monospace', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, canvas: { width: 64, height: 64 } },
        {
          get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'measureText') return () => ({ width: 8, fontBoundingBoxAscent: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
            if (prop === 'getImageData' || prop === 'createImageData') {
              return (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
            }
            if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') return () => ({ addColorStop() {} });
            if (prop === 'createPattern') return () => ({});
            return () => {};
          },
          set(target, prop, value) { target[prop] = value; return true; },
        },
      );
      window.HTMLCanvasElement.prototype.getContext = () => makeContext();
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      if (!window.document.fonts) window.document.fonts = { status: 'loaded', ready: Promise.resolve() };
      window.requestIdleCallback = (cb) => window.setTimeout(() => cb({ didTimeout: false }), 20);
      Object.defineProperty(window.File.prototype, 'text', {
        configurable: true,
        value() {
          return new Promise((resolve, reject) => {
            const reader = new window.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(this);
          });
        },
      });
    },
  });
  return { dom, errors, wait: (ms) => new Promise((r) => setTimeout(r, ms)) };
}

const plainText = page.slice(0, page.indexOf('<script>'));

// ---------------------------------------------------------------- static checks
console.log('\nstatic');
check('no Cloudflare injector left in the artifact', !page.includes('__CF$cv$params'));
check('no-JS fallback block is present', page.includes('<!-- nojs:start'));
const fallback = (page.match(/<!-- nojs:start[\s\S]*?<!-- nojs:end -->/) || [''])[0];
eq('fallback lists every card', (fallback.match(/class="nojs-card"/g) || []).length, 25);
eq('fallback lists every stage', (fallback.match(/class="nojs-stage"/g) || []).length, 9);
eq('fallback lists every outbound link', (fallback.match(/<a href="/g) || []).length, 16);
check('pals payload is inert inside a template', page.includes('<template id="pals-payload">'));
check('pals payload sits inside the template, not the document flow',
  page.indexOf('<template id="pals-payload">') < page.indexOf('<script>/*! Piixpal v0.4.0 | tiny pixel') &&
  page.indexOf('</template>') > page.indexOf('<script>/*! Piixpal v0.4.0 | tiny pixel'));
check('favicon is inline (no extra request)', page.includes('rel="icon" href="data:image/svg+xml'));
check('JSON-LD parses', (() => {
  const raw = (page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  try { return JSON.parse(raw)['@type'] === 'Course'; } catch { return false; }
})());

// ---------------------------------------------------------------- app behaviour
console.log('\nrender');
{
  const { dom, errors, wait } = boot();
  await wait(500);
  const d = dom.window.document;
  eq('9 stages render', d.querySelectorAll('details.stage').length, 9);
  eq('25 cards render', d.querySelectorAll('.resource-card').length, 25);
  eq('counts shown to the user', d.getElementById('roadmap-count').textContent, '9 stages · 25 learning cards');
  eq('no page-level errors', errors.length, 0);
  eq('deferred pals engine renders all 8 pals', d.querySelectorAll('piix-pal[data-fieldnotes-pal="site"]').length, 8);

  const headings = [...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
  const skipped = headings.filter((level, i) => i > 0 && level > headings[i - 1] + 1);
  eq('heading outline never skips a level', skipped.length, 0);

  console.log('\nprogress');
  const box = d.querySelector('.resource-card input[type=checkbox]');
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  eq('checking a card updates the counter', d.getElementById('progress-label').textContent, '1 of 25 practice cards complete');
  eq('today is logged', d.getElementById('today-status').textContent, 'Logged today');
  eq('streak starts at 1', d.getElementById('streak-count').textContent, '1');
  const stored = JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY));
  check('progress is stored under stable card ids',
    Object.keys(stored.done).every((key) => !/^s\d+-r\d+$/.test(key)),
    Object.keys(stored.done).join(','));

  console.log('\nsearch and filters');
  const search = d.getElementById('roadmap-search');
  search.value = 'wildlife';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  eq('search narrows the catalogue', d.getElementById('result-count').textContent, '7 matches in 2 stages');
  search.value = '';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  d.querySelector('[data-filter="portfolio"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  eq('filter shows the portfolio group', d.getElementById('result-count').textContent, '10 learning cards across 4 stages');

  console.log('\ntour');
  d.getElementById('tour-replay').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  check('tour opens', !d.getElementById('tour-layer').hidden);
  eq('tour starts at step 1', d.getElementById('tour-step-count').textContent.trim(), 'STEP 01 / 09');
  d.getElementById('tour-next').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  eq('tour advances', d.getElementById('tour-step-count').textContent.trim(), 'STEP 02 / 09');
  d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes the tour', d.getElementById('tour-layer').hidden);
}

// ---------------------------------------------------------------- migration
console.log('\nmigration');
{
  const { dom, wait } = boot({
    storage: { done: { 's0-r0': true, 's0-r1': true, 's2-r1': true }, activityDates: ['2026-10-24'], reminderTime: '18:30' },
  });
  await wait(500);
  const d = dom.window.document;
  eq('legacy positional keys are migrated', d.getElementById('progress-label').textContent, '3 of 25 practice cards complete');
  eq('legacy reminder time survives', d.getElementById('reminder-time').value, '18:30');
  eq('legacy activity date survives', d.getElementById('today-status').textContent, 'Logged today');
}
{
  const { dom, wait } = boot();
  await wait(500);
  const d = dom.window.document;
  const v1 = JSON.stringify({
    version: 1, title: 'Fieldnotes',
    done: { 's0-r0': true, 's0-r2': true, 'not-a-card': true },
    activityDates: ['2026-10-23'], reminderTime: '07:00',
  });
  const input = d.getElementById('import-progress');
  const file = new dom.window.File([v1], 'progress.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await wait(300);
  eq('a v1 export still imports', d.getElementById('data-status').textContent, 'Progress imported into this browser.');
  eq('imported cards are counted', d.getElementById('progress-label').textContent, '2 of 25 practice cards complete');
  eq('imported reminder time is applied', d.getElementById('reminder-time').value, '07:00');
  const stored = JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY));
  check('unknown keys are rejected on import', !('not-a-card' in stored.done));
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
