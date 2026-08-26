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
import time
from pathlib import Path

import requests

from config import meshy_key
from .base import Engine, Job, Result

BASE = "https://api.meshy.ai/openapi/v1/multi-image-to-3d"
MAX_IMAGES = 4          # hard API limit — the constraint the hybrid exists to escape
POLL_SECONDS = 5
GIVE_UP_AFTER = 900

# Published cost table (meshy.ai -> "API cost details", read 2026-08-26):
#
#   Multi Image to 3D
#     Meshy 6 models :  20 credits (no texture)  /  30 credits (with texture)
#     Other models   :   5 credits (no texture)  /  15 credits (with texture)
#
# The table does not name Meshy 7. It is almost certainly in "other models"
# (15 with texture), but that is inference, not documentation — so anything
# unlisted is flagged `cost_uncertain` and the runner shows the worst case too.
# One real call settles it: Settings -> API -> Daily Usage reports the exact
# charge.
_EXPENSIVE = {"meshy-6"}          # billed at the Meshy 6 rate
_LISTED = {"meshy-6", "meshy-5"}  # models the table accounts for explicitly


def _cost(ai_model: str, textured: bool) -> int:
    if ai_model in _EXPENSIVE:
        return 30 if textured else 20
    return 15 if textured else 5


# Straight off a professional camera a graded JPEG is 10-25 MB, and base64
# inflates by a third - four of those is a ~130 MB request body. Meshy works from
# a far smaller image than that, so downscale on the way out. 2048px on the long
# edge is well above what the model consumes and keeps a submission near 1 MB.
MAX_EDGE = 2048
JPEG_QUALITY = 92


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
        texture_resolution: str = "2k",
        enable_pbr: bool = True,
        target_polycount: int = 25_000,
        topology: str = "triangle",
        variant: str | None = None,
    ):
        self.ai_model = ai_model
        self.should_texture = should_texture
        self.texture_resolution = texture_resolution
        self.enable_pbr = enable_pbr
        self.target_polycount = target_polycount
        self.topology = topology
        self.variant = variant or f"{ai_model}-{texture_resolution if should_texture else 'notex'}"
        self.cost_per_job = _cost(ai_model, should_texture)
        self.cost_uncertain = ai_model not in _LISTED

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {meshy_key()}"}

    def _payload(self, job: Job) -> dict:
        if not job.images:
            raise ValueError(f"{job.dish}: no images")
        body = {
            "image_urls": [_data_uri(p) for p in job.images[:MAX_IMAGES]],
            "ai_model": self.ai_model,
            "topology": self.topology,
            "target_polycount": self.target_polycount,
            "should_texture": self.should_texture,
        }
        if self.should_texture:
            body["texture_resolution"] = self.texture_resolution
            body["enable_pbr"] = self.enable_pbr
        return body

    def generate(self, job: Job, out_dir: Path) -> Result:
        res = Result(engine=self.name, variant=self.variant, dish=job.dish, ok=False,
                     credits=self.cost_per_job)
        started = time.time()
        try:
            r = requests.post(BASE, headers=self._headers(), json=self._payload(job), timeout=180)
            if r.status_code >= 400:
                res.error = f"submit {r.status_code}: {r.text[:300]}"
                return res
            res.task_id = r.json()["result"]

            # Poll. Production should use the webhook instead (Settings -> API),
            # but for a batch of a dozen dishes polling is simpler and fine.
            while True:
                if time.time() - started > GIVE_UP_AFTER:
                    res.error = f"timed out after {GIVE_UP_AFTER}s (task {res.task_id})"
                    return res
                time.sleep(POLL_SECONDS)
                g = requests.get(f"{BASE}/{res.task_id}", headers=self._headers(), timeout=60)
                if g.status_code >= 400:
                    res.error = f"poll {g.status_code}: {g.text[:300]}"
                    return res
                task = g.json()
                status = task.get("status")
                if status == "SUCCEEDED":
                    break
                if status in ("FAILED", "CANCELED"):
                    err = (task.get("task_error") or {}).get("message", "")
                    res.error = f"{status}: {err}"
                    return res

            res.seconds = round(time.time() - started, 1)
            out_dir.mkdir(parents=True, exist_ok=True)

            # GLB and USDZ both come straight out of Meshy, which removes the
            # separate USDZ conversion step the current pipeline does by hand.
            for fmt in ("glb", "usdz"):
                url = (task.get("model_urls") or {}).get(fmt)
                if url:
                    res.files[fmt] = _download(url, out_dir / f"{job.dish}.{fmt}")
            if task.get("thumbnail_url"):
                res.files["thumb"] = _download(task["thumbnail_url"], out_dir / f"{job.dish}.png")

            res.ok = "glb" in res.files
            if not res.ok:
                res.error = "succeeded but returned no GLB"
            return res
        except Exception as e:  # noqa: BLE001 - one bad dish must not kill the batch
            res.error = f"{type(e).__name__}: {e}"
            res.seconds = round(time.time() - started, 1)
            return res


def _download(url: str, dest: Path) -> Path:
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(1 << 16):
                fh.write(chunk)
    return dest
