# replate-dish.py — AI-generated dish (food and plate fused into ONE mesh) -> food on a clean
# modelled plate, with realistic per-food surface finish. Run fix-dish.py on the result, then
# optimize-model.mjs.
#
#   blender -b --factory-startup -noaudio -P tools/model/replate-dish.py -- in.glb out.glb [--plate-lum 0.30]
#
# Why: generators (Meshy/Hunyuan/Tripo) bake the plate into the same mesh and texture as the
# food. The plate comes out lumpy and wavy with blotchy highlights, and the whole model ships
# with a near-mirror roughness map (oragulis-steiki: mean roughness 0.06, some metallic) —
# it reads as wet plastic, not a dish.
#
# Steps:
#   1. Split plate from food by base-colour luminance (plates here are dark; pass --plate-lum
#      to change the cut). Dark fringe faces touching the plate go with it.
#   2. Delete the plate. Fit a square/round footprint to it (min-area rectangle) and model a
#      clean stoneware plate in its place: flat well, softly raised rim, 6 mm body, speckled
#      matte glaze.
#   3. Settle the food: the sauce sheet followed the old wavy plate, so anything within 4 mm
#      of the new floor is compressed onto it.
#   4. Finish: metallic 0 everywhere; roughness from what each texel IS — rice matte, salmon /
#      meat semi-matte, sauce with a soft sheen. Normal map toned down.
# Scale is kept as-is (generators don't know real size — say so).

import sys, os, math
import bpy, bmesh
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
paths = [a for a in argv if not a.startswith("--")]
opt = {argv[i]: argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}
src, dst = os.path.abspath(paths[0]), os.path.abspath(paths[1])
PLATE_LUM = float(opt.get("--plate-lum", 0.30))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, import_pack_images=True)
objs = [o for o in bpy.data.objects if o.type == "MESH"]
for o in bpy.data.objects: o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(objs) > 1: bpy.ops.object.join()
food = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = food.data
mat = me.materials[0]
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
base_img = bsdf.inputs["Base Color"].links[0].from_node.image

def read_px(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)

bc = read_px(base_img); H, W = bc.shape[:2]

# ---- 1. split ---------------------------------------------------------------------------
bm = bmesh.new(); bm.from_mesh(me)
ul = bm.loops.layers.uv.active
bm.faces.ensure_lookup_table()
def face_rgb(f):
    cs = []
    for l in f.loops:
        u, v = l[ul].uv
        cs.append(bc[min(H - 1, max(0, int(v * H))), min(W - 1, max(0, int(u * W))), :3])
    return np.mean(cs, 0)
lum = np.array([face_rgb(f).mean() for f in bm.faces])
is_plate = lum < PLATE_LUM
# Dark isn't enough: seared sides of fish/meat are dark too, and they are VERTICAL and sit
# inside the plate, while plate faces face up/down or sit out at the rim. Keep dark vertical
# faces in the inner part of the footprint as food (oragulis-steiki lost its seared side).
allc = np.array([f.calc_center_median()[:] for f in bm.faces])
mid = (allc.min(0) + allc.max(0)) / 2; half = (allc.max(0) - allc.min(0)) / 2
nz = np.array([abs(f.normal.z) for f in bm.faces])
inner = (np.abs(allc[:, 0] - mid[0]) < half[0] * 0.62) & (np.abs(allc[:, 1] - mid[1]) < half[1] * 0.62)
seared = is_plate & (nz < 0.6) & inner
is_plate &= ~seared
print(f"SEAR kept {int(seared.sum())} dark vertical faces as food")
side_cols = [face_rgb(f) for f in bm.faces if seared[f.index]] +             [face_rgb(f) for f in bm.faces if not is_plate[f.index] and abs(f.normal.z) < 0.35
             and (face_rgb(f)[0] > face_rgb(f)[1] * 1.15)]
SIDE_COL = np.median(np.array(side_cols), 0) if side_cols else np.array([0.72, 0.42, 0.3])
print(f"SIDE colour from the fish's own vertical faces: {np.round(SIDE_COL, 2).tolist()}")
# fringe: mid-dark faces touching the plate are plate/sauce blend — they read as dark jags
for _ in range(1):     # one ring only — more eats dark sear on the food itself
    grow = is_plate.copy()
    for f in bm.faces:
        if not is_plate[f.index] and lum[f.index] < 0.40 and \
           any(is_plate[g.index] for e in f.edges for g in e.link_faces):
            grow[f.index] = True
    is_plate = grow
pverts = [v.co.copy() for f in bm.faces if is_plate[f.index] for v in f.verts]
print(f"SPLIT plate_faces={int(is_plate.sum())} food_faces={int((~is_plate).sum())}")


# plate footprint: min-area rectangle over the plate's xy hull
P = np.array([(c.x, c.y) for c in pverts])
from mathutils.geometry import convex_hull_2d
hull = P[convex_hull_2d([Vector(p) for p in P])]
best = None
for i in range(len(hull)):
    e = hull[(i + 1) % len(hull)] - hull[i]
    ang = math.atan2(e[1], e[0])
    R = np.array([[math.cos(-ang), -math.sin(-ang)], [math.sin(-ang), math.cos(-ang)]])
    q = hull @ R.T
    ext = q.max(0) - q.min(0)
    if best is None or ext[0] * ext[1] < best[0]:
        ctr = (q.max(0) + q.min(0)) / 2 @ R          # back to world
        best = (ext[0] * ext[1], ang, ext, ctr)
_, ANG, EXT, CTR = best
print(f"FOOTPRINT {EXT[0]*100:.1f} x {EXT[1]*100:.1f} cm  angle {math.degrees(ANG):.1f} deg")

bmesh.ops.delete(bm, geom=[f for f in bm.faces if is_plate[f.index]], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

# weld first: generators split every UV seam, so without this every patch looks 'loose'
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
# drop floating debris (< 0.5% of food area)
bm.faces.ensure_lookup_table()
tot = sum(f.calc_area() for f in bm.faces); seen = set(); junk = []
for f in bm.faces:
    if f in seen: continue
    piece, st = [], [f]; seen.add(f)
    while st:
        x = st.pop(); piece.append(x)
        for e in x.edges:
            for g in e.link_faces:
                if g not in seen: seen.add(g); st.append(g)
    if sum(p.calc_area() for p in piece) / tot < 0.005: junk += piece
bmesh.ops.delete(bm, geom=junk, context='FACES')
print(f"DEBRIS faces={len(junk)}")



# ---- 2. new plate -----------------------------------------------------------------------
fz = np.array([v.co.z for v in bm.verts])
FLOOR = float(np.percentile(fz, 3))              # plate well top = bottom of the food
L = float(min(EXT)) * 0.98                       # square plate side
RIM = 0.16 * L                                   # rim band width
LIFT = 0.045 * L                                 # rim rise at edge (~1.4 cm on 32 cm)
THICK = 0.006
N = 72
pb = bmesh.new()
grid = [[None] * (N + 1) for _ in range(N + 1)]
for i in range(N + 1):
    for j in range(N + 1):
        x = (i / N - 0.5) * L; y = (j / N - 0.5) * L
        dx = max(0.0, abs(x) - (L / 2 - RIM)) / RIM
        dy = max(0.0, abs(y) - (L / 2 - RIM)) / RIM
        # smooth rise toward each edge; corners combine so they lift a bit more (like the source)
        z = LIFT * (dx ** 2 * (3 - 2 * dx) + dy ** 2 * (3 - 2 * dy)) * 0.8
        grid[i][j] = pb.verts.new((x, y, z))
uvl = pb.loops.layers.uv.new("UVMap")
for i in range(N):
    for j in range(N):
        f = pb.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / L + 0.5, l.vert.co.y / L + 0.5)
pme = bpy.data.meshes.new("plate"); pb.to_mesh(pme); pb.free()
plate = bpy.data.objects.new("Plate", pme); bpy.context.scene.collection.objects.link(plate)
m = plate.modifiers.new("solid", 'SOLIDIFY'); m.thickness = THICK; m.offset = -1; m.use_even_offset = True
m = plate.modifiers.new("bevel", 'BEVEL'); m.width = 0.002; m.segments = 3; m.limit_method = 'ANGLE'
bpy.context.view_layer.objects.active = plate
for mod in list(plate.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
for p in pme.polygons: p.use_smooth = True
plate.rotation_euler = (0, 0, ANG)
plate.location = (CTR[0], CTR[1], FLOOR)
bpy.context.view_layer.objects.active = plate; plate.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Glossy black HAMMERED ceramic — the restaurant's real plate (reference photo). The dimples
# are a normal map, not geometry: Worley F1 bowls, ~1.4 cm across, catch the light like the
# real glaze while the mesh stays light.
T = 1024; CELL = 24
rng = np.random.default_rng(7)
nc = T // CELL
jit = rng.uniform(0.2, 0.8, (nc, nc, 2)) * CELL
yy, xx = np.mgrid[0:T, 0:T].astype(np.float32)
cy, cx = (yy // CELL).astype(int), (xx // CELL).astype(int)
best = np.full((T, T), 1e9, np.float32)
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        ny, nx = (cy + dy) % nc, (cx + dx) % nc
        py = (cy + dy) * CELL + jit[ny, nx, 0]; px = (cx + dx) * CELL + jit[ny, nx, 1]
        best = np.minimum(best, (yy - py) ** 2 + (xx - px) ** 2)
hgt = np.sqrt(best) / CELL                          # 0 at dimple centre, ~0.7 at ridges
gy, gx = np.gradient(hgt)
k = 3.5
nrm = np.dstack([-gx * k, -gy * k, np.ones_like(hgt)])
nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
nimg = bpy.data.images.new("plate_hammered_normal", T, T)
nimg.colorspace_settings.name = 'Non-Color'
nimg.pixels.foreach_set(np.dstack([nrm * 0.5 + 0.5, np.ones_like(hgt)]).astype(np.float32).ravel()); nimg.pack()
g = np.full((T, T), 0.018, np.float32) + (0.7 - np.clip(hgt, 0, 0.7)) * 0.006   # glaze pools in dimples
img = bpy.data.images.new("plate_glaze", T, T)
img.pixels.foreach_set(np.dstack([g, g, g * 1.05, np.ones_like(g)]).clip(0, 1).astype(np.float32).ravel()); img.pack()
pm = bpy.data.materials.new("Glossy black hammered plate"); pm.use_nodes = True
pb_ = pm.node_tree.nodes["Principled BSDF"]
tex = pm.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = img
pm.node_tree.links.new(tex.outputs[0], pb_.inputs["Base Color"])
ntex = pm.node_tree.nodes.new('ShaderNodeTexImage'); ntex.image = nimg
nmap = pm.node_tree.nodes.new('ShaderNodeNormalMap'); nmap.inputs["Strength"].default_value = 1.0
pm.node_tree.links.new(ntex.outputs[0], nmap.inputs["Color"])
pm.node_tree.links.new(nmap.outputs[0], pb_.inputs["Normal"])
pb_.inputs["Roughness"].default_value = 0.12      # glossy glaze
pb_.inputs["Specular IOR Level"].default_value = 0.5
pb_.inputs["Metallic"].default_value = 0.0
pme.materials.append(pm)
print(f"PLATE side={L*100:.1f} cm rim={LIFT*100:.1f} cm floor_z={FLOOR:.4f}")

# ---- 3. settle food onto the new plate ---------------------------------------------------
settled = 0
for v in bm.verts:
    dz = v.co.z - FLOOR
    if dz < 0.004:
        v.co.z = FLOOR + 0.0006 + max(dz, 0) * 0.25
        settled += 1

# Every open edge left by the cut is where food met the old plate. The generator never
# modelled an underside, so the salmon's sides hang as torn curtains with gaps under them
# and the sauce is paper-thin. Smooth each edge loop in 3D, then extrude it straight down
# onto the new plate: the fillet closes into a solid, the sauce gets a real lip.
bnd = [v for v in bm.verts if v.is_boundary]
for _ in range(60):
    new = {}
    for v in bnd:
        nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        if len(nb) == 2:
            new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
    for v, c in new.items(): v.co = c
from mathutils.bvhtree import BVHTree
pbvh = BVHTree.FromPolygons([v.co for v in pme.vertices], [p.vertices for p in pme.polygons])
bedges = [e for e in bm.edges if e.is_boundary]
# which food does each edge belong to? sample the texture at the edge
def edge_is_flesh(e):
    lp = e.link_loops[0]
    u, v_ = lp[ul].uv
    c = bc[min(H - 1, max(0, int(v_ * H))), min(W - 1, max(0, int(u * W))), :3]
    return c[0] > c[1] * 1.2
flesh_edge = {e: edge_is_flesh(e) for e in bedges}
def edge_rgb(e):
    lp = e.link_loops[0]; u, v_ = lp[ul].uv
    return bc[min(H - 1, max(0, int(v_ * H))), min(W - 1, max(0, int(u * W))), :3].copy()
# wall colours = the colour of the food right where each wall starts (pre-grade texture)
_hi = [edge_rgb(e) for e in bedges if min(v.co.z for v in e.verts) > FLOOR + 0.012]
_lo = [edge_rgb(e) for e in bedges if min(v.co.z for v in e.verts) <= FLOOR + 0.012]
SIDE_COL = np.median(np.array(_hi), 0) if _hi else SIDE_COL
LIP_COL = np.median(np.array(_lo), 0) if _lo else np.array([0.9, 0.8, 0.65])
print(f"EDGECOL side={np.round(SIDE_COL,2).tolist()} lip={np.round(LIP_COL,2).tolist()}")
wall = bm.faces.layers.int.new("wall")   # before extrude: adding a layer invalidates face refs
STRIP = 96; H2 = H + STRIP
LIFTED = FLOOR + 0.012                    # an edge higher than this is the fish, not a sauce lip
# Fish/meat edges stay OPEN: the fillet overhangs, the way it does on the plate (client, after
# walls under the fillet read as a copper band and then as pleats). A rice bed fills below.
fish_edge_verts = [v for v in bm.verts if v.is_boundary and v.co.z > LIFTED]
from mathutils.bvhtree import BVHTree as _BVH
# Anything trapped UNDER the fillet (leftover sauce/base sheets from the generator) is replaced
# by the rice bed: it read as a flat grey slab under the overhang. A face goes if its centre
# is inside the fillet's footprint and there is fillet above it.
if len(fish_edge_verts) >= 3:
    _p2 = [v.co.xy.copy() for v in fish_edge_verts]
    _h = [_p2[i] for i in convex_hull_2d(_p2)]
    _cx = sum(p.x for p in _h) / len(_h); _cy = sum(p.y for p in _h) / len(_h)
    def _inside(x, y, margin):
        for i in range(len(_h)):
            a, b = _h[i], _h[(i + 1) % len(_h)]
            e = b - a; L = e.length
            if L < 1e-9: continue
            n_ = Vector((-e.y, e.x)) / L
            if n_.dot(Vector((_cx, _cy)) - a) < 0: n_ = -n_
            if n_.dot(Vector((x, y)) - a) < margin: return False
        return True
    _bvh0 = _BVH.FromBMesh(bm)
    under = []
    for f in bm.faces:
        c_ = f.calc_center_median()
        # only LOW, upward-facing sheets (trapped sauce/base). Anything else under the fillet's
        # top is the fillet's own side — deleting those hollowed it into a shell (tested).
        if f.normal.z < 0.6 or c_.z > FLOOR + 0.02: continue
        if not _inside(c_.x, c_.y, 0.008): continue
        hit = _bvh0.ray_cast(c_ + Vector((0, 0, 0.002)), Vector((0, 0, 1)))
        if hit[0] is not None and hit[0].z - c_.z < 0.1 and hit[2] != f.index:
            under.append(f)
    bmesh.ops.delete(bm, geom=under, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    fish_edge_verts = [v for v in bm.verts if v.is_valid and v.is_boundary and v.co.z > LIFTED]
    print(f"UNDERFILLET removed {len(under)} faces trapped under the fillet")
food_bvh = _BVH.FromBMesh(bm)

# Sauce lips only: extrude low open edges down onto the plate.
bedges = [e for e in bm.edges if e.is_boundary and max(v.co.z for v in e.verts) <= LIFTED]
ret = bmesh.ops.extrude_edge_only(bm, edges=bedges)
skirt = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
for v in skirt:
    hit = pbvh.ray_cast(Vector((v.co.x, v.co.y, 1.0)), Vector((0, 0, -1)))
    v.co.z = (hit[0].z if hit[0] else FLOOR) + 0.0004
wfaces = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace)]
for f in wfaces:
    f[wall] = 2; f.smooth = True

# ---- rice bed under the fillet ------------------------------------------------------------
# Footprint = convex hull of the fillet's open bottom edge, grown a little so rice peeks out
# under the overhang. Height at each point = up to just under the fillet's underside (ray cast
# up into the food), falling off to the plate at the rim, with grain-sized lumps on top.
nrice = 0
if len(fish_edge_verts) >= 3:
    pts2 = [v.co.xy.copy() for v in fish_edge_verts]
    hull_i = convex_hull_2d(pts2)
    hull = [pts2[i] for i in hull_i]
    Cx = sum(p.x for p in hull) / len(hull); Cy = sum(p.y for p in hull) / len(hull)
    GROW = 1.18
    hull0 = list(hull)
    hull = [Vector((Cx + (p.x - Cx) * GROW, Cy + (p.y - Cy) * GROW)) for p in hull]
    def inside_depth(x, y, hull=hull):
        """signed distance to the hull boundary (positive inside), convex polygon."""
        d = 1e9; n = len(hull)
        # orientation-independent: use centroid side
        for i in range(n):
            a, b = hull[i], hull[(i + 1) % n]
            e = b - a; L = e.length
            if L < 1e-9: continue
            nrm = Vector((-e.y, e.x)) / L
            if nrm.dot(Vector((Cx, Cy)) - a) < 0: nrm = -nrm
            d = min(d, nrm.dot(Vector((x, y)) - a))
        return d
    xs = [p.x for p in hull]; ys = [p.y for p in hull]
    SP = 0.0022
    nx = int((max(xs) - min(xs)) / SP) + 2; ny = int((max(ys) - min(ys)) / SP) + 2
    # Grains: Worley cells ~6 mm, each a rounded dome — reads as cooked rice like the model's
    # own. (Smoothed value noise read as a white slab once fix-dish's smoothing ran.)
    GR = 0.006
    rng_r = np.random.default_rng(3)
    gx0, gy0 = min(xs), min(ys)
    ncx = int((max(xs) - gx0) / GR) + 3; ncy = int((max(ys) - gy0) / GR) + 3
    seeds = (np.stack(np.meshgrid(np.arange(ncx), np.arange(ncy), indexing="ij"), -1)
             + rng_r.uniform(0.15, 0.85, (ncx, ncy, 2))) * GR
    X = gx0 + np.arange(nx)[:, None] * SP; Y = gy0 + np.arange(ny)[None, :] * SP
    ci = (X / 1).repeat(ny, 1); cj = Y.repeat(nx, 0)
    ci = ((ci - gx0) / GR).astype(int); cj = ((cj - gy0) / GR).astype(int)
    best = np.full((nx, ny), 1e9)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            a_ = np.clip(ci + di, 0, ncx - 1); b_ = np.clip(cj + dj, 0, ncy - 1)
            sx = gx0 + seeds[a_, b_, 0]; sy = gy0 + seeds[a_, b_, 1]
            best = np.minimum(best, (X.repeat(ny, 1) - sx) ** 2 + (Y.repeat(nx, 0) - sy) ** 2)
    lump = np.sqrt(np.clip(1 - best / (0.55 * GR) ** 2, 0, 1)) * 2 - 1   # dome per grain, -1..1
    # Height field first, as arrays: the ceiling (fillet underside, ray cast up) is jagged —
    # followed point by point it made blades, and clamping to it made flat slabs. Blur it,
    # stay 5 mm under it, and never clamp: grains that poke into the fillet are hidden inside.
    D = np.full((nx, ny), -1.0); D0 = np.full((nx, ny), -1.0); CEIL = np.full((nx, ny), np.nan)
    for i in range(nx):
        for j in range(ny):
            x = gx0 + i * SP; y = gy0 + j * SP
            d = inside_depth(x, y); D[i, j] = d
            D0[i, j] = inside_depth(x, y, hull0)
            if d < 0: continue
            hit = food_bvh.ray_cast(Vector((x, y, FLOOR + 0.001)), Vector((0, 0, 1)))
            if hit[0] is not None and hit[0].z - FLOOR < 0.08:
                CEIL[i, j] = hit[0].z
    cap = FLOOR + 0.03
    Cf = np.where(np.isnan(CEIL), cap, np.minimum(CEIL, cap))
    for _ in range(6):                                           # heavy blur of the ceiling
        Cf = (Cf + np.roll(Cf, 1, 0) + np.roll(Cf, -1, 0) + np.roll(Cf, 1, 1) + np.roll(Cf, -1, 1)) / 5
    grid = {}
    for i in range(nx):
        for j in range(ny):
            d = D[i, j]
            if d < 0: continue
            # two zones: under the fillet the bed rises to just below it; the part that peeks
            # out past the fillet is a low rice fringe (a full-height bed there read as a cliff)
            def ss(t): t = min(1.0, max(0.0, t)); return t * t * (3 - 2 * t)
            under_ = ss((D0[i, j] + 0.006) / 0.014)                   # 0 outside fillet -> 1 inside
            fringe = 0.008 * ss(d / 0.012)
            top = max(0.0, Cf[i, j] - 0.0015 - FLOOR)
            hgt = FLOOR + 0.0006 + fringe * (1 - under_) + max(top, fringe) * under_
            hgt += 0.0032 * lump[i, j] * max(ss(d / 0.012), 0.35)
            grid[(i, j)] = bm.verts.new((gx0 + i * SP, gy0 + j * SP, max(hgt, FLOOR + 0.0004)))
    rice_faces = []
    for (i, j), v00 in grid.items():
        q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
        if all(k in grid for k in q):
            f = bm.faces.new([grid[k] for k in q])
            f[wall] = 3; f.smooth = True; f.material_index = 0
            rice_faces.append(f)
    nrice = len(rice_faces)
print(f"RICEBED faces={nrice} under the fillet (fillet edges left open, overhanging)")

# Orient walls/rice outward/up explicitly — recalc_face_normals guesses on an open mesh.
bm.normal_update()
allfood = sum((v.co for v in bm.verts), Vector()) / max(len(bm.verts), 1)
flip = []
for f in wfaces:
    if not f.is_valid: continue
    out = f.calc_center_median() - allfood; out.z = 0
    if f.normal.dot(out) < 0: flip.append(f)
flip += [f for f in bm.faces if f[wall] == 3 and f.normal.z < 0]
bmesh.ops.reverse_faces(bm, faces=flip)
bm.to_mesh(me); bm.free()
print(f"SETTLE verts={settled}  skirt edges={len(bedges)} (open food edges closed down to the plate)")

# ---- 4. food finish -----------------------------------------------------------------------
rgb = bc[..., :3]
l = rgb.mean(2); s = rgb.max(2) - rgb.min(2)
r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
# Classify by HUE. Measured on oragulis-steiki's texture: white rice (s < 0.16), amber sauce
# (g/r 0.62-0.85, ~0.95/0.70/0.25), seared crust (g/r < 0.58, ~0.74/0.34/0.09).
# NOTE: judge colour with Blender's view transform set to STANDARD. The default (AgX)
# desaturates bright food so much that amber sauce previews as pale peach — it made a
# correct texture look "grim" and led to wrong fixes before (2026-09-25).
gr = g_ / np.maximum(r_, 1e-3)
rice = (l > 0.7) & (s < 0.16)
sear = ~rice & (s >= 0.16) & (gr < 0.58)
sauce = ~rice & (s >= 0.16) & (gr >= 0.62)
flesh = sear                                                   # (name used below)
# Food-photo finish: ONLY the wet things shine. Sauce glossy, seared crust has an oily
# sheen, rice stays dry. (Everything-glossy read as plastic; everything-matte read as clay.)
rough = np.full(l.shape, 0.6, np.float32)
rough[rice] = 0.72
rough[sauce] = 0.32                                           # glossy but soft: 0.24 glinted like shards on facets
rough[sear] = 0.4

def sat(x, k):
    y = x.mean(-1, keepdims=True); return y + (x - y) * k
def paint(mask, dark, light, keep=0.2, lo=5, hi=95):
    """Recolour a food toward its real palette. Brightness detail from the texture drives
    where between `dark` and `light` each texel lands, so folds/grain/sear marks survive;
    `keep` retains a little of the original hue variation."""
    if not mask.any(): return
    lm = l[mask]; a0, a1 = np.percentile(lm, lo), np.percentile(lm, hi)
    t = np.clip((lm - a0) / max(a1 - a0, 1e-3), 0, 1)[:, None]
    col = np.array(dark) + (np.array(light) - np.array(dark)) * t
    out[mask] = col * (1 - keep) + rgb[mask] * keep
out = rgb.copy()
# The generator's colours are already close to the restaurant's photo, so these are nudges
# (keep = how much of the original survives), not repaints:
paint(sauce, (0.72, 0.40, 0.09), (0.97, 0.67, 0.27), keep=0.3)   # deeper amber-orange, like the photo
paint(sear,  (0.30, 0.13, 0.05), (0.86, 0.52, 0.22), keep=0.35)  # golden-brown, deep edges
out[rice] = sat(rgb[rice], 0.5) * 1.02                           # clean white, not cream
def boxf(a, k):
    pad = np.pad(a, [(k, k), (k, k)] + [(0, 0)] * (a.ndim - 2), mode="edge")
    c = pad.cumsum(0).cumsum(1); c = np.pad(c, [(1, 0), (1, 0)] + [(0, 0)] * (a.ndim - 2))
    n = 2 * k + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)
delta = boxf((out - rgb).astype(np.float32), 2)                  # feather class seams
bc[..., :3] = np.clip(rgb + delta, 0, 1)
# side walls: the fish's side is seared crust; the lip is sauce
fcol = np.array([0.62, 0.34, 0.13])
scol = np.array([0.93, 0.66, 0.24])
print(f"WALLS flesh={np.round(fcol,2).tolist()} sauce={np.round(scol,2).tolist()}")
base_img.pixels.foreach_set(bc.astype(np.float32).ravel()); base_img.update(); base_img.pack()
# soften class edges so highlights don't show texture seams
k = 3
pad = np.pad(rough, k, mode="edge"); c = pad.cumsum(0).cumsum(1)
c = np.pad(c, ((1, 0), (1, 0)))
n_ = 2 * k + 1
rough = (c[n_:, n_:] - c[:-n_, n_:] - c[n_:, :-n_] + c[:-n_, :-n_]) / (n_ * n_)
rimg = bpy.data.images.new("food_roughness", W, H)
rimg.colorspace_settings.name = 'Non-Color'
# glTF ORM layout: R occlusion (1), G roughness, B metallic (0) — never leave rough in B:
# anything that ignores metallicFactor (Blender's USD export did) would read it as metal.
rimg.pixels.foreach_set(np.dstack([np.ones_like(rough), rough, np.zeros_like(rough), np.ones_like(rough)]).astype(np.float32).ravel())
rimg.pack()
for inp in ("Roughness", "Metallic"):
    for lk in list(bsdf.inputs[inp].links): nt.links.remove(lk)
rt = nt.nodes.new('ShaderNodeTexImage'); rt.image = rimg
rt.location = (-600, -300)
sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-350, -300)
nt.links.new(rt.outputs[0], sep.inputs[0])
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Specular IOR Level"].default_value = 0.35
nm = next((n for n in nt.nodes if n.type == 'NORMAL_MAP'), None)
if nm: nm.inputs["Strength"].default_value = 0.6
for n in [n for n in nt.nodes if n.type == 'SEPARATE_COLOR' and not any(o.links for o in n.outputs)]:
    img_node = n.inputs[0].links[0].from_node if n.inputs[0].links else None
    nt.nodes.remove(n)
    if img_node and not any(o.links for o in img_node.outputs): nt.nodes.remove(img_node)
mat.name = "food"

# ---- 5. wall colour strip ----------------------------------------------------------------
# Walls need ONE flat colour each. Pointing them at a few texels of the old atlas streaks at
# grazing angles (mip-mapping blends in the neighbours), so grow every texture by a strip
# of STRIP rows: left half fish-side colour, right half sauce colour. Squash all existing
# UVs into the old area (v * H/H2) and put the walls in the middle of their half-strip.
def grow(img, fill):
    a = read_px(img) if img.size[1] == H else None
    out = np.empty((H2, W, 4), np.float32); out[:H] = a; out[H:] = fill
    new = bpy.data.images.new(img.name + "_w", W, H2)
    new.colorspace_settings.name = img.colorspace_settings.name
    new.pixels.foreach_set(out.ravel()); new.pack()
    return new
# rice bed: REAL rice texture tiled from the model's own rice (flat white read as a slab)
def best_window(mask, k=STRIP, step=16):
    c = np.pad(mask.astype(np.float32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    best = (-1, 0, 0)
    for y in range(0, H - k, step):
        for x in range(0, W - k, step):
            n = c[y + k, x + k] - c[y, x + k] - c[y + k, x] + c[y, x]
            if n > best[0]: best = (n, y, x)
    return best
def mirror_tiles(crop, width):
    reps = [crop if i % 2 == 0 else crop[:, ::-1] for i in range(width // crop.shape[1] + 2)]
    return np.concatenate(reps, 1)[:, :width]
nr, ry, rx = best_window(rice)
print(f"RICETEX window at ({rx},{ry}) {nr / STRIP**2 * 100:.0f}% rice")
fill_bc = np.ones((STRIP, W, 4), np.float32)
fill_bc[:, :W // 2] = mirror_tiles(bc[ry:ry + STRIP, rx:rx + STRIP], W // 2)
fill_bc[:, W // 2:, :3] = scol
img_nodes = [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image]
for n in img_nodes:
    img = n.image
    if img == base_img:
        n.image = grow(img, fill_bc)
    elif img == rimg:
        f_ = np.ones((STRIP, W, 4), np.float32); f_[:, :, 2] = 0.0
        f_[:, :W // 2, 1] = 0.72; f_[:, W // 2:, 1] = 0.32   # matte rice bed | glossy sauce lip
        n.image = grow(img, f_)
    else:   # normal map: crust detail on the fish half, flat under the lip
        f_ = np.ones((STRIP, W, 4), np.float32); f_[:, :, :3] = (0.5, 0.5, 1.0)
        n.image = grow(img, f_)
wl = me.polygons.data.attributes.get("wall")
uvd = me.uv_layers.active.data
vmid = (H + STRIP / 2) / H2
nw = 0
for p in me.polygons:
    w_ = wl.data[p.index].value if wl else 0
    for li in p.loop_indices:
        if w_ == 3:
            pass                                     # rice bed: planar UVs set below
        elif w_:
            uvd[li].uv = (0.75, vmid)                # sauce lip
        else:
            uvd[li].uv = (uvd[li].uv[0], uvd[li].uv[1] * H / H2)
    nw += bool(w_)
# rice bed UVs: planar, one tile per 1.6 cm, each face shifted by whole tiles to stay inside
# the strip (horizontal shifts by 2 tiles keep the mirrored content continuous).
TILE_M = 0.016
ntile = 2 * ((W // 2) // STRIP // 2) - 2
for p in me.polygons:
    if not wl or wl.data[p.index].value != 3: continue
    us = [me.vertices[me.loops[li].vertex_index].co.x / TILE_M for li in p.loop_indices]
    vs = [me.vertices[me.loops[li].vertex_index].co.y / TILE_M for li in p.loop_indices]
    k2 = math.floor(min(us) / 2) * 2                 # whole mirror periods
    sv = -math.floor(min(vs))
    if max(vs) + sv > 0.97: sv -= (max(vs) + sv) - 0.97
    for li, u_, v_ in zip(p.loop_indices, us, vs):
        uu = (u_ - k2) + 2 * ((k2 // 2) % (ntile // 2))
        uvd[li].uv = (uu * STRIP / W, (H + (v_ + sv) * STRIP) / H2)
print(f"WALLS strip {STRIP}px, {nw} wall faces")
print(f"FINISH metallic 0; roughness mean {rough.mean():.2f} (was ~0.06); "
      f"rice {float(rice.mean())*100:.0f}% sauce {float(sauce.mean())*100:.0f}% flesh {float(flesh.mean())*100:.0f}% of texels")

bpy.ops.object.select_all(action='DESELECT')
food.select_set(True); plate.select_set(True)
bpy.context.view_layer.objects.active = food
bpy.ops.object.join()
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=95,
    export_materials='EXPORT', export_normals=True, export_texcoords=True,
    export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_yup=True)
print(f"REPLATE_OK {dst} {os.path.getsize(dst)}")
