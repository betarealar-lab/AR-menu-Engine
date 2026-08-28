"""Dishes, variants, frames and verdicts - all of it through `storage`.

Layout in the photos bucket:

    dishes/<dish_id>/<variant>/record.json     frames + verdict + who did what
    dishes/<dish_id>/<variant>/1-front.jpg
    dishes/<dish_id>/<variant>/2-right.jpg     ... etc

and in the models bucket:

    models/<dish_id>/<variant>/<engine>/model.glb   .usdz   .png

**One record per dish+variant, not one shared state file.** With several teammates working
at once a single studio.json would be a write race - two people judging different dishes
would overwrite each other. Keyed per variant, they never collide.

A VARIANT is one angle strategy for one dish (`ring-25`, `ring-45`, `three-plus-top`). The
same dish shot four ways is four experiments.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

import storage

SLOTS = ["front", "right", "back", "left"]
SLOT_ROLE = {
    0: "primary view - meshy-7 reconstructs from this one first",
    1: "coverage", 2: "coverage", 3: "coverage",
}
PHOTOS, MODELS = "photos", "models"

# The pipeline a record moves through. `catalogued` used to be a state here; it is now
# derived - a variant is shippable when it HAS catalogue files, which is a fact about the
# object graph rather than a flag someone has to remember to set.
STATUSES = ("empty", "ready", "running", "optimising", "review", "failed")

# One real-world dimension is enough: the model supplies the aspect ratio for the other
# two. Which one a person knows varies - the height of a burger, the diameter of a bowl -
# so all three are offered and any one is accepted. See glb.bounds for what each measures.
SCALE_AXES = ("width", "length", "height")

# Proposed defaults, so nobody starts from a blank number. **Every figure here is a
# guess** carried over from ROADMAP 0.4 - the fault tags and ~30 real dishes are what will
# replace it. Do not let it harden into doctrine.
SHAPES = [
    {"id": "flat-plated", "label": "Flat plated", "axis": "width", "cm": 28},
    {"id": "deep-bowl", "label": "Deep bowl", "axis": "width", "cm": 18},
    {"id": "wide-flat", "label": "Wide flat / sharing", "axis": "width", "cm": 35},
    {"id": "tall-stacked", "label": "Tall / stacked", "axis": "height", "cm": 12},
]


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "untitled"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _prefix(dish: str, variant: str) -> str:
    return f"dishes/{slug(dish)}/{slug(variant)}"


def _record_key(dish: str, variant: str) -> str:
    return f"{_prefix(dish, variant)}/record.json"


def blank(dish: str, variant: str) -> dict:
    return {
        "dish": dish, "dish_id": slug(dish), "variant": variant,
        "frames": {}, "status": "empty", "verdict": "", "faults": [], "note": "",
        "engine": "", "seconds": 0, "error": "", "model_key": "",
        # What generation produced untouched (`master_keys`) and what the optimiser
        # made from it (`catalog_keys`). Both are kept, but the catalogue is what gets
        # judged and what ships - see optimize.py.
        "master_keys": {}, "catalog_keys": {}, "catalogued_utc": "",
        "export_error": "", "export_stats": {},
        # One dimension in centimetres, plus the shape it was proposed from.
        # {"axis": "width", "cm": 28, "shape": "flat-plated", "set_by": ..., "set_utc": ...}
        # Empty means nobody has said how big the dish is, so it ships at whatever size
        # the engine invented - which is the single most common way a model has to be
        # remade, and why this sits next to the frames rather than buried in a setting.
        "scale": {},
        "created_utc": _now(), "judged_by": "", "judged_utc": "",
    }


def record(dish: str, variant: str) -> dict:
    raw = storage.backend().get(PHOTOS, _record_key(dish, variant))
    if not raw:
        return blank(dish, variant)
    r = blank(dish, variant) | json.loads(raw)
    return r


def write(rec: dict) -> dict:
    storage.backend().put(
        PHOTOS, _record_key(rec["dish"], rec["variant"]),
        json.dumps(rec, indent=2).encode(), "application/json")
    return rec


# ── frames ──────────────────────────────────────────────────────────

def frame_key(dish: str, variant: str, slot: int) -> str:
    return f"{_prefix(dish, variant)}/{slot + 1}-{SLOTS[slot]}.jpg"


def save_frame(dish: str, variant: str, slot: int, data: bytes,
               source_name: str, by: str = "") -> dict:
    if not 0 <= slot < 4:
        raise ValueError(f"slot {slot} out of range")
    key = frame_key(dish, variant, slot)
    storage.backend().put(PHOTOS, key, data, "image/jpeg")

    rec = record(dish, variant)
    rec["frames"][str(slot)] = {
        "slot": SLOTS[slot], "key": key, "source_name": source_name,
        "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()[:16],
        "uploaded_utc": _now(), "uploaded_by": by,
    }
    if rec["status"] in ("empty", ""):
        rec["status"] = "ready"
    return write(rec)


def clear_frame(dish: str, variant: str, slot: int) -> dict:
    rec = record(dish, variant)
    entry = rec["frames"].pop(str(slot), None)
    if entry:
        storage.backend().delete_prefix(PHOTOS, entry["key"])
    return write(rec)


def read_frame(dish: str, variant: str, slot: int) -> bytes | None:
    return storage.backend().get(PHOTOS, frame_key(dish, variant, slot))


def frames(dish: str, variant: str) -> list[bytes]:
    """The stored frames in slot order - exactly what an engine receives."""
    rec = record(dish, variant)
    out = []
    for i in range(4):
        e = rec["frames"].get(str(i))
        if e:
            b = storage.backend().get(PHOTOS, e["key"])
            if b:
                out.append(b)
    return out


# ── models ──────────────────────────────────────────────────────────

def model_key(dish: str, variant: str, engine: str, ext: str) -> str:
    """Masters live under the engine that made them; the catalogue is what ships."""
    return f"models/{slug(dish)}/{slug(variant)}/{engine}/model.{ext}"


def catalog_key(dish: str, variant: str, name: str) -> str:
    return f"catalog/{slug(dish)}/{slug(variant)}/{name}"


def save_catalog(dish: str, variant: str, name: str, data: bytes) -> str:
    ext = name.rsplit(".", 1)[-1].lower()
    ctype = {"glb": "model/gltf-binary", "usdz": "model/vnd.usdz+zip",
             "png": "image/png"}.get(ext, "application/octet-stream")
    key = catalog_key(dish, variant, name)
    storage.backend().put(MODELS, key, data, ctype)
    return key


def save_model(dish: str, variant: str, engine: str, ext: str, data: bytes) -> str:
    ctype = {"glb": "model/gltf-binary", "usdz": "model/vnd.usdz+zip",
             "png": "image/png"}.get(ext, "application/octet-stream")
    key = model_key(dish, variant, engine, ext)
    storage.backend().put(MODELS, key, data, ctype)
    return key


def read_model(key: str) -> bytes | None:
    return storage.backend().get(MODELS, key)


# ── listing ─────────────────────────────────────────────────────────

def dishes() -> list[str]:
    return storage.backend().children(PHOTOS, "dishes/")


def variants_of(dish: str) -> list[str]:
    return storage.backend().children(PHOTOS, f"dishes/{slug(dish)}/")


def delete(dish: str, variant: str | None = None) -> None:
    """Remove a variant or a whole dish. The originals live on someone's own drive."""
    b = storage.backend()
    if variant:
        b.delete_prefix(PHOTOS, _prefix(dish, variant))
        b.delete_prefix(MODELS, f"models/{slug(dish)}/{slug(variant)}")
    else:
        b.delete_prefix(PHOTOS, f"dishes/{slug(dish)}")
        b.delete_prefix(MODELS, f"models/{slug(dish)}")


def catalogue() -> list[dict]:
    """Every stored variant - for re-running the whole set against a new engine."""
    return [record(d, v) for d in dishes() for v in variants_of(d)]
