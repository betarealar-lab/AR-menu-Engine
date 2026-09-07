#!/usr/bin/env python3
"""Build `app/public/viewer.js` — everything interactive on a diner's page, in one file.

    python menu/render/build_viewer.py

The diner page inlines its markup and its CSS but loads this as ONE deferred script, so a
phone fetches it once and every restaurant shares the cached copy.

**It exists because it was missing, and that cost a real bug.** `app/public/viewer.js` was
assembled by hand once and then had no generator at all. Editing `ported/shim.js` looked
like it worked - the file changed, `build_ported.py` regenerated `ported.mjs`, and
`check_render.py` went green - while the page an actual diner loads kept serving the old
bytes. `check_render.py` renders through `render.mjs`/`ported.mjs`, which is a DIFFERENT
renderer from the Astro app, so it could not have caught it. `check_admin.py` did, by
fetching the real page and looking for the code it expected.

So: one generator, and `check_render.py` now asserts the output matches its sources.

Order matters at runtime, and it is the same order the platform's own index.html uses:

    ui        the platform's 42 strings in en/ka/ru. VERBATIM (extract_ui.py)
    xr        defines window.XR, the WebXR carousel. VERBATIM
    shim      the ONLY adapter - what viewer.js expects from the app it was lifted out of
    platform  the basket, variants, add-ons, the lightbox's data, show-to-staff
    viewer    the 3D modal, the photo lightbox, AR entry, thumbnail upgrades. VERBATIM
    hero      the hero video, the crossfade, the venue block. VERBATIM
    page      category filtering, 3D-first ordering, language, day/night
    init      boots the lot once the page is parsed

`platform.js` sits before `viewer.js` deliberately: viewer.js calls `addToBasket`,
`_variantsHtml` and `_syncQtyCtrl` by name, and those used to be stubs living in shim.js.
That is the arrangement this whole layer exists to make impossible again - see its
docstring, and FEEDBACK.md.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PORTED = ROOT / "menu" / "render" / "ported"
OUT = ROOT / "app" / "public" / "viewer.js"

FILES = ["ui.js", "xr.js", "shim.js", "platform.js", "viewer.js", "hero.js",
         "page.js", "init.js"]


def build() -> str:
    parts = []
    for name in FILES:
        src = (PORTED / name).read_text(encoding="utf-8")
        # The banner is what makes the concatenation debuggable: a stack trace in this file
        # is otherwise a line number in a 130 KB blob with no way back to a source.
        parts.append(f"/* ---- {name} ---- */\n{src}")
    return "\n".join(parts)


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = build()
    before = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
    OUT.write_text(text, encoding="utf-8")

    for name in FILES:
        print(f"  {name:12} {len(( PORTED / name).read_text(encoding='utf-8')):>7,} chars")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({len(text):,} bytes)"
          + ("" if before == text else "  [changed]"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
