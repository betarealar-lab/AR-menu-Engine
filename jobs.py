"""A job queue built on R2, because R2 turns out to be enough.

The problem this replaces: work lived in whichever process happened to accept the HTTP
request. Two people pressing Generate at once risked losing one; the eleventh dish
account-wide was refused by Meshy and simply lost; a closed tab killed a generation
already paid for; and "who is working on what" lived in a Python set that emptied on
every restart, which wedged the first real dish for twenty minutes.

**Why not Postgres.** The usual answer is a `jobs` table with `SELECT ... FOR UPDATE SKIP
LOCKED`, and it would work. But Temo has been burned by Supabase egress before, and a
whole managed database bought for one lock is a service to run, pay for and keep alive.
Measured on the real bucket instead:

    put_object(..., IfNoneMatch="*")   first  -> OK
                                       second -> PreconditionFailed

R2 does atomic conditional writes. A create that fails when the key already exists IS a
lock, and the queue can live in the storage the models already live in. No new service,
no new bill, no new credential.

**How it works.** One object per job under `jobs/queued/`. To take a job, a worker writes
`jobs/leases/<id>.json` with `IfNoneMatch="*"`: exactly one writer can win, and the
loser moves on. A lease carries an expiry, so a worker that dies does not hold work
forever - the lease simply becomes claimable again. Completion deletes both objects.

**Capability-aware claiming** is the piece that makes one queue serve two very different
machines. Optimising a raw master needs ~830 MB; the hosted Studio has 512. So a host
only claims what it can actually finish, and the same queue feeds a 512 MB container
doing generation and a desktop doing the heavy work. Nothing has to know which is which.

This is ROADMAP 1.1. What it deliberately does NOT do is pretend to be Kafka: there is no
ordering guarantee beyond "oldest first", no fan-out, and a poll rather than a push. At
a few hundred dishes a month that is not a compromise, it is the right size.
"""
from __future__ import annotations

import json
import os
import socket
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import dataset
import storage

BUCKET = "photos"          # jobs live beside the records they are about
QUEUED = "jobs/queued/"
LEASES = "jobs/leases/"
DEAD = "jobs/dead/"

# How long a claim is good for before another worker may take it. Long enough that a
# slow generation is not stolen mid-flight, short enough that a killed worker does not
# strand a dish for an afternoon. Workers extend it while they run.
LEASE_SECONDS = 600

# A `generate` job that has been SUBMITTED to the engine keeps its lease, on a shorter
# clock. It has to keep it: the lease is what counts against Meshy's concurrent-task
# ceiling, and a job that completed at submit-time would make that count a fiction -
# nine machines could submit ninety tasks and the eleventh would still be refused, which
# is the exact bug this queue exists to stop.
#
# Shorter, because this is also the safety net. The fast path is the webhook: Meshy calls
# us, `pipeline.resume` collects, the job completes in ~175 s. When that call never
# arrives - a disabled webhook, a deploy landing in the wrong second, a network eating
# one - the lease simply expires and the job is claimed again. A re-claimed generate with
# a task id already on the record COLLECTS rather than resubmits, so the recovery costs
# nothing. 240 s is one generation plus margin.
PENDING_SECONDS = int(os.environ.get("JOBS_PENDING_SECONDS", "240"))

# Meshy refuses the 11th concurrent task per ACCOUNT, on the Pro plan. Sending more does
# not make it faster, it makes it fail - so the queue holds the line instead of letting
# somebody's dish come back as an error. One below the ceiling, because a manual run
# from a laptop should not be what tips it over.
MESHY_CONCURRENT = 9

MAX_ATTEMPTS = 3


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds")


def _stamp() -> str:
    """Microseconds, not seconds. `queued()` sorts on this, and two jobs enqueued in the
    same second would otherwise come back in arbitrary order - which is a queue that is
    only accidentally FIFO."""
    return _now().isoformat(timespec="microseconds")


def worker_id() -> str:
    """Who is running. Recorded on the lease so a stuck job names a machine."""
    return f"{socket.gethostname()}:{os.getpid()}"


@dataclass
class Job:
    id: str
    kind: str                      # "generate" | "optimise"
    dish: str
    variant: str
    payload: dict = field(default_factory=dict)
    created_utc: str = ""
    attempts: int = 0
    last_error: str = ""

    @property
    def key(self) -> str:
        return f"{QUEUED}{self.id}.json"

    @property
    def lease_key(self) -> str:
        return f"{LEASES}{self.id}.json"

    def to_json(self) -> bytes:
        return json.dumps({
            "id": self.id, "kind": self.kind, "dish": self.dish,
            "variant": self.variant, "payload": self.payload,
            "created_utc": self.created_utc, "attempts": self.attempts,
            "last_error": self.last_error,
        }, indent=2).encode()

    @staticmethod
    def from_json(raw: bytes) -> "Job":
        d = json.loads(raw)
        return Job(id=d["id"], kind=d["kind"], dish=d["dish"], variant=d["variant"],
                   payload=d.get("payload") or {}, created_utc=d.get("created_utc", ""),
                   attempts=d.get("attempts", 0), last_error=d.get("last_error", ""))


# ── writing ─────────────────────────────────────────────────────────

def enqueue(kind: str, dish: str, variant: str, **payload) -> Job:
    """Put work on the queue. Returns immediately; nothing runs here.

    Names are slugged on the way in, the same way `dataset` slugs them. "Chicken
    Shqmeruli" and "chicken-shqmeruli" are one dish everywhere else in the system, and a
    queue that thought they were two would happily generate both.
    """
    job = Job(id=uuid.uuid4().hex[:16], kind=kind,
              dish=dataset.slug(dish), variant=dataset.slug(variant),
              payload=payload, created_utc=_stamp())
    storage.backend().put(BUCKET, job.key, job.to_json(), "application/json")
    return job


def exists(kind: str, dish: str, variant: str) -> bool:
    """Is there already a job for this work - waiting, in flight, or dead?

    **Dead counts, deliberately.** The reconciler in `worker.py` asks this before putting
    anything back on the queue, and a reconciler that re-enqueues dead-lettered work
    turns a permanent failure into an infinite loop. For an `optimise` that wastes CPU;
    for a `generate` it would cost 30 credits a lap, forever, with nobody watching.
    Reviving a dead job is a human decision - `revive()`.
    """
    d, v = dataset.slug(dish), dataset.slug(variant)
    return any(j.kind == kind and j.dish == d and j.variant == v
               for j in queued() + dead())


def cancel(dish: str, variant: str, kind: str | None = None) -> int:
    """Take jobs for this dish off the queue. Returns how many were dropped.

    `kind` narrows it to one sort of work - the webhook uses it to close a finished
    generation without touching an optimise that generation just queued.

    The job object goes first and the lease after it, so there is no instant in which a
    lease-less job is visible to a claimer. A worker already running one of these finds
    the record marked `cancelled` and stops on its own; its `complete()` then deletes
    keys that are already gone, which is harmless.
    """
    b = storage.backend()
    d, v = dataset.slug(dish), dataset.slug(variant)
    n = 0
    for job in queued():
        if job.dish == d and job.variant == v and (kind is None or job.kind == kind):
            b.delete_prefix(BUCKET, job.key)
            b.delete_prefix(BUCKET, job.lease_key)
            n += 1
    return n


def queued() -> list[Job]:
    """Everything waiting, oldest first."""
    b = storage.backend()
    out = []
    for key in b.list_keys(BUCKET, QUEUED):
        raw = b.get(BUCKET, key)
        if raw:
            try:
                out.append(Job.from_json(raw))
            except Exception:      # noqa: BLE001 - one unreadable job is not an outage
                continue
    out.sort(key=lambda j: j.created_utc)
    return out


def waiting(leases: list[dict] | None = None) -> list[Job]:
    """Queued and not being worked on.

    A claimed job STAYS in `queued/` - only the lease says it is in flight. That is the
    whole recovery story: a worker that dies leaves the job exactly where it was and
    only the lease expires, where moving the object out on claim would need moving it
    back on failure, which is two writes that can half-succeed.

    `leases` lets a caller that has already listed them pass them in. Listing is a Class
    A operation on R2 - the metered kind, 1,000,000 free a month - and these loops run
    all day on two machines, so a listing that can be reused is one that should be.
    """
    live = {l["job"] for l in (_leases() if leases is None else leases)
            if not _expired(l)}
    return [j for j in queued() if j.id not in live]


def _leases() -> list[dict]:
    b = storage.backend()
    out = []
    for key in b.list_keys(BUCKET, LEASES):
        raw = b.get(BUCKET, key)
        if not raw:
            continue
        try:
            d = json.loads(raw)
            d["_key"] = key
            out.append(d)
        except Exception:          # noqa: BLE001
            continue
    return out


def _expired(lease: dict) -> bool:
    try:
        return datetime.fromisoformat(lease["expires_utc"]) < _now()
    except Exception:              # noqa: BLE001 - an unreadable lease is a dead lease
        return True


def active(kind: str | None = None) -> int:
    """How many jobs are being worked on right now, by anyone."""
    return sum(1 for l in _leases()
               if not _expired(l) and (kind is None or l.get("kind") == kind))


# ── claiming ────────────────────────────────────────────────────────

def _take_lease(job: Job, who: str) -> bool:
    """Atomically claim a job. False means somebody else got there first.

    The whole queue rests on this one call. `IfNoneMatch="*"` makes the write succeed
    only if the key does not exist, so of two workers racing for the same job exactly
    one wins and the other is told PreconditionFailed. Verified against the real bucket
    rather than assumed - S3 semantics and R2 semantics are not always the same.
    """
    body = json.dumps({
        "job": job.id, "kind": job.kind, "dish": job.dish, "variant": job.variant,
        "worker": who, "taken_utc": _iso(_now()),
        "expires_utc": _iso(_now() + timedelta(seconds=LEASE_SECONDS)),
    }, indent=2).encode()
    return storage.backend().put_if_absent(BUCKET, job.lease_key, body,
                                           "application/json")


def claim(can_run, who: str | None = None) -> Job | None:
    """Take the oldest job this host is able to finish, or None.

    `can_run(job) -> str` returns an empty string when the host can do it, or the reason
    it cannot. That is how one queue feeds a 512 MB container and a desktop at the same
    time: the container skips work it would be killed by instead of failing it.
    """
    who = who or worker_id()
    # ONE listing, used for all three questions below. It used to re-list the leases
    # once per candidate job looking for a stale one, which on a queue of twenty jobs
    # was twenty-one listings for a single claim - and a claim runs every few seconds,
    # forever, on two machines.
    leases = _leases()
    live = [l for l in leases if not _expired(l)]
    busy = {l["job"] for l in live}
    stale = {l["job"]: l["_key"] for l in leases if _expired(l)}
    generating = sum(1 for l in live if l.get("kind") == "generate")

    for job in queued():
        if job.id in busy:
            continue
        if job.kind == "generate" and generating >= MESHY_CONCURRENT:
            continue               # holding the line at Meshy's ceiling, not exceeding it
        if can_run(job):
            continue
        # An expired lease is a worker that died. Clear it so the job can move again.
        if job.id in stale:
            storage.backend().delete_prefix(BUCKET, stale[job.id])
        if _take_lease(job, who):
            return job
    return None


def heartbeat(job: Job, who: str | None = None, seconds: int | None = None) -> None:
    """Push the lease out while work is still happening.

    `seconds` sets how far out. The default is a full lease; `PENDING_SECONDS` is passed
    when a generation has been handed to the engine and we are waiting on a callback -
    holding the slot against Meshy's ceiling, but on a clock short enough that a webhook
    which never arrives is recovered in minutes rather than left for the afternoon.
    """
    who = who or worker_id()
    body = json.dumps({
        "job": job.id, "kind": job.kind, "dish": job.dish, "variant": job.variant,
        "worker": who, "taken_utc": _iso(_now()),
        "expires_utc": _iso(_now() + timedelta(
            seconds=LEASE_SECONDS if seconds is None else seconds)),
    }, indent=2).encode()
    storage.backend().put(BUCKET, job.lease_key, body, "application/json")


# ── finishing ───────────────────────────────────────────────────────

def complete(job: Job) -> None:
    b = storage.backend()
    b.delete_prefix(BUCKET, job.lease_key)
    b.delete_prefix(BUCKET, job.key)


def release(job: Job) -> None:
    """Give a job back without counting it as a failure - used when a host realises it
    cannot finish after all, or is shutting down."""
    storage.backend().delete_prefix(BUCKET, job.lease_key)


def fail(job: Job, error: str, retryable: bool = True) -> bool:
    """Record a failure. Returns True if it will be retried.

    Dead-lettering matters more than it sounds: a job that retries forever burns credits
    on every attempt, and a job that vanishes silently is money already spent with
    nothing to show. Both are worse than a list somebody has to look at.
    """
    b = storage.backend()
    job.attempts += 1
    job.last_error = error[:500]
    b.delete_prefix(BUCKET, job.lease_key)
    if retryable and job.attempts < MAX_ATTEMPTS:
        b.put(BUCKET, job.key, job.to_json(), "application/json")
        return True
    b.put(BUCKET, f"{DEAD}{job.id}.json", job.to_json(), "application/json")
    b.delete_prefix(BUCKET, job.key)
    return False


def dead() -> list[Job]:
    b = storage.backend()
    out = []
    for key in b.list_keys(BUCKET, DEAD):
        raw = b.get(BUCKET, key)
        if raw:
            try:
                out.append(Job.from_json(raw))
            except Exception:      # noqa: BLE001
                continue
    return out


def revive(job_id: str) -> bool:
    """Put a dead job back on the queue, attempts reset. For after a fix."""
    b = storage.backend()
    raw = b.get(BUCKET, f"{DEAD}{job_id}.json")
    if not raw:
        return False
    job = Job.from_json(raw)
    job.attempts = 0
    job.last_error = ""
    b.put(BUCKET, job.key, job.to_json(), "application/json")
    b.delete_prefix(BUCKET, f"{DEAD}{job_id}.json")
    return True


def stats() -> dict:
    """What the queue looks like right now, for /api/meta and the UI.

    The dead letters are listed, not just counted. A number nobody can act on is a
    number nobody looks at, and every dead `generate` is 30 credits already spent with
    nothing to show for it - the one thing in this system that must never be quiet.
    """
    leases = _leases()
    live = [l for l in leases if not _expired(l)]
    q = waiting(leases)
    gone = dead()
    return {
        "queued": len(q),
        "running": len(live),
        "generating": sum(1 for l in live if l.get("kind") == "generate"),
        "optimising": sum(1 for l in live if l.get("kind") == "optimise"),
        "dead": len(gone),
        "meshy_ceiling": MESHY_CONCURRENT,
        "oldest_waiting": q[0].created_utc if q else "",
        "dead_jobs": [{"id": j.id, "kind": j.kind, "dish": j.dish,
                       "variant": j.variant, "error": j.last_error} for j in gone],
    }
