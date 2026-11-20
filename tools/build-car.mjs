// Prepares the player car: data/car/bmw_m2.glb (Zacoe BMW G87 M2 widebody, Sketchfab/FBX export) -> public/car/bmw_m2.glb
//  - bakes the FBX 0.01 root scale (the mesh data is metres, so the car comes out 2.0 x 1.4 x 4.6 m, facing +z)
//  - drops what is never visible in game (engine bay, stock Kit0 body underneath the widebody kit), removes the unused skin
//  - splits every wheel into  steer_XX (yaw pivot: caliper + spin node)  ->  spin_XX (tyre + rim + brake disc, rolls around x)
//  - removes KHR_materials_transmission (screen-space refraction pass is too expensive for the target GPU; glass becomes plain alpha)
//  - renames the body paint material to "paint" so the game can recolour it, meshopt + quantize + webp textures
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { reorder, quantize, prune, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const src = process.argv[2] ?? 'data/car/bmw_m2.glb', out = process.argv[3] ?? 'public/car/bmw_m2.glb';
const doc = await io.read(src), root = doc.getRoot();
const tris = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? 0) / 3; return Math.round(t); };
const t0 = tris();

for (const s of root.listSkins()) s.dispose();
const all = []; root.listScenes()[0].traverse(n => all.push(n));
const kill = n => { n.traverse(c => { c.setMesh(null); }); n.listChildren().forEach(kill); n.dispose(); };
for (const n of all) if (!n.isDisposed?.() && (/^Zacoe:Engine_Geo/.test(n.getName()) || n.getName() === 'group1')) kill(n);
const fbx = all.find(n => n.getName().endsWith('.fbx')); fbx.setScale([1, 1, 1]);

// ---- wheels
const found = {};
for (const n of all) {
  const m = n.getName().match(/^Calliper(Front|Rear)\d?(L|R)_0\d$/); if (!m || n.isDisposed?.()) continue;
  const [x, y, z] = n.getTranslation();
  const key = (z > 0 ? 'F' : 'R') + (x > 0 ? 'L' : 'R');
  const spin = doc.createNode('spin_' + key);
  for (const c of n.listChildren()) { if (/^Calliper/.test(c.getName())) continue; n.removeChild(c); spin.addChild(c); }
  n.addChild(spin); n.setName('steer_' + key); found[key] = [x, y, z].map(v => +v.toFixed(3));
}
console.log('wheel pivots', found);

// ---- materials
for (const m of root.listMaterials()) {
  const n = m.getName();
  if (/PaintTNR/.test(n)) m.setName('paint');
  const tr = m.getExtension('KHR_materials_transmission'); if (tr) { m.setExtension('KHR_materials_transmission', null); tr.dispose(); if (m.getAlphaMode() === 'OPAQUE') m.setAlphaMode('BLEND'); }
  if (m.getAlphaMode() === 'BLEND' && !/glass|Window|Glass/.test(n) && (m.getBaseColorFactor()[3] >= 0.99)) m.setAlphaMode('MASK').setAlphaCutoff(0.4);   // blend-for-nothing materials -> cheap alpha test
}

await doc.transform(
  prune({ keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  quantize({ pattern: /^(POSITION|NORMAL|TANGENT)$/, quantizePosition: 14, quantizeNormal: 10 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
fs.mkdirSync('public/car', { recursive: true });
await io.write(out, doc);
const b = getBounds(root.listScenes()[0]);
console.log(`tris ${t0} -> ${tris()}, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, bounds`, b.min.map(v => +v.toFixed(2)), b.max.map(v => +v.toFixed(2)));
console.log('materials', root.listMaterials().map(m => m.getName().slice(-24) + ':' + m.getAlphaMode()[0]).join(' '));
