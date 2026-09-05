#!/usr/bin/env python3
"""The rendered page: complete on arrival, and safe with a stranger's typing in it.

    python check_render.py

Renders snapshots through `menu/render/render.mjs` - the real module, not a copy - and
reads the HTML that comes back. Needs Node. Touches no database, no bucket, no credits.

**The claim under test** is MENU-PLATFORM §2.1a: a diner never watches a generic page
re-skin itself into a restaurant's page. That is not a feeling, it is four structural
properties of the bytes, and each of them is one careless edit away from being lost:

    the theme's colours are inside <head>, before any content
    every dish is in the markup, not fetched afterwards
    nothing is fetched before first paint at all
    the CSS actually resolves - a self-referential custom property renders colourless,
    which looks exactly like a theme that failed to load

And the part nobody thinks about until self-serve exists: **a menu is a stranger's
typing.** Dish names, descriptions and theme values are all written by a restaurant owner
we have never met, and they end up in HTML and in a <style> block respectively.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RENDERER = ROOT / "menu" / "render" / "render.mjs"
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
        "theme": {"ink": "#101010", "paper": "#fffdf7", "accent": "#2f6f4f"},
        "categories": [{"id": "c1", "name": "Plates", "position": 0}],
        "items": [{
            "id": "i1", "name": "Chicken Shqmeruli", "description": "Garlic, cream.",
            "price_minor": 2450, "currency": "GEL", "category_id": "c1", "position": 0,
            "photo": None,
            "model": {"draco": "catalog/a/model_draco.glb", "usdz": "catalog/a/model.usdz",
                      "poster": None, "scale_cm": 26.0, "scale_axis": "width"},
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
    check("and so is its paper colour", "#fffdf7" in head)
    check("the dish name is in the markup, not fetched",
          "Chicken Shqmeruli" in body)
    check("so is the price, already formatted", "₾24.50" in body,
          re.search(r"₾[\d.]+", body).group(0) if re.search(r"₾[\d.]+", body) else "none")
    check("and the restaurant's name", "Sakhli" in body)
    check("the 3D badge is on the item that has a model", ">3D<" in body)
    # A number with no axis is not a size. The live records use `height` as often as
    # `width` - a bare "4" reads as a 4 cm plate or a 4 cm tall stack depending on which,
    # and getting it wrong puts a dish on a table at the wrong size in a way that looks
    # like a bad model rather than a bad attribute.
    check("real-world scale carries its axis, not just a number",
          'data-cm="26"' in body and 'data-axis="width"' in body,
          re.search(r'data-cm="[^"]*"( data-axis="[^"]*")?', body).group(0))

    print("\n== nothing loads before the menu does ==")
    check("no stylesheet is fetched", "<link" not in html.lower())
    check("no menu data is fetched",
          not re.search(r"\bfetch\s*\(|XMLHttpRequest|\.json\b", html))
    scripts = re.findall(r"<script", html)
    check("at most one script tag", len(scripts) <= 1, f"{len(scripts)}")
    if scripts:
        tail = html[html.index("<script"):]
        check("and it comes after the menu markup",
              html.index("<script") > html.index("Chicken Shqmeruli"))
        check("it waits for load before doing anything",
              'addEventListener("load"' in tail)

    print("\n== the inlined script is real JavaScript ==")
    # It is built as a String.raw template literal, so a single backtick anywhere inside
    # it silently ends the literal and the rest is parsed as code. That has broken this
    # file three times in one session, each time reporting a syntax error dozens of lines
    # from the actual cause - and an inlined script that does not parse takes the WHOLE
    # page down, not just the 3D.
    import tempfile
    body_js = re.search(r"<script>(.*?)</script>", html, re.S)
    check("there is an inlined script", bool(body_js))
    if body_js:
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                         encoding="utf-8") as fh:
            fh.write(body_js.group(1))
            tmp = fh.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True)
        Path(tmp).unlink(missing_ok=True)
        check("and node parses it without error", r.returncode == 0,
              r.stderr.decode("utf-8", "replace").strip().splitlines()[0][:110]
              if r.returncode else "")
        check("it contains no stray backtick", "`" not in body_js.group(1),
              "a backtick here ends the template literal that builds it")

    print("\n== the 3D and AR behaviour, as production does it ==")
    # Same model-viewer version the platform ships. A rendering difference between old
    # menus and new ones is a thing somebody would have to chase down one day, for no
    # gain at all.
    check("model-viewer 3.4.0, the version already in production",
          "model-viewer/3.4.0/model-viewer.min.js" in html)
    check("loaded from the same CDN", "ajax.googleapis.com" in html)
    check("but NOT in the head - it is ~250 KB",
          "model-viewer.min.js" not in head)
    check("and it fails OPEN, so a dead CDN leaves a working menu",
          "onerror" in html and "resolve()" in html)

    check("the card carries its own model url", 'data-glb="' in body)
    check("and its usdz for iOS", 'data-usdz="' in body)
    check("and its name, so the modal needs no lookup", 'data-name="' in body)

    orbited = render(snapshot(items=[dict(
        snapshot()["items"][0],
        model=dict(snapshot()["items"][0]["model"], orbit="0 30 105"))]))
    check("a per-model camera angle reaches the page",
          'data-orbit="0 30 105"' in orbited)
    # Same "h v zoom" convention, same clamps, as the admin people already use.
    check("clamped the way the admin clamps it",
          "Math.min(360" in html and "Math.min(85" in html and "Math.min(300" in html)

    # Quick Look fires only from a click on an <a rel="ar"> CONTAINING an <img>, inside
    # the tap. Anything asynchronous first loses the gesture and it silently does nothing
    # - which is indistinguishable from AR being broken.
    check("iOS AR goes through a rel=ar anchor, not activateAR",
          'setAttribute("rel", "ar")' in html)
    check("with the <img> Quick Look requires",
          'a.appendChild(document.createElement("img"))' in html)
    check("Android gets scene-viewer / WebXR",
          '"ar-modes", "webxr scene-viewer"' in html)

    check("live 3D cards are capped", "MAX_LIVE" in html)
    check("posters upgrade only once in view", "IntersectionObserver" in html
          and 'rootMargin: "200px"' in html)
    check("and the modal drops its viewer on close, not just hides it",
          'innerHTML = ""' in html)

    print("\n== the CSS actually resolves ==")
    # `--x: var(--x, ...)` is a cycle. CSS resolves a cyclic custom property to the
    # guaranteed-invalid value, so the page renders with NO colours - which looks exactly
    # like a theme that failed to load. Found in this renderer's first draft.
    cycles = re.findall(r"--([a-z-]+)\s*:\s*var\(\s*--\1\b", head)
    check("no custom property refers to itself", not cycles, str(cycles))
    check("defaults come BEFORE the theme, so the theme wins",
          head.index("#b4552d") < head.index("#2f6f4f"))

    print("\n== a menu is a stranger's typing ==")
    nasty = snapshot(items=[{
        "id": "x", "name": '<script>alert(1)</script> & "Chips"',
        "description": "</style><img src=x onerror=alert(2)>",
        "price_minor": 100, "currency": "GEL", "category_id": None, "position": 0,
        "photo": None, "model": None,
    }])
    out = render(nasty)
    check("a dish name cannot open a tag", "<script>alert(1)" not in out)
    check("nor can a description close the stylesheet",
          "</style><img" not in out)
    check("the text still shows, escaped", "&lt;script&gt;alert(1)" in out)

    injected = render(snapshot(theme={
        "accent": "#0f0",
        "evil": "red; } body { display: none } .x {",
        "also_evil": "</style><script>alert(3)</script>",
        "url_ok": "Georgia, 'Times New Roman', serif",
    }))
    ihead = injected[: injected.index("</head>")]
    check("a theme value cannot escape its declaration",
          "display: none" not in ihead and "}" not in ihead.split(":root {")[1].split("}")[0])
    check("nor close the style block", "</style><script>" not in injected)
    check("a legitimate font stack survives the filter",
          "Times New Roman" in ihead)
    check("and a legitimate colour does", "#0f0" in ihead)

    print("\n== the shapes that will actually occur ==")
    empty = render(snapshot(items=[], categories=[]))
    check("a menu with no items still renders", "<html" in empty and "Sakhli" in empty)
    check("and loads no 3D machinery it does not need", "<script" not in empty)

    no3d = render(snapshot(items=[dict(snapshot()["items"][0], model=None)]))
    check("an item with no model has no 3D badge", ">3D<" not in no3d)
    check("and such a page ships no script at all", "<script" not in no3d)

    loose = render(snapshot(items=[dict(snapshot()["items"][0], category_id=None)]))
    check("an item in no category is still on the menu",
          "Chicken Shqmeruli" in loose)

    long_menu = render(snapshot(items=[
        dict(snapshot()["items"][0], id=str(i), name=f"Dish {i}", position=i)
        for i in range(120)]))
    check("120 items render", "Dish 119" in long_menu)
    size = len(long_menu.encode())
    # The payload is the thing being sold: a menu that arrives instantly on café wifi.
    check("and a 120-item menu is still small", size < 120_000, f"{size:,} bytes")

    print("\n" + "=" * 62)
    bad = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print(f"  FAILED: {n}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
