#!/usr/bin/env python3
"""Cut the stylesheet down to one template, by proof rather than by guessing.

    python menu/render/trim_css.py                 write app/src/lib/css/<template>.css
    python menu/render/trim_css.py --check         report the savings, write nothing

**Why this trim is safe when four earlier ones were not.**

Every previous attempt asked "is this rule used?" and answered by matching selectors
against a mental model of the page. That is guessing, and it was wrong four times - a
cut stylesheet renders, it just renders wrong, which is the worst kind of wrong.

This asks a different question, with a provable answer: **can this rule match this page
at all?** A rule selecting `[data-template="baoma"]` cannot match a page whose html
element carries `data-template="monday_greens"`. Not "probably won't" - cannot. Same for
`[data-tenant="mugsy-main"]` and `[data-brand-slug="pipes-burger"]`.

So the cut is only ever rules scoped to a DIFFERENT template or tenant. Generic rules are
kept, every one of them, however unused they look. That leaves bytes on the table and
takes zero risk, which is the right trade for the thing that has gone wrong repeatedly.

Trimming the generic remainder needs a computed-style diff against the live page to prove
each cut - that is a later step and it is gated on having that diff.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
FULL = HERE / "ported" / "full.css"
OUT = HERE.parent.parent / "app" / "src" / "lib" / "css"

# The only templates that matter now (Temo, 2026-09-06): Monday Greens, and Corner at
# Tabidze which runs elegant_black. Everything else is for a later generation of
# templates and is not carried.
KEEP_TEMPLATES = ["monday_greens", "elegant_black"]

TEMPLATE_ATTR = re.compile(r'\[data-template\s*=\s*"([a-z0-9_]+)"\]')
TENANT_ATTR = re.compile(r'\[data-(?:tenant|brand-slug)\s*=\s*"([a-z0-9-]+)"\]')


def blocks(css: str):
    """Complete top-level blocks: (selector, body, is_at_rule). Comments stripped from
    the selector for matching - a comment above a rule lands in front of it, which is how
    `body::before` was lost once."""
    i, n = 0, len(css)
    while i < n:
        brace = css.find("{", i)
        if brace == -1:
            return
        raw = css[i:brace]
        depth, j = 1, brace + 1
        while j < n and depth:
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
            j += 1
        if depth:
            return
        clean = re.sub(r"/\*.*?\*/", "", raw, flags=re.S).strip()
        yield clean, raw, css[brace + 1: j - 1], clean.startswith("@")
        i = j


def applies(selector: str, template: str) -> bool:
    """False only when the selector REQUIRES a template or tenant this page is not."""
    for wanted in TEMPLATE_ATTR.findall(selector):
        if wanted != template:
            return False
    # Tenant-scoped rules belong to somebody else's restaurant. Our slugs are ours, so
    # none of the platform's tenant names can ever match one of our pages.
    if TENANT_ATTR.search(selector):
        return False
    return True


def trim(css: str, template: str) -> tuple[str, dict]:
    kept, dropped = [], 0
    for clean, raw, body, is_at in blocks(css):
        if is_at:
            inner = [f"{c} {{{b}}}" for c, _r, b, _a in blocks(body) if applies(c, template)]
            dropped += sum(1 for c, _r, _b, _a in blocks(body) if not applies(c, template))
            if inner:
                kept.append(f"{clean} {{\n" + "\n".join(inner) + "\n}")
            continue
        if applies(clean, template):
            kept.append(f"{raw.strip()} {{{body}}}")
        else:
            dropped += 1
    out = "\n".join(kept) + "\n"
    return out, {"kept": len(kept), "dropped": dropped}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if not FULL.is_file():
        print(f"missing {FULL} - run extract_css.py first")
        return 1
    full = FULL.read_text(encoding="utf-8")
    print(f"full stylesheet {len(full):,} chars\n")

    index = {}
    for template in KEEP_TEMPLATES:
        css, stats = trim(full, template)
        if css.count("{") != css.count("}"):
            print(f"  !! {template}: unbalanced, refusing to write")
            return 1
        pct = 100 * len(css) / len(full)
        print(f"  {template:18} {len(css):>8,} chars  ({pct:.0f}% of full)  "
              f"{stats['kept']} rules kept, {stats['dropped']} dropped")
        index[template] = len(css)
        if not a.check:
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / f"{template}.css").write_text(
                "/* Trimmed from the platform's full stylesheet by trim_css.py.\n"
                "   Only rules scoped to ANOTHER template or tenant are removed - those\n"
                "   provably cannot match this page. Generic rules are all kept.\n"
                "   Do not edit; re-run the trimmer. */\n" + css, encoding="utf-8")

    if not a.check:
        (OUT / "index.json").write_text(
            json.dumps({"templates": KEEP_TEMPLATES, "sizes": index}, indent=1),
            encoding="utf-8")
        print(f"\nwrote {len(KEEP_TEMPLATES)} sheets to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
