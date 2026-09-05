#!/usr/bin/env python3
"""The Worker, standing in on a laptop, so the menu can be looked at before it is deployed.

    python menu/preview.py                    http://127.0.0.1:8790/demo-kitchen
    python menu/preview.py --port 9000

Does exactly what the edge Worker will do, in the same order, with the same inputs:

    GET /<slug>      resolve the live snapshot -> render complete HTML -> return it
    GET /a/<key>     stream the bytes of one private-bucket object

Nothing here is a mock. It renders with `menu/render/render.mjs` - the same module the
Worker and the admin preview will call - and it serves real objects out of the real R2
buckets. What the Worker adds on top is edge caching and a hostname; the shape of the
response is settled here.

**What this is for is watching it load.** MENU-PLATFORM §2.1a claims a diner never sees a
generic page re-skin itself, and that claim is either true in a browser or it is not.
`check_render.py` asserts the structural half; this is where somebody looks.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import storage                          # noqa: E402
from config import load_env             # noqa: E402
from menu import publish as pub         # noqa: E402

RENDERER = Path(__file__).resolve().parent / "render" / "render.mjs"

# Guessed from the key, because the buckets store what the pipeline produced and the
# extension is the only thing that says what it is. A wrong type here is a model the
# browser refuses to parse, which looks exactly like a broken model.
TYPES = {
    ".glb": "model/gltf-binary", ".usdz": "model/vnd.usdz+zip",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".json": "application/json",
}

# Which logical bucket a key belongs to. The Worker will have a binding per bucket and
# will not have to guess; here the prefix is enough.
def bucket_for(key: str) -> str:
    if key.startswith(("catalog/", "models/")):
        return "models"
    if key.startswith("t/"):
        return "menus"
    return "photos"


def render(snapshot: dict, asset_base: str = "/a") -> bytes:
    """Shell to the real renderer rather than reimplementing it in Python.

    Tempting to write a quick Python version for the preview. That is exactly how the
    admin preview and the live page end up disagreeing (§2.2) - two implementations, one
    of which is updated. There is one renderer.
    """
    out = subprocess.run(
        ["node", str(RENDERER), "-", asset_base],
        input=json.dumps(snapshot).encode(), capture_output=True,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.decode("utf-8", "replace")[:400])
    return out.stdout


class Handler(BaseHTTPRequestHandler):
    conn = None

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
            if path in ("/", "/favicon.ico"):
                return self._index() if path == "/" else self._send(404, b"", "text/plain")

            if path.startswith("/a/"):
                key = urllib.parse.unquote(path[3:])
                data = storage.backend().get(bucket_for(key), key)
                if data is None:
                    return self._send(404, b"not found", "text/plain")
                ctype = TYPES.get(Path(key).suffix.lower(), "application/octet-stream")
                # Same-origin bytes with our own headers. A signed R2 URL answers with no
                # Access-Control-Allow-Origin, so the browser fetches a model, applies the
                # same-origin rule, discards it, and leaves an empty viewer - which cost
                # two days once already (HANDOFF §6).
                return self._send(200, data, ctype, {
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Access-Control-Allow-Origin": "*",
                })

            slug = path.strip("/")
            snap = pub.live_snapshot(self.conn, slug)
            if snap is None:
                return self._send(404, f"No published menu for {slug!r}.\n"
                                       f"  python menu/publish.py --tenant {slug}"
                                  .encode(), "text/plain")
            html = render(snap)
            return self._send(200, html, "text/html; charset=utf-8", {
                # The edge will key its cache on the version, which is why a publish
                # takes effect immediately and needs no purge to propagate.
                "Cache-Control": "no-store",
                "X-Snapshot-Version": str(snap.get("version", "?")),
            })
        except Exception as exc:                              # noqa: BLE001
            self._send(500, f"{type(exc).__name__}: {exc}".encode(), "text/plain")

    def _index(self):
        with self.conn.cursor() as cur:
            cur.execute("""
                select t.slug, t.name, p.version, p.item_count
                from tenants t
                left join live_publication l on l.tenant_id = t.id
                left join publications p on p.id = l.publication_id
                order by t.slug
            """)
            rows = cur.fetchall()
        body = "<h1>Published menus</h1><ul>" + "".join(
            f'<li><a href="/{s}">{n}</a> — '
            + (f"v{v}, {c} items" if v else "not published yet")
            + "</li>" for s, n, v, c in rows) + "</ul>"
        self._send(200, f"<!doctype html><meta charset=utf-8>{body}".encode(),
                   "text/html; charset=utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()

    load_env()
    conn = pub.connect()
    if conn is None:
        return 1
    conn.autocommit = True
    Handler.conn = conn

    print("BetaReal menu preview  (the Worker, on a laptop)")
    print(f"  storage : {storage.describe()}")
    print(f"  renderer: {RENDERER.relative_to(ROOT)}")
    print(f"  listen  : http://{a.host}:{a.port}/")
    print("\n  Ctrl+C to stop.")
    try:
        ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
