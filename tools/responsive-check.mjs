#!/usr/bin/env node
/**
 * Responsive layout checks for index.html.
 *
 * There is no browser engine available in CI (or in this repo's toolchain), so
 * these are static checks on the stylesheet: which rules win at a given viewport,
 * how much horizontal space the nesting chrome consumes, and whether the two
 * classic mobile bugs are absent:
 *
 *   1. a flex/grid item that refuses to shrink (`flex:none`) and so pushes past
 *      its parent's edge;
 *   2. fixed px track/width sums that exceed the space a phone actually has.
 *
 *   npm run test:responsive
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ------------------------------------------------------------------ parser */

/** Split the stylesheet into { context, selector, decls } records. */
function parse(source) {
  const rules = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) break;
    const head = source.slice(i, open).trim();
    let depth = 0;
    let j = open;
    for (; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = source.slice(open + 1, j);
    if (head.startsWith('@media')) {
      const condition = head.slice(6).trim();
      for (const inner of parse(body)) rules.push({ ...inner, context: condition });
    } else if (head.startsWith('@')) {
      // @page and friends: no selectors we care about
    } else {
      const decls = {};
      for (const chunk of body.split(';')) {
        const idx = chunk.indexOf(':');
        if (idx === -1) continue;
        const prop = chunk.slice(0, idx).trim();
        const value = chunk.slice(idx + 1).trim();
        if (prop) decls[prop] = value;
      }
      for (const selector of head.split(',')) rules.push({ context: null, selector: selector.trim(), decls });
    }
    i = j + 1;
  }
  return rules;
}

const rules = parse(css);

/** Evaluate min-width/max-width media conditions at a viewport width. */
function contextMatches(context, width) {
  if (!context) return true;
  // Only width-based queries describe screen layout. print and
  // prefers-reduced-motion must never contribute to the measurements below.
  if (/(^|[^-])print|prefers-reduced-motion|prefers-color-scheme/.test(context)) return false;
  const min = context.match(/min-width:\s*(\d+)px/);
  const max = context.match(/max-width:\s*(\d+)px/);
  if (min && width < Number(min[1])) return false;
  if (max && width > Number(max[1])) return false;
  return true;
}

/** Cascade a single selector at a width; later rules win, media rules sit inline. */
function resolve(selector, width = 0) {
  const out = {};
  for (const rule of rules) {
    if (rule.selector !== selector) continue;
    if (!contextMatches(rule.context, width)) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}

/** Evaluate clamp(a, b, c) / `NNvw` / `NNpx` / plain rems into px at a width. */
/** First length in a shorthand such as `4px solid var(--cyan)`. */
function leadingLength(value) {
  const m = /^(-?[\d.]+)(px|rem|vw)\b/.exec(value.trim());
  return m ? m[0] : value.trim();
}

function px(value, width, rootPx = 16) {
  if (!value) return 0;
  if (typeof value !== 'string') return 0;
  const v = leadingLength(value);
  if (v.endsWith('rem')) return parseFloat(v) * rootPx;
  if (v.endsWith('px')) return parseFloat(v);
  if (v.endsWith('vw')) return (parseFloat(v) / 100) * width;
  if (v === '0') return 0;
  return 0;
}

function clampPx(value, width) {
  const m = /^clamp\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(value.trim());
  if (!m) return px(value, width);
  const lo = px(m[1], width);
  const preferred = px(m[2], width);
  const hi = px(m[3], width);
  return Math.max(lo, Math.min(preferred, hi));
}

function sideSum(decls, boxProps, width) {
  let total = 0;
  for (const prop of boxProps) {
    const value = decls[prop];
    if (!value) continue;
    const parts = value.split(/\s+/);
    if (parts.length === 1) total += 2 * (clampPx(parts[0], width) || 0);
    else if (parts.length === 2) total += 2 * (clampPx(parts[1], width) || 0);
    else if (parts.length >= 3) total += (clampPx(parts[1], width) || 0) + (clampPx(parts[3] ?? parts[1], width) || 0);
  }
  return total;
}

/** Visual box height plus any pseudo-element that extends the hit area. */
function effectiveTarget(selector, width) {
  const decls = resolve(selector, width);
  const content = clampPx((resolve('.checkmark', width)['height'] || resolve('.checkmark', width)['width'] || '0'), width);
  const minHeight = clampPx(decls['min-height'] || decls['height'] || '0', width);
  const box = Math.max(content, minHeight) + horizontalChrome(selector, width) - 0;
  const padV = (() => {
    const parts = (decls.padding || '0').split(/\s+/);
    const val = parts.length === 1 ? parts[0] : parts[0];
    return 2 * (clampPx(val, width) || 0);
  })();
  const borderV = (() => {
    const b = decls.border || '0';
    const m = /(-?[\d.]+)(px|rem)/.exec(b);
    return m ? 2 * clampPx(m[1] + m[2], width) : 0;
  })();
  const raw = Math.max(content, minHeight) + padV + borderV;
  const after = resolve(`${selector}::after`, width);
  const inset = /(-?[\d.]+)px/.exec(after.inset || '');
  const expand = inset ? Math.abs(Number(inset[1])) * 2 : 0;
  return { box: raw, effective: Math.max(raw, raw + expand), expand };
}

const horizontalChrome = (selector, width) => {
  const decls = resolve(selector, width);
  return sideSum(decls, ['padding', 'padding-left', 'padding-right', 'border', 'border-left', 'border-right', 'border-left-width', 'border-right-width', 'border-width'], width);
};

/** Sum of fixed px grid tracks plus their gaps. */
function gridMin(selector, width) {
  const decls = resolve(selector, width);
  const template = decls['grid-template-columns'];
  if (!template) return { fixed: 0, tracks: 0 };
  const tracks = template.split(/\s+(?![^(]*\))/).filter((t) => t && !t.startsWith('minmax') && !t.startsWith('repeat'));
  const fixed = tracks.reduce((sum, t) => sum + (clampPx(t, width) || 0), 0);
  const gap = decls.gap || '0';
  const gapParts = gap.split(/\s+/);
  const columnGap = clampPx(gapParts.length > 1 ? gapParts[1] : gapParts[0], width) || 0;
  return { fixed, tracks: tracks.length, columnGap };
}

/* ------------------------------------------------------------------- checks */

console.log('\nmobile-first structure');
const layoutQueries = [...new Set(rules.filter((r) => r.context).map((r) => r.context))]
  .filter((c) => /width/.test(c) && !/print/.test(c));
eq('every width breakpoint is min-width', layoutQueries.filter((c) => /max-width/.test(c)).length, 0);
check('breakpoints exist', layoutQueries.length >= 3, layoutQueries.join(' | '));

const stacked = ['.brief', '.resource-grid', '.rec-grid', '.guardrails', '.field-kit-grid', '.outcomes', '.tag-key', '.filters', '.tour-invite'];
for (const selector of stacked) {
  const base = resolve(selector, 320);
  const template = base['grid-template-columns'] || '';
  check(`${selector} is one column at 320px`, template === '1fr' || template === 'minmax(0,1fr)', template);
}

console.log('\nspace budget at 320px (chrome = shell + main + panel)');
const shell = horizontalChrome('.shell', 320);
const main = horizontalChrome('main', 320);
const panel = horizontalChrome('.panel', 320);
const content = 320 - shell - main;
const panelText = content - panel;
check('shell + main + panel leave >70% of the viewport for text', panelText / 320 > 0.7,
  `${Math.round(panelText)}px of 320px (${Math.round((panelText / 320) * 100)}%)`);
check('panel text column is at least 200px (≈25 chars)', panelText >= 200, `${Math.round(panelText)}px`);

console.log('\nintrinsic widths fit the phone');
{
  const stage = horizontalChrome('.stage', 320);
  const stageBody = horizontalChrome('.stage-body', 320);
  const summary = gridMin('.stage-summary', 320) ;
  const summaryMin = summary.fixed + Math.max(0, summary.tracks - 1) * summary.columnGap + horizontalChrome('.stage-summary', 320);
  check('.stage-summary minimum width fits', summaryMin <= content - stage, `${Math.round(summaryMin)}px of ${Math.round(content - stage)}px`);

  const card = gridMin('.card-top', 320);
  const cardMin = card.fixed + Math.max(0, card.tracks - 1) * card.columnGap
    + horizontalChrome('.resource-card', 320) + stage + stageBody;
  check('.resource-card chrome + fixed tracks fit', cardMin <= content, `${Math.round(cardMin)}px of ${Math.round(content)}px`);

  const tour = resolve('.tour-panel', 320);
  check('.tour-panel stays inside the viewport', tour.left === '12px' && tour.right === '12px' && tour.width === 'auto',
    `left:${tour.left} right:${tour.right} width:${tour.width}`);
}

console.log('\nno element is allowed to refuse to shrink');
const shrinkGuards = [
  ['.tag', ['max-width', 'overflow-wrap']],
  ['.category h3', ['max-width', 'overflow-wrap']],
  ['.hero-meta span', ['max-width', 'overflow-wrap']],
  ['.status', ['max-width', 'overflow-wrap']],
  ['.resource-card h5', ['overflow-wrap']],
];
for (const [selector, props] of shrinkGuards) {
  const decls = resolve(selector, 320);
  check(`${selector} can wrap inside its container`,
    decls['flex'] !== 'none' && props.every((p) => decls[p]),
    JSON.stringify({ flex: decls.flex, ...Object.fromEntries(props.map((p) => [p, decls[p]])) }));
}
eq('body breaks long words rather than overflowing', resolve('body', 320)['overflow-wrap'], 'break-word');

console.log('\nshort labels never split mid-word');
// `overflow-wrap:anywhere` also shrinks an element's intrinsic minimum width, so a
// flex parent can squeeze a one-word chip until the word breaks in half ("LEA/RN").
// `break-word` only breaks a word that genuinely cannot fit on its own line.
for (const selector of ['.tag', '.status', '.hero-meta span', '.category h3']) {
  const decls = resolve(selector, 390);
  check(`${selector} uses break-word, not anywhere`, decls['overflow-wrap'] === 'break-word',
    String(decls['overflow-wrap']));
}
{
  const item = resolve('.tag-key .tag', 390);
  eq('chips in the tag key never shrink', item['flex'], 'none');
}
check('long-token text still breaks when it truly cannot fit',
  resolve('.resource-card h5', 390)['overflow-wrap'] === 'anywhere');

console.log('\nspacing is tight on phones');
{
  const shellAt320 = horizontalChrome('.shell', 320);
  const shellAt1200 = horizontalChrome('.shell', 1200);
  check('side gutter is at most 8px per side at 320px', shellAt320 <= 16, `${shellAt320}px total`);
  check('side gutter is at most 14px per side on desktop', shellAt1200 <= 28, `${shellAt1200}px total`);
  const budget = (320 - horizontalChrome('.shell', 320) - horizontalChrome('main', 320) - horizontalChrome('.panel', 320)) / 320;
  check('text gets more than 75% of a 320px screen', budget > 0.75, `${Math.round(budget * 100)}%`);
}

console.log('\nhero decoration stays behind everything');
{
  const grid = resolve('.hero::after', 390);
  const inner = resolve('.hero-inner', 390);
  eq('the decoration is on layer 0', grid['z-index'], '0');
  eq('the hero content is above it on layer 1', inner['z-index'], '1');
  eq('the hero forms its own stacking context', resolve('.hero', 390).isolation, 'isolate');
  check('the decoration cannot be clicked or focused', grid['pointer-events'] === 'none');
  check('the decoration fades out toward the text',
    (grid['mask-image'] || grid['-webkit-mask-image'] || '').includes('linear-gradient'),
    String(grid['mask-image'] || grid['-webkit-mask-image']));
  for (const width of [320, 390]) {
    const size = clampPx(grid.width, width);
    check(`the decoration is capped at phone size (${width}px → ${Math.round(size)}px)`, size <= 130, `${size}px`);
  }
}
{
  // A translucent chip lets the pattern read through it, which looks like the
  // decoration is in front. Keep the chip opaque enough to sit clearly above it.
  const chip = resolve('.hero-meta span', 390);
  const alpha = /rgba?\([^)]*?([\d.]+)\s*\)$/.exec(chip.background || '');
  const value = alpha ? Number(alpha[1]) : 1;
  check('hero chips are opaque enough to hide the pattern behind them', value >= 0.5, `alpha ${value}`);
}

console.log('\nstage header corners');
for (const width of [320, 390, 768]) {
  const number = resolve('.stage-summary .number', width);
  const chevron = resolve('.stage-summary .stage-chevron', width);
  eq(`number sits at the top-left at ${width}px`,
    `${number['grid-column']}/${number['align-self']}`, '1/start');
  eq(`plus-minus sits at the top-right at ${width}px`,
    `${chevron['grid-column']}/${chevron['align-self']}`, '3/start');
}
{
  const number = resolve('.stage-summary .number', 1200);
  const chevron = resolve('.stage-summary .stage-chevron', 1200);
  eq('desktop header keeps one balanced row (number centred)',
    `${number['grid-column']}/${number['align-self']}`, 'auto/auto');
  eq('desktop header keeps one balanced row (plus-minus centred)',
    `${chevron['grid-column']}/${chevron['align-self']}`, 'auto/auto');
}

console.log('\nfixed bugs stay fixed');
check('.card-top has a standalone rule (was a doubled selector that never matched)',
  rules.some((r) => r.selector === '.card-top' && !r.context));
check('no doubled class selector anywhere',
  rules.every((r) => {
    const classes = r.selector.match(/\.[a-z0-9-]+/gi) || [];
    return new Set(classes).size === classes.length;
  }));
check('.stage-number selector is gone (element has class "number")',
  !rules.some((r) => r.selector.includes('.stage-number')));

console.log('\ntap targets at least 44px');
for (const selector of ['.filter-button', '.tour-close', '.search-clear', '.tour-skip', '.source', '.access-details summary', '.pals-controls button']) {
  const decls = resolve(selector, 320);
  const height = clampPx(decls['min-height'] || decls['height'] || '0', 320);
  check(`${selector} ≥ 44px`, height >= 44, `${height}px`);
}
{
  // The Done control is deliberately shorter than 44px so it does not look like a
  // slab, with an invisible ::after restoring the full touch target around it.
  const target = effectiveTarget('.done-control', 320);
  check('Done box is compact (under 40px tall)', target.box < 40, `${target.box}px`);
  check('Done touch target still ≥ 44px once the hit area counts', target.effective >= 44,
    `${target.effective}px = ${target.box}px box + ${target.expand}px expansion`);
  const padding = resolve('.done-control', 320).padding;
  const parts = padding.split(/\s+/);
  eq('Done padding is equal on all four sides', new Set(parts).size, 1);
}

console.log('\ncard footer row');
for (const width of [320, 768, 1200]) {
  const foot = resolve('.card-foot', width);
  eq(`source link and Done share the bottom row at ${width}px`, foot['justify-content'], 'space-between');
  eq(`the row is a single flex line at ${width}px`, foot.display, 'flex');
}
for (const width of [320, 1200]) {
  eq(`card header is number + text only at ${width}px`,
    resolve('.card-top', width)['grid-template-columns'], '29px minmax(0,1fr)');
}

console.log('\ndesktop is unchanged');
{
  const at = (selector, prop) => resolve(selector, 1200)[prop];
  eq('.brief returns to two columns', at('.brief', 'grid-template-columns'), '1.2fr .8fr');
  eq('.stage-summary returns to five columns', at('.stage-summary', 'grid-template-columns')?.split(' ').length >= 5, true);
  eq('.resource-card regains its min-height', at('.resource-card', 'min-height'), '360px');
  eq('.card-top stays two columns (Done moved to the footer)', at('.card-top', 'grid-template-columns'), '29px minmax(0,1fr)');
  eq('.filters returns to search + buttons in one row', at('.filters', 'grid-template-columns'), 'minmax(0,1fr) auto');
}

console.log('\nthe guided tour never covers the section it is explaining');
{
  /* The placement maths ships inside index.html (the app is one file), so pull
     the marked block out and exercise it directly. No browser needed.

     Crucially these checks do not trust the returned delta. They apply it to the
     scroll position and recompute where the element would actually land, using
     the same identity the browser uses (rect.top = absoluteTop - scrollY). An
     inverted sign therefore fails loudly instead of agreeing with itself. */
  const marked = html.match(/\/\* @tour-placement:start[\s\S]*?@tour-placement:end \*\//);
  check('the tour placement block is still present in index.html', marked !== null);
  const tourPlacement = new Function(`${marked[0]}; return tourPlacement;`)();

  const panelHeight = (viewportHeight) => Math.min(viewportHeight * 0.4, 360);
  const simulate = (options) => {
    const viewportHeight = options.viewportHeight;
    const mapScroll = options.maxScroll ?? Math.max(0, (options.documentHeight ?? 6000) - viewportHeight);
    const scrollY = options.scrollY ?? 1200;
    const height = options.panelHeight ?? panelHeight(viewportHeight);
    const panelTop = options.side === 'top' ? 12 : viewportHeight - 12 - height;
    const absoluteTop = options.targetTop + scrollY;
    const result = tourPlacement({
      side: options.side, targetTop: options.targetTop, targetHeight: options.targetHeight,
      panelTop, panelHeight: height, viewportHeight, scrollY, maxScroll: mapScroll,
      edge: options.edge, gap: options.gap,
    });
    const newScroll = Math.max(0, Math.min(mapScroll, scrollY + result.delta));
    const finalTop = absoluteTop - newScroll;
    return { ...result, absoluteTop, newScroll, finalTop, finalBottom: finalTop + options.targetHeight };
  };
  const insideBand = (s) => s.finalTop >= s.bandTop - 0.5 && s.finalBottom <= s.bandBottom + 0.5;

  /* A phone, panel at the bottom, section parked dead centre (y=422 on a 390x844
     screen). This is the reported bug. */
  const phone = { viewportHeight: 844, side: 'bottom' };
  const centred = simulate({ ...phone, targetTop: 422, targetHeight: 120 });
  check('a centred section ends up clear of a bottom panel', insideBand(centred), JSON.stringify(centred));
  check('the section rises up the screen', centred.finalTop < 422, `${centred.finalTop}`);
  check('that means scrolling down the page', centred.delta > 0, `${centred.delta}px`);
  eq('it lands at the first position where it fits', Math.round(centred.finalTop), 356);

  /* Panel at the top: the band is below it, so the section drops down the screen. */
  const topDocked = simulate({ viewportHeight: 844, side: 'top', targetTop: 190, targetHeight: 120 });
  check('a section above a top panel ends up below it', insideBand(topDocked), JSON.stringify(topDocked));
  check('the section drops down the screen', topDocked.finalTop > 190, `${topDocked.finalTop}`);
  check('that means scrolling up the page', topDocked.delta < 0, `${topDocked.delta}px`);
  check('it stops just under the panel gap',
    Math.abs(topDocked.finalTop - (12 + panelHeight(844) + 18)) < 0.5, `${topDocked.finalTop}`);

  /* The smallest phone we target. */
  const small = simulate({ viewportHeight: 568, side: 'bottom', targetTop: 400, targetHeight: 96 });
  check('a 320x568 phone also keeps the section clear', insideBand(small), JSON.stringify(small));

  /* A section taller than the free band cannot fit; it must show its top. */
  const tall = simulate({ ...phone, targetTop: 300, targetHeight: 900 });
  check('an oversized section starts at the top of the free band', Math.abs(tall.finalTop - tall.bandTop) < 0.5,
    `${tall.finalTop} vs ${tall.bandTop}`);

  /* A page too short to scroll: only the dock side can save the section, so the
     caller must be told the section is still covered. */
  const shortPage = { viewportHeight: 844, targetTop: 600, targetHeight: 60, scrollY: 0, maxScroll: 0 };
  const stuck = simulate({ ...shortPage, side: 'bottom' });
  check('a bottom panel on an unscrollable page reports the section as covered', !insideBand(stuck),
    JSON.stringify(stuck));
  const flipped = simulate({ ...shortPage, side: 'top' });
  check('flipping to the top clears the same section', insideBand(flipped), JSON.stringify(flipped));

  /* Scroll limits are respected in both directions. */
  const atTop = simulate({ ...phone, targetTop: 0, targetHeight: 60, scrollY: 0 });
  eq('never scrolls above the top of the document', atTop.delta, 0);
  const atEnd = simulate({ ...phone, targetTop: 900, targetHeight: 60, scrollY: 6000, maxScroll: 6000 });
  eq('never scrolls past the end of the document', atEnd.delta, 0);

  /* A section already in the clear must not be moved at all. */
  const alreadyClear = simulate({ ...phone, targetTop: 120, targetHeight: 100 });
  eq('a section already in the clear is left alone', alreadyClear.delta, 0);

  /* Custom edge and gap are honoured. */
  const custom = simulate({ ...phone, targetTop: 422, targetHeight: 120, edge: 4, gap: 30 });
  check('custom edge and gap are respected', Math.abs(custom.bandBottom - (844 - 12 - panelHeight(844) - 30)) < 0.5,
    `${custom.bandBottom}`);

  /* The identity the whole fix rests on: a positive delta must move an element
     *up* the screen. If this ever inverts, everything above is meaningless. */
  const sanity = tourPlacement({
    side: 'bottom', targetTop: 500, targetHeight: 100, panelTop: 494, panelHeight: 338,
    viewportHeight: 844, scrollY: 1000, maxScroll: 5000,
  });
  check('a positive delta moves the element up the screen, not down', 500 - sanity.delta < 500,
    `delta ${sanity.delta}`);
}
{
  /* Panel budget on phones and the fact that the buttons cannot scroll away. */
  for (const [viewport, height] of [[320, 568], [390, 844], [430, 932]]) {
    const panel = resolve('.tour-panel', viewport);
    const cap = /min\(\s*([\d.]+)dvh\s*,\s*(\d+)px\s*\)/.exec(panel['max-height'] || '');
    check(`the panel has a dvh cap at ${viewport}px`, cap !== null, String(panel['max-height']));
    const share = Math.min(Number(cap[1]) / 100 * height, Number(cap[2])) / height;
    check(`the panel takes at most 42% of a ${height}px screen (${Math.round(share * 100)}%)`, share <= 0.42,
      `${share}`);
    eq(`the panel cannot scroll as one block at ${viewport}px`, panel.overflow, 'hidden');
    eq(`the panel is a column at ${viewport}px`, panel['flex-direction'], 'column');
  }
  eq('the scrolling middle can shrink', resolve('.tour-body', 390)['min-height'], '0');
  eq('the scrolling middle is the only scrolling part', resolve('.tour-body', 390).overflow, 'auto');
  eq('the button row is fixed in place', resolve('.tour-controls', 390).flex, 'none');
  eq('the header row is fixed in place', resolve('.tour-head', 390).flex, 'none');
  for (const side of ['left', 'right']) {
    eq(`the panel inset matches on the ${side}`, resolve(`.tour-panel-bottom-${side}`, 390)[side], '12px');
  }
  eq('the panel inset matches at the bottom', resolve('.tour-panel-bottom-right', 390).bottom, '12px');
  eq('the desktop frame is restored at 1200px', resolve('.tour-panel', 1200)['border-width'], '4px');
}
{
  /* The markup must keep the three zones in order, and the old blind centring
     must be gone for good. */
  const panelStart = html.indexOf('class="tour-panel');
  const panel = html.slice(panelStart, html.indexOf('</section>', panelStart));
  const order = ['tour-head', 'tour-body', 'tour-controls'].map((name) => panel.indexOf(`class="${name}"`));
  check('the panel keeps header, body, controls in that order',
    order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  check('the panel no longer scrolls the section to the centre of the screen',
    !/scrollIntoView\(\{[^}]*block:'center'[^}]*\}\);\s*target\.focus/.test(html));
  check('the tour calls the measured placement instead', html.includes('placeTourTarget(target,step)'));
  check('placement re-runs when the visible area changes',
    html.includes("window.visualViewport.addEventListener('resize',reflowTour)"));
  check('the scroll correction is verified and topped up after the browser moves',
    /const after = measure\(chosen\.side\)/.test(html));
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
