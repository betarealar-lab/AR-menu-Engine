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


def resize_textures(src: Path, dst: Path, max_edge: int = 2048,
                    quality: int = 90, max_bytes: int = MAX_TEXTURE_BYTES) -> dict:
    """Shrink every embedded texture to `max_edge` AND `max_bytes`, then repack.

    Every bufferView is rewritten in order, because changing one image's length shifts
    every offset after it. Rebuilding the whole buffer is simpler than patching offsets
    and impossible to get subtly wrong.
    """
    gltf, binary = _read(src)
    views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])

    replacement: dict[int, bytes] = {}
    before = after = 0
    resized = skipped = 0

    for img in images:
        vi = img.get("bufferView")
        if vi is None:                       # external URI texture - nothing to do here
            skipped += 1
            continue
        bv = views[vi]
        start = bv.get("byteOffset", 0)
        data = binary[start:start + bv["byteLength"]]
        before += len(data)
        try:
            with Image.open(io.BytesIO(data)) as im:
                too_wide = max(im.size) > max_edge
                too_heavy = len(data) > max_bytes
                if not too_wide and not too_heavy:
                    after += len(data)
                    skipped += 1
                    continue
                # Alpha is load-bearing where it exists - a cut-out leaf, a glass. JPEG
                # has none, so a texture that uses it is only ever resized, never
                # re-encoded, even if that leaves it large.
                has_alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
                if too_wide:
                    im.thumbnail((max_edge, max_edge), Image.LANCZOS)
                if has_alpha:
                    if not too_wide:
                        after += len(data)
                        skipped += 1
                        continue
                    buf = io.BytesIO()
                    im.convert("RGBA").save(buf, "PNG", optimize=True)
                    new, mime = buf.getvalue(), "image/png"
                else:
                    buf = io.BytesIO()
                    im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
                    new, mime = buf.getvalue(), "image/jpeg"
                # Re-encoding is only ever an improvement if it actually shrinks.
                if len(new) >= len(data) and not too_wide:
                    after += len(data)
                    skipped += 1
                    continue
        except Exception:                    # unreadable - keep the original untouched
            after += len(data)
            skipped += 1
            continue
        replacement[vi] = new
        img["mimeType"] = mime
        after += len(new)
        resized += 1

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


def image_bytes(gltf: dict, binary, index: int) -> tuple[bytes, str]:
    """An embedded image and its file extension."""
    img = gltf["images"][index]
    bv = gltf["bufferViews"][img["bufferView"]]
    off = bv.get("byteOffset", 0)
    data = bytes(binary[off: off + bv["byteLength"]])
    ext = {"image/png": ".png", "image/jpeg": ".jpg"}.get(img.get("mimeType", ""), ".bin")
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
