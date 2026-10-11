#!/usr/bin/env node
// harden-model.mjs — make a dish model ours, provably, before it reaches a browser.
//
//   node tools/model/harden-model.mjs <input.glb> --tenant <tenant-id> [--out <file>]
//
// Three things, none of which changes a single vertex or pixel the diner sees:
//
//   1 · Strip the clues. Scanners stamp `asset.generator` with "Meshy" / "KIRI" and name
//       every mesh and material after their internal pipeline. A stolen file advertises
//       exactly how it was made. We blank all of it and set the generator to "BetaReal".
//
//   2 · State ownership. `asset.copyright` is set to a notice naming BetaReal and the
//       tenant the model is licensed to. It is the legal footing for "that's ours".
//
//   3 · Sign it. An extras block carries a per-tenant marker and an HMAC over it, so a
//       file can be proved ours and traced to the exact restaurant it leaked from -
//       without the tenant id ever appearing in the clear. Verify with --verify.
//
// HONEST LIMITS. Extras and asset metadata survive a copy and a re-serialise, but a
// determined thief who re-exports through Blender drops them. This is traceability and
// deterrence, not a lock: a web model can always be captured as it renders (that is what
// rendering is). A watermark that survives re-export has to live in the geometry or the
// textures; that is a heavier, separate pass and is noted as a TODO below.
//
// The signing key is MODEL_WATERMARK_SECRET (from .env). Same key signs and verifies.

import { createHmac, createHash } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const has = f => argv.includes(f);

if (!argv.length || has('-h') || has('--help')) {
  console.log(`harden-model.mjs — strip clues, state ownership, sign for tracing

  node tools/model/harden-model.mjs <input.glb> --tenant <id> [--out <file>]
  node tools/model/harden-model.mjs <input.glb> --verify          (read the marker back)

  --tenant <id>   the restaurant this copy is licensed to   (required unless --verify)
  --out <file>    output path                                (default: <name>_hardened.glb)
  --name <text>   human name for the copyright notice        (default: the tenant id)
  --verify        print the embedded marker and whether its signature is valid
`);
  process.exit(argv.length ? 0 : 2);
}

const input = path.resolve(argv[0]);
if (!existsSync(input)) { console.error(`x no such file: ${input}`); process.exit(1); }

const SECRET = process.env.MODEL_WATERMARK_SECRET || '';
if (!SECRET) {
  console.error('x MODEL_WATERMARK_SECRET is not set (export it from .env). Refusing to sign with no key.');
  process.exit(1);
}

// A tenant id never travels in the clear: the marker carries the first 16 hex of its
// SHA-256, which we can match against our own tenant list but a thief cannot read as a name.
const tenantTag = (id) => createHash('sha256').update(`betareal:tenant:${id}`).digest('hex').slice(0, 16);
const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
const MARK = 'betareal_mark';

// deps (installed by optimize-model.mjs's ensureDeps, or `npm install` in this folder)
const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const draco3d = (await import('draco3dgltf')).default;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// glTF-Transform always stamps its own `asset.generator` on write, clobbering whatever we
// set in the document. So we patch the generator directly in the GLB's JSON chunk after
// serialising. A GLB is: 12-byte header, then chunks of [uint32 length][4-byte type][data];
// the first chunk is JSON, space-padded to a 4-byte boundary.
function patchGlbJson(buf, mutate) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);                 // length of the JSON chunk data
  const jsonStart = 20;                                   // 12 header + 8 chunk header
  const json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + jsonStart, jsonLen).toString('utf8'));
  mutate(json);
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';              // pad with spaces, same as the spec
  const newJson = Buffer.from(text, 'utf8');
  const bin = Buffer.from(buf.buffer, buf.byteOffset + jsonStart + jsonLen,
                          buf.byteLength - jsonStart - jsonLen);   // BIN chunk, untouched
  const head = Buffer.alloc(20);
  head.write('glTF', 0); head.writeUint32LE(2, 4);
  head.writeUint32LE(20 + newJson.length + bin.length, 8); // total file length
  head.writeUint32LE(newJson.length, 12);                  // JSON chunk length
  head.writeUint32LE(0x4E4F534A, 16);                      // 'JSON'
  return Buffer.concat([head, newJson, bin]);
}

// Read the GLB's JSON chunk straight from the bytes. glTF-Transform's reader overwrites
// asset.generator with its own name in memory, so the truthful generator and copyright
// can only be read from the file itself.
function readGlbJson(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const jsonLen = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
}

if (has('--verify')) {
  const j = readGlbJson(input);
  const m = (j.extras || {})[MARK];
  if (!m) { console.log('no BetaReal marker on this file.'); process.exit(0); }
  const { t, iss, sig, ...rest } = m;
  const good = sig === sign(`${t}.${iss}`);
  console.log(`generator : ${(j.asset || {}).generator || '(none)'}`);
  console.log(`copyright : ${(j.asset || {}).copyright || '(none)'}`);
  console.log(`tenant tag: ${t}`);
  console.log(`issued    : ${new Date(iss).toISOString()}`);
  console.log(`signature : ${good ? 'VALID — this is a BetaReal model' : 'INVALID — forged or wrong key'}`);
  if (Object.keys(rest).length) console.log('extra     :', rest);
  process.exit(good ? 0 : 1);
}

const tenant = opt('--tenant', '');
if (!tenant) { console.error('x --tenant <id> is required'); process.exit(1); }
const name = opt('--name', tenant);
const out = path.resolve(opt('--out', input.replace(/\.(glb|gltf)$/i, '_hardened.glb')));

const doc = await io.read(input);
const root = doc.getRoot();
const asset = root.getAsset();

const before = { generator: readGlbJson(input).asset?.generator, copyright: asset.copyright };

// 1 · strip the clues — generator, and every human-readable name
asset.generator = 'BetaReal';
for (const o of [...root.listScenes(), ...root.listNodes(), ...root.listMeshes(),
                 ...root.listMaterials()]) {
  if (o.getName()) o.setName('');
}
// Texture names are deliberately NOT blanked: optimize-model.mjs namespaces them to dodge
// a USDZ filename collision, and that uniqueness still matters downstream.

// 2 · state ownership
asset.copyright = `(c) BetaReal. 3D model licensed to ${name}. Not for redistribution.`;

// 3 · sign it — a per-tenant tag plus an HMAC, no plaintext tenant id
const t = tenantTag(tenant);
const iss = Date.now();
root.setExtras({ ...(root.getExtras() || {}), [MARK]: { v: 1, t, iss, sig: sign(`${t}.${iss}`) } });

// Write, then force the generator in the binary (writeBinary resets it to its own name).
const bytes = patchGlbJson(Buffer.from(await io.writeBinary(doc)),
  (json) => { json.asset = json.asset || {}; json.asset.generator = 'BetaReal'; });
writeFileSync(out, bytes);

console.log(`hardened  ${path.basename(input)} -> ${path.basename(out)}`);
console.log(`  generator  ${before.generator || '(none)'} -> BetaReal`);
console.log(`  copyright  ${before.copyright || '(none)'} -> set`);
console.log(`  marker     tenant-tag ${t}, signed`);

// TODO (robust watermark, survives Blender re-export): a sub-perceptual pattern in the
// geometry (above the 14-bit Draco quantisation step so it survives compression) or a
// spread-spectrum mark in the baseColor texture. Heavier, risks model quality — its own pass.
