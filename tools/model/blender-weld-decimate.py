# blender-weld-decimate.py — rescue pass for scans meshoptimizer cannot simplify.
#
#   blender -b --factory-startup -noaudio -P tools/model/blender-weld-decimate.py -- in.glb out.glb <targetTris>
#
# Why this exists: glTF-Transform v4's weld() merges only bitwise-identical vertices.
# A photogrammetry scan has none — every triangle carries its own copies, so there are
# no shared edges for meshoptimizer to collapse and simplify() plateaus far above the
# target no matter how large an error you allow (buratasalad.glb: 638,451 verts for
# 292,261 tris, stuck at 231,436 whether error was 0.02 or 1.0).
#
# Blender's "merge by distance" welds on proximity rather than equality, which restores
# the shared topology, and Decimate/COLLAPSE then reaches the target exactly. Slower than
# meshopt and slightly worse at holding UV seams, so optimize-model.mjs only calls this
# when the fast path has visibly failed.

import sys, os
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 3:
    print("usage: ... -- <in.glb> <out.glb> <targetTris>")
    sys.exit(2)

src, dst, target = os.path.abspath(argv[0]), os.path.abspath(argv[1]), int(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, import_pack_images=True)

objs = [o for o in bpy.data.objects if o.type == "MESH"]
if not objs:
    print("ERROR: no mesh imported from", src)
    sys.exit(1)


def tris():
    n = 0
    for o in objs:
        o.data.calc_loop_triangles()
        n += len(o.data.loop_triangles)
    return n


before = tris()
before_verts = sum(len(o.data.vertices) for o in objs)

# 0.1 mm: tight enough to preserve real detail on a dish, loose enough to close the
# float noise that keeps duplicated scan vertices from matching exactly.
for o in objs:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.object.mode_set(mode='OBJECT')
    o.select_set(False)

merged = tris()
merged_verts = sum(len(o.data.vertices) for o in objs)

cur = tris()
if target and cur > target:
    ratio = target / cur
    for o in objs:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("dec", 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.use_collapse_triangulate = True
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_image_format='AUTO',      # keep the source texture encoding; we retexture later
    export_materials='EXPORT',
    export_normals=True,
    export_texcoords=True,
    export_animations=False,
    export_skins=False,
    export_morph=False,
    export_cameras=False,
    export_lights=False,
    export_yup=True,
)

if not os.path.exists(dst):
    print("ERROR: exporter wrote no file at", dst)
    sys.exit(1)

print(f"WELD_OK verts {before_verts} -> {merged_verts}   tris {before} -> {merged} -> {tris()}")
