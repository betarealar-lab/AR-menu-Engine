"""Minimal GLB surgery: resize the textures inside a binary glTF, in pure Python.

Why this exists rather than `gltf-transform resize`: that path goes through sharp/libvips,
which fails on Meshy's textures with

    GLib-GObject-CRITICAL: value "32" ... invalid for property 'space' of VipsInterpretation
    error: colourspace: parameter space not set

The textures themselves are perfectly ordinary - three baseline JPEGs at 8192x8192 and
4096x4096, which Pillow opens without complaint. So the bug is in the resizer, not the
asset, and routing around it removes a whole native dependency: no libvips in the
container, no platform-specific image stack to keep alive.

Texture size is the thing that actually matters here. Geometry decimation took the burrata
salad from 104 MB to 49 MB; the remaining 43 MB was three JPEGs, and an 8192x8192 base
colour map costs 256 MB of VRAM on its own before a phone has drawn anything.
"""
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

from PIL import Image

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942
_PAD = 4


def _pad(n: int) -> int:
    return (_PAD - (n % _PAD)) % _PAD


def _read_json(path: Path) -> dict:
    """The JSON chunk alone, without touching the binary.

    Triangle counts and bounding boxes both live entirely in the accessors, so reading a
    70 MB master to answer either of them costs ~140 MB - the file, plus the slice copy
    of the BIN chunk - for data that sits in the first few hundred kilobytes. On a 512 MB
    container that allocation is the difference between a run finishing and the whole
    instance being OOM-killed, which is what happened on 2026-08-29.

    GLB puts the JSON chunk first by specification, so this is a seek and one small read.
    """
    with open(path, "rb") as fh:
        head = fh.read(12)
        magic, _version, _length = struct.unpack_from("<III", head, 0)
        if magic != 0x46546C67:
            raise ValueError(f"{path.name} is not a GLB")
        clen, ctype = struct.unpack("<II", fh.read(8))
        if ctype != JSON_CHUNK:
            raise ValueError(f"{path.name}: first chunk is not JSON")
        return json.loads(fh.read(clen).decode("utf-8"))


def _read(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    magic, _version, length = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path.name} is not a GLB")
    # A memoryview, not a slice: slicing the BIN chunk out copies it, so the file is
    # held twice at once. On the masters this pipeline handles that doubling is tens of
    # megabytes for nothing.
    view = memoryview(raw)
    gltf, binary, off = None, b"", 12
    while off < length:
        clen, ctype = struct.unpack_from("<II", raw, off)
        if ctype == JSON_CHUNK:
            gltf = json.loads(bytes(view[off + 8: off + 8 + clen]).decode("utf-8"))
        elif ctype == BIN_CHUNK:
            binary = view[off + 8: off + 8 + clen]
        off += 8 + clen
    if gltf is None:
        raise ValueError(f"{path.name} has no JSON chunk")
    return gltf, binary


def _write(path: Path, gltf: dict, binary) -> None:
    """`binary` is any bytes-like. The reader hands back a memoryview so the chunk is
    not copied, so padding is written rather than concatenated onto it."""
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * _pad(len(js))
    blen = len(binary)
    bpad = _pad(blen)
    total = 12 + 8 + len(js) + (8 + blen + bpad if blen else 0)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), JSON_CHUNK)); fh.write(js)
        if blen:
            fh.write(struct.pack("<II", blen + bpad, BIN_CHUNK))
            fh.write(binary)
            if bpad:
                fh.write(b"\x00" * bpad)


# A texture already at the target resolution can still be enormous, because PNG is
# lossless. Meshy returns a 2048px normal map as a 7.85 MB PNG - the same pixels a JPEG
# stores in about one. Skipping it "because it is already 2048" shipped a 14 MB model
# where 3 MB was expected, and nobody noticed, because the pixel check said it was fine.
#
# So there are two budgets. Pixels decide GPU memory; BYTES decide download size, and
# they are not the same problem.
MAX_TEXTURE_BYTES = 2_500_000


# Per-map budgets, not one number for everything. Measured on four shipped engine dishes
# by downscaling each map and blowing it back up to compare against the original:
#
#   baseColor  2048 -> 1024   mean error 4.1-8.3, p99 up to 64/255   the dish itself
#   normal     2048 ->  512   mean error 1.6-3.6, and 256 is no worse - its detail
#                             simply does not live above 512
#   MR         2048 -> 1024   mean error 0.6-1.8
#
# So one `--tex 2048` spends the same on all three, and two of them cannot use it. The
# base colour is the only map that earns full resolution.
TEXTURE_BUDGET = {"baseColor": 2048, "normal": 1024, "metallicRoughness": 1024,
                  "emissive": 1024, "occlusion": 1024, "other": 1024}

# metallic is zero on a plate of food, and not approximately: measured across every engine
# dish in the bucket the blue channel runs mean 0.6-1.4 with p99 <= 7 out of 255. That is a
# constant being stored as a megapixel image. Below this it becomes `metallicFactor`, which
# renders identically because a constant map and a constant factor ARE the same maths.
#
# Roughness is NOT constant - it spans 23 to 111 of 255 on the same dishes, which is wet
# fish against dry rice - so it is kept, and only the dead channels around it are dropped.
FLAT_CHANNEL_P99 = 12


def texture_source(tex: dict) -> int | None:
    """The image a texture points at, whether it is core glTF or EXT_texture_webp.

    A WebP texture has no `source` at all - the extension carries it - so anything that
    reads `tex["source"]` directly sees a texture with no image and silently drops it.
    """
    if "source" in tex:
        return tex["source"]
    return tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source")


def _roles(gltf: dict) -> dict[int, str]:
    """Which map is which, by image index. Unreferenced images come back as 'other'."""
    by_texture: dict[int, str] = {}
    for mat in gltf.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        for key, role in (("baseColorTexture", "baseColor"),
                          ("metallicRoughnessTexture", "metallicRoughness")):
            if key in pbr:
                by_texture[pbr[key]["index"]] = role
        for key, role in (("normalTexture", "normal"), ("emissiveTexture", "emissive"),
                          ("occlusionTexture", "occlusion")):
            if key in mat:
                by_texture[mat[key]["index"]] = role
    out: dict[int, str] = {}
    for ti, tex in enumerate(gltf.get("textures", [])):
        src = texture_source(tex)
        if src is not None:
            out[src] = by_texture.get(ti, "other")
    return out


def _flat_metal(im) -> tuple[bool, float]:
    """Is the metallic channel constant, and what is its value? See FLAT_CHANNEL_P99."""
    try:
        import numpy as np
    except ImportError:
        return False, 0.0
    blue = np.asarray(im.convert("RGB"))[:, :, 2]
    spread = float(np.percentile(blue, 99)) - float(np.percentile(blue, 1))
    return spread <= FLAT_CHANNEL_P99, float(blue.mean()) / 255.0


def resize_textures(src: Path, dst: Path, max_edge: int = 2048,
                    quality: int = 90, max_bytes: int = MAX_TEXTURE_BYTES,
                    webp: bool = True) -> dict:
    """Shrink every embedded texture to the budget for the map it actually is, then repack.

    `max_edge` is the ceiling for the base colour; every other map gets TEXTURE_BUDGET,
    which is lower because measurement says their detail does not reach 2048 anyway.

    Three things happen that a plain resize does not:

      * the base colour is written as WebP, ~25% smaller than JPEG at matching quality. It
        needs EXT_texture_webp, declared below - three.js and model-viewer both read it,
        and a hand-optimised dish already shipping on JAPAN proves the path.
      * a metallicRoughness map whose metallic channel is constant - every food scan
        measured - loses its chroma entirely and is stored as greyscale roughness, with
        `metallicFactor` carrying the constant. Identical render, no chroma planes.
      * nothing is ever replaced by something larger, so running this twice, or over a file
        somebody already optimised by hand, costs nothing and degrades nothing.

    Every bufferView is rewritten in order, because changing one image's length shifts
    every offset after it. Rebuilding the whole buffer is simpler than patching offsets
    and impossible to get subtly wrong.
    """
    gltf, binary = _read(src)
    views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])
    roles = _roles(gltf)

    replacement: dict[int, bytes] = {}
    metallic_of: dict[int, float] = {}       # image index -> the constant it collapsed to
    before = after = 0
    resized = skipped = 0
    wrote_webp = False

    for ii, img in enumerate(images):
        vi = img.get("bufferView")
        if vi is None:                       # external URI texture - nothing to do here
            skipped += 1
            continue
        bv = views[vi]
        start = bv.get("byteOffset", 0)
        data = bytes(binary[start:start + bv["byteLength"]])
        before += len(data)
        role = roles.get(ii, "other")
        edge = max_edge if role == "baseColor" else min(max_edge, TEXTURE_BUDGET[role])
        try:
            with Image.open(io.BytesIO(data)) as im:
                im.load()
                # Alpha is load-bearing where it exists - a cut-out leaf, a glass. It
                # survives as WebP or PNG; only JPEG cannot carry it.
                has_alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
                flat = False
                if role == "metallicRoughness" and not has_alpha:
                    flat, value = _flat_metal(im)
                    if flat:
                        metallic_of[ii] = value
                        im = im.convert("RGB").getchannel("G")   # roughness, alone
                too_wide = max(im.size) > edge
                # What this image SHOULD be, decided before the skip so that a base colour
                # already at 2048 and already small still gets converted. Without this the
                # "it is fine as it is" test fires first and WebP is never reached - the
                # exact bug that made the first run of this leave every baseColor as JPEG.
                want = "image/webp" if webp and (role == "baseColor" or has_alpha) else (
                    "image/png" if has_alpha else "image/jpeg")
                if (not too_wide and not flat and len(data) <= max_bytes
                        and img.get("mimeType") == want):
                    after += len(data)
                    skipped += 1
                    continue
                if too_wide:
                    im.thumbnail((edge, edge), Image.LANCZOS)
                buf = io.BytesIO()
                if has_alpha and webp:
                    im.convert("RGBA").save(buf, "WEBP", quality=quality, method=6)
                    mime = "image/webp"
                elif has_alpha:
                    im.convert("RGBA").save(buf, "PNG", optimize=True)
                    mime = "image/png"
                elif role == "baseColor" and webp:
                    im.convert("RGB").save(buf, "WEBP", quality=min(quality, 85), method=6)
                    mime = "image/webp"
                else:
                    im.convert("L" if flat else "RGB").save(
                        buf, "JPEG", quality=quality, optimize=True)
                    mime = "image/jpeg"
                new = buf.getvalue()
                # Re-encoding is only ever an improvement if it actually shrinks. This is
                # what keeps the pass idempotent over an already-optimised file, and what
                # stops a format change from making a texture bigger than it was.
                if len(new) >= len(data) and not too_wide and not flat:
                    metallic_of.pop(ii, None)
                    after += len(data)
                    skipped += 1
                    continue
        except Exception:                    # unreadable - keep the original untouched
            metallic_of.pop(ii, None)
            after += len(data)
            skipped += 1
            continue
        replacement[vi] = new
        img["mimeType"] = mime
        after += len(new)
        resized += 1

    # A greyscale roughness map only renders correctly once the constant it gave up comes
    # back as the factor. Done per MATERIAL, because that is where the factor lives.
    collapsed = 0
    for mat in gltf.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        mr = pbr.get("metallicRoughnessTexture")
        if not mr:
            continue
        source = texture_source(gltf["textures"][mr["index"]])
        if source in metallic_of:
            pbr["metallicFactor"] = round(metallic_of[source], 4)
            collapsed += 1

    # WebP is an extension, and a REQUIRED one: a texture carrying its image there has no
    # `source`, so a loader that skips the extension draws an untextured grey dish instead
    # of failing. Better to fail loudly than to serve a grey dish.
    #
    # Asked of the FINAL images, not only of the ones this pass rewrote. A file that
    # arrived already carrying WebP - a dish optimised by hand before it reached us - may
    # declare no extension at all and still load, because three.js sniffs the bytes. That
    # is luck, not a contract, so it gets declared properly on the way out either way.
    wrote_webp = any(im.get("mimeType") == "image/webp" for im in images)
    if wrote_webp:
        for tex in gltf.get("textures", []):
            src_i = texture_source(tex)
            if src_i is not None and images[src_i].get("mimeType") == "image/webp":
                tex.pop("source", None)
                tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": src_i}
        for key in ("extensionsUsed", "extensionsRequired"):
            gltf[key] = sorted(set(gltf.get(key, [])) | {"EXT_texture_webp"})

    # Repack: walk every view in order, substituting the new image bytes.
    packed = bytearray()
    for i, bv in enumerate(views):
        if i in replacement:
            chunk = replacement[i]
        else:
            start = bv.get("byteOffset", 0)
            chunk = binary[start:start + bv["byteLength"]]
        bv["byteOffset"] = len(packed)
        bv["byteLength"] = len(chunk)
        packed += chunk
        packed += b"\x00" * _pad(len(packed))

    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(packed)
        gltf["buffers"][0].pop("uri", None)

    _write(dst, gltf, bytes(packed))
    return {
        "textures_resized": resized,
        "textures_skipped": skipped,
        "texture_bytes_before": before,
        "texture_bytes_after": after,
        "metallic_collapsed": collapsed,
        "max_edge": max_edge,
        "max_texture_bytes": max_bytes,
    }


def megapixels(path: Path) -> float:
    """Total decoded texture pixels, in millions.

    The honest proxy for what textures cost in memory. A 2048x2048 image decodes to
    16 MB of RAM whether it arrived as a 0.4 MB JPEG or a 7.9 MB PNG, so counting
    compressed bytes - which limits.py did until 2026-08-30 - measures the wrong thing
    and refuses jobs that would have fitted.
    """
    total = 0.0
    for t in summarize(path):
        size = t.get("size")
        if size:
            total += size[0] * size[1]
    return round(total / 1_000_000, 2)


def count_triangles(path: Path) -> int:
    """Triangles in the whole file, counted from the accessors.

    Needed to turn a triangle target into the ratio glTF-Transform actually wants, and to
    report what a decimation really produced rather than what was asked for.
    """
    gltf = _read_json(path)
    accessors = gltf.get("accessors", [])
    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:          # 4 = TRIANGLES
                continue
            idx = prim.get("indices")
            if idx is not None:
                total += accessors[idx]["count"] // 3
            else:
                pos = prim.get("attributes", {}).get("POSITION")
                if pos is not None:
                    total += accessors[pos]["count"] // 3
    return total


def summarize(path: Path) -> list[dict]:
    """What textures are in here, and how big - for diagnosing a bad master."""
    gltf, binary = _read(path)
    out = []
    for i, img in enumerate(gltf.get("images", [])):
        vi = img.get("bufferView")
        if vi is None:
            continue
        bv = gltf["bufferViews"][vi]
        data = binary[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        try:
            with Image.open(io.BytesIO(data)) as im:
                out.append({"index": i, "format": im.format, "size": im.size,
                            "bytes": len(data)})
        except Exception:
            out.append({"index": i, "format": "?", "size": None, "bytes": len(data)})
    return out


# ── placement: real-world scale and seating ─────────────────────────
#
# A generative engine returns a model in arbitrary units, centred on nothing in
# particular. Quick Look and WebXR both assume metres and both assume the object
# stands on y=0, so a dish that is not placed lands at whatever size and height the
# engine happened to produce - which in practice is a salad the size of a car.
#
# `BetaReal scaleable\scripts\optimize-model.mjs` already does this by hand, and its
# `--size` flag means "the widest horizontal span, in metres". The MondayGreens folder
# names (`tomato-soup-with-bread-30cm`) encode the same number. This is that convention,
# in Python, so the Studio and the hand-run script agree.
#
# What is deliberately NOT here: auto-rotation. The .mjs script guesses upright from the
# thinnest axis because its inputs came out sideways. Ours do not - a sideways model came
# from a sideways photo, and guessing would break the correct ones.

def _node_matrix(node: dict) -> list[float]:
    """A node's local transform as a column-major 16-float matrix (glTF's own layout)."""
    if "matrix" in node:
        return list(node["matrix"])
    tx, ty, tz = node.get("translation", [0.0, 0.0, 0.0])
    x, y, z, w = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    sx, sy, sz = node.get("scale", [1.0, 1.0, 1.0])
    r = ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
         (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
         (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))
    return [r[0][0] * sx, r[1][0] * sx, r[2][0] * sx, 0.0,
            r[0][1] * sy, r[1][1] * sy, r[2][1] * sy, 0.0,
            r[0][2] * sz, r[1][2] * sz, r[2][2] * sz, 0.0,
            tx, ty, tz, 1.0]


def _mat_mul(a: list[float], b: list[float]) -> list[float]:
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def _xform(m: list[float], p) -> tuple[float, float, float]:
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


_IDENTITY = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _scene_roots(gltf: dict) -> list[int]:
    scenes = gltf.get("scenes") or []
    if not scenes:
        return list(range(len(gltf.get("nodes", []))))
    return list(scenes[gltf.get("scene", 0)].get("nodes", []))


def _bounds_of(gltf: dict) -> tuple[list[float], list[float]] | None:
    """World-space AABB of the default scene, from the POSITION accessors' own min/max.

    glTF requires min/max on POSITION, so this needs no buffer decoding - it transforms
    the eight corners of each primitive's box by that node's accumulated matrix. Corners
    rather than the box itself, because a rotated node's box is not axis-aligned.
    """
    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    nodes = gltf.get("nodes", [])
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    def walk(idx: int, parent: list[float]) -> None:
        node = nodes[idx]
        m = _mat_mul(parent, _node_matrix(node))
        mi = node.get("mesh")
        if mi is not None:
            for prim in meshes[mi].get("primitives", []):
                pos = prim.get("attributes", {}).get("POSITION")
                if pos is None:
                    continue
                acc = accessors[pos]
                a, b = acc.get("min"), acc.get("max")
                if not a or not b:
                    continue
                for cx in (a[0], b[0]):
                    for cy in (a[1], b[1]):
                        for cz in (a[2], b[2]):
                            p = _xform(m, (cx, cy, cz))
                            for i in range(3):
                                lo[i] = min(lo[i], p[i])
                                hi[i] = max(hi[i], p[i])
        for child in node.get("children", []):
            walk(child, m)

    for root in _scene_roots(gltf):
        walk(root, _IDENTITY)
    return None if lo[0] == float("inf") else (lo, hi)


def bounds(path: Path) -> dict:
    """Size of the model as it stands, in whatever units the engine used.

    `width` is the WIDEST horizontal span and `length` the other one, because that is
    what a person means by the width of a plate and what the `-30cm` naming convention
    already encodes. Which of X and Z each lands on is not knowable and does not matter.
    """
    gltf = _read_json(path)
    got = _bounds_of(gltf)
    if not got:
        return {}
    lo, hi = got
    size = [hi[i] - lo[i] for i in range(3)]
    horiz = sorted((size[0], size[2]), reverse=True)
    return {
        "min": lo, "max": hi, "size": size,
        "width": horiz[0], "length": horiz[1], "height": size[1],
    }


def span(path_or_bounds, axis: str) -> float:
    """The extent the named dimension refers to. 0 if it cannot be measured."""
    b = path_or_bounds if isinstance(path_or_bounds, dict) else bounds(path_or_bounds)
    return float(b.get(axis) or 0.0)


def place(src: Path, dst: Path, *, factor: float = 1.0, seat: bool = True) -> dict:
    """Scale uniformly, centre on X/Z and stand on y=0.

    Done by wrapping the scene in one new root node rather than by rewriting vertices.
    That keeps every position accessor byte-identical, which matters because Draco
    quantises positions in local space - baking a 0.003x scale into the vertices first
    would throw away most of the precision Draco is given to work with.
    """
    gltf, binary = _read(src)
    before = _bounds_of(gltf)
    if not before:
        raise ValueError(f"{src.name}: no measurable geometry")
    lo, hi = before

    tx = ty = tz = 0.0
    if seat:
        tx = -factor * (lo[0] + hi[0]) / 2
        ty = -factor * lo[1]
        tz = -factor * (lo[2] + hi[2]) / 2

    roots = _scene_roots(gltf)
    changed = abs(factor - 1.0) > 1e-9 or any(abs(v) > 1e-9 for v in (tx, ty, tz))
    if changed:
        nodes = gltf.setdefault("nodes", [])
        nodes.append({"name": "betareal_placement",
                      "scale": [factor, factor, factor],
                      "translation": [tx, ty, tz],
                      "children": roots})
        scenes = gltf.setdefault("scenes", [{"nodes": roots}])
        scenes[gltf.get("scene", 0)]["nodes"] = [len(nodes) - 1]

    _write(dst, gltf, binary)
    after = _bounds_of(gltf)
    size = [after[1][i] - after[0][i] for i in range(3)] if after else []
    return {
        "placement_factor": factor,
        "placement_seated": bool(seat and changed),
        "size_before": [hi[i] - lo[i] for i in range(3)],
        "size_after": size,
    }

# ── reading vertex data ─────────────────────────────────────────────
#
# Everything above this point answers questions from the JSON header alone. Converting to
# another format is the one job that needs the actual numbers, so this is the only place
# that decodes buffers - and it is used on the OPTIMISED file (40k triangles), never on a
# 1.9M-triangle master.

_COMPONENT = {                      # glTF componentType -> (struct code, bytes)
    5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
    5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4),
}
_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(gltf: dict, binary, index: int) -> list[tuple]:
    """One accessor as a list of tuples (or of scalars for SCALAR).

    Handles byteStride, because glTF is allowed to interleave attributes in one
    bufferView and Meshy's output does not - but a file that has been through
    glTF-Transform may.
    """
    acc = gltf["accessors"][index]
    code, size = _COMPONENT[acc["componentType"]]
    n = _COUNT[acc["type"]]
    count = acc["count"]
    if "bufferView" not in acc:                       # sparse-only or all zeros
        return [(0.0,) * n if n > 1 else 0 for _ in range(count)]
    bv = gltf["bufferViews"][acc["bufferView"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or size * n
    out = []
    for i in range(count):
        off = start + i * stride
        values = struct.unpack_from("<" + code * n, binary, off)
        out.append(values[0] if n == 1 else values)
    return out


def image_bytes(gltf: dict, binary, index: int, *,
                readable: tuple[str, ...] = ()) -> tuple[bytes, str]:
    """An embedded image and its file extension.

    `readable` names the mime types the CALLER can actually open, and anything else is
    transcoded rather than handed over with a `.bin` extension. USDZ is the reason: Quick
    Look reads PNG and JPEG only, so once the web payload started carrying WebP base
    colours, the iOS package would have shipped an image no Apple device can decode -
    silently, because a texture that fails to load renders as untextured grey rather than
    as an error.
    """
    img = gltf["images"][index]
    bv = gltf["bufferViews"][img["bufferView"]]
    off = bv.get("byteOffset", 0)
    data = bytes(binary[off: off + bv["byteLength"]])
    mime = img.get("mimeType", "")
    if readable and mime not in readable:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            buf = io.BytesIO()
            if im.mode in ("RGBA", "LA", "PA") and "image/png" in readable:
                im.convert("RGBA").save(buf, "PNG", optimize=True)
                return buf.getvalue(), ".png"
            im.convert("RGB").save(buf, "JPEG", quality=90, optimize=True)
            return buf.getvalue(), ".jpg"
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(mime, ".bin")
    return data, ext


def world_transforms(gltf: dict) -> list[tuple[int, list[float]]]:
    """(mesh index, world matrix) for every mesh instance in the default scene."""
    nodes = gltf.get("nodes", [])
    out: list[tuple[int, list[float]]] = []

    def walk(idx: int, parent: list[float]) -> None:
        node = nodes[idx]
        m = _mat_mul(parent, _node_matrix(node))
        if node.get("mesh") is not None:
            out.append((node["mesh"], m))
        for child in node.get("children", []):
            walk(child, m)

    for root in _scene_roots(gltf):
        walk(root, _IDENTITY)
    return out
