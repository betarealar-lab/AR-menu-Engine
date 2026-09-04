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
import threading
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import dataset
import engines
import glb
from engines import images
import jobs
import limits
import optimize
import pipeline
import storage
from config import load_env

ROOT = Path(__file__).resolve().parent
SLOTS = dataset.SLOTS

# Why a dish failed. The real output: after ~30 dishes these say which food is scannable,
# what the capture guide must warn about, and which venues to sell to.
FAULTS = [
    "glare / specular sauce", "thin or fine structure", "transparent / liquid",
    "dark or low contrast", "cluttered background", "deep bowl, hidden interior",
    "tall or stacked", "uniform texture", "reflective tableware", "inconsistent grade",
]

# Requests ENQUEUE; they do not do the work.
#
# What used to be here was an in-memory `RUNNING` set plus a rule for spotting "ghosts" -
# records that said `optimising` with no thread behind them. It could not work, and the
# reason is worth keeping: the set lived in one process, so it emptied on every restart
# while the record in R2 did not, and the guards then refused to start a new run forever.
# That wedged the first real dish on 2026-08-29 with no error and no way back.
#
# A lease in R2 is the same idea done properly. It is visible to every process, it
# expires on its own when the holder dies, and a job whose lease has expired is simply
# claimable again - which is what a ghost always should have been. See jobs.py.
#
# The claim loop below runs in a thread, and that IS safe in a way the old detached
# per-job threads were not: if the container is killed mid-job the lease expires and
# somebody else picks the work up, rather than the work disappearing with the thread.
#
# Thirty seconds, and it costs nothing in responsiveness: WAKE below is set the instant
# work is enqueued here, so this only ever waits out the full interval when the work
# came from somewhere else. What it does buy is a bill. Listing an R2 prefix is a Class
# A operation - 1,000,000 free a month - and a claim is two listings (measured, see
# check_jobs.py). At 30 s that is ~173,000 a month; at the 5 s this started as it would
# have been over a million on its own, before the worker and the UI were counted.
CLAIM_POLL_SECONDS = float(os.environ.get("JOBS_POLL", "30"))

# Set when work is enqueued, so a press of Generate starts in milliseconds instead of
# waiting out a poll.
WAKE = threading.Event()


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


def enqueue(kind: str, dish: str, variant: str, **payload) -> None:
    """Put work on the queue and wake the claim loop.

    Nothing runs in the request. The page already polls the record, so the only thing
    the caller loses is the illusion that pressing a button and the work happening are
    the same event - which is exactly the illusion that lost a generation every time a
    tab was closed.
    """
    jobs.enqueue(kind, dish, variant, **payload)
    WAKE.set()


def claim_loop(out_dir: Path, default_engine: str) -> None:
    """Take jobs this host can finish, forever.

    On the free tier the container sleeps when idle, so this loop sleeps with it. That
    is not a regression - nothing ran while it was asleep before either - and the queue
    is durable, so the work is still there when a request, or a Meshy callback, wakes
    the container up.
    """
    while True:
        try:
            while pipeline.work_once(out_dir, default_engine, log=lambda *_: None):
                pass
        except Exception:      # noqa: BLE001 - a bad poll must never kill the loop
            pass
        WAKE.wait(CLAIM_POLL_SECONDS)
        WAKE.clear()


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
                    # Queue depth and the dead-letter list. A dead `generate` is 30
                    # credits already spent with nothing to show, so it belongs
                    # somewhere a person actually looks - not only in a log.
                    "jobs": jobs.stats(),
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
                if rec.get("model_key") and not jobs.exists("optimise", dish, variant):
                    rec.update(status="optimising", stage="queued",
                               optimising_since=dataset._now())
                    dataset.write(rec)
                    self._queue_optimise(dish, variant, who)
                else:
                    # Already queued or in flight: the size is on the record, and the
                    # optimiser re-reads it after each pass, so the run in progress
                    # picks it up rather than shipping the number it started with.
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
                # -1 is the wire form of AUTO. 0 cannot be, because 0 already means
                # "not set, use the default" everywhere else in this record.
                raw_tri = body.get("triangles")
                tri = int(raw_tri) if raw_tri not in (None, "") else 0
                tex = int(body.get("texture") or 0)
                if tri > 0 and not 2_000 <= tri <= 500_000:
                    return self._json({"error": "Triangles must be between 2,000 and "
                                                "500,000, or Auto."}, 400)
                if tex and tex not in dataset.TEXTURE_TARGETS:
                    return self._json({"error": f"Texture must be one of "
                                                f"{dataset.TEXTURE_TARGETS}."}, 400)
                rec["optimise"] = {k: v for k, v in
                                   (("triangles", tri), ("texture", tex)) if v}
                dataset.write(rec)
                # Settings only mean anything once they are applied, so applying them is
                # the same action - five seconds, no credits.
                if rec.get("model_key") and not jobs.exists("optimise", dish, variant):
                    rec.update(status="optimising", stage="queued",
                               optimising_since=dataset._now())
                    dataset.write(rec)
                    self._queue_optimise(dish, variant, who)
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
                # Off the queue as well, or the next claim would start the very run
                # this call exists to stop. A worker already inside one reads the
                # record, sees `cancelled`, and stops by itself.
                jobs.cancel(dish, variant)
                return self._json(self._shape(dataset.record(dish, variant)))
            if path == "/api/optimize":
                rec = dataset.record(dish, variant)
                if not rec.get("model_key"):
                    return self._json({"error": "Nothing generated yet."}, 400)
                # No ghost rule any more. A record saying `optimising` with no job
                # behind it is simply a record with no job behind it, and this puts one
                # there; a record that DOES have one is left alone.
                if jobs.exists("optimise", dish, variant):
                    return self._json({"status": rec["status"]})
                rec.update(status="optimising", stage="queued", export_error="",
                           optimising_since=dataset._now())
                dataset.write(rec)
                self._queue_optimise(dish, variant, who)
                return self._json({"ok": True})
            if path == "/api/generate":
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
                if jobs.exists("generate", dish, variant):
                    return self._json({"status": "running"})
                # Cleared BEFORE the job is queued: a claimer that sees a task id on the
                # record collects instead of submitting, which is what stops a webhook
                # that never arrived from costing 30 credits twice. A stale id left here
                # would make a deliberate Regenerate collect the OLD model instead.
                rec.update(status="running", error="", model_key="", task_id="",
                           stage="queued", submitted_utc="")
                dataset.write(rec)
                enqueue("generate", dish, variant, who=who, engine=body.get("engine"))
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
            threading.Thread(target=pipeline.resume_task, daemon=True,
                             args=(task_id, self.out_dir, self.engine_name)).start()

    # There is no `_nudge` any more. A webhook that never arrives used to be caught by
    # the page's own polling, which meant recovery needed somebody to have the tab open.
    # The queue does it without an audience: a submitted generation keeps its lease on a
    # short clock (jobs.PENDING_SECONDS), and when that expires the job is claimed again
    # and COLLECTS - it never resubmits, so the recovery costs nothing.

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

    def _queue_optimise(self, dish: str, variant: str, who: str) -> None:
        """Queue the optimise and wake the loop. Whether THIS host runs it is not
        decided here - `pipeline.can_run` decides that, per host, at claim time."""
        rec = dataset.record(dish, variant)
        enqueue("optimise", dish, variant, who=who,
                triangles=int(rec.get("master_triangles") or 0))

    # ---------- shaping ----------

    def _shape(self, rec: dict) -> dict:
        rec = dict(rec)
        rec["filled"] = len(rec["frames"])
        rec["frames"] = {i: rec["frames"].get(str(i)) for i in range(4)}
        rec["all_variants"] = dataset.variants_of(rec["dish"]) or [rec["variant"]]
        return rec

    def _dishes(self) -> list[dict]:
        """The rail: dishes worth switching between.

        A dish whose every variant is archived does not appear. Archiving is how a
        library of half-broken attempts is made readable, and a rail that ignored it
        would undo that in the place it matters most.
        """
        out = []
        for d in dataset.dishes():
            vs = dataset.variants_of(d)
            recs = [dataset.record(d, v) for v in vs]
            if recs and all(r.get("archived") for r in recs):
                continue
            live = [r for r in recs if not r.get("archived")]
            out.append({
                "dish": d,
                "title": dataset.title_of(d),
                "variants": [r["variant"] for r in live] or vs or ["default"],
                "judged": sum(1 for r in live if r.get("verdict")),
                "shipping": sum(1 for r in live if r.get("catalog_keys")),
                "models": sum(1 for r in live if r.get("model_key")),
                # An empty dish is a name somebody typed and nothing else. Saying so
                # beats it looking identical to one with work in it.
                "empty": not any(r.get("frames") or r.get("model_key") for r in live),
            })
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
    # meshy-7, not meshy-7-lean: lean was removed on 2026-08-31 after losing a
    # Blender comparison, and nothing noticed that the default still named it. The
    # registry has no such engine, so `python studio.py` with no flag built a Studio
    # whose fallback engine could not be constructed. It never bit only because the
    # page always sends an engine explicitly.
    ap.add_argument("--engine", default="meshy-7")
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
    print(f"  jobs    : queue on {storage.backend().kind}, claiming every {CLAIM_POLL_SECONDS:g}s")
    blocked = limits.check_optimise(1_902_278, 37.7)
    print("  optimise: " + ("generation only here - a raw master does not fit, so\n"
                            "            worker.py finishes those"
                            if blocked else
                            "raw masters fit; this host can finish a dish alone"))
    print(f"  users   : {', '.join(accounts) if accounts else 'OPEN - no auth (set STUDIO_USERS)'}")
    print(f"  listen  : http://{a.host}:{a.port}")
    if a.host != "127.0.0.1" and not accounts:
        print("\n  !! Reachable beyond this machine with no password. Set STUDIO_USERS.")
    print("\n  Ctrl+C to stop.")
    # Claiming starts before the server does, so a job left queued by the last
    # deploy is picked up on boot rather than waiting for somebody to press
    # something.
    threading.Thread(target=claim_loop, args=(a.out, a.engine), daemon=True).start()
    try:
        ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
