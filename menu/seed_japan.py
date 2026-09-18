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

**No 3D is attached.** Every model in the system today belongs to a real restaurant, and
putting a paying client's dish on a demo site is a decision for a person, not for a seed
script. The BetaReal library (0024) makes it one click in the 3D Studio when somebody
wants it: mark a model `add to BetaReal library`, come back here, choose the dish.
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

# (category, name, ka, description, ka description, price in tetri)
MENU: list[tuple[str, str, str, str, str, int]] = [
    ("Nigiri", "Salmon nigiri", "სალმონის ნიგირი",
     "Two pieces, hand-pressed", "ორი ცალი, ხელით დაწნეხილი", 1400),
    ("Nigiri", "Tuna nigiri", "თევზის ნიგირი",
     "Two pieces, hand-pressed", "ორი ცალი, ხელით დაწნეხილი", 1600),
    ("Nigiri", "Eel nigiri", "გველთევზას ნიგირი",
     "Grilled, brushed with tare", "შემწვარი, ტარეს სოუსით", 1800),
    ("Nigiri", "Prawn nigiri", "კრევეტის ნიგირი",
     "Two pieces", "ორი ცალი", 1500),

    ("Sashimi", "Salmon sashimi", "სალმონის საშიმი",
     "Five slices, wasabi, ginger", "ხუთი ნაჭერი, ვასაბი, ჯანჯაფილი", 2600),
    ("Sashimi", "Tuna sashimi", "თევზის საშიმი",
     "Five slices, wasabi, ginger", "ხუთი ნაჭერი, ვასაბი, ჯანჯაფილი", 2900),
    ("Sashimi", "Chef's sashimi plate", "შეფის საშიმის ასორტი",
     "Whatever was best this morning", "რაც დღეს საუკეთესო იყო", 5400),

    ("Rolls", "California roll", "კალიფორნიის როლი",
     "Crab, avocado, cucumber", "კრაბი, ავოკადო, კიტრი", 2200),
    ("Rolls", "Spicy salmon roll", "ცხარე სალმონის როლი",
     "Salmon, chilli mayo, spring onion", "სალმონი, ცხარე მაიონეზი, მწვანე ხახვი", 2400),
    ("Rolls", "Philadelphia roll", "ფილადელფიის როლი",
     "Salmon, cream cheese, cucumber", "სალმონი, კრემ-ყველი, კიტრი", 2500),
    ("Rolls", "Vegetable roll", "ბოსტნეულის როლი",
     "Avocado, cucumber, pickled radish", "ავოკადო, კიტრი, მწნილი ბოლოკი", 1900),

    ("Hot", "Miso soup", "მისოს სუპი",
     "Tofu, wakame, spring onion", "ტოფუ, ვაკამე, მწვანე ხახვი", 900),
    ("Hot", "Chicken katsu curry", "ქათმის კაცუ კარი",
     "Panko chicken, rice, curry sauce", "პანკოში ქათამი, ბრინჯი, კარის სოუსი", 3200),
    ("Hot", "Prawn tempura", "კრევეტის ტემპურა",
     "Four prawns, dipping sauce", "ოთხი კრევეტი, სოუსით", 2800),
    ("Hot", "Gyoza", "გიოძა",
     "Six dumplings, pork and cabbage", "ექვსი ცალი, ღორი და კომბოსტო", 2100),

    ("Drinks", "Green tea", "მწვანე ჩაი", "Pot, refilled", "ჩაიდანი, დამატებით", 700),
    ("Drinks", "Sake", "საკე", "Served warm", "თბილად მიირთმევა", 1800),
    ("Drinks", "Ramune", "რამუნე", "The bottle with the marble", "ბოთლი ბურთულით", 1000),
]

CATEGORIES = ["Nigiri", "Sashimi", "Rolls", "Hot", "Drinks"]
CATEGORIES_KA = {"Nigiri": "ნიგირი", "Sashimi": "საშიმი", "Rolls": "როლები",
                 "Hot": "ცხელი", "Drinks": "სასმელები"}


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

        for i, (cat, name, name_ka, desc, desc_ka, price) in enumerate(MENU):
            i18n = json.dumps({"ka": {"name": name_ka, "description": desc_ka}})
            cur.execute("select id from items where tenant_id=%s and name=%s",
                        (tenant, name))
            row = cur.fetchone()
            if row:
                # `model_id` is deliberately NOT written here. Re-running the seed must
                # not detach a model somebody attached from the library.
                cur.execute("""update items set category_id=%s, description=%s,
                                      price_minor=%s, position=%s, i18n=%s::jsonb
                                where id=%s""",
                            (cats[cat], desc, price, i, i18n, row[0]))
            else:
                cur.execute("""
                    insert into items (tenant_id, category_id, name, description,
                                       price_minor, currency, position, i18n)
                    values (%s,%s,%s,%s,%s,'GEL',%s,%s::jsonb)
                """, (tenant, cats[cat], name, desc, price, i, i18n))

        cur.execute("select count(*) from items where tenant_id = %s", (tenant,))
        print(f"{cur.fetchone()[0]} dishes in {len(CATEGORIES)} categories")

    conn.close()
    print(f"\nSee it: /{SLUG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
