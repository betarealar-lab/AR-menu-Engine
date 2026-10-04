# fix-dish.py — clean up a food scan sitting on a modelled plate, before optimize-model.mjs.
#
#   blender -b --factory-startup -noaudio -P tools/model/fix-dish.py -- in.glb out.glb [--no-grade] [--no-smooth] [--gloss]
#
# The dishes we ship are a photogrammetry food scan (one textured material, usually
# "3DModel") dropped onto a clean modelled plate/tray/board (every other material).
# The scan still carries the ORIGINAL plate's sauce puddles and base, which don't match
# the new plate, so three things go wrong:
#
#   1. Overflow   — sauce/food hangs past the plate edge or smears over the rim.
#   2. Clipping   — the scan's underside sinks into the plate floor and walls, and the
#                   parts that are coplanar with it z-fight (flicker) in Quick Look.
#   3. Grim food  — lightbox scans are grey, grainy, lumpy and dim. Fixed by a light
#                   surface smooth, texture denoise, white balance to clean cream, lifted
#                   exposure and vibrance. Never darken (AO/clarity made it worse) and
#                   never warm by adding red (sauce goes pink).
#
# This script fixes all three on the food material only; the plate is never touched.

import sys, os, math
import bpy, bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
flags = {a for a in argv if a.startswith("--")}
paths = [a for a in argv if not a.startswith("--")]
if len(paths) < 2:
    print("usage: ... -- <in.glb> <out.glb> [--no-grade] [--no-smooth] [--gloss]")
    sys.exit(2)
src, dst = os.path.abspath(paths[0]), os.path.abspath(paths[1])

GAP = 0.0005        # 0.5 mm: food sits this far clear of the plate — no z-fighting
RIM_SMEAR = 0.004   # food within 4 mm of a rim/wall surface is sauce smeared on it
MIN_PIECE = 0.004   # loose food pieces under 0.4% of food area are scan debris

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, import_pack_images=True)

objs = [o for o in bpy.data.objects if o.type == "MESH"]
if not objs:
    print("ERROR: no mesh"); sys.exit(1)
for o in bpy.data.objects:
    o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(objs) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = obj.data

# Food = the textured material with the most faces. Everything else is plate.
counts = {}
for p in me.polygons:
    counts[p.material_index] = counts.get(p.material_index, 0) + 1
def textured(i):
    m = me.materials[i]
    return m and m.use_nodes and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes)
cands = [i for i in counts if textured(i)] or list(counts)
FOOD = max(cands, key=lambda i: counts[i])
if len(counts) < 2:
    print("ERROR: only one material — can't tell food from plate"); sys.exit(1)
print(f"FOOD material={me.materials[FOOD].name} faces={counts[FOOD]}  plate materials={len(counts)-1}")

bm = bmesh.new(); bm.from_mesh(me)
bm.faces.ensure_lookup_table()

# ---- plate BVH -------------------------------------------------------------------------
plate = bmesh.new(); vmap = {}
for f in bm.faces:
    if f.material_index == FOOD:
        continue
    vs = []
    for v in f.verts:
        if v not in vmap:
            vmap[v] = plate.verts.new(v.co)
        vs.append(vmap[v])
    try: plate.faces.new(vs)
    except ValueError: pass
plate.normal_update()
bvh = BVHTree.FromBMesh(plate)
ztop = max(v.co.z for v in plate.verts) + 1.0

# Floor = the height carrying the most up-facing plate area; rim = anything well above it.
hist = {}
for f in plate.faces:
    if f.normal.z > 0.85:
        k = round(f.calc_center_median().z, 3)
        hist[k] = hist.get(k, 0) + f.calc_area()
floor_z = max(hist, key=hist.get)
plate_top = max(v.co.z for v in plate.verts)
has_rim = plate_top - floor_z > 0.005
rim_z = floor_z + 0.35 * (plate_top - floor_z)
print(f"PLATE floor={floor_z:.4f} top={plate_top:.4f} rim={'yes' if has_rim else 'no (flat board)'}")

def down_hit(co):
    return bvh.ray_cast(Vector((co.x, co.y, ztop)), Vector((0, 0, -1)))

# ---- 1. weld the food so pieces are real pieces (glTF splits every UV seam) ------------
food_verts = list({v for f in bm.faces if f.material_index == FOOD for v in f.verts})
bmesh.ops.remove_doubles(bm, verts=food_verts, dist=0.0001)
bm.faces.ensure_lookup_table()

# ---- 2. overflow: cut food that hangs off the plate or smears over the rim --------------
kill = set()
off_edge = rim_smear = under = 0
for v in {v for f in bm.faces if f.material_index == FOOD for v in f.verts}:
    loc, n, i, d = down_hit(v.co)
    if loc is None:
        kill.add(v); off_edge += 1
    elif loc.z - v.co.z > 0.003:
        # plate surface more than 3 mm ABOVE the food: buried in the plate body or hanging
        # underneath it — shows as dark specks on the outside/bottom of the tray.
        kill.add(v); under += 1
    elif has_rim and loc.z > rim_z and v.co.z - loc.z < RIM_SMEAR:
        kill.add(v); rim_smear += 1
dead = [f for f in bm.faces if f.material_index == FOOD and any(v in kill for v in f.verts)]
bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
print(f"OVERFLOW off_edge_verts={off_edge} under_plate_verts={under} rim_smear_verts={rim_smear} faces_cut={len(dead)}")

# ---- 3. debris: loose food crumbs left floating ----------------------------------------
bm.faces.ensure_lookup_table()
food_faces = [f for f in bm.faces if f.material_index == FOOD]
total = sum(f.calc_area() for f in food_faces) or 1
seen = set(); debris = []
for f in food_faces:
    if f in seen: continue
    piece = []; st = [f]; seen.add(f)
    while st:
        x = st.pop(); piece.append(x)
        for e in x.edges:
            for y in e.link_faces:
                if y.material_index == FOOD and y not in seen:
                    seen.add(y); st.append(y)
    if sum(p.calc_area() for p in piece) / total < MIN_PIECE:
        debris.extend(piece)
bmesh.ops.delete(bm, geom=debris, context='FACES_ONLY')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
print(f"DEBRIS faces_removed={len(debris)}")

# ---- 4. clipping: lift every food vertex clear of the plate ----------------------------
# Only push food toward surfaces a diner can see it against: the floor (faces up) and inner
# walls (face the plate centre). Food nearest the OUTER wall or underside is buried in the
# plate body; pushing it along that normal pops it out through the outside of the tray as
# dark specks (yirgizeti2). Deep penetration is hidden anyway — delete it instead.
BURIED = 0.003
pc = Vector(((min(v.co.x for v in plate.verts) + max(v.co.x for v in plate.verts)) / 2,
             (min(v.co.y for v in plate.verts) + max(v.co.y for v in plate.verts)) / 2, 0))
pushed = 0; buried = set()
for v in {v for f in bm.faces if f.material_index == FOOD for v in f.verts}:
    loc, n, i, d = bvh.find_nearest(v.co)
    if loc is None:
        continue
    off = (v.co - loc).dot(n)
    if off >= GAP:
        continue
    to_c = Vector((pc.x - loc.x, pc.y - loc.y, 0))
    inward = n.z > 0.5 or (Vector((n.x, n.y, 0)).dot(to_c) > 0 and n.z > -0.3)
    if not inward or off < -BURIED:
        buried.add(v); continue
    v.co = loc + n * GAP
    pushed += 1
dead = [f for f in bm.faces if f.material_index == FOOD and any(v in buried for v in f.verts)]
bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
print(f"CLIPPING verts_lifted={pushed} buried_verts_removed={len(buried)} faces={len(dead)}")

# ---- 5. clean surface: scans are lumpy with capture noise. A light Laplacian pass on
# interior food vertices smooths it; boundaries and plate stay exactly where they are.
if "--no-smooth" not in flags:
    fv = [v for v in {v for f in bm.faces if f.material_index == FOOD for v in f.verts}
          if not v.is_boundary and all(f.material_index == FOOD for f in v.link_faces)]
    for _ in range(2):
        bmesh.ops.smooth_laplacian_vert(bm, verts=fv, lambda_factor=0.4, lambda_border=0.0,
                                        use_x=True, use_y=True, use_z=True, preserve_volume=True)
    print(f"SMOOTH verts={len(fv)}")

bm.to_mesh(me); bm.free(); plate.free()
me.update()

# ---- optional gloss --------------------------------
fmat = me.materials[FOOD]
bsdf = next(n for n in fmat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
if "--gloss" in flags:
    # OFF by default: tested on yirgizeti3, any sheen reflects the grey sky over the whole
    # dish and reads paler and pinker, not juicier. Scans are matte on purpose (spec 0).
    # glb-to-usdz.py maps spec 0.15 -> ior ~1.25 if you do turn it on.
    bsdf.inputs["Roughness"].default_value = float(os.environ.get("FD_ROUGH", 0.42))
    bsdf.inputs["Specular IOR Level"].default_value = float(os.environ.get("FD_SPEC", 0.15))
    print(f"GLOSS roughness -> {bsdf.inputs['Roughness'].default_value:.2f}, specular -> {bsdf.inputs['Specular IOR Level'].default_value:.2f}")

def read_px(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)

def write_px(img, a):
    img.pixels.foreach_set(np.ascontiguousarray(a, dtype=np.float32).ravel())
    img.update(); img.pack()

def box(a, r):
    """Box blur of an HxWxC array, radius r px, via summed-area table (no scipy in Blender)."""
    if r < 1: return a
    p = np.pad(a, ((r + 1, r), (r + 1, r), (0, 0)), mode="edge")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)

def blur(a, r):          # three box passes ~ gaussian
    for _ in range(3): a = box(a, max(1, r // 2))
    return a

def mat_image(m):
    """The BASE COLOUR image — walk upstream from the BSDF, because full PBR models also
    carry roughness/normal images and grading those would wreck the surface."""
    if not m or not m.use_nodes: return None
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    stack = [b.inputs["Base Color"]] if b else []
    while stack:
        sock = stack.pop()
        for lk in sock.links:
            n = lk.from_node
            if n.type == 'TEX_IMAGE' and n.image: return n.image
            stack.extend(i for i in n.inputs if i.is_linked)
    n = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    return n.image if n else None

# ---- 6. clean, bright, fresh food texture -------------------------------------------
# Lightbox scans come out grey, grainy and a little dim — "grim". Tested on yirgizeti3:
# darkening moves (AO bakes, clarity, deeper mids) made it worse. What reads as clean and
# appetising is the opposite: less grain, neutral whites, lifted mids, fresher colour.
img = mat_image(fmat)
if img and "--no-grade" not in flags:
    a = read_px(img); rgb = a[:, :, :3]
    w, h = img.size
    # 1. Denoise without softening edges: blend toward a blur only where the pixel is
    #    already close to its neighbourhood (mottle, grain), not across drizzle/edges.
    r = max(1, w // 1365)
    b = blur(rgb, r)
    diff = np.abs(rgb - b).mean(2, keepdims=True)
    wt = 0.8 * np.exp(-(diff / 0.035) ** 2)
    rgb = rgb * (1 - wt) + b * wt
    # 2. White balance on the brightest food pixels (sauce, rice): make them clean cream,
    #    not grey-yellow. Target a faint warm white.
    lum = rgb.mean(2)
    hi = lum > np.percentile(lum, 92)
    ref = rgb[hi].mean(0)
    # Only 30% of the way to a warm cream — scans read very yellow (blue ~0.53 of red), and a
    # full correction to neutral made rice and sauce cold and grey (tested, yirgizeti2/3).
    cream = np.array([1.0, 0.95, 0.84], dtype=np.float32) * ref.max()
    target = ref + 0.3 * (cream - ref)
    rgb = rgb * (target / np.maximum(ref, 1e-3))
    # 3. Exposure + lifted mids: put those whites near 0.90 (no blow-out), open up the shadows.
    rgb = rgb * (0.90 / max(float(target.max()), 1e-3))
    rgb = np.clip(rgb, 0, 1) ** 0.88
    # 4. Fresh colour: vibrance (dull pixels most) — reds, greens, salmon pop.
    luma = (rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[:, :, None]
    sat = 1.0 - np.clip(rgb.max(2, keepdims=True) - rgb.min(2, keepdims=True), 0, 1)
    rgb = luma + (rgb - luma) * (1.18 + 0.22 * sat)
    # 5. Light S-curve for snap without crushing (mids stay put).
    rgb = np.clip(rgb, 0, 1)
    rgb = rgb + 0.12 * (rgb - 0.5) * (1 - np.abs(2 * rgb - 1))
    a[:, :, :3] = np.clip(rgb, 0, 1)
    write_px(img, a)
    print(f"GRADE {img.name} {w}x{h} white_ref={np.round(ref,3).tolist()}")

bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=95,
    export_materials='EXPORT', export_normals=True, export_texcoords=True,
    export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_yup=True,
)
if not os.path.exists(dst):
    print("ERROR: no output"); sys.exit(1)
print(f"FIX_OK {dst} {os.path.getsize(dst)}")
