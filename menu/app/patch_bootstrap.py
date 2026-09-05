#!/usr/bin/env python3
"""Teach our fork of the customer app to read its data from the page itself.

    python menu/app/patch_bootstrap.py            patch menu/app/index.html in place
    python menu/app/patch_bootstrap.py --check    verify the patch is applied

**The problem this exists to solve**, in Temo's words: *"someone goes to monday greens,
the website in the back loads original index html then it loads monday greens, in front of
the customer only a loading circle is visible but in reality the website is loaded and
then reloaded. i hate that."*

He is describing a real and specific thing, and the cause is narrow: the app fetches its
tenant, theme and menu from Supabase with `await fetch(...)`. A network await lets the
browser paint whatever it has - an unthemed shell with an empty menu - and the finished
page arrives afterwards. Two paints. The spinner is the gap between them.

**The fix is not a rewrite.** It is removing the network from the critical path. When the
data is already IN the page, the same `await` resolves as a microtask, and microtasks run
*before* paint - so the browser parses, builds the whole menu, and paints once, finished.

**How it hooks in.** The app already supports loading a tenant from somewhere other than
Supabase: four tenants (baoma, mugsy, pipes, food-market) run off JSON fixtures, and every
data site is written as `fixture ? fixture.X : await _supaSelect(...)`. This adds a fifth
source that happens to be inline. One function and three one-line edits - no new code
paths, no behaviour of theirs changed, and if `window.__BR` is absent the file behaves
exactly as it does today.

**This patches OUR COPY only.** `menu/app/index.html` is a fork; the platform repo is
never written to (DECISIONS §9.7).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE / "index.html"

# The loader. Deliberately shaped like their existing `_loadXFixture` helpers so it slots
# into the ternaries below without changing how any of them read.
LOADER = """
        // ── BetaReal self-serve: data delivered IN the page ──────────────────
        // The Worker inlines `window.__BR = {restaurant, theme_config, menu_items}`
        // into the head before this script runs, so there is nothing to fetch. The
        // awaits below then resolve as microtasks, which run BEFORE the first paint -
        // the browser builds the whole menu and paints once, finished, instead of
        // painting an empty shell and re-rendering when the network answers.
        //
        // Same shape as the baoma/mugsy/pipes/food-market fixtures this app already
        // has; the only difference is that it costs no request at all.
        function _brFixtureRequested() {
            return !!(window.__BR && window.__BR.restaurant);
        }
        async function _loadBrFixture() {
            return window.__BR || null;
        }
"""

# (needle, replacement) - each is a single, surgical edit.
EDITS = [
    # Where the loader goes: immediately before the first fixture-aware function.
    (
        "        const _requestedTenantSlug = _tenantSlugFromHost();",
        LOADER + "        const _requestedTenantSlug = _tenantSlugFromHost();",
    ),
    # Hook 1 - tenant resolution.
    (
        "            if ((_baomaFixtureRequested() && slug === _BAOMA_FIXTURE_SLUG) ||",
        "            if (_brFixtureRequested() ||\n"
        "                (_baomaFixtureRequested() && slug === _BAOMA_FIXTURE_SLUG) ||",
    ),
    (
        "                const fixture = _pipesFixtureRequested()\n"
        "                    ? await _loadPipesFixture()",
        "                const fixture = _brFixtureRequested()\n"
        "                    ? await _loadBrFixture()\n"
        "                    : _pipesFixtureRequested()\n"
        "                    ? await _loadPipesFixture()",
    ),
    # Hooks 2 and 3 - theme and menu. Both end their fixture chain the same way, so one
    # replacement covers both occurrences.
    (
        "_foodMarketFixtureRequested() ? await _loadFoodMarketFixture() : null",
        "_brFixtureRequested() ? await _loadBrFixture() "
        ": _foodMarketFixtureRequested() ? await _loadFoodMarketFixture() : null",
    ),
]

MARKER = "_brFixtureRequested"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if not APP.is_file():
        print(f"missing {APP} - copy the platform's index.html here first")
        return 1
    html = APP.read_text(encoding="utf-8")

    if a.check:
        n = html.count(MARKER)
        print(f"{MARKER}: {n} occurrences " + ("(patched)" if n >= 5 else "(NOT patched)"))
        return 0 if n >= 5 else 1

    if MARKER in html:
        print("already patched - re-copy the upstream file to re-apply")
        return 0

    for needle, replacement in EDITS:
        n = html.count(needle)
        if n == 0:
            print(f"!! not found, upstream must have changed:\n   {needle[:90]}")
            return 1
        html = html.replace(needle, replacement)
        print(f"  patched {n} site(s): {needle.strip()[:66]}")

    APP.write_text(html, encoding="utf-8")
    print(f"\nwrote {APP.name} ({len(html):,} chars)")
    print("The file still works untouched: with no window.__BR it behaves exactly as before.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
