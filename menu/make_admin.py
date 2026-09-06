#!/usr/bin/env python3
"""Create an admin account and give it access to the restaurants.

    python menu/make_admin.py --email you@example.com
    python menu/make_admin.py --email you@example.com --tenants mg,corner

Prints a one-time link to OUR set-password page. Open it, choose a password, and you are
signed in. Running it again prints a fresh link, which is also how a password gets reset
until there is a button for it.

**No password is ever chosen here, printed here, or stored by us.** The platform has a
table of client passwords in cleartext and its own `ARCHITECTURE-DEBT.md` §1 calls it the
worst thing in that codebase; it is the one piece of its debt that must not come across.
Supabase holds the credential and we hold a token (see `app/src/lib/auth.js`).

There is no self-signup route in the app, deliberately - authorised accounts only while
the product is being proven (DECISIONS §9.3). This script is the only way an account
exists, and running it is a decision somebody makes on purpose.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import load_env                                   # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", required=True)
    ap.add_argument("--tenants", default="",
                    help="comma-separated slugs; default is every restaurant")
    ap.add_argument("--super", action="store_true",
                    help="also make them a super admin (sees every restaurant)")
    ap.add_argument("--base", default=os.environ.get("PUBLIC_ORIGIN",
                                                     "http://127.0.0.1:4321"),
                    help="where the admin is served from")
    a = ap.parse_args()

    load_env()
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    db = os.environ.get("SUPABASE_DB_URL", "")
    if not (url and key and db):
        print("Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_DB_URL in .env.")
        print("Check with: python preflight.py --supabase")
        return 1

    head = {"apikey": key, "Authorization": f"Bearer {key}"}

    # Already there? Creating twice is an error, and re-running this should be safe.
    found = requests.get(f"{url}/auth/v1/admin/users", headers=head,
                         params={"page": 1, "per_page": 200}, timeout=30)
    uid = None
    if found.ok:
        for u in found.json().get("users", []):
            if (u.get("email") or "").lower() == a.email.lower():
                uid = u["id"]
                print(f"  account already exists")
                break

    if not uid:
        made = requests.post(f"{url}/auth/v1/admin/users", headers=head, timeout=30,
                             json={"email": a.email, "email_confirm": True})
        if made.status_code >= 300:
            print(f"  could not create: HTTP {made.status_code} {made.text[:180]}")
            return 1
        uid = made.json()["id"]
        print(f"  account created")

    import psycopg
    with psycopg.connect(db, connect_timeout=20) as conn, conn.cursor() as cur:
        if a.tenants.strip():
            slugs = [s.strip() for s in a.tenants.split(",") if s.strip()]
            cur.execute("select id, slug, name from tenants where slug = any(%s)", (slugs,))
        else:
            cur.execute("select id, slug, name from tenants order by slug")
        rows = cur.fetchall()
        for tid, slug, name in rows:
            cur.execute("""
                insert into tenant_members (tenant_id, user_id, role)
                values (%s, %s, 'owner')
                on conflict (tenant_id, user_id) do nothing
            """, (tid, uid))
            print(f"  access to {name} (/{slug})")
        if a.super:
            cur.execute("""insert into super_admins (user_id) values (%s)
                           on conflict (user_id) do nothing""", (uid,))
            print("  super admin")
        conn.commit()

    # A one-time link rather than a password: they choose their own and it never exists
    # anywhere we can leak it.
    #
    # Supabase's own `action_link` is deliberately NOT what gets printed. That link bounces
    # through Supabase and lands on whatever Site URL the dashboard holds - out of the box
    # `http://localhost:3000`, which is somebody else's project entirely, and changing it
    # is a dashboard setting nobody will remember exists. The raw one-time token points at
    # OUR page instead, which exchanges it server-side. Nothing outside this repo decides
    # whether the link works.
    link = requests.post(f"{url}/auth/v1/admin/generate_link", headers=head, timeout=30,
                         json={"type": "recovery", "email": a.email})
    print()
    otp = link.json().get("email_otp") if link.ok else None
    if otp:
        target = (f"{a.base.rstrip('/')}/admin/set-password"
                  f"?token={otp}&email={quote(a.email)}")
        print("  Open this, choose a password, and you are in:\n")
        print(f"    {target}\n")
        print("  One use only, and it expires. Run this again for a new one - which is")
        print("  also how a password gets reset until there is a button for it.")
    else:
        print(f"  Account is ready, but no link could be made (HTTP {link.status_code}).")
        print("  Set a password from the Supabase dashboard, or run this again.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
