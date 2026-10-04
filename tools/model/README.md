# Dish model tools: the hand pipeline

How a dish model is finished by hand before it goes on a menu: clean it up in Blender, then
optimise it into the two files a diner loads. Written 2026-09-23 in Niko's working copy,
where it was never committed; moved here 2026-10-04 so it is versioned.

**Not the engine.** The engine's own optimiser (`optimize.py` at the repo root) runs
automatically on every generated model. These tools are for a person fixing a dish: scans on
a modelled plate, AI dishes whose plate is fused into the food, and anything the automatic
path got wrong. The output goes into the rebuild admin's **Upload model, as-is** mode, or
into production's admin.

**Rules for anyone (person or AI) running these:** read this file first and follow it. Don't
rewrite the scripts; they hold fixes for six real bugs (below). Render the output and look
at it before handing it over. If you don't know the real size of a dish, say the scale is
unverified rather than guessing.

| File | What it does |
|---|---|
| `optimize-model.mjs` | raw GLB -> `_draco.glb` (web) + `.usdz` (iPhone) + `_opt.glb` (fallback), at real size |
| `inspect-model.mjs` | prints triangles, textures, VRAM and bounds of GLBs without writing anything |
| `fix-dish.py` | Blender: a food scan on a modelled plate (overflow, clipping, grim colour) |
| `replate-dish.py` | Blender: AI dish with food and plate fused into one mesh -> clean plate + per-food finish |
| `glb-to-usdz.py` | Blender: GLB -> USDZ, called by `optimize-model.mjs` |
| `blender-weld-decimate.py` | Blender: weld + decimate fallback, called by `optimize-model.mjs` |

npm packages install into this folder on the first run (`package.json` here, `node_modules/`
gitignored). Blender 5.1 is expected at its default Windows path; override with `BLENDER=`.

---

## The command

```bash
cd C:\Users\temot\BetaReal-Engine
node tools/model/optimize-model.mjs <input.glb> --out <dir> --name <slug> \
     --tex 2048 --tris 40000 --tex-format webp [--size <metres>]
```

Produces three files. **Upload two:**

| file | goes in | note |
|---|---|---|
| `<slug>_draco.glb` | `menu_items.model` | the web model |
| `<slug>.usdz` | `menu_items.model_usdz` | iOS Quick Look |
| `<slug>_opt.glb` | — | intermediate, do not upload |

After a production upload: bump `CACHE_NAME` in its `sw.js`, then run its `scripts/check-models.mjs`. The rebuild needs neither.
Leave `menu_items.ar_scale` at `1.0` — real-world scale is baked into the files.

### Step 0 — food scan on a modelled plate? Clean it first

Most dishes are a food scan (one textured material, e.g. `3DModel`) dropped onto a clean
modelled tray/plate/board (all other materials). The scan still carries the *original*
plate's sauce, so it hangs off the new plate's edge, smears over the rim, sinks into the
floor and z-fights. Run this before `optimize-model.mjs`:

```bash
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b --factory-startup -noaudio \
  -P tools/model/fix-dish.py -- <in.glb> <fixed.glb>
node tools/model/optimize-model.mjs <fixed.glb> --out <dir> --name <slug> --size 0 ...
```

It never touches the plate. On the food it:
- cuts anything off the plate's footprint or within 4 mm of the rim,
- drops loose debris,
- deletes food that has plate more than 3 mm above it (food buried in the tray body or
  hanging underneath it — it shows as dark holes/specks on the outside walls),
- lifts shallow contact 0.5 mm clear, but only toward the floor or inner walls. It never
  pushes food outward along an outer-wall normal, because that pops it out through the
  side of the tray.
- lightly smooths lumpy scan surfaces,
- cleans and brightens the texture: removes grain while keeping edges, shifts whites
  30% toward warm cream, lifts exposure and mids, adds vibrance.

The client wants dishes **clean and bright**. Two things made them look grim and were
removed: a baked ambient-occlusion shadow pass and clarity/sharpening, both of which
darkened the dish. A full white-balance to neutral also backfired, turning the rice cold and
grey.

Use `--size 0` afterwards, because these plates are already modelled at real size.

- **No gloss by default.** Tested on the sushi tray: any sheen reflects the sky across the whole
  dish and reads paler and pinker, not juicier. `--gloss` exists but leave it off.
- **Never warm the grade by adding red.** It turns cream sauce pink. Warm by cutting blue.
- Flags: `--no-grade`, `--no-smooth`, `--gloss`. It prints a count for each fix. A large `rim_smear` number is
  normal on trays.

### Step 0b — AI-generated dish (food and plate fused in one mesh)? Replate it first

Generators (Meshy, Hunyuan, Tripo) bake the plate into the same mesh and texture as the
food. The plate comes out lumpy, with blotchy highlights, and the whole model usually ships
near-mirror smooth. oragulis-steiki had a mean roughness of 0.06, plus some metallic, so it
read as wet plastic.

```bash
blender -b --factory-startup -noaudio -P tools/model/replate-dish.py -- <in.glb> <replated.glb>
blender -b --factory-startup -noaudio -P tools/model/fix-dish.py     -- <replated.glb> <fixed.glb>
node tools/model/optimize-model.mjs <fixed.glb> --out <dir> --name <slug> --size 0 ...
```

What `replate-dish.py` does:
- **Split plate from food.** Dark faces count as plate. Dark vertical faces in the middle of
  the plate stay as food, because they're the seared side of the fish or meat. Leaving that
  out once deleted a salmon's side.
- **Replace the plate.** It deletes the old plate and models a clean square stoneware plate
  at the same size and angle.
- **Open edges.** The food never had an underside.
  - **Sauce lips** are extruded down onto the plate as a thin, glossy edge.
  - **Fish/meat edges stay open.** The fillet overhangs, the way it sits on a real plate.
    The client rejected walls under the fillet: first they read as a copper band, then
    as pleats.
  - **Rice bed.** Leftover low sheets trapped under the fillet are deleted. Only low,
    upward-facing faces count: deleting everything under the fillet hollowed it into a
    shell. A rice bed is built in their place:
    - It rises to just under the fillet, following a blurred copy of the underside;
      following it exactly made blades and flat slabs.
    - Where it peeks out past the fillet it's only a low ~8 mm fringe; full height read
      as a white cliff.
    - Grains are Worley domes, ~6 mm.
    - It's textured with real rice tiled from the model's own rice. Flat white read as
      a slab.
  - **Normals** are set to face outward explicitly.
  - **Run `fix-dish.py` with `--no-grade --no-smooth`** afterwards. Its smoothing flattens
    the grains, and the grade fights the palette.
- **Set a realistic finish per food**, classified by hue, not brightness:
  - rice: roughness 0.8, tinted warm off-white
  - sauce: roughness 0.5
  - fish/meat: roughness 0.58, tinted coral
  - metallic: 0 everywhere

**Scale is not fixed.** Generators don't know real size. oragulis-steiki's plate is 44 cm,
which is probably about 1.5× too big. Ask for the plate size and pass `--size`.

### Flags that matter

- `--size <m>` — scale so the widest horizontal span equals `<m>`. **Only pass a measured
  number.** `--size 0` disables scaling entirely (keeps source scale).
- `--tex 2048` — texture cap. This is the VRAM lever, see below.
- `--tris 40000` — triangle target. This is the USDZ size lever, see below.
- `--tex-format webp` — for the web GLB. The USDZ always gets JPEG internally regardless.
- `--no-seat` — **avoid.** It skips floor-seating *and* x/z centring together. Using it is
  what shipped a caesar model 1.65 m away from its own origin.
- `--flip` — if upright detection guesses upside-down. The axis is detectable; which face is
  up is not.
- `--drop-mr`, `--drop-normal`, `--skip-draco`, `--skip-usdz`, `--error`, `--quality`, `--usdz-tex`.

### Inspect without writing anything

```bash
node tools/model/inspect-model.mjs <file.glb> [more.glb ...]
```

---

## The house convention

Every shipped model: **thinnest axis vertical, real-world metres, `min-y == 0`, centred on
x/z.** Quick Look and WebXR both assume it. Generative engines provide none of it — Meshy
normalises everything into a ~2-unit cube in whatever orientation it reconstructed.

---

## Two numbers people get wrong

**VRAM, not file size.** A texture costs `w × h × 4 × 1.33` bytes of GPU memory once
decoded, however well it compressed on disk. A 4096² map is **85 MB** — one khinkali model
was 0.76 MB on disk and 149 MB in VRAM. That is what kills a mid-range Android, and it is
invisible in Explorer. Cap at 2048 (21 MB).

**USDZ size is geometry, not texture.** USD stores mesh uncompressed — there is no Draco
equivalent in the format. A 2.4 MB USDZ is typically ~2 MB geometry and ~0.4 MB textures, so
cut triangles, not textures, when a USDZ has to shrink. 40k → 20k roughly halves it with no
visible difference at menu-thumbnail scale.

---

## Six bugs the scripts already fix — do not undo these

**1. Duplicate `sharp` breaks every texture operation.**
Symptom: `colourspace: parameter space not set` on every model, even a plain resize. It is
not a broken libvips — it is two copies of sharp's native addon in one process (the CLI
loads one, `ndarray-pixels` under `@gltf-transform/functions` drags in another). libvips
cannot initialise twice. `package.json` pins one via `overrides`. If it returns:
`npm ls sharp` must show exactly one.

**2. Texture filename collisions across models.**
Scanners name every model's albedo `3DModel`, so four dishes ship four USDZs all containing
`textures/3DModel.jpg`. Blender extracts USDZ textures to a temp cache keyed by that path,
so opening several in one session binds whichever loaded first to all of them — one dish's
texture on every plate. `uniquifyTextures()` namespaces them per dish.

**3. Matte materials turn pink and washed-out in USDZ.**
Our scans carry `KHR_materials_specular` with `specularFactor: 0` (deliberately matte).
`UsdPreviewSurface` has no specular-level input, so the exporter drops it and readers fall
back to their own default of 0.5, laying a white sheen over the dish. `glb-to-usdz.py`
converts it to IOR, which USD does carry: `F0 = 0.08 × specular`, `ior = (1+√F0)/(1−√F0)`.
Specular 0 → IOR 1.0 (no reflection); 0.5 → 1.5 (the default, untouched).

**4. Multi-part dishes drift apart.**
A bread and a plate are separate nodes with different local transforms. `place()` bakes
scale/centring into each mesh's *local* vertex data, which each node's own transform then
warps differently — so the parts separate. This shipped an adjaruli with its bread 6 cm off
its plate. Fixed by `flatten()` then `clearNodeTransform()` on every mesh node *before*
join/weld.

**5. Simplification plateaus far above target.**
glTF-Transform v4's `weld()` merges only *bitwise-identical* vertices. A photogrammetry scan
has none — every triangle carries its own copies — so meshopt has no shared edges to collapse
and stalls regardless of `--error`. One salad: 638,451 verts for 292,261 tris, stuck at
231,436 whether error was 0.02 or 1.0, producing a 20 MB USDZ. `blender-weld-decimate.py`
welds by proximity (0.1 mm) instead, which restores topology; decimate then hits the target
exactly. It fires automatically when the fast path lands above 1.3× target — you will see a
`weld-rescue` line in the output.

**6. Metallic textures turn into metal in USDZ.**
glTF multiplies the metallic/roughness texture by a factor. Blender builds that as a Math
node, and its USD exporter drops the node, so the raw texture channel goes straight in. A
model with metallicFactor 0 over a non-zero blue channel was matte as a GLB and 70% metal as
a USDZ: shiny, grey and faceted. `glb-to-usdz.py` now bakes factor-0 inputs to a constant
(`FACTOR_FIX`). Also, never write roughness into a texture's blue channel. The layout is
R = occlusion, G = roughness, B = metallic.

---

## Getting scale right

**Never infer scale from a bounding box.** A dish lying diagonally makes the bbox measure a
diagonal, not the dish — that is how an adjaruli ended up 1.7× too small.

**Reference object: the 15 cm turntable** (white disc with the red LED) in the lightbox
photos. It and the dish share a rotation axis, so their widest points sit at the same camera
depth and the pixel ratio is a true ratio.

**Prefer a round plate as the measured feature** — a circle reads the same from every angle,
so it is rotation-invariant. The same plate measured 23.4 cm and 23.9 cm in two photos from
different angles, and a known-28 cm plate came back as 28.6 cm. About 2% accurate.

Method: overlay a pixel grid on the photo, read the turntable's silhouette edges and the
plate's, then `plate_cm = plate_px / turntable_px × 15`. Brightness profiling is unreliable
on the white-on-white base — zoom in and read the edges visually.

**Watch for these:**

- Some models are **bread only, with no plate** — then measure the loaf, not the plate it is
  sitting on.
- Raw scan scale varies wildly between exports. Some arrive at real-world scale, some at
  Meshy's ~1.9-unit cube. Always check.
- If no photo exists, **say the scale is unverified**. Do not guess.

---

## Verifying — this is where I got it wrong twice

**Render the output before handing it over.** Import the USDZ into headless Blender, put it
on a table plane, render it.

**Use a distant camera with a long lens** (`d = rad*8`, 85 mm). A close camera scaled to the
object's own size exaggerates foreshortening badly enough that a correct model looks
distorted — I chased a nonexistent decimation bug for several rounds because of this.
Compare against the **raw source rendered at identical camera settings**, never against a
differently-framed shot.

**For a batch, import every model into ONE Blender session.** Checking files one at a time is
structurally incapable of catching texture-name collisions — they only exist when the files
are together, which is exactly how a human opens them.

**Check the origin numerically**, not by eye: bbox centre x/z near 0, `min-y` near 0. For
multi-part dishes, measure each part separately and confirm their centres agree.

---

**Judge colour with the view transform set to Standard**
(`scene.view_settings.view_transform = 'Standard'`, exposure about -1). Blender's default,
AgX, desaturates bright food heavily. It previewed an amber sauce as pale peach, which
led to several rounds of wrong colour "fixes", including the grey-cream grade on the
yirgizeti dishes and a pink salmon. If a render looks washed out, check this first.

**Finish rule, from the client, 2026-09-25:** make it look like the food photo. Only wet
things shine: sauce at roughness ~0.24, seared crust at ~0.4 (an oily sheen), rice and
starch matte at ~0.72, glazed plate at ~0.12. Everything-glossy reads as plastic, and
everything-matte reads as clay. Fish and meat must read as *cooked*: golden-brown sear
with darker edges, never flat pink. When the client supplies a reference photo, match
its palette.

## Why origin matters for AR

Quick Look takes the **floor** from the bounding box (forgiving), but the **horizontal anchor
and the pivot for rotate/pinch gestures come from the file's local origin `(0,0,0)`**. An
offset origin drops the dish away from where the diner taps, and spinning it swings the model
through an arc around empty space.

---

## Decisions already made — don't relitigate

- **Draco is ON.** The old "no Draco" rule in `BETAREAL.md` was written when the Three.js
  WebXR path had no decoder. It has one now (`index.html` ~L5718 lazy-loads it) and
  model-viewer bundles its own. Roughly 5× on our scans. Docs updated in §9/§13.
- **Store a real USDZ per item.** Settled; it was an open question in `MULTITENANCY.md` and
  `PLATFORM-SPEC.md`, both now updated.
- **Never use a generative engine's own USDZ.** Meshy returns GLB *and* USDZ, which looks
  like it skips a step — it doesn't. That USDZ carries the full un-decimated mesh and
  inherits the same broken placement.
- **Don't upload `_opt.glb`.** When the input was already Draco + WebP, `_opt.glb` can be
  *worse* than the original — a sushi model went 0.55 → 1.28 MB because the USDZ path
  converts WebP to JPEG. Only `_draco.glb` and `.usdz` are deliverables.

---

## Thumbnails

Menu cards are a `108px` box (240–300 on larger screens) with `object-fit: cover`. Square,
WebP quality 88, 800×800. A full-height centre crop beats fitting the whole plate in —
padding to square adds bands that `cover` will show in a portrait box.

---

## Requirements

Node, plus Blender at `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe` (override
with `BLENDER=`). Apple's `usdzconvert` is macOS-only and the `usd-core` wheel ships no glTF
reader, so **Blender is the only local GLB→USDZ path on Windows**. npm dependencies install
on first run from `package.json` — never with `--no-save`, which prunes the `overrides` that
keep sharp singular.
