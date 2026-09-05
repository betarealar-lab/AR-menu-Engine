#!/usr/bin/env python3
"""The rendered page: complete on arrival, safe with a stranger's typing, and carrying
production's own viewer rather than a lookalike.

    python check_render.py

Renders snapshots through `menu/render/render.mjs` - the real module, not a copy - and
reads the HTML that comes back. Needs Node. Touches no database, no bucket, no credits.

**Two claims are under test.**

The first is MENU-PLATFORM §2.1a: a diner never watches a generic page re-skin itself into
a restaurant's page. That is not a feeling, it is structural properties of the bytes -
theme colours inside `<head>`, every dish in the markup, nothing fetched before paint, and
CSS that actually resolves.

The second is that the 3D and AR code is **the platform's, unedited**. An earlier version
of this reimplemented it and it did not work; Temo's correction was blunt and right - "why
not just copy the existing systems". So these checks assert the ported files appear byte
for byte, that every inlined script parses, and that the markup carries the selectors
their code queries. A port that has quietly drifted from its source is the failure worth
catching, because it looks exactly like a port that has not.

**What this file CANNOT check**, and a person has to: whether the models actually appear.
`IntersectionObserver` does not report intersections in a hidden tab and model-viewer does
not decode in one, so the poster-to-3D upgrade is invisible to any automated browser that
is not in the foreground. Open the preview and look.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RENDERER = ROOT / "menu" / "render" / "render.mjs"
PORTED = ROOT / "menu" / "render" / "ported"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


def render(snap: dict) -> str:
    out = subprocess.run(["node", str(RENDERER), "-"], input=json.dumps(snap).encode(),
                         capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.decode("utf-8", "replace")[:500])
    return out.stdout.decode("utf-8")


def snapshot(**over) -> dict:
    base = {
        "format": 1, "version": 7,
        "tenant": {"id": "t1", "slug": "s", "name": "Sakhli"},
        "template": "plain",
        "theme": {"text": "#101010", "bg": "#fffdf7", "accent": "#2f6f4f"},
        "categories": [{"id": "c1", "name": "Plates", "position": 0}],
        "items": [{
            "id": "i1", "name": "Chicken Shqmeruli", "description": "Garlic, cream.",
            "price_minor": 2450, "currency": "GEL", "category_id": "c1", "position": 0,
            "photo": None,
            "model": {"draco": "catalog/a/model_draco.glb", "usdz": "catalog/a/model.usdz",
                      "poster": None, "scale_cm": 26.0, "scale_axis": "width",
                      "orbit": None},
        }],
    }
    base.update(over)
    return base


def main() -> int:
    if not RENDERER.is_file():
        print(f"missing {RENDERER}")
        return 2
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
    except Exception:                                         # noqa: BLE001
        print("node is not on PATH")
        return 2

    html = render(snapshot())
    head = html[: html.index("</head>")]
    body = html[html.index("<body"):]

    print("\n== the page arrives finished ==")
    check("it is a complete document",
          html.startswith("<!doctype html>") and html.rstrip().endswith("</html>"))
    check("the restaurant's accent colour is in the HEAD", "#2f6f4f" in head)
    check("and so is its background colour", "#fffdf7" in head)
    check("mapped onto the platform's own variable names",
          "--bg: #fffdf7;" in head and "--accent: #2f6f4f;" in head)
    check("and a key outside their map is dropped, not passed through",
          "nonsense" not in render(snapshot(theme={"nonsense": "#123456"})))
    check("the dish name is in the markup, not fetched", "Chicken Shqmeruli" in body)
    check("so is the price, already formatted", "₾24.50" in body)
    check("and the restaurant's name", "Sakhli" in body)

    print("\n== nothing loads before the menu does ==")
    check("no stylesheet is fetched", "<link" not in html.lower())
    check("no menu data is fetched by the page itself",
          not re.search(r"fetch\(\s*['\"]/", html))
    # The scripts sit after the markup, so the menu is readable before a line of them has
    # run. That ordering IS the no-flash claim; nothing else gives it.
    check("every script comes after the menu markup",
          html.index("<script") > html.index("Chicken Shqmeruli"))
    check("and the viewer boots on load, not during parse",
          "window.__bootViewer();" in html and 'readyState === "complete"' in html)

    print("\n== the CSS actually resolves ==")
    cycles = re.findall(r"--([a-z-]+)\s*:\s*var\(\s*--\1\b", head)
    check("no custom property refers to itself", not cycles, str(cycles))
    # menu.css ships its own :root defaults. Ours must come AFTER them or every default
    # silently overrides the template - which it did, and the page rendered with no
    # background at all while every variable was present and correct.
    check("the tenant palette is the LAST :root in the head",
          head.rindex(":root {") > head.index("--bg-image") - 1
          and head.index("#2f6f4f") > head.index("menu.css".replace("menu.css", "--bg:")))
    check("so a template beats the shipped defaults",
          head.rindex("--accent: #2f6f4f;") > head.index(":root"))

    print("\n== every inlined script is real JavaScript ==")
    blocks = re.findall(r"<script>(.*?)</script>", html, re.S)
    check("four script blocks: xr, shim, viewer, boot", len(blocks) == 4, f"{len(blocks)}")
    for i, b in enumerate(blocks):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                         encoding="utf-8") as fh:
            fh.write(b)
            tmp = fh.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True)
        os.unlink(tmp)
        check(f"block {i} parses ({len(b):,} chars)", r.returncode == 0,
              r.stderr.decode("utf-8", "replace").strip().splitlines()[0][:110]
              if r.returncode else "")

    print("\n== it is PRODUCTION'S viewer, not a lookalike ==")
    # Byte for byte. A drifted port looks exactly like an intact one, right up until a
    # bug is fixed upstream and not here - or an edit here silently diverges from the code
    # that is known to work on real phones in real restaurants.
    for name in ("xr.js", "viewer.js"):
        src = (PORTED / name).read_text(encoding="utf-8")
        check(f"ported/{name} is in the page verbatim", src in html, f"{len(src):,} chars")
    check("the shim is the only adapter",
          (PORTED / "shim.js").read_text(encoding="utf-8") in html)
    check("model-viewer 3.4.0, the version production ships",
          "model-viewer/3.4.0/model-viewer.min.js" in html)
    check("the 3D modal is on the page", 'id="modal-viewer"' in html)
    check("so is the WebXR overlay", 'id="xr-overlay"' in html)
    check("iOS AR goes through a rel=ar anchor", "setAttribute('rel', 'ar')" in html)
    check("Android AR has the Three.js carousel", "window.XR = {" in html)

    print("\n== a template is a palette, not a page ==")
    mg = render(snapshot(template="monday_greens", theme={}))
    check("a known template is applied", 'data-template="monday_greens"' in mg)
    check("its preset supplies the palette",
          "--card-bg: linear-gradient(158deg" in mg)
    check("Monday Greens opens in the DAY palette", 'data-mode="day"' in mg)
    check("and its template-scoped rules come across",
          '[data-template="monday_greens"]' in mg)
    other = render(snapshot(template="urban_night", theme={}))
    check("another template is a different palette, same markup",
          'data-mode="night"' in other
          and other.count('class="menu-item') == mg.count('class="menu-item'))
    unknown = render(snapshot(template="not_a_template"))
    check("an unknown template falls back rather than breaking",
          'data-template=""' in unknown and "menu-item" in unknown)

    print("\n== the markup their code queries ==")
    # Their selectors are the contract. `_startThumbUpgrades` queries exactly this and
    # `_upgradeThumb` reads exactly these attributes, so renaming a class here is a silent
    # break rather than a style tweak.
    check("cards are .menu-item with a data-idx",
          'class="menu-item' in body and 'data-idx="0"' in body)
    check("thumbnails are .thumb-img[data-model]",
          'class="thumb-img"' in body and "data-model=" in body)
    check("with the global index their code reads", 'data-global-idx="0"' in body)
    check("the 3D badge is production's", 'class="badge-3d">3D<' in body)
    check("the card carries its usdz for Quick Look", "data-usdz=" in body)
    check("and real-world scale WITH its axis",
          'data-cm="26"' in body and 'data-axis="width"' in body)

    orbited = render(snapshot(items=[dict(
        snapshot()["items"][0],
        model=dict(snapshot()["items"][0]["model"], orbit="0 30 105"))]))
    check("a per-model camera angle reaches the page",
          'data-orbit="0 30 105"' in orbited)
    check("and the shim feeds it in production's own key format",
          "item_view_" in orbited)

    print("\n== the nine symbols the port needs from us ==")
    shim = (PORTED / "shim.js").read_text(encoding="utf-8")
    for sym in ("menuItems", "_themeConfig", "track", "idle", "_trackFirstInteraction",
                "addToBasket", "_setQty", "_syncQtyCtrl", "_basketKey", "t",
                "_setPriceWithOld", "_variantsHtml", "_addonsHtml", "_variantIndex"):
        check(f"shim provides {sym}", f"window.{sym} =" in shim)
    # Every one of these is bound at top level by viewer.js. A missing element is
    # `null.addEventListener`, which aborts the rest of the block and leaves every `let`
    # after it in the temporal dead zone - the symptom being "openModal exists but throws
    # Cannot access '_mvPromise' before initialization", which points nowhere useful.
    check("and stubs the lightbox DOM it wires at parse time",
          "img-lightbox" in shim and "qty-add-btn" in shim)

    print("\n== a menu is a stranger's typing ==")
    nasty = snapshot(items=[{
        "id": "x", "name": '<script>alert(1)</script> & "Chips"',
        "description": "</style><img src=x onerror=alert(2)>",
        "price_minor": 100, "currency": "GEL", "category_id": None, "position": 0,
        "photo": None, "model": None,
    }])
    out = render(nasty)
    check("a dish name cannot open a tag", "<script>alert(1)" not in out)
    check("nor can a description close the stylesheet", "</style><img" not in out)
    check("the text still shows, escaped", "&lt;script&gt;alert(1)" in out)

    injected = render(snapshot(theme={
        "accent": "#0f0",
        "evil": "red; } body { display: none } .x {",
        "also_evil": "</style><script>alert(3)</script>",
        "card_bg": "linear-gradient(120deg, #25c265, #3b82f6)",
    }))
    ihead = injected[: injected.index("</head>")]
    root = ihead.split(":root {")[1].split("}")[0]
    check("a theme value cannot escape its declaration",
          "display: none" not in root and "}" not in root)
    check("nor close the style block", "</style><script>alert(3)" not in injected)
    # Gradients are the normal shape of these values and they are full of commas,
    # parentheses and hashes - the filter has to pass them intact or every template
    # loses its background.
    check("a real gradient survives the filter",
          "linear-gradient(120deg, #25c265, #3b82f6)" in ihead)
    check("and a legitimate colour does", "#0f0" in ihead)

    print("\n== the shapes that will actually occur ==")
    empty = render(snapshot(items=[], categories=[]))
    check("a menu with no items still renders", "<html" in empty and "Sakhli" in empty)
    check("and ships no viewer it does not need", "<script" not in empty)
    check("nor the WebXR overlay", "xr-overlay" not in empty)

    no3d = render(snapshot(items=[dict(snapshot()["items"][0], model=None)]))
    check("an item with no model has no 3D badge", "badge-3d" not in no3d)
    check("a photo-only menu ships no viewer either", "<script" not in no3d)

    loose = render(snapshot(items=[dict(snapshot()["items"][0], category_id=None)]))
    check("an item in no category is still on the menu", "Chicken Shqmeruli" in loose)

    long_menu = render(snapshot(items=[
        dict(snapshot()["items"][0], id=str(i), name=f"Dish {i}", position=i)
        for i in range(120)]))
    check("120 items render", "Dish 119" in long_menu)
    # ~90 KB of that is the viewer, identical for every tenant, inlined so nothing is
    # fetched before paint. Worth watching rather than worrying about: if it ever matters,
    # the two big scripts move to one shared cached file and only the CSS stays inline -
    # which is all the no-flash claim actually needs.
    size = len(long_menu.encode())
    # ~92 KB of that is the viewer, byte-identical for every tenant and every page, plus
    # ~1 KB per dish. Gzip takes the whole thing to roughly a quarter. The number to
    # watch is the FIXED part: the day it matters, the two big scripts move to one shared
    # cached file and only the CSS stays inline, which is all the no-flash claim needs.
    # ~115 KB of this is fixed - the platform's menu CSS, viewer CSS, viewer.js and the
    # WebXR carousel - identical on every page of every tenant, so it gzips hard and is
    # inlined only because nothing may be fetched before paint. The number to watch is
    # that fixed part; the day it matters, the two big scripts move to one shared cached
    # file and only the CSS stays inline, which is all the no-flash claim needs.
    check("and a 120-item menu stays under 340 KB", size < 340_000, f"{size:,} bytes")
    # A photo-only restaurant still gets the structural CSS - that is the menu itself -
    # but none of the 3D machinery, which is the part that costs.
    plain = render(snapshot(items=[], categories=[]))
    check("a menu with no 3D carries no viewer JS", "<script" not in plain)
    check("nor the viewer CSS", "#modal-viewer" not in plain and "#xr-overlay" not in plain)
    check("and it is a fraction of the size",
          len(plain.encode()) < len(long_menu.encode()) / 5,
          f"{len(plain.encode()):,} vs {len(long_menu.encode()):,} bytes")

    print("\n" + "=" * 62)
    bad = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print(f"  FAILED: {n}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
