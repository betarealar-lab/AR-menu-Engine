"""The photo store.

Nothing is scanned from a drive. Frames arrive by upload and land here immediately,
under a stable dish id, because "meshy-7 vs the hybrid" is only a real comparison if
both saw identical bytes - and a working photo drive gets re-graded, renamed and moved.

    dataset/
      tuna-sandwich/
        ring-25/                    <- a variant is one angle strategy
          1-front.jpg
          2-right.jpg
          3-back.jpg
          4-left.jpg
          meta.json                 <- per-frame sha256, original filename, timestamp
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

SLOTS = ["front", "right", "back", "left"]
SLOT_ROLE = {
    0: "primary view - meshy-7 reconstructs from this one first",
    1: "coverage",
    2: "coverage",
    3: "coverage",
}


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "untitled"


def variant_dir(root: Path, dish: str, variant: str) -> Path:
    return root / slug(dish) / slug(variant)


def _meta_path(root: Path, dish: str, variant: str) -> Path:
    return variant_dir(root, dish, variant) / "meta.json"


def manifest(root: Path, dish: str, variant: str) -> dict:
    p = _meta_path(root, dish, variant)
    if p.is_file():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"dish": dish, "dish_id": slug(dish), "variant": variant, "frames": {}}


def _write(root: Path, dish: str, variant: str, meta: dict) -> None:
    p = _meta_path(root, dish, variant)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def save_frame(root: Path, dish: str, variant: str, slot: int,
               data: bytes, source_name: str) -> dict:
    """Write one uploaded frame into its slot. Re-uploading replaces it."""
    if not 0 <= slot < 4:
        raise ValueError(f"slot {slot} out of range")
    out = variant_dir(root, dish, variant)
    out.mkdir(parents=True, exist_ok=True)

    dest = out / f"{slot + 1}-{SLOTS[slot]}.jpg"
    dest.write_bytes(data)

    meta = manifest(root, dish, variant)
    meta["frames"][str(slot)] = {
        "slot": SLOTS[slot],
        "file": dest.name,
        "source_name": source_name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest()[:16],
        "stored_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _write(root, dish, variant, meta)
    return meta


def clear_frame(root: Path, dish: str, variant: str, slot: int) -> dict:
    meta = manifest(root, dish, variant)
    entry = meta["frames"].pop(str(slot), None)
    if entry:
        (variant_dir(root, dish, variant) / entry["file"]).unlink(missing_ok=True)
    _write(root, dish, variant, meta)
    return meta


def frames(root: Path, dish: str, variant: str) -> list[Path]:
    """The stored frames in slot order. This is exactly what an engine receives."""
    meta = manifest(root, dish, variant)
    d = variant_dir(root, dish, variant)
    return [d / meta["frames"][str(i)]["file"]
            for i in range(4) if str(i) in meta["frames"]]


def frame_path(root: Path, dish: str, variant: str, slot: int) -> Path | None:
    entry = manifest(root, dish, variant)["frames"].get(str(slot))
    return variant_dir(root, dish, variant) / entry["file"] if entry else None


def variants_of(root: Path, dish: str) -> list[str]:
    d = root / slug(dish)
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.is_dir() and (p / "meta.json").is_file())


def dishes(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def delete(root: Path, dish: str, variant: str | None = None) -> None:
    """Remove a variant, or the whole dish. Nothing here is precious enough to keep
    around once it is wrong - the source photos live on your own drive."""
    target = variant_dir(root, dish, variant) if variant else root / slug(dish)
    if target.is_dir():
        shutil.rmtree(target)


def catalogue(root: Path) -> list[dict]:
    """Everything stored, for re-running the whole set against a new engine."""
    rows = []
    for dish in dishes(root):
        for variant in variants_of(root, dish):
            rows.append(manifest(root, dish, variant))
    return rows
