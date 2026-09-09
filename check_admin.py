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

import base64
import json
import os
import re
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

    def find_user(self, email: str):
        """The account for an address, or None. Service key, on auth.users only."""
        r = requests.get(f"{self.url}/auth/v1/admin/users", timeout=30,
                         headers=self._h(self.service),
                         params={"page": 1, "per_page": 1000})
        if not r.ok:
            return None
        return next((u for u in r.json().get("users", [])
                     if (u.get("email") or "").lower() == email.lower()), None)

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


# -- the bug this section exists for ---------------------------------------------------
#
# Twice in one day the admin collected something and then threw it away on save:
#
#   the model    an uploaded .glb went to R2 and no row ever pointed at it
#   the photo    `saveItem` had no `photo_key` in its row object, so every dish photo an
#                owner uploaded was orphaned in the bucket the moment they pressed Save
#
# Both look fine while you use them. The upload runs, the preview appears, the save says
# it worked - and the value is gone when the screen reloads. The second one was on the
# single thing a restaurant owner does most, and it survived every check in this repo,
# because every check reaches the database through PostgREST, where the COLUMN round-trips
# perfectly. The bug was four lines of TypeScript above it.
#
# So this reads the admin's own source and compares two sets: the columns its loader
# SELECTS out of `items`, and the columns its writer puts back. Anything read and never
# written is a field the screen can show and cannot save, and has to be named below with a
# reason. Adding a column to the loader and forgetting the writer turns this red.
#
# Static - no server, no database - and it runs first, because a failure here means
# everything after it is testing a product that cannot save.

# Not `ADMIN`: that is the admin's BASE URL, up at the top of this file, and shadowing
# it here turned "no admin at http://localhost:3001" into "no admin at C:\...\admin".
ADMIN_SRC = Path(__file__).with_name("admin")
ADMIN_DATA = ADMIN_SRC / "lib" / "data" / "menu.ts"
ADMIN_PAGE = ADMIN_SRC / "app" / "(admin)" / "menu" / "page.tsx"

#: Read out of `items` and deliberately never written straight back, each with its reason.
READ_ONLY_ITEM_COLUMNS = {
    "id": "the key - assigned by the database, used in the .eq() rather than the row",
    "i18n": "written, but rebuilt from name_ka/description_ka rather than copied",
    "models": "a join onto another table, not a column of items",
    "price_minor": "written through parsePrice(), which picks between this and price_text",
    "price_text": "the same, for a dish that no single integer can price",
    "tenant_id": "written on insert from the caller, never taken from the form",
}


#: Columns of `models` that only the engine ever writes. The admin shows them and must
#: not be able to edit them: they describe the FILE that was produced, and typing a
#: different number here would make the row disagree with the mesh it names.
MODEL_COLUMNS_THE_ENGINE_OWNS = {
    "draco_key": "the optimised GLB the pipeline wrote",
    "usdz_key": "its Quick Look twin, converted from the same master",
    "scale_cm": "the real-world size the mesh was actually baked to",
}


def saved_fields_survive() -> bool:
    """Everything the menu editor collects, it can also keep."""
    print("== what the menu editor collects, it keeps ==")
    src = ADMIN_DATA.read_text(encoding="utf-8")

    m = re.search(r"\.from\('items'\)\s*\n\s*\.select\((.*?)\)\s*\n", src, re.S)
    if not check("the menu editor's item query is where it was", m,
                 "loadMenu no longer selects from items the way this reads it"):
        return False
    select = " ".join(re.findall(r"'([^']*)'", m.group(1)))
    # The joined model's columns are a different table with different writers, so they are
    # pulled out and checked separately below rather than counted against saveItem.
    joined = re.search(r"models\s*\((.*?)\)", select)
    joined_cols = re.findall(r"[a-z_0-9]+", joined.group(1)) if joined else []
    selected = re.findall(r"[a-z_0-9]+", select[:joined.start()] if joined else select)

    m = re.search(r"export async function saveItem\b.*?const row = \{(.*?)\n  \}", src, re.S)
    if not check("saveItem still builds one row object", m):
        return False
    written = set(re.findall(r"^\s{4}([a-z_0-9]+):", m.group(1), re.M))
    written |= {"price_minor", "price_text"}          # spread in as ...price

    dropped = [c for c in selected if c not in written and c not in READ_ONLY_ITEM_COLUMNS]
    check("every column the editor reads, saveItem writes back", not dropped,
          "read and never saved: " + ", ".join(dropped))

    # The two that were actually broken, named individually so a regression reads as
    # itself rather than as a number going down.
    check("a dish photo has somewhere to be saved to", "photo_key" in written)
    check("and the form carries the key, not only the display URL",
          "photo_key: r.photo_key" in src and "photo_key: string" in src)

    page = ADMIN_PAGE.read_text(encoding="utf-8")
    check("the photo upload records the key it just wrote to R2",
          "photo_key: key" in page)
    check("and removing the photo clears both halves",
          "thumbnail_url: '', photo_key: ''" in page)

    # The AR multiplier lives on `models`, so it is not in the set above: it has its own
    # writer, and until today it had none at all - the input existed, accepted a number,
    # and wrote it nowhere.
    check("the AR scale on the item form reaches the model",
          "export async function saveItemScale" in src)
    check("and the screen actually calls it", "await saveItemScale(" in page)
    check("the item form no longer invents an AR scale of 1",
          "ar_scale: Number(model?.ar_scale" in src)

    # The other half of the same question, for the model the dish points at. `ar_scale`
    # was in exactly this position - read through the join, shown on a form, and written
    # by nothing - which is why the join gets its own pass rather than being waved
    # through as "another table's problem".
    data_layer = "\n".join(f.read_text(encoding="utf-8")
                           for f in sorted((ADMIN_SRC / "lib" / "data").glob("*.ts")))
    orphans = []
    for col in joined_cols:
        if col in MODEL_COLUMNS_THE_ENGINE_OWNS or col == "id":
            continue
        # A writer is this column appearing on the left of a colon inside an .update().
        if not re.search(r"\.update\(\s*\{[^}]*\b" + col + r"\s*:", data_layer, re.S):
            orphans.append(col)
    check("every model field the editor shows, the editor can change", not orphans,
          "shown and unwritable: " + ", ".join(orphans))

    check("no screen throws away an error a save handed it", not errors_ignored(),
          "; ".join(errors_ignored()))
    print()
    return True


# -- the second half of the same question -------------------------------------------
#
# A write can also be persisted correctly and then reported wrongly, which is worse than
# a silent failure because it destroys the recovery path. The theme editor did exactly
# this: `save()` discarded the error from `saveThemeConfig` and then did three things that
# each ASSERT the write happened - moved the saved snapshot, which makes `dirty` false,
# which disarms both leave guards and greys out the Save button, and then said "Saved".
# An owner whose token had expired would have spent twenty minutes on a palette, been told
# it was safe, walked out past two warnings that no longer fired, and found the old
# colours on reload. The draft only ever lived in React state.
#
# So: a data-layer call that RETURNS an error must have that return value bound to
# something. Anything discarded is listed below with the reason it is safe to discard.

#: `await someCall(...)` whose result is deliberately dropped, and why.
ERRORS_SAFE_TO_IGNORE = {
    "setup/page.tsx": "setup_done only decides whether the wizard is shown again; "
                      "failing there would trap an owner on a wizard they finished",
}

WRITE_CALL = re.compile(
    r"^(?P<before>.*?)await\s+(?P<fn>save|set|create|delete|copy|reorder|redeem|approve)"
    r"[A-Z]\w*\(", re.M)


def errors_ignored() -> list[str]:
    """Screens that call a writer and look away."""
    bad = []
    for f in sorted((ADMIN_SRC / "app").rglob("*.tsx")) + \
             sorted((ADMIN_SRC / "components").rglob("*.tsx")):
        rel = f.as_posix().split("/app/")[-1].split("/components/")[-1]
        if any(rel.endswith(k) for k in ERRORS_SAFE_TO_IGNORE):
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            m = WRITE_CALL.match(line)
            # `createClient()` is the Supabase client factory, not a writer - it starts
            # every one of these calls and returns no error of its own.
            if not m or line[m.end() - len("createClient("):m.end()] == "createClient(":
                continue
            before = m.group("before").strip()
            # Bound to a name, folded into an expression, or returned - all fine. Bare
            # `await save…(` at the start of a statement is the shape that loses errors.
            if before.endswith(("=", "||", "&&", "?", ":", "return", "(", ",")):
                continue
            bad.append(f"{rel}:{n}")
    return bad



# -- what an owner is told when a generation fails ------------------------------------
#
# It had never happened in production - one request has ever been made and it worked - so
# this whole path was written and never seen. What it did:
#
#   the panel headed "Building" listed the failure alongside things that really were
#   building, and rendered at all whenever any request existed, so a restaurant whose one
#   generation had failed saw an animated dish under the word Building, forever
#
#   the reason was `hidden md:inline`, so on a PHONE - which is what an owner has in their
#   hand - it said "did not work" and nothing else
#
#   the only control on the row, Cancel, was hidden precisely for failed rows
#
# The trap is in that last one. The obvious fix is a Dismiss button, and Dismiss would
# have to set the state to 'cancelled' because that is the only state an owner may write.
# `model_requests_used` counts everything EXCEPT 'cancelled'. So Dismiss would refund the
# generation - the retry loop the schema comment in 0007 says must not exist. There is no
# dismiss. The row stays, the cost is stated, and putting a slot back is a super admin
# raising the quota, which is a decision by a person who knows whose fault it was.

def failed_requests_read_honestly() -> None:
    print("== a generation that failed says so, and says what it cost ==")
    raw = (ADMIN_SRC / "app" / "(admin)" / "models" / "page.tsx").read_text(encoding="utf-8")
    # Comments out first. The check below asks whether the SCREEN hides the reason on a
    # phone, and the comment explaining that it used to would otherwise answer for it.
    page = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    page = re.sub(r"^\s*//.*$", "", page, flags=re.M)

    check("a failure is not listed under 'Building'",
          "const inFlight = requests.filter(r => r.state !== 'failed')" in page
          and "{inFlight.map(r => (" in page)
    check("it gets a heading that is true", '"eyebrow mb-3">Did not work<' in page.replace("'", '"')
          or ">Did not work<" in page)
    check("the reason is on screen on a phone too",
          'hidden md:inline' not in page)
    check("the owner is told the attempt spent a model",
          "uses another of your free models" in page)

    # The one that must never be added back.
    tail = page.split(">Did not work<", 1)[-1] if ">Did not work<" in page else ""
    check("and there is no dismiss, which would refund the generation",
          "cancelRequest" not in tail)

    # The panel used to say "A few minutes." underneath, permanently, whether the request
    # was forty seconds or four hours old. Both ways it goes late have a cause worth
    # knowing: `approved` and unclaimed usually means no engine is running at all - it
    # launches from the Startup folder, so a machine that rebooted and was never logged
    # into has no worker - and `running` and silent means a wedged job or a callback that
    # never arrived. Neither the owner nor we had any sign of it; the first symptom was
    # somebody asking where their model went.
    check("a request that is taking too long says so", "STALE_MINUTES" in page)
    check("...and shows how long it has actually been", "howLong(minutesSince(" in page)
    check("...with a line that stops claiming it is a few minutes",
          "taking longer than it should" in page)
    check("...and tells the owner nothing was lost or double charged",
          "nothing has been charged twice" in page)
    # `pending` is waiting for a human to approve it, which is a decision, not a symptom.
    check("but a request waiting on US is not called late",
          "r.state !== 'pending'" in page)

    # The same question on the developer side, where the rule was backwards. The queue
    # warned only on `pending` - the one state legitimately waiting on a human - and said
    # nothing about `approved` or `running`, which are the two that mean the engine is
    # broken. A request could sit approved for six hours on the screen whose stated
    # purpose is making stuck work impossible to miss.
    dev = (ADMIN_SRC / "app" / "(admin)" / "dev-analytics"
           / "page.tsx").read_text(encoding="utf-8")
    check("the developer queue flags a request no engine has claimed",
          "function lateness(" in dev and "'approved' || q.state === 'running'" in dev)
    check("...and still flags one that is waiting on us", "'pending' ? 60" in dev)
    check("...naming which of the two it is", "no engine?" in dev and "waiting on us" in dev)
    print()


def browser_for(sb: "Supa", email: str, password: str) -> requests.Session | None:
    """A signed-in browser session for anybody.

    The Next routes authenticate by COOKIE, and the run only has one cookie jar - the
    owner's, from `/api/signup`. Testing what a route does for somebody who is NOT that
    owner needs a second one, so the session is fetched from Supabase and written into the
    cookie `@supabase/ssr` reads: `sb-<project ref>-auth-token`, holding `base64-` and then
    the session as JSON. That is the format the library writes; if it ever changes, the
    checks that use this go red rather than quietly passing.
    """
    r = requests.post(f"{sb.url}/auth/v1/token", params={"grant_type": "password"},
                      timeout=30,
                      headers={"apikey": sb.anon, "Content-Type": "application/json"},
                      json={"email": email, "password": password})
    if not r.ok:
        return None
    ref = sb.url.split("://", 1)[1].split(".", 1)[0]
    blob = base64.b64encode(json.dumps(r.json()).encode()).decode()
    sess = requests.Session()
    sess.cookies.set(f"sb-{ref}-auth-token", "base64-" + blob)
    return sess



# -- which routes can bypass RLS, and why each one is allowed to -----------------------
#
# `createAdminClient()` is the service key: it ignores every policy in the database. A
# route holding it has to authorise its own caller, and `/api/members` showed how that
# goes wrong in a way no policy can catch - it authorised correctly and did so AFTER
# creating an account with the service key, leaving the account behind on the refusal.
#
# So the set is pinned. Adding a route that reaches for the service key turns this red and
# the author has to come here and say how it decides who is asking. That is the whole
# point: the failure mode is not a missing check, it is a check in the wrong place, and
# the only reliable moment to notice is when the route is written.
#
# Four more used to be in this list and are gone: /api/branches, /api/tenants,
# /api/admin-links and /api/account-log, which had zero call sites and belonged to a
# schema - brands, restaurants, integer ids - whose tables do not exist.

PRIVILEGED_ROUTES = {
    "members": "authorises first: reads the tenant AS THE CALLER, which `tenants_read` "
               "limits to is_member_of(id), before the service key touches anything, and "
               "then writes through add_tenant_member as the caller too",
    "signup":  "deliberately unauthenticated - it is how somebody gets an account. The "
               "gate is the invite code, checked before the account is made",
}


def privileged_routes_are_the_ones_we_meant() -> None:
    print("== only these routes may bypass RLS ==")
    api = ADMIN_SRC / "app" / "api"
    holding = set()
    for f in sorted(api.rglob("route.ts")):
        if "createAdminClient" in f.read_text(encoding="utf-8"):
            holding.add(f.parent.relative_to(api).as_posix())

    unexpected = sorted(holding - set(PRIVILEGED_ROUTES))
    check("no route has quietly taken the service key", not unexpected,
          "new and unexplained: " + ", ".join(unexpected))

    gone = sorted(set(PRIVILEGED_ROUTES) - holding)
    check("and every route named here still exists", not gone,
          "named but not found: " + ", ".join(gone))
    print()


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

    if not saved_fields_survive():
        return 1
    failed_requests_read_honestly()
    privileged_routes_are_the_ones_we_meant()
    print(f"The product  (menu {MENU}, admin {ADMIN})\n")

    owner_id = other_id = None
    code = slug = None
    copy_slug = None
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
                     "/history", "/share", "/setup", "/dev-analytics", "/account"):
            r = requests.get(f"{ADMIN}{path}", timeout=20, allow_redirects=False)
            check(f"signed out, {path} redirects to login", r.status_code in (302, 307),
                  f"got {r.status_code}")
        for path in ("/login", "/start", "/set-password"):
            r = requests.get(f"{ADMIN}{path}", timeout=20, allow_redirects=False)
            check(f"{path} is reachable signed out", r.status_code == 200, f"got {r.status_code}")
        for path in ("/home", "/menu", "/theme", "/models", "/dashboard", "/share",
                     "/setup", "/account"):
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

        # The preview is the REAL page with the palette posted in, not a mock of it. That
        # is the whole accuracy claim, so it is checked on the served bytes: present in
        # preview, absent for a diner, and locked to an origin we name.
        prev = requests.get(f"{MENU}/{slug}?preview=1", timeout=60).text
        plain = requests.get(f"{MENU}/{slug}", timeout=60).text
        check("the preview listener is on the page in preview mode", "br-theme" in prev)
        check("and is absent from a diner's page entirely", "br-theme" not in plain,
              "any window with a handle on the page could repaint it")
        check("it only accepts messages from an origin we name",
              "ALLOWED.indexOf(e.origin)" in prev)
        check("and applies nothing but custom properties",
              'k.slice(0, 2) !== "--"' in prev)
        # Click-to-edit: tapping the menu opens the row that governs that colour. The map
        # is posted in from lib/palette.ts, which also owns the label and the grouping, so
        # a row cannot describe a colour it no longer changes.
        check("the preview takes a click map and reports picks",
              "br-pick-map" in prev and "br-preview-pick" in prev)
        check("and neither reaches a diner's page",
              "br-pick-map" not in plain and "br-preview-pick" not in plain)

        # Only templates we can actually RENDER may be offered. The editor used to list 22
        # presets as "templates" while app/src/lib/css/ held two stylesheets, so picking
        # one of the other twenty set a key the renderer silently fell back from - and the
        # old mock preview showed the preset's colours regardless, so the preview and the
        # published page disagreed with nobody to notice.
        shipped = set(json.loads((Path(__file__).resolve().parent / "app" / "src" / "lib"
                                  / "css" / "index.json").read_text())["templates"])
        r = sb.get(tok, "templates", listed="eq.true", select="id")
        offered = {row["id"] for row in r.json()} if r.ok else set()
        check("every template on offer has a stylesheet we ship", offered <= shipped,
              f"offered without CSS: {sorted(offered - shipped)}")

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

            # Why the Studio has no "dismiss" on a failed generation.
            #
            # An owner may write exactly one column, `state`, and exactly two values,
            # 'pending' and 'cancelled'. So any dismiss button has to cancel - and
            # `model_requests_used` counts every state EXCEPT 'cancelled'. A dismiss would
            # therefore hand back the generation it just spent, which is the retry loop
            # 0007 was written to prevent. Proven here rather than argued, because the
            # next person to look at that screen will see a dead-end row and reach for
            # the obvious fix.
            cur.execute("update model_requests set state = 'failed', "
                        "note = 'check_admin' where id = %s", (rid,))
            cur.execute("select model_requests_used(%s)", (tenant_id,))
            before = cur.fetchone()[0]
            _, err = as_user(owner_id, "update model_requests set state = 'cancelled' "
                                       "where id = %s returning id", (rid,))
            check("an owner may cancel a request that has already failed", err is None,
                  str(err))
            cur.execute("update model_requests set state = 'cancelled' where id = %s",
                        (rid,))
            cur.execute("select model_requests_used(%s)", (tenant_id,))
            after = cur.fetchone()[0]
            check("and doing so refunds the generation, which is why no button does it",
                  after == before - 1, f"used went {before} -> {after}")
            cur.execute("update model_requests set state = 'approved', note = '' "
                        "where id = %s", (rid,))
            conn.commit()

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

        # ── the free-model limit is ours, not theirs ─────────────────────────
        #
        # `tenants_write` is `using (is_member_of(id))` and `authenticated` held a
        # TABLE-level UPDATE grant, so until 0018 an owner could raise their own
        # `model_quota` from the browser with the anon key - the one number standing
        # between a client and our Meshy credits, and the exact column
        # `model_request_gate()` reads to decide whether a request is approved or comes to
        # us. `slug` was writable the same way, and that is the address on every QR code
        # already printed and stuck to a table.
        #
        # RLS could not fix it: a policy is per-ROW and cannot say "this row, not that
        # column". Column privileges can, so the checks below are on the GRANT.
        r = sb.patch(tok, "tenants", {"model_quota": 999}, id=f"eq.{tenant_id}")
        check("an owner cannot raise their own free-model limit", not r.ok,
              f"HTTP {r.status_code} {r.text[:80]}")
        r = sb.patch(tok, "tenants", {"slug": "stolen-slug"}, id=f"eq.{tenant_id}")
        check("nor change the address on their printed QR codes", not r.ok,
              f"HTTP {r.status_code}")
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select model_quota, slug from tenants where id = %s", (tenant_id,))
            q, sl = cur.fetchone()
            check("...and neither actually moved", q != 999 and sl != "stolen-slug",
                  f"quota {q}, slug {sl}")
        # The things they SHOULD still be able to change, because locking the two above by
        # revoking the table grant could easily have taken these with it.
        r = sb.patch(tok, "tenants", {"settings": {"site_name": "Check Cafe"}},
                     id=f"eq.{tenant_id}")
        check("an owner can still edit their own settings", r.ok, r.text[:80])
        r = sb.patch(tok, "tenants", {"template_id": "plain"}, id=f"eq.{tenant_id}")
        check("...and still change their template", r.ok, r.text[:80])

        r = sb.rpc(tok, "set_model_quota", {"p_tenant": str(tenant_id), "p_quota": 25})
        check("an owner calling set_model_quota is refused", not r.ok,
              f"HTTP {r.status_code}")
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("insert into super_admins (user_id) values (%s) "
                        "on conflict do nothing", (owner_id,))
            conn.commit()
        r = sb.rpc(tok, "set_model_quota", {"p_tenant": str(tenant_id), "p_quota": 25})
        check("a super admin can set it", r.ok and r.json() == 25, r.text[:80])
        r = sb.rpc(tok, "set_model_quota", {"p_tenant": str(tenant_id), "p_quota": 5000})
        check("...but not to a number nobody typed on purpose", not r.ok,
              f"HTTP {r.status_code}")
        # Read back through `admin_overview()` (0014), which is the one place a super
        # admin sees every restaurant's numbers - and the same `model_requests_used()` the
        # approval gate calls, so the screen cannot disagree with the rule.
        r = sb.rpc(tok, "admin_overview", {})
        row = next((x for x in (r.json() if r.ok else [])
                    if x.get("tenant_id") == str(tenant_id)), {})
        check("the developer overview shows the new limit and what is used",
              row.get("quota") == 25 and row.get("quota_used") == 2, str(row)[:140])
        # ── copying a restaurant, so testing never lands on a client ─────────
        #
        # Why it exists: there are two live restaurants and a two-dish demo, so every
        # experiment - reordering 170 items, a template change, the language switch - has
        # had to run against a paying client or against something that exercises nothing.
        #
        # Most of these checks are about what it must NOT carry over. A copy that brings
        # the quota brings permission to spend our credits into the one place somebody
        # presses Build without thinking; one that brings the events reports somebody
        # else's diners as its own.
        r = sb.rpc(tok, "copy_tenant", {"p_source": str(tenant_id)})
        made = (r.json() or [{}])[0] if r.ok else {}
        copy_slug = made.get("slug")
        check("a super admin can copy a restaurant", r.ok and copy_slug, r.text[:140])
        check("...to a slug that says it is a copy and is not the original",
              (copy_slug or "").startswith(slug) and copy_slug != slug, str(copy_slug))

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select id, model_quota, setup_done, name, template_id, theme "
                        "from tenants where slug = %s", (copy_slug,))
            cid, cq, cdone, cname, ctpl, ctheme = cur.fetchone()
            cur.execute("select template_id, theme from tenants where id = %s", (tenant_id,))
            stpl, stheme = cur.fetchone()
            check("the copy gets ZERO free models", cq == 0, str(cq))
            check("and opens on setup, like a real new restaurant", cdone is False)
            check("and looks like the original", ctpl == stpl and ctheme == stheme)
            check("and is named so nobody edits the wrong one", "(copy)" in (cname or ""))

            for table, one in (("categories", "category"), ("items", "dish"),
                               ("models", "model")):
                cur.execute(f"select count(*) from {table} where tenant_id = %s", (tenant_id,))
                a = cur.fetchone()[0]
                cur.execute(f"select count(*) from {table} where tenant_id = %s", (cid,))
                b = cur.fetchone()[0]
                check(f"every {one} came across", a == b and a > 0, f"{a} -> {b}")

            # The part most likely to be wrong, and silently: an item in the copy must
            # point at the COPY's category and the COPY's model, never back at the
            # original's. A cross-tenant pointer renders as a dish with no category and no
            # 3D, which reads as bad data rather than as a bad copy.
            cur.execute(
                "select count(*) from items i where i.tenant_id = %s "
                "and i.category_id is not null and not exists ("
                "  select 1 from categories c where c.id = i.category_id and c.tenant_id = %s)",
                (cid, cid))
            check("no item points at a category outside the copy", cur.fetchone()[0] == 0)
            cur.execute(
                "select count(*) from items i where i.tenant_id = %s "
                "and i.model_id is not null and not exists ("
                "  select 1 from models m where m.id = i.model_id and m.tenant_id = %s)",
                (cid, cid))
            check("nor at a model outside it", cur.fetchone()[0] == 0)
            cur.execute("select count(*) from items where tenant_id = %s and model_id is not null",
                        (cid,))
            check("...and the 3D actually came with it", cur.fetchone()[0] > 0)

            # The same R2 objects, not copies of them. Duplicating a 4 MB file per test copy
            # would be the expensive way to be wrong.
            cur.execute(
                "select count(*) from models a join models b "
                "on a.draco_key is not distinct from b.draco_key "
                "where a.tenant_id = %s and b.tenant_id = %s and a.draco_key is not null",
                (tenant_id, cid))
            check("the copy shares the original's files rather than duplicating them",
                  cur.fetchone()[0] > 0)

            for table in ("events", "model_requests", "captures"):
                cur.execute(f"select count(*) from {table} where tenant_id = %s", (cid,))
                check(f"no {table} came across", cur.fetchone()[0] == 0)

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("delete from super_admins where user_id = %s", (owner_id,))
            conn.commit()
        r = sb.rpc(tok, "copy_tenant", {"p_source": str(tenant_id)})
        check("an owner cannot copy a restaurant", not r.ok, f"HTTP {r.status_code}")

        # Hiding, not deleting.
        r = sb.patch(tok, "models", {"archived": True}, id=f"eq.{model_id}")
        check("a model can be hidden", r.ok and r.json()[0]["archived"] is True)
        r = sb.get(tok, "models", id=f"eq.{model_id}", select="id")
        check("and it still exists", r.ok and len(r.json()) == 1)

        # ── uploads come back ────────────────────────────────────────────────
        # The ROUND TRIP, which is the only thing that catches the failure that actually
        # happened: hero videos were written to the models bucket and served from the
        # photos one, so every upload succeeded and every URL it returned was a 404. The
        # branding tab looked like it worked and the video never played.
        #
        # Through the real routes, with the owner's real session, then fetching the URL the
        # upload handed back.
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("insert into super_admins (user_id) values (%s) "
                        "on conflict do nothing", (owner_id,))
            conn.commit()

        # A structurally real MP4: ftyp box, then padding. Enough to store and serve.
        mp4 = (b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2mp41"
               + b"\x00\x00\x00\x08free" + b"\x00" * 4096)
        webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32

        for kind, blob, name, ctype in (
            ("video", mp4, "hero.mp4", "video/mp4"),
            ("hero", webp, "hero.webp", "image/webp"),
            ("logo", webp, "logo.webp", "image/webp"),
        ):
            sent = owner.post(f"{ADMIN}/api/asset", timeout=60,
                            files={"file": (name, blob, ctype)},
                            data={"kind": kind, "tenantId": str(tenant_id)})
            body = sent.json() if sent.ok else {}
            if not check(f"a {kind} uploads", sent.ok and body.get("url"), f"HTTP {sent.status_code} {sent.text[:200]!r}"):
                continue

            # The URL it handed back must actually serve the bytes. This is the assertion
            # that was missing.
            got = requests.get(body["url"], timeout=60)
            check(f"and the {kind} URL it returned actually serves",
                  got.status_code == 200 and len(got.content) == len(blob),
                  f"HTTP {got.status_code}, {len(got.content)} of {len(blob)} bytes")
            check(f"with the right content type for a {kind}",
                  got.headers.get("Content-Type") == ctype,
                  got.headers.get("Content-Type", "none"))

            if kind == "video":
                # Safari will not play a source that cannot answer a byte range: it asks
                # for one first and gives up on a plain 200.
                part = requests.get(body["url"], timeout=60, headers={"Range": "bytes=0-99"})
                check("and a video answers a byte range",
                      part.status_code == 206 and len(part.content) == 100,
                      f"HTTP {part.status_code}, {len(part.content)} bytes")
                check("naming the range it sent", "bytes 0-99/" in
                      (part.headers.get("Content-Range") or ""),
                      part.headers.get("Content-Range", "none"))

        # ── an uploaded model has to SURVIVE ─────────────────────────────────
        #
        # The item editor has had "Upload .glb" behind `canUploadModels` since it existed,
        # and it worked as far as R2: the file arrived, correctly typed and sized, and the
        # URL went into local form state. `saveItem` writes `model_id` and has never
        # written `model` - there is no such column - so every hand-uploaded model was paid
        # for in bandwidth and dropped on save, under a success message.
        #
        # A file in a bucket is not a model. The row is, so the row is what is checked.
        glb = b"glTF" + b"\x02\x00\x00\x00" + b"\x00" * 512
        sent = owner.post(f"{ADMIN}/api/asset", timeout=60,
                          files={"file": ("hand.glb", glb, "model/gltf-binary")},
                          data={"kind": "glb", "tenantId": str(tenant_id)})
        # `uploaded`, not `up` - `up()` is the module-level "is the server answering"
        # helper, and shadowing it here made the whole suite die on its second line.
        uploaded = sent.json() if sent.ok else {}
        check("a .glb we upload by hand reaches the bucket", sent.ok and uploaded.get("key"),
              sent.text[:140])
        check("...and the route hands back the KEY, not only a URL",
              bool(uploaded.get("key")) and not uploaded.get("key", "").startswith("http"),
              str(uploaded.get("key"))[:60])
        r = sb.post(tok, "models", {
            "tenant_id": str(tenant_id), "title": "Hand upload", "dish": str(item_id),
            "variant": "default", "draco_key": uploaded.get("key"), "tenant_state": "approved"})
        hand_model = (r.json() or [{}])[0].get("id") if r.ok else None
        check("a model row can be made from it", r.ok and hand_model, r.text[:140])
        r = sb.patch(tok, "items", {"model_id": hand_model}, id=f"eq.{item_id}")
        check("and a dish can point at it", r.ok, r.text[:120])
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select m.draco_key from items i join models m on m.id = i.model_id "
                        "where i.id = %s", (item_id,))
            row = cur.fetchone()
            check("the dish still has it after a round trip through the database",
                  row and row[0] == uploaded.get("key"), str(row))
        # Put the dish back where the later checks expect it.
        sb.patch(tok, "items", {"model_id": model_id}, id=f"eq.{item_id}")

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("delete from super_admins where user_id = %s", (owner_id,))
            conn.commit()

        # And with the super-admin row gone, the same upload is refused - the rule that
        # models and hero videos are ours, enforced server-side rather than by leaving a
        # button out of a screen.
        sent = owner.post(f"{ADMIN}/api/asset", timeout=60,
                        files={"file": ("hero.mp4", mp4, "video/mp4")},
                        data={"kind": "video", "tenantId": str(tenant_id)})
        check("an owner who is not us cannot upload a hero video", sent.status_code == 403,
              f"HTTP {sent.status_code}")
        sent = owner.post(f"{ADMIN}/api/asset", timeout=60,
                        files={"file": ("d.webp", webp, "image/webp")},
                        data={"kind": "photo", "tenantId": str(tenant_id)})
        check("but their own photos still go up", sent.ok, sent.text[:140])

        # ── the language bag has ONE shape ───────────────────────────────────
        #
        # `i18n` is a bag of language OBJECTS - {"ka": {"name": "…"}} - and every reader and
        # writer has to agree on that. One did not: the admin's category loader took
        # `i18n.ka`, which is the whole object, cast it to `Record<string, string>` so the
        # compiler would not complain, and put it straight into JSX. React threw "objects
        # are not valid as a React child" and the entire Menu Editor died.
        #
        # It died ONLY in Georgian - `categoryName` reads `name_ka` when lang is 'ka' and
        # `name_en` otherwise - and only for a restaurant whose categories have
        # translations. So it looked perfect in English and perfect on a two-dish test
        # tenant, and took out both real restaurants the moment the language was switched.
        #
        # Checked against the DATABASE, and by reading the loader as text, because the cast
        # is precisely what stopped TypeScript from seeing it. The compiler cannot be the
        # thing that catches a lie told to the compiler.
        # ── templates: a policy that could not fire ──────────────────────────
        #
        # `templates` had the right rules and none of the permission to use them:
        # `templates_write` is `is_super_admin()`, and `authenticated` was granted SELECT
        # and nothing else. A policy decides WHICH ROWS a grant may touch; it never grants
        # anything. So the write policy could not fire for anybody, and every save from a
        # template screen would have failed with a permission error naming the table rather
        # than the reason. 0021 added the grant.
        #
        # This is 0018's mismatch in the opposite direction - there a grant was wider than
        # the rule anybody intended, here it was narrower - and both are invisible until
        # somebody tries the thing. So both are checked by trying the thing.
        print("\n== templates ==")
        r = sb.get(tok, "templates", select="id,name,listed")
        seen = {t["id"] for t in (r.json() if r.ok else [])}
        check("an owner sees the templates they may choose from",
              r.ok and "monday_greens" in seen, r.text[:120])
        check("...and not the unlisted ones", "plain" not in seen, str(sorted(seen)))
        r = sb.patch(tok, "templates", {"listed": True}, id="eq.plain")
        listed_after = None
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("select listed from templates where id = 'plain'")
            listed_after = cur.fetchone()[0]
        check("an owner cannot offer themselves a hidden template", listed_after is False,
              f"HTTP {r.status_code}, listed now {listed_after}")
        r = sb.post(tok, "templates", {"id": "sneaky", "name": "Sneaky"})
        check("nor invent one", not r.ok, f"HTTP {r.status_code}")

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("insert into super_admins (user_id) values (%s) "
                        "on conflict do nothing", (owner_id,))
            conn.commit()
        r = sb.post(tok, "templates",
                    {"id": "check_tmpl", "name": "Check Template", "listed": False,
                     "defaults": {"day_bg": "#ffffff"}})
        check("a super admin can create a template", r.ok, r.text[:140])
        r = sb.patch(tok, "templates", {"name": "Check Template 2"}, id="eq.check_tmpl")
        check("...and rename it", r.ok, r.text[:120])
        r = sb.patch(tok, "templates", {"defaults": {"day_bg": "#eeeeee", "font_body": "Inter"}},
                     id="eq.check_tmpl")
        check("...and change the palette a new restaurant would start with", r.ok,
              r.text[:120])
        r = sb.get(tok, "templates", select="id,defaults", id="eq.check_tmpl")
        got = (r.json() or [{}])[0].get("defaults", {}) if r.ok else {}
        check("...and it is what comes back", got.get("font_body") == "Inter", str(got)[:80])
        r = requests.delete(f"{url}/rest/v1/templates?id=eq.check_tmpl", timeout=30,
                            headers={"apikey": anon, "Authorization": f"Bearer {tok}"})
        check("...and delete it again", r.ok, f"HTTP {r.status_code}")
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("delete from templates where id = 'check_tmpl'")
            cur.execute("delete from super_admins where user_id = %s", (owner_id,))
            conn.commit()

        print("\n== one shape for a translation ==")
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("""
                select count(*) filter (where jsonb_typeof(i18n->'ka') = 'string'), count(*)
                from categories where i18n ? 'ka'
            """)
            bare, total = cur.fetchone()
            check("every category translation is {ka:{name}}, never {ka:'text'}",
                  bare == 0, f"{bare} of {total} are a bare string")
            cur.execute("""
                select count(*) filter (where jsonb_typeof(i18n->'ka') = 'string'), count(*)
                from items where i18n ? 'ka'
            """)
            ibare, itotal = cur.fetchone()
            check("and so is every dish translation", ibare == 0,
                  f"{ibare} of {itotal} are a bare string")

        loader = (Path(__file__).resolve().parent / "admin" / "lib" / "data"
                  / "menu.ts").read_text(encoding="utf-8")
        check("the admin reads the name OUT of the language object",
              "?.ka?.name" in loader and "?.ka || ''" not in loader)
        check("...and writes it back in the same shape", "{ ka: { name:" in loader)

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

        # The same route, from somebody with no business in this restaurant.
        #
        # `add_tenant_member` is called as the signed-in user and has always refused
        # correctly, so nobody was ever added to a restaurant they had no right to. The
        # bug was the ORDER: the refusal came after the route had already created a
        # confirmed auth account with the service key, and that account stayed. Any
        # signed-in user could post a stranger's address with any tenant id, collect a
        # 403, and have made that address exist - which is not a takeover, but does take
        # the address out of circulation, because signup then fails with "already
        # registered".
        outsider_pw = secrets.token_urlsafe(18)
        outsider_mail = f"check-out-{uuid.uuid4().hex[:8]}@betareal.test"
        outsider_id = sb.make_user(outsider_mail, outsider_pw)
        if outsider_id:
            created_users.append(outsider_id)
        stranger_mail = f"check-nobody-{uuid.uuid4().hex[:8]}@betareal.test"
        browser = browser_for(sb, outsider_mail, outsider_pw)
        if check("a second browser session can be made", browser is not None):
            r = browser.post(f"{ADMIN}/api/members", timeout=45,
                             json={"tenantId": str(tenant_id), "email": stranger_mail,
                                   "role": "staff"})
            check("somebody outside the restaurant cannot add a member",
                  r.status_code == 403, f"HTTP {r.status_code} {r.text[:120]}")
            made = sb.find_user(stranger_mail)
            check("and the refusal leaves no account behind", made is None,
                  "an account was created for an address the caller had no right to name")
            if made:
                created_users.append(made["id"])

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

        # Time is minutes now, so "the last hour" is expressible - the question you ask on
        # the evening the QR codes go on the tables.
        r = sb.rpc(tok, "event_funnel", {"p_tenant": str(tenant_id), "p_minutes": 43200})
        f = {x["name"]: x for x in r.json()} if r.ok else {}
        check("the owner reads their funnel", r.ok, r.text[:120])
        check("and it counts sessions, not taps",
              f.get("item_open", {}).get("sessions") == 2 and f["item_open"]["hits"] == 3)
        r = sb.rpc(tok, "event_funnel", {"p_tenant": str(tenant_id), "p_minutes": 60})
        check("a one-hour window still sees just-now events", r.ok and r.json(), r.text[:120])
        r = sb.rpc(tok, "event_funnel", {"p_tenant": str(tenant_id), "p_minutes": 1})
        check("and the range genuinely filters", r.ok, r.text[:120])
        r = sb.rpc(otok, "event_funnel", {"p_tenant": str(tenant_id), "p_minutes": 43200})
        check("a stranger reading someone else's funnel gets nothing", r.ok and r.json() == [])
        r = sb.rpc(tok, "event_3d_lift", {"p_tenant": str(tenant_id), "p_minutes": 43200})
        check("the number on the home screen is readable", r.ok and r.json(), r.text[:120])
        r = sb.rpc(tok, "event_series", {"p_tenant": str(tenant_id), "p_minutes": 1440})
        check("the chart has points", r.ok and isinstance(r.json(), list), r.text[:120])

        # Per table. The QR codes have carried ?t=<n> since they were first generated, so
        # this needed no reprinting - only for the page to read it and the events to keep it.
        r = requests.post(f"{MENU}/e", timeout=30, json={
            "tenant": str(tenant_id), "session": "checktable000001",
            "events": [{"name": "view", "meta": {"t": "7"}},
                       {"name": "item_open", "item": item_id, "meta": {"t": "7"}}]})
        check("a beacon carrying a table number is accepted", r.status_code == 204)
        r = sb.rpc(tok, "event_by_table", {"p_tenant": str(tenant_id), "p_minutes": 43200})
        rows = {x["table_no"]: x for x in r.json()} if r.ok else {}
        check("the table shows up in its own row", r.ok and rows.get("7", {}).get("sessions") == 1,
              str(rows)[:180])
        check("and scans with no table are counted, not dropped",
              rows.get("\u2014", {}).get("sessions") == 2, str(rows)[:180])

        # The database can store it; this proves the PAGE SENDS it. Fetched from
        # /viewer.js, not from the page HTML - the diner page inlines its markup and CSS
        # but loads the interactive half as one cached script, and looking in the wrong
        # place is how a check passes while the feature does nothing.
        js = requests.get(f"{MENU}/viewer.js", timeout=60).text
        check("the diner page reads ?t= off the QR",
              'get("t")' in js and "meta.t = TABLE" in js,
              "the table number would never reach the sink")
        r = sb.post(tok, "events", {"tenant_id": str(tenant_id), "session": "x" * 12,
                                    "name": "view"}, prefer="return=minimal")
        check("even a signed-in owner cannot insert events directly", not r.ok)

        # ── ours, and only ours ─────────────────────────────────────────────
        # The developer view is scoped inside the function, so an owner reaching the URL
        # gets an empty set rather than an error that would confirm the function exists.
        r = sb.rpc(tok, "admin_overview", {"p_minutes": 43200})
        check("an owner calling the developer overview sees nothing",
              r.ok and r.json() == [], r.text[:140])
        r = sb.rpc(tok, "admin_queue", {})
        check("nor the queue", r.ok and r.json() == [], r.text[:140])

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("insert into super_admins (user_id) values (%s) "
                        "on conflict do nothing", (owner_id,))
            conn.commit()
        boss = sb.token(owner_mail, owner_pw)     # a fresh token, same person, now super
        r = sb.rpc(boss, "admin_overview", {"p_minutes": 43200})
        seen = r.json() if r.ok else []
        check("a super admin sees every restaurant", r.ok and len(seen) >= 1, r.text[:140])
        check("with the numbers the screen draws",
              bool(seen) and {"slug", "dishes", "models_draft", "sessions", "quota_used"}
              <= set(seen[0]), str(seen[:1])[:200])
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("delete from super_admins where user_id = %s", (owner_id,))
            conn.commit()

        r = requests.get(f"{url}/rest/v1/tenants", timeout=30,
                         headers={"apikey": service, "Authorization": f"Bearer {service}"},
                         params={"select": "id"})
        check("the service key still cannot read tenants over the API", r.status_code == 403)

        # ── what a diner's page is allowed to ask for ────────────────────────
        # The menu app holds the ANON key now, not a direct database connection, and it can
        # call exactly one function. These are the rules that function has to keep, because
        # nothing above it is checking them any more.
        anon_h = {"apikey": anon, "Authorization": f"Bearer {anon}",
                  "Content-Type": "application/json"}
        r = requests.post(f"{url}/rest/v1/rpc/public_menu", timeout=30, headers=anon_h,
                          json={"p_slug": slug})
        doc = r.json() if r.ok else None
        check("an anonymous caller can read a published menu", r.ok and doc and doc.get("tenant"),
              r.text[:140])
        names = [i["name"] for i in (doc or {}).get("items", [])]
        check("and it carries the dishes", "Khachapuri" in names, str(names)[:120])

        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("update items set visible = false where id = %s", (item_id,))
            cur.execute("update models set tenant_state = 'draft' where id = %s", (model_id,))
            conn.commit()
        r = requests.post(f"{url}/rest/v1/rpc/public_menu", timeout=30, headers=anon_h,
                          json={"p_slug": slug})
        doc = r.json() if r.ok else {}
        check("a hidden dish is not in it",
              "Khachapuri" not in [i["name"] for i in doc.get("items", [])])
        with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
            cur.execute("update items set visible = true where id = %s", (item_id,))
            conn.commit()
        r = requests.post(f"{url}/rest/v1/rpc/public_menu", timeout=30, headers=anon_h,
                          json={"p_slug": slug})
        doc = r.json() if r.ok else {}
        dish = next((i for i in doc.get("items", []) if i["name"] == "Khachapuri"), {})
        check("and an unapproved model is stripped from the dish that points at it",
              dish and dish.get("draco_key") is None,
              "a model nobody approved would have reached a diner")

        # The anon key may call that and nothing else.
        for table in ("tenants", "items", "models", "captures", "model_requests", "invites"):
            r = requests.get(f"{url}/rest/v1/{table}", timeout=30,
                             headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
                             params={"select": "id", "limit": "1"})
            rows = r.json() if r.ok else None
            check(f"anon reads nothing from {table}",
                  (not r.ok) or rows == [], f"HTTP {r.status_code} {str(rows)[:60]}")

    finally:
        try:
            with psycopg.connect(db, connect_timeout=25) as conn, conn.cursor() as cur:
                if slug:
                    cur.execute("delete from tenants where slug = %s", (slug,))
                if copy_slug:
                    cur.execute("delete from tenants where slug = %s", (copy_slug,))
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
