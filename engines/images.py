"""Generated views: asking the engine to imagine the angles nobody photographed.

Meshy takes up to four images of a dish. Almost every dish so far has arrived with one,
and a single photograph is the weakest input the pipeline accepts - the engine has to
invent the entire back of the plate from nothing.

`generate_multi_view` on Meshy's image-to-image endpoint predicts three further angles
from one photo. What that buys is worth being precise about, because it is easy to
oversell:

**It adds consistency, not information.** With one photo, the 3D engine already invents
the back internally. With generated views it invents the back first, as pictures, then
reconstructs from four images that agree with each other. The result is usually better
behaved. It is not more truthful - nothing new about the actual dish has entered the
system, and an asymmetric garnish will be invented confidently and wrongly.

**Four real photographs are strictly better**, because they carry information rather than
plausibility. This is the best available answer when only one photo exists, and it is
never a reason to shoot fewer.

That is why the generated frames are marked as generated in the record and shown as such
in the photo library: at review time it should be obvious which parts of a model came
from a camera and which from a prediction.
"""
from __future__ import annotations

import time
from pathlib import Path

import requests

from config import meshy_key

BASE = "https://api.meshy.ai/openapi/v1/image-to-image"
POLL_SECONDS = 4
GIVE_UP_AFTER = 300

# nano-banana is the cheapest of the four models this endpoint accepts, and the job is
# not a creative one - it is "show me this same plate from the side". Published cost for
# this endpoint is 3-12 credits depending on model; the exact charge is measured the way
# the 3D cost was, by reading the balance either side of a real call.
MODEL = "nano-banana"

# The prompt is doing real work here and is written to suppress invention rather than
# invite it. Image models default to making things nicer - better lighting, tidier
# garnish, a more photogenic angle - and every one of those is a lie that gets baked into
# geometry. So: same dish, same plate, same food, nothing added, nothing rearranged.
PROMPT = (
    "The same dish on the same plate, photographed from other angles. "
    "Keep the food, portion, garnish, plate and colours exactly as they are. "
    "Do not add, remove, restyle or rearrange anything. "
    "Even studio lighting, plain neutral background, sharp focus, no shadows cast "
    "across the plate."
)


def _headers() -> dict:
    return {"Authorization": f"Bearer {meshy_key()}"}


def multiview(image: bytes, mime: str = "image/jpeg") -> tuple[list[bytes], str]:
    """Three predicted angles of the dish in `image`.

    Returns (images, error). An empty list with an empty error cannot happen - either
    there are pictures or there is a reason there are none.
    """
    import base64

    uri = f"data:{mime};base64," + base64.b64encode(image).decode()
    body = {
        "ai_model": MODEL,
        "prompt": PROMPT,
        "reference_image_urls": [uri],
        "generate_multi_view": True,
        # aspect_ratio must not be sent alongside multi-view; the API rejects the pair.
    }
    try:
        r = requests.post(BASE, headers=_headers(), json=body, timeout=180)
        if r.status_code == 429:
            return [], ("Meshy is at its concurrent-task limit. Nothing was spent - "
                        "try again in a moment.")
        if r.status_code >= 400:
            return [], f"submit {r.status_code}: {r.text[:300]}"
        task_id = r.json()["result"]
    except Exception as e:                                     # noqa: BLE001
        return [], f"{type(e).__name__}: {e}"

    started = time.time()
    while True:
        if time.time() - started > GIVE_UP_AFTER:
            return [], f"timed out after {GIVE_UP_AFTER}s (task {task_id})"
        time.sleep(POLL_SECONDS)
        try:
            g = requests.get(f"{BASE}/{task_id}", headers=_headers(), timeout=60)
            if g.status_code >= 400:
                return [], f"status {g.status_code}: {g.text[:300]}"
            task = g.json()
        except Exception as e:                                 # noqa: BLE001
            return [], f"{type(e).__name__}: {e}"

        status = task.get("status")
        if status in ("PENDING", "IN_PROGRESS"):
            continue
        if status != "SUCCEEDED":
            detail = (task.get("task_error") or {}).get("message", "")
            return [], f"{status}: {detail}"

        urls = task.get("image_urls") or []
        if not urls:
            return [], "succeeded but returned no images"
        out = []
        for u in urls:
            try:
                d = requests.get(u, timeout=180)
                d.raise_for_status()
                out.append(d.content)
            except Exception as e:                             # noqa: BLE001
                return [], f"downloading a generated view: {type(e).__name__}: {e}"
        return out, ""


def balance_before_after(fn):
    """Run `fn` and report what it cost, so an unmeasured price becomes a measured one."""
    from engines.meshy import balance
    before = balance()
    result = fn()
    after = balance()
    spent = (before - after) if (before is not None and after is not None) else None
    return result, spent
