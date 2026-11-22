// Shared helpers for the props plug-in: seeded rng, geometry builder, distance-LOD instancing.
import * as THREE from 'three';

export const mkRng = seed => { let s = (seed | 0) ^ 0x1234567; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Minimal non-indexed-ish geometry accumulator with per-vertex colour (linear RGB). */
export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  v(p, n, uv = [0, 0], c = [1, 1, 1]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); return this.n++; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  /** flat-shaded quad from 4 corners (counter-clockwise seen from outside) */
  fquad(p0, p1, p2, p3, col = [1, 1, 1], uvs) {
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    const t = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    const i0 = this.v(p0, n, t[0], col), i1 = this.v(p1, n, t[1], col), i2 = this.v(p2, n, t[2], col), i3 = this.v(p3, n, t[3], col);
    this.quad(i0, i1, i2, i3); return this;
  }
  /** axis-aligned box centred at (cx,cy,cz) with half sizes; colour per call */
  box(cx, cy, cz, hx, hy, hz, col = [1, 1, 1]) {
    const X0 = cx - hx, X1 = cx + hx, Y0 = cy - hy, Y1 = cy + hy, Z0 = cz - hz, Z1 = cz + hz;
    this.fquad([X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], col); // +z
    this.fquad([X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0], col); // -z
    this.fquad([X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], col); // +x
    this.fquad([X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], col); // -x
    this.fquad([X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0], col); // +y
    this.fquad([X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], col); // -y
    return this;
  }
  /** tapered cylinder from p0 (radius r0) to p1 (radius r1), smooth normals */
  tube(p0, p1, r0, r1, seg = 6, col = [1, 1, 1], col1 = null, cap = false) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d) || 1, a = [d[0] / L, d[1] / L, d[2] / L];
    let up = Math.abs(a[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    let u = [a[1] * up[2] - a[2] * up[1], a[2] * up[0] - a[0] * up[2], a[0] * up[1] - a[1] * up[0]]; const ul = Math.hypot(...u); u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const w = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
    const base = this.n, c1 = col1 ?? col;
    for (let k = 0; k <= seg; k++) {
      const th = k / seg * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), nrm = [u[0] * cs + w[0] * sn, u[1] * cs + w[1] * sn, u[2] * cs + w[2] * sn];
      const slope = (r0 - r1) / L, nn = [nrm[0] + a[0] * slope, nrm[1] + a[1] * slope, nrm[2] + a[2] * slope], nl = Math.hypot(...nn);
      const n2 = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
      this.v([p0[0] + nrm[0] * r0, p0[1] + nrm[1] * r0, p0[2] + nrm[2] * r0], n2, [k / seg, 0], col);
      this.v([p1[0] + nrm[0] * r1, p1[1] + nrm[1] * r1, p1[2] + nrm[2] * r1], n2, [k / seg, 1], c1);
    }
    for (let k = 0; k < seg; k++) { const i = base + k * 2; this.idx.push(i, i + 3, i + 1, i, i + 2, i + 3); }
    if (cap) { for (const [p, r, s] of [[p1, r1, 1], [p0, r0, -1]]) { const c = this.v(p, [a[0] * s, a[1] * s, a[2] * s], [0.5, 0.5], s > 0 ? c1 : col); const ring = []; for (let k = 0; k < seg; k++) { const th = k / seg * Math.PI * 2; ring.push(this.v([p[0] + (u[0] * Math.cos(th) + w[0] * Math.sin(th)) * r, p[1] + (u[1] * Math.cos(th) + w[1] * Math.sin(th)) * r, p[2] + (u[2] * Math.cos(th) + w[2] * Math.sin(th)) * r], [a[0] * s, a[1] * s, a[2] * s], [0.5, 0.5], s > 0 ? c1 : col)); } for (let k = 0; k < seg; k++) { const A = ring[k], B = ring[(k + 1) % seg]; if (s > 0) this.tri(c, A, B); else this.tri(c, B, A); } } }
    return this;
  }
  /** cylinder along Y (centre cx,cy,cz) */
  cyl(cx, cy, cz, r, h, seg = 8, col = [1, 1, 1]) { return this.tube([cx, cy - h / 2, cz], [cx, cy + h / 2, cz], r, r, seg, col, null, true); }
  /** append another builder's geometry transformed by a Matrix4 */
  addGeo(b, m, colMul) {
    const base = this.n, p = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m), nn = new THREE.Vector3();
    for (let i = 0; i < b.n; i++) {
      p.set(b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]).applyMatrix4(m); nn.set(b.nor[i * 3], b.nor[i * 3 + 1], b.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
      const c = [b.col[i * 3], b.col[i * 3 + 1], b.col[i * 3 + 2]]; if (colMul) { c[0] *= colMul[0]; c[1] *= colMul[1]; c[2] *= colMul[2]; }
      this.v([p.x, p.y, p.z], [nn.x, nn.y, nn.z], [b.uv[i * 2], b.uv[i * 2 + 1]], c);
    }
    for (const i of b.idx) this.idx.push(base + i);
    return this;
  }
  build({ colors = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); return g;
  }
}

/**
 * Distance-LOD instancing: every item has a precomputed matrix; each update() the items in range are written into
 * the instance buffers of the InstancedMeshes of their LOD level (levels[i] = { dist, meshes:[...] }).
 * itemColors: optional Map(mesh -> Float32Array(n*3)) of per-item instance colours.
 */
export class LodGroup {
  constructor(n, matrices, levels, itemColors = new Map(), extras = []) {
    this.extras = extras;
    this.n = n; this.m = matrices; this.levels = levels; this.itemColors = itemColors; this.px = new Float32Array(n); this.pz = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = matrices[i * 16 + 12]; this.pz[i] = matrices[i * 16 + 14]; }
    this.maxDist = levels[levels.length - 1].dist; this.last = new THREE.Vector3(1e9, 0, 0); this.lvl = new Int8Array(n);
    this.counts = levels.map(() => 0);
    for (const lv of levels) for (const mesh of lv.meshes) { mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; }
  }
  update(cam, force = false) {
    if (!force && this.last.distanceToSquared(cam) < 9) return;
    this.last.copy(cam);
    const { n, m, levels, px, pz } = this, nl = levels.length, d2 = levels.map(l => l.dist * l.dist), cnt = new Array(nl).fill(0), cx = cam.x, cz = cam.z, cy = cam.y;
    const cap = levels[0].meshes[0].instanceMatrix.count;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - cx, dz = pz[i] - cz, dd = dx * dx + dz * dz + cy * cy * 0.25;
      let l = 0; while (l < nl && dd > d2[l]) l++;
      if (l >= nl) continue;
      const k = cnt[l]++;
      for (const mesh of levels[l].meshes) {
        const a = mesh.instanceMatrix.array, o = k * 16, s = i * 16; for (let q = 0; q < 16; q++) a[o + q] = m[s + q];
        for (const e of this.extras) if (e.mesh === mesh) { const ea = e.attr.array, sz = e.size; for (let q = 0; q < sz; q++) ea[k * sz + q] = e.data[i * sz + q]; }
        const ic = this.itemColors.get(mesh); if (ic) { const ca = mesh.instanceColor.array; ca[k * 3] = ic[i * 3]; ca[k * 3 + 1] = ic[i * 3 + 1]; ca[k * 3 + 2] = ic[i * 3 + 2]; }
      }
    }
    for (let l = 0; l < nl; l++) for (const mesh of levels[l].meshes) { mesh.count = cnt[l]; mesh.visible = cnt[l] > 0; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; for (const e of this.extras) if (e.mesh === mesh) e.attr.needsUpdate = true; }
    this.counts = cnt;
  }
}

/** Make an InstancedMesh with capacity n and (optionally) an instance colour buffer. */
export function instanced(geo, mat, n, withColor = false) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (withColor) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
  m.frustumCulled = false; m.count = n; return m;
}

const _o = new THREE.Object3D();
/** compose an Object3D-style matrix into a Float32Array slot */
export function composeInto(arr, i, x, y, z, yaw, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
  // never emit zero / NaN scale: the instanced normal matrix divides by |column|^2 (NaN pixels -> black bloom frame)
  const g = v => (Number.isFinite(v) && Math.abs(v) > 0.02 ? v : 0.02);
  sx = g(sx); sy = g(sy); sz = g(sz); if (!Number.isFinite(x + y + z + yaw + pitch + roll)) { x = y = z = 0; yaw = pitch = roll = 0; }
  _o.position.set(x, y, z); _o.rotation.set(pitch, yaw, roll, 'YXZ'); _o.scale.set(sx, sy, sz); _o.updateMatrix(); _o.matrix.toArray(arr, i * 16);
}

// ====================================================================================================================
// Spatial culling: instances grouped into ~128 m cells; only cells in range / in view are written to the GPU buffers.
// ====================================================================================================================
export const hash1 = n => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

/** shared camera view state (updated once per frame by props.js) */
export const view = {
  pos: new THREE.Vector3(1e9, 0, 0), dir: new THREE.Vector3(0, 0, -1), frustum: new THREE.Frustum(), _m: new THREE.Matrix4(), stamp: 0,
  set(camera) {
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._m);
    camera.getWorldPosition(this.pos); camera.getWorldDirection(this.dir); this.stamp++;
  },
};

/** registry of every mesh the plugin owns, for window.__props.stats() */
export const registry = [];
export function track(obj) { registry.push(obj); return obj; }
export function statsOf() {
  let calls = 0, tris = 0, inst = 0;
  for (const o of registry) {
    if (!o.visible) continue; let p = o.parent, vis = true; while (p) { if (!p.visible) { vis = false; break; } p = p.parent; } if (!vis) continue;
    const g = o.geometry; if (!g) continue; const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (o.isInstancedMesh) { if (o.count > 0) { calls++; tris += per * o.count; inst += o.count; } } else if (o.isLineSegments) { calls++; } else { calls++; tris += per; }
  }
  return { drawCalls: calls, triangles: Math.round(tris), instances: inst };
}

/**
 * CellFamily: items (matrices Float32Array n*16) are bucketed into square cells. update() walks only the cells in range/in view and
 * writes the surviving items into the InstancedMesh buffers of the right LOD level.
 *  levels: [{ dist, meshes }]  ascending max distance (scaled by `scale`, usually quality.lodScale). meshes of one level share the item set.
 *  itemColors: Map(mesh -> Float32Array(n*3)); extras: [{ mesh, attr, data, size }] per-instance attributes.
 *  radius: item bounding radius (frustum test), mid: height of the bounding sphere centre above the item origin.
 *  keep(i): optional static filter (quality thinning).
 */
export class CellFamily {
  constructor({ n, m, levels, itemColors = new Map(), extras = [], radius = 2, mid = 1, cell = 128, keep = null, scale = 1, minMove = 2.5, radii = null, name = '' }) {
    this.n = n; this.m = m; this.levels = levels; this.itemColors = itemColors; this.extras = extras; this.radius = radius; this.radii = radii; this.mid = mid; this.scale = scale; this.minMove = minMove; this.name = name;
    this.d2 = levels.map(l => l.dist * l.dist * scale * scale); this.maxDist = levels[levels.length - 1].dist * scale;
    const map = new Map();
    for (let i = 0; i < n; i++) {
      if (keep && !keep(i)) continue;
      const x = m[i * 16 + 12], z = m[i * 16 + 14]; if (!Number.isFinite(x + z)) continue;
      // degenerate instances (zero scale -> w = 0, or an absurd 60 m+ axis from a bad data point at the origin) rasterise as long streaks fanning out from one point: drop them
      { let bad = false; for (let q = 0; q < 3; q++) { const l = Math.hypot(m[i * 16 + q * 4], m[i * 16 + q * 4 + 1], m[i * 16 + q * 4 + 2]); if (!(l > 1e-4 && l < 60)) bad = true; } if (bad) continue; }
      const k = Math.floor(x / cell) * 4096 + Math.floor(z / cell); let c = map.get(k); if (!c) map.set(k, c = { items: [], x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 });
      c.items.push(i); c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.z0 = Math.min(c.z0, z); c.z1 = Math.max(c.z1, z); const y = m[i * 16 + 13]; c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
    }
    const R = radius;
    this.cells = [...map.values()].map(c => { const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2, cy = (c.y0 + c.y1) / 2 + mid; return { items: Int32Array.from(c.items), cx, cy, cz, r: Math.hypot((c.x1 - c.x0) / 2, (c.z1 - c.z0) / 2, (c.y1 - c.y0) / 2 + mid) + R }; });
    this.counts = levels.map(() => 0); this.lastPos = new THREE.Vector3(1e9, 0, 0); this.lastDir = new THREE.Vector3(0, 0, 1); this.kept = this.cells.reduce((s, c) => s + c.items.length, 0);
    for (const lv of levels) for (const mesh of lv.meshes) { mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; }
  }
  /** returns true when the buffers were rewritten */
  update(force = false) {
    const cam = view.pos, dir = view.dir;
    if (!force && this.lastPos.distanceToSquared(cam) < this.minMove * this.minMove && this.lastDir.dot(dir) > 0.9993) return false;
    this.lastPos.copy(cam); this.lastDir.copy(dir);
    const { levels, m, d2, radius, mid, itemColors, extras, cells } = this, nl = levels.length, cnt = new Int32Array(nl), planes = view.frustum.planes, cx = cam.x, cy = cam.y, cz = cam.z, maxD = this.maxDist;
    const useF = view.stamp > 0 && !force;
    const cap = levels.map(lv => lv.meshes.map(mesh => ({ mesh, a: mesh.instanceMatrix.array, ic: itemColors.get(mesh), ca: itemColors.get(mesh) ? mesh.instanceColor.array : null, ex: extras.filter(e => e.mesh === mesh) })));
    for (const c of cells) {
      const dx = c.cx - cx, dy = c.cy - cy, dz = c.cz - cz, dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dd - c.r > maxD) continue;
      if (useF && dd > c.r) { let out = false; for (let q = 0; q < 6; q++) { const pl = planes[q]; if (pl.normal.x * c.cx + pl.normal.y * c.cy + pl.normal.z * c.cz + pl.constant < -(c.r + dd * 0.06)) { out = true; break; } } if (out) continue; }
      const items = c.items;
      for (let t = 0; t < items.length; t++) {
        const i = items[t], s = i * 16, x = m[s + 12], y = m[s + 13], z = m[s + 14], ix = x - cx, iy = y + mid - cy, iz = z - cz, q2 = ix * ix + iy * iy + iz * iz;
        let l = 0; while (l < nl && q2 > d2[l]) l++; if (l >= nl) continue;
        if (useF) { const r = (this.radii ? this.radii[i] : radius) + Math.sqrt(q2) * 0.06; let out = false; for (let q = 0; q < 6; q++) { const pl = planes[q]; if (pl.normal.x * x + pl.normal.y * (y + mid) + pl.normal.z * z + pl.constant < -r) { out = true; break; } } if (out) continue; }
        const k = cnt[l]++;
        for (const e of cap[l]) {
          const o = k * 16, a = e.a; for (let q = 0; q < 16; q++) a[o + q] = m[s + q];
          if (e.ca) { e.ca[k * 3] = e.ic[i * 3]; e.ca[k * 3 + 1] = e.ic[i * 3 + 1]; e.ca[k * 3 + 2] = e.ic[i * 3 + 2]; }
          for (const x2 of e.ex) { const sz = x2.size, ea = x2.attr.array; for (let q = 0; q < sz; q++) ea[k * sz + q] = x2.data[i * sz + q]; }
        }
      }
    }
    for (let l = 0; l < nl; l++) for (const e of cap[l]) {
      const k = cnt[l], mesh = e.mesh; mesh.count = k; mesh.visible = k > 0;     // empty LOD levels cost a full program/uniform setup + an empty draw in every pass
      const up = a => { a.clearUpdateRanges(); if (k > 0) a.addUpdateRange(0, k * a.itemSize); a.needsUpdate = true; };
      up(mesh.instanceMatrix); if (e.ca) up(mesh.instanceColor); for (const x2 of e.ex) up(x2.attr);
    }
    this.counts = Array.from(cnt); return true;
  }
}

/** simple sRGB hex -> linear array (for vertex colours) */
const _c = new THREE.Color();
export const lin = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; }; // Color.set converts sRGB hex to linear working space
export const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Create a canvas (and 2d context) */
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function canvasTex(c, { srgb = true, repeat = false, aniso = 4, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
