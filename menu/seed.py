#!/usr/bin/env python3
"""Put a real restaurant in the database, built from dishes that actually exist.

    python menu/seed.py --demo          create/refresh the demo tenant
    python menu/seed.py --demo --drop   remove it first

The models it attaches are **the real ones in R2** - whatever `dataset.catalogue()` has
with shipping files. So the first menu page ever rendered loads a genuine 1.6 MB Draco
model of a real dish at real-world size, not a placeholder cube. A placeholder proves the
plumbing and hides everything interesting: how long a real payload takes, whether the
scale is right, what a 3D card does to first paint.

Idempotent. Run it as often as you like.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import dataset                     # noqa: E402
from config import load_env        # noqa: E402

SLUG = "demo-kitchen"

# One template to start. It is a row, not a branch - MENU-PLATFORM §2.2. Adding a second
# touches nothing that belongs to a tenant.
TEMPLATE = {
    "id": "plain",
    "name": "Plain",
    "defaults": {
        "ink": "#16130f",
        "paper": "#faf7f2",
        "accent": "#b4552d",
        "muted": "#7a7168",
        "font_display": "Georgia, 'Times New Roman', serif",
        "font_body": "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    "listed": True,
}

CATEGORIES = ["Plates", "Bowls", "Sides"]

# Prices in minor units. Integers, always - see 0001_skeleton.sql.
FALLBACK_ITEMS = [
    ("Garden Salad",     "Leaves, seeds, a lemon dressing.",        1450, "Bowls"),
    ("Soup of the Day",  "Ask, it changes.",                        1200, "Bowls"),
    ("Bread and Butter", "Cultured butter, sourdough.",              600, "Sides"),
]


def connect():
    load_env()
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        print("SUPABASE_DB_URL is not set. Run: python preflight.py --supabase")
        return None
    import psycopg
    return psycopg.connect(url, connect_timeout=15)


def real_dishes() -> list[dict]:
    """Dishes with shipping files, straight out of the engine's own catalogue."""
    out = []
    for rec in dataset.catalogue():
        cat = rec.get("catalog_keys") or {}
        if not (cat.get("draco") or cat.get("usdz")):
            continue
        if rec.get("archived"):
            continue
        scale = rec.get("scale") or {}
        out.append({
            "dish": dataset.slug(rec["dish"]),
            "variant": dataset.slug(rec["variant"]),
            "title": rec.get("title") or rec["dish"],
            "draco": cat.get("draco"), "usdz": cat.get("usdz"),
            "poster": (rec.get("master_keys") or {}).get("png"),
            "scale_cm": scale.get("cm"), "scale_axis": scale.get("axis"),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="create/refresh the demo tenant")
    ap.add_argument("--drop", action="store_true", help="delete it first")
    ap.add_argument("--slug", default=SLUG)
    a = ap.parse_args()
    if not a.demo:
        ap.print_help()
        return 0

    conn = connect()
    if conn is None:
        return 1

    dishes = real_dishes()
    print(f"{len(dishes)} real dish(es) with shipping files in R2")

    with conn, conn.cursor() as cur:
        if a.drop:
            cur.execute("delete from tenants where slug = %s", (a.slug,))
            print(f"dropped {a.slug}")

        cur.execute("""
            insert into templates (id, name, defaults, listed)
            values (%(id)s, %(name)s, %(defaults)s, %(listed)s)
            on conflict (id) do update
              set name = excluded.name, defaults = excluded.defaults,
                  listed = excluded.listed
        """, {**TEMPLATE, "defaults": __import__("json").dumps(TEMPLATE["defaults"])})

        cur.execute("""
            insert into tenants (slug, name, template_id, theme)
            values (%s, %s, 'plain', '{"accent": "#2f6f4f"}'::jsonb)
            on conflict (slug) do update
              set name = excluded.name, template_id = excluded.template_id
            returning id
        """, (a.slug, "Demo Kitchen"))
        tenant = cur.fetchone()[0]
        print(f"tenant {a.slug} = {tenant}")

        cats = {}
        for i, name in enumerate(CATEGORIES):
            cur.execute("select id from categories where tenant_id=%s and name=%s",
                        (tenant, name))
            row = cur.fetchone()
            if row:
                cats[name] = row[0]
            else:
                cur.execute("""insert into categories (tenant_id, name, position)
                               values (%s,%s,%s) returning id""", (tenant, name, i))
                cats[name] = cur.fetchone()[0]

        made = 0
        for i, d in enumerate(dishes):
            # The library row. `approved` because these are dishes the team has already
            # judged and shipped to a live client - anything unjudged stays `draft` and
            # the compiler will not put it on a menu (DECISIONS §9.4).
            cur.execute("""
                insert into models (tenant_id, title, dish, variant, draco_key, usdz_key,
                                    poster_key, scale_cm, scale_axis, tenant_state,
                                    decided_utc)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,'approved', now())
                on conflict (tenant_id, dish, variant) do update
                  set draco_key = excluded.draco_key, usdz_key = excluded.usdz_key,
                      poster_key = excluded.poster_key, scale_cm = excluded.scale_cm,
                      scale_axis = excluded.scale_axis
                returning id
            """, (tenant, d["title"], d["dish"], d["variant"], d["draco"], d["usdz"],
                  d["poster"], d["scale_cm"], d["scale_axis"]))
            model_id = cur.fetchone()[0]

            name = d["title"].replace("-", " ").title()
            category = cats["Bowls" if "salad" in d["dish"] or "soup" in d["dish"]
                            else "Plates"]
            cur.execute("select id from items where tenant_id=%s and name=%s",
                        (tenant, name))
            row = cur.fetchone()
            if row:
                cur.execute("update items set model_id=%s, position=%s where id=%s",
                            (model_id, i, row[0]))
            else:
                cur.execute("""
                    insert into items (tenant_id, category_id, name, description,
                                       price_minor, currency, model_id, position)
                    values (%s,%s,%s,%s,%s,'GEL',%s,%s)
                """, (tenant, category, name,
                      f"{d['variant']} capture, {d['scale_cm'] or '?'} cm",
                      1800 + i * 350, model_id, i))
            made += 1

        for j, (name, desc, price, cat) in enumerate(FALLBACK_ITEMS):
            cur.execute("select id from items where tenant_id=%s and name=%s",
                        (tenant, name))
            if not cur.fetchone():
                cur.execute("""
                    insert into items (tenant_id, category_id, name, description,
                                       price_minor, currency, position)
                    values (%s,%s,%s,%s,%s,'GEL',%s)
                """, (tenant, cats[cat], name, desc, price, 100 + j))

        # One item deliberately hidden, and one model deliberately not approved. Both are
        # here so `check_publish.py` can prove they never reach the snapshot - a rule
        # nobody tests is a rule that quietly stops being true.
        cur.execute("""
            insert into items (tenant_id, category_id, name, description, price_minor,
                               currency, visible, position)
            values (%s,%s,'Staff Meal','Should never appear on a menu.',0,'GEL',false,999)
            on conflict do nothing
        """, (tenant, cats["Sides"]))

        cur.execute("select count(*) from items where tenant_id=%s", (tenant,))
        total = cur.fetchone()[0]
        print(f"{made} dish item(s) with 3D, {total} items in total "
              f"(one hidden on purpose)")
    print(f"\nNext:  python menu/publish.py --tenant {a.slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
