"""Engine registry.

Add an engine here and every tool that reads the registry can use it. New
backends (self-hosted Hunyuan, the VGGT hybrid) slot in as more entries — the
runner and, later, the app never change.
"""
from __future__ import annotations

from .base import Engine, Job, Result
from .meshy import MeshyEngine

# Named configurations, not just vendors. Comparing meshy-5 against meshy-7 on
# food is worth doing: these models are trained mostly on game assets and
# characters, so newer does not automatically mean better on a plate of food.
REGISTRY: dict[str, callable] = {
    # Meshy 7 at full capacity, in the three texture resolutions it offers. Geometry is
    # always the raw master - we decimate ourselves, in our own pipeline, where the
    # result can be inspected and tuned. Texture resolution is the only generation knob
    # worth a person's attention, because it is the one that changes what the engine
    # actually produces rather than how we cut it up afterwards.
    # **7.1 is the default, and `should_remesh=False` is not optional on it.**
    #
    # Meshy deprecated `meshy-7` on 2026-09-10 in favour of `meshy-7.1` ("Attention to the
    # Closest Detail"), and the API docs say to use 7.1 or `latest` instead. Same price:
    # 30 credits for a textured multi-image task on both.
    #
    # But the default for `should_remesh` FLIPPED. On meshy-7 it was off, so sending
    # nothing returned the raw ~1.9M-triangle master - which is the whole basis of this
    # pipeline: we decimate ourselves, where it can be inspected and tuned, and Temo
    # judged Meshy's own reduction in Blender as "raw always looks better and lean is
    # subpar". On 7.1 the default is TRUE, so sending nothing would quietly hand the
    # reduction back to Meshy and every new dish would arrive pre-decimated. Hence the
    # explicit false.
    "meshy-7.1":       lambda: MeshyEngine("meshy-7.1", texture_resolution="4k",
                                           should_remesh=False),
    "meshy-7.1-2k":    lambda: MeshyEngine("meshy-7.1", texture_resolution="2k",
                                           should_remesh=False, variant="meshy-7.1-2k"),
    "meshy-7.1-8k":    lambda: MeshyEngine("meshy-7.1", texture_resolution="8k",
                                           should_remesh=False, variant="meshy-7.1-8k"),
    # `geometry_resolution` (Meshy changelog 2026-09-18, replacing `ultra_mode`): more
    # geometry detail in the raw master, +5 credits. Offered to developers to compare on
    # food; not the default until somebody has judged it in Blender beside 7.1 standard.
    "meshy-7.1-geo2k": lambda: MeshyEngine("meshy-7.1", texture_resolution="4k",
                                           should_remesh=False, geometry_resolution="2k",
                                           variant="meshy-7.1-geo2k"),

    # Kept, deprecated by Meshy and not offered as a default: every model row already in
    # the dataset names `meshy-7`, and `engines.build()` is called with THAT name when a
    # dish is resumed or re-optimised. Removing it would break exactly the in-flight work
    # a version bump is most likely to interrupt.
    "meshy-7":         lambda: MeshyEngine("meshy-7", texture_resolution="4k"),
    "meshy-7-2k":      lambda: MeshyEngine("meshy-7", texture_resolution="2k",
                                           variant="meshy-7-2k"),
    "meshy-7-8k":      lambda: MeshyEngine("meshy-7", texture_resolution="8k",
                                           variant="meshy-7-8k"),

}

# Removed 2026-09-02: meshy-7-lean, after Temo compared it against the raw master in
# Blender - "raw always looks better and lean is subpar". It only ever existed to fit a
# 512 MB host, and worker.py removed that constraint by optimising on a desktop. A
# workaround that costs quality and is no longer needed is just a worse default.
#
# Removed 2026-09-01, not because they were wrong but because a picker with eight entries
# makes somebody choose when there is no choice to make: meshy-5, meshy-6 (older, and the
# comparison was never run), meshy-7-raw (should_remesh=false, which is already the
# default), meshy-7-web (Meshy decimating to 25k - superseded by meshy-7-lean),
# meshy-7-nopbr (untextured, which no menu wants). Re-add any of them from git history
# the moment there is a question they answer.

DEFAULT = ["meshy-7", "meshy-7-2k"]


# ── Providers that exist and are switched OFF ───────────────────────
#
# fal.ai (engines/fal.py): Hunyuan 3D 3.1 Pro, Tripo, Trellis, and Meshy-through-fal.
# Written and ready; not wired (Temo, 2026-09-28: keep the Meshy Pro plan, don't wire
# fal yet). They join REGISTRY only when BOTH `FAL_KEY` is set and
# `BETAREAL_ENABLE_FAL=1`, so switching fal on is two environment variables on the engine
# host and nothing else - no code change, no deploy of the admin, which already lists
# them (admin/lib/data/dev.ts ENGINES, `wired: false`).
from .fal import FAL_ENGINES  # noqa: E402

OPTIONAL: dict[str, callable] = dict(FAL_ENGINES)


def fal_enabled() -> bool:
    import os
    return bool(os.environ.get("FAL_KEY", "").strip()) and         os.environ.get("BETAREAL_ENABLE_FAL", "") == "1"


if fal_enabled():
    REGISTRY.update(OPTIONAL)


def build(name: str) -> Engine:
    if name not in REGISTRY:
        if name in OPTIONAL:
            # Said in words, and never a fallback to Meshy: an engine nobody asked for is
            # worse than a failed job, because it spends somebody else's credits quietly.
            raise KeyError(f"engine '{name}' exists but fal is not switched on "
                           "(set FAL_KEY and BETAREAL_ENABLE_FAL=1 on the engine host)")
        raise KeyError(f"unknown engine '{name}'. known: {', '.join(REGISTRY)}")
    return REGISTRY[name]()


__all__ = ["Engine", "Job", "Result", "REGISTRY", "OPTIONAL", "DEFAULT", "build",
           "fal_enabled"]
