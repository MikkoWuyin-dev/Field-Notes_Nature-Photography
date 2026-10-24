# Codebase Audit — Fieldnotes / Nature Photography Roadmap

**Date:** 2026-10-24 · **Branch:** `arena/c65b2d9d-field-notes-nature-photography` · **Commit:** `de4e6d8`
**Scope:** full repo — application, data, delivery, accessibility, risk, repo hygiene.
**Method:** static analysis (structure, CSS cascade, data model, security), contrast math, HTML nesting parse, and a headless smoke test of the app layer in jsdom (render → check a card → search → filter → tour).

---

## 1. What this is

A single-file, dependency-free static web app: a 32-week, 9-stage nature-photography learning
roadmap with 25 learning cards, 16 hand-verified free resources, browser-local progress
tracking, streaks, reminders, JSON export/import, a guided tour, and 8 decorative pixel
creatures ("pals") built on the bundled Piixpal engine.

There is no build step, no runtime dependency, no server, no analytics, and **no network
request of any kind**. `index.html` is the entire product.

| Layer | Size | Share |
|---|---:|---:|
| Piixpal engine + 8 creature scripts (lines 436–504) | 83.0 KB | 46% |
| App logic + embedded DATA JSON (line 505+) | 59.3 KB | 33% |
| CSS, single `<style>` block (lines 9–273) | 22.4 KB | 13% |
| Static HTML markup (14.1 KB) + head | ~14 KB | 8% |
| Cloudflare-injected script (line 1008) — dead weight | 0.9 KB | <1% |
| **Total** | **179.2 KB / 1,009 lines** (57.9 KB gzipped) | |

Data model is clean and internally consistent: 9 stages, 25 cards, 160 practice hours,
32 weeks at ~5 h/week, and every one of the 16 external resources carries `access_note`
+ `verification_date` (all 2026-10-23). Claims in the copy match the data exactly.

---

## 2. What is genuinely strong

These are above the usual bar for a hand-written single page, and should be preserved during refactors:

1. **Zero supply chain.** No npm packages, no CDN, no webfonts, no images, no cookies, no analytics. Privacy story is trivially auditable.
2. **Reduced motion is handled properly** — CSS kills transforms/transitions/smooth-scroll (line 267), JS passes `behavior:'auto'`, and the pals default to *off* when the media query matches.
3. **Accessibility was actually engineered**: skip link, 6 `aria-live` regions, `aria-pressed` filter semantics, `role="progressbar"` with live `aria-valuenow`, visible focus rings, `sr-only`, checkbox state exposed via the real `<input>` under a styled marker, tour focus return + Escape handling.
4. **Contrast is largely solved.** 18 of 20 audited text pairs pass AA; status chips (9.38, 7.96, 7.03) and tag chips (11–12.5) are comfortable. Two marginal cases below.
5. **Security posture is good.** All content is inserted with `textContent`/`createElement` (no dynamic `innerHTML`), `safeUrl()` whitelists `http(s)` only, every `_blank` link has `rel="noopener noreferrer"`, import is strictly whitelisted (keys, date regex, time regex), no `eval`.
6. **Graceful degradation of the fun part.** If Piixpal is absent or throws, `addFieldnotesPal()` returns null and the roadmap is unaffected.
7. **Static markup is well-formed** — 0 nesting errors, 0 duplicate IDs, 0 broken in-page anchors, 0 unnamed buttons/links, 0 unlabeled inputs, 0 images missing alt.
8. **Honest product copy** — employment, cost, and notification caveats are stated in the UI, not buried.

---

## 3. Findings

### P0 — architectural, worth deciding on before more content lands

**F1. The entire catalogue is invisible without JavaScript.**
The `<body>` is 14 KB of shell; all 9 stages, 25 cards and 22 KB of DATA are injected at
runtime from a `<script>`. There is no `<noscript>` and no prerendered fallback. On a slow
connection, with JS blocked, or for a crawler that doesn't execute scripts, the page shows a
hero and empty sections. For a site whose whole value is the roadmap, this is the largest
single risk. *Fix options:* (a) emit static HTML for the 25 cards at authoring time and let JS
progressively enhance; (b) at minimum add a `<noscript>` summary listing stages, outcomes and
resource links.

**F2. Progress keys are positional, so re-ordering data silently corrupts user progress.**
Keys are `s{stageIndex}-r{resourceIndex}` (`resourceKey()`), stored in `localStorage` under
`rll-roadmap-progress-v1:nature-photography-beginner-2026`. Insert a resource in Stage 2 and
every downstream checkbox now points at the wrong card — with no error, for existing users.
*Fix:* give each resource a stable slug `id` in DATA and key on that; keep the old scheme as a
one-time read-only migration.

**F3. 46% of the payload is decoration, and it loads before anything else can be read.**
83 KB across 9 blocking `<script>` blocks, 8 canvases and animation loops — on the mobile
connection this file was originally uploaded from, that is the difference between instant and
sluggish. *Fix:* lazy-init pals on `requestIdleCallback` + first scroll, cut to 2–3 creatures,
or defer them behind the existing "Enable tiny pals" opt-in (which currently defaults to on).

### P1 — real defects or user-visible gaps

**F4. Cloudflare junk script shipped in the artifact (line 1008).** Leftover
`__CF$cv$params` / `/cdn-cgi/challenge-platform/...` injector that builds a hidden iframe and
404s anywhere it's not served by Cloudflare. Delete it.

**F5. Heading outline skips a level.** DOM order is `h3` (category) → `h5` (card), because
stage titles are `<span role="heading" aria-level="4">` (line 676). ARIA users get a correct
tree; the raw document outline does not. `<h4>` is legal inside `<summary>` — use one.

**F6. Two sub-AA contrast pairs.** Link blue `#3768FF` on paper = **4.32:1** (needs 4.5);
hero lead `rgba(255,255,255,.94)` on blue = **4.25:1** at body size. Links are underlined so
they're still distinguishable, but both fail AA text. Darken link blue to ~`#2C55DA` and set
hero lead to solid `#FFFFFF` (4.58:1).

**F7. Three interactive controls below the 44px tap minimum:** `.done-control` (line 188),
`.filter-button` (line 144), `.pals-controls button` (line 97) all at `min-height:38px`. The
done checkbox is the primary progress action on a phone. Raise to 44px.

**F8. No social/SEO metadata.** No `<link rel="icon">` (favicon 404), no canonical, no
Open Graph/Twitter tags, no JSON-LD. For a shareable free resource this is free reach being
left on the table. Add a favicon, an OG image, and `LearningResource`/`ItemList` structured data.

**F9. `notificationsEnabled` and tour/pals state can't be exported.** Export writes progress
cells, dates and reminder time only. Fine by design, but the export is presented as a full
backup ("move progress between browsers"); tour-seen and pals preference are lost silently.

### P2 — code quality, polish, maintainability

- **F10. Dead code:** `el('span','',completion?'Done':'Done')` (line 621) and again at the
  change handler — both ternary branches are identical. Two redundant CSS declarations
  (`.checkmark{border-color:…}` and `.done-control{color:…}` appearing before their real
  definitions) shadowed by later rules. `RESOURCE_ITEMS` is rebuilt on every render.
- **F11. Storage key namespace is inconsistent:** `rll-roadmap-progress-v1:` (a leftover
  prefix from an earlier template) vs `fieldnotes-onboarding-v1` / `fieldnotes-pals-v1`.
  Renaming is safe only with a migration — flagging, not recommending a blind change.
- **F12. Activity dates are unbounded and un-pruned.** `markActivity()` only ever appends;
  unchecking a card the same day leaves "Logged today" set. Harmless at this scale, but the
  streak model has no decay or cleanup path.
- **F13. Loose validation on import:** `"99:99"` passes the time regex, and future dates pass
  the date regex. Neither can escalate, but both produce odd states.
- **F14. One breakpoint (850px), no container queries.** The layout is fluid via `clamp()`, so
  it holds up, but there is no tablet tuning and the `responsive-design` skill's container-query
  approach isn't used anywhere (0 `@container`).
- **F15. No print stylesheet.** A roadmap is a natural thing to print; `@media print` is absent.
- **F16. No CSP.** With zero external resources a strict policy is nearly free to add
  (`default-src 'none'`, inline style/script hashes) and would harden the one-file model.
- **F17. Minor duplication in the CSS cascade:** 38 selectors are declared more than once
  (mostly intentional media-query overrides; 4 are genuine top-level re-declarations).

### Repo hygiene

- **No README, no LICENSE, no CI, no tests, no `package.json`.** For a public-facing resource
  with third-party contributor expectations, a README (what it is, how to edit DATA, how to
  deploy) is the highest-value missing file.
- **Skills dominate the repository.** The skill install added ~96k lines / 11 MB tracked
  (`.agents/skills`), plus an identical 11 MB copy in `agent/skills` that is git-ignored —
  ~21 MB working tree around a 179 KB product. Consider tracking only `skills-lock.json` and
  restoring skills on demand (`npx skills experimental_install`).
- **History is a single upload commit** (`3b6aa7e`, "Upload index.html from mobile"), so there
  is nothing to bisect. Any future refactor should land in small commits.

---

## 4. Verified working (headless smoke test, jsdom)

Rendered the real file and drove the real handlers:

| Check | Result |
|---|---|
| Render | 9 stages, 25 cards, 957 DOM nodes, correct counts in UI ("9 stages · 25 learning cards") |
| Progress | checking one card → `1 of 25 practice cards complete`, `Logged today`, streak `1` |
| Search | `wildlife` → `7 matches in 2 stages`, empty-state correctly hidden |
| Filter | `portfolio` → `10 learning cards across 4 stages` |
| Tour | opens at `STEP 01 / 09`, advances correctly, focus/aria content populated |
| Console | no app-level exceptions (only jsdom gaps: `matchMedia`, `scrollIntoView`) |

Not verifiable from this sandbox: the 16 external links (outbound web access here is limited to
package registries), real-device rendering, and actual browser notification behaviour.

---

## 5. Judgement

The application layer is in good shape — careful, defensive, and honest, with
accessibility and privacy handled better than most hand-written single-file sites. The risk is
not sloppiness; it is **coupling**: content, engine, decoration and app all live in one
unsplittable 179 KB file, the content is JS-only, and progress identity depends on array order.

If this stays a solo one-file project, fix P1 items (F4–F9) — they're cheap, mostly one-line,
and each is a real user-visible improvement. If it's going to grow, do F1–F3 first: static
content output, stable card IDs, deferred pals. Everything else is polish.

**Suggested order:** F4 (delete junk) → F7 + F6 (tap targets, contrast) → F2 (stable IDs) →
F1 (noscript/static fallback) → F8 (favicon + OG) → README → F3 (defer pals).

---

## 6. Remediation log — 2026-10-24

Everything in §3 except F14 and F16 was actioned. Sections 1–5 above are kept as the
point-in-time record; this section is the current state.

| Finding | Status | What changed |
|---|---|---|
| F1 no-JS catalogue | **Fixed** | `tools/gen-noscript.py` renders all 9 stages / 25 cards / 16 links into a `<noscript>` block, with `--check` for drift |
| F2 positional progress keys | **Fixed** | 34 stable slug ids in DATA; `resourceKey()`/`stageKey()` use them; `migrateDone()` translates old keys on load and on v1 import |
| F3 decoration ahead of content | **Fixed** | 83 KB Piixpal payload is now an inert `<template>`, executed on idle (or on demand when pals are enabled) |
| F4 Cloudflare injector | **Fixed** | Removed (938 bytes) |
| F5 heading outline skipped a level | **Fixed** | Stage titles are real `<h4>`s; outline is now h3 → h4 → h5 with no gaps |
| F6 two sub-AA contrast pairs | **Fixed** | `--blue-ink` (#2C55DA, 5.8:1) for text; hero lead is solid white (4.58:1) |
| F7 38px tap targets | **Fixed** | `.done-control`, `.filter-button`, `.pals-controls button` at 44px |
| F8 missing share metadata | **Fixed** | Inline SVG favicon, `color-scheme`, OG + Twitter tags, Course JSON-LD. `canonical`/`og:url` deliberately omitted until the domain is known |
| F9 export omitted some state | **Accepted** | Export is a progress backup by design; documented in README |
| F10 dead code | **Fixed** | Both `'Done':'Done'` ternaries and the two shadowed CSS declarations removed |
| F11 storage key namespace | **Accepted** | Renaming would orphan every existing visitor's progress; left as-is and documented in README |
| F12 unbounded activity dates | **Fixed** | `normaliseDates()` dedupes, drops impossible/future dates and prunes beyond 730 days |
| F13 loose import validation | **Fixed** | `TIME_RE` (00:00–23:59) and real-calendar-date checks on load and import |
| F14 single breakpoint | **Deferred** | Fluid `clamp()` layout holds at every width; container queries would restructure working CSS for no measured gain. Revisit if the card grid grows |
| F15 no print stylesheet | **Fixed** | `@media print` (ink on white, panels flattened, printed URLs) + `beforeprint`/`afterprint` open and restore stages |
| F16 no CSP | **Deliberately skipped** | The page needs `'unsafe-inline'` for its inline script/style, so a meta CSP buys little and risks breaking the blob-download export. Better as an HTTP header, tested, at deploy time |
| Repo hygiene | **Partly fixed** | README, `package.json`, 40-check smoke test, `tools/`; CI and a licence decision are still open |

**Metrics after remediation:** 212 KB raw / 66.3 KB gzipped (was 179 KB / 57.9 KB).
The 6 KB gzip increase buys a readable catalogue for every visitor without
JavaScript, and the 83 KB pals payload no longer executes before the content.

**Still open:** CI wiring, a licence decision, `canonical`/`og:url` once the domain
exists, an Open Graph image, and the `agent/skills` duplicate in the working tree.
