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


def _read(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    magic, _version, length = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path.name} is not a GLB")
    gltf, binary, off = None, b"", 12
    while off < length:
        clen, ctype = struct.unpack_from("<II", raw, off)
        data = raw[off + 8: off + 8 + clen]
        if ctype == JSON_CHUNK:
            gltf = json.loads(data.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            binary = data
        off += 8 + clen
    if gltf is None:
        raise ValueError(f"{path.name} has no JSON chunk")
    return gltf, binary


def _write(path: Path, gltf: dict, binary: bytes) -> None:
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * _pad(len(js))
    binary += b"\x00" * _pad(len(binary))
    total = 12 + 8 + len(js) + (8 + len(binary) if binary else 0)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), JSON_CHUNK)); fh.write(js)
        if binary:
            fh.write(struct.pack("<II", len(binary), BIN_CHUNK)); fh.write(binary)


def resize_textures(src: Path, dst: Path, max_edge: int = 2048,
                    quality: int = 90) -> dict:
    """Shrink every embedded texture to `max_edge` and repack the buffer.

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
                if max(im.size) <= max_edge:
                    after += len(data)
                    skipped += 1
                    continue
                im = im.convert("RGB")
                im.thumbnail((max_edge, max_edge), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=quality, optimize=True)
                new = buf.getvalue()
        except Exception:                    # unreadable - keep the original untouched
            after += len(data)
            skipped += 1
            continue
        replacement[vi] = new
        img["mimeType"] = "image/jpeg"
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
    }


def count_triangles(path: Path) -> int:
    """Triangles in the whole file, counted from the accessors.

    Needed to turn a triangle target into the ratio glTF-Transform actually wants, and to
    report what a decimation really produced rather than what was asked for.
    """
    gltf, _ = _read(path)
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
