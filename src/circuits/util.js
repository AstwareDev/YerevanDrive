// Shared helpers for the drift-circuit dressing: RNG, track frame lookup, cell-grouped batches (instanced + merged) that are
// distance/frustum culled per ~128 m cell, geometry builder, canvas helpers.
import * as THREE from 'three';

export const CELL = 128;
export const mkRng = seed => { let s = (seed | 0) ^ 0x9e3779b9; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mod = (a, n) => ((a % n) + n) % n;
const _c = new THREE.Color();
/** sRGB hex string / number -> linear [r,g,b] (for vertex / instance colours) */
export const lin = c => { _c.set(c); _c.convertSRGBToLinear(); return [_c.r, _c.g, _c.b]; };
export const cellId = (x, z) => (Math.floor(x / CELL) + 512) * 1024 + (Math.floor(z / CELL) + 512);

// ------------------------------------------------------------------ track: random access along the closed centreline
export class Track {
  constructor(c, H) {
    this.c = c; this.id = c.id; this.name = c.name; this.H = H;
    const n = this.n = c.points.length / 3;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = c.points[i * 3]; this.y[i] = c.points[i * 3 + 1]; this.z[i] = c.points[i * 3 + 2]; }
    this.w = Float32Array.from(c.widths); this.kap = Float32Array.from(c.curvature);
    this.clr = [Uint8Array.from(c.clearance.left), Uint8Array.from(c.clearance.right)];
    this.tx = new Float32Array(n); this.tz = new Float32Array(n); this.s = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const a = (i + n - 2) % n, b = (i + 2) % n; let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a]; const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      this.s[i + 1] = this.s[i] + Math.hypot(this.x[(i + 1) % n] - this.x[i], this.z[(i + 1) % n] - this.z[i]);
    }
    this.L = this.s[n]; this.ds = this.L / n;
  }
  /** frame at (fractional) index i: position, forward t, right normal r, width w, terrain/road y. lat = lateral offset (+ right). */
  at(i, lat = 0, out = {}) {
    const n = this.n; i = mod(i, n); const i0 = Math.floor(i) % n, i1 = (i0 + 1) % n, f = i - Math.floor(i);
    let tx = lerp(this.tx[i0], this.tx[i1], f), tz = lerp(this.tz[i0], this.tz[i1], f); const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const x = lerp(this.x[i0], this.x[i1], f), z = lerp(this.z[i0], this.z[i1], f);
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx; out.w = lerp(this.w[i0], this.w[i1], f); out.hw = out.w / 2; out.i = i;
    out.cx = x; out.cz = z; out.x = x + out.rx * lat; out.z = z + out.rz * lat; out.yaw = Math.atan2(tx, tz); out.y = this.H(out.x, out.z);
    return out;
  }
  /** clearance (m of free space beyond the road edge before a building) on side sg (+1 right, -1 left) */
  clear(i, sg) { return this.clr[sg > 0 ? 1 : 0][mod(Math.round(i), this.n)]; }
  /** distance along track (m) -> index */
  idxOfS(sm) { return mod(sm, this.L) / this.ds; }
  /** signed index difference a -> b on the loop in (-n/2, n/2] */
  dIdx(a, b) { let d = mod(b - a, this.n); if (d > this.n / 2) d -= this.n; return d; }
  /** nearest centreline index to a world point (brute force, optional hint window) */
  nearest(x, z) { let bi = 0, bd = 1e18; for (let i = 0; i < this.n; i++) { const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
}

// ------------------------------------------------------------------ canvas helpers
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function canvasTexture(c, { srgb = true, repeat = null, aniso = 4, wrap = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso; t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
export function noiseFill(g, w, h, amount, rng, alpha = 1) { // sprinkle grain over an existing canvas
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rng() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
}

// ------------------------------------------------------------------ geometry builder (merged static geometry, triangles bucketed by cell)
export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.cells = new Map(); this.cell = null; this.tint = [1, 1, 1]; }
  /** force all following triangles into the cell containing (x, z) (so a structure is culled as a whole) */
  at(x, z) { this.cell = cellId(x, z); return this; }
  free() { this.cell = null; return this; }
  vert(x, y, z, nx, ny, nz, u = 0, v = 0, c = this.tint) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c[0], c[1], c[2]); return this.pos.length / 3 - 1; }
  tri(a, b, c) {
    let key = this.cell;
    if (key == null) { const p = this.pos; key = cellId((p[a * 3] + p[b * 3] + p[c * 3]) / 3, (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3); }
    let l = this.cells.get(key); if (!l) this.cells.set(key, l = []); l.push(a, b, c);
  }
  quadI(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** planar quad from 4 corner points (CCW seen from the front), explicit normal, uv rect [u0,v0,u1,v1] (v0 at p0/p1 edge) */
  quad(p0, p1, p2, p3, uv = [0, 0, 1, 1], c = this.tint, n = null) {
    if (!n) { const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2]; n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; const l = Math.hypot(...n) || 1; n = [n[0] / l, n[1] / l, n[2] / l]; }
    const a = this.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv[0], uv[1], c), b = this.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv[2], uv[1], c),
      cc = this.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], uv[2], uv[3], c), d = this.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], uv[0], uv[3], c);
    this.quadI(a, b, cc, d);
  }
  /** oriented box: centre (cx,cy,cz), size (sx,sy,sz) in local axes (x right, y up, z forward), yaw about Y; uv rect applies to every face */
  box(cx, cy, cz, sx, sy, sz, yaw = 0, c = this.tint, uv = [0, 0, 1, 1], faces = 0b111111) {
    const co = Math.cos(yaw), si = Math.sin(yaw), hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const P = (x, y, z) => [cx + x * co + z * si, cy + y, cz - x * si + z * co], N = (x, y, z) => [x * co + z * si, y, -x * si + z * co];
    const f = (bit, p0, p1, p2, p3, n) => { if (faces & bit) this.quad(p0, p1, p2, p3, uv, c, N(...n)); };
    f(1, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 0, 1]);      // +z
    f(2, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), [0, 0, -1]);  // -z
    f(4, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), [1, 0, 0]);       // +x
    f(8, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), [-1, 0, 0]);  // -x
    f(16, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 1, 0]);      // +y
    f(32, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, -1, 0]); // -y
  }
  /** vertical (or tilted) cylinder from p0 to p1, n sides, radii r0 -> r1 */
  cyl(p0, p1, r0, r1 = r0, n = 8, c = this.tint, cap = true) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], l = Math.hypot(dx, dy, dz) || 1, ax = [dx / l, dy / l, dz / l];
    let u = Math.abs(ax[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]; const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let e1 = cr(ax, u); const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1); const e2 = cr(ax, e1);
    const ring = (p, r, k) => { const a = k / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); const nx = e1[0] * ca + e2[0] * sa, ny = e1[1] * ca + e2[1] * sa, nz = e1[2] * ca + e2[2] * sa; return [[p[0] + nx * r, p[1] + ny * r, p[2] + nz * r], [nx, ny, nz]]; };
    const a0 = [], a1 = [];
    for (let k = 0; k <= n; k++) { const [q0, nn] = ring(p0, r0, k), [q1] = ring(p1, r1, k); a0.push(this.vert(q0[0], q0[1], q0[2], nn[0], nn[1], nn[2], k / n, 0, c)); a1.push(this.vert(q1[0], q1[1], q1[2], nn[0], nn[1], nn[2], k / n, 1, c)); }
    for (let k = 0; k < n; k++) this.quadI(a0[k + 1], a0[k], a1[k], a1[k + 1]);
    if (cap) { const t = this.vert(p1[0], p1[1], p1[2], ax[0], ax[1], ax[2], 0.5, 0.5, c); const ids = []; for (let k = 0; k <= n; k++) { const [q] = ring(p1, r1, k); ids.push(this.vert(q[0], q[1], q[2], ax[0], ax[1], ax[2], 0, 0, c)); } for (let k = 0; k < n; k++) this.tri(t, ids[k], ids[k + 1]); }
  }
  get count() { return this.pos.length / 3; }
}

// ------------------------------------------------------------------ frustum / camera culling context shared by all batches
export class View {
  constructor() { this.frustum = new THREE.Frustum(); this.m = new THREE.Matrix4(); this.cam = new THREE.Vector3(); this.box = new THREE.Box3(); this.frame = 0; }
  update(camera) { camera.updateMatrixWorld(); this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.m); this.cam.setFromMatrixPosition(camera.matrixWorld); this.frame++; }
  /** horizontal distance from the camera to a cell's xz rectangle and frustum visibility of its AABB (margin m) */
  cellVisible(c, radius, margin = 3) {
    const dx = Math.max(c.x0 - this.cam.x, 0, this.cam.x - c.x1), dz = Math.max(c.z0 - this.cam.z, 0, this.cam.z - c.z1);
    if (dx * dx + dz * dz > radius * radius) return false;
    if (dx * dx + dz * dz < 25 * 25) return true;
    this.box.min.set(c.x0 - margin, c.y0 - margin, c.z0 - margin); this.box.max.set(c.x1 + margin, c.y1 + margin, c.z1 + margin);
    return this.frustum.intersectsBox(this.box);
  }
}

// ------------------------------------------------------------------ InstBatch: instanced meshes (optionally several LODs), instances bucketed by cell, repacked on change
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export class InstBatch {
  /** levels: [{ geometry, dist }] ascending dist (m, horizontal); last dist is the cull distance */
  constructor(name, levels, material, { color = false, shadow = false, radiusScale = 1 } = {}) {
    this.name = name; this.levels = levels; this.material = material; this.useColor = color; this.shadow = shadow; this.radiusScale = radiusScale;
    this.mats = []; this.cols = []; this.px = []; this.pz = []; this.cellOf = []; this.mask = []; this.farSy = []; this.meshes = []; this.n = 0; this.lastKey = ''; this.lastCam = new THREE.Vector3(1e9, 0, 1e9); this.visible = 0; this.tris = 0;
  }
  /** add with yaw rotation only (fast path) */
  /** mask: bit l set = instance is drawn at LOD level l (default all). farSy: extra y-scale applied when drawn at a level flagged `far` (stack proxy) */
  add(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, col = null, mask = 255, farSy = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw); this.mask.push(mask); this.farSy.push(farSy);
    this.mats.push(sx * c, 0, -sx * s, 0, 0, sy, 0, 0, sz * s, 0, sz * c, 0, x, y, z, 1);
    if (this.useColor) this.cols.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
    this.px.push(x); this.pz.push(z); this.cellOf.push(cellId(x, z)); this.n++;
  }
  /** add with yaw / pitch (around local X) / roll (around local Z) in YXZ order */
  addRot(x, y, z, yaw, pitch, roll, sx = 1, sy = 1, sz = 1, col = null, mask = 255, farSy = 1) {
    this.mask.push(mask); this.farSy.push(farSy);
    _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s);
    for (let i = 0; i < 16; i++) this.mats.push(_m.elements[i]);
    if (this.useColor) this.cols.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
    this.px.push(x); this.pz.push(z); this.cellOf.push(cellId(x, z)); this.n++;
  }
  finalize(scene, { castShadow = false, renderOrder = 0 } = {}) {
    const n = this.n, order = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.cellOf[a] - this.cellOf[b]);
    this.M = new Float32Array(n * 16); this.C = this.useColor ? new Float32Array(n * 3) : null; this.P = new Float32Array(n * 2); this.K = new Uint8Array(n); this.F = new Float32Array(n);
    this.cells = []; let cur = null;
    order.forEach((src, k) => {
      this.M.set(this.mats.slice(src * 16, src * 16 + 16), k * 16); if (this.C) this.C.set(this.cols.slice(src * 3, src * 3 + 3), k * 3);
      this.P[k * 2] = this.px[src]; this.P[k * 2 + 1] = this.pz[src]; this.K[k] = this.mask[src]; this.F[k] = this.farSy[src];
      if (!cur || cur.id !== this.cellOf[src]) { cur = { id: this.cellOf[src], start: k, count: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }; this.cells.push(cur); }
      cur.count++; const x = this.px[src], z = this.pz[src], y = this.mats[src * 16 + 13]; cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x); cur.z0 = Math.min(cur.z0, z); cur.z1 = Math.max(cur.z1, z); cur.y0 = Math.min(cur.y0, y); cur.y1 = Math.max(cur.y1, y + 3);
    });
    this.mats = this.cols = this.px = this.pz = this.cellOf = this.mask = this.farSy = null;
    for (const lv of this.levels) {
      const m = new THREE.InstancedMesh(lv.geometry, this.material, Math.max(1, n)); m.count = 0; m.frustumCulled = false; m.matrixAutoUpdate = false; m.castShadow = castShadow; m.receiveShadow = true; m.renderOrder = renderOrder; m.name = this.name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.useColor) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      m.visible = false; scene.add(m); this.meshes.push(m); lv.tris = lv.geometry.index ? lv.geometry.index.count / 3 : lv.geometry.attributes.position.count / 3;
    }
    this.maxDist = this.levels[this.levels.length - 1].dist;
    return this;
  }
  update(view, radius, force = false) {
    const R = Math.min(this.maxDist, radius) * this.radiusScale, vis = [];
    let key = '';
    for (let i = 0; i < this.cells.length; i++) if (view.cellVisible(this.cells[i], R + 4)) { vis.push(i); key += i + ','; }
    const moved = view.cam.distanceToSquared(this.lastCam) > 25;
    if (!force && key === this.lastKey && !moved) return;
    this.lastKey = key; this.lastCam.copy(view.cam);
    const cnt = this.levels.map(() => 0), cx = view.cam.x, cz = view.cam.z, d2s = this.levels.map(l => (Math.min(l.dist, R)) ** 2);
    const L = this.levels.length;
    for (const ci of vis) {
      const c = this.cells[ci];
      for (let k = c.start; k < c.start + c.count; k++) {
        const dx = this.P[k * 2] - cx, dz = this.P[k * 2 + 1] - cz, d2 = dx * dx + dz * dz; let l = 0;
        while (l < L && d2 > d2s[l]) l++;
        if (l >= L || !(this.K[k] & (1 << l))) continue;
        const mesh = this.meshes[l], j = cnt[l]++, arr = mesh.instanceMatrix.array;
        arr.set(this.M.subarray(k * 16, k * 16 + 16), j * 16);
        if (this.levels[l].far) { const fy = this.F[k], o = j * 16; arr[o + 4] *= fy; arr[o + 5] *= fy; arr[o + 6] *= fy; }
        if (this.C) mesh.instanceColor.array.set(this.C.subarray(k * 3, k * 3 + 3), j * 3);
      }
    }
    let tris = 0, vis2 = 0;
    this.meshes.forEach((m, l) => {
      m.count = cnt[l]; m.visible = cnt[l] > 0; vis2 += cnt[l]; tris += cnt[l] * this.levels[l].tris;
      if (cnt[l]) {
        m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, cnt[l] * 16); m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) { m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, cnt[l] * 3); m.instanceColor.needsUpdate = true; }
      }
    });
    this.visible = vis2; this.tris = tris;
  }
  setShadow(on) { for (const m of this.meshes) m.castShadow = on; }
  dispose() { for (const m of this.meshes) { m.parent?.remove(m); m.dispose?.(); } }
}

// ------------------------------------------------------------------ MergedBatch: one static geometry, index buffer repacked from the visible cells
export class MergedBatch {
  constructor(name, builder, material, { castShadow = false, renderOrder = 0, radius = 400 } = {}, scene = null) {
    this.name = name; this.radius = radius; this.lastKey = ''; this.visible = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(builder.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(builder.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(builder.col, 3));
    let total = 0; for (const l of builder.cells.values()) total += l.length;
    const idx = new Uint32Array(Math.max(3, total)); this.cells = []; let o = 0;
    const P = builder.pos;
    for (const [id, l] of builder.cells) {
      const c = { id, start: o, count: l.length, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
      for (let k = 0; k < l.length; k++) { const v = l[k]; idx[o + k] = v; c.x0 = Math.min(c.x0, P[v * 3]); c.x1 = Math.max(c.x1, P[v * 3]); c.y0 = Math.min(c.y0, P[v * 3 + 1]); c.y1 = Math.max(c.y1, P[v * 3 + 1]); c.z0 = Math.min(c.z0, P[v * 3 + 2]); c.z1 = Math.max(c.z1, P[v * 3 + 2]); }
      o += l.length; this.cells.push(c);
    }
    this.store = idx; this.index = new THREE.BufferAttribute(new Uint32Array(idx.length), 1); this.index.setUsage(THREE.DynamicDrawUsage); g.setIndex(this.index);
    g.setDrawRange(0, 0); this.geometry = g; this.totalTris = total / 3;
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.castShadow = castShadow; this.mesh.receiveShadow = true; this.mesh.renderOrder = renderOrder; this.mesh.name = name; this.mesh.visible = false;
    if (scene) scene.add(this.mesh);
  }
  update(view, radius = this.radius, force = false) {
    const vis = []; let key = '';
    for (let i = 0; i < this.cells.length; i++) if (view.cellVisible(this.cells[i], radius)) { vis.push(i); key += i + ','; }
    if (!force && key === this.lastKey) return; this.lastKey = key;
    let o = 0; const arr = this.index.array;
    for (const ci of vis) { const c = this.cells[ci]; arr.set(this.store.subarray(c.start, c.start + c.count), o); o += c.count; }
    this.geometry.setDrawRange(0, o); this.index.clearUpdateRanges(); this.index.addUpdateRange(0, Math.max(o, 1)); this.index.needsUpdate = true; this.mesh.visible = o > 0; this.visible = o / 3;
  }
}
