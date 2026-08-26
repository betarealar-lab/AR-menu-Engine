"""Turn an approved master into the three files a menu actually ships.

Deliberately a SEPARATE STAGE from generation, not part of it. A generation you are
going to reject should cost nothing beyond looking at it - decimating, Draco-compressing
and converting to USDZ a dish that turns out abhorrent is time spent on a dead model.
So: generate, look, judge, and only then export.

    master (300k tris, 4k PBR, tens of MB)
        |
        +-- decimate + resize textures  ->  model_opt.glb    uncompressed fallback
        +-- + Draco                     ->  model_draco.glb  the web payload
        +-- + USDZ                      ->  model.usdz       iOS Quick Look

Reference numbers from the burrata salad, done by hand in `BetaReal scaleable`:
99.3 MB / 1.97M triangles in; 3.26 MB, 1.99 MB and 4.01 MB out at 40k triangles.
50x smaller payload and 8x less GPU memory - and VRAM is the number that decides whether
a mid-range Android phone survives the page, not file size.

The heavy lifting is glTF-Transform, which is Node. This module finds a toolchain if one
is present and reports honestly when it is not, rather than silently shipping a master
to a diner.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

TARGET_TRIANGLES = 40_000
TARGET_TEXTURE = 2048


@dataclass
class Optimized:
    ok: bool
    files: dict[str, Path] = field(default_factory=dict)   # 'draco' | 'opt' | 'usdz'
    stats: dict = field(default_factory=dict)
    error: str = ""
    toolchain: str = ""


def toolchain() -> str:
    """Which optimizer is usable here: 'gltf-transform', 'gltfpack', or '' for none."""
    if shutil.which("gltf-transform"):
        return "gltf-transform"
    if shutil.which("npx") and _npx_has("@gltf-transform/cli"):
        return "npx-gltf-transform"
    if shutil.which("gltfpack"):
        return "gltfpack"
    return ""


def _npx_has(pkg: str) -> bool:
    try:
        r = subprocess.run(["npx", "--no-install", pkg, "--version"],
                           capture_output=True, timeout=25)
        return r.returncode == 0
    except Exception:
        return False


def available() -> bool:
    return bool(toolchain())


def _run(cmd: list[str], cwd: Path) -> tuple[bool, str]:
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)
        return r.returncode == 0, (r.stderr or r.stdout)[-600:]
    except FileNotFoundError:
        return False, f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return False, "timed out after 600s"


def run(master: Path, out_dir: Path, *, triangles: int = TARGET_TRIANGLES,
        texture: int = TARGET_TEXTURE) -> Optimized:
    """Decimate, compress and convert. Returns what it managed to produce."""
    tc = toolchain()
    if not tc:
        return Optimized(
            ok=False, toolchain="",
            error="No glTF toolchain on this host. Install Node and "
                  "`npm i -g @gltf-transform/cli`, or add Node to the container image. "
                  "The master is kept either way - nothing is lost, it just is not "
                  "shippable yet.")

    out_dir.mkdir(parents=True, exist_ok=True)
    opt = out_dir / "model_opt.glb"
    draco = out_dir / "model_draco.glb"
    base = (["gltf-transform"] if tc == "gltf-transform" else
            ["npx", "--no-install", "@gltf-transform/cli"])

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        staged = work / "in.glb"
        shutil.copy2(master, staged)

        # Decimate and shrink textures. `optimize` bundles weld/join/simplify/resize.
        ok, log = _run(base + [
            "optimize", str(staged), str(opt),
            "--compress", "false",
            "--simplify-error", "0.001",
            "--texture-size", str(texture),
        ], work)
        if not ok:
            return Optimized(ok=False, toolchain=tc, error=f"optimize failed: {log}")

        # Draco is the web payload. This reverses the old "no Draco" rule, which existed
        # only because the Three.js WebXR path had no decoder - it lazy-loads one now,
        # and model-viewer has always bundled its own.
        ok, log = _run(base + ["draco", str(opt), str(draco)], work)
        if not ok:
            return Optimized(ok=False, toolchain=tc, error=f"draco failed: {log}",
                             files={"opt": opt})

    files = {"opt": opt, "draco": draco}
    stats = {
        "master_bytes": master.stat().st_size,
        "opt_bytes": opt.stat().st_size,
        "draco_bytes": draco.stat().st_size,
        "shrink": round(master.stat().st_size / max(draco.stat().st_size, 1), 1),
        "target_triangles": triangles,
        "target_texture": texture,
    }
    # USDZ needs Apple's tooling or a converter that is not reliably present on Linux.
    # Meshy returns a USDZ of its own, so the pipeline uses that and skips the conversion
    # rather than pretending. Revisit if the master ever diverges from what Meshy shipped.
    return Optimized(ok=True, files=files, stats=stats, toolchain=tc)


def describe() -> str:
    tc = toolchain()
    return tc or "none (masters kept, export unavailable)"
