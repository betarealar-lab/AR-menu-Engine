#!/usr/bin/env node
// optimize-model.mjs — one command from a raw scan to the three files a dish needs.
//
//   node tools/model/optimize-model.mjs <input.glb> [options]
//
// Produces, next to the input (or in --out):
//   <name>_opt.glb     optimized, NO geometry compression   — the safe universal file
//   <name>_draco.glb   Draco-compressed                     — what goes in menu_items.model
//   <name>.usdz        Quick Look                           — what goes in menu_items.model_usdz
//
// Why all three: model-viewer bundles its own Draco decoder and index.html's Three.js
// WebXR carousel lazy-loads one (index.html ~L5718), so Draco is safe on both web paths
// today — but USDZ has no Draco equivalent, and the plain _opt.glb is the fallback for
// anything that chokes on the compressed one. Draco typically wins ~5x on these scans.
//
// The number that actually crashes phones is VRAM, not file size: an 8192x8192 baseColor
// costs 358 MB of GPU memory decompressed no matter how small the GLB is. That is why
// --tex defaults to 2048 (22 MB) and the report prints VRAM before and after.
//
// Why the glTF-Transform API and not its CLI: two reasons. It parses the file once
// instead of once per command (~8x faster on a 100 MB scan), and the CLI's texture stage
// dies with `colourspace: parameter space not set` on every model. That error is NOT a
// broken libvips — it is two copies of sharp's native addon in one process: the CLI
// loads sharp at the top level while ndarray-pixels (a @gltf-transform/functions
// dependency) drags in its own. libvips cannot be initialized twice. package.json pins
// a single sharp with an `overrides` entry; if that error ever comes back, run
// `npm ls sharp` and expect exactly one.
//
// Requires: node, and Blender for the USDZ step (Apple's usdzconvert is macOS-only and
// the usd-core wheel ships no glTF reader, so Blender is the only local path on Windows).
// Override its location with BLENDER=<path to blender.exe>.
//
// First run installs its dependencies into the repo's node_modules.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// This folder: its own package.json + node_modules, and the Blender helpers beside it.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DEPS = ['@gltf-transform/core', '@gltf-transform/extensions', '@gltf-transform/functions',
              'meshoptimizer', 'draco3dgltf', 'sharp'];

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    console.log(`
optimize-model.mjs — GLB -> optimized GLB + Draco GLB + USDZ

  node tools/model/optimize-model.mjs <input.glb> [options]

  --out <dir>          output directory              (default: alongside the input)
  --name <base>        output basename               (default: input filename)
  --tex <px>           max texture size for web      (default: 2048)
  --usdz-tex <px>      max texture size for USDZ     (default: same as --tex)
  --quality <1-100>    JPEG/WebP quality             (default: 85)
  --tex-format <fmt>   jpeg | webp | keep            (default: jpeg)
  --tris <n>           target triangle count         (default: 40000, 0 = no simplify)
  --error <n>          max simplification error      (default: 0.02, fraction of extent)
  --drop-mr            discard the metallicRoughness map (usually near-constant on scans)
  --drop-normal        discard the normal map
  --skip-draco         don't write <name>_draco.glb
  --skip-usdz          don't write <name>.usdz
  --keep-temp          leave the USDZ intermediate on disk

 Placement (AR correctness — see "the house convention" below)
  --size <m>           scale so the widest horizontal span is <m> metres
                       (default: 0.28 only when the model is >1 m, else untouched)
  --no-upright         don't rotate a flat dish onto the ground plane
  --flip               turn the dish over (use when --upright guesses upside-down)
  --no-seat            don't drop the model onto y=0

  The house convention, matched by every model already shipped: thinnest axis
  vertical, real-world metres (burger 0.12 m, plate 0.30 m), and min-y == 0 so
  the dish rests on the plane Quick Look and WebXR detect. Generative engines
  emit neither — Meshy normalises everything to a ~2-unit cube in whatever
  orientation it reconstructed — so this stage is not optional for those.
  Per-item fine tuning still lives in menu_items.ar_scale.

  --tex-format jpeg is dropped automatically for a texture that carries alpha
  (JPEG has no alpha channel); those stay webp on the web path and become png
  inside the USDZ, which reads PNG/JPEG only.
`);
    process.exit(argv.length ? 0 : 2);
}

const opt = (flag, def) => {
    const i = argv.indexOf(flag);
    return i === -1 ? def : argv[i + 1];
};
const has = f => argv.includes(f);

const input = path.resolve(argv[0]);
if (!existsSync(input)) { console.error(`x no such file: ${input}`); process.exit(1); }

const outDir    = path.resolve(opt('--out', path.dirname(input)));
const baseName  = opt('--name', path.basename(input).replace(/\.(glb|gltf)$/i, ''));
const texSize   = Number(opt('--tex', 2048));
const usdzTex   = Number(opt('--usdz-tex', texSize));
const quality   = Number(opt('--quality', 85));
const texFormat = opt('--tex-format', 'jpeg');
const targetTris = Number(opt('--tris', 40000));
const maxError  = Number(opt('--error', 0.02));
const sizeArg   = opt('--size', null);          // null = decide from the model's own scale
const AUTO_SIZE_M     = 0.28;                   // a dinner plate, matching plate_with_food.glb
const AUTO_SIZE_ABOVE = 1.0;                    // no real dish is a metre across

// ---------------------------------------------------------------- deps

// A plain `npm install` (never --no-save, which prunes anything package.json omits) so
// the `overrides` block that keeps sharp singular is actually honoured.
function ensureDeps() {
    const missing = DEPS.filter(d => !existsSync(path.join(REPO, 'node_modules', ...d.split('/'))));
    if (!missing.length) return;
    console.log(`  installing ${missing.join(' ')} (first run only)...`);
    const r = spawnSync('npm install --no-audit --no-fund', { cwd: REPO, shell: true, stdio: 'inherit' });
    if (r.status !== 0) { console.error('x dependency install failed'); process.exit(1); }
}
ensureDeps();

const { NodeIO }        = await import('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRDracoMeshCompression } = await import('@gltf-transform/extensions');
const fns               = await import('@gltf-transform/functions');
const { MeshoptSimplifier, MeshoptEncoder } = await import('meshoptimizer');
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const draco3d           = (await import('draco3dgltf')).default;
const sharp             = (await import('sharp')).default;

// ---------------------------------------------------------------- helpers

const MB = b => (b / 1048576).toFixed(2) + ' MB';

function stats(doc) {
    const root = doc.getRoot();
    let tris = 0;
    for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) tris += fns.getGLPrimitiveCount(prim);
    }
    let gpu = 0, bytes = 0;
    const tex = [];
    for (const t of root.listTextures()) {
        const img = t.getImage();
        const [w, h] = t.getSize() ?? [0, 0];
        bytes += img?.byteLength ?? 0;
        gpu += w * h * 4 * (4 / 3);                       // RGBA + mipmap chain
        tex.push(`${w}x${h} ${t.getMimeType().replace('image/', '')}`);
    }
    return { tris, gpu, texBytes: bytes, tex: tex.join(', ') || 'none' };
}

function line(label, file, s) {
    console.log(
        `  ${label.padEnd(13)} ${MB(statSync(file).size).padStart(9)}  ${String(s.tris).padStart(8)} tris  ` +
        `VRAM ${MB(s.gpu).padStart(9)}  [${s.tex}]`
    );
}

function findBlender() {
    if (process.env.BLENDER && existsSync(process.env.BLENDER)) return process.env.BLENDER;
    for (const root of ['C:/Program Files/Blender Foundation', 'C:/Program Files (x86)/Blender Foundation']) {
        if (!existsSync(root)) continue;
        for (const v of readdirSync(root).sort().reverse()) {      // newest install wins
            const exe = path.join(root, v, 'blender.exe');
            if (existsSync(exe)) return exe;
        }
    }
    for (const p of ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender']) {
        if (existsSync(p)) return p;
    }
    return null;
}

// Bake a 4x4 (column-major, glTF order) into every mesh's vertex data. Safe only after
// flatten()+join() have already collapsed node transforms to identity, which is why this
// runs inside the geometry stage rather than on the raw import.
function bake(doc, m) {
    for (const mesh of doc.getRoot().listMeshes()) fns.transformMesh(mesh, m);
}

const mat = (r, s, t) => new Float32Array([   // rows of `r` are the rotation's rows
    s * r[0][0], s * r[1][0], s * r[2][0], 0,
    s * r[0][1], s * r[1][1], s * r[2][1], 0,
    s * r[0][2], s * r[1][2], s * r[2][2], 0,
    t[0], t[1], t[2], 1,
]);
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RX_NEG90 = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];   // +z -> +y  (thin-Z dish stands up)
const RZ_POS90 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];   // +x -> +y
const RX_180   = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];  // turn it over
const mul = (a, b) => a.map((_, i) => b[0].map((_, j) =>
    a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));

// Rotate the dish flat, scale it to real-world metres, and drop it onto y=0 — the three
// things Quick Look and WebXR assume and no generative engine provides.
function place(doc) {
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    let b = fns.getBounds(scene);
    let d = [0, 1, 2].map(i => b.max[i] - b.min[i]);
    const before = d.map(v => v.toFixed(3)).join(' x ');

    // --- rotate: the thinnest axis of a plated dish is its vertical one ---
    let r = I;
    if (!has('--no-upright')) {
        const thin = d.indexOf(Math.min(...d));
        if (thin === 2) r = RX_NEG90;
        else if (thin === 0) r = RZ_POS90;
        // thin === 1 is already correct
    }
    // The axis is unambiguous; which end is up is not — a plate reads identically to its
    // own mirror image from the bounding box alone. --flip is the escape hatch.
    if (has('--flip')) r = mul(RX_180, r);

    // --- scale ---
    let s = 1;
    const rotated = r === I ? d : [0, 1, 2].map(i => {
        const j = [0, 1, 2].find(k => Math.abs(r[i][k]) > 0.5);
        return d[j];
    });
    const span = Math.max(rotated[0], rotated[2]);          // widest horizontal extent
    if (sizeArg !== null) { if (Number(sizeArg) > 0) s = Number(sizeArg) / span; }
    else if (span > AUTO_SIZE_ABOVE) s = AUTO_SIZE_M / span;

    if (r !== I || s !== 1) bake(doc, mat(r, s, [0, 0, 0]));

    // --- seat on the ground plane (recomputed: rotation moved everything) ---
    if (!has('--no-seat')) {
        b = fns.getBounds(scene);
        bake(doc, mat(I, 1, [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]));
    }

    b = fns.getBounds(scene);
    d = [0, 1, 2].map(i => b.max[i] - b.min[i]);
    const notes = [];
    if (r !== I) notes.push(has('--flip') ? 'rotated upright + flipped' : 'rotated upright');
    if (s !== 1) notes.push(`scaled ${s.toFixed(4)}x`);
    if (!has('--no-seat')) notes.push('seated on y=0');
    console.log(`  ${'placement'.padEnd(13)} ${before} -> ${d.map(v => v.toFixed(3)).join(' x ')} m` +
                (notes.length ? `  (${notes.join(', ')})` : '  (already correct)'));
}

// Bake every node's own TRS into its vertex data and reset the node to identity.
//
// place() below bakes scale/centring into *local* vertex positions via transformMesh. That is
// only world-consistent when every mesh node has an identity transform. flatten() clears
// parents but leaves each node's own TRS, so a dish built from several nodes (a scanned bread
// + a modelled plate) would have the same shift warped differently per node: the parts drift
// apart. corneradjaruli.glb shipped with its bread 6 cm off its plate because of this.
function bakeNodeTransforms(doc) {
    for (const node of doc.getRoot().listNodes()) {
        if (node.getMesh()) fns.clearNodeTransform(node);
    }
}

// Namespace every texture to this dish.
//
// Scanners name the albedo of EVERY model the same thing — KIRI and Meshy both emit
// "3DModel" — and Blender writes USDZ textures out under that name, so four dishes ship
// four archives all containing `textures/3DModel.jpg`. Blender's USD importer extracts
// to a temp cache keyed by that relative path, so opening several in one session binds
// whichever loaded first to all of them: one dish's texture on every plate.
//
// Rendering each model in its own headless process hides this completely. It only shows
// up when a human opens the set together, which is exactly what a human does.
function uniquifyTextures(doc, prefix) {
    let i = 0;
    for (const tex of doc.getRoot().listTextures()) {
        const slot = (fns.listTextureSlots(tex)[0] || 'tex').replace(/Texture$/, '');
        tex.setName(`${prefix}_${slot}_${i++}`);
        const uri = tex.getURI();
        if (uri) tex.setURI(`${prefix}_${slot}_${i}${path.extname(uri)}`);
    }
}

// Resize + re-encode every texture in place. `format` is the preferred output; any
// texture that actually uses its alpha channel keeps a format that has one.
async function retexture(doc, maxSize, format, q) {
    for (const tex of doc.getRoot().listTextures()) {
        const img = tex.getImage();
        if (!img) continue;
        const slots = fns.listTextureSlots(tex);

        const meta = await sharp(img, { limitInputPixels: false }).metadata();
        const scale = Math.min(1, maxSize / Math.max(meta.width, meta.height));
        const w = Math.max(1, Math.round(meta.width * scale));
        const h = Math.max(1, Math.round(meta.height * scale));

        // hasAlpha alone over-reports (scans often carry an opaque alpha channel), so
        // only a material that actually blends keeps it.
        const blends = doc.getRoot().listMaterials().some(m =>
            m.getAlphaMode() !== 'OPAQUE' && fns.listTextureInfo(tex).length > 0);
        const keepAlpha = meta.hasAlpha && blends;

        let out = format;
        if (format === 'keep') out = meta.format === 'jpeg' ? 'jpeg' : meta.format;
        if (keepAlpha && out === 'jpeg') out = 'webp';

        let pipe = sharp(img, { limitInputPixels: false });
        if (scale < 1) pipe = pipe.resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
        if (!keepAlpha) pipe = pipe.removeAlpha();

        // A normal map is geometry, not colour: chroma subsampling smears it. Roughness
        // is a single channel and survives anything.
        const isNormal = slots.includes('normalTexture');
        if (out === 'jpeg')      pipe = pipe.jpeg({ quality: isNormal ? Math.min(97, q + 10) : q, chromaSubsampling: isNormal ? '4:4:4' : '4:2:0', mozjpeg: true });
        else if (out === 'webp') pipe = pipe.webp({ quality: q, effort: 6 });
        else                     pipe = pipe.png({ compressionLevel: 9 });

        const buf = await pipe.toBuffer();
        tex.setImage(new Uint8Array(buf)).setMimeType(`image/${out}`);
        const uri = tex.getURI();
        if (uri) tex.setURI(uri.replace(/\.[^.]+$/, `.${out}`));
    }
}

// ---------------------------------------------------------------- run

mkdirSync(outDir, { recursive: true });
const tmp = path.join(os.tmpdir(), `betareal-opt-${process.pid}`);
mkdirSync(tmp, { recursive: true });

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
    });

console.log(`\n> ${path.basename(input)}\n`);
console.log('  stage             size      triangles          VRAM  textures');
console.log('  ' + '-'.repeat(84));

let doc = await io.read(input);
const baseStats = stats(doc);
line('input', input, baseStats);

// --- geometry -------------------------------------------------------------
// Order matters: dedup/flatten/join first so simplify sees one welded surface rather
// than a pile of disconnected primitives whose shared borders it refuses to collapse.
await doc.transform(fns.dedup(), fns.flatten());
bakeNodeTransforms(doc);
await doc.transform(fns.join(), fns.weld());

if (targetTris > 0 && baseStats.tris > targetTris) {
    await doc.transform(fns.simplify({
        simplifier: MeshoptSimplifier,
        ratio: targetTris / baseStats.tris,
        error: maxError,
    }));

    // meshoptimizer can only collapse edges that vertices actually share, and
    // glTF-Transform v4's weld() merges only bitwise-identical ones. A photogrammetry
    // scan usually has none — every triangle carries its own copies — so simplify()
    // plateaus far above target regardless of `error`. Blender welds on proximity
    // instead, which restores the topology; fall back to it only when the fast path
    // has demonstrably stalled, since meshopt holds UV seams better when it works.
    const got = stats(doc).tris;
    if (got > targetTris * 1.3) {
        const blender = findBlender();
        if (!blender) {
            console.log(`  ! simplify stalled at ${got} tris (target ${targetTris}) and Blender ` +
                        `isn't available for the weld fallback — output will be heavy.`);
        } else {
            const welded = path.join(tmp, 'welded.glb');
            const log = execFileSync(blender, [
                '-b', '--factory-startup', '-noaudio', '-P',
                path.join(REPO, 'blender-weld-decimate.py'),
                '--', input, welded, String(targetTris),
            ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 << 20 });

            if (existsSync(welded)) {
                const note = (log.match(/WELD_OK.*/) || [''])[0];
                console.log(`  ${'weld-rescue'.padEnd(13)} meshopt stalled at ${got} tris — ${note.replace('WELD_OK ', '')}`);
                doc = await io.read(welded);
                await doc.transform(fns.dedup(), fns.flatten());
                bakeNodeTransforms(doc);
                await doc.transform(fns.join());
            } else {
                console.log(`  ! weld fallback produced nothing; keeping ${got} tris`);
            }
        }
    }
}

// Material edits come AFTER the geometry stage on purpose: the weld rescue above may
// have replaced `doc` wholesale with Blender's re-import, which would silently discard
// anything dropped earlier. prune() then collects the newly-orphaned textures.
if (has('--drop-mr') || has('--drop-normal')) {
    for (const mat of doc.getRoot().listMaterials()) {
        if (has('--drop-mr'))     { mat.setMetallicRoughnessTexture(null); mat.setRoughnessFactor(0.9); mat.setMetallicFactor(0.0); }
        if (has('--drop-normal')) mat.setNormalTexture(null);
    }
}

await doc.transform(
    fns.prune({ keepAttributes: false, keepLeaves: false, keepSolidTextures: true }),
    fns.reorder({ encoder: MeshoptEncoder }),
);

place(doc);

// --- textures + web GLB ---------------------------------------------------

uniquifyTextures(doc, baseName);
await retexture(doc, texSize, texFormat, quality);

const optGlb = path.join(outDir, `${baseName}_opt.glb`);
writeFileSync(optGlb, await io.writeBinary(doc));
const optStats = stats(doc);
line('_opt.glb', optGlb, optStats);

// --- Draco GLB ------------------------------------------------------------
// quantize-position 14 is the floor for a plate-sized object: 12 bits puts visible
// stair-stepping on smooth ceramic rims.

let dracoStats = null;
const dracoGlb = path.join(outDir, `${baseName}_draco.glb`);
if (!has('--skip-draco')) {
    const dracoDoc = await io.read(optGlb);
    await dracoDoc.transform(fns.draco({
        method: 'edgebreaker',
        encodeSpeed: 0,             // slowest, smallest — this runs once per dish
        decodeSpeed: 5,
        quantizePosition: 14,
        quantizeNormal: 10,
        quantizeTexcoord: 12,
        quantizeColor: 8,
    }));
    writeFileSync(dracoGlb, await io.writeBinary(dracoDoc));
    dracoStats = { ...stats(dracoDoc) };
    line('_draco.glb', dracoGlb, dracoStats);
}

// --- USDZ -----------------------------------------------------------------

let usdzBytes = null;
const usdz = path.join(outDir, `${baseName}.usdz`);
if (!has('--skip-usdz')) {
    const blender = findBlender();
    if (!blender) {
        console.log('  ! Blender not found - skipping USDZ. Set BLENDER=<path to blender.exe>.');
    } else {
        // Quick Look reads PNG/JPEG only, so the USDZ gets its own intermediate rather
        // than being built from a possibly webp-textured _opt.glb.
        const usdzSrc = path.join(tmp, 'usdz-src.glb');
        const usdzDoc = await io.read(optGlb);
        uniquifyTextures(usdzDoc, baseName);
        await retexture(usdzDoc, usdzTex, 'jpeg', quality);
        writeFileSync(usdzSrc, await io.writeBinary(usdzDoc));

        const pyScript = path.join(REPO, 'glb-to-usdz.py');
        const log = execFileSync(blender, [
            '-b', '--factory-startup', '-noaudio', '-P', pyScript, '--', usdzSrc, usdz, String(usdzTex),
        ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 << 20 });

        if (existsSync(usdz)) {
            usdzBytes = statSync(usdz).size;
            console.log(`  ${'.usdz'.padEnd(13)} ${MB(usdzBytes).padStart(9)}  Quick Look, ${usdzTex}px jpeg textures`);
        } else {
            console.log('  ! Blender produced no USDZ:\n' + log.split(/\r?\n/).filter(l => /ERROR/i.test(l)).join('\n'));
        }
    }
}

// --- summary --------------------------------------------------------------

console.log('  ' + '-'.repeat(84));
const shipFile = dracoStats ? dracoGlb : optGlb;
const ship = dracoStats ?? optStats;
console.log(`  web payload  ${MB(statSync(input).size)} -> ${MB(statSync(shipFile).size)}  (${(statSync(input).size / statSync(shipFile).size).toFixed(1)}x smaller)`);
console.log(`  VRAM         ${MB(baseStats.gpu)} -> ${MB(ship.gpu)}`);
console.log(`  triangles    ${baseStats.tris} -> ${ship.tris}`);
console.log(`
  Upload ${path.basename(shipFile)} + ${usdzBytes ? path.basename(usdz) : '(no usdz produced)'}:
    rebuild     admin /dev/upload, "as-is" mode (GLB + USDZ)
    production  Niko's admin panel (super-admin): menu_items.model / model_usdz,
                then bump sw.js CACHE_NAME there and run its check-models.mjs
`);

if (has('--keep-temp')) console.log(`  intermediate: ${tmp}\n`);
else rmSync(tmp, { recursive: true, force: true });
