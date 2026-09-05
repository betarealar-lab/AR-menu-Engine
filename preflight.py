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

    if url and anon:
        # An unauthenticated PostgREST root with the anon key. 200 means the key is real
        # and the Data API is on; 401 means the key is wrong for this project.
        try:
            r = requests.get(f"{url}/rest/v1/",
                             headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
                             timeout=20)
            if r.status_code in (401, 403):
                print(f"  anon key REJECTED by the project ({r.status_code})")
                ok = False
            else:
                print(f"  anon key accepted (HTTP {r.status_code})")
        except Exception as e:                                # noqa: BLE001
            print(f"  could not reach the project: {type(e).__name__}: {e}")
            ok = False

    if url and svc:
        try:
            r = requests.get(f"{url}/rest/v1/",
                             headers={"apikey": svc, "Authorization": f"Bearer {svc}"},
                             timeout=20)
            if r.status_code in (401, 403):
                print(f"  service key REJECTED by the project ({r.status_code})")
                ok = False
            else:
                print(f"  service key accepted (HTTP {r.status_code})")
        except Exception as e:                                # noqa: BLE001
            print(f"  could not reach the project: {type(e).__name__}: {e}")
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
    else:
        host = db.split("@")[-1].split("/")[0] if "@" in db else "?"
        print(f"  SUPABASE_DB_URL       set, host {host}")

    print("\n  " + ("All four look right." if ok else "Something above needs fixing."))
    print("  Nothing was printed that anyone could use. Keys are masked.")
    return ok


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
