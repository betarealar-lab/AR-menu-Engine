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

    print("\n" + "=" * 58)
    bad_names = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad_names)}/{len(RESULTS)} passed")
    for n in bad_names:
        print("  FAILED:", n)
    return 1 if bad_names else 0


if __name__ == "__main__":
    raise SystemExit(main())
