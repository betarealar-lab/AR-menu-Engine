#!/usr/bin/env python3
"""The customer app, served with its data already in the page.

    python menu/app/serve.py               http://127.0.0.1:8800/mg
    python menu/app/serve.py --port 9000

This is the Worker, standing in on a laptop. It does three things, and the third is the
whole point:

    GET /<slug>     the forked app, with this tenant's data inlined in the head
    GET /a/<key>    bytes from a private R2 bucket
    GET /<file>     the app's own static files

**The double load, and why inlining ends it.** Production fetches its tenant, theme and
menu with `await fetch(...)` after the HTML has arrived. A network await lets the browser
paint what it has - an unthemed shell with an empty menu - and the real page lands
afterwards. Two paints; the spinner is the gap.

Inlined, there is no network on the critical path. The app's awaits resolve as
microtasks, microtasks run **before** paint, and the browser parses, builds the entire
menu and paints once, finished.

Belt and braces on top of that: the palette is also written as real CSS custom properties
in the head, so even the colours are correct on the first paint rather than being applied
by script afterwards. `applyRemoteTheme` then sets the same values again and nothing
visibly changes.

The app itself is unmodified apart from `patch_bootstrap.py`'s five lines - so every
template, the category bar, the 3D block, AR routing and the phone layouts behave exactly
as they do in production, because they are the same code.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

import storage                                                # noqa: E402
from config import load_env                                   # noqa: E402
from menu.app import bootstrap                                # noqa: E402

TYPES = {
    ".glb": "model/gltf-binary", ".usdz": "model/vnd.usdz+zip", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".json": "application/json", ".js": "text/javascript", ".css": "text/css",
    ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml",
}


def bucket_for(key: str) -> str:
    if key.startswith(("catalog/", "models/")):
        return "models"
    if key.startswith("t/"):
        return "menus"
    return "photos"


# The palette keys the app maps onto CSS custom properties. Same list as theme.mjs, which
# is itself the platform's own `varMap` - see menu/render_theme_keys.py.
from menu.render_theme_keys import PALETTE_KEYS                # noqa: E402

SAFE = set("-#0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ "
           ",.%()/'\"+*_")


def theme_css(cfg: dict, mode: str) -> str:
    """The palette as real CSS, in the head, before anything paints.

    The app sets these at runtime with `style.setProperty` once theme_config arrives -
    which is precisely the re-skin a diner watches happen. Writing them here as well
    means the very first paint is already the restaurant's colours; the runtime pass then
    sets identical values and nothing changes on screen.
    """
    other = "night_" if mode == "day" else "day_"
    want = mode + "_"
    out = {}
    for raw, value in cfg.items():
        if not isinstance(value, str) or not value.strip():
            continue
        if raw.startswith(other):
            continue
        key = raw[len(want):] if raw.startswith(want) else raw
        if key not in PALETTE_KEYS:
            continue
        if any(c not in SAFE for c in value):
            continue
        out["--" + key.replace("_", "-")] = value.strip()
    if not out:
        return ""
    body = "\n".join(f"    {k}: {v};" for k, v in out.items())
    return f"<style id=\"br-palette\">:root {{\n{body}\n}}</style>"


def page(payload: dict, app_html: str) -> bytes:
    cfg = {r["key"]: r["value"] for r in payload["theme_config"]}
    mode = str(cfg.get("default_theme") or "night").lower()
    if mode not in ("day", "night"):
        mode = "night"
    template = cfg.get("template_key") or ""
    slug = payload["restaurant"]["slug"]

    # `</script>` inside JSON would close the tag early; the escape is the standard one
    # and cheaper than a second request.
    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    head = (
        f'<script id="br-bootstrap">window.__BR = {data};</script>\n'
        + theme_css(cfg, mode) + "\n"
    )
    html = app_html.replace("<head>", "<head>\n" + head, 1)
    # Cut the fork's inherited credentials. It shipped with the platform's own SUPA_URL
    # and SUPA_KEY, which would have it reading Niko's project - his data on our page,
    # and our analytics writes going somewhere they must not. Everything the page needs
    # is already inlined, so the calls that remain (an analytics POST, a second theme
    # read) simply have nowhere to go. Pointing them at OUR project is a later step,
    # once there is an events table to point at.
    html = re.sub(r"SUPA_URL\s*=\s*'[^']*'", "SUPA_URL = ''", html, count=1)
    html = re.sub(r"SUPA_KEY\s*=\s*'[^']*'", "SUPA_KEY = ''", html, count=1)
    # The attributes their stylesheet keys off, set before the app runs rather than by it.
    html = html.replace(
        "<html", f'<html data-template="{template}" data-theme="{mode}" '
                 f'data-tenant="{slug}" data-brand-slug="{slug}"', 1)
    return html.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    conn = None
    app_html = ""

    def log_message(self, fmt, *a):
        pass

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path.startswith("/a/"):
                key = urllib.parse.unquote(path[3:])
                data = storage.backend().get(bucket_for(key), key)
                if data is None:
                    return self._send(404, b"not found", "text/plain")
                return self._send(200, data,
                                  TYPES.get(Path(key).suffix.lower(),
                                            "application/octet-stream"),
                                  {"Cache-Control": "public, max-age=31536000, immutable",
                                   "Access-Control-Allow-Origin": "*"})

            name = path.strip("/")
            local = HERE / name
            if name and local.is_file() and local.parent == HERE and name != "index.html":
                return self._send(200, local.read_bytes(),
                                  TYPES.get(local.suffix.lower(), "text/plain"))

            if not name:
                return self._send(200, b"Add a tenant slug: /mg", "text/plain")

            payload = bootstrap.build(self.conn, name)
            return self._send(200, page(payload, self.app_html),
                              "text/html; charset=utf-8",
                              {"Cache-Control": "no-store"})
        except LookupError as exc:
            self._send(404, str(exc).encode(), "text/plain")
        except Exception as exc:                              # noqa: BLE001
            self._send(500, f"{type(exc).__name__}: {exc}".encode(), "text/plain")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8800)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()

    load_env()
    app = HERE / "index.html"
    if not app.is_file():
        print(f"missing {app}")
        return 1
    html = app.read_text(encoding="utf-8")
    if "_brFixtureRequested" not in html:
        print("index.html is not patched. Run: python menu/app/patch_bootstrap.py")
        return 1

    conn = bootstrap.connect()
    if conn is None:
        return 1
    conn.autocommit = True
    Handler.conn = conn
    Handler.app_html = html

    print("BetaReal menu  (the customer app, data already in the page)")
    print(f"  app     : {app.name}, {len(html):,} chars, bootstrap hook present")
    print(f"  storage : {storage.describe()}")
    print(f"  listen  : http://{a.host}:{a.port}/<slug>")
    print("\n  Ctrl+C to stop.")
    try:
        ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
