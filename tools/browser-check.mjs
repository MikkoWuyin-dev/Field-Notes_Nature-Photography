#!/usr/bin/env node
/**
 * Real-browser layout check for index.html.
 *
 * The jsdom and static-CSS suites cannot see layout, so this one drives an actual
 * Chromium. It is deliberately NOT part of `npm test`: it needs a browser binary
 * that CI does not have. Run it by hand when you change anything positioning:
 *
 *   CHROME_PATH=/path/to/chrome npm run test:browser
 *
 * Without CHROME_PATH it prints a skip note and exits 0, so it never breaks a run.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = `file://${join(root, 'index.html')}`;
const executablePath = process.env.CHROME_PATH;

if (!executablePath) {
  console.log('\nskipping the browser check: set CHROME_PATH to a Chromium binary to run it\n');
  process.exit(0);
}

let puppeteer;
try {
  const require = createRequire(import.meta.url);
  puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
} catch (error) {
  console.log('\nskipping the browser check: puppeteer-core is not installed\n');
  process.exit(0);
}

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1440, 900]]) {
  console.log(`\n${width} × ${height}`);
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(pageUrl, { waitUntil: 'networkidle0' });
  // The decorative pals arrive on an idle callback, so give them time to exist.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const state = await page.evaluate(() => {
    const doc = document.documentElement;
    const footer = document.querySelector('.site-footer').getBoundingClientRect();
    const footerBottom = footer.bottom + window.scrollY;
    const shell = document.querySelector('.shell');
    const shellStyle = getComputedStyle(shell);
    const layer = document.querySelector('div[data-piixpal]');
    const layerStyle = layer ? getComputedStyle(layer) : null;
    return {
      scrollHeight: doc.scrollHeight,
      footerBottom,
      // The only legitimate space under the footer is the shell's own bottom padding.
      allowed: parseFloat(shellStyle.paddingBottom) + 1,
      horizontalOverflow: doc.scrollWidth - doc.clientWidth,
      layer: layerStyle ? { overflow: layerStyle.overflow, position: layerStyle.position } : null,
    };
  });

  const blank = state.scrollHeight - state.footerBottom;
  check(`nothing runs past the footer (${blank.toFixed(1)}px, allowed ${state.allowed.toFixed(1)}px)`,
    blank <= state.allowed, `${blank}`);
  check('no sideways overflow', state.horizontalOverflow <= 0, `${state.horizontalOverflow}px`);

  if (state.layer) {
    check('the decoration layer is pinned, not clipped', state.layer.position === 'fixed', state.layer.position);
    check('the layer is not a scroll container', state.layer.overflow !== 'auto' && state.layer.overflow !== 'scroll',
      state.layer.overflow);

    // Worst case: a pal drifts well below the footer. The page must not grow.
    const drift = await page.evaluate(() => {
      const doc = document.documentElement;
      const layer = document.querySelector('div[data-piixpal]');
      const footerBottom = document.querySelector('.site-footer').getBoundingClientRect().bottom + window.scrollY;
      const before = doc.scrollHeight;
      const actor = layer.shadowRoot.querySelector('.a');
      const original = actor.style.transform;
      actor.style.transform = `translate3d(40px, ${Math.round(footerBottom) + 120}px, 0px)`;
      const grew = doc.scrollHeight - before;
      // Put it back, or the checks that follow measure a page with one pal parked
      // at the footer.
      actor.style.transform = original;
      return { grew };
    });
    check('a pal drifting below the footer cannot extend the page', drift.grew === 0, `${drift.grew}px`);
  }

  if (width === 390) {
    /* Pixels, not boxes. Toggling the pals off and on and diffing the same view
       is the only check that cannot be fooled by an element that still has a
       bounding box while being clipped out of sight - which is exactly how five
       of eight pals disappeared unnoticed. */
    const pals = await page.evaluate(() => {
      const layer = document.querySelector('div[data-piixpal]');
      const actors = [...layer.shadowRoot.querySelectorAll('.a')];
      const hosts = [...document.querySelectorAll('piix-pal[data-fieldnotes-pal="site"]')];
      return {
        actors: actors.length,
        hosts: hosts.length,
        unanchored: hosts.filter((h) => !document.querySelector(h.getAttribute('on'))).length,
        status: document.getElementById('pals-status').textContent,
      };
    });
    check('every configured pal is rendered', pals.actors === 14 && pals.hosts === 14,
      `${pals.actors} actors, ${pals.hosts} hosts`);
    check('every pal is anchored to an element that exists', pals.unanchored === 0, `${pals.unanchored} orphaned`);
    check('the count shown to the user matches reality', pals.status.startsWith('14 optional'),
      pals.status);

    /* Hide only the pals layer for the comparison. Toggling them off with the
       button also rewrites the button label and the status line, and that text
       change alone is enough to look like "something was painted". */
    const hidePals = (hidden) => page.evaluate((h) => {
      const layer = document.querySelector('div[data-piixpal]');
      layer.style.visibility = h ? 'hidden' : '';
    }, hidden);
    /* The pals must be spread down the page, not piled at the top: the stage list
       alone is over 2,000px tall on a phone, and a naive "one per heading" list
       left a 3,845px empty stretch there. */
    const spread = await page.evaluate(() => {
      const layer = document.querySelector('div[data-piixpal]');
      const tops = [...layer.shadowRoot.querySelectorAll('.a')]
        .map((a) => Math.round(a.getBoundingClientRect().top + window.scrollY))
        .sort((x, y) => x - y);
      return {
        tops,
        gaps: tops.slice(1).map((t, i) => t - tops[i]),
        page: document.documentElement.scrollHeight,
      };
    });
    const largest = Math.max(...spread.gaps);
    check(`no empty stretch longer than 2000px (largest ${largest}px)`, largest <= 2000, `${largest}px`);
    check('a pal appears in the first screenful', spread.tops[0] < 400, `${spread.tops[0]}px`);
    check('a pal appears near the end of the page', spread.page - spread.tops[spread.tops.length - 1] < 600,
      `${spread.page - spread.tops[spread.tops.length - 1]}px from the end`);

    /* A pal draws on a canvas with pointer-events:auto, so one parked on a button
       or a stage summary swallows the tap. Perfect placement is impossible in the
       collapsed stage run, where every candidate has a clickable row directly
       above it, so this bounds the damage rather than pretending it is zero. */
    const graze = await page.evaluate(() => {
      const layer = document.querySelector('div[data-piixpal]');
      const hosts = [...document.querySelectorAll('piix-pal[data-fieldnotes-pal="site"]')];
      const controls = [...document.querySelectorAll('button,input,a,summary,select')];
      let worst = 0; let who = '';
      [...layer.shadowRoot.querySelectorAll('.a')].forEach((a, i) => {
        const r = a.getBoundingClientRect();
        for (const c of controls) {
          const cr = c.getBoundingClientRect();
          if (!cr.width || !cr.height) continue;
          const ox = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
          const oy = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
          if (ox > 0 && oy > 0 && ox * oy > worst) {
            worst = ox * oy;
            who = `${hosts[i] ? hosts[i].getAttribute('on') : i} over ${c.tagName.toLowerCase()}`;
          }
        }
      });
      return { worst: Math.round(worst), who };
    });
    check(`no pal covers a control by more than 1100px² (worst ${graze.worst}px² ${graze.who})`,
      graze.worst <= 1100, `${graze.worst}px² ${graze.who}`);

    /* The area bound above is generous on purpose. What actually matters to a
       user is whether the point they aim at is reachable, so this finds every
       control whose centre falls inside a pal and hit-tests exactly those.

       Nothing is expanded or mutated here on purpose: an earlier version opened
       all nine stages, which tripled the page height and silently broke every
       check that ran afterwards. Collapsed summaries have centres too, and they
       are the controls most at risk. */
    const centres = await page.evaluate(() => {
      const layer = document.querySelector('div[data-piixpal]');
      const pals = [...layer.shadowRoot.querySelectorAll('.a')].map((a) => {
        const r = a.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      let n = 0;
      const covered = [];
      for (const c of document.querySelectorAll('button, input, a[href], summary, select')) {
        const r = c.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const inside = pals.some((p) => x > p.left && x < p.right && y > p.top && y < p.bottom);
        c.setAttribute('data-hitcheck', String(n));
        if (inside) covered.push({ key: String(n), name: c.tagName.toLowerCase() + (c.id ? '#' + c.id : ''),
          centreY: y + window.scrollY });
        n += 1;
      }
      return { total: n, covered };
    });
    let blocked = 0;
    const blockedNames = [];
    for (const target of centres.covered) {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - window.innerHeight / 2)), target.centreY);
      await new Promise((r) => setTimeout(r, 200));
      const reachable = await page.evaluate((key) => {
        const c = document.querySelector(`[data-hitcheck="${key}"]`);
        if (!c) return true;
        const r = c.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === c || c.contains(hit) || hit.contains(c));
      }, target.key);
      if (!reachable) { blocked += 1; blockedNames.push(target.name); }
    }
    await page.evaluate(() => document.querySelectorAll('[data-hitcheck]').forEach((c) => c.removeAttribute('data-hitcheck')));
    check(`no pal covers the centre of a control (${centres.total} controls, ${centres.covered.length} overlapped, ${blocked} blocked)`,
      blocked === 0, `${blocked} blocked: ${blockedNames.join(', ')}`);

    /* Pick pals spread through the document - first, a middle one, the last -
       and scroll to each. Asserting at fixed scroll offsets would be wrong: the
       page has stretches with no pal nearby, so a zero there means nothing. */
    const palTops = await page.evaluate(() => {
      const layer = document.querySelector('div[data-piixpal]');
      return [...layer.shadowRoot.querySelectorAll('.a')]
        .map((a) => Math.round(a.getBoundingClientRect().top + window.scrollY))
        .sort((x, y) => x - y);
    });
    const picks = [palTops[0], palTops[Math.floor(palTops.length / 2)], palTops[palTops.length - 1]];
    for (const palTop of picks) {
      const scrollTo = Math.max(0, palTop - 300);
      await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
      await new Promise((r) => setTimeout(r, 900));
      const withPals = await page.screenshot({ encoding: 'base64' });
      await hidePals(true);
      await new Promise((r) => setTimeout(r, 200));
      const withoutPals = await page.screenshot({ encoding: 'base64' });
      await hidePals(false);
      const painted = await page.evaluate(async (a, b) => {
        const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, w, h).data;
        ctx.clearRect(0, 0, w, h); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, w, h).data;
        let n = 0;
        for (let i = 0; i < da.length; i += 4) {
          if (Math.abs(da[i] - db[i]) > 12 || Math.abs(da[i + 1] - db[i + 1]) > 12
            || Math.abs(da[i + 2] - db[i + 2]) > 12) n += 1;
        }
        return n;
      }, withPals, withoutPals);
      check(`the pal at document y=${palTop} is actually painted`, painted > 100, `${painted} pixels changed`);
    }
  }

  await page.close();
}

// The pals have three states beyond "on": during the tour, paused, and when the
// visitor asked for reduced motion. Each has its own way of going wrong.
console.log('\npal states');
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

  await page.goto(pageUrl, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => document.getElementById('tour-replay').click());
  await new Promise((r) => setTimeout(r, 2000));
  const during = await page.evaluate(() => ({
    site: document.querySelectorAll('piix-pal[data-fieldnotes-pal="site"]').length,
    tour: document.querySelectorAll('piix-pal[data-fieldnotes-pal="tour"]').length,
    page: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  check('the tour replaces the site pals with its own two', during.site === 0 && during.tour === 2,
    `site ${during.site}, tour ${during.tour}`);
  check('opening the tour does not lengthen the page', during.page <= 9115 + 40, `${during.page}px`);
  await page.evaluate(() => document.getElementById('tour-skip').click());
  await new Promise((r) => setTimeout(r, 800));
  const after = await page.evaluate(() => ({
    site: document.querySelectorAll('piix-pal[data-fieldnotes-pal="site"]').length,
    tour: document.querySelectorAll('piix-pal[data-fieldnotes-pal="tour"]').length,
  }));
  check('the two tour pals are removed when the tour ends', after.tour === 0, `${after.tour} left`);
  check('the site pals come back afterwards', after.site === 14, `${after.site}`);

  await page.evaluate(() => localStorage.setItem('fieldnotes-pals-v1', 'off'));
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));
  const paused = await page.evaluate(() => ({
    pals: document.querySelectorAll('piix-pal').length,
    status: document.getElementById('pals-status').textContent,
  }));
  check('a paused visitor gets no pals at all', paused.pals === 0, `${paused.pals}`);
  check('the status line says they are paused', /paused/i.test(paused.status), paused.status);

  await page.evaluate(() => localStorage.removeItem('fieldnotes-pals-v1'));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));
  const reduced = await page.evaluate(() => ({
    pals: document.querySelectorAll('piix-pal').length,
    status: document.getElementById('pals-status').textContent,
  }));
  check('reduced motion means no pals are created', reduced.pals === 0, `${reduced.pals}`);
  check('and the status line explains why', /reduced-motion/i.test(reduced.status), reduced.status);

  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'all browser checks passed' : `${failures} browser check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
