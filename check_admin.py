#!/usr/bin/env python3
"""Walk the admin panel over HTTP, as a real signed-in user.

    python check_admin.py                    # against http://127.0.0.1:4321

Every other check in this repo tests a layer. This one tests the thing an owner touches:
it creates a throwaway account, signs in through the real form, opens every screen, edits
a dish, a category and a colour, and reads the values back. A panel that compiles and a
panel that saves are different claims, and only the second one matters to a restaurant.

It also asserts the negative: a signed-in user who is not a member of a restaurant must
not be able to open or edit it. That is the property `check_schema.py` proves at the SQL
level; here it is proved through the routes a browser actually hits, because a handler
that reaches for the service key would pass the first test and fail this one.

The throwaway users, their restaurant and every row they made are deleted at the end,
including when a check fails. The password is generated here, used once and never printed.
"""
from __future__ import annotations

import os
import secrets
import sys
import uuid

import requests

from config import load_env

BASE = os.environ.get("ADMIN_BASE", "http://127.0.0.1:4321")

PASSED = 0
FAILED = 0


def check(name: str, ok, detail: str = "") -> bool:
    global PASSED, FAILED
    ok = bool(ok)
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name}" + (f"  -- {detail}" if detail else ""))
    return ok


def admin_api(method: str, path: str, url: str, key: str, **kw):
    return requests.request(method, f"{url}/auth/v1/admin{path}", timeout=30,
                            headers={"apikey": key, "Authorization": f"Bearer {key}"}, **kw)


def make_user(url: str, key: str, email: str, password: str) -> str | None:
    r = admin_api("POST", "/users", url, key,
                  json={"email": email, "password": password, "email_confirm": True})
    return r.json().get("id") if r.ok else None


def sign_in(email: str, password: str) -> requests.Session | None:
    """Through the real login form, so the cookie is the one a browser would hold."""
    s = requests.Session()
    r = s.post(f"{BASE}/admin/login", timeout=30, allow_redirects=False,
               data={"email": email, "password": password})
    return s if r.status_code in (302, 303) and "br_session" in s.cookies else None


def main() -> int:
    load_env()
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_KEY", "")
    db = os.environ.get("SUPABASE_DB_URL", "")
    if not (url and secret and db):
        print("Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_DB_URL in .env.")
        return 2

    try:
        requests.get(f"{BASE}/admin/login", timeout=10)
    except requests.RequestException:
        print(f"No server at {BASE}. Start one with:  cd app && npm run dev")
        return 2

    import psycopg

    print(f"Admin panel  ({BASE})\n")
    owner_id = outsider_id = None
    slug = f"check-{uuid.uuid4().hex[:8]}"

    try:
        # ── two accounts: one who will own a restaurant, one who will not ────
        owner_mail = f"check-own-{uuid.uuid4().hex[:8]}@betareal.test"
        other_mail = f"check-out-{uuid.uuid4().hex[:8]}@betareal.test"
        owner_pw, other_pw = secrets.token_urlsafe(18), secrets.token_urlsafe(18)
        owner_id = make_user(url, secret, owner_mail, owner_pw)
        outsider_id = make_user(url, secret, other_mail, other_pw)
        if not check("two test accounts created", owner_id and outsider_id):
            return 1

        # ── signing in ───────────────────────────────────────────────────────
        anon = requests.get(f"{BASE}/admin", timeout=30, allow_redirects=False)
        check("signed out, /admin redirects to the login", anon.status_code == 302,
              f"got {anon.status_code}")

        bad = requests.post(f"{BASE}/admin/login", timeout=30, allow_redirects=False,
                            data={"email": owner_mail, "password": "not-the-password"})
        check("a wrong password does not sign you in",
              "br_session" not in bad.cookies, "a session cookie was issued")

        s = sign_in(owner_mail, owner_pw)
        if not check("the real login form signs you in", s):
            return 1
        out = sign_in(other_mail, other_pw)
        if not check("the second account signs in too", out):
            return 1

        # ── creating a restaurant ────────────────────────────────────────────
        made = s.post(f"{BASE}/admin/new", timeout=60, allow_redirects=False,
                      data={"name": "Check Cafe", "slug": slug,
                            "template_id": "monday_greens"})
        check("a new restaurant is created and lands on its menu",
              made.status_code in (302, 303)
              and slug in made.headers.get("location", ""),
              f"{made.status_code} -> {made.headers.get('location')}")

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select id from tenants where slug = %s", (slug,))
            row = cur.fetchone()
            if not check("the restaurant row exists", row):
                return 1
            tenant_id = row[0]
            cur.execute("select role from tenant_members where tenant_id = %s "
                        "and user_id = %s", (tenant_id, owner_id))
            check("whoever created it is a member of it", cur.fetchone(),
                  "the creator would not be able to see their own restaurant")

        # ── every screen opens ───────────────────────────────────────────────
        for path, must_contain in [
            ("/admin", "Check Cafe"),
            (f"/admin/{slug}/menu", "Check Cafe"),
            (f"/admin/{slug}/categories", "Add a category"),
            (f"/admin/{slug}/item/new", "Name"),
            (f"/admin/{slug}/look", "Colours"),
            (f"/admin/{slug}/settings", "Hours"),
            (f"/admin/{slug}/models", "3D models"),
        ]:
            r = s.get(f"{BASE}{path}", timeout=45)
            check(f"{path} opens", r.status_code == 200 and must_contain in r.text,
                  f"{r.status_code}, {len(r.text)} bytes")

        # ── a category, a dish, a colour ─────────────────────────────────────
        r = s.post(f"{BASE}/api/category", timeout=45,
                   json={"slug": slug, "name": "Starters"})
        cat_id = r.json().get("id") if r.ok else None
        check("a category is created", cat_id, r.text[:120])

        r = s.post(f"{BASE}/api/item", timeout=45, json={
            "slug": slug, "name": "Khachapuri", "description": "Cheese bread",
            "price_minor": 1850, "category_id": cat_id, "visible": True,
            "is_3d": True, "thumb_3d": True, "i18n": {"ka": {"name": "ხაჭაპური"}},
        })
        item_id = r.json().get("id") if r.ok else None
        check("a dish is created", item_id, r.text[:120])

        r = s.post(f"{BASE}/api/tenant", timeout=45, json={
            "slug": slug, "theme": {"night_accent": "#ff6600", "bogus_key": "#000000"},
            "settings": {"site_address": "21/23 Irakli Abashidze Street",
                         "not_a_real_setting": "should be dropped"},
        })
        check("the look and the details save", r.ok, r.text[:120])

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select name, price_minor, thumb_3d, i18n->'ka'->>'name' "
                        "from items where id = %s", (item_id,))
            got = cur.fetchone()
            check("the dish is stored exactly as typed",
                  got and got[0] == "Khachapuri" and got[1] == 1850 and got[2] is True,
                  str(got))
            check("the Georgian name survives the round trip",
                  got and got[3] == "ხაჭაპური", str(got[3] if got else None))

            cur.execute("select theme, settings from tenants where id = %s", (tenant_id,))
            theme, settings = cur.fetchone()
            check("the colour is saved", theme.get("night_accent") == "#ff6600")
            check("an unknown colour key is dropped", "bogus_key" not in theme,
                  "the settings bag is jsonb - anything a POST puts there stays there")
            check("the address is saved",
                  settings.get("site_address") == "21/23 Irakli Abashidze Street")
            check("an unknown setting is dropped", "not_a_real_setting" not in settings)

        # ── the negative: a stranger must be able to do none of it ───────────
        r = out.get(f"{BASE}/admin/{slug}/menu", timeout=45)
        check("a stranger cannot open someone else's menu", r.status_code == 404,
              f"got {r.status_code}")

        r = out.post(f"{BASE}/api/item", timeout=45,
                     json={"slug": slug, "id": item_id, "name": "Vandalised"})
        check("a stranger cannot edit someone else's dish", not r.ok,
              f"HTTP {r.status_code}")

        r = out.post(f"{BASE}/api/tenant", timeout=45,
                     json={"slug": slug, "settings": {"site_address": "nowhere"}})
        check("a stranger cannot edit someone else's details", not r.ok,
              f"HTTP {r.status_code}")

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select name from items where id = %s", (item_id,))
            check("the dish is still what its owner typed",
                  cur.fetchone()[0] == "Khachapuri")

        # ── the three things the platform's admin has that this one owed ────
        r = s.post(f"{BASE}/api/item", timeout=45, json={
            "slug": slug, "id": item_id, "name": "Khachapuri", "price_minor": 1850,
            "visible": True, "is_3d": True,
            "variants": [{"en": "Regular", "ka": "ჩვეულ",
                          "price": "18.50 ₾"},
                         {"en": "Large", "price": "24 ₾"},
                         {"junk": "dropped", "price": "1"}],
        })
        check("a dish can be priced more than one way", r.ok, r.text[:120])

        r = s.post(f"{BASE}/api/item", timeout=45,
                   json={"slug": slug, "order": [item_id]})
        check("dishes can be reordered", r.ok, r.text[:120])

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select variants, position from items where id = %s", (item_id,))
            variants, position = cur.fetchone()
            check("both sizes are stored in the platform's own shape",
                  len(variants) == 2 and variants[0]["en"] == "Regular"
                  and variants[0]["price"] == "18.50 ₾"
                  and variants[0].get("ka"),
                  str(variants))
            check("a variant field we do not recognise is dropped",
                  all("junk" not in v for v in variants), str(variants))
            check("the new position is stored", position == 0, str(position))

        # The camera angle. Three bare numbers, the platform's own convention, and it
        # lives on the MODEL rather than the item so it travels with the mesh.
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("""insert into models (tenant_id, title, dish, variant, draco_key)
                           values (%s, 'Probe', 'probe-dish', 'default', 'catalog/x.glb')
                           returning id""", (tenant_id,))
            # psycopg hands back a UUID object and requests will not serialise one.
            model_id = str(cur.fetchone()[0])
            conn.commit()

        r = s.post(f"{BASE}/api/model", timeout=45,
                   json={"slug": slug, "id": model_id, "view_orbit": "45 60 110"})
        check("a starting camera angle can be saved", r.ok, r.text[:120])

        bad = s.post(f"{BASE}/api/model", timeout=45,
                     json={"slug": slug, "id": model_id, "view_orbit": "rotate(90deg)"})
        check("and something that is not an angle is refused", bad.status_code == 400,
              f"HTTP {bad.status_code}")

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select view_orbit from models where id = %s", (model_id,))
            check("the angle is stored as the platform writes it",
                  cur.fetchone()[0] == "45 60 110")

        # ── asking for a 3D model, which is the only thing here that costs ──
        # No credits are spent by any of this: a request is a row, and nothing reads it
        # until `menu/requests.py` runs. That separation is the reason this is testable.
        r = s.post(f"{BASE}/api/model-request", timeout=45, json={
            "slug": slug, "item_id": item_id,
            "photo_keys": [f"t/x/capture/aaaa-{a}.jpg"
                           for a in ("front", "right", "back", "left")],
        })
        req = r.json() if r.ok else {}
        check("a 3D model can be asked for", r.ok, r.text[:120])
        check("and it is approved automatically while under quota",
              req.get("state") == "approved", str(req.get("state")))

        # The partial unique index. A double-tap on a slow connection must not be two
        # generations and sixty credits for one plate of food.
        again = s.post(f"{BASE}/api/model-request", timeout=45, json={
            "slug": slug, "item_id": item_id, "photo_keys": ["t/x/capture/bbbb-front.jpg"],
        })
        check("asking twice for the same dish is refused", again.status_code == 409,
              f"HTTP {again.status_code}")

        # THE one that matters. An owner may withdraw a request; they may not approve
        # one, because approving is what spends our money. RLS is the enforcement, so
        # this goes at the database through the user's own token - not through a handler
        # that could simply be missing the check.
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select id from model_requests where item_id = %s", (item_id,))
            req_id = cur.fetchone()[0]

            def as_user(uid, sql, args=()):
                """Run a statement the way the app runs it: as `authenticated`, with this
                user's id in the JWT claims, which is what auth.uid() reads.

                Inside a savepoint that is ALWAYS rolled back. A denied statement poisons
                the transaction so even `reset role` fails afterwards, and a permitted one
                must not actually change anything - the point is to find out whether it is
                allowed, not to do it.
                """
                cur.execute("savepoint probe")
                cur.execute("select set_config('request.jwt.claims', %s, true)",
                            ('{"sub": "%s", "role": "authenticated"}' % uid,))
                cur.execute("set local role authenticated")
                try:
                    cur.execute(sql, args)
                    out, err = (cur.fetchall() if cur.description else []), None
                except Exception as exc:                      # noqa: BLE001
                    out, err = None, str(exc).splitlines()[0]
                cur.execute("rollback to savepoint probe")
                cur.execute("reset role")
                return out, err

            _, err = as_user(owner_id,
                             "update model_requests set state = 'approved' "
                             "where id = %s returning id", (req_id,))
            check("an owner CANNOT approve their own request", err is not None,
                  "an owner could set off a 30-credit generation at will")

            _, err = as_user(owner_id,
                             "update model_requests set credits = 0, engine = 'x' "
                             "where id = %s returning id", (req_id,))
            check("an owner cannot rewrite what an engine reported", err is not None,
                  "the column grants should allow only `state`")

            rows, err = as_user(owner_id,
                                "update model_requests set state = 'cancelled' "
                                "where id = %s returning id", (req_id,))
            check("an owner CAN withdraw their own request", err is None, str(err))

            # A stranger must not even be able to see that it exists.
            rows, err = as_user(outsider_id,
                                "select id from model_requests where id = %s", (req_id,))
            check("a stranger cannot see someone else's request", not rows, str(rows))

            # The quota, which is the only thing standing between self-serve and an
            # unbounded bill. Drop it to what has already been used and the next request
            # must land as pending rather than approved.
            cur.execute("update tenants set model_quota = 0 where id = %s", (tenant_id,))
            conn.commit()

        r = s.post(f"{BASE}/api/model-request", timeout=45, json={
            "slug": slug, "photo_keys": ["t/x/capture/cccc-front.jpg"], "title": "Over",
        })
        over = r.json() if r.ok else {}
        check("over quota, a request waits for us instead of running",
              over.get("state") == "pending", str(over))

        # ── the published page reflects the edit ─────────────────────────────
        r = requests.get(f"{BASE}/{slug}", timeout=60)
        check("the restaurant's own page renders the new dish",
              r.status_code == 200 and "Khachapuri" in r.text,
              f"{r.status_code}, {len(r.text)} bytes")

        # ── signing out ──────────────────────────────────────────────────────
        s.post(f"{BASE}/admin/logout", timeout=30, allow_redirects=False)
        r = s.get(f"{BASE}/admin", timeout=30, allow_redirects=False)
        check("signing out really ends the session", r.status_code == 302,
              f"got {r.status_code}")

    finally:
        # Cleaned up even when a check fails, so a bad run does not leave a fake
        # restaurant in the list the next person opens.
        try:
            with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
                cur.execute("delete from tenants where slug = %s", (slug,))
                conn.commit()
        except Exception as exc:                              # noqa: BLE001
            print(f"  (could not remove the test restaurant: {exc})")
        for uid in (owner_id, outsider_id):
            if uid:
                admin_api("DELETE", f"/users/{uid}", url, secret)

    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
