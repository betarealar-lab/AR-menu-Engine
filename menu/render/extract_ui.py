#!/usr/bin/env python3
"""Take the platform's UI strings. All three languages. Verbatim.

    python menu/render/extract_ui.py
    python menu/render/extract_ui.py --check

Writes `ported/ui.js` - the `UI` object out of index.html, unchanged, as `window.UI`.

**Why extracted and not written.** `shim.js` used to carry a hand-typed English-only
version of this object, because the viewer needs `UI[window.__lang].loading` to exist or
it throws. It had eleven of the forty-two keys and no Georgian at all, so every string the
basket, the AR overlay and the waiter QR needed came back `undefined` - and `undefined`
renders as the word "undefined", quietly, in a restaurant.

The Georgian is the point. Temo's market reads Georgian, the platform already has every
string translated by people who speak it, and re-typing them is how a translation gets
subtly wrong. Copy them.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SRC = Path(r"C:\Users\temot\BetaReal scaleable\index.html")
OUT = ROOT / "menu" / "render" / "ported" / "ui.js"
# The same strings, as data, for the SERVER renderer. `markup.js` paints the first frame
# of the 3D button ("VIEW IN 3D" / "3D-ში ᲜᲐᲮᲕᲐ") before any script runs, and typing those
# three strings a second time is how a translation drifts. One extraction, two consumers.
OUT_JSON = ROOT / "app" / "src" / "lib" / "ui.json"

HEADER = """// ui.js - the platform's UI strings, taken verbatim by extract_ui.py.
// Every key, en/ka/ru, exactly as index.html has them. DO NOT EDIT: re-run the
// extractor. A hand-maintained copy of this object is how the menu ended up
// showing the word "undefined" to Georgian diners.
//
// `window.UI` because that is what the ported viewer, the AR overlay and the
// basket all read - `UI[window.__lang].loading` and forty-one more.

"""


def build() -> str:
    if not SRC.is_file():
        raise SystemExit(f"cannot read {SRC}")
    html = SRC.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"^([ \t]*)const UI = \{", html, re.M)
    if not m:
        raise SystemExit("no `const UI = {` in index.html - has it changed shape?")
    # Brace depth, not a line range: a range is silently off by one the moment somebody
    # adds a string above it, and a half-copied object literal is a syntax error that
    # takes the whole bundle down. Quoted text is skipped, so an apostrophe or a brace
    # inside a translated string cannot move the closing brace.
    depth, end, quote, esc = 0, None, "", False
    for i in range(m.start(), len(html)):
        ch = html[i]
        if esc:
            esc = False
        elif quote:
            if ch == chr(92):
                esc = True
            elif ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit("unbalanced UI object literal")
    pad = m.group(1)
    body = "\n".join(l[len(pad):] if l.startswith(pad) else l
                     for l in html[m.start():end].splitlines())
    return HEADER + body.replace("const UI = {", "window.UI = {", 1) + ";\n"


def as_json(js: str) -> str:
    """The object literal, as JSON. Parsed with a real JS engine rather than a regex:
    the strings contain apostrophes, colons and Georgian, and every hand-rolled parser for
    "nearly JSON" is wrong on one of those."""
    import subprocess
    body = js[js.index("window.UI = "):].rstrip().rstrip(";")
    out = subprocess.run(
        ["node", "-e", "const o=" + body[len("window.UI = "):] +
         ";process.stdout.write(JSON.stringify(o,null,2))"],
        capture_output=True, text=True, encoding="utf-8")
    if out.returncode:
        raise SystemExit("node could not parse the UI object:" + chr(10) + out.stderr)
    return out.stdout + chr(10)


def main() -> int:
    text = build()
    data = as_json(text)
    if "--check" in sys.argv:
        have = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
        have_json = OUT_JSON.read_text(encoding="utf-8") if OUT_JSON.is_file() else ""
        if have != text or have_json != data:
            print(f"{OUT.name} is stale - re-run: python menu/render/extract_ui.py")
            return 1
        print(f"{OUT.name} matches index.html ({len(text):,} bytes)")
        return 0
    OUT.write_text(text, encoding="utf-8")
    OUT_JSON.write_text(data, encoding="utf-8")
    langs = re.findall(r"^\s{4}(\w+): \{", text, re.M)
    print(f"  languages: {', '.join(langs)}")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({len(text):,} bytes)")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({len(data):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
