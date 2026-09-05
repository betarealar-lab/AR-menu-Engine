#!/usr/bin/env python3
"""Read the live tenant menus through the same public path a diner's phone uses.

    python menu/import_live.py --list
    python menu/import_live.py --tenant monday-greens --out out/live/

**Read-only, and it makes exactly the requests a customer's browser already makes.** The
diner app ships a `sb_publishable_...` key in its HTML - public by design, because every
phone that opens a menu reads the menu with it. This asks the same PostgREST endpoints for
the same rows. Nothing is written, and the platform repo is never modified (DECISIONS
§9.7).

Authorised by Temo, 2026-09-05: *"it is niko's in a name but i am active CEO and co CTO i
am the decision maker so yes read it."*

**Why bother.** The litmus test he set is whether the Astro rebuild can do what the
current admin and the current tenant menus do. Answering that by eye, against screenshots,
is how a replication ends up "looking like shit" - the first attempt did exactly that. Real
menus, real categories, real theme_config give something to diff against instead.

The key and URL are read out of the platform's index.html rather than stored here, so
nothing is duplicated and nothing goes stale. Neither is ever printed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PLATFORM = Path(r"C:\Users\temot\BetaReal scaleable\index.html")


def creds() -> tuple[str, str]:
    """The public URL and publishable key, straight out of the diner app."""
    html = PLATFORM.read_text(encoding="utf-8", errors="replace")
    url = re.search(r"SUPA_URL\s*=\s*'([^']+)'", html)
    key = re.search(r"SUPA_KEY\s*=\s*'([^']+)'", html)
    if not (url and key):
        raise RuntimeError("could not find SUPA_URL / SUPA_KEY in the platform app")
    return url.group(1).rstrip("/"), key.group(1)


def select(path: str) -> list[dict]:
    url, key = creds()
    r = requests.get(f"{url}/rest/v1/{path}",
                     headers={"apikey": key, "Accept": "application/json"}, timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
    return r.json()


def tenants() -> list[dict]:
    return select("restaurants?select=id,slug,name,brand_id,brands(id,slug,name,plan)"
                  "&order=slug")


def menu(restaurant_id: str) -> list[dict]:
    return select(f"menu_items?select=*,categories(name_en,name_ka,name_ru)"
                  f"&restaurant_id=eq.{restaurant_id}&order=category_id,sort_order")


def theme(restaurant_id: str) -> dict:
    rows = select(f"theme_config?select=key,value&restaurant_id=eq.{restaurant_id}")
    return {r["key"]: r["value"] for r in rows}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="every live tenant")
    ap.add_argument("--tenant", help="slug to pull in full")
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "live")
    a = ap.parse_args()

    if not PLATFORM.is_file():
        print(f"cannot read {PLATFORM}")
        return 1

    if a.list or not a.tenant:
        rows = tenants()
        print(f"{len(rows)} live tenants\n")
        print(f"{'slug':<28} {'name':<26} brand")
        for t in rows:
            b = t.get("brands") or {}
            b = b[0] if isinstance(b, list) and b else b
            print(f"{t['slug']:<28} {(t.get('name') or '')[:25]:<26} "
                  f"{(b or {}).get('slug', '')}")
        return 0

    t = next((x for x in tenants() if x["slug"] == a.tenant), None)
    if not t:
        print(f"no tenant {a.tenant!r}")
        return 1

    items = menu(t["id"])
    cfg = theme(t["id"])
    a.out.mkdir(parents=True, exist_ok=True)
    blob = {"restaurant": t, "items": items, "theme_config": cfg}
    dest = a.out / f"{a.tenant}.json"
    dest.write_text(json.dumps(blob, indent=1, ensure_ascii=False), encoding="utf-8")

    with_model = sum(1 for i in items if i.get("model_url") or i.get("model"))
    print(f"{t['name']}  ({a.tenant})")
    print(f"  {len(items)} items, {with_model} with a 3D model")
    print(f"  {len(cfg)} theme_config keys")
    print(f"  fields on an item: {', '.join(sorted(items[0].keys())) if items else '-'}")
    print(f"\n  -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
