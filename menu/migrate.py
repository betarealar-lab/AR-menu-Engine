#!/usr/bin/env python3
"""Apply the menu platform's SQL migrations, in order, exactly once each.

    python menu/migrate.py --status      what is applied and what is pending
    python menu/migrate.py --dry-run     print what would run, change nothing
    python menu/migrate.py               apply everything pending

Reads `SUPABASE_DB_URL` from `.env`. On the free plan that has to be the **Session
pooler** string, not the direct connection - Supabase gives free projects an IPv6-only
direct host and most networks are IPv4, so the direct one does not resolve at all. See
HANDOFF.md's environment table; `python preflight.py --supabase` diagnoses it.

**Why a file per migration and a table of what ran**, rather than one schema.sql that is
edited in place: a schema file tells you what the database should look like, and gives
you no way to find out what it actually looks like. The moment there are two databases -
and there will be, the day a staging project exists - "did this run here?" is a question
somebody has to answer at 2am. A numbered file that ran once, recorded with its checksum,
answers it.

The checksum matters more than it looks. Editing a migration that has already run is the
single easiest way to end up with two databases that share a version number and disagree
about their contents, and nothing downstream would notice.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import load_env      # noqa: E402

HERE = Path(__file__).resolve().parent
MIGRATIONS = HERE / "migrations"

LEDGER = """
create table if not exists schema_migrations (
    version     text primary key,
    checksum    text        not null,
    applied_utc timestamptz not null default now()
);
"""


def files() -> list[Path]:
    return sorted(MIGRATIONS.glob("*.sql"))


def checksum(path: Path) -> str:
    # Newlines normalised, so a file that has been through a Windows checkout does not
    # read as edited. Git's autocrlf has caused exactly this kind of false alarm before.
    body = path.read_text(encoding="utf-8").replace("\r\n", "\n").encode()
    return hashlib.sha256(body).hexdigest()[:16]


def connect():
    load_env()
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        print("SUPABASE_DB_URL is not set in .env.")
        print("Supabase dashboard -> Connect -> Session pooler -> URI.")
        print("Then: python preflight.py --supabase")
        return None
    try:
        import psycopg
    except ImportError:
        print("psycopg is not installed:  python -m pip install \"psycopg[binary]\"")
        return None
    try:
        return psycopg.connect(url, connect_timeout=15)
    except Exception as e:                                    # noqa: BLE001
        print(f"Could not connect: {type(e).__name__}: {e}")
        if "db." in url and ".supabase.co" in url:
            print("\nThat is the DIRECT connection string, which is IPv6-only on the")
            print("free plan. Use the Session pooler one instead - it is IPv4.")
        return None


def applied(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(LEDGER)
        cur.execute("select version, checksum from schema_migrations")
        return dict(cur.fetchall())
    return {}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="report only")
    ap.add_argument("--dry-run", action="store_true", help="print the SQL, run nothing")
    a = ap.parse_args()

    todo = files()
    if not todo:
        print(f"No migrations in {MIGRATIONS}")
        return 1

    conn = connect()
    if conn is None:
        return 1

    with conn:
        done = applied(conn)
        pending = []
        print("Migrations")
        for f in todo:
            version, sums = f.stem, checksum(f)
            if version not in done:
                print(f"  PENDING  {version}")
                pending.append((version, sums, f))
            elif done[version] != sums:
                # Loud, and not fixed automatically. The right move is a NEW migration;
                # silently re-running an edited one is how two databases end up sharing a
                # version number and disagreeing about what is in them.
                print(f"  CHANGED  {version}  !! applied as {done[version]}, "
                      f"file is now {sums}")
                print("           Write a new migration instead of editing this one.")
                return 1
            else:
                print(f"  applied  {version}")

        if a.status:
            print(f"\n{len(pending)} pending.")
            return 0
        if not pending:
            print("\nNothing to do.")
            return 0

        for version, sums, f in pending:
            sql = f.read_text(encoding="utf-8")
            if a.dry_run:
                print(f"\n----- {version} would run, {len(sql)} chars -----")
                continue
            print(f"\napplying {version} ...")
            with conn.cursor() as cur:
                # One transaction per migration: it lands whole or not at all. A
                # half-applied schema is worse than an unapplied one, because it looks
                # like it worked.
                cur.execute(sql)
                cur.execute(
                    "insert into schema_migrations (version, checksum) values (%s, %s)",
                    (version, sums))
            conn.commit()
            print(f"  {version} applied")

    print("\nDone." if not a.dry_run else "\nDry run, nothing changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
