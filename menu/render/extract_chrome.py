#!/usr/bin/env python3
"""Take the platform's overlay markup. All of it. Verbatim.

    python menu/render/extract_chrome.py
    python menu/render/extract_chrome.py --check

Writes `ported/chrome.html` - the six elements a diner's page needs present BEFORE
`viewer.js` runs, copied byte for byte out of the platform's index.html.

**Why this file exists at all.** `viewer.js` and `platform.js` are the platform's code,
unedited, and they bind their listeners AT TOP LEVEL:

    modalSpinBtn.addEventListener('click', ...)      // viewer.js, line 18

A missing `#modal-spin` makes that `null.addEventListener` - a TypeError that aborts the
whole block. Every `let` declared after it is then in the temporal dead zone, so the
symptom is not "the spin button does nothing", it is **the 3D viewer, AR, the thumbnail
upgrades and the basket all silently gone**, with one line in the console.

That is exactly what shipped. The deployed page had none of this markup, so `viewer.js`
threw on its 18th line and a diner got a static list of dishes. The previous answer to
that was `shim.js` inventing nine hidden empty `<div>`s with the right ids - which is how
a feature becomes a stub without anyone deciding to remove it.

So the rule is the same one `extract_css.py` learned the hard way: **copy it, do not
reconstruct it.** The stylesheet is written against this exact tree - `#modal-drawer`
inside `#modal`, `.qty-stepper` inside `.qty-ctrl` - and markup of my own with the same
ids would be a different tree wearing their class names.

One deliberate omission, and only one: the `bp-basket-delivery` block inside the basket
panel is three hardcoded Wolt/Glovo/Bolt links for a single tenant (Burger Planet). It is
a per-restaurant setting in our schema, not page furniture.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SRC = Path(r"C:\Users\temot\BetaReal scaleable\index.html")
OUT = ROOT / "menu" / "render" / "ported" / "chrome.html"

# Document order, which is also the order the platform has them in. It matters for the
# two overlays that share a stacking context and have no explicit z-index between them.
BLOCKS = [
    ("img-lightbox",   "the photo lightbox - tap a photo dish to see it full size"),
    ("modal",          "the 3D viewer: model-viewer, drawer, price, add-to-basket, AR"),
    ("xr-overlay",     "the WebXR carousel's controls, drawn over the camera feed"),
    ("basket-bar",     "the floating 'N items - 42 GEL' bar"),
    ("basket-panel",   "the basket itself, and Show to staff"),
    ("waiter-overlay", "the order QR a diner shows the waiter"),
]

HEADER = """<!-- The platform's overlay markup, taken verbatim by extract_chrome.py.
     Six blocks from index.html, in document order, unmodified.
     DO NOT EDIT - re-run the extractor. See its docstring for why hand-written
     markup with the same ids is not the same thing. -->
"""


def block(html: str, el_id: str) -> str:
    """The whole `<div id="...">...</div>`, found by counting div depth.

    Depth rather than a line range: a range is right until somebody adds a line to
    index.html above it, and then it is silently off by one and cuts a block in half.
    That is the specific way extract_css.py's first version was wrong.
    """
    m = re.search(r'^([ \t]*)<div id="%s"[^>]*>' % re.escape(el_id), html, re.M)
    if not m:
        raise LookupError(f'no <div id="{el_id}"> in index.html')
    start, depth, pos = m.start(), 0, m.start()
    for tag in re.finditer(r"</?div\b", html[m.start():]):
        depth += 1 if tag.group(0) == "<div" else -1
        if depth == 0:
            pos = m.start() + tag.end()
            break
    else:
        raise LookupError(f'unbalanced <div id="{el_id}">')
    end = html.index(">", pos) + 1
    # Their indentation is four spaces inside a <body>; ours is emitted at column 0.
    return "\n".join(l[len(m.group(1)):] if l.startswith(m.group(1)) else l
                     for l in html[start:end].splitlines())


def strip_bp_delivery(markup: str) -> str:
    """Drop Burger Planet's three hardcoded delivery links. See the docstring."""
    return re.sub(r'\n\s*<!-- Burger Planet only:.*?</div>\n\s*</div>\n', "\n",
                  markup, flags=re.S)


def build() -> str:
    if not SRC.is_file():
        raise SystemExit(f"cannot read {SRC}")
    html = SRC.read_text(encoding="utf-8", errors="replace")
    parts = [HEADER]
    for el_id, what in BLOCKS:
        markup = block(html, el_id)
        if el_id == "basket-panel":
            markup = strip_bp_delivery(markup)
        parts.append(f"\n<!-- {el_id}: {what} -->\n{markup}\n")
    return "".join(parts)


def main() -> int:
    text = build()
    if "--check" in sys.argv:
        have = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
        if have != text:
            print(f"{OUT.name} is stale - re-run: python menu/render/extract_chrome.py")
            return 1
        print(f"{OUT.name} matches index.html ({len(text):,} bytes)")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    for el_id, _ in BLOCKS:
        print(f"  {el_id:16} ok")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({len(text):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
