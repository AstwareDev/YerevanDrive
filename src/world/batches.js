// Cross-tile draw-call batching for the streamed world.
// Every streamed tile used to add one Mesh per material (asphalt, facade, roof, ...), so ~30 visible tiles x ~12 materials meant several
// hundred draw calls per pass (scene + shadow map), each with a full program/uniform setup: the game was CPU-bound on the render loop,
// not on the GPU. Here all tile meshes that share a material (and attribute layout) live in ONE THREE.BatchedMesh: a tile's geometry is
// copied into the batch once, shown/hidden per instance, and the whole material renders with a single multi-draw call per pass
// (per-instance frustum culling and front-to-back sorting are done inside BatchedMesh, also for the shadow camera).
// Slots of evicted tiles are recycled (best fit) so streaming does not fragment the buffers; batches grow geometrically when full.
import * as THREE from 'three';

const BATCH_DEPTH = new THREE.MeshDepthMaterial();
// average vertices per L0 tile of the heavy materials (measured on the baked tiles) and how many L0 tiles a preset keeps around: the buffers start at
// that size, so streaming the first minute does not re-allocate them 6-8 times each (every re-allocation = a copy + a full GPU re-upload = a frame freeze)
const HEAVY = { asphalt: 15000, pavement: 13000, trim: 20000, curb: 2700, terrain: 2700, wall: 2500, grass: 900, roof: 800, far_building: 14000, far_terrain: 4000, far_road: 2500 };
const EXPECT = { low: 22, med: 36, high: 44, ultra: 64 };
const sig = g => Object.keys(g.attributes).sort().map(k => { const a = g.attributes[k]; return `${k}${a.itemSize}${a.normalized ? 'n' : ''}${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name[0]}`; }).join('.') + (g.index ? '+i' : '');

export class TileBatches {
  constructor(scene, level = 'high') {
    this.expect = EXPECT[level] ?? 44; this.scene = scene; this.batches = new Map(); this.stats = { batches: 0, slots: 0, grows: 0, compactions: 0 };
  }
  /** batch for (material, shadow flags, attribute layout); created on first use */
  get(material, geo, castShadow, receiveShadow, renderOrder, name = '') {
    const key = `${material.uuid}|${castShadow ? 1 : 0}${receiveShadow ? 1 : 0}|${renderOrder}|${sig(geo)}`;
    let b = this.batches.get(key);
    if (!b) {
      const est = (HEAVY[name] ?? 0) * this.expect;
      const v = Math.max(65536, geo.attributes.position.count * 6, est), i = Math.max(196608, (geo.index?.count ?? 0) * 6, est * 1.6);
      const mesh = new THREE.BatchedMesh(256, v, i, material);
      mesh.name = 'batch_' + (material.name || 'mat'); mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow; mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;                   // whole-batch bounds change as tiles stream; BatchedMesh still culls per instance
      mesh.perObjectFrustumCulled = true; mesh.sortObjects = !material.transparent;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      // own shadow-depth material: three's shared depth material would otherwise flip between the batched and the plain program
      // for every batch/mesh alternation in the shadow pass (a full getParameters()/getProgram() each time)
      if (!material.alphaTest) mesh.customDepthMaterial = BATCH_DEPTH;
      b = { key, mesh, free: [], used: 0, wasted: 0, instances: 0 };
      this.batches.set(key, b); this.scene.add(mesh); this.stats.batches++;
    }
    return b;
  }
  /** copy `geo` (with world matrix `matrix`) into the matching batch; returns a handle for show/hide/release */
  add(material, geo, matrix, { castShadow, receiveShadow, renderOrder = 0, name = '' }) {
    const b = this.get(material, geo, castShadow, receiveShadow, renderOrder, name), m = b.mesh;
    const nv = geo.attributes.position.count, ni = geo.index?.count ?? 0;
    // best-fit recycled slot (same tile reloaded -> exact fit); never waste more than 60 % of a slot
    let best = -1, bestW = Infinity;
    for (let k = 0; k < b.free.length; k++) { const s = b.free[k]; if (s.nv >= nv && s.ni >= ni && s.nv <= nv * 1.6 + 64) { const w = s.nv - nv + (s.ni - ni) * 0.25; if (w < bestW) { bestW = w; best = k; } } }
    let slot;
    if (best >= 0) { slot = b.free.splice(best, 1)[0]; b.wasted -= slot.nv; m.setGeometryAt(slot.geom, geo); }
    else {
      this.ensure(b, nv, ni);
      slot = { geom: m.addGeometry(geo), nv, ni, inst: -1 };
    }
    if (m.instanceCount >= m.maxInstanceCount - 1) m.setInstanceCount(Math.ceil(m.maxInstanceCount * 1.5) + 16);
    slot.inst = m.addInstance(slot.geom); m.setMatrixAt(slot.inst, matrix); m.setVisibleAt(slot.inst, false);
    b.used += nv; b.instances++; this.stats.slots++;
    return { b, slot };
  }
  setVisible(h, v) { h.b.mesh.setVisibleAt(h.slot.inst, v); }
  release(h) {
    const { b, slot } = h; b.mesh.deleteInstance(slot.inst); slot.inst = -1; b.free.push(slot); b.wasted += slot.nv; b.instances--; this.stats.slots--;
  }
  /** make room for nv vertices / ni indices at the end of the buffers: compact if a lot is free, otherwise grow 1.5x */
  ensure(b, nv, ni) {
    const m = b.mesh, fits = () => m.unusedVertexCount >= nv && m.unusedIndexCount >= ni;
    if (fits()) return;
    if (b.free.length && b.wasted > 0.3 * (m._maxVertexCount - m.unusedVertexCount)) {   // compaction: drop recycled slots, BatchedMesh.optimize() packs the rest
      const t0 = performance.now(); for (const s of b.free) m.deleteGeometry(s.geom); b.free.length = 0; b.wasted = 0; m.optimize(); this.stats.compactions++; this.stats.compactMs = (this.stats.compactMs ?? 0) + performance.now() - t0;
      if (fits()) return;
    }
    const usedV = m._maxVertexCount - m.unusedVertexCount, usedI = m._maxIndexCount - m.unusedIndexCount;
    const t0 = performance.now();
    m.setGeometrySize(Math.ceil(Math.max(m._maxVertexCount * 2, usedV + nv * 2)), Math.ceil(Math.max(m._maxIndexCount * 2, usedI + ni * 2)));
    this.stats.grows++; this.stats.growMs = (this.stats.growMs ?? 0) + performance.now() - t0; this.stats.lastGrow = b.mesh.name;
  }
}
