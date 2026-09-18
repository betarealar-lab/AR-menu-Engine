#!/usr/bin/env python3
"""The JAPAN demo restaurant: a menu to look at the `japan` template with.

    python menu/seed_japan.py            create or refresh it
    python menu/seed_japan.py --drop     remove it first, then create it again

**Why this is a script and not something typed into the admin once.** A demo that exists
only in the database is a demo nobody can rebuild. Every restaurant here is disposable -
the point of it is the template - so the menu that shows the template off is written down,
re-runnable, and safe to run twice. Nothing here is a client.

Idempotent by slug and by dish name: run it again and prices and translations are brought
back into line, without a second copy of anything and without touching a model somebody
has attached in the meantime.

**Three dishes, each with a 3D model, and nothing else.** The models are Food & Market's
Japanese ones, read off the platform through the public endpoint a diner's phone uses and
referenced by URL rather than copied. Any dish without a model is deleted on every run -
a demo of 3D that is mostly rows of text demonstrates the wrong thing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import load_env                      # noqa: E402

SLUG = "japan"
NAME = "JAPAN"
TEMPLATE = "japan"

# Georgian alongside English, because that is who reads a menu in Tbilisi and because a
# template with one language proves nothing about a template with two - the category bar
# and the card titles are where a second script shows up first.
LANGUAGES = ["en", "ka"]

# The palette lives on the TEMPLATE (0025), not here. A tenant's `theme` is merged over
# the template's defaults at publish time, so an empty bag means "exactly the template",
# which is what a demo of the template should be.
THEME: dict = {}

# Day, not night. Every colour in the template is a bare key, so it applies in both modes
# and the page would be white either way - but `data-theme` also selects half of the
# structural sheet, and the night half of it is built for a dark page. Naming the mode is
# how the toggle in the corner starts on the right one instead of on the other one.
SETTINGS = {"default_theme": "day"}

# The menu is exactly the dishes we have a 3D model for, and nothing else.
#
# **Where the models come from.** Food & Market, on the platform, has ten scanned dishes;
# three of them are Japanese and those three are here. The files are NOT copied - the rows
# below carry absolute URLs to the platform's own bucket, which is what `external_glb` and
# `external_usdz` are for (`menu/publish.py` tells them apart from our keys by the scheme).
# Nothing of Niko's is modified by any of this; the menu was read through the same public
# endpoint a diner's phone uses (`menu/import_live.py`, DECISIONS 9.7).
#
# **And no photographs.** These dishes have a model and no `photo_key`, deliberately: that
# is the case the card renderer was rebuilt around, where the 3D model IS the picture. A
# dish here with neither would render as a plain text row, which is why there are none.
#
# (name, ka, description, ka description, price in tetri, model)
MODELS = {
    "unagi": {
        # The platform's own item id. `source_ref` is a unique key per tenant - it exists
        # so an import can run twice without duplicating a menu and so a copied row says
        # where it came from (0004), which means it has to identify the SOURCE row rather
        # than describe the import.
        "src": 1421,
        "title": "Unagi Philadelphia",
        "glb":  "https://pub-b253d60df14c4c1f94bada002fa59596.r2.dev/food-market-main/1789299374691_sushi_half_compact.glb",
        "usdz": "https://pub-b253d60df14c4c1f94bada002fa59596.r2.dev/food-market-main/1789299364413_sushi_half_compact.usdz",
        # Carried from the source row. Their pipeline does not bake real size into the
        # file the way ours does, so the viewer multiplies - and dropping it would put the
        # dish on a diner's table at the wrong size, which reads as a bad model.
        "ar_scale": 1,
    },
    "uramaki": {
        # The platform's own item id. `source_ref` is a unique key per tenant - it exists
        # so an import can run twice without duplicating a menu and so a copied row says
        # where it came from (0004), which means it has to identify the SOURCE row rather
        # than describe the import.
        "src": 1898,
        "title": "Crab Uramaki",
        "glb":  "https://pub-b253d60df14c4c1f94bada002fa59596.r2.dev/food-market-main/1789249071033_unagitestW_OSauce.glb",
        "usdz": "https://pub-b253d60df14c4c1f94bada002fa59596.r2.dev/food-market-main/1789249430329_unagitestW_OSauce.usdz",
        "ar_scale": 0.6,
    },
    "spicy": {
        # The platform's own item id. `source_ref` is a unique key per tenant - it exists
        # so an import can run twice without duplicating a menu and so a copied row says
        # where it came from (0004), which means it has to identify the SOURCE row rather
        # than describe the import.
        "src": 1900,
        "title": "Spicy Salmon",
        "glb":  "https://pub-b253d60df14c4c1f94bada002fa59596.r2.dev/food-market-main/1789072760565_Sushi-repaired.glb",
        # No USDZ on the source row. Web and Android 3D work; iPhone AR does not, and the
        # renderer already handles a dish with one file rather than two.
        "usdz": "",
        "ar_scale": 1,
    },
}

SOURCE = "food-market-main"      # the platform tenant these were read from

MENU: list[tuple[str, str, str, str, str, int, str]] = [
    ("Unagi Philadelphia", "უნაგი ფილადელფია",
     "Eel, cream cheese, cucumber", "გველთევზა, კრემ-ყველი, კიტრი", 4400, "unagi"),
    ("Crab Uramaki", "კრაბის ურამაკი",
     "Crab, avocado, tobiko", "კრაბი, ავოკადო, ტობიკო", 2800, "uramaki"),
    ("Spicy Salmon", "ცხარე სალმონი",
     "Salmon, chilli mayo, spring onion", "სალმონი, ცხარე მაიონეზი, მწვანე ხახვი", 2800,
     "spicy"),
]

# One category, because three dishes do not need five. The others are removed on every
# run along with any dish that is not in MENU - see `main`.
CATEGORIES = ["Rolls"]
CATEGORIES_KA = {"Rolls": "როლები"}


def connect():
    import psycopg
    url = os.environ.get("SUPABASE_DB_URL", "")
    if not url:
        raise SystemExit("SUPABASE_DB_URL is not set. Check: python preflight.py --supabase")
    return psycopg.connect(url, connect_timeout=25)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--drop", action="store_true", help="delete it first")
    a = ap.parse_args()

    load_env()
    conn = connect()
    with conn, conn.cursor() as cur:
        # The template has to exist and be listed, the same rule `create_tenant()`
        # enforces: a tenant on a template we do not ship renders unstyled for real
        # people. 0025 is what puts it there.
        cur.execute("select listed from templates where id = %s", (TEMPLATE,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"no template '{TEMPLATE}' - run: python menu/migrate.py")
        if not row[0]:
            raise SystemExit(f"template '{TEMPLATE}' exists but is not listed")

        if a.drop:
            cur.execute("delete from tenants where slug = %s", (SLUG,))
            print(f"dropped {SLUG}")

        cur.execute("""
            insert into tenants (slug, name, template_id, theme, settings, languages,
                                 currency)
            values (%s, %s, %s, %s::jsonb, %s::jsonb, %s, 'GEL')
            on conflict (slug) do update
              set name = excluded.name, template_id = excluded.template_id,
                  theme = excluded.theme, settings = excluded.settings,
                  languages = excluded.languages
            returning id
        """, (SLUG, NAME, TEMPLATE, json.dumps(THEME), json.dumps(SETTINGS), LANGUAGES))
        tenant = cur.fetchone()[0]
        print(f"tenant {SLUG} = {tenant}")

        cats: dict[str, str] = {}
        for i, name in enumerate(CATEGORIES):
            i18n = json.dumps({"ka": {"name": CATEGORIES_KA[name]}})
            cur.execute("select id from categories where tenant_id=%s and name=%s",
                        (tenant, name))
            row = cur.fetchone()
            if row:
                cur.execute("update categories set position=%s, i18n=%s::jsonb where id=%s",
                            (i, i18n, row[0]))
                cats[name] = row[0]
            else:
                cur.execute("""insert into categories (tenant_id, name, position, i18n)
                               values (%s,%s,%s,%s::jsonb) returning id""",
                            (tenant, name, i, i18n))
                cats[name] = cur.fetchone()[0]

        for i, (name, name_ka, desc, desc_ka, price, model_key) in enumerate(MENU):
            spec = MODELS[model_key]
            # The model row. `external_*` rather than `draco_key`/`usdz_key` because the
            # files live in somebody else's bucket; `approved` because these are models
            # already serving diners on a live menu, not something awaiting a verdict.
            cur.execute("""
                insert into models (tenant_id, title, dish, variant, external_glb,
                                    external_usdz, ar_scale, tenant_state, decided_utc,
                                    source_ref)
                values (%s,%s,%s,'default',%s,%s,%s,'approved',now(),%s)
                on conflict (tenant_id, dish, variant) do update
                  set external_glb = excluded.external_glb,
                      external_usdz = excluded.external_usdz,
                      ar_scale = excluded.ar_scale,
                      title = excluded.title,
                      source_ref = excluded.source_ref
                returning id
            """, (tenant, spec["title"], model_key, spec["glb"], spec["usdz"] or None,
                  spec["ar_scale"], f'{SOURCE}:{spec["src"]}'))
            model_id = cur.fetchone()[0]

            i18n = json.dumps({"ka": {"name": name_ka, "description": desc_ka}})
            cur.execute("select id from items where tenant_id=%s and name=%s",
                        (tenant, name))
            row = cur.fetchone()
            # `thumb_3d` stays FALSE and there is no photo, which is the whole point: the
            # card has nothing to draw but the model, so the model is what it draws.
            if row:
                cur.execute("""update items set category_id=%s, description=%s,
                                      price_minor=%s, position=%s, i18n=%s::jsonb,
                                      model_id=%s, is_3d=true, thumb_3d=false,
                                      text_only=false, photo_key=null
                                where id=%s""",
                            (cats["Rolls"], desc, price, i, i18n, model_id, row[0]))
            else:
                cur.execute("""
                    insert into items (tenant_id, category_id, name, description,
                                       price_minor, currency, position, i18n, model_id,
                                       is_3d, thumb_3d)
                    values (%s,%s,%s,%s,%s,'GEL',%s,%s::jsonb,%s,true,false)
                """, (tenant, cats["Rolls"], name, desc, price, i, i18n, model_id))

        # Everything else goes. "Get rid of text only models" - a demo of 3D that is
        # mostly rows of text is a demo of the wrong thing, and these are seeded dishes
        # with nothing behind them, not a restaurant's data.
        keep = [m[0] for m in MENU]
        cur.execute("delete from items where tenant_id = %s and not (name = any(%s))",
                    (tenant, keep))
        gone = cur.rowcount
        cur.execute("""delete from categories c where c.tenant_id = %s
                        and not exists (select 1 from items i where i.category_id = c.id)""",
                    (tenant,))
        if gone:
            print(f"removed {gone} dish(es) with no model, and their empty categories")

        cur.execute("select count(*) from items where tenant_id = %s", (tenant,))
        print(f"{cur.fetchone()[0]} dishes in {len(CATEGORIES)} categories")

    conn.close()
    print(f"\nSee it: /{SLUG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
