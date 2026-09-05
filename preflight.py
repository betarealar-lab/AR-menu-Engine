#!/usr/bin/env python3
"""Prove the key works and that we are really talking to the model we think we are.

    python preflight.py              # key check + show the exact request body
    python preflight.py --spend      # additionally run ONE real generation
    python preflight.py --supabase   # check the Supabase keys, spend nothing

Without --spend nothing is generated and no credits move. The paid check exists
because the credit table on meshy.ai does not name Meshy 7, so the only way to
know what a meshy-7 job actually costs is to run one and read Daily Usage.

**Nothing here ever prints a secret.** Keys are reported masked, the way
`config.masked` does it, and the Supabase check reports what each value IS -
right shape, accepted by the server, right privileges - never what it says. A
Meshy key was pasted into a chat once and had to be rotated; the point of this
file is that nobody ever needs to read a key aloud to find out whether it works.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

import engines
import storage
from config import load_env, masked, meshy_key
from engines.meshy import BASE, MeshyEngine

ROOT = Path(__file__).resolve().parent


def check_key(key: str) -> bool:
    """A cheap authenticated call. 401/403 means the key is wrong."""
    r = requests.get(BASE, headers={"Authorization": f"Bearer {key}"},
                     params={"page_size": 1}, timeout=30)
    if r.status_code in (401, 403):
        print(f"  key REJECTED ({r.status_code}): {r.text[:200]}")
        return False
    print(f"  key accepted (HTTP {r.status_code})")
    return True


def show_request(engine: MeshyEngine) -> None:
    """Print exactly what goes on the wire, minus the image payload."""
    body = {
        "image_urls": ["<data:image/jpeg;base64,...>"] * 4,
        "ai_model": engine.ai_model,
        "topology": engine.topology,
        "target_polycount": engine.target_polycount,
        "should_texture": engine.should_texture,
    }
    if engine.should_texture:
        body["texture_resolution"] = engine.texture_resolution
        body["enable_pbr"] = engine.enable_pbr
    print(f"\n  POST {BASE}")
    for line in json.dumps(body, indent=2).splitlines():
        print("  " + line)
    print(f"\n  --> ai_model is '{engine.ai_model}'. That string is what Meshy bills and runs.")


def spend_one(engine: MeshyEngine, images: list[Path]) -> None:
    from engines import Job
    print(f"\n  Generating one dish with {engine.label} ...")
    out = ROOT / "out" / "_preflight" / engine.label.replace(":", "-")
    res = engine.generate(Job(dish="_preflight", images=images), out)
    if not res.ok:
        print(f"  FAILED: {res.error}")
        return
    print(f"  ok in {res.seconds}s -> {res.files.get('glb')}")
    print(f"  estimated {engine.cost_per_job} credits")
    print("\n  Now open https://meshy.ai/settings/api and read Daily Usage.")
    print("  Whatever it shows for today IS the real meshy-7 multi-image cost.")
    print("  If it disagrees with the estimate, fix _cost() in engines/meshy.py.")


def check_supabase() -> bool:
    """Are the four Supabase values present, well-formed, and actually accepted?

    Written for the case where somebody has just pasted them out of a dashboard and
    wants to know if they landed in the right slots - which is exactly when a value ends
    up in the wrong variable, and exactly when nobody should be reading them out.
    """
    import os
    ok = True
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    svc = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    db = os.environ.get("SUPABASE_DB_URL", "").strip()

    print("\nSupabase")
    if not url:
        print("  SUPABASE_URL          MISSING")
        return False
    if not url.startswith("https://") or ".supabase." not in url:
        print(f"  SUPABASE_URL          looks wrong: {url[:40]}")
        print("                        expected https://<project-ref>.supabase.co")
        ok = False
    else:
        print(f"  SUPABASE_URL          {url}")

    # The two keys are easy to swap, and swapping them is not a small mistake: the
    # service key bypasses RLS entirely, so a service key sitting in the variable that
    # ships to browsers is every tenant's data, public.
    for name, val in (("SUPABASE_ANON_KEY", anon), ("SUPABASE_SERVICE_KEY", svc)):
        if not val:
            print(f"  {name:<21} MISSING")
            ok = False
            continue
        print(f"  {name:<21} {masked(val)}  ({len(val)} chars)")

    if anon and svc and anon == svc:
        print("  !! the anon and service keys are IDENTICAL - one of them is pasted twice")
        ok = False

    if url and anon and not _key_works(url, anon, "publishable"):
        ok = False
    if url and svc and not _key_works(url, svc, "secret"):
        ok = False

    if not db:
        print("  SUPABASE_DB_URL       not set - fine, it is only needed to run "
              "migrations from here")
    elif not db.startswith("postgres"):
        print("  SUPABASE_DB_URL       looks wrong: expected a postgresql:// URI")
        ok = False
    elif "[YOUR-PASSWORD]" in db or "<password>" in db.lower():
        print("  SUPABASE_DB_URL       still has the placeholder password in it - "
              "replace it with the one you generated")
        ok = False
    elif "@" not in db:
        # Seen for real: the connection string is in a one-line field and only the
        # visible part gets selected, so everything from the @ onwards is lost. It
        # looks like a valid URI right up until nothing can connect.
        print(f"  SUPABASE_DB_URL       INCOMPLETE ({len(db)} chars, no '@'). A whole "
              "one is ~85.")
        print("                        The tail was cut off in the copy. Use the copy "
              "button next to the")
        print("                        field rather than selecting the text by hand.")
        ok = False
    else:
        host = db.split("@")[-1].split("/")[0].split(":")[0]
        port = 5432
        tail = db.split("@")[-1].split("/")[0]
        if ":" in tail:
            try:
                port = int(tail.split(":")[1])
            except ValueError:
                pass
        print(f"  SUPABASE_DB_URL       set, host {host}:{port}")
        ok = _reachable(host, port) and ok

    print("\n  " + ("All four look right." if ok else "Something above needs fixing."))
    print("  Nothing was printed that anyone could use. Keys are masked.")
    return ok


def _key_works(url: str, key: str, kind: str) -> bool:
    """Ask the project whether it accepts this key.

    The probe is `/auth/v1/settings`, which any valid project key may read. It is NOT
    `/rest/v1/`: that endpoint answers a publishable key with

        401 {"message":"Secret API key required"}

    which looks exactly like a rejected key and is not one - it is the Data API telling
    you that reading its schema is a privileged operation. Probing there cost a round of
    debugging on 2026-09-05 before the response body was actually read.

    The secret key is additionally probed against `/rest/v1/`, because that DOES prove
    the Data API is switched on, which nothing else here would notice.
    """
    try:
        r = requests.get(f"{url}/auth/v1/settings", headers={"apikey": key}, timeout=20)
    except Exception as e:                                    # noqa: BLE001
        print(f"  could not reach the project: {type(e).__name__}: {e}")
        return False
    if r.status_code in (401, 403):
        print(f"  {kind} key REJECTED ({r.status_code}) - wrong project, or the copy "
              f"was truncated")
        return False
    print(f"  {kind} key accepted (HTTP {r.status_code})")

    if kind == "secret":
        try:
            d = requests.get(f"{url}/rest/v1/", headers={"apikey": key}, timeout=20)
            if d.status_code in (401, 403):
                print("  !! the Data API looks switched off - the admin app needs it")
                return False
            print(f"  Data API is on (HTTP {d.status_code})")
        except Exception as e:                                # noqa: BLE001
            print(f"  could not check the Data API: {type(e).__name__}: {e}")
    return True


def _reachable(host: str, port: int) -> bool:
    """Can this machine actually open a socket to the database?

    Worth doing separately from the password, because the usual failure here is neither
    a wrong password nor a typo. **Supabase gives free projects an IPv6-ONLY direct
    connection** - the host has an AAAA record and no A record - so on an IPv4 network
    it does not resolve at all, and every client reports it differently and unhelpfully.
    The fix is not to debug the URI, it is to use the Session pooler string from the
    same dropdown, which is IPv4.
    """
    import socket
    families = []
    for fam, label in ((socket.AF_INET, "IPv4"), (socket.AF_INET6, "IPv6")):
        try:
            socket.getaddrinfo(host, port, fam, socket.SOCK_STREAM)
            families.append((fam, label))
        except socket.gaierror:
            pass
    if not families:
        print(f"  !! {host} does not resolve at all")
        return False
    if all(label == "IPv6" for _, label in families):
        print("  !! this host is IPv6-ONLY (AAAA record, no A record)")
    for fam, label in families:
        try:
            info = socket.getaddrinfo(host, port, fam, socket.SOCK_STREAM)
            sock = socket.socket(fam, socket.SOCK_STREAM)
            sock.settimeout(6)
            sock.connect(info[0][4])
            sock.close()
            print(f"  database reachable over {label}")
            return True
        except Exception:                                     # noqa: BLE001
            print(f"  !! cannot reach {host}:{port} over {label}")
    print("     Supabase free projects have an IPv6-only DIRECT connection. On an IPv4")
    print("     network, go back to Connect -> Direct connection and switch the radio")
    print("     to SESSION POOLER, then copy that URI instead. Same database.")
    return False

def check_storage() -> bool:
    """Write, read back and delete a scratch object. Proves the whole R2 path works -
    credentials, bucket names, permissions - before a teammate uploads anything real."""
    b = storage.backend()
    print(f"  storage : {storage.describe()}")
    if b.kind != "r2":
        print("  (no R2 configured - the Studio will use local disk)")
        return True
    ok = True
    for bucket in ("photos", "models"):
        key, blob = "_preflight/roundtrip.txt", b"betareal-preflight"
        try:
            b.put(bucket, key, blob, "text/plain")
            got = b.get(bucket, key)
            b.delete_prefix(bucket, key)
            if got == blob:
                print(f"    {bucket:7} write + read + delete  OK")
            else:
                print(f"    {bucket:7} FAILED - read back {got!r}")
                ok = False
        except Exception as e:
            print(f"    {bucket:7} FAILED - {type(e).__name__}: {str(e)[:120]}")
            ok = False
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", default="meshy-7")
    ap.add_argument("--spend", action="store_true", help="run one real generation")
    ap.add_argument("--storage-only", action="store_true", help="only check R2, skip Meshy")
    ap.add_argument("--supabase", action="store_true",
                    help="check the Supabase values in .env and stop. Spends nothing, "
                         "prints no secrets")
    ap.add_argument("--images", type=Path, nargs="+", help="4 photos for --spend")
    a = ap.parse_args()

    if a.supabase:
        # meshy_key() is what loads .env everywhere else, and this path never calls it.
        load_env()
        print("Preflight")
        return 0 if check_supabase() else 1

    if a.storage_only:
        load_env()
        print("Preflight")
        return 0 if check_storage() else 1

    try:
        key = meshy_key()
    except RuntimeError as e:
        print(e)
        return 1

    print(f"Preflight\n  key    : {masked(key)}")
    engine = engines.build(a.engine)
    print(f"  engine : {engine.label}")
    if not check_key(key):
        return 1
    if not check_storage():
        return 1
    show_request(engine)

    if a.spend:
        if not a.images or len(a.images) < 1:
            print("\n  --spend needs --images photo1.jpg photo2.jpg photo3.jpg photo4.jpg")
            return 1
        missing = [p for p in a.images if not p.is_file()]
        if missing:
            print(f"\n  missing: {', '.join(str(m) for m in missing)}")
            return 1
        spend_one(engine, a.images[:4])
    else:
        print("\n  No credits spent. Add --spend --images a.jpg b.jpg c.jpg d.jpg "
              "to confirm the real cost.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
