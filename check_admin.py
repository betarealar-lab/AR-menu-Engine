#!/usr/bin/env python3
"""The whole self-serve product, end to end, as the people who use it.

    python check_admin.py

Needs both apps running:   cd app && npm run dev      (the menu, :4321)
                           cd admin && npm run dev    (the admin, :3001)

Every other check in this repo tests a layer. This one walks the product: a stranger with
an invite code signs up, becomes the owner of a restaurant, opens every screen, adds a
dish, asks for a 3D model, and their diners' taps show up in their own analytics. Then the
negatives, which are the half that matters: a stranger cannot see, edit, approve or join
what is not theirs, and a diner cannot write anything but a count.

The admin writes to the database directly from the browser as the signed-in user, so most
of what it does is checked HERE the same way - through PostgREST with a real token - rather
than through routes that would only prove the route. The database is the authority
(check_schema.py), and this proves the product actually stands on it.

Everything created is deleted at the end, including when a check fails. Passwords are
generated here, used once, never printed.
"""
from __future__ import annotations

import os
import secrets
import sys
import uuid
from pathlib import Path

import requests

from config import load_env

MENU = os.environ.get("MENU_BASE", "http://127.0.0.1:4321")
ADMIN = os.environ.get("ADMIN_BASE", "http://127.0.0.1:3001")

PASSED = FAILED = 0


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


def up(base: str) -> bool:
    try:
        requests.get(base, timeout=8)
        return True
    except requests.RequestException:
        return False


class Supa:
    """Just enough of the Supabase REST surface, as a specific person."""

    def __init__(self, url: str, anon: str, service: str):
        self.url, self.anon, self.service = url.rstrip("/"), anon, service

    def _h(self, bearer: str, **extra):
        key = self.service if bearer == self.service else self.anon
        return {"apikey": key, "Authorization": f"Bearer {bearer}",
                "Content-Type": "application/json", **extra}

    # -- accounts: the service key, on the auth schema only --
    def make_user(self, email: str, password: str) -> str | None:
        r = requests.post(f"{self.url}/auth/v1/admin/users", timeout=30,
                          headers=self._h(self.service),
                          json={"email": email, "password": password, "email_confirm": True})
        return r.json().get("id") if r.ok else None

    def drop_user(self, uid: str) -> None:
        requests.delete(f"{self.url}/auth/v1/admin/users/{uid}", timeout=30,
                        headers=self._h(self.service))

    def token(self, email: str, password: str) -> str | None:
        r = requests.post(f"{self.url}/auth/v1/token", timeout=30,
                          params={"grant_type": "password"},
                          headers={"apikey": self.anon, "Content-Type": "application/json"},
                          json={"email": email, "password": password})
        return r.json().get("access_token") if r.ok else None

    # -- data, as a person --
    def get(self, tok: str, table: str, **params):
        return requests.get(f"{self.url}/rest/v1/{table}", timeout=30,
                            headers=self._h(tok), params=params)

    def post(self, tok: str, table: str, body, prefer="return=representation"):
        return requests.post(f"{self.url}/rest/v1/{table}", timeout=30,
                             headers=self._h(tok, Prefer=prefer), json=body)

    def patch(self, tok: str, table: str, body, **params):
        return requests.patch(f"{self.url}/rest/v1/{table}", timeout=30,
                              headers=self._h(tok, Prefer="return=representation"),
                              params=params, json=body)

    def rpc(self, tok: str, fn: str, body):
        return requests.post(f"{self.url}/rest/v1/rpc/{fn}", timeout=30,
                             headers=self._h(tok), json=body)


def main() -> int:
    load_env()
    url = os.environ.get("SUPABASE_URL", "")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    service = os.environ.get("SUPABASE_SERVICE_KEY", "")
    db = os.environ.get("SUPABASE_DB_URL", "")
    if not (url and anon and service and db):
        print("Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY and "
              "SUPABASE_DB_URL in .env.")
        return 2
    if not up(f"{MENU}/"):
        print(f"No menu app at {MENU}.  cd app && npm run dev")
        return 2
    if not up(f"{ADMIN}/login"):
        print(f"No admin at {ADMIN}.  cd admin && npm run dev")
        return 2

    import psycopg
    sb = Supa(url, anon, service)
    print(f"The product  (menu {MENU}, admin {ADMIN})\n")

    owner_id = other_id = None
    code = slug = None
    created_users: list[str] = []

    try:
        # ── the door ─────────────────────────────────────────────────────────
        print("== the door ==")
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            code = "CHEK-" + uuid.uuid4().hex[:4].upper().translate(str.maketrans("01", "ZY"))
            cur.execute("insert into invites (code, note) values (%s, 'check_admin')", (code,))
            conn.commit()

        owner_mail = f"check-own-{uuid.uuid4().hex[:8]}@betareal.test"
        owner_pw = secrets.token_urlsafe(18)

        r = requests.post(f"{ADMIN}/api/signup", timeout=45, json={
            "code": "ZZZZ-ZZZZ", "email": owner_mail, "password": owner_pw,
            "name": "Nope", "country": "GE"})
        check("without a valid code, signup is refused", r.status_code == 400,
              f"HTTP {r.status_code}")

        owner = requests.Session()               # the Next admin's cookie jar
        r = owner.post(f"{ADMIN}/api/signup", timeout=60, json={
            "code": code, "email": owner_mail, "password": owner_pw,
            "name": "Check Cafe", "country": "DE"})
        body = r.json() if r.ok else {}
        slug, owner_id = body.get("slug"), body.get("userId")
        if owner_id:
            created_users.append(owner_id)
        if not check("a stranger with a code becomes the owner of a restaurant",
                     r.ok and slug and owner_id, r.text[:160]):
            return 1
        check("and is signed in when it finishes",
              any(c.startswith("sb-") for c in owner.cookies.keys()))

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select id, country, currency, setup_done from tenants where slug = %s",
                        (slug,))
            tenant_id, country, currency, setup_done = cur.fetchone()
            check("country and currency are set from day one",
                  country == "DE" and currency == "EUR", f"{country} {currency}")
            check("setup starts not done", setup_done is False)
            cur.execute("select uses_left, used_tenant from invites where code = %s", (code,))
            inv = cur.fetchone()
            check("the code is burned and points at what it made",
                  inv[0] == 0 and str(inv[1]) == str(tenant_id), str(inv))

        r = requests.post(f"{ADMIN}/api/signup", timeout=45, json={
            "code": code, "email": f"x{owner_mail}", "password": owner_pw,
            "name": "Second", "country": "GE"})
        check("a used code cannot be used twice", r.status_code == 400)

        tok = sb.token(owner_mail, owner_pw)
        check("the new owner's password works", tok)

        other_mail = f"check-out-{uuid.uuid4().hex[:8]}@betareal.test"
        other_pw = secrets.token_urlsafe(18)
        other_id = sb.make_user(other_mail, other_pw)
        if other_id:
            created_users.append(other_id)
        otok = sb.token(other_mail, other_pw)
        check("a second account, in nobody's restaurant, signs in", other_id and otok)

        # ── every screen ─────────────────────────────────────────────────────
        print("\n== every screen ==")
        for path in ("/", "/home", "/menu", "/theme", "/models", "/tenants", "/dashboard",
                     "/history", "/share", "/setup"):
            r = requests.get(f"{ADMIN}{path}", timeout=20, allow_redirects=False)
            check(f"signed out, {path} redirects to login", r.status_code in (302, 307),
                  f"got {r.status_code}")
        for path in ("/login", "/start", "/set-password"):
            r = requests.get(f"{ADMIN}{path}", timeout=20, allow_redirects=False)
            check(f"{path} is reachable signed out", r.status_code == 200, f"got {r.status_code}")
        for path in ("/home", "/menu", "/theme", "/models", "/dashboard", "/share", "/setup"):
            r = owner.get(f"{ADMIN}{path}?tenant={slug}", timeout=30, allow_redirects=False)
            check(f"the owner can open {path}", r.status_code == 200, f"got {r.status_code}")

        # ── the menu ─────────────────────────────────────────────────────────
        print("\n== the menu ==")
        r = sb.post(tok, "categories", {"tenant_id": str(tenant_id), "name": "Starters",
                                        "position": 0})
        cat_id = r.json()[0]["id"] if r.ok else None
        check("a category is created", cat_id, r.text[:120])

        r = sb.post(tok, "items", {
            "tenant_id": str(tenant_id), "name": "Khachapuri", "description": "Cheese bread",
            "price_minor": 1850, "category_id": cat_id, "visible": True, "is_3d": True,
            "i18n": {"ka": {"name": "ხაჭაპური"}},
            "variants": [{"en": "Regular", "ka": "ჩვეულებრივი", "price": "18.50 ₾"},
                         {"en": "Large", "price": "24 ₾"}],
        })
        item_id = r.json()[0]["id"] if r.ok else None
        check("a dish is created with a Georgian name and two sizes", item_id, r.text[:120])

        r = sb.patch(tok, "items", {"price_minor": 1950}, id=f"eq.{item_id}")
        check("and its price can be changed", r.ok and r.json()[0]["price_minor"] == 1950)

        SELECT = ("id,name,description,i18n,price_minor,price_text,category_id,position,"
                  "visible,photo_key,model_id,is_3d,thumb_3d,text_only,featured,variants,"
                  "models(id,draco_key,usdz_key,view_orbit,scale_cm)")
        r = sb.get(tok, "items", tenant_id=f"eq.{tenant_id}", select=SELECT)
        rows = r.json() if r.ok else []
        check("the menu screen's exact query runs", r.ok and len(rows) == 1, r.text[:120])
        check("the language bag and the sizes come back whole",
              bool(rows) and rows[0]["i18n"]["ka"]["name"] == "ხაჭაპური"
              and len(rows[0]["variants"]) == 2)

        r = requests.get(f"{MENU}/{slug}", timeout=60)
        check("the diner page renders the new dish",
              r.status_code == 200 and "Khachapuri" in r.text, f"HTTP {r.status_code}")
        check("and the restaurant's name", "Check Cafe" in r.text)

        # ── the look ─────────────────────────────────────────────────────────
        print("\n== the look ==")
        # setTemplate merges. The first version replaced both bags and wiped the name, the
        # address and the hours of any restaurant that picked a look in setup.
        r = sb.patch(tok, "tenants", {"settings": {"site_name": "Check Cafe",
                                                   "site_address": "1 Test St"}},
                     id=f"eq.{tenant_id}")
        check("settings can be written", r.ok, r.text[:120])
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select settings from tenants where id = %s", (tenant_id,))
            before = cur.fetchone()[0]
        r = sb.patch(tok, "tenants", {"template_id": "elegant_black",
                                      "settings": {**before, "template_key": "elegant_black"}},
                     id=f"eq.{tenant_id}")
        check("a template switch keeps the settings",
              r.ok and r.json()[0]["settings"].get("site_address") == "1 Test St")
        r = requests.get(f"{MENU}/{slug}", timeout=60)
        check("and the diner page follows it", 'data-template="elegant_black"' in r.text)

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("""select slug, (select count(*) from jsonb_object_keys(settings))
                             from tenants where slug in ('mg', 'corner')""")
            counts = dict(cur.fetchall())
            check("Monday Greens and Corner still have their settings",
                  all(n >= 20 for n in counts.values()), str(counts))

            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from menu.render_theme_keys import PALETTE_KEYS

            def bare(k):
                return k[6:] if k.startswith("night_") else k[4:] if k.startswith("day_") else k
            cur.execute("select slug, theme, settings from tenants")
            bad_t, bad_s = [], []
            for s_, theme, settings in cur.fetchall():
                bad_t += [f"{s_}.{k}" for k in (theme or {}) if bare(k) not in PALETTE_KEYS]
                bad_s += [f"{s_}.{k}" for k in (settings or {}) if bare(k) in PALETTE_KEYS]
            check("no restaurant has a non-colour in its palette", not bad_t, str(bad_t[:5]))
            check("and no colour stranded in its settings", not bad_s, str(bad_s[:5]))

        # ── 3D ───────────────────────────────────────────────────────────────
        print("\n== 3D ==")
        r = sb.post(tok, "model_requests", {
            "tenant_id": str(tenant_id), "item_id": item_id, "dish": item_id,
            "title": "Khachapuri",
            "photo_keys": [f"t/x/capture/aaaa-{a}.jpg" for a in ("front", "right", "back", "left")],
        })
        req = r.json()[0] if r.ok else {}
        check("a 3D model can be asked for", r.ok, r.text[:120])
        check("and is approved automatically while under quota",
              req.get("state") == "approved", str(req.get("state")))

        r = sb.post(tok, "model_requests", {
            "tenant_id": str(tenant_id), "item_id": item_id, "dish": item_id,
            "photo_keys": ["t/x/capture/bbbb-front.jpg"]})
        check("asking twice for the same dish is refused", r.status_code == 409,
              f"HTTP {r.status_code}")

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            def as_user(uid, sql, args=()):
                cur.execute("savepoint probe")
                cur.execute("select set_config('request.jwt.claims', %s, true)",
                            ('{"sub": "%s", "role": "authenticated"}' % uid,))
                cur.execute("set local role authenticated")
                try:
                    cur.execute(sql, args)
                    out, err = (cur.fetchall() if cur.description else []), None
                except Exception as exc:                          # noqa: BLE001
                    out, err = None, str(exc).splitlines()[0]
                cur.execute("rollback to savepoint probe")
                cur.execute("reset role")
                return out, err

            rid = req.get("id")
            _, err = as_user(owner_id, "update model_requests set state = 'approved' "
                                       "where id = %s returning id", (rid,))
            check("an owner CANNOT approve their own request", err is not None,
                  "an owner could set off a 30-credit generation at will")
            _, err = as_user(owner_id, "update model_requests set credits = 0 "
                                       "where id = %s returning id", (rid,))
            check("an owner cannot rewrite what an engine reported", err is not None)
            _, err = as_user(owner_id, "update model_requests set state = 'cancelled' "
                                       "where id = %s returning id", (rid,))
            check("an owner CAN withdraw their own request", err is None, str(err))
            rows, _ = as_user(other_id, "select id from model_requests where id = %s", (rid,))
            check("a stranger cannot see someone else's request", not rows)

            cur.execute("update tenants set model_quota = 0 where id = %s", (tenant_id,))
            conn.commit()

        r = sb.post(tok, "model_requests", {
            "tenant_id": str(tenant_id), "dish": str(uuid.uuid4()), "title": "Over",
            "photo_keys": ["t/x/capture/cccc-front.jpg"]})
        check("over quota, a request waits for us instead of running",
              r.ok and r.json()[0]["state"] == "pending", r.text[:120])

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("""insert into models (tenant_id, title, dish, variant, draco_key)
                           values (%s, 'Probe', 'probe', 'default', 'catalog/x.glb')
                           returning id""", (tenant_id,))
            model_id = str(cur.fetchone()[0])
            conn.commit()

        r = sb.patch(tok, "models", {"tenant_state": "approved"}, id=f"eq.{model_id}")
        check("the owner can approve a model", r.ok and r.json()[0]["tenant_state"] == "approved")
        r = sb.patch(tok, "models", {"view_orbit": "45 60 110"}, id=f"eq.{model_id}")
        check("and set its starting angle", r.ok and r.json()[0]["view_orbit"] == "45 60 110")
        r = sb.patch(tok, "items", {"model_id": model_id}, id=f"eq.{item_id}")
        check("and attach it to a dish", r.ok and r.json()[0]["model_id"] == model_id)
        r = sb.get(tok, "items", tenant_id=f"eq.{tenant_id}", select=SELECT)
        joined = [x for x in r.json() if x.get("models")] if r.ok else []
        check("the dish carries its model through the embed", joined)

        r = sb.patch(otok, "models", {"tenant_state": "rejected"}, id=f"eq.{model_id}")
        check("a stranger cannot touch someone else's model", (not r.ok) or r.json() == [])
        r = sb.rpc(tok, "model_requests_used", {"t": str(tenant_id)})
        check("an owner can read their own usage", r.ok and isinstance(r.json(), int))

        # ── the studio: photos, multiview, size, resize ──────────────────────
        print("\n== the studio ==")
        # The photo library. A frame is a row now, not just a key inside one request, so
        # an owner can close the tab and come back to it.
        r = sb.post(tok, "captures", {"tenant_id": str(tenant_id), "dish": item_id,
                                      "variant": "default", "slot": 0,
                                      "key": f"t/{tenant_id}/photo/f1-front.jpg"})
        cap = r.json()[0] if r.ok else {}
        check("a photo lands in the library", r.ok and cap.get("slot") == 0, r.text[:120])
        # on_conflict names the unique key, exactly as supabase-js sends it for saveCapture.
        r = requests.post(f"{url}/rest/v1/captures", timeout=30,
                          params={"on_conflict": "tenant_id,dish,variant,slot"},
                          headers=sb._h(tok, Prefer="return=representation,resolution=merge-duplicates"),
                          json={"tenant_id": str(tenant_id), "dish": item_id,
                                "variant": "default", "slot": 0,
                                "key": f"t/{tenant_id}/photo/f2-front.jpg"})
        check("replacing the front photo is an upsert, not a second row",
              r.ok and r.json()[0]["key"].endswith("f2-front.jpg"), r.text[:120])
        r = sb.get(tok, "captures", tenant_id=f"eq.{tenant_id}", select="slot,key")
        check("and the library holds exactly one frame for that slot",
              r.ok and len(r.json()) == 1, r.text[:120])
        r = sb.get(otok, "captures", tenant_id=f"eq.{tenant_id}", select="id")
        check("a stranger sees none of it", r.ok and r.json() == [])

        # Multiview: once per dish, and once means once - a failed one still counts.
        r = sb.post(tok, "capture_tasks", {"tenant_id": str(tenant_id), "dish": item_id,
                                           "variant": "default", "source_slot": 0,
                                           "state": "done", "credits": 99})
        task = r.json()[0] if r.ok else {}
        check("the other angles can be asked for", r.ok, r.text[:120])
        check("and the client did not get to pick the state or the cost",
              task.get("state") == "queued" and task.get("credits") == 0, str(task))
        r = sb.post(tok, "capture_tasks", {"tenant_id": str(tenant_id), "dish": item_id,
                                           "variant": "default", "source_slot": 0})
        check("a second multiview for the same dish is refused", r.status_code == 409,
              f"HTTP {r.status_code}")
        r = sb.patch(tok, "capture_tasks", {"state": "done"}, id=f"eq.{task.get('id')}")
        check("an owner cannot mark their own multiview done", (not r.ok) or r.json() == [])

        # The size travels with the request, and a resize is free.
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("update tenants set model_quota = 3 where id = %s", (tenant_id,))
            cur.execute("delete from model_requests where tenant_id = %s", (tenant_id,))
            conn.commit()
        # Three numbers in, the way a person says it. Which one the engine bakes is the
        # trigger's choice - width first - so a client sends the three and never a primary.
        r = sb.post(tok, "model_requests", {
            "tenant_id": str(tenant_id), "item_id": item_id, "dish": item_id,
            "title": "Khachapuri", "photo_keys": [f"t/{tenant_id}/photo/f2-front.jpg"],
            "width_cm": 28, "length_cm": 26, "height_cm": 3})
        gen = r.json()[0] if r.ok else {}
        check("a build carries width, length and height", r.ok
              and float(gen.get("width_cm") or 0) == 28 and float(gen.get("height_cm") or 0) == 3,
              r.text[:160])
        check("and the engine's primary is derived, width first",
              float(gen.get("scale_cm") or 0) == 28 and gen.get("scale_axis") == "width",
              f"{gen.get('scale_cm')} {gen.get('scale_axis')}")
        r = sb.post(tok, "model_requests", {
            "tenant_id": str(tenant_id), "dish": str(uuid.uuid4()), "title": "Tall thing",
            "photo_keys": ["t/x/capture/dddd-front.jpg"], "height_cm": 12})
        tall = r.json()[0] if r.ok else {}
        check("height alone becomes the primary when it is all there is",
              r.ok and tall.get("scale_axis") == "height" and float(tall.get("scale_cm") or 0) == 12,
              r.text[:120])
        r = sb.post(tok, "model_requests", {
            "tenant_id": str(tenant_id), "item_id": item_id, "dish": item_id,
            "title": "Khachapuri", "photo_keys": [], "kind": "rescale",
            "width_cm": 32})
        resc = r.json()[0] if r.ok else {}
        check("a resize can be asked for while a build is open - different work",
              r.ok and resc.get("kind") == "rescale", r.text[:120])
        check("and it is approved outright, quota or not", resc.get("state") == "approved")
        r = sb.rpc(tok, "model_requests_used", {"t": str(tenant_id)})
        check("a resize does not count against the free models",
              r.ok and r.json() == 2, r.text[:60])

        # Hiding, not deleting.
        r = sb.patch(tok, "models", {"archived": True}, id=f"eq.{model_id}")
        check("a model can be hidden", r.ok and r.json()[0]["archived"] is True)
        r = sb.get(tok, "models", id=f"eq.{model_id}", select="id")
        check("and it still exists", r.ok and len(r.json()) == 1)

        # ── the team ─────────────────────────────────────────────────────────
        print("\n== the team ==")
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            _, err = as_user(other_id, "select add_tenant_member(%s, %s, 'owner')",
                             (str(tenant_id), other_id))
            check("a stranger cannot add themselves to a restaurant", err is not None)
            _, err = as_user(owner_id, "select add_tenant_member(%s, %s, 'staff')",
                             (str(tenant_id), other_id))
            check("an owner CAN add somebody to their own", err is None, str(err))
            _, err = as_user(owner_id, "select remove_tenant_member(%s, %s)",
                             (str(tenant_id), owner_id))
            check("the last person cannot remove themselves", err is not None)
            cur.execute("""insert into tenant_members (tenant_id, user_id, role)
                           values (%s, %s, 'staff') on conflict do nothing""",
                        (tenant_id, other_id))
            conn.commit()
            rows, _ = as_user(owner_id,
                              "select user_id from tenant_members where tenant_id = %s",
                              (str(tenant_id),))
            check("an owner sees everyone in their restaurant", bool(rows) and len(rows) == 2)
            cur.execute("delete from tenant_members where tenant_id = %s and user_id = %s",
                        (tenant_id, other_id))
            conn.commit()

        invite_mail = f"check-inv-{uuid.uuid4().hex[:8]}@betareal.test"
        r = owner.post(f"{ADMIN}/api/members", timeout=45,
                       json={"tenantId": str(tenant_id), "email": invite_mail, "role": "staff"})
        inv = r.json() if r.ok else {}
        if inv.get("userId"):
            created_users.append(inv["userId"])
        check("an owner can invite by email through the admin", r.ok and inv.get("link"),
              r.text[:160])
        check("and the link points at the admin, not at Supabase",
              str(inv.get("link", "")).startswith(f"{ADMIN}/set-password"), str(inv.get("link")))

        chosen = secrets.token_urlsafe(18)
        otp = str(inv.get("link", "")).split("token=")[-1].split("&")[0]
        fresh = requests.Session()
        r = fresh.post(f"{ADMIN}/api/set-password", timeout=45,
                       json={"token": otp, "email": invite_mail, "password": chosen})
        check("choosing a password works and signs them in",
              r.ok and any(c.startswith("sb-") for c in fresh.cookies.keys()), r.text[:160])
        r = requests.post(f"{ADMIN}/api/set-password", timeout=45,
                          json={"token": otp, "email": invite_mail, "password": chosen})
        check("the link cannot be used twice", not r.ok)
        check("and the chosen password signs in normally", sb.token(invite_mail, chosen))

        r = requests.delete(f"{ADMIN}/api/members", timeout=30,
                            params={"tenantId": str(tenant_id), "userId": owner_id})
        check("a signed-out visitor cannot remove anybody", r.status_code == 401,
              f"HTTP {r.status_code}")

        # ── the diners ───────────────────────────────────────────────────────
        print("\n== the diners ==")
        for session, events in (
            ("checksession0001", [{"name": "view"}, {"name": "hero_pass"},
                                  {"name": "item_open", "item": item_id},
                                  {"name": "ar_open", "item": item_id},
                                  {"name": "not_a_real_event"},
                                  {"name": "item_open", "item": str(uuid.uuid4())}]),
            ("checksession0002", [{"name": "view"}, {"name": "item_open", "item": item_id}]),
        ):
            r = requests.post(f"{MENU}/e", timeout=30,
                              json={"tenant": str(tenant_id), "session": session,
                                    "events": events})
            check(f"the menu accepts an anonymous beacon ({session[-1]})", r.status_code == 204)

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select name, count(*) from events where tenant_id = %s group by name",
                        (tenant_id,))
            got = dict(cur.fetchall())
            # 3 item_open from 2 sessions: one carried a dish id belonging to nobody, which
            # is stripped while the event stays - "somebody opened a dish" is still true.
            check("the funnel lands", got.get("view") == 2 and got.get("item_open") == 3
                  and got.get("ar_open") == 1, str(got))
            check("an event we do not recognise is dropped", "not_a_real_event" not in got)

        r = sb.rpc(tok, "event_funnel", {"p_tenant": str(tenant_id), "p_days": 30})
        f = {x["name"]: x for x in r.json()} if r.ok else {}
        check("the owner reads their funnel", r.ok, r.text[:120])
        check("and it counts sessions, not taps",
              f.get("item_open", {}).get("sessions") == 2 and f["item_open"]["hits"] == 3)
        r = sb.rpc(otok, "event_funnel", {"p_tenant": str(tenant_id), "p_days": 30})
        check("a stranger reading someone else's funnel gets nothing", r.ok and r.json() == [])
        r = sb.rpc(tok, "event_3d_lift", {"p_tenant": str(tenant_id), "p_days": 30})
        check("the number on the home screen is readable", r.ok and r.json(), r.text[:120])
        r = sb.post(tok, "events", {"tenant_id": str(tenant_id), "session": "x" * 12,
                                    "name": "view"}, prefer="return=minimal")
        check("even a signed-in owner cannot insert events directly", not r.ok)

        r = requests.get(f"{url}/rest/v1/tenants", timeout=30,
                         headers={"apikey": service, "Authorization": f"Bearer {service}"},
                         params={"select": "id"})
        check("the service key still cannot read tenants over the API", r.status_code == 403)

    finally:
        try:
            with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
                if slug:
                    cur.execute("delete from tenants where slug = %s", (slug,))
                if code:
                    cur.execute("delete from invites where code = %s", (code,))
                conn.commit()
        except Exception as exc:                                  # noqa: BLE001
            print(f"  (could not clean up: {exc})")
        for uid in created_users:
            sb.drop_user(uid)

    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
