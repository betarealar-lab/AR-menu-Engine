#!/usr/bin/env python3
"""Optimise on this machine what the hosted Studio cannot.

    python worker.py            watch for work, keep going
    python worker.py --once     do whatever is waiting, then stop
    python worker.py --dry-run  say what it would do, touch nothing

The problem this solves is narrow and entirely about memory. Optimising a raw Meshy
master needs roughly 830 MB: glTF-Transform loads the whole 1.9M-triangle mesh to
simplify it, and there is no streaming simplifier. A 512 MB host cannot do it, at any
polycount, with any toolchain - gltfpack needed 521 MB for the same file. So the hosted
Studio archives the master and correctly refuses the rest.

**A desktop has the memory.** This picks up exactly those dishes and finishes them,
against the same R2 the Studio uses, so the results appear in the hosted Studio the
moment they are uploaded. Nobody has to move a file by hand.

That makes the split: the team uploads, generates and judges on the hosted Studio; this
finishes the work. Which is also the architecture the whole system is heading towards -
ROADMAP 1.1 replaces the polling below with a real jobs table and moves this same code
to a container. Until then it runs on a laptop, and the only cost of that is that the
laptop has to be on.

Nothing here spends credits. Optimising is pure CPU on a master that is already paid for.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

import dataset
import limits
import optimize
import storage
from config import load_env

ROOT = Path(__file__).resolve().parent
POLL_SECONDS = 20


def needs_work(rec: dict) -> str:
    """Why this dish needs optimising, or empty if it does not.

    Deliberately generous: it is safe to re-optimise, since the inputs are stored and
    the outputs are overwritten by key. The cost of doing it twice is five seconds; the
    cost of missing one is a dish that never ships.
    """
    if not rec.get("model_key"):
        return ""
    if rec.get("status") in ("running", "optimising"):
        return ""                      # something is already on it
    catalog = rec.get("catalog_keys") or {}
    if not catalog:
        return "no shipping files"
    if rec.get("export_error"):
        return f"last attempt failed: {rec['export_error'][:60]}"
    # A size typed after the last run, or changed since it - the shipped file is stale.
    scale = rec.get("scale") or {}
    stats = rec.get("export_stats") or {}
    if scale.get("cm") and (stats.get("scale_cm") != scale.get("cm")
                            or stats.get("scale_axis") != scale.get("axis")):
        return f"size changed to {scale['cm']} cm {scale.get('axis', '')}"
    opt = rec.get("optimise") or {}
    want_auto = opt.get("triangles") == -1
    if want_auto and not stats.get("auto_triangles"):
        return "triangle target changed to auto"
    if opt.get("triangles") and not want_auto and \
            stats.get("target_triangles") != opt["triangles"]:
        return f"triangle target changed to {opt['triangles']:,}"
    if opt.get("texture") and stats.get("target_texture") != opt["texture"]:
        return f"texture target changed to {opt['texture']}px"
    return ""


def optimise_one(rec: dict, out_dir: Path, dry: bool = False) -> bool:
    dish, variant = rec["dish"], rec["variant"]
    why = needs_work(rec)
    print(f"  {dish} / {variant}: {why}")
    if dry:
        return True

    tmp = out_dir / f"{dataset.slug(dish)}--{dataset.slug(variant)}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        rec = dataset.record(dish, variant)
        rec.update(status="optimising", stage="fetching master",
                   optimising_since=dataset._now())
        dataset.write(rec)

        master = tmp / "master.glb"
        if not dataset.fetch_model(rec["model_key"], master):
            raise RuntimeError(f"master missing from storage: {rec['model_key']}")
        print(f"     master {master.stat().st_size / 1048576:.1f} MB")

        def stage(name: str) -> None:
            print(f"     {name}")
            r = dataset.record(dish, variant)
            if r.get("status") == "optimising":
                r["stage"] = name
                dataset.write(r)

        started = time.time()
        settings = rec.get("optimise") or {}
        res = optimize.run(master, tmp / "out", scale=rec.get("scale") or None,
                           on_stage=stage,
                           triangles=(0 if settings.get("triangles") == -1
                                      else settings.get("triangles")
                                      or optimize.TARGET_TRIANGLES),
                           texture=settings.get("texture") or optimize.TARGET_TEXTURE)
        rec = dataset.record(dish, variant)
        if not res.ok:
            rec.update(status="review", stage="", optimising_since="",
                       export_error=res.error)
            dataset.write(rec)
            print(f"     FAILED: {res.error[:120]}")
            return False

        catalog = {}
        for kind, path in res.files.items():
            name = {"draco": "model_draco.glb", "opt": "model_opt.glb",
                    "usdz": "model.usdz"}.get(kind, path.name)
            catalog[kind] = dataset.save_catalog(dish, variant, name, path.read_bytes())
        rec.update(status="review", stage="", optimising_since="",
                   catalog_keys=catalog, export_stats=res.stats,
                   catalogued_utc=dataset._now(), catalogued_by="worker",
                   export_error="")
        dataset.write(rec)
        st = res.stats
        print(f"     done in {time.time() - started:.1f}s -> "
              f"{st.get('draco_bytes', 0) / 1048576:.2f} MB draco, "
              f"{st.get('result_triangles', 0):,} tris, "
              f"{st.get('usdz_bytes', 0) / 1048576:.2f} MB usdz")
        return True
    except Exception as e:                                    # noqa: BLE001
        rec = dataset.record(dish, variant)
        rec.update(status="review", stage="", optimising_since="",
                   export_error=f"{type(e).__name__}: {e}")
        dataset.write(rec)
        print(f"     FAILED: {type(e).__name__}: {e}")
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def sweep(out_dir: Path, dry: bool) -> int:
    done = 0
    for rec in dataset.catalogue():
        if needs_work(rec):
            if optimise_one(rec, out_dir, dry):
                done += 1
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="one pass, then exit")
    ap.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "_worker")
    ap.add_argument("--every", type=int, default=POLL_SECONDS)
    a = ap.parse_args()

    load_env()
    print("BetaReal optimise worker")
    print(f"  storage : {storage.describe()}")
    print(f"  optimizer: {optimize.describe()}")
    print(f"  memory  : {limits.describe()}")
    if storage.backend().kind != "r2":
        print("\n  !! Storage is local disk, so this cannot see what the hosted Studio")
        print("     produced. Check .env has the R2 keys.")
    print()

    a.out.mkdir(parents=True, exist_ok=True)
    if a.once or a.dry_run:
        n = sweep(a.out, a.dry_run)
        print(f"\n{n} dish{'' if n == 1 else 'es'} {'would be ' if a.dry_run else ''}done.")
        return 0

    print(f"Watching. Checking every {a.every}s. Ctrl+C to stop.\n")
    try:
        while True:
            n = sweep(a.out, False)
            if n:
                print(f"  ({n} finished)\n")
            time.sleep(a.every)
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
