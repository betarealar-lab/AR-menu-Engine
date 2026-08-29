"""What this container can actually do, and refusing work it cannot.

Written after Render OOM-killed the Scan Studio on 2026-08-29. The generation had
succeeded; the optimiser then asked for ~650 MB inside a 512 MB container, the whole
instance was killed, and because a killed process cannot write anything the job left no
error, no log line and no way back - just a spinner that ran for twenty minutes.

The lesson is not "use a bigger box". It is that **the process did not know its own
limits**, so it could not tell the difference between work it could do and work that
would kill it. A job that cannot fit must say so, in one second, in a sentence that names
the number - not die silently twenty minutes in.

Two things live here:

  1. What the container is allowed to use, read from cgroups at runtime rather than
     assumed from whatever the host's dashboard said when someone signed up.
  2. What the optimiser will need, estimated from the master's triangle count.

Both are reported on /healthz, so the limit is visible before a dish is ever uploaded.
"""
from __future__ import annotations

import os
from pathlib import Path

try:                                  # Unix only; the Studio also runs on a Windows laptop
    import resource
except ImportError:                   # pragma: no cover - Windows
    resource = None

# ── measured, not guessed ───────────────────────────────────────────
#
# Peak RSS of the glTF-Transform geometry pass, sampled at 40 ms on the real Meshy
# masters (2026-08-29):
#
#     1,902,278 triangles (69.6 MB master)    648.5 MB
#       300,538 triangles (26.0 MB)           357.3 MB
#     gltfpack on the same 1.9M master        521.6 MB   <- no better, also over
#
# A straight line through those two points. Two points is a weak fit and the intercept
# is doing most of the work, so it is used only to REFUSE obviously impossible jobs,
# never to promise that a borderline one will succeed. Add measurements here as they
# are taken; the model gets better for free.
GEOMETRY_BASE_MB = 303.0
GEOMETRY_MB_PER_1K_TRIANGLES = 0.182

# What the Python side needs alongside it: interpreter, boto3, the texture pass, and
# room for the OS. Measured at 28-78 MB peak for the pipeline itself; the rest is slack,
# because being wrong in this direction only costs a dish that could have been optimised,
# while being wrong the other way kills the container.
OVERHEAD_MB = 150.0


def estimate_optimise_mb(triangles: int) -> float:
    """Peak resident memory the geometry pass will want, in MB, for this many triangles."""
    return GEOMETRY_BASE_MB + GEOMETRY_MB_PER_1K_TRIANGLES * (max(0, triangles) / 1000.0)


def max_triangles(limit_mb: float) -> int:
    """The largest master that fits, inverted from the same line."""
    room = limit_mb - OVERHEAD_MB - GEOMETRY_BASE_MB
    return max(0, int(room / GEOMETRY_MB_PER_1K_TRIANGLES * 1000))


# ── what this container is allowed to use ───────────────────────────

_CGROUP_V2 = Path("/sys/fs/cgroup/memory.max")
_CGROUP_V1 = Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")
# Anything at or above this is the kernel's "no limit" sentinel, not a real ceiling.
_UNLIMITED = 1 << 62


def memory_limit_bytes() -> int | None:
    """The container's memory ceiling, or None when there is not one to read.

    Read from cgroups, because that is the number that actually kills the process. The
    plan named on a dashboard is a billing fact; this is an operational one, and they
    disagree more often than anyone expects. Returns None on Windows and on any host
    without cgroups - a laptop has no ceiling worth enforcing.
    """
    override = os.environ.get("MEMORY_LIMIT_MB", "").strip()
    if override.isdigit():
        return int(override) * 1024 * 1024
    for path in (_CGROUP_V2, _CGROUP_V1):
        try:
            raw = path.read_text().strip()
        except OSError:
            continue
        if raw == "max":
            return None
        try:
            value = int(raw)
        except ValueError:
            continue
        if 0 < value < _UNLIMITED:
            return value
    return None


def memory_used_bytes() -> int | None:
    """This process's own resident size, for reporting rather than for decisions."""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except OSError:
        pass
    return None


def peak_child_mb() -> float:
    """Peak RSS of the largest subprocess this process has reaped so far, in MB.

    `ru_maxrss` is cumulative across every child, so it only ever climbs - which is
    exactly what is wanted: after a run it holds the high-water mark of the heaviest
    thing the optimiser has done. Recorded into export_stats so the estimates above
    become measurements instead of staying a two-point guess.
    """
    if resource is None:
        return 0.0
    try:
        raw = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    except (AttributeError, OSError, ValueError):
        return 0.0
    # Linux reports kilobytes, macOS bytes. Nothing this pipeline runs has a peak in
    # the gigabytes, so a value that large is the unit giveaway.
    return round(raw / 1048576.0, 1) if raw > (1 << 30) else round(raw / 1024.0, 1)


def budget_mb() -> float | None:
    """How much this container may use, in MB. None when unbounded."""
    limit = memory_limit_bytes()
    return None if limit is None else limit / 1048576.0


def check_optimise(triangles: int) -> str:
    """Empty when the job fits. Otherwise the reason, written for the person who has to
    act on it - naming what was needed, what exists, and what to do about it."""
    limit = budget_mb()
    if limit is None:
        return ""
    need = estimate_optimise_mb(triangles) + OVERHEAD_MB
    if need <= limit:
        return ""
    return (
        f"This master is {triangles:,} triangles and the optimiser needs about "
        f"{need:.0f} MB for it. This container has {limit:.0f} MB, so the run would be "
        f"killed rather than finish - and a killed run cannot report anything. "
        f"Nothing is lost: the master is stored and still viewable. "
        f"Either give the service more memory (about {need * 1.25:.0f} MB is comfortable) "
        f"or generate at a lower polycount - this box tops out near "
        f"{max_triangles(limit):,} triangles."
    )


def describe() -> str:
    """One line for /healthz and startup, so the ceiling is visible before it is hit."""
    limit = budget_mb()
    if limit is None:
        return "memory=unbounded"
    return f"memory={limit:.0f}MB max_triangles~{max_triangles(limit):,}"
