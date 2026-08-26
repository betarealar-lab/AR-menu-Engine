#!/usr/bin/env python3
"""Re-run everything in the dataset against another engine.

    python runner.py --list                      registered engines and cost
    python runner.py --engines meshy-5           DRY RUN - shows the spend, calls nothing
    python runner.py --engines meshy-5 --go      actually spends credits

This is the payoff of storing frames rather than pointing at a drive: once a dish has been
judged on meshy-7, the identical four images can go to meshy-5, an 8k texture, or the
hybrid, months later, and the comparison is real.

Use the Studio to build the dataset and judge results. Use this to fan an existing dataset
across engines in one go.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import dataset
import engines
from config import load_env
from engines import Job

ROOT = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "out")
    ap.add_argument("--engines", nargs="+", default=["meshy-7"])
    ap.add_argument("--dish", help="only this dish")
    ap.add_argument("--go", action="store_true", help="actually spend credits")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    if a.list:
        for name in engines.REGISTRY:
            e = engines.build(name)
            flag = "  (cost unlisted - see engines/meshy.py)" if getattr(e, "cost_uncertain", False) else ""
            print(f"  {name:18} {e.label:22} ~{e.cost_per_job} credits/dish{flag}")
        return 0

    load_env()
    rows = [m for m in dataset.catalogue()
            if m.get("frames")
            and (not a.dish or dataset.slug(a.dish) == m["dish_id"])]
    if not rows:
        print("No complete variants found. Upload four frames per dish in the Studio first.")
        return 1

    built = [engines.build(n) for n in a.engines]
    likely = sum(e.cost_per_job for e in built) * len(rows)
    worst = sum(30 if getattr(e, "cost_uncertain", False) else e.cost_per_job
                for e in built) * len(rows)

    print(f"{len(rows)} stored variants x {len(built)} engines = {len(rows) * len(built)} generations")
    for m in rows:
        print(f"    {m['dish_id']}/{m['variant']}")
    print()
    for e in built:
        print(f"    {e.label:22} ~{e.cost_per_job} credits each")
    print(f"\n  estimated spend: {likely} credits"
          + (f"  (worst case {worst})" if worst != likely else ""))

    if not a.go:
        print("\nDRY RUN - nothing submitted. Re-run with --go to spend credits.")
        return 0

    results = []
    for m in rows:
        for engine in built:
            out = a.out / m["dish_id"] / dataset.slug(m["variant"]) / engine.name
            if (out / f"{m['dish_id']}.glb").exists():
                print(f"  = {m['dish_id']}/{m['variant']:12} {engine.label:22} already done")
                continue
            print(f"  > {m['dish_id']}/{m['variant']:12} {engine.label:22} ...", end="", flush=True)
            staged = a.out / "_batch"
            staged.mkdir(parents=True, exist_ok=True)
            paths = []
            for i, blob in enumerate(dataset.frames(m["dish"], m["variant"])):
                fp = staged / f'{m["dish_id"]}-{i}.jpg'; fp.write_bytes(blob); paths.append(fp)
            job = Job(dish=m["dish_id"], images=paths)
            r = engine.generate(job, out)
            results.append((m, engine, r))
            print(f" ok {r.seconds}s" if r.ok else f" FAILED {r.error}")

    report(a.out, results)
    print(f"\nDone. Results in {a.out}; compare them in the Studio.")
    return 0


def report(out: Path, results: list) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "runs.json").write_text(json.dumps([{
        "dish": m["dish_id"], "variant": m["variant"], "engine": e.label,
        "ok": r.ok, "seconds": r.seconds, "credits": r.credits, "error": r.error,
        "files": {k: str(v) for k, v in r.files.items()},
    } for m, e, r in results], indent=2), encoding="utf-8")

    path = out / "runs.csv"
    exists = path.exists()
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if not exists:
            w.writerow(["dish", "variant", "engine", "ok", "seconds", "credits",
                        "glb", "error"])
        for m, e, r in results:
            w.writerow([m["dish_id"], m["variant"], e.label, r.ok, r.seconds,
                        r.credits, r.files.get("glb", ""), r.error])


if __name__ == "__main__":
    sys.exit(main())
