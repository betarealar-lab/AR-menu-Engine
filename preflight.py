#!/usr/bin/env python3
"""Prove the key works and that we are really talking to the model we think we are.

    python preflight.py              # key check + show the exact request body
    python preflight.py --spend      # additionally run ONE real generation

Without --spend nothing is generated and no credits move. The paid check exists
because the credit table on meshy.ai does not name Meshy 7, so the only way to
know what a meshy-7 job actually costs is to run one and read Daily Usage.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

import engines
import storage
from config import masked, meshy_key
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", default="meshy-7")
    ap.add_argument("--spend", action="store_true", help="run one real generation")
    ap.add_argument("--images", type=Path, nargs="+", help="4 photos for --spend")
    a = ap.parse_args()

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
