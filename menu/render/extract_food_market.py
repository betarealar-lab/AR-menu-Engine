#!/usr/bin/env python3
"""Food & Market's look, taken from the live platform page.

    BETAREAL_PLATFORM_HTML=/path/to/live/index.html python menu/render/extract_food_market.py

Food & Market is not a template on the platform - it is `minimal_sushi` plus ~100 rules
scoped to `[data-tenant="food-market-main"]`, a kitchen-picker landing and per-kitchen
doodles. So this writes the two things the rebuild needs, both copied, never retyped:

  app/src/lib/css/minimal_sushi.css      the live stylesheet, trimmed as trim_css.py
                                         trims, but KEEPING Food & Market's own
                                         tenant-scoped rules, and splitting selector
                                         lists so shared rules are not lost
  menu/render/ported/fm-chrome.html      the kitchen-picker landing, verbatim
                                         (the tabs and "← Kitchens" are in markup.js)
  menu/render/ported/fm-motion.js        its UI motion script, verbatim

The page renders with `data-tenant="food-market-main"` (the tenant setting
`platform_tenant`), which is how the platform itself aliases its F&M test copy.
The images those rules and tiles point at live in `app/public/img/` at the same paths.

Read-only on the platform, always (DECISIONS §9.7).
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from trim_css import trim                                      # noqa: E402

ROOT = HERE.parent.parent
CSS_OUT = ROOT / "app" / "src" / "lib" / "css" / "minimal_sushi.css"
HTML_OUT = HERE / "ported" / "fm-chrome.html"
MOTION_OUT = HERE / "ported" / "fm-motion.js"
TENANTS = ("food-market-main", "food-and-market-test2-main")


def main() -> int:
    src = Path(os.environ.get("BETAREAL_PLATFORM_HTML", ""))
    if not src.is_file():
        print("set BETAREAL_PLATFORM_HTML to a copy of the live index.html")
        return 1
    html = src.read_text(encoding="utf-8", errors="replace")

    full = "\n\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.S))
    css, stats = trim(full, "minimal_sushi", TENANTS, split=True)
    if css.count("{") != css.count("}"):
        print("!! unbalanced, refusing to write")
        return 1
    fm_rules = css.count('data-tenant="food-market-main"')
    if fm_rules < 50:
        print(f"!! only {fm_rules} Food & Market rules kept - has the page changed shape?")
        return 1
    CSS_OUT.write_text(
        "/* Trimmed from the LIVE platform stylesheet by extract_food_market.py:\n"
        "   template minimal_sushi + Food & Market's own tenant rules.\n"
        "   Do not edit; re-run the extractor. */\n" + css, encoding="utf-8")
    print(f"css   {len(css):,} chars, {stats['kept']} rules kept, "
          f"{fm_rules} Food & Market selectors")

    landing = re.search(r'<div id="fm-kitchen-landing">.*?</div>\s*</div>', html, re.S)
    if not landing:
        print("!! landing not found")
        return 1
    HTML_OUT.write_text(
        "<!-- Food & Market's kitchen picker, verbatim from the platform "
        "(extract_food_market.py). -->\n" + landing.group(0) + "\n",
        encoding="utf-8")
    print(f"html  {HTML_OUT.relative_to(ROOT)}")

    # The UI motion script (card reveal, kitchen slide, dish-into-basket). Self-contained
    # and gated on `html[data-fm-motion]`, so it goes into the viewer bundle as-is.
    motion = re.search(r"<!-- ── Food & Market test copy: UI motion.*?<script>(.*?)</script>",
                       html, re.S)
    if not motion:
        print("!! motion script not found")
        return 1
    MOTION_OUT.write_text(
        "// Food & Market's UI motion, verbatim from the platform (extract_food_market.py).\n"
        "// Do not edit; re-run the extractor.\n" + motion.group(1).strip() + "\n",
        encoding="utf-8")
    print(f"js    {MOTION_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
