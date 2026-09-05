#!/usr/bin/env python3
"""Compile a restaurant's draft into the immutable object a diner's page is rendered from.

    python menu/publish.py --tenant monday-greens
    python menu/publish.py --tenant monday-greens --dry-run
    python menu/publish.py --list

This is MENU-PLATFORM.md §2.1, the decision everything else hangs off: **a diner request
never touches the database.** The owner edits Postgres continuously; publishing reads that
draft once, flattens it into one JSON object, and puts it on R2. The menu page reads that
object and nothing else - no joins, no lookups, no connection pool between a hungry person
and a list of dishes.

**The snapshot format is the contract, not this file.** This is the reference
implementation of it, written in Python because the R2 and database plumbing already works
here and it can therefore be tested today. When the admin app moves onto Workers, the
compile step will move with it - that is a mechanical port of one function. Changing the
FORMAT is the expensive thing, so the format is what has thought in it.

Three rules the compiler enforces, all of them things a renderer must never be trusted to
remember:

**Hidden means absent.** An invisible item is not in the file at all, not in it with a
flag. A flag is one `if` away from being on a menu, and the file is public-ish - it sits
behind the CDN and anyone with the URL can read it.

**Only APPROVED models are attached.** DECISIONS §9.4 - the owner decides whether a model
goes on their menu. A draft that nobody has looked at, or one they rejected, must not
reach a table because someone forgot a `where` clause.

**Keys, not URLs.** The buckets are private and the Worker serves their bytes (§2.6). A
URL baked in here would be a URL that expires, inside an object that is supposed to be
immutable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import storage                     # noqa: E402
from config import load_env        # noqa: E402

BUCKET = "menus"
FORMAT_VERSION = 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def snapshot_key(tenant_id: str, version: int) -> str:
    """Where one publish lives, forever.

    The version is IN the key, so a snapshot is never overwritten. That is what makes the
    edge cache trivial: a new publish is a new key, and there is no purge to propagate and
    no window in which two edges disagree about what the menu says. It also means a bad
    publish is undone by pointing `live_publication` back at the previous row - the old
    object is still there, byte for byte.
    """
    return f"t/{tenant_id}/{version:08d}.json"


# ── compiling ───────────────────────────────────────────────────────

def compile_snapshot(conn, tenant_id: str) -> dict:
    """Everything the page needs, flattened. Pure: reads, returns, writes nothing."""
    with conn.cursor() as cur:
        cur.execute("""
            select t.id, t.slug, t.name, t.template_id, t.theme, t.settings,
                   t.languages, coalesce(tpl.defaults, '{}'::jsonb)
            from tenants t
            left join templates tpl on tpl.id = t.template_id
            where t.id = %s
        """, (tenant_id,))
        row = cur.fetchone()
        if not row:
            raise LookupError(f"no tenant {tenant_id}")
        tid, slug, name, template_id, theme, settings, languages, defaults = row

        cur.execute("""
            select id, name, position, i18n from categories
            where tenant_id = %s and visible order by position, name
        """, (tenant_id,))
        categories = [{"id": str(c[0]), "name": c[1], "position": c[2],
                       **_flat(c[3])}
                      for c in cur.fetchall()]

        # One query, one pass. The LEFT JOIN is filtered on `approved` rather than the
        # join being unconditional and the state checked afterwards - an item whose model
        # is not approved is an item with no model, not an item to be fixed up later.
        cur.execute("""
            select i.id, i.name, i.description, i.price_minor, i.currency,
                   i.category_id, i.position, i.photo_key,
                   m.draco_key, m.usdz_key, m.poster_key, m.scale_cm, m.scale_axis,
                   m.view_orbit,
                   i.i18n, i.price_text, i.price_old_minor, i.text_only, i.is_3d,
                   i.thumb_3d, i.featured, i.variants, i.addons,
                   m.external_glb, m.external_usdz, m.ar_scale
            from items i
            left join models m
                   on m.id = i.model_id
                  and m.tenant_id = i.tenant_id
                  and m.tenant_state = 'approved'
            where i.tenant_id = %s and i.visible
            order by i.position, i.name
        """, (tenant_id,))
        items = []
        for (iid, iname, desc, price, cur_code, cat, pos, photo,
             draco, usdz, poster, scale_cm, scale_axis, orbit,
             i18n, price_text, price_old, text_only, is_3d, thumb_3d, featured,
             variants, addons, ext_glb, ext_usdz, ar_scale) in cur.fetchall():
            # An imported model has absolute URLs; one of ours has R2 keys. Both travel
            # in the same field and the renderer tells them apart by the scheme, so a
            # template never has to care where a dish's files live.
            draco = draco or ext_glb
            usdz = usdz or ext_usdz
            model = None
            # A model with no shipping files is not a model. It happens: generation
            # succeeded and the optimiser has not run yet, because worker.py finishes
            # what a 512 MB host cannot. Publishing it would put an empty 3D button on a
            # real menu.
            # `is_3d` off means the dish keeps its model and behaves like a photo
            # dish - a real case the platform learned the hard way, and one flag could
            # not express it.
            if (draco or usdz) and is_3d:
                model = {
                    "draco": draco, "usdz": usdz, "poster": poster,
                    "scale_cm": float(scale_cm) if scale_cm is not None else None,
                    "scale_axis": scale_axis,
                    # How to frame it. The renderer clamps and validates; a bad value
                    # here must render as "the default view", never as no page.
                    "orbit": orbit or None,
                    # 1 for anything from our pipeline, which bakes real size into the
                    # file. Only an imported model needs a multiplier.
                    "ar_scale": float(ar_scale) if ar_scale is not None else 1.0,
                    # Whether the CARD shows a live model or the photo. Off saves a
                    # WebGL context and a download.
                    "live_thumb": bool(thumb_3d),
                }
            items.append({
                "id": str(iid), "name": iname, "description": desc,
                "price_minor": price, "currency": cur_code,
                # Display override only, for prices no single number can express.
                # Nothing ever totals it.
                "price_text": price_text or None,
                "price_old_minor": price_old or None,
                "category_id": str(cat) if cat else None,
                "position": pos, "photo": photo, "model": model,
                "text_only": bool(text_only), "featured": bool(featured),
                "variants": variants or [], "addons": addons or [],
                # Flattened to the platform's own field names - `name_ka`, not a nested
                # bag - so the ported `t(item, 'name')` works with no change at all.
                **_flat(i18n),
            })

    # Template defaults under the tenant's own settings. A template can gain a setting
    # later and every tenant picks it up without a migration or a re-save.
    merged = dict(defaults or {})
    merged.update(theme or {})

    return {
        "format": FORMAT_VERSION,
        "tenant": {"id": str(tid), "slug": slug, "name": name,
                   "languages": list(languages or ["en"])},
        "template": template_id,
        "theme": merged,
        # Hero, logo, fonts, hours, address, socials. NOT the palette - the platform
        # keeps both in one bag and a real tenant ends up with 104 keys of two kinds.
        "settings": settings or {},
        "categories": categories,
        "items": items,
    }


def _flat(i18n) -> dict:
    """{"ka": {"name": "x"}} -> {"name_ka": "x"}.

    Our column is a bag keyed by language so a restaurant in Warsaw needs no migration.
    The PAGE wants the platform's flat field names, because `t(item, 'name')` is ported
    verbatim and reads `item['name_' + lang]`. Flattening here means the storage can be
    general and the renderer can stay unedited.
    """
    out = {}
    for lang, fields in (i18n or {}).items():
        for field, value in (fields or {}).items():
            if value:
                out[f"{field}_{lang}"] = value
    return out


def body_sha(snapshot: dict) -> str:
    """Fingerprint of the CONTENT, ignoring when it was published.

    Publishing twice with nothing changed in between must not invalidate an edge cache
    that is serving perfectly good bytes, and must not add a version nobody can tell apart
    from the last one. Sorted keys, so a dict that happens to iterate differently does not
    read as an edit.
    """
    stable = {k: v for k, v in snapshot.items() if k not in ("published", "version")}
    return hashlib.sha256(
        json.dumps(stable, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()[:32]


# ── publishing ──────────────────────────────────────────────────────

def publish(conn, tenant_id: str, by: str | None = None, dry: bool = False) -> dict:
    """Compile, store, record, and point the tenant at it. Returns what happened."""
    snap = compile_snapshot(conn, tenant_id)
    sha = body_sha(snap)

    with conn.cursor() as cur:
        cur.execute("""
            select p.version, p.snapshot_sha
            from live_publication l join publications p on p.id = l.publication_id
            where l.tenant_id = %s
        """, (tenant_id,))
        live = cur.fetchone()

    if live and live[1] == sha:
        return {"changed": False, "version": live[0], "sha": sha,
                "items": len(snap["items"]), "reason": "nothing changed since the last publish"}

    version = (live[0] + 1) if live else 1
    snap["version"] = version
    snap["published"] = _now()
    key = snapshot_key(tenant_id, version)
    body = json.dumps(snap, separators=(",", ":"), ensure_ascii=False).encode()

    if dry:
        return {"changed": True, "version": version, "sha": sha, "key": key,
                "bytes": len(body), "items": len(snap["items"]), "dry": True}

    # Object first, database second. If this process dies between them the worst case is
    # an object nobody points at - which costs a few kilobytes. The other order would
    # point a live menu at a file that does not exist.
    storage.backend().put(BUCKET, key, body, "application/json")

    with conn.cursor() as cur:
        cur.execute("""
            insert into publications
                (tenant_id, version, snapshot_key, snapshot_sha, item_count, model_count,
                 published_by)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id
        """, (tenant_id, version, key, sha, len(snap["items"]),
              sum(1 for i in snap["items"] if i["model"]), by))
        pub_id = cur.fetchone()[0]
        cur.execute("""
            insert into live_publication (tenant_id, publication_id)
            values (%s, %s)
            on conflict (tenant_id)
            do update set publication_id = excluded.publication_id, updated_utc = now()
        """, (tenant_id, pub_id))
    conn.commit()

    return {"changed": True, "version": version, "sha": sha, "key": key,
            "bytes": len(body), "items": len(snap["items"]),
            "models": sum(1 for i in snap["items"] if i["model"])}


def read_snapshot(tenant_id: str, version: int) -> dict | None:
    raw = storage.backend().get(BUCKET, snapshot_key(tenant_id, version))
    return json.loads(raw) if raw else None


def live_snapshot(conn, slug: str) -> dict | None:
    """What a diner would get right now. The Worker's read path, in one query.

    In production this query does not happen either - the Worker reads the object from R2
    directly, keyed by a slug->version mapping it caches. This exists so the renderer can
    be tested locally against exactly what is live.
    """
    with conn.cursor() as cur:
        cur.execute("""
            select p.snapshot_key from tenants t
            join live_publication l on l.tenant_id = t.id
            join publications p on p.id = l.publication_id
            where t.slug = %s
        """, (slug,))
        row = cur.fetchone()
    if not row:
        return None
    raw = storage.backend().get(BUCKET, row[0])
    return json.loads(raw) if raw else None


# ── cli ─────────────────────────────────────────────────────────────

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
    ap.add_argument("--tenant", help="slug to publish")
    ap.add_argument("--list", action="store_true", help="tenants and their live version")
    ap.add_argument("--dry-run", action="store_true", help="compile, store nothing")
    ap.add_argument("--out", type=Path, help="also write the snapshot here, for the renderer")
    a = ap.parse_args()

    conn = connect()
    if conn is None:
        return 1
    with conn:
        if a.list or not a.tenant:
            with conn.cursor() as cur:
                cur.execute("""
                    select t.slug, t.name, t.template_id, p.version, p.published_utc,
                           p.item_count, p.model_count
                    from tenants t
                    left join live_publication l on l.tenant_id = t.id
                    left join publications p on p.id = l.publication_id
                    order by t.slug
                """)
                rows = cur.fetchall()
            if not rows:
                print("No tenants yet.  python menu/seed.py --demo")
                return 0
            print(f"{'slug':<24} {'template':<16} {'live':>5}  items  3D   published")
            for slug, name, tpl, ver, when, items, models in rows:
                print(f"{slug:<24} {(tpl or '-'):<16} "
                      f"{(str(ver) if ver else '-'):>5}  "
                      f"{(items if items is not None else 0):>5}  "
                      f"{(models if models is not None else 0):>3}   "
                      f"{when.isoformat(timespec='seconds') if when else '-'}")
            return 0

        with conn.cursor() as cur:
            cur.execute("select id from tenants where slug = %s", (a.tenant,))
            row = cur.fetchone()
        if not row:
            print(f"No tenant with slug {a.tenant!r}.")
            return 1

        res = publish(conn, row[0], by=None, dry=a.dry_run)
        if not res["changed"]:
            print(f"Nothing to publish: {res['reason']}. Live version is {res['version']}.")
        else:
            print(f"{'Would publish' if a.dry_run else 'Published'} version "
                  f"{res['version']}: {res['items']} items, "
                  f"{res.get('models', 0)} with 3D, {res['bytes']:,} bytes")
            print(f"  {res['key']}")
        if a.out:
            snap = compile_snapshot(conn, row[0])
            snap.setdefault("version", res["version"])
            a.out.parent.mkdir(parents=True, exist_ok=True)
            a.out.write_text(json.dumps(snap, indent=2, ensure_ascii=False),
                             encoding="utf-8")
            print(f"  also written to {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
