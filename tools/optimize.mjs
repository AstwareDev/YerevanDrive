// Compress the raw GLB: reorder + quantize (positions/normals/colours; UVs stay float because they are world-metre coords) + meshopt.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { reorder, quantize, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('data/yerevan.raw.glb');
await doc.transform(
  prune({ keepAttributes: true }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 16, quantizeNormal: 10 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write('public/map/yerevan.glb', doc);
console.log('raw', (fs.statSync('data/yerevan.raw.glb').size / 1e6).toFixed(1), 'MB -> optimized', (fs.statSync('public/map/yerevan.glb').size / 1e6).toFixed(1), 'MB');
