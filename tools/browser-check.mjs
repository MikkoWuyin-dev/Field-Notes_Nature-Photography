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
      layer: layerStyle ? { overflow: layerStyle.overflow, clipMargin: layerStyle.overflowClipMargin } : null,
    };
  });

  const blank = state.scrollHeight - state.footerBottom;
  check(`nothing runs past the footer (${blank.toFixed(1)}px, allowed ${state.allowed.toFixed(1)}px)`,
    blank <= state.allowed, `${blank}`);
  check('no sideways overflow', state.horizontalOverflow <= 0, `${state.horizontalOverflow}px`);

  if (state.layer) {
    check('the decoration layer is clipped', state.layer.overflow === 'clip', state.layer.overflow);
    check('the clip margin is large enough to keep every pal visible',
      parseFloat(state.layer.clipMargin) > Math.max(width, height) * 1.5, state.layer.clipMargin);

    // Worst case: a pal drifts well below the footer. The page must not grow.
    const drift = await page.evaluate(() => {
      const doc = document.documentElement;
      const layer = document.querySelector('div[data-piixpal]');
      const footerBottom = document.querySelector('.site-footer').getBoundingClientRect().bottom + window.scrollY;
      const before = doc.scrollHeight;
      const actor = layer.shadowRoot.querySelector('.a');
      actor.style.transform = `translate3d(40px, ${Math.round(footerBottom) + 120}px, 0px)`;
      const painted = [...layer.shadowRoot.querySelectorAll('.a canvas')]
        .filter((canvas) => canvas.getBoundingClientRect().width > 0).length;
      return { grew: doc.scrollHeight - before, painted };
    });
    check('a pal drifting below the footer cannot extend the page', drift.grew === 0, `${drift.grew}px`);
    check('the pals are still drawn', drift.painted > 0, `${drift.painted} canvases`);
  }

  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'all browser checks passed' : `${failures} browser check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
