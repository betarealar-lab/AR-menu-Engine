#!/usr/bin/env python3
"""Load a live tenant, pulled by import_live.py, into our own database.

    python menu/import_live.py --tenant monday-greens
    python menu/import_tenant.py --file out/live/monday-greens.json --slug mg
    python menu/import_tenant.py --file out/live/monday-greens.json --slug mg --dry-run

**This is the litmus test's fixture, not a migration path.** DECISIONS §9.6 is unchanged:
new self-serve tenants only, the live platform keeps serving its own. This copies a real
menu in so the rebuild can be compared against the real page instead of against a
screenshot - which is exactly how the first attempt ended up looking wrong.

Idempotent, by `source_ref`. Run it again after the live menu changes and it updates in
place rather than making a second copy.

**Prices.** The platform stores free text - "28 ₾", and "16 / 70 ₾" where variants carry
the real numbers. Integer minor units stay the truth here; the string is kept as a display
override only when it is not a plain single price. A value we cannot parse is a loud
warning, never a silent zero, because a wrong price on a menu is worse than a missing one.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import load_env                                   # noqa: E402
from menu.render_theme_keys import PALETTE_KEYS                # noqa: E402

CURRENCY = {"₾": "GEL", "$": "USD", "€": "EUR", "£": "GBP"}


def parse_price(raw) -> tuple[int, str, str | None]:
    """'28 ₾' -> (2800, 'GEL', None).  '16 / 70 ₾' -> (1600, 'GEL', '16 / 70 ₾')."""
    s = str(raw or "").strip()
    if not s:
        return 0, "GEL", None
    cur = next((c for sym, c in CURRENCY.items() if sym in s), "GEL")
    numbers = re.findall(r"\d+(?:[.,]\d+)?", s)
    if not numbers:
        return 0, cur, s
    minor = int(round(float(numbers[0].replace(",", ".")) * 100))
    # More than one number, or anything besides a number/symbol/space, means the string
    # is saying something the integer cannot - keep it for display.
    plain = len(numbers) == 1 and not re.search(r"[/|+]|\bor\b", s, re.I)
    return minor, cur, (None if plain else s)


def split_theme(cfg: dict) -> tuple[dict, dict, dict]:
    """theme_config -> (palette, settings, item camera angles).

    The platform keeps all three in one bag, which is why a real tenant has 104 keys of
    two entirely different kinds. Splitting them is the whole reason a theme editor can
    be a theme editor rather than a settings page with colours in it.
    """
    palette, settings, views = {}, {}, {}
    for k, v in cfg.items():
        if k.startswith("item_view_"):
            views[k[len("item_view_"):]] = v
        elif k.startswith(("night_", "day_")) or k in PALETTE_KEYS:
            palette[k] = v
        else:
            settings[k] = v
    return palette, settings, views


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", type=Path, required=True)
    ap.add_argument("--slug", required=True, help="slug to create HERE (not theirs)")
    ap.add_argument("--template", default="monday_greens")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    blob = json.loads(a.file.read_text(encoding="utf-8"))
    rest, items, cfg = blob["restaurant"], blob["items"], blob["theme_config"]
    palette, settings, views = split_theme(cfg)

    langs = ["en"]
    for code in ("ka", "ru"):
        if any((i.get(f"name_{code}") or "").strip() for i in items):
            langs.append(code)

    print(f"{rest['name']} -> {a.slug}")
    print(f"  {len(items)} items, {len(palette)} palette keys, "
          f"{len(settings)} settings, {len(views)} camera angles")
    print(f"  languages actually populated: {', '.join(langs)}")
    warned = 0
    for it in items:
        _, _, override = parse_price(it.get("price"))
        if override:
            warned += 1
    print(f"  {warned} prices need a display override")

    if a.dry_run:
        print("\n  dry run, nothing written")
        return 0

    load_env()
    import psycopg
    conn = psycopg.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=20)
    with conn, conn.cursor() as cur:
        cur.execute("""
            insert into tenants (slug, name, template_id, theme, settings, languages)
            values (%s,%s,%s,%s,%s,%s)
            on conflict (slug) do update set
              name = excluded.name, template_id = excluded.template_id,
              theme = excluded.theme, settings = excluded.settings,
              languages = excluded.languages
            returning id
        """, (a.slug, rest["name"], a.template, json.dumps(palette),
              json.dumps(settings), langs))
        tid = cur.fetchone()[0]

        # Categories, in the order the items reference them.
        cats, order = {}, []
        for it in items:
            c = it.get("categories") or {}
            key = str(it.get("category_id") or "")
            if key and key not in cats:
                cats[key] = c
                order.append(key)
        for pos, key in enumerate(order):
            c = cats[key]
            i18n = {k: {"name": c.get(f"name_{k}")} for k in ("ka", "ru")
                    if (c.get(f"name_{k}") or "").strip()}
            cur.execute("""
                insert into categories (tenant_id, name, position, source_ref, i18n)
                values (%s,%s,%s,%s,%s)
                on conflict (tenant_id, source_ref) where source_ref is not null
                do update set name = excluded.name, position = excluded.position,
                              i18n = excluded.i18n
                returning id
            """, (tid, c.get("name_en") or "Menu", pos, key, json.dumps(i18n)))
            cats[key] = cur.fetchone()[0]

        made = models = 0
        for pos, it in enumerate(items):
            ref = str(it["id"])
            minor, cur_code, price_text = parse_price(it.get("price"))
            old_minor, _, _ = parse_price(it.get("price_old"))
            i18n = {}
            for code in ("ka", "ru"):
                sub = {}
                if (it.get(f"name_{code}") or "").strip():
                    sub["name"] = it[f"name_{code}"]
                if (it.get(f"description_{code}") or "").strip():
                    sub["description"] = it[f"description_{code}"]
                if sub:
                    i18n[code] = sub

            model_id = None
            glb, usdz = it.get("model"), it.get("model_usdz")
            if glb or usdz:
                # An imported model has files but no dish in our engine, so its identity
                # is where it came from. `dish` stays NOT NULL and carries that.
                cur.execute("""
                    insert into models (tenant_id, title, dish, variant, external_glb,
                                        external_usdz, poster_key, ar_scale,
                                        view_orbit, tenant_state, decided_utc, source_ref)
                    values (%s,%s,%s,'imported',%s,%s,%s,%s,%s,'approved',now(),%s)
                    on conflict (tenant_id, source_ref) where source_ref is not null
                    do update set external_glb = excluded.external_glb,
                                  external_usdz = excluded.external_usdz,
                                  ar_scale = excluded.ar_scale,
                                  view_orbit = excluded.view_orbit
                    returning id
                """, (tid, it.get("name_en") or "", f"imported-{ref}", glb, usdz,
                      it.get("thumbnail_url"), it.get("ar_scale") or 1,
                      views.get(ref), ref))
                model_id = cur.fetchone()[0]
                models += 1

            cur.execute("""
                insert into items (tenant_id, category_id, name, description, price_minor,
                                   price_text, price_old_minor, currency, photo_key,
                                   model_id, visible, position, i18n, text_only, is_3d,
                                   thumb_3d, featured, variants, addons, source_ref)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (tenant_id, source_ref) where source_ref is not null
                do update set
                  category_id=excluded.category_id, name=excluded.name,
                  description=excluded.description, price_minor=excluded.price_minor,
                  price_text=excluded.price_text, price_old_minor=excluded.price_old_minor,
                  photo_key=excluded.photo_key, model_id=excluded.model_id,
                  visible=excluded.visible, position=excluded.position, i18n=excluded.i18n,
                  text_only=excluded.text_only, is_3d=excluded.is_3d,
                  thumb_3d=excluded.thumb_3d, variants=excluded.variants
            """, (tid, cats.get(str(it.get("category_id") or "")),
                  it.get("name_en") or it.get("name_ka") or "Item",
                  it.get("description_en") or "", minor, price_text,
                  old_minor or None, cur_code, it.get("thumbnail_url"), model_id,
                  bool(it.get("visible", True)), it.get("sort_order") or pos,
                  json.dumps(i18n), bool(it.get("text_only")),
                  bool(it.get("is_3d", True)), bool(it.get("thumb_3d")),
                  bool(it.get("featured")),
                  json.dumps(it.get("variants") or []),
                  json.dumps(it.get("addons") or []), ref))
            made += 1

    print(f"\n  {made} items, {len(order)} categories, {models} models")
    print(f"\nNext:  python menu/publish.py --tenant {a.slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
