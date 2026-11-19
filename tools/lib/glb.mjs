// Writes a set of Builders as a meshopt-compressed, quantized GLB (positions/normals quantized, UVs + colours kept).
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { reorder, quantize, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** builders: Builder[] (each with .mat). attrs: which optional attributes to keep. Returns bytes written (0 if empty). */
export async function writeGlb(file, builders, { name = 'tile', uv = true, color = true, quantPos = 16 } = {}) {
  const live = builders.filter(b => b.idx.length);
  if (!live.length) return 0;
  const doc = new Document(); const buffer = doc.createBuffer('buf'); const scene = doc.createScene(name);
  const mesh = doc.createMesh(name); scene.addChild(doc.createNode(name).setMesh(mesh));
  const mats = new Map();
  const mat = (n) => { let m = mats.get(n); if (!m) { m = doc.createMaterial(n).setBaseColorFactor([1, 1, 1, 1]); mats.set(n, m); } return m; };
  const acc = (type, arr, norm = false) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer).setNormalized(norm);
  for (const b of live) {
    const prim = doc.createPrimitive().setMaterial(mat(b.mat))
      .setAttribute('POSITION', acc('VEC3', new Float32Array(b.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(b.nor)))
      .setIndices(acc('SCALAR', new Uint32Array(b.idx)));
    if (uv && !b.noUV) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(b.uv)));
    if (color && !b.noColor) prim.setAttribute('COLOR_0', acc('VEC4', Uint8Array.from(b.col, v => Math.max(0, Math.min(255, Math.round(v)))), true));
    mesh.addPrimitive(prim);
  }
  await doc.transform(prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: quantPos, quantizeNormal: 10 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await io.write(file, doc);
  return fs.statSync(file).size;
}
