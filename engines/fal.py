"""fal.ai - one account, many 3D engines, behind the same interface as Meshy.

**Written, not switched on** (Temo, 2026-09-28: "keep Pro plan for Meshy for now, don't
wire it yet with fal, just create everything else"). Nothing builds one of these unless
BOTH `FAL_KEY` is set and `BETAREAL_ENABLE_FAL=1` - see `engines/__init__.py`. Until
then every fal name in the registry raises a sentence saying so, rather than falling back
to Meshy, because an engine you did not ask for is worse than an error.

Why fal at all, measured on 2026-09-28 against the public model pages:

    Meshy direct, Pro plan      $0.60 / model  (30 of 1,000 monthly credits) - ~33 a month
    Hunyuan 3D 3.1 Pro on fal   $0.375 + $0.15 PBR + $0.15 multi-view = $0.675, no cap,
                                up to EIGHT views (front, back, left, right, top, bottom,
                                and the two 45-degree fronts) where Meshy stops at four
    Meshy 7.1 multi on fal      $1.20 textured - twice direct; only if the plan runs out

So fal is not "a cheaper Meshy". It is (1) no monthly ceiling, which is the constraint
that binds first (ROADMAP, and the 09-18 hosting review), (2) engines that take more
than four photos - the "4-image cap is architectural" problem - and (3) one key for
Hunyuan, Tripo, Rodin and Trellis, so comparing them on the same dish is a registry line
each, not an integration each.

The queue protocol, from fal's docs (2026-09-28):

    POST https://queue.fal.run/<model path>          Authorization: Key <FAL_KEY>
         -> { request_id, status_url, response_url, cancel_url }
    GET  .../requests/<id>/status   -> IN_QUEUE | IN_PROGRESS | COMPLETED (+ error)
    GET  .../requests/<id>          -> the model's own output
    ?fal_webhook=<url> on the submit for a callback

The task id we keep is `<request_id>`; the model path lives on the engine, so a resumed
job (webhook, lease expiry) rebuilds the URLs from the registry name on the record - the
same way a Meshy ticket is resumed. fal's docs say the full path works for status and
result; older clients used the two-segment app id. Both are tried, full path first.

**Unverified until the first real call**: output field names beyond `model_glb` /
`model_mesh`, and how long fal keeps result files. `collect` copies the GLB immediately,
so retention only matters for a callback that arrives very late.
"""
from __future__ import annotations

import base64
import io
import os
import time
from pathlib import Path

import requests

from .base import Engine, Job, Result

QUEUE = "https://queue.fal.run"
POLL_SECONDS = 5
GIVE_UP_AFTER = 1200


def fal_key() -> str:
    key = os.environ.get("FAL_KEY", "").strip()
    if not key:
        raise RuntimeError("FAL_KEY is not set")
    return key


def _data_uri(path: Path, edge: int = 2048) -> str:
    """The same 2048-px JPEG every engine gets (engines/images.py does this for Meshy).

    fal accepts data URIs for `*_image_url` fields. A 2048-px JPEG is ~1 MB, so eight of
    them stay well under any sane request size.
    """
    from PIL import Image

    im = Image.open(path).convert("RGB")
    im.thumbnail((edge, edge))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# How each model wants its views. Our capture order is dataset.SLOTS: front, right, back,
# left - and slot 0 is the primary. A mapper turns that ordered list into the model's own
# field names; the extras (top, 45-degree) are for when the capture protocol grows past
# four, which is the point of an eight-view engine.
def _hunyuan_views(images: list[str]) -> dict:
    names = ["input_image_url", "right_image_url", "back_image_url", "left_image_url",
             "top_image_url", "left_front_image_url", "right_front_image_url",
             "bottom_image_url"]
    return {n: u for n, u in zip(names, images)}


def _list_views(field: str):
    def build(images: list[str]) -> dict:
        return {field: images}
    return build


class FalEngine(Engine):
    """One fal model endpoint. Configure per registry entry; nothing here names a model."""

    name = "fal"
    cost_uncertain = True

    def __init__(self, model_path: str, *, variant: str, views, max_images: int,
                 extra: dict | None = None, cost_usd: float | None = None,
                 glb_fields: tuple[str, ...] = ("model_glb", "model_mesh", "glb")):
        self.model_path = model_path.strip("/")
        self.variant = variant
        self.views = views
        self.max_images = max_images
        self.extra = dict(extra or {})
        self.glb_fields = glb_fields
        # Dollars, not credits - fal bills money. The runner's spend estimate is in
        # credits, so this is carried alongside and shown where a person picks an engine.
        self.cost_usd = cost_usd
        self.cost_per_job = 0
        self.cost_uncertain = cost_usd is None
        self.expect_triangles = int(self.extra.get("face_count") or 500_000)
        self.expect_megapixels = 0.0

    # ── plumbing ────────────────────────────────────────────────────

    def _headers(self) -> dict:
        return {"Authorization": f"Key {fal_key()}", "Content-Type": "application/json"}

    def _bases(self) -> list[str]:
        full = f"{QUEUE}/{self.model_path}"
        app = f"{QUEUE}/{'/'.join(self.model_path.split('/')[:2])}"
        return [full] if full == app else [full, app]

    def _get(self, suffix: str) -> requests.Response:
        last = None
        for base in self._bases():
            last = requests.get(f"{base}/requests/{suffix}", headers=self._headers(), timeout=60)
            if last.status_code not in (404, 405):
                return last
        return last

    def _blank(self, dish: str) -> Result:
        return Result(engine=self.name, variant=self.variant, dish=dish, ok=False)

    def payload(self, job: Job) -> dict:
        if not job.images:
            raise ValueError(f"{job.dish}: needs at least one image")
        uris = [_data_uri(p) for p in job.images[: self.max_images]]
        return {**self.views(uris), **self.extra}

    # ── the asynchronous pair ───────────────────────────────────────

    def start(self, job: Job) -> Result:
        res = self._blank(job.dish)
        url = f"{QUEUE}/{self.model_path}"
        hook = os.environ.get("FAL_WEBHOOK_URL", "").strip()
        if hook:
            url += f"?fal_webhook={requests.utils.quote(hook, safe='')}"
        try:
            r = requests.post(url, headers=self._headers(), json=self.payload(job), timeout=180)
            if r.status_code == 429:
                res.error = "fal is rate limiting this account - retry shortly."
                res.retryable = True
                return res
            if r.status_code >= 400:
                res.error = f"submit {r.status_code}: {r.text[:300]}"
                return res
            res.task_id = r.json()["request_id"]
            return res
        except Exception as e:  # noqa: BLE001
            res.error = f"{type(e).__name__}: {e}"
            res.retryable = True
            return res

    def collect(self, task_id: str, dish: str, out_dir: Path, on_stage=None) -> Result:
        """Ask about a request; download the GLB when it is done.

        Like Meshy's webhook, fal's callback is a nudge and never the answer: the result
        is always fetched with our own key from fal's own domain.
        """
        res = self._blank(dish)
        res.task_id = task_id
        try:
            s = self._get(f"{task_id}/status")
            if s.status_code >= 400:
                res.error = f"status {s.status_code}: {s.text[:300]}"
                res.retryable = s.status_code >= 500
                return res
            st = s.json()
            if st.get("status") in ("IN_QUEUE", "IN_PROGRESS"):
                res.pending = True
                return res
            if st.get("error"):
                res.error = f"fal: {st['error']}"
                return res

            r = self._get(task_id)
            if r.status_code >= 400:
                res.error = f"result {r.status_code}: {r.text[:300]}"
                res.retryable = r.status_code >= 500
                return res
            out = r.json()
            glb_url = next((
                (out.get(f) or {}).get("url") for f in self.glb_fields
                if isinstance(out.get(f), dict) and (out.get(f) or {}).get("url")), None)
            if not glb_url:
                glb_url = ((out.get("model_urls") or {}).get("glb") or {}).get("url")
            if not glb_url:
                res.error = f"completed but no GLB in: {sorted(out)[:12]}"
                return res

            if on_stage:
                on_stage("downloading the model")
            out_dir.mkdir(parents=True, exist_ok=True)
            # GLB only, for the reason meshy.py gives at length: the master is the GLB,
            # and every file a diner loads is derived from it by our own optimiser.
            res.files["glb"] = _download(glb_url, out_dir / f"{dish}.glb")
            thumb = (out.get("thumbnail") or {}).get("url")
            if thumb:
                res.files["thumb"] = _download(thumb, out_dir / f"{dish}.png")
            res.ok = True
            return res
        except Exception as e:  # noqa: BLE001
            res.error = f"{type(e).__name__}: {e}"
            res.retryable = True
            return res

    def generate(self, job: Job, out_dir: Path) -> Result:
        started = time.time()
        res = self.start(job)
        if res.error:
            return res
        while True:
            if time.time() - started > GIVE_UP_AFTER:
                out = self._blank(job.dish)
                out.task_id = res.task_id
                out.error = f"timed out after {GIVE_UP_AFTER}s (request {res.task_id})"
                return out
            time.sleep(POLL_SECONDS)
            got = self.collect(res.task_id, job.dish, out_dir)
            if not got.pending:
                got.seconds = round(time.time() - started, 1)
                return got


def _download(url: str, dest: Path) -> Path:
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(1 << 16):
                fh.write(chunk)
    return dest


# The fal entries, as factories. Registered in engines/__init__.py behind the switch.
# PBR is on and face_count is NOT sent: a custom face count costs +$0.15 and does nothing
# for us, because we decimate the raw master ourselves (the same reason Meshy is told
# `should_remesh=False`).
FAL_ENGINES = {
    "fal-hunyuan-3.1-pro": lambda: FalEngine(
        "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d", variant="fal-hunyuan-3.1-pro",
        views=_hunyuan_views, max_images=8,
        extra={"generate_type": "Normal", "enable_pbr": True}, cost_usd=0.675),
    "fal-tripo-h3.1-multiview": lambda: FalEngine(
        "tripo3d/h3.1/multiview-to-3d", variant="fal-tripo-h3.1-multiview",
        views=_list_views("image_urls"), max_images=4),
    "fal-trellis-multi": lambda: FalEngine(
        "fal-ai/trellis/multi", variant="fal-trellis-multi",
        views=_list_views("image_urls"), max_images=4),
    "fal-meshy-7.1-multi": lambda: FalEngine(
        "meshy/v7.1/multi-image-to-3d", variant="fal-meshy-7.1-multi",
        views=_list_views("image_urls"), max_images=4,
        extra={"should_remesh": False, "should_texture": True, "enable_pbr": True},
        cost_usd=1.20),
}
