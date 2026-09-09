#!/usr/bin/env python3
"""Every platform feature, asserted one by one.

    python check_features.py

**This file exists because 392 checks passed while half the product was missing.**

The menu app was deployed, `check.py`, `check_jobs.py`, `check_schema.py`,
`check_publish.py`, `check_render.py` and `check_admin.py` were all green, and what a diner
got was a static list of dishes: no basket, no photo lightbox, no size pills, no day/night
switch, no working category filter, and - because `#modal-spin` was absent and `viewer.js`
binds it on its 18th line - no 3D viewer and no AR either. Temo found it by opening the
page on a phone.

The old checks were not wrong. They were checking the wrong thing:

  `check_render.py` renders through `menu/render/render.mjs`, which is a DIFFERENT
  renderer from the one the Astro app uses, so it could assert facts about a page nobody
  ever served.

  Everything else asserted that FILES existed and that their bytes matched their sources.
  `shim.js` was present, correct, byte-identical - and contained
  `window.addToBasket = function () {};`.

A file being present is not a feature working. So the rule here is different: **every check
below names a feature a diner uses, and fails if that feature could not work.** They run
against the real `app/src/lib/markup.js`, the real built `app/public/viewer.js` and the
real `chrome.html` - the exact three things the Worker serves.

Add a check here whenever a feature is added. If a feature can be deleted without turning
one of these red, it was never really shipped.

Needs Node. Touches no database, no bucket, no credits.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIB = ROOT / "app" / "src" / "lib"
PORTED = ROOT / "menu" / "render" / "ported"
BUNDLE = ROOT / "app" / "public" / "viewer.js"
CHROME = PORTED / "chrome.html"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


# ── a menu with every shape of dish in it ────────────────────────────────────────────
#
# Deliberately not a tidy fixture. It has a dish with sizes, a dish with add-ons, a dish
# with a model, a dish that HAS a model and is still a photo dish (`is_3d` off - a real
# Monday Greens case, and one that used to be silently overridden), a text-only dish, and
# two categories out of order. Each of those broke something at least once.
def item(**over):
    base = {
        "id": "id-x", "name_en": "Dish", "name_ka": "", "name_ru": "",
        "description_en": "", "description_ka": "", "description_ru": "",
        "price": "10 ₾", "price_old": None, "category_id": "c1",
        "model": None, "model_usdz": None, "view_orbit": "",
        "thumbnail_url": None, "thumb_3d": False, "is_3d": False,
        "text_only": False, "featured": False, "ar_scale": 1,
        "variants": [], "addons": [], "sort_order": 0,
    }
    base.update(over)
    return base


MENU = {
    "tenant": {"id": "t1", "slug": "demo", "name": "Demo", "languages": ["en", "ka"],
               "template": "monday_greens"},
    "config": {},
    "categories": [
        {"id": "c1", "name": "Breakfast", "name_ka": "საუზმე", "name_ru": "", "position": 0},
        {"id": "c2", "name": "Drinks", "name_ka": "სასმელები", "name_ru": "", "position": 1},
    ],
    "items": [
        item(id="a", name_en="Benedict", name_ka="ბენედიქტი", description_en="Eggs",
             description_ka="კვერცხი", thumbnail_url="https://x/a.webp",
             model="/a/a.glb", model_usdz="/a/a.usdz", is_3d=True, thumb_3d=True,
             view_orbit="10 20 100"),
        item(id="b", name_en="Toast", thumbnail_url="https://x/b.webp"),
        # Has a model, and the owner turned 3D off. It must behave as a photo dish.
        item(id="c", name_en="Wrap", thumbnail_url="https://x/c.webp",
             model="/a/c.glb", is_3d=False),
        item(id="d", name_en="Americano", category_id="c2", price="8 ₾",
             variants=[{"en": "Regular", "ka": "ჩვეულებრივი", "price": "8 ₾"},
                       {"en": "Decaf", "ka": "უკოფეინო", "price": "9 ₾"}]),
        item(id="e", name_en="Burger", category_id="c2", thumbnail_url="https://x/e.webp",
             addons=[{"en": "Bacon", "price": "3 ₾"}]),
        item(id="f", name_en="Water", category_id="c2", text_only=True, price="2 ₾"),
    ],
}


def render() -> dict:
    """The REAL renderer - `app/src/lib/markup.js`, the module the Worker imports.

    Not a copy of it, and not the other renderer. `check_render.py` drives
    `menu/render/render.mjs`, which is a different module that no deployed page uses; that
    is precisely how eight broken features stayed green.
    """
    # A file:// URL, not a Windows path. Node's ESM loader reads "C:\..." as a URL with
    # the scheme "c:" and refuses it.
    src = LIB.joinpath("markup.js").resolve().as_uri()
    script = f"""
    import {{ menuList, catBar, toggles, itemsJson }} from {json.dumps(src)};
    const menu = {json.dumps(MENU, ensure_ascii=False)};
    process.stdout.write(JSON.stringify({{
      en: menuList(menu, "en"),
      ka: menuList(menu, "ka"),
      bar: catBar(menu, "en"),
      toggles: toggles(menu),
      items: itemsJson(menu),
    }}));
    """
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "render.mjs"
        f.write_text(script, encoding="utf-8")
        out = subprocess.run([node(), str(f)], capture_output=True, text=True,
                             encoding="utf-8")
    if out.returncode:
        print(out.stderr)
        raise SystemExit("the renderer would not run - nothing below can be trusted")
    return json.loads(out.stdout)


def node() -> str:
    return "node"


def _loads_platform_css_last() -> bool:
    """The order of the two <style> blocks in the page.

    Equal specificity means the LAST one wins, so a platform rule written before the
    template sheet is a rule that loses - which is the same mistake, one file over, that
    hid Monday Greens' real palette behind the template's defaults.
    """
    page = (ROOT / "app" / "src" / "pages" / "[slug].astro").read_text(encoding="utf-8")
    try:
        return page.index("set:html={platformCss}") > page.index("set:html={sheet}")
    except ValueError:
        return False


# Only the elements the category filter hides. A `display` on anything else is a template
# doing its job.
_HIDEABLE = (".cat-section", ".menu-item", ".category-header", ".ar-featured-banner")


def _display_subjects(css: str) -> list[str]:
    """Which hideable elements this sheet gives an UNCONDITIONAL `display` to.

    Unconditional is the whole point. The platform's own sheet writes
    `.cat-nav:not([hidden]) { display: flex }` - which leaves the hidden state alone and
    needs no override, and is the trick our own CSS should have copied. A bare
    `.menu-item { display: grid }` is the one that breaks `hidden`.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    found = set()
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        if "display" not in body:
            continue
        for part in " ".join(sel.split()).split(","):
            part = part.strip()
            if not part or "[hidden]" in part or ":not(" in part:
                continue                       # already guards the hidden state
            # A rule styles its SUBJECT - the rightmost compound selector.
            subject = part.split()[-1]
            for t in _HIDEABLE:
                if subject == t or subject.startswith(t + ".") or subject.startswith(t + ":"):
                    found.add(t)
    return sorted(found)


def main() -> int:
    if not BUNDLE.is_file():
        print("app/public/viewer.js is missing - run: python menu/render/build_viewer.py")
        return 1
    page = render()
    html, ka, bar = page["en"], page["ka"], page["bar"]
    bundle = BUNDLE.read_text(encoding="utf-8")
    chrome = CHROME.read_text(encoding="utf-8")
    # Comments stripped for the stub search below, and ONLY for that. Every one of those
    # stubs is quoted verbatim in the comments that explain why it is gone, so a naive
    # text search finds the confession rather than the crime.
    code = re.sub(r"^\s*//.*$", "", bundle, flags=re.M)

    # ── 0. the failure that hid all the others ───────────────────────────────────────
    #
    # `viewer.js` binds `#modal-spin` at top level. Absent, it throws, and the throw takes
    # the whole block with it: the 3D modal, AR, the thumbnail upgrades and every basket
    # call the viewer makes. The page still renders, which is why nobody noticed.
    print("\n-- the markup the ported viewer binds at top level --")
    for el in ["modal", "modal-spin", "modal-viewer", "modal-qty-ctrl", "close-btn",
               "modal-prev", "modal-next", "modal-ar-btn", "modal-title", "modal-price",
               "modal-description", "modal-message", "modal-drawer", "modal-drawer-body",
               "img-lightbox", "lightbox-img", "lightbox-name", "lightbox-desc",
               "lightbox-price", "lightbox-panel", "lightbox-qty", "lightbox-options",
               "lightbox-close", "xr-overlay", "xr-add-btn", "basket-bar",
               "basket-bar-count", "basket-bar-total", "basket-bar-delete",
               "basket-panel", "basket-items", "basket-total", "basket-clear",
               "basket-close", "basket-title", "basket-waiter-btn", "basket-waiter-label",
               "waiter-overlay", "waiter-qr", "waiter-overlay-close"]:
        check(f"#{el} is in the page", f'id="{el}"' in chrome)

    # ── 1. no stubs ──────────────────────────────────────────────────────────────────
    #
    # The literal shapes that deleted the basket, the sizes and the add-ons. They are
    # searched for as text in the SHIPPED bundle, because that is the artefact a diner
    # downloads and it is the one that was wrong.
    print("\n-- no feature is a stub --")
    for name, stub in [
        ("addToBasket", r"addToBasket\s*=\s*function\s*\(\s*\)\s*\{\s*\}"),
        ("_setQty", r"_setQty\s*=\s*function\s*\(\s*\)\s*\{\s*\}"),
        ("_syncQtyCtrl", r"_syncQtyCtrl\s*=\s*function\s*\(\s*\)\s*\{\s*\}"),
        ("_variantsHtml", r'_variantsHtml\s*=\s*function\s*\(\s*\)\s*\{\s*return\s*""'),
        ("_addonsHtml", r'_addonsHtml\s*=\s*function\s*\(\s*\)\s*\{\s*return\s*""'),
        ("_trackFirstInteraction", r"_trackFirstInteraction\s*=\s*function\s*\(\s*\)\s*\{\s*\}"),
    ]:
        check(f"{name} is not stubbed out", not re.search(stub, code))
    # The nine fake hidden divs that stood in for the lightbox.
    # The nine fake hidden <div>s that stood in for the lightbox: the shim used to invent
    # elements with the platform's ids so `viewer.js` would find something. Real markup
    # now comes from chrome.html, so nothing in the bundle should be creating them.
    check("the lightbox is real markup, not invented <div>s",
          'el.id = id' not in code and 'createElement("div")' not in code.split("shim.js")[-1][:4000])

    print("\n-- every platform feature is wired --")
    for fn in ["addToBasket", "_setQty", "_syncQtyCtrl", "_basketKey", "_variantsHtml",
               "_addonsHtml", "_variantIndex", "_qtyCtrlHtml", "_updateBasketBar",
               "_renderBasketPanel", "_openBasket", "_closeBasket", "_showWaiterQR",
               "openModal", "closeModal", "openLightbox", "closeLightbox", "openAR",
               "applyFilter", "applyLang", "applyTheme", "setARButtonsState"]:
        # `window.x = ` for the ones we publish, `function x(` for the ported ones that
        # live in the shared top-level scope.
        check(f"{fn} is defined",
              f"window.{fn} = " in bundle or f"window.{fn} =" in bundle
              or re.search(r"function\s+%s\s*\(" % re.escape(fn), bundle) is not None)

    # ── 2. the boot ──────────────────────────────────────────────────────────────────
    #
    # `__bootViewer` was defined and called from NOWHERE, so `menuItems` stayed empty on
    # every deployed page: no thumbnail ever upgraded to live 3D, no AR model was ever
    # preloaded, and every 3D/AR event was filed against item index -1.
    check("__bootViewer is actually called", "__bootViewer()" in bundle)
    check("the file order puts platform.js before viewer.js",
          bundle.index("---- platform.js ----") < bundle.index("---- viewer.js ----"))
    check("the UI strings are the platform's, all three languages",
          all(f'\n    {lang}: {{' in bundle for lang in ("en", "ka", "ru")))

    # ── 3. add to cart ───────────────────────────────────────────────────────────────
    print("\n-- add to cart, on every card, in every template --")
    cards = re.findall(r'<div class="menu-item[^"]*"[^>]*data-idx="(\d+)"', html)
    check("every dish rendered a card", len(cards) >= len(MENU["items"]),
          f"{len(cards)} cards for {len(MENU['items'])} dishes")
    carts = html.count('class="qty-add-btn"')
    check("every card has an add-to-cart button", carts == len(cards),
          f"{carts} buttons / {len(cards)} cards")
    check("...including the text-only ones",
          html.count("no-image") > 0 and 'class="menu-item no-image"' in html)
    for part in ['class="qty-ctrl"', 'class="qty-stepper"', 'class="qty-dec"',
                 'class="qty-inc"', 'class="qty-num"']:
        check(f"the stepper has its {part.split('=')[1]}", part in html)

    # ── 4. sizes and add-ons ─────────────────────────────────────────────────────────
    print("\n-- sizes and add-ons --")
    check("a dish with sizes renders its pills", html.count('class="variant ') >= 1)
    check("...one of them selected", 'class="variant selected"' in html)
    check("...each carrying its own price", 'class="variant-price">8 ₾' in html)
    check("a dish with add-ons renders them", 'class="addon"' in html)
    check("...priced as an extra", 'class="addon-price">+3 ₾' in html)
    # The one thing that cannot be scraped back out of markup, because the basket does
    # arithmetic on it.
    check("sizes and add-ons also travel as data for the basket",
          set(page["items"].keys()) == {"3", "4"}, str(sorted(page["items"])))
    check("...and nothing else is duplicated into it",
          all(set(v) <= {"v", "a"} for v in page["items"].values()))

    # ── 5. 3D on top, and in its own category too ────────────────────────────────────
    print("\n-- 3D first --")
    check("there is a 3D block", 'data-cat="__ar3d"' in html)
    check("...with the AR banner", 'class="ar-featured-banner"' in html)
    check("...and it comes before every category",
          html.index('data-cat="__ar3d"') < html.index('data-cat="c1"'))
    # Two cards, one dish. Both carry idx 0 on purpose, so the basket, AR and the event
    # sink treat them as one item - the platform's own arrangement.
    dish_a = re.findall(r'<div class="menu-item[^"]*" data-idx="0" data-id="a"', html)
    check("a 3D dish appears in the 3D block AND its own category", len(dish_a) == 2,
          f"{len(dish_a)} cards")
    check("...and only one of them wears the 3D-block badge",
          html.count("menu-item ar-featured") == 1)
    check("the 3D pill is a sentinel, not the name '3D'", 'data-cat="__ar3d"' in bar)
    # The Wrap has an approved model AND `is_3d` off - the owner's call. Inferring 3D from
    # the presence of a GLB, which the runtime used to do, overrode that silently: no badge
    # and no button (correct) but it still opened the 3D viewer on a tap.
    wrap = re.search(r'<div class="menu-item[^"]*" data-idx="2"[^>]*>', html).group(0)
    check("a dish with a model but is_3d off is a PHOTO dish",
          "data-is3d" not in wrap and "data-glb" in wrap, wrap[:90])
    check("...so it gets no 3D badge", html.count('class="badge-3d"') == 2)
    check("...and no AR button", html.count('class="ar-btn"') == 2)

    # ── 6. categories ────────────────────────────────────────────────────────────────
    print("\n-- categories --")
    #
    # **The check that lied.** This block used to count
    # `[...cards].filter(c => !c.hidden)` - reading back the attribute the filter had just
    # written. It was always right, and nothing moved on screen, because
    # `[hidden] {display:none}` is a USER-AGENT rule while the template sheet's
    # `.menu-item {display: grid}` is an AUTHOR rule, which wins at any specificity.
    # Reading back a property your own code just set is not a test of anything.
    #
    # So: prove it from the CSS instead. For every element the filter hides, either the
    # template sheet never gives it an unconditional `display`, or `platform.css` overrides
    # the hidden state with `!important`. Those are the only two ways `hidden` can hide.
    platform_css = (LIB / "platform.css").read_text(encoding="utf-8")
    check("there is a platform stylesheet at all", bool(platform_css.strip()))
    check("...and the page loads it AFTER the template sheet",
          _loads_platform_css_last(), "equal specificity: the last one wins")
    for target in _HIDEABLE:
        check(f"{target} can actually be hidden",
              f"{target}[hidden]" in platform_css
              and "display: none !important" in platform_css)
    for name in ("monday_greens", "elegant_black"):
        sheet = (LIB / "css" / f"{name}.css").read_text(encoding="utf-8")
        clashes = _display_subjects(sheet)
        missing = [t for t in clashes if f"{t}[hidden]" not in platform_css]
        check(f"{name}: everything it gives a `display` is still hideable",
              not missing, ", ".join(missing) or f"{len(clashes)} guarded")
    check("the list is grouped into sections", html.count('class="cat-section"') == 3)
    check("each with a heading", html.count('class="category-header"') == 2)
    check("in the owner's order, not alphabetical",
          html.index(">Breakfast<") < html.index(">Drinks<"))
    check("every category has a pill", bar.count("cat-pill") == 4)
    check("...and 'All' is the one selected", 'class="cat-pill active" data-cat=""' in bar)
    check("the scroll arrows exist for a long bar", "cat-nav-l" in bar and "cat-nav-r" in bar)

    # ── 7. language ──────────────────────────────────────────────────────────────────
    print("\n-- language --")
    check("a two-language restaurant gets the switch", 'id="lang-toggle"' in page["toggles"])
    check("...offering the OTHER language", 'ქარ</button>' in page["toggles"])
    check("names carry their translation", 'data-name-ka="ბენედიქტი"' in html)
    check("so do descriptions", 'data-desc-ka="კვერცხი"' in html)
    check("so do category pills", 'data-cat-ka="საუზმე"' in bar)
    check("so do category headings", 'data-cat-ka="საუზმე"' in html)
    check("rendering in Georgian actually uses them", "ბენედიქტი" in ka)
    check("...for the headings too", "საუზმე" in ka)
    check("...and the size pills", "ჩვეულებრივი" in ka)

    # ── 8. day / night ───────────────────────────────────────────────────────────────
    print("\n-- day / night --")
    check("the theme button exists", 'id="theme-toggle"' in page["toggles"])
    # It is a 34px circle in the platform's sheet. A word does not fit in one, which is
    # why it shipped looking like "a small button that does nothing".
    check("...and ships empty, for an icon rather than a word",
          'id="theme-toggle" aria-label="Toggle theme"></button>' in page["toggles"])
    check("the switch paints a sun and a moon", "M21 12.79A9 9 0" in bundle
          and 'circle cx="12" cy="12" r="4"' in bundle)
    check("the choice is remembered per restaurant", 'br-theme:' in bundle)
    theme = (LIB / "theme.js").read_text(encoding="utf-8")
    check("BOTH palettes are emitted, so there is something to switch to",
          'data-theme="${mode}"' in theme and '["day", "night"]' in theme)

    # ── 9. photo expansion ───────────────────────────────────────────────────────────
    print("\n-- photo expansion --")
    check("the lightbox opens with the dish, not just the picture",
          "_lightbox.classList.add('has-panel')" in bundle)
    check("...and can add it to the basket from there", "_addLightboxItem" in bundle)
    check("a photo dish is bound to open it",
          "openLightbox(item.thumbnail_url" in bundle)

    # ── 10. show to staff ────────────────────────────────────────────────────────────
    print("\n-- show to staff --")
    check("the order packs ids, never prices", "item.id, entry.qty" in bundle)
    check("...UTF-8 safe, because dish names are Georgian", "TextEncoder" in bundle)
    check("the QR library is vendored, not fetched from a CDN",
          '"/vendor/qrcode.js"' in bundle
          and (ROOT / "app" / "public" / "vendor" / "qrcode.js").is_file())
    check("...and loaded only on the first tap", "_qrLibPromise" in bundle)
    check("the staff page exists to receive it",
          (ROOT / "app" / "src" / "pages" / "w" / "[slug].astro").is_file())
    check("...and the QR points at it", 'location.origin + "/w/"' in bundle)

    # ── 10b. the counts ──────────────────────────────────────────────────────────────
    #
    # **Every event the ported code fires must be either translated or explicitly not
    # counted.** The shim drops any name it does not recognise - correctly, so that an open
    # name column never becomes a junk drawer - and that is exactly what made this silent:
    # the map was written from the platform's vocabulary as I remembered it, so
    # `track('item_view')` and `track('ar_tap')` went nowhere, and the analytics screen
    # showed a funnel where later stages were larger than the first.
    #
    # Read from the BUILT bundle, so a newly ported file that calls something new turns
    # this red on the next build rather than at the end of a client's first month.
    print("\n-- every count the viewer takes is actually filed --")
    # `code`, not `bundle`: the comment in shim.js that explains this very check contains
    # the words track('x'), and scanning the raw text made the check fail on its own
    # documentation. Same reason the stub search above is comment-stripped.
    fired = sorted(set(re.findall(r"""\btrack\(\s*['"]([a-z_]+)['"]""", code)))
    check("the viewer reports events at all", len(fired) >= 10, f"{len(fired)} names")
    # The map is read out of the EVENT_NAME literal itself, not line by line: several
    # entries share a line, and a per-line regex silently reported them as unmapped - which
    # made this check's own first run cry wolf about six names that were fine.
    body = bundle.split("const EVENT_NAME = {", 1)[1].split("};", 1)[0]
    pairs = re.findall(r"([a-z_]+)\s*:\s*\"([a-z_]+)\"", body)
    mapped = {k for k, _ in pairs}
    not_counted = set(re.findall(
        r'"([a-z_]+)"', bundle.split("NOT_COUNTED = [", 1)[1].split("]", 1)[0]))
    unhandled = [n for n in fired if n not in mapped and n not in not_counted]
    check("...and none of them is silently dropped", not unhandled,
          ", ".join(unhandled) or f"{len(fired)} handled")
    # The three that were actually missing, named individually so a future refactor that
    # loses one says WHICH one.
    for name, why in [("view", "the funnel's denominator"),
                      ("item_view", "a dish opened in 3D"),
                      ("ar_tap", "a diner asking for AR")]:
        check(f"{name} is translated ({why})", name in mapped)
    check("the menu actually fires a view on load", 'window.track("view")' in bundle)
    # The sink's whitelist is the other half: a name translated to something `record_events`
    # refuses is dropped one layer further down, which looks identical from the screen.
    # The NEWEST migration that redefines the whitelist, not 0009 - it has been widened
    # once already (0017, the basket) and reading the original would have this check
    # confidently enforcing last month's rules.
    sinks = sorted((ROOT / "menu" / "migrations").glob("0*.sql"))
    sink = [f.read_text(encoding="utf-8") for f in sinks if "v_name not in (" in
            f.read_text(encoding="utf-8")][-1]
    allowed = set(re.findall(r"'([a-z_]+)'", sink.split("v_name not in (")[1].split(")")[0]))
    targets = {v for _, v in pairs}
    strays = sorted(t for t in targets if t not in allowed)
    check("every name we translate TO is one the sink accepts", not strays,
          ", ".join(strays) or f"{len(targets)} names")

    # ── 11. the page is still complete on arrival ────────────────────────────────────
    print("\n-- and none of this moved a dish out of the HTML --")
    check("every dish name is in the markup",
          all(i["name_en"] in html for i in MENU["items"]))
    check("every price too", all(i["price"] in html for i in MENU["items"]))
    check("nothing is fetched to draw the menu",
          "fetch(" not in html and "XMLHttpRequest" not in html)
    check("the camera angle rides on the card", 'data-orbit="10 20 100"' in html)
    check("the dish's real id does too, for the sink and the QR", 'data-id="a"' in html)

    # -- 12. the page a diner gets when there is no page ----------------------------
    #
    # The widest-reach surface in the product: a phone held over a QR code, in a
    # restaurant, usually with somebody waiting. It was two bare English strings in
    # text/plain, and the 503 printed the exception - so a database error would have shown
    # an anonymous visitor a PostgREST message naming our tables. It reads as the
    # RESTAURANT being broken, not us, which is why it is checked here with the features
    # rather than filed as cosmetics.
    print("")
    print("-- and when there is no menu to show --")
    oops = (ROOT / "app" / "src" / "lib" / "nomenu.js").read_text(encoding="utf-8")
    for name, page in (("the menu", "[slug].astro"),
                       ("the waiter's page", "w/[slug].astro")):
        src = (ROOT / "app" / "src" / "pages" / page).read_text(encoding="utf-8")
        check(name + " answers a bad address with a real page",
              "return noMenu()" in src and "No menu for" not in src)
        check(name + " answers a load failure with a real page",
              "return menuUnavailable(slug, error)" in src
              and "Menu unavailable:" not in src)
    check("both answers are HTML, not text/plain",
          oops.count('content-type": "text/html') == 2)
    check("they speak Georgian first", 'lang="ka"' in oops and "\u10db\u10d4\u10dc\u10d8\u10e3" in oops)
    check("and English too", "ask a member of staff" in oops)
    check("the 503 never prints what went wrong to the diner",
          "${err}" not in oops and "${error}" not in oops)
    check("it goes to the log instead", "console.error(" in oops)
    check("a broken menu is never cached in place of a working one",
          '"cache-control": "no-store"' in oops)
    check("and the page renders with nothing else working",
          "<style>" in oops and "<link" not in oops and "<script" not in oops)

    print("")

    print("\n" + "=" * 62)
    bad = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print(f"  FAILED: {n}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
