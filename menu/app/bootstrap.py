#!/usr/bin/env python3
"""Turn a tenant in our database into the payload the customer app reads from the page.

    python menu/app/bootstrap.py --tenant mg          print a summary
    python menu/app/bootstrap.py --tenant mg --json    dump the payload

Nothing here renders HTML. It builds the object the app already knows how to consume -
the same shape as its baoma / mugsy / pipes / food-market fixtures - so the app itself
does all the rendering, exactly as it does in production today:

    {restaurant, theme_config: [{key, value}], menu_items: [...]}

**Why their shape and not ours.** The app is the tested, working thing; our database is
the part that is new. Translating at this boundary keeps their file byte-identical apart
from the five-line bootstrap hook, and every template, the category bar, the 3D block, AR
routing and the phone layouts keep working because none of them know anything changed.

**The one thing we add** is that the payload is INLINED into the head instead of fetched.
That is the entire fix for the double load: with no network on the critical path the app's
awaits resolve as microtasks, microtasks run before paint, and the browser paints once -
finished - rather than painting an empty shell and re-rendering when the network answers.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from config import load_env                                   # noqa: E402

CURRENCY_SYMBOL = {"GEL": "₾", "USD": "$", "EUR": "€", "GBP": "£"}


def _price(minor, currency, text) -> str:
    """Integer minor units back to the free text the app displays.

    Integers are the truth in our schema because 12.30 as a float is 12.299999999999999
    and a menu that disagrees with the till by a tetri is a menu nobody trusts. The app
    wants a string, and `price_text` wins when a price is something no single number can
    express - "16 / 70" for a variant-priced drink.
    """
    if text:
        return text
    if not minor:
        return ""
    n = f"{minor / 100:.2f}".rstrip("0").rstrip(".")
    sym = CURRENCY_SYMBOL.get(currency or "GEL", "")
    return f"{n} {sym}".strip()


def _asset(value: str | None, base: str) -> str | None:
    """Our R2 keys become URLs; an imported absolute URL passes straight through.

    One field carrying both is deliberate - a template must never have to know whether a
    dish's files came from our pipeline or an import.
    """
    if not value:
        return None
    if value.startswith(("http://", "https://", "data:", "/")):
        return value
    return f"{base}/{value}"


def build(conn, slug: str, asset_base: str = "/a") -> dict:
    with conn.cursor() as cur:
        cur.execute("""
            select id, slug, name, template_id, theme, settings, languages
            from tenants where slug = %s
        """, (slug,))
        row = cur.fetchone()
        if not row:
            raise LookupError(f"no tenant {slug!r}")
        tid, tslug, tname, template_id, theme, settings, languages = row

        cur.execute("""
            select id, name, i18n, position from categories
            where tenant_id = %s and visible order by position, name
        """, (tid,))
        cats = cur.fetchall()

        cur.execute("""
            select i.id, i.name, i.description, i.price_minor, i.price_text,
                   i.price_old_minor, i.currency, i.category_id, i.position,
                   i.photo_key, i.i18n, i.text_only, i.is_3d, i.thumb_3d, i.featured,
                   i.variants, i.addons, i.visible,
                   m.draco_key, m.usdz_key, m.external_glb, m.external_usdz,
                   m.ar_scale, m.view_orbit, m.tenant_state
            from items i
            left join models m on m.id = i.model_id and m.tenant_id = i.tenant_id
            where i.tenant_id = %s and i.visible
            order by i.position, i.name
        """, (tid,))
        rows = cur.fetchall()

    cat_by_id = {c[0]: c for c in cats}

    # theme_config is one flat key/value bag in the app. We keep the palette and the site
    # settings in separate columns because a theme editor should be a theme editor and not
    # a settings page with colours in it - so they are recombined here, at the boundary.
    cfg = {}
    cfg.update(settings or {})
    cfg.update(theme or {})
    if template_id:
        cfg["template_key"] = template_id

    items = []
    for (iid, name, desc, minor, ptext, old_minor, currency, cat_id, pos, photo,
         i18n, text_only, is_3d, thumb_3d, featured, variants, addons, visible,
         draco, usdz, ext_glb, ext_usdz, ar_scale, orbit, state) in rows:
        ka = (i18n or {}).get("ka") or {}
        ru = (i18n or {}).get("ru") or {}
        c = cat_by_id.get(cat_id)
        cka = ((c[2] if c else None) or {}).get("ka") or {}
        # A model reaches a diner only if the owner approved it. `is_3d` off keeps the
        # model attached while the dish behaves like a photo dish - a real case that one
        # flag could not express.
        approved = state == "approved"
        glb = _asset(draco or ext_glb, asset_base) if approved else None
        usdz_url = _asset(usdz or ext_usdz, asset_base) if approved else None
        if orbit:
            cfg[f"item_view_{iid}"] = orbit
        items.append({
            "id": str(iid),
            "name_en": name, "name_ka": ka.get("name") or "", "name_ru": ru.get("name") or "",
            "description_en": desc or "",
            "description_ka": ka.get("description") or "",
            "description_ru": ru.get("description") or "",
            "price": _price(minor, currency, ptext),
            "price_old": _price(old_minor, currency, None) if old_minor else None,
            "category_id": str(cat_id) if cat_id else None,
            "categories": {"name_en": c[1] if c else "Other",
                           "name_ka": cka.get("name") or "",
                           "name_ru": ""} if c else None,
            "model": glb, "model_usdz": usdz_url,
            "thumbnail_url": _asset(photo, asset_base),
            "thumb_3d": bool(thumb_3d), "is_3d": bool(is_3d) and bool(glb or usdz_url),
            "text_only": bool(text_only), "featured": bool(featured),
            "ar_scale": float(ar_scale) if ar_scale is not None else 1.0,
            "variants": variants or [], "addons": addons or [],
            "visible": bool(visible), "sort_order": pos,
        })

    return {
        "restaurant": {
            "id": str(tid), "slug": tslug, "name": tname, "brand_id": str(tid),
            "brands": {"id": str(tid), "slug": tslug, "name": tname, "plan": "premium"},
        },
        "theme_config": [{"key": k, "value": v} for k, v in cfg.items()],
        "menu_items": items,
        "languages": list(languages or ["en"]),
    }


def connect():
    load_env()
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        print("SUPABASE_DB_URL is not set. Run: python preflight.py --supabase")
        return None
    import psycopg
    return psycopg.connect(url, connect_timeout=15)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    conn = connect()
    if conn is None:
        return 1
    with conn:
        payload = build(conn, a.tenant)

    if a.json:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        return 0

    items = payload["menu_items"]
    print(f"{payload['restaurant']['name']}  ({a.tenant})")
    print(f"  {len(items)} items, {sum(1 for i in items if i['model'])} with 3D")
    print(f"  {len(payload['theme_config'])} theme_config keys")
    print(f"  {len({i['category_id'] for i in items if i['category_id']})} categories")
    print(f"  {sum(1 for i in items if i['name_ka'])} with Georgian names")
    print(f"  payload {len(json.dumps(payload, ensure_ascii=False)):,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
