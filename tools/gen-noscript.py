#!/usr/bin/env python3
"""Generate the <noscript> text version of the catalogue from DATA.

The interactive page renders all 25 learning cards from the DATA object inside
index.html, so with JavaScript disabled the catalogue is empty. This script
renders a plain-HTML equivalent and writes it between the nojs markers in
index.html, keeping the fallback in sync with the data.

Usage:
    python3 tools/gen-noscript.py           # rewrite the block
    python3 tools/gen-noscript.py --check    # exit 1 if the block is stale
"""

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"

START = "<!-- nojs:start | generated from DATA by tools/gen-noscript.py -->"
END = "<!-- nojs:end -->"
ANCHOR = '<main id="main" tabindex="-1">'


def extract_data(page: str) -> dict:
    match = re.search(r"const DATA = (\{.*?\});\n", page, re.S)
    if not match:
        sys.exit("Could not find DATA in index.html")
    return json.loads(match.group(1))


def e(value) -> str:
    return html.escape(str(value), quote=True)


def card_html(card: dict) -> str:
    title = e(card.get("title", "Learning task"))
    url = card.get("url", "")
    label = e(card.get("link_label") or "Open resource")
    # Only http(s) links are rendered, matching safeUrl() in the app.
    heading = f'<a href="{e(url)}" rel="noopener noreferrer">{title}</a>' if url.startswith(("http://", "https://")) else title

    meta = [card.get("provider"), card.get("modality"), card.get("cost"), card.get("duration")]
    meta_line = " · ".join(e(part) for part in meta if part)

    parts = ["<article class=\"nojs-card\">", f"<h4>{heading}</h4>"]
    if meta_line:
        parts.append(f'<p class="nojs-meta">{meta_line}</p>')
    if card.get("action"):
        parts.append(f"<p>{e(card['action'])}</p>")
    if card.get("access_note"):
        parts.append(f'<p class="nojs-access"><strong>Access:</strong> {e(card["access_note"])}</p>')
    if url.startswith(("http://", "https://")):
        parts.append(f'<p><a class="nojs-link" href="{e(url)}" rel="noopener noreferrer">{label} →</a></p>')
    parts.append("</article>")
    return "\n    ".join(parts)


def stage_html(index: int, stage: dict) -> str:
    parts = ['<section class="nojs-stage">']
    parts.append(f"<h3>{index:02d} · {e(stage.get('title', ''))}</h3>")
    meta = [stage.get("duration"), f"{stage.get('estimated_hours')} practice hours" if stage.get("estimated_hours") else ""]
    meta_line = " · ".join(e(part) for part in meta if part)
    if meta_line:
        parts.append(f'<p class="nojs-meta">{meta_line}</p>')
    if stage.get("description"):
        parts.append(f"<p>{e(stage['description'])}</p>")
    outcomes = [o for o in stage.get("outcomes") or [] if o]
    if outcomes:
        parts.append('<p class="nojs-label">Outcomes</p>')
        parts.append("<ul>" + "".join(f"<li>{e(o)}</li>" for o in outcomes) + "</ul>")
    cards = stage.get("resources") or []
    if cards:
        parts.append('<p class="nojs-label">Learning cards</p>')
        for card in cards:
            parts.append(card_html(card))
    parts.append("</section>")
    return "\n  ".join(parts)


def build(data: dict) -> str:
    stages = data.get("stages") or []
    cards = sum(len(stage.get("resources") or []) for stage in stages)
    hours = sum(stage.get("estimated_hours") or 0 for stage in stages)

    body = [
        START,
        "<noscript>",
        '<div class="nojs" id="nojs-catalogue">',
        '  <div class="nojs-intro">',
        '    <p class="nojs-label">Plain-text version</p>',
        "    <h2>The full learning catalogue without JavaScript</h2>",
        '    <p class="nojs-note">Your browser is not running JavaScript, so the interactive catalogue, '
        "progress tracking, reminders and guided tour are unavailable. The complete route is below, "
        "and every free resource links straight out. Enable JavaScript to track progress in this browser.</p>",
        f'    <p class="nojs-meta">{len(stages)} stages · {cards} learning cards · {hours} practice hours · '
        "32 weeks at about 5 hours a week</p>",
        "  </div>",
    ]
    for index, stage in enumerate(stages, start=1):
        body.append("  " + stage_html(index, stage))
    body.append("</div>")
    body.append("</noscript>")
    body.append(END)
    return "\n".join(body)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    data = extract_data(page)
    block = build(data)

    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
    if pattern.search(page):
        updated = pattern.sub(block, page)
    else:
        if ANCHOR not in page:
            sys.exit("Could not find <main> to insert the fallback into")
        updated = page.replace(ANCHOR, ANCHOR + "\n" + block, 1)

    if "--check" in sys.argv:
        if updated != page:
            sys.exit("index.html noscript fallback is stale — run tools/gen-noscript.py")
        print("noscript fallback is up to date")
        return

    if updated == page:
        print("noscript fallback already up to date")
        return
    PAGE.write_text(updated, encoding="utf-8")
    print(f"wrote noscript fallback ({len(block)} bytes)")


if __name__ == "__main__":
    main()
