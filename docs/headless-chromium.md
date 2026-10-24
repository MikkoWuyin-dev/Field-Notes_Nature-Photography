# Running a real headless Chromium with no browser installed

**Audience:** an agent in a sandbox with only `registry.npmjs.org` and `pypi.org`
reachable, no Chromium/Firefox on the box, and a task that genuinely needs layout
measurements — not static CSS reasoning.

**Result:** Chromium 153, driven by `puppeteer-core`, measuring real
`getBoundingClientRect()` values and taking screenshots, all from the npm allowlist.

> **Verified end to end.** The steps below were re-run from scratch on a fresh
> session (empty `node_modules`, wiped `/tmp`): install, decompress, `--version`,
> all succeeded in about 8 seconds. The version numbers quoted were checked against
> a live install, not written from memory.

---

## 1. Why the obvious approaches fail

Try these first, so you know what you're dealing with:

```bash
which chromium chromium-browser google-chrome firefox   # → nothing
ls ~/.cache/ms-playwright                              # → nothing
npx playwright install chromium                        # → download blocked
```

Playwright and full `puppeteer` both **download a browser from a CDN**
(playwright.azureedge.net, storage.googleapis.com) on install. With only npm/pypi
reachable, those downloads fail. In my case they failed with `SSL_ERROR_SYSCALL`.

**The insight:** the browser has to arrive *through npm*, as a normal package
payload. That is exactly what `@sparticuz/chromium` is — a Chromium build packaged
for AWS Lambda, shipped as Brotli-compressed blobs inside the tarball.

---

## 2. The recipe

### Step 1 — install (twice-over, deliberately)

```bash
npm i --no-save --no-audit --no-fund @sparticuz/chromium puppeteer-core
```

- **`--no-save`** matters. The script is a local dev tool, not a dependency.
  Afterwards, `git status` must be clean — verify it, because a stray
  `package-lock.json` edit will follow you into a commit.
- **`puppeteer-core`**, not `puppeteer` — core never tries to download a browser, so
  it installs offline-friendly.
- ~40 seconds cold, ~8 seconds warm. Took 63 packages alongside an existing `jsdom`.

What you get in `node_modules/@sparticuz/chromium/bin/`:

| file | size | what it is |
|---|---|---|
| `chromium.br` | 67 MB | the browser binary, Brotli-compressed |
| `al2023.tar.br` | 1.2 MB | shared libraries (libnss3, libnspr4, …) |
| `swiftshader.tar.br` | 1.6 MB | software GL, only if you need WebGL |
| `fonts.tar.br` | 184 KB | extra fonts, only for text-metric work |

### Step 2 — decompress

The package exports `inflate` (confirmed: exports are `default`, `inflate`,
`setupLambdaEnvironment`):

```bash
node -e "
const { inflate } = require('@sparticuz/chromium');
inflate('node_modules/@sparticuz/chromium/bin/chromium.br', '/tmp/chromium')
  .then(p => console.log('binary:', p));
"
```

`inflate` handles `.tar.br` too — it untars as it decompresses, so the library call
is one line:

```bash
node -e "
const { inflate } = require('@sparticuz/chromium');
inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br', '/tmp/al2023')
  .then(p => console.log('libs:', p));
"
```

You now have `/tmp/chromium` (209 MB, uncompressed) and `/tmp/al2023/lib/` containing
`libnspr4.so`, `libnss3.so`, `libnssutil3.so`, `libplc4.so`, `libplds4.so`,
`libexpat.so.1`, and more.

Both inflates can run in one process:

```bash
node -e "
const { inflate } = require('@sparticuz/chromium');
Promise.all([
  inflate('node_modules/@sparticuz/chromium/bin/chromium.br', '/tmp/chromium'),
  inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br', '/tmp/al2023'),
]).then(([b, l]) => console.log('binary:', b, '\nlibs:', l));
"
```

### Step 3 — the library-path trap

```bash
chmod +x /tmp/chromium
/tmp/chromium --version
# error while loading shared libraries: libnspr4.so: cannot open shared object file
```

This is not a broken download — the binary simply can't see the libs you just
extracted. Point it at them:

```bash
export LD_LIBRARY_PATH=/tmp/al2023/lib
/tmp/chromium --version
# Chromium 153.0.8010.0
```

**This single environment variable is the whole trick.** Every launch, from Node or
the shell, needs it.

### Step 4 — drive it

```js
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto('file:///home/user/project/index.html', { waitUntil: 'networkidle0' });
console.log(await page.evaluate(() => document.documentElement.scrollHeight));
await browser.close();
```

Flag notes: `--no-sandbox` because the container has no usable user namespaces;
`--disable-dev-shm-usage` because `/dev/shm` is tiny and Chromium will crash on
large pages without it; `--disable-gpu` because there is no GPU.

---

## 3. Gotchas that will cost you time

| symptom | cause | fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: Cannot find package 'puppeteer-core'` | the script loads from `/tmp`; module resolution walks up from the **script's** directory, not your shell's cwd | put the temp script **inside the repo**, then `rm` it before committing |
| `c.executablePath is not a function` | v153's CommonJS surface dropped it (exports are `default`, `inflate`, `setupLambdaEnvironment`) | use `inflate` directly, as above |
| `error while loading shared libraries` | `LD_LIBRARY_PATH` not set | set it in the shell **and** in `launch({env})` |
| `node_modules` gone next session | `node_modules` is excluded from snapshots | re-run the `npm i` line; the recipe is idempotent |
| measurements off by a scale factor | `deviceScaleFactor` > 1 | keep it at `1` so CSS px == measured px |
| elements not there yet | the page defers work to `requestIdleCallback` | `await new Promise(r => setTimeout(r, 3000))` after load |
| `git status` dirty after install | you forgot `--no-save` | check `git status`; never commit tooling into `package.json` unless intended |

---

## 4. Patterns worth copying

**Measure, don't reason.** One `evaluate` can return the whole layout audit:

```js
const state = await page.evaluate(() => {
  const doc = document.documentElement;
  const footer = document.querySelector('.site-footer').getBoundingClientRect();
  return {
    scrollHeight: doc.scrollHeight,
    footerBottom: footer.bottom + window.scrollY,   // document coords: add scrollY
    horizontalOverflow: doc.scrollWidth - doc.clientWidth,
  };
});
```

**Sweep widths in one process.** Reuse the browser, open a fresh page per viewport —
`[320, 390, 430, 768, 1024, 1440, 1920]` takes ~20 s total.

**Force the state for intermittent bugs.** I could not reproduce the bug by waiting:
95 samples across scrolls, hovers, clicks and a full tour run all came back clean. So
I *constructed* it — grabbed the engine's transform layer and pushed one actor below
the footer:

```js
actor.style.transform = `translate3d(40px, ${footerBottom + 60}px, 0px)`;
```

The document grew 73 px instantly. That turned a "sometimes" report into a
deterministic, provable mechanism. **If a bug is intermittent, do not wait for it —
build it.**

**Look at the result.** `await page.screenshot({ path: '/tmp/bottom.png' })`, then
read the image with the file-viewer tool. Rendering the footer showed me the
alignment and typography were fine, which stopped me chasing a phantom. Vision is the
one check arithmetic can't replace.

**Prove the test catches the bug.** After writing a browser assertion, revert the fix,
run the suite, and confirm it fails. Mine failed 12 assertions — that, not the green
run, is the evidence the test has teeth.

---

## 5. Ship it without breaking CI

Gate the browser suite behind an environment variable so a browser-less CI stays
green:

```js
const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.log('\nskipping the browser check: set CHROME_PATH to a Chromium binary to run it\n');
  process.exit(0);
}
```

```json
"test:browser": "node tools/browser-check.mjs"
```

```bash
CHROME_PATH=/tmp/chromium LD_LIBRARY_PATH=/tmp/al2023/lib npm run test:browser
```

Keep it **out of `npm test`**. Two consequences: CI never breaks, and you must
remember to run it by hand — so do it before every PR that touches positioning.

---

## 6. Limits — say these out loud

- **Headless Chromium is not a phone.** No URL bar collapsing, no `visualViewport`
  resize dance, no touch momentum, no real mobile Safari. Behaviours that depend on
  those still need a device.
- **Version skew.** The packaged build was 153 here — modern enough for
  `overflow: clip`, `:has()`, `dvh`. Don't rely on it being any particular version.
- **It's heavy.** 209 MB in `/tmp`, ~40 s install, ~3 s per page load. Fine for
  investigation, wasteful in a tight loop.
- **Not persisted.** `/tmp` is outside the workspace root, so the binary vanishes
  between sessions. Budget the re-setup time.
- **Report what you verified.** "Measured in Chromium at seven widths" and "reasoned
  from the cascade" are different claims. Never let the first stand in for the second.

---

## 7. Minimal checklist

1. `npm i --no-save @sparticuz/chromium puppeteer-core`
2. `inflate(chromium.br → /tmp/chromium)`; `inflate(al2023.tar.br → /tmp/al2023)`
3. `chmod +x /tmp/chromium`
4. `LD_LIBRARY_PATH=/tmp/al2023/lib /tmp/chromium --version` → expect a version string
5. Drive with `puppeteer-core`, `--no-sandbox`, matching `env`
6. Put temp scripts **in the repo**, delete before commit
7. `git status` clean afterwards
8. Gate any committed browser test behind `CHROME_PATH`

---

## What I'd do differently

I spent a whole session reasoning from the CSS cascade and writing "I can't verify
this, there's no browser" in report after report. Static analysis found real bugs, but
it also let a **sign error in scroll arithmetic** pass a full test run — because the
test asserted the same wrong number the code produced. A browser would have caught it
in one measurement.

**Reach for this in the first ten minutes, not the tenth report.** The setup is eight
commands.
