# Fieldnotes — Nature Photography Roadmap

A free, location-neutral route from absolute beginner to a portfolio with purpose:
32 weeks, 9 stages, 25 learning cards and 16 hand-verified free resources, with
progress, streaks and reminders stored in the visitor's own browser.

Everything ships as one file. There is no build step, no dependency, no server
and **no network request at runtime**.

---

## Files

| Path | What it is |
|---|---|
| `index.html` | The entire product — markup, CSS, DATA, app logic, pals payload, no-JS fallback |
| `tools/gen-noscript.py` | Regenerates the plain-text catalogue for visitors without JavaScript |
| `tools/smoke-test.mjs` | Headless checks: rendering, progress, search, tour, migration, fallback, head tags |
| `tools/gen-og-image.sh` | Renders `assets/og-image.png`, the 1200×630 social preview |
| `assets/og-image.png` | Link-preview image referenced by the OG/Twitter tags |
| `AUDIT.md` | Codebase audit: findings, evidence, priorities (2026-10-24) |
| `skills-lock.json` / `.agents/skills/` | Agent skills installed for this repo (see Skills below) |

## Run it locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

`localhost` and any HTTPS origin count as a secure context, which is what browser
notifications require. Opening the file directly with `file://` mostly works, but
reminders and some storage behaviour will not.

---

## Editing the content

All course content lives in the single `const DATA = {...}` object near the top of
the app script in `index.html`. It is plain JSON:

```js
const DATA = {
  "title": …, "subtitle": …, "storage_id": …, "reminder_time": …,
  "stages": [
    { "id": "stage-camera-foundations", "title": …, "duration": …,
      "resources": [ { "id": "chris-brays-10-part-photography-course-videos", … } ] }
  ]
}
```

**After changing DATA, regenerate the no-JavaScript catalogue:**

```bash
python3 tools/gen-noscript.py           # rewrite the <noscript> block
python3 tools/gen-noscript.py --check   # exits 1 if the block is stale (CI-friendly)
```

### Two rules that matter

1. **Never rename or reuse an `id`.** Stage and card ids are the identity of a
   visitor's saved progress. Changing one orphans that card's history. Ids are
   slugs derived from titles, so retitling a card is fine — just keep its `id`.
2. **Ids are now required for anything you add.** Cards written before ids existed
   are keyed by position (`s0-r1`); `LEGACY_KEY_INDEX` migrates those once, at load.
   New cards without an `id` would fall back to positional keys and be fragile again.

Progress is stored under `rll-roadmap-progress-v1:nature-photography-beginner-2026`
(legacy prefix, kept deliberately so existing visitors keep their data). Export
writes format version 2; import accepts both v2 and pre-migration v1 files.

---

## Deploying

Live at **https://nature-photography-roadmap.vercel.app/** (Vercel, static, no build).

Any other static host works too — GitHub Pages, Netlify, S3, a folder on a server.

The absolute URL appears in four places and must be updated together if the site
ever moves:

1. `<link rel="canonical">`
2. `<meta property="og:url">`
3. `og:image` / `twitter:image` (absolute, because crawlers fetch them directly)
4. `url` and `image` in the JSON-LD block

`npm test` fails if the canonical or `og:url` drift from the constant in the test,
so the four can't silently disagree.

Regenerate the preview image after changing the headline copy:

```bash
./tools/gen-og-image.sh   # needs ImageMagick + DejaVu fonts
```

---

## Responsive layout

Mobile-first: the base stylesheet is the phone layout, and everything wider is
progressive enhancement. There is no desktop-first `max-width` layout rule left.

| Breakpoint | What appears | Why |
|---|---|---|
| base (<480px) | single column everywhere; stacked stage headers; full-width Done control | 320–414px phones |
| `min-width:480px` | the four-item tag key splits into two columns | it is short label/value pairs |
| `min-width:620px` | resource cards, practice recs and guardrails go two-up; outcomes too | enough room for a 300px card |
| `min-width:700px` | search + filter buttons on one row; tour dock returns to the corner; three-column card top | tablet |
| `min-width:900px` | two-panel brief; 5-column stage header; cards back to a fixed 2-up grid | desktop, unchanged from before |
| `min-width:1000px` | outcomes go three across | wide desktop |

Horizontal spacing is fluid rather than fixed: `shell`, `main`, panels, cards and
stage bodies all use a `clamp()` with a much smaller floor than before. At 320px the
text column used to be 174px (≈21 characters per line); it is now 224px (≈28), and
at 390px it goes from 244px to 290px.

Rules that keep text inside its box:

- every prose block uses `--font-prose`, never the monospace face;
- `body` sets `overflow-wrap:break-word`, and long-token elements (`.tag`,
  `.resource-card h5`, `.status`, `.category h3`, `.hero-meta span`) add
  `max-width:100%` + `overflow-wrap:anywhere`;
- flex/grid items that hold text can shrink — `.tag` used to be `flex:none`, which
  is why long tags pushed past the card edge;
- tap targets are ≥44px, including the search clear button, the access-note
  disclosure and the source links.

Run the checks:

```bash
npm run test:responsive   # 38 layout assertions, no browser required
```

It resolves the cascade at 320/390/1200px, measures the horizontal chrome budget,
sums fixed grid tracks against the space a phone actually has, and fails if a
`max-width` layout breakpoint, a non-shrinking text container or a sub-44px tap
target reappears.

## Accessibility and privacy notes

- Zero third-party requests: no analytics, cookies, webfonts, CDN or images. The
  favicon is an inline SVG data URI.
- Progressive enhancement: without JavaScript the full catalogue is still readable
  and every resource link works (generated fallback above).
- `prefers-reduced-motion` is honoured in CSS, in scroll behaviour, and by keeping
  the decorative pals off by default.
- Contrast was audited against WCAG AA (see `AUDIT.md`); accent text uses
  `--blue-ink` rather than the surface blue for that reason.
- The 8 decorative pixel creatures ("pals") are a vendored, MIT-licensed copy of
  [Piixpal](https://github.com/diiviikk5/Piixpal) embedded as an inert `<template>`.
  They load on idle and can be paused from the Field kit panel. They are 83 KB of
  the file, by far its largest component.

## Known limitations

- Reminders only fire while the page is open (a static file cannot run in the
  background). The UI says so.
- `file://` usage has no service worker and no reliable notification support.
- No licence file is declared for this repository. The embedded Piixpal components
  keep their MIT notice in `index.html`.
- Social previews need the deployed URL to be reachable; the image is served from
  `/assets/og-image.png` and is not inlined.

## Skills

This repo had agent skills installed with [`skills`](https://github.com/vercel-labs/skills):

```bash
npx skills experimental_install   # restore everything from skills-lock.json
npx skills list                   # what is installed
```

Installed: `ui-ux-pro-max`, `ui-styling`, `design`, `design-system`, `brand`,
`banner-design`, `slides` (nextlevelbuilder/ui-ux-pro-max-skill),
`webapp-testing` (anthropics/skills), `responsive-design` (wshobson/agents).
`agent/skills/` is the installer's duplicate copy and is git-ignored.

## Testing

```bash
npm install     # jsdom only; nothing ships to the browser
npm test        # 86 checks, ~6s (48 functional + 38 layout)
```

`tools/smoke-test.mjs` loads the real page in jsdom and drives the real handlers.
It covers: the head tags and social image (canonical, `og:url`, image size and
dimensions), stage/card counts, the heading outline, a checkbox moving
`progress-label`, stored keys staying stable, search and filter result counts, the
tour opening/advancing/closing, legacy positional progress being migrated, a v1
export still importing, unknown keys being rejected, the no-JS fallback staying in
sync, and the deferred pals engine rendering all 8 pals.

jsdom has no layout engine, so canvas, `matchMedia`, `ResizeObserver`,
`IntersectionObserver`, `Range.getClientRects`, `Blob.text()` and `document.fonts`
are stubbed in the harness. Those stubs are test scaffolding — if a test fails
because of them, fix the stub before blaming the page.

Two commands are worth running after content edits:

```bash
npm run noscript:check   # is the no-JS fallback still in sync with DATA?
npm test
```
