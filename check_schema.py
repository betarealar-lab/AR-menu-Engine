#!/usr/bin/env python3
"""The menu platform's schema, and whether its tenancy actually holds.

    python check_schema.py

Runs against the real Supabase project in `.env`. It creates two throwaway users, two
throwaway restaurants, and then tries to read one restaurant's data as the other's owner.
Everything it makes, it deletes.

**Why this is not just "did I remember to type ENABLE ROW LEVEL SECURITY".** That is the
structural half and it is checked here too, but a table can have RLS on, a policy
attached, and still leak - a policy with the wrong predicate is indistinguishable from a
correct one until somebody queries across a tenant boundary. MENU-PLATFORM §2.3 calls
retrofitting tenancy the kilometre miss; the only way to know it is not already missed is
to be the second restaurant and try.

Costs nothing. Touches no R2 bucket, spends no credits.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import load_env       # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []

# Tables that belong to a tenant and must never be readable across one.
OWNED = ["tenants", "tenant_members", "models", "categories", "items",
         "publications", "live_publication"]
ALL_TABLES = OWNED + ["templates", "super_admins"]


def check(name: str, ok, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


# ── the Supabase admin API, for making and unmaking test users ───────

def admin(method: str, path: str, url: str, key: str, **kw):
    return requests.request(method, f"{url}/auth/v1/admin{path}",
                            headers={"apikey": key, "Authorization": f"Bearer {key}"},
                            timeout=30, **kw)


def make_user(url: str, key: str, email: str) -> str | None:
    r = admin("POST", "/users", url, key,
              json={"email": email, "password": uuid.uuid4().hex, "email_confirm": True})
    if r.status_code >= 300:
        print(f"    could not create {email}: HTTP {r.status_code} {r.text[:160]}")
        return None
    return r.json().get("id")


def drop_user(url: str, key: str, uid: str) -> None:
    admin("DELETE", f"/users/{uid}", url, key)


def main() -> int:
    load_env()
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    db = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not (url and secret and db):
        print("Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_DB_URL in .env.")
        print("Run: python preflight.py --supabase")
        return 2
    try:
        import psycopg
    except ImportError:
        print('psycopg is not installed:  python -m pip install "psycopg[binary]"')
        return 2

    conn = psycopg.connect(db, connect_timeout=15)
    made: list[str] = []
    try:
        with conn.cursor() as cur:
            print("\n== the structure ==")
            cur.execute("""
                select c.relname, c.relrowsecurity, c.relforcerowsecurity
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                order by c.relname
            """)
            rows = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
            for t in ALL_TABLES:
                check(f"{t} exists", t in rows)
            for t in ALL_TABLES:
                if t in rows:
                    check(f"{t} has RLS enabled", rows[t][0], "")
            for t in OWNED:
                if t in rows:
                    # FORCE matters separately: without it the table owner is exempt, and
                    # a SECURITY DEFINER function added later becomes a way round all of
                    # this without anyone editing a policy.
                    check(f"{t} has RLS FORCED", rows[t][1])

            cur.execute("""
                select tablename, count(*) from pg_policies
                where schemaname = 'public' group by tablename
            """)
            pol = dict(cur.fetchall())
            for t in OWNED:
                check(f"{t} has at least one policy", pol.get(t, 0) > 0,
                      f"{pol.get(t, 0)} policies")

            # DECISIONS 9.3: no paywall exists yet, so no column may pretend one does.
            cur.execute("""
                select table_name, column_name from information_schema.columns
                where table_schema = 'public'
                  and column_name ~ '(plan|tier|quota|stripe|billing|subscription)'
            """)
            billing = cur.fetchall()
            check("no billing columns exist yet", not billing, str(billing))

            print("\n== two restaurants that must not see each other ==")
            a_id = make_user(url, secret, f"check-a-{uuid.uuid4().hex[:8]}@betareal.test")
            b_id = make_user(url, secret, f"check-b-{uuid.uuid4().hex[:8]}@betareal.test")
            if not (a_id and b_id):
                check("two test users created", False)
                return finish()
            made += [a_id, b_id]
            check("two test users created", True)

            ta, tb = uuid.uuid4(), uuid.uuid4()
            for tid, uid, slug in ((ta, a_id, f"check-a-{uuid.uuid4().hex[:6]}"),
                                   (tb, b_id, f"check-b-{uuid.uuid4().hex[:6]}")):
                cur.execute("insert into tenants (id, slug, name) values (%s, %s, %s)",
                            (tid, slug, "check"))
                cur.execute("insert into tenant_members (tenant_id, user_id) "
                            "values (%s, %s)", (tid, uid))
                cur.execute("insert into items (tenant_id, name, price_minor) "
                            "values (%s, %s, %s)", (tid, f"secret dish {slug}", 1250))
            conn.commit()
            check("each restaurant has one item", True)

            def as_user(uid: str, sql: str, args=()):
                """Run a query the way the app runs it: as `authenticated`, with this
                user's id in the JWT claims - which is exactly what auth.uid() reads."""
                cur.execute("select set_config('request.jwt.claims', %s, true)",
                            ('{"sub": "%s", "role": "authenticated"}' % uid,))
                cur.execute("set local role authenticated")
                cur.execute(sql, args)
                out = cur.fetchall()
                cur.execute("reset role")
                return out

            seen = as_user(a_id, "select tenant_id from items")
            check("owner A sees their own item", len(seen) == 1, f"{len(seen)} rows")
            check("owner A sees ONLY their own", all(r[0] == ta for r in seen),
                  str(seen))

            seen = as_user(b_id, "select tenant_id from items")
            check("owner B sees ONLY their own",
                  len(seen) == 1 and seen[0][0] == tb, str(seen))

            got = as_user(a_id, "select id from tenants where id = %s", (tb,))
            check("owner A cannot even see B's restaurant row", not got, str(got))

            # The write side. A policy whose USING clause is right and whose WITH
            # CHECK clause is missing reads perfectly and still lets one restaurant
            # write rows into another - they are separate clauses and only one of them
            # is exercised by reading.
            #
            # The error has to be read, not just caught. Postgres raises SQLSTATE 42501
            # for BOTH "you have no grant on this table" and "your row violated a
            # policy", and psycopg maps both to InsufficientPrivilege. Catching the
            # exception alone would pass just as happily on a schema where the grant was
            # forgotten - which is to say it would pass without testing tenancy at all.
            cur.execute("savepoint w")
            denial = ""
            try:
                as_user(a_id,
                        "insert into items (tenant_id, name) values (%s, %s) returning id",
                        (tb, "planted"))
            except Exception as e:                            # noqa: BLE001
                denial = str(e)
            cur.execute("rollback to savepoint w")
            check("owner A cannot write into B's restaurant", bool(denial),
                  "the insert SUCCEEDED" if not denial else "")
            check("and it is RLS that stops it, not a missing grant",
                  "row-level security" in denial.lower(),
                  denial.splitlines()[0][:90] if denial else "no error at all")

            # ...which is only meaningful if the grant really is there. Otherwise the
            # check above could be satisfied by a table nobody can touch for any reason.
            cur.execute("""
                select count(*) from information_schema.role_table_grants
                where grantee = 'authenticated' and table_name = 'items'
                  and privilege_type = 'INSERT'
            """)
            check("authenticated genuinely HAS insert on items",
                  cur.fetchone()[0] == 1)
            conn.rollback()

            print("\n== a diner, who is nobody ==")
            # A savepoint per table. A denied query aborts the whole transaction, and
            # "denied" is the PASS here - without a savepoint the first denial poisons
            # every check after it, including the cleanup.
            for t in OWNED:
                cur.execute("savepoint probe")
                try:
                    cur.execute("set local role anon")
                    cur.execute(f"select count(*) from {t}")
                    n = cur.fetchone()[0]
                    cur.execute("rollback to savepoint probe")
                    # Granted but empty is still a pass; granted and non-empty is a leak.
                    check(f"anon reads nothing from {t}", n == 0, f"{n} rows visible")
                except Exception as e:                        # noqa: BLE001
                    cur.execute("rollback to savepoint probe")
                    # No grant at all - anon cannot even name the table. The strongest
                    # form of the answer, and what 0002_grants.sql intends.
                    check(f"anon reads nothing from {t}", True,
                          "no grant: " + type(e).__name__)
            conn.rollback()

        # And over the wire, which is the way it would actually happen.
        print("\n== and the same thing over HTTPS, with the browser key ==")
        anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
        if anon_key:
            for t in ("items", "tenants", "models"):
                r = requests.get(f"{url}/rest/v1/{t}?select=id",
                                 headers={"apikey": anon_key}, timeout=20)
                leaked = r.status_code == 200 and r.json()
                check(f"publishable key gets nothing from {t}", not leaked,
                      f"HTTP {r.status_code} {r.text[:60]}")
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("delete from tenants where slug like 'check-%'")
            conn.commit()
        except Exception:                                     # noqa: BLE001
            conn.rollback()
        for uid in made:
            drop_user(url, secret, uid)
        conn.close()

    return finish()


def finish() -> int:
    print("\n" + "=" * 62)
    bad = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print(f"  FAILED: {n}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
