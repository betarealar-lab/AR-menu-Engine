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
    # Default is deliberately the highest fidelity the API allows: 300k triangles, 4k PBR.
    # We decimate ourselves afterwards, because Meshy's internal decimator is a black box
    # and food loses its thin detail first. Bigger in, same size out.
    "meshy-7":         lambda: MeshyEngine("meshy-7"),
    "meshy-7-8k":      lambda: MeshyEngine("meshy-7", texture_resolution="8k"),
    "meshy-7-raw":     lambda: MeshyEngine("meshy-7", should_remesh=False,
                                           variant="meshy-7-raw"),
    "meshy-6":         lambda: MeshyEngine("meshy-6"),
    "meshy-5":         lambda: MeshyEngine("meshy-5"),

    # Pre-decimated by Meshy. Kept only so the two reductions can be compared on the same
    # dish - if Meshy's decimator turns out to beat ours on food, this is how we find out.
    "meshy-7-web":     lambda: MeshyEngine("meshy-7", texture_resolution="2k",
                                           target_polycount=25_000,
                                           variant="meshy-7-web-25k"),
    "meshy-7-nopbr":   lambda: MeshyEngine("meshy-7", enable_pbr=False,
                                           variant="meshy-7-nopbr"),
}

DEFAULT = ["meshy-7", "meshy-5"]


def build(name: str) -> Engine:
    if name not in REGISTRY:
        raise KeyError(f"unknown engine '{name}'. known: {', '.join(REGISTRY)}")
    return REGISTRY[name]()


__all__ = ["Engine", "Job", "Result", "REGISTRY", "DEFAULT", "build"]
