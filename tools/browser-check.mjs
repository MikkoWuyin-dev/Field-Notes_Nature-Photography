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
      actor.style.transform = `translate3d(40px, ${Math.round(footerBottom) + 120}px, 0px)`;
      return { grew: doc.scrollHeight - before };
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

await browser.close();
console.log(`\n${failures === 0 ? 'all browser checks passed' : `${failures} browser check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
