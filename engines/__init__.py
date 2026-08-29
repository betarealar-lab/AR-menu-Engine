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
    # THE DEFAULT. Asks Meshy to remesh to 150k and to return 2k textures, because we
    # decimate to 40k and downscale to 2048 anyway - so the extra detail in a 1.9M
    # triangle, 4k texture master is thrown away, after being paid for in transfer and
    # in memory. Measured on the same dish, both ways:
    #
    #     raw master    69.6 MB in   ->  3.00 MB draco, 39,968 tris   node peak 648 MB
    #     lean master    7.8 MB in   ->  3.00 MB draco, 39,992 tris   node peak 193 MB
    #
    # Identical output. The difference is entirely in what it costs to get there, and
    # 648 MB against 193 MB is the difference between needing a paid host and not.
    #
    # This reverses "ask for maximum detail, decimate ourselves". That rule was right
    # about WHY - Meshy's decimator is a black box and food loses thin detail first -
    # but it assumed the cost was free. It is not, and 150k is still 3.75x more than we
    # ship, so our own decimator still does the final and largest reduction. What has
    # NOT been tested is whether Meshy's first cut loses garnish ours would have kept.
    # `meshy-7` below is kept for exactly that comparison: same dish, both engines, and
    # the Shipping/Master toggle to judge them.
    "meshy-7-lean":    lambda: MeshyEngine("meshy-7", texture_resolution="2k",
                                           should_remesh=True, target_polycount=150_000,
                                           variant="meshy-7-lean"),

    # The raw master: 1.9M triangles, 4k textures. The archival input, and the control
    # in the comparison above. Needs ~800 MB to optimise - see limits.py.
    "meshy-7":         lambda: MeshyEngine("meshy-7"),
    "meshy-7-8k":      lambda: MeshyEngine("meshy-7", texture_resolution="8k"),
    "meshy-7-raw":     lambda: MeshyEngine("meshy-7", should_remesh=False,
                                           variant="meshy-7-raw"),
    "meshy-6":         lambda: MeshyEngine("meshy-6"),
    "meshy-5":         lambda: MeshyEngine("meshy-5"),

    # Pre-decimated by Meshy. Kept only so the two reductions can be compared on the same
    # dish - if Meshy's decimator turns out to beat ours on food, this is how we find out.
    # `should_remesh=True` is what makes target_polycount mean anything; without it the
    # number was transmitted and ignored, and this entry was quietly identical to the
    # default. Measured 2026-08-29.
    "meshy-7-web":     lambda: MeshyEngine("meshy-7", texture_resolution="2k",
                                           should_remesh=True, target_polycount=25_000,
                                           variant="meshy-7-web-25k"),
    "meshy-7-nopbr":   lambda: MeshyEngine("meshy-7", enable_pbr=False,
                                           variant="meshy-7-nopbr"),
}

DEFAULT = ["meshy-7-lean", "meshy-7"]


def build(name: str) -> Engine:
    if name not in REGISTRY:
        raise KeyError(f"unknown engine '{name}'. known: {', '.join(REGISTRY)}")
    return REGISTRY[name]()


__all__ = ["Engine", "Job", "Result", "REGISTRY", "DEFAULT", "build"]
