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


def build(name: str) -> Engine:
    if name not in REGISTRY:
        raise KeyError(f"unknown engine '{name}'. known: {', '.join(REGISTRY)}")
    return REGISTRY[name]()


__all__ = ["Engine", "Job", "Result", "REGISTRY", "DEFAULT", "build"]
