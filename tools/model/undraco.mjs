#!/usr/bin/env node
// undraco.mjs - the same GLB with its mesh compression taken off, nothing else changed.
//
//   node tools/model/undraco.mjs <in.glb> <out.glb>
//
// The USDZ converter (usdz.py) reads vertex buffers directly and cannot decode Draco or
// meshopt. An uploaded model is often compressed, so the bridge runs this first. Textures,
// materials, scale and triangle count are untouched: this decodes, it does not optimise.

const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const draco3d = (await import('draco3dgltf')).default;
const { MeshoptDecoder } = await import('meshoptimizer');

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
    console.error('usage: node undraco.mjs <in.glb> <out.glb>');
    process.exit(2);
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
});

const doc = await io.read(src);
for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression'
        || ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
}
await io.write(dst, doc);
