"""GLB -> USDZ, so iPhones get the file everyone else gets.

Quick Look is the AR path on iOS and it only reads USDZ. Until 2026-08-29 the pipeline
had no converter, so it carried **Meshy's own USDZ into the catalogue unchanged** - and
that file is the master. Measured on the first real dish:

    model_draco.glb   3.00 MB      39,968 triangles   2048px textures   22 cm
    model.usdz       74.50 MB   1,902,278 triangles   4k textures       190 cm

Every gain from decimation, texture resizing and real-world scale applied to Android and
web, and to nothing on iOS. A diner with an iPhone downloaded 74.5 MB over restaurant
wifi and got a dish the size of a table. The hand-built MondayGreens models ship USDZ at
4.9-7.9 MB, which is the standard this has to meet.

The old comment justifying it said USDZ "needs Apple's tooling or a converter that is not
reliably present on Linux". True as far as it goes - `usdzconvert` is macOS-only and
Google's `usd_from_gltf` has to be compiled - but `usd-core` is a pip wheel on every
platform, and the file being converted is our own optimised output: one mesh, 40k
triangles, three 2048px maps. Small and known, so the stage is built by hand rather than
by hoping a general-purpose converter is installed.

What this deliberately does NOT do: convert the master. The input is always the placed,
decimated GLB, so the USDZ is the same object as the GLB at the same real-world size.
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import glb

try:
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils, Vt
    AVAILABLE = True
except ImportError:                                   # pragma: no cover
    AVAILABLE = False


def describe() -> str:
    return "usd-core" if AVAILABLE else "none (no USDZ; iOS AR unavailable)"


def _xform_point(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def _xform_normal(m, n):
    """Rotation only - no translation, and no inverse-transpose.

    Placement is a uniform scale plus a translation, and a uniform scale leaves normal
    directions unchanged once renormalised. If a non-uniform scale is ever introduced
    this becomes wrong and needs the proper inverse-transpose.
    """
    x, y, z = n
    v = (m[0] * x + m[4] * y + m[8] * z,
         m[1] * x + m[5] * y + m[9] * z,
         m[2] * x + m[6] * y + m[10] * z)
    length = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5
    return v if length == 0 else (v[0] / length, v[1] / length, v[2] / length)


def _texture_shader(stage, material, path: str, name: str, filename: str,
                    st_reader, channel: str):
    """One UsdUVTexture feeding one input of the surface shader."""
    tex = UsdShade.Shader.Define(stage, f"{path}/{name}")
    tex.CreateIdAttr("UsdUVTexture")
    tex.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(f"./{filename}")
    tex.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(
        st_reader.ConnectableAPI(), "result")
    # glTF wrap defaults are REPEAT; Meshy never sets anything else.
    tex.CreateInput("wrapS", Sdf.ValueTypeNames.Token).Set("repeat")
    tex.CreateInput("wrapT", Sdf.ValueTypeNames.Token).Set("repeat")
    return tex.CreateOutput(channel, Sdf.ValueTypeNames.Float3 if channel == "rgb"
                            else Sdf.ValueTypeNames.Float)


def from_glb(src: Path, dst: Path) -> dict:
    """Convert one optimised GLB into a USDZ. Returns what it produced.

    Raises rather than returning half a file - the caller records the error and keeps the
    GLB catalogue, which is still complete for web and Android.
    """
    if not AVAILABLE:
        raise RuntimeError("usd-core is not installed; cannot write USDZ")

    gltf, binary = glb._read(src)
    instances = glb.world_transforms(gltf)
    if not instances:
        raise ValueError(f"{src.name}: no meshes in the default scene")

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # `.usdc` - binary crate, not the ASCII `.usda`. USD picks the format from the
        # extension, and the text form stored 40k triangles as 4 MB of printed numbers
        # inside the package. Same geometry, and ARKit wants the binary form anyway.
        usda = work / "model.usdc"
        stage = Usd.Stage.CreateNew(str(usda))
        # Metres and Y-up: glTF's convention, and what Quick Look expects. Getting
        # metersPerUnit wrong is the classic way to place a correct model at the wrong
        # size, which is the exact bug this file exists to stop repeating.
        UsdGeom.SetStageMetersPerUnit(stage, 1.0)
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)

        root = UsdGeom.Xform.Define(stage, "/Dish")
        stage.SetDefaultPrim(root.GetPrim())

        written: dict[int, str] = {}          # glTF image index -> filename in the package

        def texture_file(image_index: int) -> str:
            if image_index not in written:
                data, ext = glb.image_bytes(gltf, binary, image_index)
                name = f"texture_{image_index}{ext}"
                (work / name).write_bytes(data)
                written[image_index] = name
            return written[image_index]

        def image_of(texture_index: int) -> int | None:
            try:
                return gltf["textures"][texture_index]["source"]
            except (KeyError, IndexError, TypeError):
                return None

        triangles = 0
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3

        for n, (mesh_index, matrix) in enumerate(instances):
            for k, prim in enumerate(gltf["meshes"][mesh_index].get("primitives", [])):
                if prim.get("mode", 4) != 4:               # triangles only
                    continue
                attrs = prim.get("attributes", {})
                if "POSITION" not in attrs:
                    continue

                points = [_xform_point(matrix, p)
                          for p in glb.read_accessor(gltf, binary, attrs["POSITION"])]
                if "indices" in prim:
                    indices = list(glb.read_accessor(gltf, binary, prim["indices"]))
                else:
                    indices = list(range(len(points)))
                triangles += len(indices) // 3
                for p in points:
                    for a in range(3):
                        lo[a] = min(lo[a], p[a])
                        hi[a] = max(hi[a], p[a])

                path = f"/Dish/mesh_{n}_{k}"
                mesh = UsdGeom.Mesh.Define(stage, path)
                mesh.CreatePointsAttr(Vt.Vec3fArray([Gf.Vec3f(*p) for p in points]))
                mesh.CreateFaceVertexIndicesAttr(Vt.IntArray(indices))
                mesh.CreateFaceVertexCountsAttr(Vt.IntArray([3] * (len(indices) // 3)))
                # Without this USD subdivides, which turns a decimated 40k mesh into
                # something far heavier on the phone than the file size suggests.
                mesh.CreateSubdivisionSchemeAttr().Set(UsdGeom.Tokens.none)
                mesh.CreateDoubleSidedAttr().Set(
                    bool(gltf.get("materials", [{}])[prim.get("material", 0)]
                         .get("doubleSided", False)) if gltf.get("materials") else False)

                if "NORMAL" in attrs:
                    normals = [_xform_normal(matrix, v)
                               for v in glb.read_accessor(gltf, binary, attrs["NORMAL"])]
                    mesh.CreateNormalsAttr(Vt.Vec3fArray([Gf.Vec3f(*v) for v in normals]))
                    mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)

                if "TEXCOORD_0" in attrs:
                    uvs = glb.read_accessor(gltf, binary, attrs["TEXCOORD_0"])
                    # glTF puts UV origin top-left, USD bottom-left. Skipping this flip
                    # is how a correct model ends up with its texture upside down.
                    st = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar(
                        "st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
                    st.Set(Vt.Vec2fArray([Gf.Vec2f(u, 1.0 - v) for u, v in uvs]))

                mat_index = prim.get("material")
                if mat_index is None or not gltf.get("materials"):
                    continue
                gmat = gltf["materials"][mat_index]
                pbr = gmat.get("pbrMetallicRoughness", {})

                mat_path = f"{path}_mat"
                material = UsdShade.Material.Define(stage, mat_path)
                surface = UsdShade.Shader.Define(stage, f"{mat_path}/surface")
                surface.CreateIdAttr("UsdPreviewSurface")
                material.CreateSurfaceOutput().ConnectToSource(
                    surface.ConnectableAPI(), "surface")

                reader = UsdShade.Shader.Define(stage, f"{mat_path}/st_reader")
                reader.CreateIdAttr("UsdPrimvarReader_float2")
                reader.CreateInput("varname", Sdf.ValueTypeNames.Token).Set("st")

                base = pbr.get("baseColorTexture", {}).get("index")
                img = image_of(base) if base is not None else None
                if img is not None:
                    surface.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f) \
                        .ConnectToSource(_texture_shader(
                            stage, material, mat_path, "base", texture_file(img),
                            reader, "rgb"))
                else:
                    rgba = pbr.get("baseColorFactor", [0.8, 0.8, 0.8, 1.0])
                    surface.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f) \
                        .Set(Gf.Vec3f(*rgba[:3]))

                # glTF packs roughness in G and metallic in B of one map. USD wants them
                # as separate scalar inputs, so the same file is read twice by channel.
                mr = pbr.get("metallicRoughnessTexture", {}).get("index")
                img = image_of(mr) if mr is not None else None
                if img is not None:
                    name = texture_file(img)
                    surface.CreateInput("roughness", Sdf.ValueTypeNames.Float) \
                        .ConnectToSource(_texture_shader(
                            stage, material, mat_path, "rough", name, reader, "g"))
                    surface.CreateInput("metallic", Sdf.ValueTypeNames.Float) \
                        .ConnectToSource(_texture_shader(
                            stage, material, mat_path, "metal", name, reader, "b"))
                else:
                    surface.CreateInput("roughness", Sdf.ValueTypeNames.Float) \
                        .Set(float(pbr.get("roughnessFactor", 0.9)))
                    surface.CreateInput("metallic", Sdf.ValueTypeNames.Float) \
                        .Set(float(pbr.get("metallicFactor", 0.0)))

                nrm = gmat.get("normalTexture", {}).get("index")
                img = image_of(nrm) if nrm is not None else None
                if img is not None:
                    tex = UsdShade.Shader.Define(stage, f"{mat_path}/normal")
                    tex.CreateIdAttr("UsdUVTexture")
                    tex.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(
                        f"./{texture_file(img)}")
                    tex.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(
                        reader.ConnectableAPI(), "result")
                    # Normal maps are stored 0..1 and read -1..1.
                    tex.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(
                        Gf.Vec4f(2.0, 2.0, 2.0, 1.0))
                    tex.CreateInput("bias", Sdf.ValueTypeNames.Float4).Set(
                        Gf.Vec4f(-1.0, -1.0, -1.0, 0.0))
                    surface.CreateInput("normal", Sdf.ValueTypeNames.Normal3f) \
                        .ConnectToSource(tex.CreateOutput(
                            "rgb", Sdf.ValueTypeNames.Float3))

                UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)

        if triangles == 0:
            raise ValueError(f"{src.name}: no triangle geometry to convert")

        root.GetPrim().GetAttribute("extent")   # touch, harmless if absent
        stage.GetRootLayer().Save()

        dst.parent.mkdir(parents=True, exist_ok=True)
        staged = work / "out.usdz"
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(usda)), str(staged)):
            raise RuntimeError("USD refused to write the package")
        shutil.move(str(staged), str(dst))

    size = [hi[i] - lo[i] for i in range(3)]
    return {
        "usdz_bytes": dst.stat().st_size,
        "usdz_triangles": triangles,
        "usdz_textures": len(written),
        "usdz_size_m": size,
    }
