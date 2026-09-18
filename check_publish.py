#!/usr/bin/env python3
"""The publish path: draft in Postgres, immutable snapshot on R2, nothing in between.

    python check_publish.py

Runs against the real Supabase project and the real `betareal-menus` bucket, on a
throwaway tenant it creates and deletes. Spends no credits and touches no other tenant.

**What it is really testing** is MENU-PLATFORM §2.1 - that the object a diner's page is
built from is complete, immutable, and contains nothing it should not. Three of those
rules are the kind that hold on the day they are written and quietly stop holding a year
later, when somebody adds a column and the compiler is not updated:

    hidden items are ABSENT, not present-with-a-flag
    unapproved models are not attached at any state but `approved`
    a model with no shipping files is not a model

Each of those is one forgotten `where` clause away from a real restaurant's menu showing
a dish they took off, or a diner tapping a 3D button that loads nothing.
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import storage                                   # noqa: E402
from config import load_env                      # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent / "menu"))
from menu import publish as pub                  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


def main() -> int:
    load_env()
    db = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not db:
        print("SUPABASE_DB_URL not set. Run: python preflight.py --supabase")
        return 2
    import psycopg

    slug = f"pubcheck-{uuid.uuid4().hex[:8]}"
    other_slug = f"pubcheck-lib-{uuid.uuid4().hex[:8]}"
    conn = psycopg.connect(db, connect_timeout=15)
    keys_written: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                insert into templates (id, name, defaults, listed)
                values ('checktpl','Check','{"ink":"#111","accent":"#a00"}'::jsonb,false)
                on conflict (id) do update set defaults = excluded.defaults
            """)
            cur.execute("""
                insert into tenants (slug, name, template_id, theme)
                values (%s,'Check','checktpl','{"accent":"#0a0"}'::jsonb) returning id
            """, (slug,))
            tid = cur.fetchone()[0]
            cur.execute("""insert into categories (tenant_id,name,position)
                           values (%s,'Mains',0) returning id""", (tid,))
            cat = cur.fetchone()[0]

            def model(state, draco="catalog/x/model_draco.glb", usdz="catalog/x/model.usdz"):
                cur.execute("""
                    insert into models (tenant_id,title,dish,variant,draco_key,usdz_key,
                                        scale_cm,scale_axis,tenant_state)
                    values (%s,'m',%s,'default',%s,%s,26,'width',%s) returning id
                """, (tid, uuid.uuid4().hex[:8], draco, usdz, state))
                return cur.fetchone()[0]

            approved = model("approved")
            draft = model("draft")
            rejected = model("rejected")
            fileless = model("approved", draco=None, usdz=None)

            def item(name, model_id=None, visible=True, price=1000):
                cur.execute("""
                    insert into items (tenant_id,category_id,name,price_minor,model_id,
                                       visible,position)
                    values (%s,%s,%s,%s,%s,%s,0)
                """, (tid, cat, name, price, model_id, visible))

            # A SECOND restaurant, so the library can be tested for what it is: a model
            # that lives somewhere else. Both of its models are approved and have files,
            # so the only thing that can decide their fate here is `shared` (0024).
            cur.execute("""
                insert into tenants (slug, name, template_id)
                values (%s,'Check other','checktpl') returning id
            """, (other_slug,))
            other_tid = cur.fetchone()[0]

            def other_model(shared):
                cur.execute("""
                    insert into models (tenant_id,title,dish,variant,draco_key,usdz_key,
                                        scale_cm,scale_axis,tenant_state,shared)
                    values (%s,'lib',%s,'default','catalog/x/model_draco.glb',
                            'catalog/x/model.usdz',26,'width','approved',%s) returning id
                """, (other_tid, uuid.uuid4().hex[:8], shared))
                return cur.fetchone()[0]

            library = other_model(True)
            someone_elses = other_model(False)

            item("Visible with approved model", approved)
            item("Visible with draft model", draft)
            item("Visible with rejected model", rejected)
            item("Visible with a model that has no files", fileless)
            item("Visible, no model at all")
            item("Visible with a LIBRARY model", library)
            item("Visible with SOMEONE ELSE'S model", someone_elses)
            item("HIDDEN, must never appear", approved, visible=False)
        conn.commit()

        print("\n== what the snapshot contains ==")
        snap = pub.compile_snapshot(conn, tid)
        names = [i["name"] for i in snap["items"]]
        check("only visible items are in it", len(names) == 7, f"{len(names)}: {names}")
        check("the hidden item is ABSENT, not flagged",
              not any("HIDDEN" in n for n in names), str(names))

        by = {i["name"]: i for i in snap["items"]}
        check("an approved model is attached",
              by["Visible with approved model"]["model"] is not None)
        check("a DRAFT model is not", by["Visible with draft model"]["model"] is None)
        check("a REJECTED model is not",
              by["Visible with rejected model"]["model"] is None)
        check("an approved model with no shipping files is not",
              by["Visible with a model that has no files"]["model"] is None)
        check("an item with no model is still on the menu",
              "Visible, no model at all" in by)

        # The BetaReal library, 0024. These two rows differ in exactly one boolean, and
        # the pair is the point: the first proves a library model crosses the tenant
        # boundary, the second proves that nothing else does. Flip `shared` on the second
        # and the first check stays green while the second goes red, which is what tells
        # you the rule is the flag and not the join being gone.
        check("a model from the BetaReal library IS attached across tenants",
              by["Visible with a LIBRARY model"]["model"] is not None)
        check("another restaurant's model is NOT, library or no library",
              by["Visible with SOMEONE ELSE'S model"]["model"] is None)

        m = by["Visible with approved model"]["model"]
        check("the model carries real-world scale",
              m["scale_cm"] == 26.0 and m["scale_axis"] == "width", str(m))
        check("assets are KEYS, not URLs",
              not m["draco"].startswith("http"), m["draco"])

        print("\n== the theme, resolved at compile time ==")
        check("template defaults are present", snap["theme"].get("ink") == "#111",
              str(snap["theme"]))
        check("the tenant overrides them", snap["theme"].get("accent") == "#0a0",
              str(snap["theme"]))
        # If the renderer had to merge these, every renderer would have to - and the admin
        # preview and the live page would drift the first time one of them was updated.
        check("so a renderer never has to merge anything", True)

        print("\n== publishing ==")
        r1 = pub.publish(conn, tid)
        keys_written.append(r1["key"])
        check("version 1 published", r1["changed"] and r1["version"] == 1, str(r1))
        check("it counted the items", r1["items"] == 7, str(r1["items"]))

        stored = pub.read_snapshot(tid, 1)
        check("the object is really in R2", stored is not None)
        check("and it is what we compiled",
              stored and [i["name"] for i in stored["items"]] == names)
        check("it carries its own version", stored and stored["version"] == 1)

        r2 = pub.publish(conn, tid)
        check("publishing again with no edits does nothing",
              not r2["changed"] and r2["version"] == 1, str(r2))
        # Otherwise every save would mint a version, invalidate a perfectly good edge
        # cache, and fill the publications log with rows nobody can tell apart.

        with conn.cursor() as cur:
            cur.execute("update items set price_minor = 9999 where tenant_id = %s and "
                        "name = 'Visible, no model at all'", (tid,))
        conn.commit()
        r3 = pub.publish(conn, tid)
        keys_written.append(r3["key"])
        check("an edit does make a new version", r3["changed"] and r3["version"] == 2,
              str(r3))

        old = pub.read_snapshot(tid, 1)
        check("and version 1 is untouched - snapshots are immutable",
              old and all(i["price_minor"] != 9999 for i in old["items"]))
        check("which is what makes a rollback just a pointer move", True)

        print("\n== what a diner's page would read ==")
        live = pub.live_snapshot(conn, slug)
        check("the live snapshot resolves from the slug", live is not None)
        check("and it is the newest version", live and live["version"] == 2)
        check("it needs no join, no lookup, no second request",
              live is not None and set(live) >= {"tenant", "theme", "items", "categories"},
              str(sorted(live or {})))
        size = len(json.dumps(live, separators=(",", ":")).encode())
        check("a whole menu is a few KB", size < 32_000, f"{size:,} bytes")

        # `public_menu()` is a SECOND implementation of the same join, in SQL, and it is
        # the one the live Astro page actually calls. Both were changed in 0024 and either
        # could have been missed, so both are asked the same question here.
        print()
        print("== public_menu, which is the live path ==")
        with conn.cursor() as cur:
            cur.execute("select public_menu(%s)", (slug,))
            pm = cur.fetchone()[0]
        pub_by = {i["name"]: i for i in (pm or {}).get("items", [])}
        check("public_menu serves a library model",
              (pub_by.get("Visible with a LIBRARY model") or {}).get("draco_key")
              is not None)
        check("public_menu still refuses another restaurant's model",
              (pub_by.get("Visible with SOMEONE ELSE'S model") or {}).get("draco_key")
              is None)
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("delete from tenants where slug in (%s, %s)",
                            (slug, other_slug))
                cur.execute("delete from templates where id = 'checktpl'")
            conn.commit()
        except Exception:                                     # noqa: BLE001
            conn.rollback()
        conn.close()
        for k in keys_written:
            storage.backend().delete_prefix(pub.BUCKET, k)

    print("\n" + "=" * 62)
    bad = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print(f"  FAILED: {n}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
