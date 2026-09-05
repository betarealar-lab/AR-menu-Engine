#!/usr/bin/env python3
"""Take the platform's stylesheet. All of it. Verbatim.

    python menu/render/extract_css.py
    python menu/render/extract_css.py --check

Writes `ported/full.css` - every `<style>` block from their index.html, concatenated in
document order, byte for byte.

**Why not the clever version.** This file used to select rules by selector text and split
them into viewer / menu / per-template sheets. It was wrong four separate times, and every
failure looked identical from the outside - a page that renders but looks wrong:

  a line range cut inside a block and left the sheet one `{` unbalanced, so the browser
  silently dropped rules and `#modal` came out `position: static`, opening as an ordinary
  element in the page flow with no geometry;

  a comment above a rule landed in front of its selector, so `body::before` - where the
  entire page background lives - never matched and the page had no background at all;

  `.header` and `.tenant-logo` were not in the selector list, so the logo rendered with no
  max-height and filled the viewport;

  and then `.menu-list`'s desktop grid stopped applying for a reason that took a browser,
  a CSSOM diff and a bisect to even localise.

All four are the same mistake: **reconstructing a stylesheet instead of copying one.** CSS
is order- and cascade-dependent, so a subset is not a smaller version of a stylesheet, it
is a different stylesheet. Temo put it plainly - "cant u just copy a design correctly."

**The cost, honestly.** ~600 KB of CSS covering 22 templates and every tenant special
case, where one page needs perhaps a tenth of it. That is real and it is the right cost to
pay first: correct-and-fat beats clever-and-wrong, and trimming a sheet that demonstrably
works is a measurable optimisation later. When it is worth doing, the honest way is to
load the page and ask the browser which rules actually matched - not to guess selectors
again.

Read-only on their repo, always (DECISIONS §9.7).
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = Path(r"C:\Users\temot\BetaReal scaleable\index.html")
OUT = HERE / "ported" / "full.css"

HEADER = (
    "/* The platform's complete stylesheet, taken verbatim by extract_css.py.\n"
    "   Every <style> block from index.html, in document order, unmodified.\n"
    "   DO NOT EDIT and do not trim by hand - the module docstring lists the four\n"
    "   separate ways that went wrong. Re-run the extractor instead. */\n\n"
)

# Rules the old selector-filtering version lost, one at a time, each time producing a page
# that looked wrong for a reason nobody could see. Cheap insurance that an extraction has
# not quietly stopped early.
PROBES = ("body::before", ".tenant-logo", "max-width: 880px", "#modal-viewer",
          "#xr-overlay", ".thumb-img", ".badge-3d", ".mg-hero", ".cat-pill")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if not SRC.is_file():
        print(f"cannot read {SRC}")
        return 1

    html = SRC.read_text(encoding="utf-8", errors="replace")
    blocks = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)
    if not blocks:
        print("no <style> blocks found - has index.html changed shape?")
        return 1

    body = HEADER + "\n\n".join(blocks) + "\n"

    opens, closes = body.count("{"), body.count("}")
    print(f"{len(blocks)} style blocks, {len(body):,} chars, braces {opens}/{closes}")
    if opens != closes:
        print("!! UNBALANCED - refusing to write")
        return 1

    missing = [p for p in PROBES if p not in body]
    if missing:
        print("!! missing:", ", ".join(missing))
        return 1
    print(f"  all {len(PROBES)} probes present")

    if a.check:
        print("(check only)")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
