# glb-to-usdz.py — Blender headless GLB -> USDZ for iOS Quick Look.
#
# Driven by tools/model/optimize-model.mjs; runnable on its own:
#
#   blender -b --factory-startup -noaudio -P tools/model/glb-to-usdz.py -- in.glb out.usdz [maxTexPx]
#
# Why Blender: Apple's usdzconvert is macOS-only and the `usd-core` wheel ships no
# glTF file-format plugin, so on Windows Blender's USD exporter is the only local
# path from GLB to a Quick Look-valid USDZ.
#
# Quick Look is picky about three things, all handled below:
#   - Y-up, -Z forward (glTF's convention; Blender works Z-up internally)
#   - UsdPreviewSurface shaders, not MaterialX
#   - textures embedded in the .usdz as PNG/JPEG (never WebP/AVIF/KTX2)

import sys, os
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    print("usage: ... -- <in.glb> <out.usdz> [maxTexPx]")
    sys.exit(2)

src, dst = os.path.abspath(argv[0]), os.path.abspath(argv[1])
max_tex = int(argv[2]) if len(argv) > 2 else 0

# --factory-startup still opens the default cube/camera/light scene.
bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.import_scene.gltf(filepath=src, import_pack_images=True)

mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
if not mesh_objs:
    print("ERROR: no mesh imported from", src)
    sys.exit(1)


def bake_specular_into_ior():
    """Carry glTF's specular level across to USD, which has no input for it.

    Our scans ship KHR_materials_specular with specularFactor 0 — deliberately matte,
    set in Blender when the model was cleaned. UsdPreviewSurface has no specular-level
    input, so the exporter drops it and every reader falls back to its own default
    (Blender: 0.5). That lays a broad white dielectric sheen over the whole dish and
    the USDZ comes out lighter, pinker and flatter than the GLB.

    IOR *is* part of UsdPreviewSurface, and it controls the same thing physically:
    dielectric F0 = 0.08 * specular_level, and ior = (1 + sqrt(F0)) / (1 - sqrt(F0)).
    specular 0 -> ior 1.0 (no reflection at all); specular 0.5 -> ior 1.5, the default,
    so well-behaved materials are left exactly where they were.
    """
    import math
    touched = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            lvl_in = node.inputs.get("Specular IOR Level") or node.inputs.get("Specular")
            ior_in = node.inputs.get("IOR")
            if lvl_in is None or ior_in is None or lvl_in.is_linked:
                continue
            lvl = float(lvl_in.default_value)
            f0 = max(0.0, min(0.99, 0.08 * lvl))
            r = math.sqrt(f0)
            ior = 1.0 if r <= 0.0 else (1.0 + r) / (1.0 - r)
            if abs(ior - float(ior_in.default_value)) > 1e-4:
                touched.append(f"{mat.name}: spec {lvl:.3f} -> ior {ior:.4f}")
                ior_in.default_value = ior
    if touched:
        print("SPECULAR_FIX " + "; ".join(touched))


def bake_factors_into_textures():
    """glTF multiplies metallic/roughness textures by a factor. Blender's importer builds
    that as texture -> Math(MULTIPLY, factor) -> BSDF, and the USD exporter can't express
    the Math node: it wires the raw texture channel straight in and drops the factor.

    oragulis-steiki: metallicFactor 0 over a texture whose blue channel was ~0.7, so the
    GLB was matte and the USDZ came out 70% METAL — shiny, grey, faceted in Quick Look.
    A factor of 0 means the input is simply that constant; any other factor we keep the
    texture (the exporter's behaviour) and report it.
    """
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        for node in nt.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            for name in ("Metallic", "Roughness"):
                inp = node.inputs.get(name)
                if inp is None or not inp.is_linked:
                    continue
                src = inp.links[0].from_node
                if src.type != 'MATH' or src.operation != 'MULTIPLY':
                    continue
                consts = [i.default_value for i in src.inputs[:2] if not i.is_linked]
                if not consts:
                    continue
                f = float(consts[0])
                if abs(f) < 1e-6:
                    nt.links.remove(inp.links[0])
                    inp.default_value = 0.0
                    print(f"FACTOR_FIX {mat.name}: {name} factor 0 -> constant 0 (texture dropped)")
                elif abs(f - 1.0) > 1e-3:
                    print(f"FACTOR_WARN {mat.name}: {name} factor {f:.3f} is lost in USD export")


bake_factors_into_textures()
bake_specular_into_ior()

tris = sum(len(o.data.loop_triangles) or len(o.data.polygons) for o in mesh_objs)
print(f"USDZ_IN objects={len(mesh_objs)} polys={tris}")

kwargs = dict(
    filepath=dst,
    export_materials=True,
    generate_preview_surface=True,     # UsdPreviewSurface — what Quick Look reads
    generate_materialx_network=False,  # MaterialX is dead weight in a USDZ
    export_textures_mode="NEW",        # re-write images into the archive
    overwrite_textures=True,
    relative_paths=True,
    export_uvmaps=True,
    export_normals=True,
    triangulate_meshes=True,
    export_animation=False,
    export_armatures=False,
    export_shapekeys=False,
    export_hair=False,
    export_lights=False,               # a baked food scan needs neither
    export_cameras=False,
    export_curves=False,
    export_points=False,
    export_volumes=False,
    convert_world_material=False,
    use_instancing=False,
    convert_orientation=True,          # back to glTF/Quick Look axes
    export_global_forward_selection="NEGATIVE_Z",
    export_global_up_selection="Y",
    convert_scene_units="METERS",      # 1 Blender unit == 1 m == 1 glTF unit
    root_prim_path="/root",
    evaluation_mode="RENDER",
)
if max_tex:
    kwargs["usdz_downscale_size"] = "CUSTOM"
    kwargs["usdz_downscale_custom_size"] = max_tex

bpy.ops.wm.usd_export(**kwargs)

if not os.path.exists(dst):
    print("ERROR: exporter wrote no file at", dst)
    sys.exit(1)
print(f"USDZ_OK {dst} {os.path.getsize(dst)}")
