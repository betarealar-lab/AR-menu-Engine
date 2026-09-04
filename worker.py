#!/usr/bin/env python3
"""Finish on this machine what the hosted Studio cannot.

    python worker.py            claim work, keep going
    python worker.py --once     do whatever is waiting, then stop
    python worker.py --dry-run  say what is waiting, touch nothing

The problem this solves is narrow and entirely about memory. Optimising a raw Meshy
master needs roughly 830 MB: glTF-Transform loads the whole 1.9M-triangle mesh to
simplify it, and there is no streaming simplifier. A 512 MB host cannot do it, at any
polycount, with any toolchain - gltfpack needed 521 MB for the same file. So the hosted
Studio archives the master and correctly refuses the rest.

**A desktop has the memory.** This claims exactly those jobs and finishes them, against
the same R2 the Studio uses, so the results appear in the hosted Studio the moment they
are written. Nobody has to move a file by hand.

That makes the split: the team uploads, generates and judges on the hosted Studio; this
finishes the work.

**What changed with the queue (ROADMAP 1.1).** This used to scan the whole catalogue
every minute looking for dishes that appeared to need work. Two hosts doing that against
the same records is a race with no lock in it, and the scan cost a read of every record
in the system on every pass. Now both hosts claim from one queue and a lease decides who
runs what - see jobs.py. The scan survives in one place only, as a **reconciler**: work
that ought to have a job and has none gets one. That covers dishes finished before the
queue existed, and anything an outage dropped on the floor.

Nothing here spends credits. Optimising is pure CPU on a master that is already paid for,
and this worker does not claim `generate` jobs unless asked to (`--generate`): generation
belongs on the host Meshy's webhook can actually reach.
"""
from __future__ import annotations

import argparse
import datetime
import sys
import time
from pathlib import Path

import dataset
import jobs
import limits
import optimize
import pipeline
import storage
from config import load_env

ROOT = Path(__file__).resolve().parent
# A claim is two list calls and a handful of small reads, so polling this often costs
# very little - and it is the delay between a generation finishing on Render and the
# shipping files existing, which somebody is usually watching.
POLL_SECONDS = 10
# ...but only while there is something happening. Nothing here can be woken from the
# hosted Studio - it is a different machine - so this has to poll, and a poll is two R2
# listings (measured, check_jobs.py). Listing is a Class A operation with 1,000,000 free
# a month: 10 s round the clock is ~518,000 of them, most spent finding an empty queue.
# So it backs off when nothing has arrived for a while and speeds up again the moment
# something does. Idle costs ~86,000 a month; a busy scanning day runs at full speed.
IDLE_SECONDS = 60
# How many empty passes before backing off. Two minutes at the default rate - long
# enough that a batch of dishes being generated one after another never slows down.
IDLE_AFTER = 12
# The reconciler reads every record in the system, so it runs on a much slower clock
# than the claim loop. Five minutes is far faster than work can arrive.
RECONCILE_SECONDS = 300


def needs_work(rec: dict) -> str:
    """Why this dish needs optimising, or empty if it does not.

    Deliberately generous: it is safe to re-optimise, since the inputs are stored and
    the outputs are overwritten by key. The cost of doing it twice is five seconds; the
    cost of missing one is a dish that never ships.
    """
    if not rec.get("model_key"):
        return ""
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


def reconcile(dry: bool = False) -> int:
    """Give a job to work that needs one and has none. Returns how many were queued.

    This is the self-healing half, and the thing it must never do is fight the queue.
    `jobs.exists` counts DEAD jobs as well as live ones, so a dish that has already
    failed its way to the dead-letter list is left alone rather than re-queued forever -
    which for an optimise would burn CPU in a loop, and for a generation would burn 30
    credits a lap with nobody watching.
    """
    queued = 0
    for rec in dataset.catalogue():
        why = needs_work(rec)
        if not why:
            continue
        dish, variant = rec["dish"], rec["variant"]
        if jobs.exists("optimise", dish, variant):
            continue
        # A record still marked in flight, with no job anywhere, is what used to be
        # called a ghost. It is not special any more - it is just work without a job.
        print(f"  queueing {dish} / {variant}: {why}")
        queued += 1
        if not dry:
            pipeline.enqueue_optimise(dish, variant, "reconciler")
    return queued


def capability(generate: bool):
    """What this host will claim.

    Optimise is gated on the real memory ceiling, exactly as it is on the Studio - on a
    desktop `limits.budget_mb()` is None and everything passes, but the same worker in a
    small container would correctly skip what it cannot finish.
    """
    def can_run(job: jobs.Job) -> str:
        if job.kind == "generate" and not generate:
            return ("generation belongs on the host the webhook can reach; "
                    "pass --generate to override")
        return pipeline.can_run(job)
    return can_run


def drain(out_dir: Path, engine: str, can_run, dry: bool) -> int:
    """Claim and run until there is nothing left this host can take."""
    if dry:
        waiting = [j for j in jobs.waiting() if not can_run(j)]
        for j in waiting:
            print(f"  would run {j.kind}: {j.dish} / {j.variant}")
        return len(waiting)
    done = 0
    while pipeline.work_once(out_dir, engine, capable=can_run) is not None:
        done += 1
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="one pass, then exit")
    ap.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "_worker")
    ap.add_argument("--every", type=int, default=POLL_SECONDS,
                    help="seconds between claims while there is work")
    ap.add_argument("--idle", type=int, default=IDLE_SECONDS,
                    help=f"seconds between claims after {IDLE_AFTER} empty passes")
    ap.add_argument("--engine", default="meshy-7",
                    help="engine to collect with when a job does not name one")
    ap.add_argument("--generate", action="store_true",
                    help="also claim generation. Off by default: without a reachable "
                         "webhook this host waits out the whole ~175 s call")
    ap.add_argument("--log", type=Path, default=None,
                    help="append output here as well - used when started at logon, "
                         "where there is no console to print to")
    a = ap.parse_args()

    if a.log:
        # Started hidden at logon there is nowhere for print() to go, and a worker that
        # fails silently is the thing this whole file exists to stop happening.
        a.log.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(a.log, "a", encoding="utf-8", buffering=1)
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"\n=== started {stamp} ===")

    load_env()
    print("BetaReal worker")
    print(f"  storage : {storage.describe()}")
    print(f"  optimizer: {optimize.describe()}")
    print(f"  memory  : {limits.describe()}")
    print(f"  claims  : optimise" + (" + generate" if a.generate else ""))
    if storage.backend().kind != "r2":
        print("\n  !! Storage is local disk, so this cannot see what the hosted Studio")
        print("     produced. Check .env has the R2 keys.")
    print()

    can_run = capability(a.generate)
    a.out.mkdir(parents=True, exist_ok=True)

    if a.once or a.dry_run:
        queued = reconcile(a.dry_run)
        n = drain(a.out, a.engine, can_run, a.dry_run)
        st = jobs.stats()
        print(f"\n{queued} queued, {n} job{'' if n == 1 else 's'} "
              f"{'would run' if a.dry_run else 'run'}. "
              f"{st['queued']} waiting, {st['dead']} dead.")
        return 0

    print(f"Watching. Claiming every {a.every}s ({a.idle}s when idle), reconciling "
          f"every {RECONCILE_SECONDS}s. Ctrl+C to stop.\n")
    last_reconcile = 0.0
    idle = 0
    try:
        while True:
            try:
                if time.time() - last_reconcile > RECONCILE_SECONDS:
                    if reconcile():
                        idle = 0
                    last_reconcile = time.time()
                n = drain(a.out, a.engine, can_run, False)
                idle = 0 if n else idle + 1
                if n:
                    dead = jobs.stats()["dead"]
                    print(f"  ({n} finished" +
                          (f", {dead} in dead letters)" if dead else ")") + "\n")
            except Exception as e:                            # noqa: BLE001
                # A bad pass - R2 unreachable, a record half-written - must never end
                # the loop. A worker that exits on the first blip is a worker nobody
                # notices has stopped, and then nothing ships.
                print(f"  pass failed, continuing: {type(e).__name__}: {e}")
            time.sleep(a.every if idle < IDLE_AFTER else max(a.every, a.idle))
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
