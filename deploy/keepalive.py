#!/usr/bin/env python3
"""Keep the engine running, and say so, without anybody watching.

    python deploy/keepalive.py            # run it (this is what the logon launcher calls)
    python deploy/keepalive.py --status   # is it alive?
    python deploy/keepalive.py --once     # start the children, do not supervise (debug)

**Why this exists.** The engine was two bare processes started once at logon by a VBS
`sh.Run(..., 0, False)` - fire and forget. If either exited, nothing restarted it and
nothing said so. On 2026-09-10 the machine lost Cloudflare R2 for a while; the worker
survived (it catches per-pass errors) and the bridge, which then had no such guard, took
one exception and exited. A model request sat at `approved` for as long as anybody cared
to wait, with two idle workers beside it, and the only way to find out was to ask.

That is the whole problem this file solves. Press generate, and it generates.

**What it does.**

  restarts       a child that exits comes back, with a backoff so a genuinely broken
                 child does not spin. Crash, OOM kill, an exception nobody caught, a
                 rotated key - all the same to this: bring it back and record why.
  one instance   a lock file with a live PID in it. Running the installer twice, or a
                 second logon, does not produce a second worker - which is exactly what
                 had happened: two workers from two different Python installs, because
                 the installer started a new one without stopping the old.
  a heartbeat    written every pass to `out/engine.json` AND to the database, so the
                 developer screen can say "engine alive 8s ago" or "engine DOWN 3h" and
                 nobody has to open a terminal to find out.

**It does no work itself.** It spawns, waits, and writes a timestamp. Everything that can
fail - R2, Meshy, Postgres, big meshes - happens in the children. A supervisor that did
real work would be a supervisor that can die of real work.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import load_env                                   # noqa: E402

# Overridable for the same reason as the child list: a test must not write over the
# running engine's own state file, which is what tells `--status` and the developer
# screen whether the real engine is alive.
OUT = Path(os.environ.get("BETAREAL_KEEPALIVE_OUT") or (ROOT / "out"))
LOCK = OUT / "engine.lock"
STATE = OUT / "engine.json"
LOG = OUT / "engine.log"

#: How long a child must stay up before its backoff resets. A child that dies in two
#: seconds, forty times, is broken; one that runs for an hour and dies is a blip.
HEALTHY_SECONDS = 60
BACKOFF = [5, 10, 20, 40, 60, 120]        # seconds, then it stays at the last one
BEAT_SECONDS = 20


def children_spec() -> list[dict]:
    """What to supervise.

    Overridable through `BETAREAL_KEEPALIVE_CHILDREN` (a JSON list of the same shape) so
    that something other than the engine can be supervised - and so a test can prove the
    RESTART works without spawning a real worker. That matters: a real worker claims real
    jobs off the real queue, and a test that tidies up after itself would be killing a
    generation somebody is waiting for.
    """
    raw = os.environ.get("BETAREAL_KEEPALIVE_CHILDREN", "")
    if raw:
        return json.loads(raw)
    return CHILDREN


CHILDREN = [
    {"name": "worker",
     "argv": ["worker.py", "--generate"],
     "log": "worker.log",
     "does": "claims generate + optimise jobs off the queue"},
    {"name": "bridge",
     "argv": ["menu/model_requests.py", "--watch"],
     "log": "bridge.log",
     "does": "approved request -> queue job -> model on the menu"},
]


def say(line: str) -> None:
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    text = f"{stamp}  {line}"
    print(text, flush=True)
    try:
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    except OSError:
        pass


# ── one instance ────────────────────────────────────────────────────────────────────

def _alive(pid: int) -> bool:
    """Is this PID a running process? Windows has no signal 0, so ask the OS."""
    if pid <= 0:
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                             capture_output=True, text=True, timeout=15)
        return str(pid) in out.stdout
    except Exception:                                         # noqa: BLE001
        return False


def claim_lock() -> bool:
    """True when this process owns the engine. False when somebody else already does."""
    OUT.mkdir(parents=True, exist_ok=True)
    if LOCK.exists():
        try:
            held = int(LOCK.read_text(encoding="utf-8").strip() or 0)
        except ValueError:
            held = 0
        if held and held != os.getpid() and _alive(held):
            return False
        # A stale lock from a machine that was turned off mid-run is not a reason to
        # refuse to start - it is the normal case after a power cut.
    LOCK.write_text(str(os.getpid()), encoding="utf-8")
    return True


# ── the heartbeat ───────────────────────────────────────────────────────────────────

def beat(children: dict) -> None:
    """Say we are alive, to a file and to the database.

    Both, deliberately. The file is for `--status` on this machine and works with no
    network at all; the row is what the developer screen reads, so that somebody who is
    not sitting at this computer can tell whether the engine is up.
    """
    state = {
        "seen_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "host": socket.gethostname(),
        "pid": os.getpid(),
        "children": {n: {"pid": p.pid, "up": p.poll() is None,
                         "restarts": c["restarts"]}
                     for n, (p, c) in children.items()},
    }
    try:
        STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except OSError:
        pass

    detail = ", ".join(f"{n} {'up' if v['up'] else 'DOWN'}"
                       + (f" ({v['restarts']} restarts)" if v["restarts"] else "")
                       for n, v in state["children"].items())
    _beat_db(state["host"], detail)


def _beat_db(host: str, detail: str) -> None:
    """Best effort, always. A database we cannot reach is the thing the engine is FOR -
    it must never be a reason the engine stops running."""
    url = os.environ.get("SUPABASE_DB_URL", "")
    if not url:
        return
    try:
        import psycopg
        with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
            cur.execute(
                "insert into engine_heartbeat (id, seen_utc, host, detail) "
                "values ('engine', now(), %s, %s) "
                "on conflict (id) do update set seen_utc = now(), "
                "host = excluded.host, detail = excluded.detail",
                (host, detail))
            conn.commit()
    except Exception:                                         # noqa: BLE001
        pass


# ── running the children ────────────────────────────────────────────────────────────

def spawn(child: dict) -> subprocess.Popen:
    log = OUT / child["log"]
    log.parent.mkdir(parents=True, exist_ok=True)
    fh = log.open("a", encoding="utf-8", buffering=1)
    argv = [sys.executable, *[str(ROOT / a) if a.endswith(".py") else a
                              for a in child["argv"]]]
    # No `--log`: the child's stdout goes straight into the same file, which means a
    # child that dies before it can open its own log still leaves the reason behind.
    return subprocess.Popen(argv, cwd=str(ROOT), stdout=fh, stderr=subprocess.STDOUT)


def status() -> int:
    if not STATE.exists():
        print("engine: never started (no out/engine.json)")
        return 1
    s = json.loads(STATE.read_text(encoding="utf-8"))
    seen = datetime.datetime.fromisoformat(s["seen_utc"])
    age = (datetime.datetime.now(datetime.timezone.utc) - seen).total_seconds()
    live = _alive(int(s.get("pid", 0))) and age < BEAT_SECONDS * 3
    print(f"engine: {'ALIVE' if live else 'DOWN'}  (last beat {int(age)}s ago, "
          f"pid {s.get('pid')}, host {s.get('host')})")
    for name, c in s.get("children", {}).items():
        print(f"  {name:<8} {'up' if c['up'] else 'DOWN':<5} pid {c['pid']}"
              + (f"  {c['restarts']} restarts" if c["restarts"] else ""))
    return 0 if live else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="is the engine alive?")
    ap.add_argument("--once", action="store_true",
                    help="start the children and exit, without supervising")
    # Accepted because the logon launcher appends it to every command it writes. The
    # bridge once exited instantly at every logon for exactly this reason - argparse
    # rejected an unknown flag, and "not running" was the only symptom. Our own output
    # already goes to out/engine.log, so this only has to be tolerated.
    ap.add_argument("--log", default=None, help=argparse.SUPPRESS)
    a = ap.parse_args()

    if a.status:
        return status()

    load_env()
    if not claim_lock():
        say("another engine is already running - this one is exiting, which is the "
            "point of the lock")
        return 0

    say(f"engine up (pid {os.getpid()}, python {sys.version.split()[0]})")
    children: dict = {}
    for c in children_spec():
        c = {**c, "restarts": 0, "started": time.time()}
        children[c["name"]] = (spawn(c), c)
        say(f"  started {c['name']}: {c['does']}")

    if a.once:
        return 0

    last_beat = 0.0
    try:
        while True:
            for name, (proc, c) in list(children.items()):
                if proc.poll() is None:
                    continue
                # It exited. Everything below is about coming back.
                up_for = time.time() - c["started"]
                if up_for > HEALTHY_SECONDS:
                    c["restarts"] = 0           # it was fine for a while; forgive it
                wait = BACKOFF[min(c["restarts"], len(BACKOFF) - 1)]
                c["restarts"] += 1
                say(f"  {name} exited (code {proc.returncode}) after {int(up_for)}s "
                    f"- restarting in {wait}s [restart #{c['restarts']}]")
                time.sleep(wait)
                c["started"] = time.time()
                children[name] = (spawn(c), c)
                say(f"  {name} restarted")

            if time.time() - last_beat > BEAT_SECONDS:
                beat(children)
                last_beat = time.time()
            time.sleep(2)
    except KeyboardInterrupt:
        say("stopping")
        for name, (proc, _c) in children.items():
            proc.terminate()
        return 0
    finally:
        try:
            if LOCK.exists() and LOCK.read_text(encoding="utf-8").strip() == str(os.getpid()):
                LOCK.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
