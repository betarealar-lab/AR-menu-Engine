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
