#!/usr/bin/env python3
"""Pull the platform's CSS out of its index.html as WHOLE RULES, split base vs template.

    python menu/render/extract_css.py            rewrite the ported css
    python menu/render/extract_css.py --check    report only, change nothing

Writes three files:

    ported/viewer.css                the 3D modal, thumbnails, the WebXR overlay
    ported/menu.css                  the structural menu: cards, hero, prices, layout
    ported/templates/<name>.css      one file per [data-template="..."] look

**Why parse instead of taking a line range.** The first version took line ranges, cut
inside a block, and left the stylesheet one `{` out of balance. The browser then dropped
rules silently and `#modal` came out `position: static` - so the 3D modal "opened" as an
ordinary element in the page flow, with no geometry and nothing visible. It cost a
debugging round, and the fix is not better line numbers, it is not using line numbers.
This walks the braces and keeps only complete rules, and refuses to write an unbalanced
file at all.

**The split is the point.** The platform's look is not a layout - it is one set of
structural rules consuming CSS custom properties, plus a preset that supplies them
(`--bg`, `--card-bg`, `--accent`, `--thumb-vignette`, ...). A template is a palette, not a
page. Splitting the files the same way is what lets a new template be data rather than
code, which is MENU-PLATFORM §2.2.

Read-only on their repo, always (DECISIONS §9.7).
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = Path(r"C:\Users\temot\BetaReal scaleable\index.html")
OUT = HERE / "ported"

# The 3D and AR layer.
VIEWER = re.compile(
    r"#modal|#xr-|#xr\b|\.thumb-wrap|\.thumb-img|\.thumb-vignette|\.badge-3d"
    r"|\.nav-arrow|\.close-btn|\.spin-btn|\.spin-|\.modal-vignette"
    r"|#lightbox|#img-lightbox")

# The structural menu a preset skins. `:root` comes across for the DEFAULT palette - a
# template that omits a variable must still render, not fall back to nothing.
BASE = re.compile(
    r"^:root|^body|\.menu-item|\.item-left|\.item-right|\.item-name|\.item-actions"
    r"|\.ingredients|\.price\b|\.price-was|\.no-image|\.mg-|\.hero\b|\.cat-"
    r"|\.section|\.ar-btn|\.variant|\.addon|\.qty-|#menu\b|\.menu\b"
    # Added after the header logo rendered at full screen height: `.header` and
    # `.tenant-logo` were not in this list, so their rules were dropped and a logo
    # with no max-height filled the viewport. The lesson generalises - every class the
    # page emits needs a rule here or it renders unstyled, and unstyled is not
    # obviously broken, it is just wrong.
    r"|^\.header|\.tenant-logo|#brand-title|\.lang-|\.brand\b")

TEMPLATE = re.compile(r'\[data-template="([a-z0-9_]+)"\]')


def blocks(css: str):
    """Yield (selector, body, is_at_rule) for each COMPLETE top-level block."""
    i, n = 0, len(css)
    while i < n:
        brace = css.find("{", i)
        if brace == -1:
            return
        selector = css[i:brace].strip()
        depth, j = 1, brace + 1
        while j < n and depth:
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
            j += 1
        if depth:                      # unterminated - the file ended mid-rule
            return
        # A comment sitting above a rule lands in front of its selector, so matching on
        # the raw text silently skips it. `body::before` - which is where the whole page
        # background lives - is preceded by a four-line comment, and was dropped for
        # exactly this reason until somebody noticed the page had no background at all.
        clean = re.sub(r"/\*.*?\*/", "", selector, flags=re.S).strip()
        yield clean, css[brace + 1: j - 1], clean.startswith("@")
        i = j


def sort_rule(selector: str, body: str, buckets: dict) -> None:
    tpl = TEMPLATE.search(selector)
    if tpl:
        # A template-scoped rule belongs to that template, whatever else it matches.
        buckets["templates"].setdefault(tpl.group(1), []).append(
            f"{selector} {{{body}}}")
    elif VIEWER.search(selector):
        buckets["viewer"].append(f"{selector} {{{body}}}")
    elif BASE.search(selector):
        buckets["base"].append(f"{selector} {{{body}}}")


def collect(css: str, buckets: dict) -> None:
    for selector, body, is_at in blocks(css):
        if not is_at:
            sort_rule(selector, body, buckets)
            continue
        # An @media is kept per bucket, holding only the inner rules that bucket wants,
        # so a modal's phone layout comes across without the whole menu's responsive CSS.
        inner = {"viewer": [], "base": [], "templates": {}}
        for s, b, _ in blocks(body):
            sort_rule(s, b, inner)
        if inner["viewer"]:
            buckets["viewer"].append(selector + " {\n" + "\n".join(inner["viewer"]) + "\n}")
        if inner["base"]:
            buckets["base"].append(selector + " {\n" + "\n".join(inner["base"]) + "\n}")
        for name, rules in inner["templates"].items():
            buckets["templates"].setdefault(name, []).append(
                selector + " {\n" + "\n".join(rules) + "\n}")


HEADER = ("/* Extracted from the platform's index.html by extract_css.py - whole rules,\n"
          "   selected by selector text. Do NOT edit; re-run the extractor. */\n\n")


def write(path: Path, rules: list[str], check: bool) -> bool:
    body = HEADER + "\n".join(rules) + "\n"
    if body.count("{") != body.count("}"):
        print(f"  !! {path.name}: UNBALANCED, refusing to write")
        return False
    print(f"  {path.name:34} {len(rules):4} rules  {len(body):>7,} chars")
    if not check:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if not SRC.is_file():
        print(f"cannot read {SRC}")
        return 1
    html = SRC.read_text(encoding="utf-8", errors="replace")
    buckets = {"viewer": [], "base": [], "templates": {}}
    for style in re.findall(r"<style[^>]*>(.*?)</style>", html, re.S):
        collect(style, buckets)

    ok = True
    ok &= write(OUT / "viewer.css", buckets["viewer"], a.check)
    ok &= write(OUT / "menu.css", buckets["base"], a.check)
    for name, rules in sorted(buckets["templates"].items()):
        ok &= write(OUT / "templates" / f"{name}.css", rules, a.check)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
