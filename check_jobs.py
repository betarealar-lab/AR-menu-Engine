#!/usr/bin/env python3
"""The job queue, including the part that only breaks under contention.

    python check_jobs.py

Runs against a throwaway local store, so it touches nothing real and costs nothing.

The interesting tests here are the concurrent ones. A queue that works when one worker
polls it is not a queue, it is a list - every bug worth having a test for shows up only
when two workers want the same job at the same instant. So this races real threads at a
shared claim and asserts that exactly one wins, which is the single property the whole
design rests on.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


def main() -> int:
    store = Path(tempfile.mkdtemp(prefix="jobs-check-"))
    os.environ.pop("R2_ENDPOINT", None)
    os.environ.pop("R2_ACCOUNT_ID", None)
    sys.path.insert(0, str(Path(__file__).resolve().parent))

    import storage
    real_backend = storage.backend
    storage.backend = lambda local_root=None: storage.LocalBackend(store)

    import jobs
    anything = lambda job: ""          # a host that can run everything

    try:
        print("\n== the primitive everything rests on ==")
        b = storage.backend()
        first = b.put_if_absent("photos", "probe.json", b"one")
        second = b.put_if_absent("photos", "probe.json", b"two")
        check("first write wins", first is True)
        check("second write is refused", second is False)
        check("and the first value survived", b.get("photos", "probe.json") == b"one")

        print("\n== enqueue and claim ==")
        a = jobs.enqueue("generate", "dish a", "default", engine="meshy-7")
        jobs.enqueue("optimise", "dish b", "default")
        check("both are queued", len(jobs.queued()) == 2)
        got = jobs.claim(anything, "worker-1")
        # Oldest first, deterministically - two jobs enqueued in the same second must
        # still come back in the order they were made.
        check("the oldest job is claimed first", got is not None and got.id == a.id,
              got.dish if got else "")
        check("it is counted as running", jobs.active() == 1)
        again = jobs.claim(anything, "worker-2")
        check("a second worker gets a DIFFERENT job",
              again is not None and again.id != got.id, again.dish if again else "")
        check("nothing is left to claim", jobs.claim(anything, "worker-3") is None)

        print("\n== two workers racing for one job ==")
        jobs.complete(got)
        jobs.complete(again)
        target = jobs.enqueue("optimise", "contested dish", "default")
        winners: list[str] = []
        lock = threading.Lock()
        start = threading.Barrier(8)

        def race(n: int) -> None:
            start.wait()               # everyone reaches for it in the same instant
            j = jobs.claim(anything, f"racer-{n}")
            if j:
                with lock:
                    winners.append(f"racer-{n}")

        threads = [threading.Thread(target=race, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        check("exactly one of eight workers wins", len(winners) == 1,
              f"{len(winners)} winners: {winners}")

        print("\n== a worker that dies ==")
        lease = f"{jobs.LEASES}{target.id}.json"
        import json as _json
        raw = _json.loads(storage.backend().get("photos", lease))
        raw["expires_utc"] = (datetime.now(timezone.utc)
                              - timedelta(minutes=5)).isoformat(timespec="seconds")
        storage.backend().put("photos", lease, _json.dumps(raw).encode(), "application/json")
        check("its lease stops counting as active", jobs.active() == 0)
        recovered = jobs.claim(anything, "worker-later")
        check("and the job becomes claimable again",
              recovered is not None and recovered.id == target.id)

        print("\n== a host only takes what it can finish ==")
        jobs.complete(recovered)
        jobs.enqueue("optimise", "heavy dish", "default")
        small_host = lambda job: ("not enough memory here"
                                  if job.kind == "optimise" else "")
        check("a small host skips work it cannot do",
              jobs.claim(small_host, "tiny") is None)
        check("a big host takes the same job",
              jobs.claim(anything, "big") is not None)

        print("\n== Meshy's ceiling is held, not exceeded ==")
        for j in list(jobs.queued()):
            jobs.complete(j)
        for l in storage.backend().list_keys("photos", jobs.LEASES):
            storage.backend().delete_prefix("photos", l)
        for i in range(jobs.MESHY_CONCURRENT + 3):
            jobs.enqueue("generate", f"dish {i}", "default")
        taken = []
        while True:
            j = jobs.claim(anything, f"w{len(taken)}")
            if not j:
                break
            taken.append(j)
        check("no more than the ceiling run at once",
              len(taken) == jobs.MESHY_CONCURRENT,
              f"{len(taken)} claimed, ceiling {jobs.MESHY_CONCURRENT}")
        # A claimed job stays in queued/ - the lease is what marks it in flight - so
        # "still waiting" is queued minus the live leases, not the raw count.
        check("the rest wait rather than failing",
              len(jobs.waiting()) == 3, f"{len(jobs.waiting())} still waiting")

        print("\n== failure, retry, and the dead letter list ==")
        for j in taken:
            jobs.complete(j)
        for l in storage.backend().list_keys("photos", jobs.LEASES):
            storage.backend().delete_prefix("photos", l)
        for j in list(jobs.queued()):
            jobs.complete(j)
        bad = jobs.enqueue("optimise", "doomed dish", "default")
        j = jobs.claim(anything, "w")
        check("retried on the first failure", jobs.fail(j, "boom") is True)
        j = jobs.claim(anything, "w")
        check("retried on the second", jobs.fail(j, "boom again") is True)
        j = jobs.claim(anything, "w")
        check("dead-lettered on the third", jobs.fail(j, "boom finally") is False)
        check("it is off the queue", len(jobs.waiting()) == 0)
        d = jobs.dead()
        check("and on the dead list with its reason",
              len(d) == 1 and "boom finally" in d[0].last_error, str(len(d)))
        check("a non-retryable failure dies immediately", (
            lambda: (jobs.revive(bad.id),
                     jobs.fail(jobs.claim(anything, "w"), "fatal", retryable=False))[1]
        )() is False)

        print("\n== reviving after a fix ==")
        check("a dead job can be put back", jobs.revive(bad.id) is True)
        check("with its attempts reset",
              len(jobs.waiting()) == 1 and jobs.waiting()[0].attempts == 0)
        check("reviving something that is not there says so",
              jobs.revive("nope") is False)

        print("\n== what the UI needs to show ==")
        st = jobs.stats()
        check("stats report the queue", st["queued"] == 1 and st["dead"] == 0, str(st))
        check("stats name the ceiling", st["meshy_ceiling"] == jobs.MESHY_CONCURRENT)

        print("\n== one dish, one job ==")
        for j in jobs.queued():
            jobs.complete(j)
        for j in jobs.dead():
            jobs.revive(j.id)
        for j in jobs.queued():
            jobs.complete(j)
        check("the queue starts empty", not jobs.queued() and not jobs.dead())
        jobs.enqueue("optimise", "Chicken Shqmeruli", "ring-25")
        # Names are slugged on the way in. Everything else in the system treats
        # "Chicken Shqmeruli" and "chicken-shqmeruli" as one dish; a queue that did not
        # would happily generate it twice, at 30 credits a time.
        check("a differently-spelt name is the same job",
              jobs.exists("optimise", "chicken-shqmeruli", "ring-25"))
        check("a different KIND of work is not",
              not jobs.exists("generate", "Chicken Shqmeruli", "ring-25"))
        check("nor is a different variant",
              not jobs.exists("optimise", "Chicken Shqmeruli", "ring-45"))

        print("\n== a dead job stays dead ==")
        # The reconciler in worker.py asks `exists` before putting work back. If dead
        # jobs did not count, a permanently failing dish would be re-queued every five
        # minutes forever - free for an optimise, 30 credits a lap for a generation.
        doomed = jobs.enqueue("optimise", "cursed dish", "default")
        for _ in range(jobs.MAX_ATTEMPTS):
            jobs.claim(anything, "w")
            jobs.fail(doomed, "no")
        check("it reached the dead letters", len(jobs.dead()) == 1)
        check("and still counts as existing, so nothing re-queues it",
              jobs.exists("optimise", "cursed dish", "default"))
        check("the dead letters are listed, not just counted",
              jobs.stats()["dead_jobs"][0]["dish"] == "cursed-dish",
              str(jobs.stats()["dead_jobs"]))

        print("\n== cancelling ==")
        jobs.enqueue("generate", "doomed dish", "default")
        jobs.enqueue("optimise", "doomed dish", "default")
        jobs.enqueue("optimise", "innocent dish", "default")
        check("cancel takes both jobs for the dish",
              jobs.cancel("doomed dish", "default") == 2)
        check("and leaves everyone else alone",
              jobs.exists("optimise", "innocent dish", "default"))
        jobs.enqueue("generate", "half dish", "default")
        jobs.enqueue("optimise", "half dish", "default")
        check("cancel can be narrowed to one kind",
              jobs.cancel("half dish", "default", kind="generate") == 1)
        check("the other kind survives",
              jobs.exists("optimise", "half dish", "default")
              and not jobs.exists("generate", "half dish", "default"))

        print("\n== a submitted generation keeps its slot ==")
        # This is the one that makes the Meshy ceiling real. Generation SUBMITS and
        # returns in about a second; if the job completed there, `active` would drop to
        # zero and nine machines could submit ninety tasks while the eleventh was still
        # refused - the exact bug the queue exists to stop. So a submitted job keeps its
        # lease, on a shorter clock, and the webhook closes it.
        for j in jobs.queued():
            jobs.complete(j)
        sent = jobs.enqueue("generate", "in flight", "default")
        claimed = jobs.claim(anything, "render-1")
        jobs.heartbeat(claimed, "render-1", seconds=jobs.PENDING_SECONDS)
        check("it still counts against the ceiling after submitting",
              jobs.active("generate") == 1)
        check("and nobody else can take it", jobs.claim(anything, "render-2") is None)
        lease = jobs._leases()[0]
        held = ((datetime.fromisoformat(lease["expires_utc"])
                 - datetime.now(timezone.utc)).total_seconds())
        check("on the short clock, not the full lease",
              held <= jobs.PENDING_SECONDS + 1 < jobs.LEASE_SECONDS, f"{held:.0f}s")

        print("\n== a webhook that never comes ==")
        # Expire the lease by hand rather than waiting it out.
        import json as _json
        lease["expires_utc"] = (datetime.now(timezone.utc)
                                - timedelta(seconds=1)).isoformat(timespec="seconds")
        storage.backend().put("photos", lease["_key"],
                              _json.dumps(lease).encode(), "application/json")
        check("the slot is released", jobs.active("generate") == 0)
        again = jobs.claim(anything, "render-2")
        check("and the job is claimable again, still the same job",
              again is not None and again.id == sent.id)
        check("it was never counted as a failure", again.attempts == 0)

        print("\n== what an idle poll costs ==")
        # Listing an R2 prefix is a Class A operation - the metered kind, 1,000,000 free
        # a month. Two hosts poll this queue all day, so the number of listings per poll
        # is a real bill, not a style question. `claim` used to re-list the leases once
        # per candidate job; on a queue of twenty that was twenty-one listings to take
        # one job.
        for j in jobs.queued():
            jobs.complete(j)
        calls = []
        inner = storage.LocalBackend.list_keys
        storage.LocalBackend.list_keys = (
            lambda self, bucket, prefix="": calls.append(prefix) or inner(self, bucket, prefix))
        try:
            jobs.claim(anything, "meter")
            idle = len(calls)
            calls.clear()
            for i in range(20):
                jobs.enqueue("optimise", f"dish {i}", "default")
            jobs.claim(lambda job: "cannot", "meter")     # walks all twenty, takes none
            twenty = len(calls)
            calls.clear()
            jobs.stats()
            st = len(calls)
        finally:
            storage.LocalBackend.list_keys = inner
        check("an empty poll lists twice: leases, then jobs", idle == 2, f"{idle}")
        check("a queue of twenty still lists twice", twenty == 2, f"{twenty} listings")
        check("stats lists three times: leases, queued, dead", st == 3, f"{st}")
    finally:
        storage.backend = real_backend
        shutil.rmtree(store, ignore_errors=True)

    # ── one typed number becomes the right size ──────────────────────────────────────
    #
    # Temo, 2026-09-08: "make it so that with 1 human inputted dimension it can scale."
    # It already could - the plate just opened with a preset filled in and never said which
    # of the three numbers mattered. This is the arithmetic that makes it true, checked
    # without a toolchain, a bucket or a credit.
    #
    # The chain: an owner types ONE box -> `model_request_gate()` (0013) picks the primary,
    # width first, into scale_cm/scale_axis -> this turns it into a uniform factor -> the
    # model's own proportions supply the other two axes.
    print("\n== one dimension is enough ==")
    import optimize
    plate = {"width": 0.14, "length": 0.14, "height": 0.03}
    check("28 cm across a 14 cm model doubles it",
          optimize.scale_factor(plate, {"cm": 28, "axis": "width"}) == 2.0)
    check("...and the answer is in metres, because glTF and AR are",
          abs(optimize.scale_factor({"width": 1.0}, {"cm": 28, "axis": "width"}) - 0.28) < 1e-9)
    check("height alone scales it just the same",
          optimize.scale_factor(plate, {"cm": 12, "axis": "height"}) == 4.0)
    check("so does length alone",
          optimize.scale_factor(plate, {"cm": 7, "axis": "length"}) == 0.5)
    # Every way it can be unusable ends at 1.0. A model at its generated size is wrong; a
    # model multiplied by infinity is not on the table at all.
    for why, measured, scale in [
        ("no size was given", plate, None),
        ("the size is zero", plate, {"cm": 0, "axis": "width"}),
        ("the axis is not one of ours", plate, {"cm": 28, "axis": "diagonal"}),
        ("the geometry measures nothing", {"width": 0.0}, {"cm": 28, "axis": "width"}),
        ("the number is not a number", plate, {"cm": "big", "axis": "width"}),
    ]:
        check(f"left alone when {why}", optimize.scale_factor(measured, scale) == 1.0)

    # -- the two long-running processes must outlive a bad pass --------------------
    #
    # `worker.py` has always caught per-pass exceptions; the BRIDGE, installed by the same
    # script and started by the same launcher, had no exception handling in its loop at
    # all. One transient error - Supabase unreachable for a second, DNS, R2 timing out, a
    # row half-written by an interrupted pass - propagated out of main() and the process
    # exited. It then stayed dead until somebody logged in, because it launches from the
    # Startup folder.
    #
    # That is the worst shape of failure here: nothing crashes visibly, nothing alerts,
    # and approved requests sit in the queue looking like they are about to run. The
    # developer queue's "no engine?" warning exists to catch it; this exists so there is
    # nothing to catch.
    #
    # Driven, not read: the loop really runs, the pass really raises, and the assertion is
    # that it came back round. Nothing real is touched - the pass functions are replaced.
    print("\n-- a bad pass does not kill the engine --")
    import contextlib
    import io as _io
    from menu import model_requests as bridge

    real = (bridge.multiview, bridge.pull, bridge.collect, bridge.load_env)
    calls = {"n": 0}

    def _explode():
        calls["n"] += 1
        if calls["n"] > 2:
            raise KeyboardInterrupt      # ends the loop the way Ctrl-C does
        raise RuntimeError("supabase unreachable")

    argv = sys.argv
    try:
        bridge.multiview = _explode
        bridge.pull = lambda limit=10: 0
        bridge.collect = lambda: 0
        bridge.load_env = lambda *a, **k: None

        buf = _io.StringIO()
        sys.argv = ["model_requests.py", "--watch", "--every", "0"]
        escaped, rc = None, None
        with contextlib.redirect_stdout(buf):
            try:
                rc = bridge.main()
            except BaseException as exc:                      # noqa: BLE001
                escaped = exc
        out = buf.getvalue()

        check("a failing pass does not kill the bridge", escaped is None,
              f"{type(escaped).__name__}: {escaped}" if escaped else "")
        check("it comes back round instead of exiting", calls["n"] >= 3,
              f"{calls['n']} passes")
        # Worded to match worker.py, because `install-engine.ps1 -Status` judges health by
        # grepping the log for this phrase. A bridge failing in its own private phrasing
        # would not be counted at all.
        check("and says it in the words -Status counts",
              out.count("pass failed, continuing") >= 2)
        check("Ctrl-C still stops it cleanly", rc == 0, f"rc={rc}")

        # `--once` is the opposite contract: a manual pass exists to show what happened.
        calls["n"] = 0
        raised = None
        sys.argv = ["model_requests.py", "--once"]
        with contextlib.redirect_stdout(_io.StringIO()):
            try:
                bridge.main()
            except Exception as exc:                          # noqa: BLE001
                raised = exc
        check("but --once still raises, so a manual pass cannot look like a success",
              isinstance(raised, RuntimeError),
              type(raised).__name__ if raised else "nothing was raised")
    finally:
        bridge.multiview, bridge.pull, bridge.collect, bridge.load_env = real
        sys.argv = argv

    # The worker's own guard, which is where the pattern came from.
    worker_src = (Path(__file__).with_name("worker.py")).read_text(encoding="utf-8")
    check("the worker still has the guard the bridge copied",
          "pass failed, continuing" in worker_src)

    # -- the engine comes back on its own ----------------------------------------
    #
    # "Press generate and it generates" is the whole product, and it failed on
    # 2026-09-10 because the engine was two bare processes started once at logon by a VBS
    # `sh.Run(..., 0, False)`. The machine lost R2 for a while, the bridge exited, and a
    # request sat at `approved` with idle workers beside it until somebody thought to
    # look. Nothing restarted it and nothing said so.
    #
    # This runs the real supervisor, kills a real child, and asserts it comes back -
    # which is the only way to know a restart works. Nothing here touches the queue: the
    # children are the real worker and bridge, but the assertion is only about process
    # lifetime.
    print("\n-- a dead child comes back without anybody asking --")
    import json as _json
    import subprocess as _sp
    import time as _time

    import tempfile as _tf
    root = Path(__file__).resolve().parent
    keep = root / "deploy" / "keepalive.py"
    # Its own state directory and its own children. The real worker claims real jobs off
    # the real queue, so a test that spawned one and then tidied up after itself would be
    # killing a generation somebody is waiting for. What is under test is the SUPERVISOR.
    sandbox = Path(_tf.mkdtemp(prefix="keepalive-check-"))
    state = sandbox / "engine.json"
    sleeper = "import time; time.sleep(600)"
    env = {**os.environ,
           "BETAREAL_KEEPALIVE_OUT": str(sandbox),
           "BETAREAL_KEEPALIVE_CHILDREN": _json.dumps([
               {"name": "worker", "argv": ["-c", sleeper], "log": "w.log", "does": "stub"},
               {"name": "bridge", "argv": ["-c", sleeper], "log": "b.log", "does": "stub"},
           ])}
    check("the supervisor exists", keep.exists())
    src = keep.read_text(encoding="utf-8") if keep.exists() else ""

    # The flag that once killed the bridge at every logon: the installer appends --log to
    # every launcher it writes, and an unknown flag is an instant, silent exit.
    check("it tolerates the --log the launcher appends", '"--log"' in src)
    check("it refuses to run twice", "claim_lock" in src)
    check("it backs off rather than spinning", "BACKOFF" in src)
    check("and it says it is alive somewhere a screen can read",
          "engine_heartbeat" in src)

    sup = _sp.Popen([sys.executable, str(keep)], cwd=str(root), env=env,
                    stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
    try:
        kids = {}
        for _ in range(30):
            _time.sleep(1)
            if state.exists():
                got = _json.loads(state.read_text(encoding="utf-8"))
                if got.get("pid") == sup.pid or got.get("children"):
                    kids = got.get("children", {})
                    if all(c.get("up") for c in kids.values()) and len(kids) >= 2:
                        break
        if not check("it starts both children", len(kids) >= 2, str(list(kids))):
            raise SystemExit  # nothing below can mean anything

        victim = kids["bridge"]["pid"]
        _sp.run(["taskkill", "/PID", str(victim), "/F"], capture_output=True)

        back = {}
        for _ in range(40):
            _time.sleep(1)
            got = _json.loads(state.read_text(encoding="utf-8"))
            b = got.get("children", {}).get("bridge", {})
            if b.get("up") and b.get("pid") != victim:
                back = b
                break
        check("a killed bridge is restarted", bool(back),
              "it stayed dead - which is the bug this exists to prevent")
        check("...as a NEW process", back.get("pid") not in (None, victim),
              f"{victim} -> {back.get('pid')}")
        check("...and the restart is counted", back.get("restarts", 0) >= 1,
              str(back.get("restarts")))
    finally:
        sup.terminate()
        try:
            sup.wait(timeout=10)
        except Exception:                                     # noqa: BLE001
            sup.kill()
        # Children outlive a terminated supervisor on Windows, so clear them by hand
        # rather than leaving a second engine racing the installed one.
        try:
            got = _json.loads(state.read_text(encoding="utf-8"))
            for c in got.get("children", {}).values():
                _sp.run(["taskkill", "/PID", str(c["pid"]), "/F"], capture_output=True)
        except Exception:                                     # noqa: BLE001
            pass
        import shutil as _sh
        _sh.rmtree(sandbox, ignore_errors=True)

    print("\n" + "=" * 58)
    bad_names = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad_names)}/{len(RESULTS)} passed")
    for n in bad_names:
        print("  FAILED:", n)
    return 1 if bad_names else 0


if __name__ == "__main__":
    raise SystemExit(main())
