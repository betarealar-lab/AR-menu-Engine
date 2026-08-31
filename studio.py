#!/usr/bin/env python3
r"""BetaReal Scan Studio - judge whether an AI model of a dish is good enough to show a guest.

    python studio.py                    laptop, local disk
    python studio.py --port 8765        http://localhost:8765

Hosted, it reads R2 and Meshy credentials from the environment and several people share
one key. Locally it falls back to a folder, so nothing has to change to work offline.

A VARIANT is one angle strategy for one dish - ring-25, ring-45, three-plus-top. The same
dish shot four ways is four experiments, and which angles win is the open question the
engine comparison cannot answer.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import csv
import datetime
import hmac
import io
import json
import os
import shutil
import threading
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import dataset
import engines
import glb
from engines import images
import limits
import optimize
import storage
from config import load_env
from engines import Job

ROOT = Path(__file__).resolve().parent
SLOTS = dataset.SLOTS

# Why a dish failed. The real output: after ~30 dishes these say which food is scannable,
# what the capture guide must warn about, and which venues to sell to.
FAULTS = [
    "glare / specular sauce", "thin or fine structure", "transparent / liquid",
    "dark or low contrast", "cluttered background", "deep bowl, hidden interior",
    "tall or stacked", "uniform texture", "reflective tableware", "inconsistent grade",
]

RUNNING: set[tuple[str, ...]] = set()
RUN_LOCK = threading.Lock()

# A run this process has no thread for is a GHOST: the record says `optimising` but the
# worker that wrote it is gone - the container restarted, was redeployed, or was killed.
# RUNNING lives in memory, so it empties on restart while the record does not, and the
# old guards then refused to start a new run forever. That wedged the first real dish on
# 2026-08-29 with no error and no way back. Until there is a real job queue (ROADMAP 1.2)
# this is the recovery: if nothing is running here, the record is not to be believed.
STALE_AFTER_SECONDS = 300

# Jobs run INSIDE the request that asked for them, not on a detached thread.
#
# A thread that outlives its request is only safe on a host that keeps the process alive
# and scheduled for as long as the thread needs. Render did not - the container was
# OOM-killed and the work vanished. Cloud Run does not either: CPU is allocated for the
# duration of a request, and an instance with no request in flight can be throttled to
# nothing or shut down entirely. Both hosts break the same assumption, so the assumption
# goes rather than the host.
#
# Generation is ~3 minutes and optimisation ~10 seconds; both fit inside a request with
# room to spare, and the page already polls the record for progress. What this does not
# survive is the tab being closed mid-generation. The real answer to that is the job
# queue in ROADMAP 1.2 - a `jobs` table and a worker - and this is the honest interim:
# work that is either done or visibly not done, never silently lost.
INLINE_JOBS = os.environ.get("JOBS", "inline").strip().lower() != "thread"


# The balance is an external call, and /api/meta runs on every page load. Cached, so
# opening the Studio does not cost a round trip to Meshy every time.
_BALANCE: dict = {"credits": None, "at": 0.0}
BALANCE_TTL = 120.0


def credits_left() -> int | None:
    import time as _time
    if _time.time() - _BALANCE["at"] < BALANCE_TTL:
        return _BALANCE["credits"]
    try:
        from engines.meshy import balance
        _BALANCE["credits"] = balance()
    except Exception:      # noqa: BLE001
        _BALANCE["credits"] = None
    _BALANCE["at"] = _time.time()
    return _BALANCE["credits"]


def webhook_secret() -> str:
    """The secret path segment Meshy calls us on, or empty when nobody can call us.

    Empty is the honest default: a laptop has no address the internet can reach, so the
    Studio waits through generation there instead of submitting into silence.
    """
    return os.environ.get("MESHY_WEBHOOK_SECRET", "").strip()


def _dispatch(fn, *args) -> None:
    if INLINE_JOBS:
        fn(*args)
    else:
        threading.Thread(target=fn, args=args, daemon=True).start()


def _is_ghost(rec: dict, key: tuple[str, ...]) -> bool:
    if rec.get("status") != "optimising":
        return False
    with RUN_LOCK:
        if key in RUNNING:
            return False
    return True


def _model_key(rec: dict, stage: str) -> str:
    """Which GLB to hand back.

    `ship` is the default and the point of the whole exercise: review must load the
    optimised, real-size file, because that is what a guest gets. A master that looks
    perfect while the optimiser has eaten the garnish is a false pass, and at ~216 MB of
    VRAM against ~52 MB it is also what drops the tab on a mid-range Android.

    `master` stays reachable so a contested verdict can be checked against the original -
    the only honest way to tell "the engine got it wrong" from "the optimiser did".
    """
    cat = rec.get("catalog_keys") or {}
    if stage == "master":
        return rec.get("model_key", "")
    return cat.get("draco") or cat.get("opt") or rec.get("model_key", "")


def users() -> dict[str, str]:
    """STUDIO_USERS='temo:pass,niko:pass'. Empty means open - fine on a laptop, never hosted."""
    raw = os.environ.get("STUDIO_USERS", "").strip()
    out = {}
    for pair in raw.split(","):
        if ":" in pair:
            n, _, p = pair.partition(":")
            out[n.strip()] = p.strip()
    return out


class Handler(BaseHTTPRequestHandler):
    engine_name: str
    out_dir: Path

    def log_message(self, fmt, *a):
        pass

    # ---------- auth ----------

    def whoami(self) -> str | None:
        """Returns the username, or None if the request should be challenged."""
        accounts = users()
        if not accounts:
            return "local"
        hdr = self.headers.get("Authorization", "")
        if hdr.startswith("Basic "):
            try:
                name, _, pw = base64.b64decode(hdr[6:]).decode().partition(":")
            except (binascii.Error, UnicodeDecodeError):
                return None
            if accounts.get(name) and accounts[name] == pw:
                return name
        return None

    def challenge(self) -> None:
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="BetaReal Scan Studio"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---------- plumbing ----------

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _read(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _q(self) -> dict:
        return {k: v[0] for k, v in
                urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}

    # ---------- GET ----------

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        # The platform's health probe cannot send credentials, so it has to sit in front
        # of the auth check. It reveals nothing - a literal "ok" and the storage mode.
        if path.startswith("/hook/"):
            return self._hook(path)
        if path == "/healthz":
            # Storage backend and optimiser toolchain, both non-sensitive, so a deploy can
            # be verified from outside without handing anyone a login.
            # The memory ceiling belongs here too. It is the number that decides whether
            # this host can optimise a real master at all, and it was invisible until a
            # container was killed by it.
            body = (f"ok storage={storage.backend().kind} "
                    f"optimizer={optimize.toolchain() or 'none'} {limits.describe()}")
            return self._send(200, body.encode(), "text/plain")
        who = self.whoami()
        if who is None:
            return self.challenge()
        try:
            if path == "/":
                return self._send(200, (ROOT / "web" / "studio.html").read_bytes(),
                                  "text/html; charset=utf-8")
            if path == "/api/meta":
                return self._json({
                    "faults": FAULTS, "slots": SLOTS, "slot_role": dataset.SLOT_ROLE,
                    "shapes": dataset.SHAPES, "scale_axes": dataset.SCALE_AXES,
                    "triangle_targets": dataset.TRIANGLE_TARGETS,
                    "texture_targets": dataset.TEXTURE_TARGETS,
                    "credits": credits_left(),
                    "engines": [self._engine_meta(n) for n in engines.REGISTRY],
                    "default_engine": self.engine_name,
                    "storage": storage.describe(), "you": who,
                    "optimizer": optimize.describe(),
                })
            if path == "/api/dishes":
                return self._json({"dishes": self._dishes()})
            if path == "/api/photos":
                return self._json({"items": self._photos()})
            if path == "/api/library":
                return self._json({"items": self._library()})
            if path == "/thumb":
                q = self._q()
                rec = dataset.record(q["dish"], q.get("variant", "default"))
                return self._serve(dataset.MODELS,
                                   rec.get("master_keys", {}).get("png", ""), "image/png")
            if path == "/api/dish":
                q = self._q()
                # Reading a dish is also when we notice one that has gone quiet.
                self._nudge(dataset.record(q["dish"], q.get("variant", "default")))
                return self._json(self._detail(q["dish"], q.get("variant", "default")))
            if path == "/frame":
                q = self._q()
                key = dataset.frame_key(q["dish"], q["variant"], int(q["slot"]))
                return self._serve(dataset.PHOTOS, key, "image/jpeg")
            if path == "/model":
                q = self._q()
                rec = dataset.record(q["dish"], q.get("variant", "default"))
                return self._serve(dataset.MODELS, _model_key(rec, q.get("stage", "ship")),
                                   "model/gltf-binary")
            if path == "/download":
                q = self._q()
                return self._bundle(q["dish"], q.get("variant", "default"),
                                    q.get("master") == "1")
            if path == "/api/export":
                # Named and marked as an attachment, so it downloads as a file rather
                # than being rendered as text in a tab - and so the file on disk says
                # what it is without being renamed.
                body = self._csv().encode()
                stamp = dataset._now()[:10]
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Disposition",
                                 f'attachment; filename="betareal-dishes-{stamp}.csv"')
                self.end_headers()
                return self.wfile.write(body)
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    # ---------- POST ----------

    def do_POST(self) -> None:
        if self.path.split("?")[0].startswith("/hook/"):
            return self._hook(self.path.split("?")[0])
        who = self.whoami()
        if who is None:
            return self.challenge()
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._read()
            dish, variant = body.get("dish", ""), body.get("variant", "default")

            if path == "/api/upload":
                raw = body["data"].split(",", 1)[-1]
                rec = dataset.save_frame(dish, variant, int(body["slot"]),
                                         base64.b64decode(raw), body.get("name", ""), who)
                return self._json(self._shape(rec))
            if path == "/api/clear-frame":
                return self._json(self._shape(
                    dataset.clear_frame(dish, variant, int(body["slot"]))))
            if path == "/api/rename":
                n = dataset.rename(dish, body.get("title", ""))
                return self._json({"ok": True, "variants": n})
            if path == "/api/delete":
                dataset.delete(dish, body.get("only_variant"))
                return self._json({"ok": True})
            if path == "/api/verdict":
                rec = dataset.record(dish, variant)
                rec.update(verdict=body.get("verdict", ""), faults=body.get("faults", []),
                           note=body.get("note", ""), judged_by=who,
                           judged_utc=dataset._now())
                dataset.write(rec)
                return self._json({"ok": True})
            if path == "/api/scale":
                # Setting a size re-runs the optimiser, because scale is baked into the
                # shipped file rather than applied by the viewer. Five seconds, no credits.
                rec = dataset.record(dish, variant)
                cm = float(body.get("cm") or 0)
                axis = body.get("axis", "width")
                if cm and axis not in dataset.SCALE_AXES:
                    return self._json({"error": f"unknown dimension {axis!r}"}, 400)
                if cm and not 1 <= cm <= 200:
                    return self._json({"error": "A dish is between 1 and 200 cm."}, 400)
                rec["scale"] = {"axis": axis, "cm": cm, "shape": body.get("shape", ""),
                                "set_by": who, "set_utc": dataset._now()} if cm else {}
                key = (dataset.slug(dish), dataset.slug(variant), "opt")
                live = rec["status"] in ("running", "optimising") and not _is_ghost(rec, key)
                if rec.get("model_key") and not live:
                    rec.update(status="optimising", stage="queued",
                               optimising_since=dataset._now())
                    dataset.write(rec)
                    _dispatch(self._optimize, dish, variant, who)
                else:
                    dataset.write(rec)
                return self._json(self._shape(dataset.record(dish, variant)))
            if path == "/api/new-dish":
                # A dish has to EXIST to appear in the list. Creating it client-side
                # only meant the name was typed, nothing was written, and the rail went
                # on showing whatever was selected before - which reads exactly like the
                # button not working.
                rec = dataset.record(dish, variant)
                if rec.get("frames") or rec.get("model_key"):
                    return self._json({"error": "That dish and variant already exist."}, 409)
                rec["created_by"] = who
                dataset.write(rec)
                return self._json(self._shape(rec))
            if path == "/api/settings":
                rec = dataset.record(dish, variant)
                tri = int(body.get("triangles") or 0)
                tex = int(body.get("texture") or 0)
                if tri and not 2_000 <= tri <= 500_000:
                    return self._json({"error": "Triangles must be between 2,000 and "
                                                "500,000."}, 400)
                if tex and tex not in dataset.TEXTURE_TARGETS:
                    return self._json({"error": f"Texture must be one of "
                                                f"{dataset.TEXTURE_TARGETS}."}, 400)
                rec["optimise"] = {k: v for k, v in
                                   (("triangles", tri), ("texture", tex)) if v}
                dataset.write(rec)
                # Settings only mean anything once they are applied, so applying them is
                # the same action - five seconds, no credits.
                if rec.get("model_key") and rec["status"] not in ("running", "optimising"):
                    rec.update(status="optimising", stage="queued",
                               optimising_since=dataset._now())
                    dataset.write(rec)
                    _dispatch(self._optimize, dish, variant, who)
                return self._json(self._shape(dataset.record(dish, variant)))
            if path == "/api/multiview":
                # Predicts three further angles from the one photograph that exists and
                # fills the empty slots with them. Refused when there is already more
                # than one frame: a real photograph beats a predicted one every time,
                # and this must never quietly overwrite one.
                rec = dataset.record(dish, variant)
                filled = sorted(int(k) for k in rec.get("frames", {}))
                if len(filled) != 1:
                    return self._json({"error":
                        "Multi-view works from exactly one photo. This dish has "
                        f"{len(filled)}." if filled else
                        "Upload a photo first."}, 400)
                if rec.get("status") in ("running", "optimising"):
                    return self._json({"error": "Something is already running."}, 400)

                source = filled[0]
                blob = dataset.read_frame(dish, variant, source)
                if not blob:
                    return self._json({"error": "The photo is missing from storage."}, 400)

                before = credits_left()
                views, err = images.multiview(blob)
                _BALANCE["at"] = 0.0            # the balance just changed; re-read it
                after = credits_left()
                if err:
                    return self._json({"error": err}, 502)

                slots = [i for i in range(4) if i != source][:len(views)]
                for slot, view in zip(slots, views):
                    dataset.save_frame(dish, variant, slot, view,
                                       f"generated from {dataset.SLOTS[source]}",
                                       who, generated_from=source)
                out = self._shape(dataset.record(dish, variant))
                out["generated"] = len(slots)
                out["spent"] = (before - after) if (before and after) else None
                return self._json(out)
            if path == "/api/archive":
                rec = dataset.record(dish, variant)
                rec["archived"] = bool(body.get("archived", True))
                dataset.write(rec)
                return self._json(self._shape(rec))
            if path == "/api/cancel":
                # Stops OUR half immediately: nothing will be collected, optimised or
                # stored for this run. What it cannot do is un-spend credits once Meshy
                # has started work - their rule is a full refund while a task is still
                # queued, and nothing once processing begins. So this is worth pressing
                # quickly and worth pressing anyway, because a cancelled dish that keeps
                # optimising is a second waste on top of the first.
                rec = dataset.record(dish, variant)
                if rec.get("status") not in ("running", "optimising"):
                    return self._json({"error": "Nothing is running for this dish."}, 400)
                rec.update(status="cancelled", stage="", optimising_since="",
                           cancelled_utc=dataset._now(), cancelled_by=who,
                           error="Cancelled." + (
                               " Meshy had already been asked to generate, so credits may"
                               " still have been spent." if rec.get("task_id") else ""))
                dataset.write(rec)
                with RUN_LOCK:
                    RUNNING.discard((dataset.slug(dish), dataset.slug(variant)))
                    RUNNING.discard((dataset.slug(dish), dataset.slug(variant), "opt"))
                return self._json(self._shape(dataset.record(dish, variant)))
            if path == "/api/optimize":
                rec = dataset.record(dish, variant)
                if not rec.get("model_key"):
                    return self._json({"error": "Nothing generated yet."}, 400)
                key = (dataset.slug(dish), dataset.slug(variant), "opt")
                if rec["status"] in ("running", "optimising") and not _is_ghost(rec, key):
                    return self._json({"status": rec["status"]})
                rec.update(status="optimising", stage="queued", export_error="",
                           optimising_since=dataset._now())
                dataset.write(rec)
                _dispatch(self._optimize, dish, variant, who)
                return self._json({"ok": True})
            if path == "/api/generate":
                key = (dataset.slug(dish), dataset.slug(variant))
                rec = dataset.record(dish, variant)
                # Meshy takes 1-4 images. Four is better, one is a real generation, and
                # refusing three because it is not four just wastes a dish someone shot.
                if not rec["frames"]:
                    return self._json({"error": "Upload at least one frame first."}, 400)
                # A re-run overwrites the master in place. Judge one "good", re-run
                # hoping for better, get worse, and the good one is gone along with the
                # 30 credits that made it - which is exactly what happened on
                # 2026-09-02. Until ROADMAP 1.3 keys masters by run, the protection is
                # to refuse unless the caller says explicitly that it meant it.
                if rec.get("model_key") and not body.get("replace"):
                    return self._json({
                        "error": "This dish already has a model, and generating again "
                                 "REPLACES it - the current one cannot be recovered. "
                                 "Use Regenerate if that is what you want.",
                        "needs_replace": True}, 409)
                with RUN_LOCK:
                    if key in RUNNING:
                        return self._json({"status": "running"})
                    RUNNING.add(key)
                rec.update(status="running", error="", model_key="")
                dataset.write(rec)
                _dispatch(self._generate, dish, variant, body.get("engine"), who)
                return self._json({"ok": True})
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    # ---------- work ----------

    def _hook(self, path: str) -> None:
        """Meshy calling to say a task changed.

        Two things make this safe to expose without a login:

        The path carries a secret only we and Meshy know (MESHY_WEBHOOK_SECRET), so an
        unaddressed scan of the internet does not find it.

        And **the body is never believed**. Meshy documents no signature, no shared
        secret and no IP allowlist for deliveries, so a payload arriving here proves
        nothing about who sent it. We take one thing from it - a task id - and then ask
        Meshy ourselves, with our own key, over TLS. Someone who guesses the URL and
        forges a body can make us check a task early. That is all.
        """
        secret = os.environ.get("MESHY_WEBHOOK_SECRET", "").strip()
        given = path[len("/hook/"):].strip("/")
        if not secret or not hmac.compare_digest(given, secret):
            return self._send(404, b"not found", "text/plain")

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        task_id = ""
        try:
            body = json.loads(raw or b"{}")
            task_id = str(body.get("id") or body.get("result") or
                          (body.get("data") or {}).get("id") or "")
        except Exception:  # noqa: BLE001 - a body we cannot read is not worth an error
            pass
        # Answer before doing any work. Meshy wants a status under 400 and will disable
        # a webhook that keeps failing or timing out; whether OUR pipeline then succeeds
        # is our problem, not a reason for them to stop calling.
        self._send(200, b"ok", "text/plain")
        if task_id:
            threading.Thread(target=self._resume, args=(task_id,), daemon=True).start()

    # A webhook that never arrives must not strand a dish. Meshy can disable a webhook
    # after repeated delivery failures, a deploy can land in the wrong second, and a
    # network can simply eat one. So the page's own polling doubles as a safety net:
    # if a submitted dish has been quiet for longer than a generation usually takes,
    # ask Meshy directly. Cheap, because it only fires for records actually in flight.
    NUDGE_AFTER_SECONDS = 45

    def _nudge(self, rec: dict) -> None:
        if rec.get("status") != "running" or not rec.get("task_id"):
            return                           # includes cancelled - never nudge those
        since = rec.get("submitted_utc") or ""
        try:
            age = (datetime.datetime.now(datetime.timezone.utc)
                   - datetime.datetime.fromisoformat(since)).total_seconds()
        except ValueError:
            age = self.NUDGE_AFTER_SECONDS + 1
        if age < self.NUDGE_AFTER_SECONDS:
            return
        key = (dataset.slug(rec["dish"]), dataset.slug(rec["variant"]))
        with RUN_LOCK:
            if key in RUNNING:
                return
        threading.Thread(target=self._resume, args=(rec["task_id"],),
                         daemon=True).start()

    def _resume(self, task_id: str) -> None:
        """Turn a ticket into files. Safe to call twice for the same task."""
        owner = dataset.owner_of_task(task_id)
        if not owner:
            return
        dish, variant = owner
        key = (dataset.slug(dish), dataset.slug(variant))
        with RUN_LOCK:
            if key in RUNNING:
                return
            RUNNING.add(key)
        tmp = self.out_dir / "_run" / f"{key[0]}--{key[1]}"
        try:
            rec = dataset.record(dish, variant)
            if rec.get("status") == "cancelled":
                return                       # abandoned; do not spend work finishing it
            if rec.get("model_key") and rec.get("task_id") == task_id:
                return                       # already collected; a duplicate delivery
            engine = engines.build(rec.get("engine") or self.engine_name)
            tmp.mkdir(parents=True, exist_ok=True)
            res = engine.collect(task_id, key[0], tmp)
            if res.pending:
                rec = dataset.record(dish, variant)
                if res.expires_utc:
                    rec["engine_expires_utc"] = res.expires_utc
                if rec.get("status") == "running":
                    rec["stage"] = f"generating {res.progress}%" if res.progress else "generating"
                    dataset.write(rec)
                return                       # not finished; another call will come
            self._store_result(dish, variant, res, rec.get("generated_by", ""))
        except Exception as e:  # noqa: BLE001
            rec = dataset.record(dish, variant)
            rec.update(status="failed", error=f"{type(e).__name__}: {e}")
            dataset.write(rec)
        finally:
            with RUN_LOCK:
                RUNNING.discard(key)
            shutil.rmtree(tmp, ignore_errors=True)

    def _store_result(self, dish: str, variant: str, result, who: str) -> None:
        """Engine output -> masters in R2 -> optimise. Shared by both paths."""
        rec = dataset.record(dish, variant)
        rec["seconds"] = result.seconds or rec.get("seconds", 0)
        if not result.ok:
            rec.update(status="failed", error=result.error)
            dataset.write(rec)
            return
        masters = {}
        for ext, path in result.files.items():
            kind = "png" if ext == "thumb" else ext
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
        rec.update(status="optimising", stage="queued",
                   optimising_since=dataset._now())
        dataset.write(rec)
        self._optimize(dish, variant, who)

    def _generate(self, dish: str, variant: str, engine_name: str | None, who: str) -> None:
        """Hand the dish to the engine.

        Where a callback can reach us (MESHY_WEBHOOK_SECRET set), this SUBMITS and
        returns. Generation is ~175 seconds of Meshy's GPU and none of ours; waiting
        through it held a whole container - two gigabytes, doing nothing - and made
        every dish cost thirteen times the compute it needs. It also meant a closed
        tab, a deploy or a reclaimed instance destroyed work that was already paid for.

        Where no callback can reach us - a laptop, `runner.py` - it falls back to
        waiting, because that is better than never finishing.
        """
        name = engine_name or self.engine_name
        key = (dataset.slug(dish), dataset.slug(variant))
        # Per variant: the finally clause empties this directory, and two dishes
        # generating at once would delete each other's staged frames mid-call.
        tmp = self.out_dir / "_run" / f"{key[0]}--{key[1]}"
        release = True
        try:
            engine = engines.build(name)
            # Engines take file paths, so stage the frames locally for the call only.
            tmp.mkdir(parents=True, exist_ok=True)
            paths = []
            for i, blob in enumerate(dataset.frames(dish, variant)):
                path = tmp / f"{key[0]}-{key[1]}-{i}.jpg"
                path.write_bytes(blob)
                paths.append(path)

            job = Job(dish=key[0], images=paths)
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
                    return
                # The ticket is recorded BEFORE anything else can happen, and indexed
                # so a callback can find its way home. If this process dies in the next
                # second, the dish is still recoverable and the credits are not lost.
                rec.update(task_id=started.task_id, submitted_utc=dataset._now(),
                           status="running", error="")
                dataset.write(rec)
                dataset.claim_task(started.task_id, dish, variant)
                return

            result = engine.generate(job, tmp)
            rec = dataset.record(dish, variant)
            rec["task_id"] = result.task_id
            dataset.write(rec)
            self._store_result(dish, variant, result, who)
        except Exception as e:  # noqa: BLE001
            rec = dataset.record(dish, variant)
            rec.update(status="failed", error=f"{type(e).__name__}: {e}")
            dataset.write(rec)
        finally:
            if release:
                with RUN_LOCK:
                    RUNNING.discard(key)
            for f in tmp.glob("*"):
                try:
                    f.unlink()
                except OSError:
                    pass

    # 8 MB of GLB at a time. Big enough that a 70 MB master is ~9 writes, small enough
    # that the process never holds a whole model in memory to hand it to a browser.
    CHUNK = 1 << 23

    def _serve(self, bucket: str, key: str, ctype: str) -> None:
        """Stream the object from our own origin, in chunks.

        This used to redirect to a signed R2 URL, to keep model traffic off the app
        server. It also stopped the 3D viewer from ever displaying anything on the
        hosted Studio: **R2 answers a signed request with the bytes and no
        Access-Control-Allow-Origin header**, so the browser fetches the model, applies
        the same-origin rule, discards it, and leaves an empty panel. It looked like a
        broken viewer. It was a missing header, and it was invisible in every local test
        because local disk has no signed URL to redirect to - it always streamed, always
        same-origin, always worked.

        Same-origin bytes cannot fail that way. The bandwidth argument was real but it
        was about diners, and diners never touch this app - they load models from the
        public catalogue over Cloudflare's CDN. This is five people judging dishes.
        """
        if not key:
            return self._send(404, b"not found", "text/plain")
        body, size = storage.backend().stream(bucket, key)
        if body is None:
            return self._send(404, b"not found", "text/plain")
        try:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            if size:
                self.send_header("Content-Length", str(size))
            # The URL carries a version marker, so a model may be cached hard; a record
            # that is re-optimised changes that marker and busts it.
            self.send_header("Cache-Control", "private, max-age=300")
            self.end_headers()
            while True:
                chunk = body.read(self.CHUNK)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass                      # someone navigated away mid-download; not an error
        finally:
            try:
                body.close()
            except Exception:         # noqa: BLE001 - closing a stream must never raise
                pass

    def _optimize(self, dish: str, variant: str, who: str) -> None:
        """Master -> the files a menu ships, at real-world size.

        Runs automatically after generation, again whenever the scale changes, and by
        hand from the rail. Always lands on `review`: if it fails, the master is still
        there and still judgeable, it just is not shippable yet.

        Only one run per variant at a time, and a size typed WHILE one is running is not
        lost - the loop re-reads the record afterwards and runs again if the number moved.
        Without that, changing 28 to 35 mid-run would save the 35, ship the 28, and show
        no sign of the disagreement.
        """
        key = (dataset.slug(dish), dataset.slug(variant), "opt")
        with RUN_LOCK:
            if key in RUNNING:
                return
            RUNNING.add(key)
        # Per variant, not shared: two dishes optimising at once would otherwise write
        # into one directory and rmtree it from under each other.
        tmp = self.out_dir / "_opt" / f"{key[0]}--{key[1]}"
        try:
            for _ in range(3):
                rec = dataset.record(dish, variant)
                if rec.get("status") == "cancelled":
                    return
                applied = rec.get("scale") or {}
                if not self._optimize_once(dish, variant, who, rec, applied, tmp):
                    return
                after = dataset.record(dish, variant)
                if (after.get("scale") or {}) == applied:
                    return
                # The size moved while that pass ran. Go back to `optimising` before
                # running again, so the page keeps polling instead of showing a file
                # it is about to replace.
                after.update(status="optimising", stage="queued",
                             optimising_since=dataset._now())
                dataset.write(after)
            # Three passes and the size is still moving under us. Stop chasing it, but
            # never leave the record saying `optimising` with nothing running - that is
            # a spinner the page polls forever.
            rec = dataset.record(dish, variant)
            rec.update(status="review", stage="", optimising_since="")
            dataset.write(rec)
        except Exception as e:  # noqa: BLE001
            rec = dataset.record(dish, variant)
            rec.update(status="review", stage="", optimising_since="",
                       export_error=f"{type(e).__name__}: {e}")
            dataset.write(rec)
        finally:
            with RUN_LOCK:
                RUNNING.discard(key)
            shutil.rmtree(tmp, ignore_errors=True)

    def _optimize_once(self, dish: str, variant: str, who: str, rec: dict,
                       scale: dict, tmp: Path) -> bool:
        """One pass. False means stop - it failed and the record already says so."""
        def stage(name: str) -> None:
            """One small write per stage. The page shows it, and a run that dies leaves
            the name of the step it died in - the only reason we would ever know."""
            r = dataset.record(dish, variant)
            if r.get("status") == "optimising":
                r["stage"] = name
                dataset.write(r)

        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True, exist_ok=True)
        stage("fetching master")
        master = tmp / "master.glb"
        # Streamed to disk, never held as bytes: a 70 MB master plus the copy every
        # reader makes of it is most of a 512 MB container on its own.
        if not dataset.fetch_model(rec["model_key"], master):
            r = dataset.record(dish, variant)
            r.update(status="review", stage="", optimising_since="",
                     export_error=f"master not found in storage: {rec['model_key']}")
            dataset.write(r)
            return False

        settings = rec.get("optimise") or {}
        res = optimize.run(master, tmp / "out", scale=scale or None, on_stage=stage,
                           triangles=settings.get("triangles") or optimize.TARGET_TRIANGLES,
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
        # The USDZ is now BUILT from the optimised GLB (optimize.py step 5), not carried
        # over from the master. Carrying it meant iOS got a 74.5 MB, 1.9M-triangle,
        # 190 cm file while everyone else got 3 MB at 22 cm. The master's own USDZ stays
        # in master_keys, untouched, like every other master artefact.

        rec.update(status="review", stage="", optimising_since="",
                   catalog_keys=catalog, export_stats=res.stats,
                   catalogued_utc=dataset._now(), catalogued_by=who, export_error="")
        dataset.write(rec)
        return True

    # ---------- shaping ----------

    def _shape(self, rec: dict) -> dict:
        rec = dict(rec)
        rec["filled"] = len(rec["frames"])
        rec["frames"] = {i: rec["frames"].get(str(i)) for i in range(4)}
        rec["all_variants"] = dataset.variants_of(rec["dish"]) or [rec["variant"]]
        return rec

    def _dishes(self) -> list[dict]:
        out = []
        for d in dataset.dishes():
            vs = dataset.variants_of(d)
            recs = [dataset.record(d, v) for v in vs]
            out.append({"dish": d, "title": dataset.title_of(d),
                        "variants": vs or ["default"],
                        "judged": sum(1 for r in recs if r.get("verdict")),
                        "shipping": sum(1 for r in recs if r.get("catalog_keys"))})
        return out

    def _photos(self) -> list[dict]:
        """Every frame in the system, newest dish first.

        Photographs and generated views are the input side of the pipeline and deserve
        their own shelf: they are what a model is only as good as, they are the thing
        that cannot be regenerated for 30 credits, and mixing them in with finished
        models made both lists harder to read.
        """
        out = []
        for rec in dataset.catalogue():
            frames = rec.get("frames") or {}
            if not frames:
                continue
            shots = []
            for i in range(4):
                f = frames.get(str(i))
                if not f:
                    continue
                shots.append({
                    "slot": i,
                    "role": dataset.SLOTS[i],
                    "bytes": f.get("bytes", 0),
                    "generated": bool(f.get("generated")),
                    "generated_from": f.get("generated_from"),
                    "source_name": f.get("source_name", ""),
                    "uploaded_by": f.get("uploaded_by", ""),
                    "uploaded_utc": f.get("uploaded_utc", ""),
                })
            out.append({
                "dish": rec.get("dish"), "title": rec.get("title", ""),
                "variant": rec.get("variant"),
                "archived": bool(rec.get("archived")),
                "has_model": bool(rec.get("model_key")),
                "shots": shots,
                "real": sum(1 for s in shots if not s["generated"]),
                "predicted": sum(1 for s in shots if s["generated"]),
                "created_utc": rec.get("created_utc", ""),
            })
        out.sort(key=lambda r: r.get("created_utc") or "", reverse=True)
        return out

    def _library(self) -> list[dict]:
        """Everything ever made, newest first - the answer to "what have we already done".

        Reads one record per dish+variant. Fine at the scale a single kitchen produces;
        if this ever gets slow, the fix is an index object rather than a fan-out read.
        """
        out = []
        for rec in dataset.catalogue():
            st = rec.get("export_stats") or {}
            out.append({
                "dish": rec.get("dish"), "title": rec.get("title", ""),
                "variant": rec.get("variant"),
                "status": rec.get("status"), "verdict": rec.get("verdict"),
                "faults": rec.get("faults", []), "engine": rec.get("engine"),
                "frames": len(rec.get("frames", {})),
                "has_thumb": bool(rec.get("master_keys", {}).get("png")),
                "has_model": bool(rec.get("model_key")),
                # Shippable is a fact about what exists, not a flag anyone sets.
                "shipping": bool(rec.get("catalog_keys")),
                "archived": bool(rec.get("archived")),
                "scale": rec.get("scale") or {},
                "draco_mb": round(st.get("draco_bytes", 0) / 1048576, 2) or None,
                "shrink": st.get("shrink"),
                "judged_by": rec.get("judged_by"), "judged_utc": rec.get("judged_utc"),
                "created_utc": rec.get("created_utc"),
                "catalogued_utc": rec.get("catalogued_utc"),
            })
        out.sort(key=lambda r: (r.get("catalogued_utc") or r.get("judged_utc")
                                or r.get("created_utc") or ""), reverse=True)
        return out

    def _bundle(self, dish: str, variant: str, with_master: bool) -> None:
        """Everything this dish ships, as one zip.

        For handing a client their models, or opening one in Blender without the command
        line. Behind the same login as the rest of the Studio - it is an internal tool.

        Stored, not deflated: a Draco GLB, JPEG textures and a USDZ (itself a zip) are
        already compressed, so deflating them spends CPU to save almost nothing. And
        built on disk rather than in memory, because with the master included this is a
        70 MB file and the host has 512 MB.
        """
        rec = dataset.record(dish, variant)
        files = dict(rec.get("catalog_keys") or {})
        if with_master and rec.get("model_key"):
            files["master"] = rec["model_key"]
        if not files:
            return self._json({"error": "Nothing to download yet."}, 400)

        st = rec.get("export_stats") or {}
        scale = rec.get("scale") or {}
        readme = "\n".join([
            f"{rec.get('title') or dish}  /  {variant}",
            f"generated by {rec.get('engine') or 'unknown'} on "
            f"{rec.get('catalogued_utc') or '?'}",
            "",
            "model_draco.glb   what a menu loads: web and Android AR.",
            "model_opt.glb     the same model uncompressed, for tools that dislike Draco.",
            "model.usdz        iOS AR (Quick Look). Same geometry, same real-world size.",
            "model.glb         the untouched engine master, if included. Not for shipping.",
            "",
            f"triangles     {st.get('result_triangles', '?')}",
            f"real size     " + (" x ".join(f"{v * 100:.1f}" for v in st.get("size_after", []))
                                 + " cm" if st.get("size_after") else "not set"),
            f"scale set as  {scale.get('cm', '-')} cm {scale.get('axis', '')}".rstrip(),
            "",
            "Models sit on y=0 and are in metres, so they drop straight onto a table in AR.",
        ]) + "\n"

        tmp = self.out_dir / "_zip"
        tmp.mkdir(parents=True, exist_ok=True)
        name = f"{dataset.slug(dish)}--{dataset.slug(variant)}"
        path = tmp / f"{name}.zip"
        try:
            with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
                z.writestr(f"{name}/README.txt", readme)
                for kind, key in files.items():
                    blob = dataset.read_model(key)
                    if blob:
                        z.writestr(f"{name}/{Path(key).name}", blob)
            size = path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition",
                             f'attachment; filename="{name}.zip"')
            self.end_headers()
            with open(path, "rb") as fh:
                while True:
                    chunk = fh.read(self.CHUNK)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            path.unlink(missing_ok=True)

    def _engine_meta(self, name: str) -> dict:
        """What the picker needs to know, including whether this host can finish the job.

        Spending 30 credits to discover the optimiser cannot open the result is the worst
        possible order to learn it in - the master is archived and useless, and the
        credits are gone. So the warning is computed from what the engine SAYS it will
        return, and shown next to the button that spends the money.
        """
        e = engines.build(name)
        blocked = limits.check_optimise(e.expect_triangles, e.expect_megapixels)
        return {
            "name": name,
            "credits": e.cost_per_job,
            "uncertain": getattr(e, "cost_uncertain", False),
            "expect_triangles": e.expect_triangles,
            # The only real difference between the entries, so the picker should say it.
            "texture": getattr(e, "texture_resolution", ""),
            # Empty means this host can finish the job. Anything else is the reason it
            # cannot, in words meant for the person about to press the button.
            "cannot_optimise": ("This host has "
                                f"{limits.budget_mb():.0f} MB and could not optimise the "
                                f"~{e.expect_triangles:,}-triangle master this returns. "
                                "The dish would generate and be archived, but produce no "
                                "shipping files until the worker has more memory."
                                ) if blocked else "",
        }

    def _detail(self, dish: str, variant: str) -> dict:
        return self._shape(dataset.record(dish, variant))

    def _csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["dish", "variant", "engine", "status", "verdict", "faults", "note",
                    "seconds", "scale_axis", "scale_cm", "draco_bytes", "shipping",
                    "judged_by", "judged_utc", "model_key", "error"])
        for r in dataset.catalogue():
            sc, st = r.get("scale") or {}, r.get("export_stats") or {}
            w.writerow([r.get("dish"), r.get("variant"), r.get("engine"), r.get("status"),
                        r.get("verdict"), "; ".join(r.get("faults", [])), r.get("note"),
                        r.get("seconds"), sc.get("axis", ""), sc.get("cm", ""),
                        st.get("draco_bytes", ""), bool(r.get("catalog_keys")),
                        r.get("judged_by"), r.get("judged_utc"),
                        r.get("model_key"), r.get("error")])
        return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "out")
    ap.add_argument("--engine", default="meshy-7-lean")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    ap.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    a = ap.parse_args()

    load_env()
    Handler.engine_name = a.engine
    Handler.out_dir = a.out

    accounts = users()
    print("BetaReal Scan Studio")
    print(f"  storage : {storage.describe()}")
    print(f"  engine  : {a.engine}")
    print(f"  optimizer: {optimize.describe()}")
    print(f"  memory  : {limits.describe()}")
    print(f"  jobs    : {'inline (in-request)' if INLINE_JOBS else 'background threads'}")
    print(f"  users   : {', '.join(accounts) if accounts else 'OPEN - no auth (set STUDIO_USERS)'}")
    print(f"  listen  : http://{a.host}:{a.port}")
    if a.host != "127.0.0.1" and not accounts:
        print("\n  !! Reachable beyond this machine with no password. Set STUDIO_USERS.")
    print("\n  Ctrl+C to stop.")
    try:
        ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
