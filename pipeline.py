"""What a job actually does, with no web server and no worker loop around it.

Everything here used to be a method on `studio.Handler`, which meant the only way to run
the pipeline was to receive an HTTP request - and `worker.py` therefore carried its own
second copy of the optimise stage. Two copies of the step that produces every file a
diner loads is one copy too many: the USDZ-from-master bug lived in one of them for two
days while the other was correct.

So the work moved out here and both callers import it:

    studio.py   claims jobs and runs whatever this host can finish
    worker.py   claims the ones a 512 MB container cannot

Nothing in this module knows what claimed it. It takes a dish, does the work, and writes
the record. `jobs.py` decides who runs it.

**Failures are not all alike, and the difference is money.**

    optimise   retryable.     Pure CPU on a master that is already paid for. A failed
                              run costs seconds, and most failures here are transient -
                              a killed process, a hiccup fetching the master.
    generate   NOT retryable. 30 credits a run. Three automatic attempts at a dish whose
                              photograph is simply bad is 90 credits - roughly three
                              days of a month's allowance - spent proving the same thing
                              three times. It dead-letters on the first failure and a
                              human presses Regenerate.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import dataset
import engines
import glb
import jobs
import limits
import optimize
from engines import Job as EngineJob

# What `run` reports back to whoever claimed the job.
DONE = "done"           # finished; release the lease and delete the job
PENDING = "pending"     # handed to the engine; KEEP the lease and wait for the callback


# ── who can run what ────────────────────────────────────────────────

def can_run(job: jobs.Job) -> str:
    """Empty when this host can finish the job, otherwise why it cannot.

    This is the whole reason one queue can feed a 512 MB container and a desktop at the
    same time. The container skips optimise work that would kill it rather than failing
    it, and the dish waits for a machine with the memory instead of coming back broken.

    A master whose triangle count we do not know is assumed to be a **raw** Meshy master
    - ~1.9M triangles, ~37.7 megapixels of texture, ~830 MB to open. Assuming small
    would be the dangerous default: it hands a 512 MB box a job that OOM-kills it, and a
    killed process writes no error, which is exactly how the first real dish was lost.
    """
    if job.kind != "optimise":
        return ""
    tris = int(job.payload.get("triangles") or 0)
    mpx = float(job.payload.get("megapixels") or 0.0)
    if not tris:
        tris, mpx = 1_902_278, 37.7
    return limits.check_optimise(tris, mpx)


def run(job: jobs.Job, out_dir: Path, default_engine: str) -> str:
    """Do one job. Returns DONE or PENDING. Raises if the work failed."""
    who = job.payload.get("who") or "queue"
    if job.kind == "generate":
        return generate(job.dish, job.variant, job.payload.get("engine"), who,
                        out_dir, default_engine)
    if job.kind == "optimise":
        optimise(job.dish, job.variant, who, out_dir)
        return DONE
    raise ValueError(f"unknown job kind {job.kind!r}")


def enqueue_optimise(dish: str, variant: str, who: str) -> None:
    """Queue the optimise for a dish, carrying what the claimer needs to size it.

    The triangle count travels on the job so `can_run` can answer without reading the
    record - one fewer round trip per candidate, on a poll that runs all day.
    """
    rec = dataset.record(dish, variant)
    jobs.enqueue("optimise", dish, variant, who=who,
                 triangles=int(rec.get("master_triangles") or 0))


# ── generation ──────────────────────────────────────────────────────

def generate(dish: str, variant: str, engine_name: str | None, who: str,
             out_dir: Path, default_engine: str) -> str:
    """Hand the dish to the engine.

    Where a callback can reach us (MESHY_WEBHOOK_SECRET set), this SUBMITS and returns
    PENDING. Generation is ~175 seconds of Meshy's GPU and none of ours; waiting through
    it held a whole container - two gigabytes, doing nothing - and made every dish cost
    thirteen times the compute it needs.

    Where no callback can reach us - a laptop, `runner.py` - it falls back to waiting,
    because that is better than never finishing.

    **A job that already carries a task id collects instead of submitting.** That is what
    makes an expired lease safe: a generation whose webhook never arrived is re-claimed
    and finished, not paid for twice.
    """
    name = engine_name or default_engine
    key = (dataset.slug(dish), dataset.slug(variant))
    tmp = out_dir / "_run" / f"{key[0]}--{key[1]}"

    rec = dataset.record(dish, variant)
    if rec.get("status") == "cancelled":
        return DONE
    if rec.get("model_key"):
        return DONE                        # already collected; nothing left to do
    if rec.get("task_id"):
        # Re-claimed after a callback that never came. Never resubmit - that is 30
        # credits for a task Meshy is already working on or has already finished.
        return resume(rec["task_id"], out_dir, default_engine)

    try:
        engine = engines.build(name)
        # Engines take file paths, so stage the frames locally for the call only.
        tmp.mkdir(parents=True, exist_ok=True)
        paths = []
        for i, blob in enumerate(dataset.frames(dish, variant)):
            path = tmp / f"{key[0]}-{key[1]}-{i}.jpg"
            path.write_bytes(blob)
            paths.append(path)

        job = EngineJob(dish=key[0], images=paths)
        rec = dataset.record(dish, variant)
        rec["engine"] = name
        rec["generated_by"] = who
        dataset.write(rec)

        if webhook_secret() and hasattr(engine, "start"):
            started = engine.start(job)
            rec = dataset.record(dish, variant)
            if started.error or not started.task_id:
                rec.update(status="failed", error=started.error or "no task id")
                dataset.write(rec)
                raise RuntimeError(started.error or "no task id")
            # The ticket is recorded BEFORE anything else can happen, and indexed so a
            # callback can find its way home. If this process dies in the next second,
            # the dish is still recoverable and the credits are not lost.
            rec.update(task_id=started.task_id, submitted_utc=dataset._now(),
                       status="running", error="")
            dataset.write(rec)
            dataset.claim_task(started.task_id, dish, variant)
            return PENDING

        result = engine.generate(job, tmp)
        rec = dataset.record(dish, variant)
        rec["task_id"] = result.task_id
        dataset.write(rec)
        store_result(dish, variant, result, who)
        return DONE
    finally:
        for f in tmp.glob("*"):
            try:
                f.unlink()
            except OSError:
                pass


def webhook_secret() -> str:
    """The secret path segment Meshy calls us on, or empty when nobody can call us.

    Empty is the honest default: a laptop has no address the internet can reach, so the
    pipeline waits through generation there instead of submitting into silence.
    """
    return os.environ.get("MESHY_WEBHOOK_SECRET", "").strip()


def resume(task_id: str, out_dir: Path, default_engine: str) -> str:
    """Turn a ticket into files. Safe to call twice for the same task.

    Returns PENDING when the engine is still working - the caller keeps the lease and
    somebody asks again later.
    """
    owner = dataset.owner_of_task(task_id)
    if not owner:
        return DONE
    dish, variant = owner
    key = (dataset.slug(dish), dataset.slug(variant))
    tmp = out_dir / "_run" / f"{key[0]}--{key[1]}"
    try:
        rec = dataset.record(dish, variant)
        if rec.get("status") == "cancelled":
            return DONE                  # abandoned; do not spend work finishing it
        if rec.get("model_key") and rec.get("task_id") == task_id:
            return DONE                  # already collected; a duplicate delivery
        engine = engines.build(rec.get("engine") or default_engine)
        tmp.mkdir(parents=True, exist_ok=True)
        res = engine.collect(task_id, key[0], tmp)
        if res.pending:
            rec = dataset.record(dish, variant)
            if res.expires_utc:
                rec["engine_expires_utc"] = res.expires_utc
            if rec.get("status") == "running":
                rec["stage"] = (f"generating {res.progress}%" if res.progress
                                else "generating")
                dataset.write(rec)
            return PENDING               # not finished; ask again later
        store_result(dish, variant, res, rec.get("generated_by", ""))
        return DONE
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def resume_task(task_id: str, out_dir: Path, default_engine: str) -> str:
    """The webhook's way in: collect, and if the dish finished, close its queue job.

    The callback arrives at whichever host Meshy can reach, which is not necessarily the
    host holding the lease. That is fine - a lease is an object in R2 and anyone may
    delete it - but somebody has to, or a finished generation would keep a slot against
    Meshy's ceiling until the lease timed out.
    """
    state = resume(task_id, out_dir, default_engine)
    if state == DONE:
        owner = dataset.owner_of_task(task_id)
        if owner:
            jobs.cancel(owner[0], owner[1], kind="generate")
    return state


def store_result(dish: str, variant: str, result, who: str) -> None:
    """Engine output -> masters in R2 -> an optimise job. Shared by both paths.

    It ENQUEUES the optimise rather than running it. The host that generates is usually
    the 512 MB container, which cannot open a raw master at all; the host that can is a
    desktop watching the same queue. Calling the optimiser here is what used to get the
    container OOM-killed with the work already paid for.
    """
    rec = dataset.record(dish, variant)
    rec["seconds"] = result.seconds or rec.get("seconds", 0)
    if not result.ok:
        rec.update(status="failed", error=result.error)
        dataset.write(rec)
        return
    masters = {}
    for ext, path in result.files.items():
        kind = "png" if ext == "thumb" else ext
        # The master is the GLB, and nothing else is a master. An engine may hand back
        # a USDZ - Meshy does - but it is that same mesh in another container, built
        # before any of our decimation, textures or real-world scale have touched it.
        # Archiving it cost 73 MB a dish for a file no code path ever opened, and
        # keeping it around is also how it once got shipped to iOS by accident. The
        # rule lives here rather than only in the Meshy client so that the next engine
        # inherits it. What ships is built from the GLB by optimize.py + usdz.py.
        if kind == "usdz":
            continue
        masters[kind] = dataset.save_model(dish, variant, rec.get("engine") or "",
                                           kind, Path(path).read_bytes())
    rec["master_keys"] = masters
    rec["model_key"] = masters.get("glb", "")
    glb_path = result.files.get("glb")
    if glb_path:
        try:
            rec["master_bytes"] = Path(glb_path).stat().st_size
            rec["master_triangles"] = glb.count_triangles(Path(glb_path))
        except Exception:      # noqa: BLE001 - a stat failing must not lose the model
            pass
    rec.update(status="optimising", stage="queued", optimising_since=dataset._now())
    dataset.write(rec)
    if not jobs.exists("optimise", dish, variant):
        enqueue_optimise(dish, variant, who)


# ── optimising ──────────────────────────────────────────────────────

def optimise(dish: str, variant: str, who: str, out_dir: Path) -> None:
    """Master -> the files a menu ships, at real-world size.

    Runs after generation, again whenever the scale changes, and by hand from the rail.
    Always lands on `review`: if it fails, the master is still there and still judgeable,
    it just is not shippable yet.

    A size typed WHILE one is running is not lost - the loop re-reads the record
    afterwards and runs again if the number moved. Without that, changing 28 to 35
    mid-run would save the 35, ship the 28, and show no sign of the disagreement.
    """
    key = (dataset.slug(dish), dataset.slug(variant))
    # Per variant, not shared: two dishes optimising at once would otherwise write into
    # one directory and rmtree it from under each other.
    tmp = out_dir / "_opt" / f"{key[0]}--{key[1]}"
    try:
        for _ in range(3):
            rec = dataset.record(dish, variant)
            if rec.get("status") == "cancelled":
                return
            applied = rec.get("scale") or {}
            if not optimise_once(dish, variant, who, rec, applied, tmp):
                return
            after = dataset.record(dish, variant)
            if (after.get("scale") or {}) == applied:
                return
            # The size moved while that pass ran. Go back to `optimising` before running
            # again, so the page keeps polling instead of showing a file it is about to
            # replace.
            after.update(status="optimising", stage="queued",
                         optimising_since=dataset._now())
            dataset.write(after)
        # Three passes and the size is still moving under us. Stop chasing it, but never
        # leave the record saying `optimising` with nothing running - that is a spinner
        # the page polls forever.
        rec = dataset.record(dish, variant)
        rec.update(status="review", stage="", optimising_since="")
        dataset.write(rec)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def optimise_once(dish: str, variant: str, who: str, rec: dict,
                  scale: dict, tmp: Path) -> bool:
    """One pass. False means stop - it failed and the record already says so."""
    def stage(name: str) -> None:
        """One small write per stage. The page shows it, and a run that dies leaves the
        name of the step it died in - the only reason we would ever know."""
        r = dataset.record(dish, variant)
        if r.get("status") == "optimising":
            r["stage"] = name
            dataset.write(r)

    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)
    stage("fetching master")
    master = tmp / "master.glb"
    # Streamed to disk, never held as bytes: a 70 MB master plus the copy every reader
    # makes of it is most of a 512 MB container on its own.
    if not dataset.fetch_model(rec["model_key"], master):
        r = dataset.record(dish, variant)
        r.update(status="review", stage="", optimising_since="",
                 export_error=f"master not found in storage: {rec['model_key']}")
        dataset.write(r)
        return False

    settings = rec.get("optimise") or {}
    res = optimize.run(master, tmp / "out", scale=scale or None, on_stage=stage,
                       triangles=(0 if settings.get("triangles") == -1
                                  else settings.get("triangles")
                                  or optimize.TARGET_TRIANGLES),
                       texture=settings.get("texture") or optimize.TARGET_TEXTURE)
    stage("storing")
    rec = dataset.record(dish, variant)
    if not res.ok:
        rec.update(status="review", stage="", optimising_since="",
                   export_error=res.error)
        dataset.write(rec)
        return False

    catalog = {}
    for kind, path in res.files.items():
        name = {"draco": "model_draco.glb", "opt": "model_opt.glb",
                "usdz": "model.usdz"}.get(kind, path.name)
        catalog[kind] = dataset.save_catalog(dish, variant, name, path.read_bytes())
    # The USDZ is BUILT from the optimised GLB (optimize.py step 5), not carried over
    # from the master. Carrying it meant iOS got a 74.5 MB, 1.9M-triangle, 190 cm file
    # while everyone else got 3 MB at 22 cm. The master's own USDZ stays in master_keys,
    # untouched, like every other master artefact.
    rec.update(status="review", stage="", optimising_since="",
               catalog_keys=catalog, export_stats=res.stats,
               catalogued_utc=dataset._now(), catalogued_by=who, export_error="")
    dataset.write(rec)
    return True


# ── the claim loop, shared by both hosts ────────────────────────────

def work_once(out_dir: Path, default_engine: str, capable=None,
              who: str | None = None, log=print) -> jobs.Job | None:
    """Claim one job this host can finish and run it. None when there was nothing.

    The failure handling is the part worth reading. A job that raises is failed on the
    queue, and `generate` is failed as **non-retryable** - see the module docstring: a
    retry there is 30 more credits spent proving the same thing. The record is left
    saying something a human can act on either way, because a spinner that never stops
    is worse than an error.
    """
    capable = capable or can_run
    job = jobs.claim(capable, who)
    if job is None:
        return None
    log(f"  {job.kind}: {job.dish} / {job.variant}")
    try:
        state = run(job, out_dir, default_engine)
        if state == PENDING:
            # Submitted to the engine. Keep the lease - it is what holds our place
            # against Meshy's concurrent ceiling - but on the short clock, so a webhook
            # that never arrives is recovered rather than waited out.
            jobs.heartbeat(job, who, seconds=jobs.PENDING_SECONDS)
        else:
            jobs.complete(job)
    except Exception as e:                                   # noqa: BLE001
        reason = f"{type(e).__name__}: {e}"
        retried = jobs.fail(job, reason, retryable=(job.kind != "generate"))
        log(f"     FAILED ({'will retry' if retried else 'dead'}): {reason[:120]}")
        rec = dataset.record(job.dish, job.variant)
        if not retried:
            # Nothing will pick this up again, so the record must stop claiming to be
            # in flight or the page spins forever on work nobody is doing.
            if job.kind == "generate":
                rec.update(status="failed", error=reason)
            else:
                rec.update(status="review", stage="", optimising_since="",
                           export_error=reason)
            dataset.write(rec)
    return job
