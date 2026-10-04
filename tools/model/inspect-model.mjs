#!/usr/bin/env node
// inspect-model.mjs — print size / triangles / VRAM / textures for one or more GLBs,
// without writing anything. Use it to decide whether a model needs optimize-model.mjs.
//
//   node tools/model/inspect-model.mjs <a.glb> [b.glb ...]

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const fns = await import('@gltf-transform/functions');
const draco3d = (await import('draco3dgltf')).default;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
});

const MB = b => (b / 1048576).toFixed(2) + ' MB';

console.log('\n  file                          size      triangles          VRAM  dims (m)            textures');
console.log('  ' + '-'.repeat(118));

for (const arg of process.argv.slice(2)) {
    const f = path.resolve(arg);
    if (!existsSync(f)) { console.log(`  ${path.basename(f)}  -- not found`); continue; }
    const doc = await io.read(f);
    const root = doc.getRoot();

    let tris = 0;
    for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) tris += fns.getGLPrimitiveCount(prim);
    }
    let gpu = 0;
    const tex = [];
    for (const t of root.listTextures()) {
        const [w, h] = t.getSize() ?? [0, 0];
        gpu += w * h * 4 * (4 / 3);
        tex.push(`${w}x${h} ${t.getMimeType().replace('image/', '')}`);
    }
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const b = fns.getBounds(scene);
    const d = [0, 1, 2].map(i => (b.max[i] - b.min[i]).toFixed(3)).join(' x ');
    const draco = doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'KHR_draco_mesh_compression');

    console.log(
        `  ${path.basename(f).slice(0, 28).padEnd(28)} ${MB(statSync(f).size).padStart(9)}  ` +
        `${String(tris).padStart(8)} tris  VRAM ${MB(gpu).padStart(9)}  ${d.padEnd(20)} ` +
        `${draco ? '[draco] ' : ''}${tex.join(', ') || 'none'}`
    );
}
console.log('');
