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
for (const selector of ['.filter-button', '.done-control', '.tour-close', '.search-clear', '.tour-skip', '.source', '.access-details summary', '.pals-controls button']) {
  const decls = resolve(selector, 320);
  const height = clampPx(decls['min-height'] || decls['height'] || '0', 320);
  check(`${selector} ≥ 44px`, height >= 44, `${height}px`);
}

console.log('\ndesktop is unchanged');
{
  const at = (selector, prop) => resolve(selector, 1200)[prop];
  eq('.brief returns to two columns', at('.brief', 'grid-template-columns'), '1.2fr .8fr');
  eq('.stage-summary returns to five columns', at('.stage-summary', 'grid-template-columns')?.split(' ').length >= 5, true);
  eq('.resource-card regains its min-height', at('.resource-card', 'min-height'), '360px');
  eq('.card-top returns to three columns', at('.card-top', 'grid-template-columns'), '29px minmax(0,1fr) auto');
  eq('.filters returns to search + buttons in one row', at('.filters', 'grid-template-columns'), 'minmax(0,1fr) auto');
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
