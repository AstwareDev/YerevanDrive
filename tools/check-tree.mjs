// Usage: node tools/check-tree.mjs <trees.glb> — sanity ranges of the baked tree asset
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(process.argv[2]);
for (const m of doc.getRoot().listMeshes()) { const p = m.listPrimitives()[0], r = n => { const a = p.getAttribute(n), mn = [], mx = []; a.getMin(mn); a.getMax(mx); return [mn.map(v => +v.toFixed(2)), mx.map(v => +v.toFixed(2))]; }; console.log(m.getName(), 'tris', p.getIndices().getCount() / 3, 'pos', JSON.stringify(r('POSITION')), 'uv', JSON.stringify(r('TEXCOORD_0')), 'col', JSON.stringify(r('COLOR_0'))); }
