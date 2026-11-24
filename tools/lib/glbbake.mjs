// Shared helpers for the Sketchfab -> game GLB builders (tools/build-heli.mjs, tools/build-garage.mjs).
// bake(doc, fn): applies every mesh node's world matrix to its vertices (positions, normals, tangents) followed by fn(x,y,z)->[x,y,z], flattens the node tree.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { reorder, quantize, prune, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

export async function makeIO() {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

/** returns [{ node, prim }] with vertex data in the final space (all nodes flattened under the scene, identity transforms) */
export function bake(doc, xf) {
  const root = doc.getRoot(), scene = root.listScenes()[0], out = [];
  for (const n of root.listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    const W = n.getWorldMatrix();
    for (const p of m.listPrimitives()) {
      const a = p.getAttribute('POSITION'), na = p.getAttribute('NORMAL'), ta = p.getAttribute('TANGENT');
      const cnt = a.getCount(), P = new Float32Array(cnt * 3), v = [0, 0, 0];
      for (let i = 0; i < cnt; i++) {
        a.getElement(i, v);
        const x = W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12], y = W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13], z = W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14];
        const r = xf(x, y, z); P[i * 3] = r[0]; P[i * 3 + 1] = r[1]; P[i * 3 + 2] = r[2];
      }
      a.setArray(P);
      for (const acc of [na, ta]) if (acc) {
        const N = acc.getCount(), comps = acc.getElementSize(), A = new Float32Array(N * comps), t = new Array(comps).fill(0);
        for (let i = 0; i < N; i++) {
          acc.getElement(i, t);
          const x = W[0] * t[0] + W[4] * t[1] + W[8] * t[2], y = W[1] * t[0] + W[5] * t[1] + W[9] * t[2], z = W[2] * t[0] + W[6] * t[1] + W[10] * t[2], l = Math.hypot(x, y, z) || 1;
          A[i * comps] = x / l; A[i * comps + 1] = y / l; A[i * comps + 2] = z / l; if (comps === 4) A[i * comps + 3] = t[3];
        }
        acc.setArray(A);
      }
      out.push({ node: n, prim: p });
    }
  }
  for (const n of root.listNodes()) { n.setTranslation([0, 0, 0]); n.setRotation([0, 0, 0, 1]); n.setScale([1, 1, 1]); }
  for (const { node } of out) { node.getParentNode()?.removeChild(node); scene.addChild(node); }
  for (const n of root.listNodes()) if (!n.getMesh() && !n.listChildren().length) n.dispose();
  return out;
}

/** compact copy of a primitive restricted to the triangles for which keep(i0,i1,i2) is true (own vertex set), or null when empty */
export function subPrim(doc, prim, keep) {
  const idx = prim.getIndices(), cnt = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount(), tri = k => (idx ? idx.getScalar(k) : k);
  const map = new Map(), ids = [];
  for (let i = 0; i < cnt; i += 3) {
    const a = tri(i), b = tri(i + 1), c = tri(i + 2); if (!keep(a, b, c)) continue;
    for (const k of [a, b, c]) { if (!map.has(k)) map.set(k, map.size); ids.push(map.get(k)); }
  }
  if (!ids.length) return null;
  const np = doc.createPrimitive().setMaterial(prim.getMaterial());
  for (const sem of prim.listSemantics()) {
    const src = prim.getAttribute(sem), es = src.getElementSize(), A = new (src.getArray().constructor)(map.size * es), t = new Array(es);
    for (const [old, nw] of map) { src.getElement(old, t); for (let c = 0; c < es; c++) A[nw * es + c] = t[c]; }
    np.setAttribute(sem, doc.createAccessor().setType(src.getType()).setArray(A).setNormalized(src.getNormalized()));
  }
  np.setIndices(doc.createAccessor().setType('SCALAR').setArray(map.size > 65535 ? new Uint32Array(ids) : new Uint16Array(ids)));
  return np;
}

export async function finish(doc, io, out, { texMax = 1024, quality = 82, posBits = 14 } = {}) {
  await doc.transform(
    prune({ keepAttributes: true }), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texMax, texMax], quality }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(POSITION|NORMAL|TANGENT)$/, quantizePosition: posBits, quantizeNormal: 10 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(out, doc);
}
