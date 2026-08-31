"""Meshy multi-image-to-3D.

Docs: https://docs.meshy.ai/en/api/multi-image-to-3d

Verified 2026-08-26 on the Pro plan: API calls draw on the SAME credit pool as
the web app (Settings -> API showed the same 1,200 balance as the header), so
there is nothing separate to buy. Monthly credits reset on the billing date;
permanent credits carry over.
"""
from __future__ import annotations

import base64
import io
import os
import datetime
import time
from pathlib import Path

import requests

from config import meshy_key
from .base import Engine, Job, Result

BASE = "https://api.meshy.ai/openapi/v1/multi-image-to-3d"
MIN_IMAGES = 1          # Meshy accepts 1-4; one is a valid, if weaker, generation
MAX_IMAGES = 4          # hard API limit — the constraint the hybrid exists to escape

# `target_polycount` does NOTHING unless `should_remesh` is true, and we do not send
# should_remesh. Measured 2026-08-29: this client asked for 300,000 and the API returned
# a 1,902,278-triangle master. So the earlier note here - that 300k was "as close as we
# get" to the raw export - was simply wrong, and it was wrong in the expensive direction:
# it made a dead parameter look like a working control, and nobody questioned where 1.9M
# triangles were coming from until a 512 MB container was killed trying to decimate them.
#
# The API does give the raw master. It is therefore not sent by default at all. Passing
# it without should_remesh would be a lie in the request body; passing both is a real
# instruction to Meshy to decimate, which is a quality decision and belongs in a named
# registry entry where someone has chosen it on purpose.
DEFAULT_POLYCOUNT = 300_000
POLL_SECONDS = 5
GIVE_UP_AFTER = 900

# What a generation actually costs, MEASURED rather than inferred.
#
# On 2026-08-30 a real meshy-7 multi-image generation with texture was run against the
# live account and the balance read before and after through /openapi/v1/balance:
#
#     1610 -> 1580     30 credits
#
# The published table lists "Meshy 6: 20 without texture / 30 with" and "other models:
# 5 / 15", and does not name Meshy 7. This file previously assumed meshy-7 fell into
# "other models" at 15. That assumption was wrong by a factor of two, and it mattered:
# at 30 credits a 1,000-credit Pro plan is ~33 dishes a month, not 66. The monthly
# ALLOWANCE, not the price, is the ceiling on how fast restaurants can be onboarded.
#
# Anything still unmeasured keeps `cost_uncertain` so the UI can say so rather than
# quietly present a guess as a fact.
_MEASURED = {                       # (model, textured) -> credits, confirmed on the account
    ("meshy-7", True): 30,
}
_LISTED = {"meshy-6", "meshy-5", "meshy-7"}   # models we can price with confidence
_EXPENSIVE = {"meshy-6", "meshy-7"}           # billed at the 20/30 rate


def _cost(ai_model: str, textured: bool) -> int:
    hit = _MEASURED.get((ai_model, textured))
    if hit is not None:
        return hit
    if ai_model in _EXPENSIVE:
        return 30 if textured else 20
    return 15 if textured else 5


def balance() -> int | None:
    """Credits left on the account, or None if it cannot be read.

    Worth having in the UI rather than a dashboard: at 30 credits a dish, a 1,000-credit
    month is about 33 dishes. That is the tightest limit in the whole system and it was
    completely invisible - somebody would simply have found generation stopped working.
    """
    try:
        r = requests.get("https://api.meshy.ai/openapi/v1/balance",
                         headers={"Authorization": f"Bearer {meshy_key()}"}, timeout=20)
        if r.status_code >= 400:
            return None
        return int(r.json().get("balance"))
    except Exception:      # noqa: BLE001 - never let a status read break a page load
        return None


# Straight off a professional camera a graded JPEG is 10-25 MB, and base64
# inflates by a third - four of those is a ~130 MB request body. Meshy works from
# a far smaller image than that, so downscale on the way out. 2048px on the long
# edge is well above what the model consumes and keeps a submission near 1 MB.
# What we SEND to the engine. Separate from what we KEEP: multi-view models consume a
# far smaller image than a camera produces, so sending more is mostly upload time - but
# this is a guess about Meshy's internals, not documented, so it is tunable and testable.
MAX_EDGE = int(os.environ.get("MESHY_MAX_EDGE", "2048"))
JPEG_QUALITY = 95


def _data_uri(path: Path) -> str:
    """Inline an image, downscaled, so nothing has to be hosted first.

    The Studio's browser side already downscales to MAX_EDGE before upload, so for the
    common path this would be a pointless decode-and-re-encode. On a 0.1-CPU free
    container that is not free: four 2048px JPEGs cost real seconds. So when a file is
    already small enough and already JPEG, ship the bytes untouched.
    """
    from PIL import Image, ImageOps

    raw = path.read_bytes()
    if path.suffix.lower() in (".jpg", ".jpeg"):
        try:
            with Image.open(io.BytesIO(raw)) as probe:
                if max(probe.size) <= MAX_EDGE and probe.info.get("exif") is None:
                    return "data:image/jpeg;base64," + base64.b64encode(raw).decode()
        except Exception:
            pass   # unreadable header - fall through to the full path below

    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)         # honour camera rotation
        if max(im.size) > MAX_EDGE:
            im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        buf = io.BytesIO()
        im.convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


class MeshyEngine(Engine):
    name = "meshy"
    cost_uncertain = False

    def __init__(
        self,
        ai_model: str = "meshy-7",
        *,
        should_texture: bool = True,
        texture_resolution: str = "4k",
        enable_pbr: bool = True,
        target_polycount: int | None = None,
        topology: str = "triangle",
        should_remesh: bool | None = None,
        variant: str | None = None,
    ):
        # Ask for the most detail the API will give and decimate ourselves.
        #
        # Letting Meshy pre-decimate hands the reduction to a black box we cannot inspect
        # or tune, on geometry - thin garnish, crumb, sauce ridges - that naive decimation
        # destroys first. Our own optimiser took a 1.97M-triangle master to 40k triangles
        # at 1.99 MB, so a bigger input did not cost delivery size. You can always go down
        # from a master; you cannot go back up without paying credits again.
        #
        # `target_polycount` is only sent when a caller asks Meshy to remesh, because that
        # is the only case where it does anything. See the note above.
        self.ai_model = ai_model
        self.should_texture = should_texture
        self.texture_resolution = texture_resolution
        self.enable_pbr = enable_pbr
        self.target_polycount = target_polycount
        self.topology = topology
        self.should_remesh = should_remesh
        self.variant = variant or f"{ai_model}-{texture_resolution if should_texture else 'notex'}"
        self.cost_per_job = _cost(ai_model, should_texture)
        self.cost_uncertain = ai_model not in _LISTED

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {meshy_key()}"}

    def _payload(self, job: Job) -> dict:
        if len(job.images) < MIN_IMAGES:
            raise ValueError(f"{job.dish}: needs at least {MIN_IMAGES} image")
        body = {
            "image_urls": [_data_uri(p) for p in job.images[:MAX_IMAGES]],
            "ai_model": self.ai_model,
            "topology": self.topology,
            "should_texture": self.should_texture,
        }
        if self.should_remesh is not None:
            body["should_remesh"] = self.should_remesh
        # Only meaningful alongside a remesh, so only sent alongside one. A parameter
        # that is transmitted and ignored is worse than an absent one: it reads like a
        # control.
        if self.should_remesh and self.target_polycount:
            body["target_polycount"] = self.target_polycount
        if self.should_texture:
            body["texture_resolution"] = self.texture_resolution
            body["enable_pbr"] = self.enable_pbr
        return body

    def _blank(self, dish: str) -> Result:
        return Result(engine=self.name, variant=self.variant, dish=dish, ok=False,
                      credits=self.cost_per_job)

    def start(self, job: Job) -> Result:
        """Hand the dish to Meshy and return the ticket. Nothing of ours waits."""
        res = self._blank(job.dish)
        try:
            r = requests.post(BASE, headers=self._headers(),
                              json=self._payload(job), timeout=180)
            if r.status_code == 429:
                # The account's concurrent-task ceiling - 10 on the Pro plan. That is
                # not a failure of this dish, it is a statement about how many are
                # already in flight, so it is reported as something to retry rather
                # than something to give up on. Sending more does not make Meshy
                # faster; it makes it refuse.
                res.error = ("Meshy is at its concurrent-task limit for this account. "
                             "The dish is not lost - it starts when a slot frees.")
                res.retryable = True
                return res
            if r.status_code >= 400:
                res.error = f"submit {r.status_code}: {r.text[:300]}"
                return res
            res.task_id = r.json()["result"]
            return res
        except Exception as e:  # noqa: BLE001
            res.error = f"{type(e).__name__}: {e}"
            res.retryable = True
            return res

    def collect(self, task_id: str, dish: str, out_dir: Path) -> Result:
        """Ask Meshy about a ticket and download the files if they are ready.

        **The webhook is never trusted for content.** Meshy documents no signature, no
        shared secret and no IP allowlist for webhook deliveries, so a payload arriving
        at our URL proves nothing about who sent it. It is treated purely as a nudge -
        something may have changed, go and look. The answer always comes from a GET
        made with our own API key, over TLS, to Meshy's own domain. A forged delivery
        can then do nothing worse than make us check a little early.
        """
        res = self._blank(dish)
        res.task_id = task_id
        try:
            g = requests.get(f"{BASE}/{task_id}", headers=self._headers(), timeout=60)
            if g.status_code == 404:
                # Gone rather than broken. Meshy retains API output for 3 days on Pro,
                # so a task that has vanished was almost certainly never collected in
                # time - which means the credits for it are spent and unrecoverable.
                res.error = ("Meshy no longer has this task. API output is kept for "
                             "3 days; after that the model and its credits are gone. "
                             "The photos are still here - generate again.")
                return res
            if g.status_code >= 400:
                res.error = f"status {g.status_code}: {g.text[:300]}"
                res.retryable = g.status_code >= 500
                return res
            task = g.json()
            # Milliseconds since the epoch. Meshy deletes the task and every download
            # URL at this moment; on Pro that is 3 days after it succeeded.
            stamp = task.get("expires_at")
            if stamp:
                try:
                    res.expires_utc = datetime.datetime.fromtimestamp(
                        int(stamp) / 1000, datetime.timezone.utc).isoformat(timespec="seconds")
                except (TypeError, ValueError, OSError):
                    pass
            status = task.get("status")
            if status in ("PENDING", "IN_PROGRESS"):
                res.pending = True
                res.progress = int(task.get("progress") or 0)
                return res
            if status != "SUCCEEDED":
                detail = (task.get("task_error") or {}).get("message", "")
                res.error = f"{status}: {detail}"
                return res

            out_dir.mkdir(parents=True, exist_ok=True)
            # Meshy returns a USDZ as well. It is kept as a master artefact, but it is
            # NOT what ships - the shipped one is built from our optimised GLB by
            # usdz.py, because Meshy's is the undecimated master.
            for fmt in ("glb", "usdz"):
                url = (task.get("model_urls") or {}).get(fmt)
                if url:
                    res.files[fmt] = _download(url, out_dir / f"{dish}.{fmt}")
            if task.get("thumbnail_url"):
                res.files["thumb"] = _download(task["thumbnail_url"], out_dir / f"{dish}.png")

            res.ok = "glb" in res.files
            if not res.ok:
                res.error = "succeeded but returned no GLB"
            return res
        except Exception as e:  # noqa: BLE001
            res.error = f"{type(e).__name__}: {e}"
            res.retryable = True
            return res

    def generate(self, job: Job, out_dir: Path) -> Result:
        """Submit and wait, for hosts that cannot receive a callback.

        Kept for the laptop and for `runner.py`. Hosted, the webhook path is used
        instead: this loop holds a whole process for ~175 seconds per dish, and every
        one of those seconds is Meshy's GPU working while ours does nothing.
        """
        started = time.time()
        res = self.start(job)
        if res.error:
            return res
        task_id = res.task_id
        while True:
            if time.time() - started > GIVE_UP_AFTER:
                out = self._blank(job.dish)
                out.task_id = task_id
                out.error = f"timed out after {GIVE_UP_AFTER}s (task {task_id})"
                return out
            time.sleep(POLL_SECONDS)
            res = self.collect(task_id, job.dish, out_dir)
            if not res.pending:
                res.seconds = round(time.time() - started, 1)
                return res


def _download(url: str, dest: Path) -> Path:
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(1 << 16):
                fh.write(chunk)
    return dest
