// Prop geometries for the circuits: tyre (3 LODs), W-beam guardrail segment, jersey barrier, cone, flat panels.
import * as THREE from 'three';
import { lin } from './util.js';

/** Tyre lying flat (axis = Y). Outer radius 0.33, bore 0.19, height 0.26. LOD0 ~190 tris, LOD1 ~96, LOD2 ~40. */
export function tyreGeometry(level) {
  const P = (r, y) => new THREE.Vector2(r, y);
  let pts, seg;
  if (level === 0) { pts = [P(0.19, 0.125), P(0.285, 0.13), P(0.325, 0.085), P(0.335, 0.03), P(0.335, -0.03), P(0.325, -0.085), P(0.285, -0.13), P(0.19, -0.125), P(0.19, 0.125)]; seg = 12; }
  else if (level === 1) { pts = [P(0.19, 0.13), P(0.30, 0.125), P(0.335, 0.0), P(0.30, -0.125), P(0.19, -0.13), P(0.19, 0.13)]; seg = 9; }
  else { pts = [P(0.19, 0.13), P(0.33, 0.12), P(0.33, -0.12), P(0.19, -0.13), P(0.19, 0.13)]; seg = 5; }
  // remap v so the tread keeps the middle band of the texture: LatheGeometry uses v = j/(n-1)
  pts.reverse(); // LatheGeometry: profile must run bottom -> top on the outer surface for outward normals
  const g = new THREE.LatheGeometry(pts, seg); g.translate(0, 0.13, 0);
  return g;
}

/** far-LOD proxy for a stack of tyres: a unit box 0.66 x 0.255 x 0.66 (scale y by the number of layers) */
export function tyreStackProxy() { const b = new THREE.BoxGeometry(0.66, 0.255, 0.66); b.translate(0, 0.1275, 0); b.deleteAttribute('uv'); return b; }

/** one 4 m W-beam guardrail module along local +Z (front faces local +X = toward the road), with 2 posts. vertex colours: rail galvanised, posts darker. */
export function armcoGeometry() {
  const pos = [], nor = [], col = [], idx = [];
  const rail = lin('#a9adb2'), post = lin('#5a5f66'), dark = lin('#3a3d42');
  const push = (x, y, z, nx, ny, nz, c) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };
  // W profile in (x offset toward road, y) at 7 vertices
  const prof = [[0.0, 0.52], [0.045, 0.60], [0.0, 0.67], [0.045, 0.74], [0.0, 0.81], [0.045, 0.88], [0.0, 0.93]].map(([x, y]) => [x + 0.06, y]);
  const L = 4;
  const rows = prof.map(([x, y], k) => { const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)]; let nx = (b[1] - a[1]), ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; return [x, y, nx / l, ny / l]; });
  const ia = [], ib = [];
  rows.forEach(([x, y, nx, ny]) => { ia.push(push(x, y, -L / 2, nx, ny, 0, rail)); ib.push(push(x, y, L / 2, nx, ny, 0, rail)); });
  for (let k = 0; k + 1 < rows.length; k++) idx.push(ia[k], ib[k], ib[k + 1], ia[k], ib[k + 1], ia[k + 1]);
  // back face (visible from the sidewalk): same profile reversed, offset by thickness
  const ja = [], jb = [];
  rows.forEach(([x, y, nx, ny]) => { ja.push(push(x - 0.02, y, -L / 2, -nx, -ny, 0, dark)); jb.push(push(x - 0.02, y, L / 2, -nx, -ny, 0, dark)); });
  for (let k = 0; k + 1 < rows.length; k++) idx.push(ja[k], jb[k + 1], jb[k], ja[k], ja[k + 1], jb[k + 1]);
  // posts (box 0.1 x 0.95 x 0.14) at z = +-1.0 behind the rail
  for (const z of [-1.0, 1.0]) {
    const x0 = -0.14, x1 = -0.03, y0 = 0, y1 = 0.96, z0 = z - 0.06, z1 = z + 0.06;
    const f = (a, b, c2, d, n) => { const i0 = push(...a, ...n, post), i1 = push(...b, ...n, post), i2 = push(...c2, ...n, post), i3 = push(...d, ...n, post); idx.push(i0, i1, i2, i0, i2, i3); };
    f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}

/** 3 m jersey barrier along local +Z, front toward +X/-X (symmetric). uv: u along (0..1), v up (0..1). ~24 tris */
export function barrierGeometry() {
  const prof = [[-0.30, 0], [-0.30, 0.10], [-0.20, 0.32], [-0.10, 0.80], [0.10, 0.80], [0.20, 0.32], [0.30, 0.10], [0.30, 0]];
  const pos = [], nor = [], uv = [], idx = [], L = 3, H = 0.8;
  const pn = prof.map((p, k) => { const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)]; let nx = (b[1] - a[1]), ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; return [nx / l, ny / l]; });
  // we sweep the profile from the +X base up and over the top to the -X base; normal outward => use (dy, -dx) orientation then flip sign check
  const ia = [], ib = [];
  // order: from (+0.30,0) up to (+0.10,0.8) then to (-0.10,0.8) ... down to (-0.30,0)
  const order = prof.slice().reverse();
  const on = order.map((p, k) => { const a = order[Math.max(0, k - 1)], b = order[Math.min(order.length - 1, k + 1)]; let nx = -(b[1] - a[1]), ny = (b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; return [nx / l, ny / l]; });
  order.forEach(([x, y], k) => { const v = y / H; pos.push(x, y, -L / 2); nor.push(on[k][0], on[k][1], 0); uv.push(0, v); ia.push(pos.length / 3 - 1); pos.push(x, y, L / 2); nor.push(on[k][0], on[k][1], 0); uv.push(1, v); ib.push(pos.length / 3 - 1); });
  for (let k = 0; k + 1 < order.length; k++) idx.push(ia[k], ib[k], ib[k + 1], ia[k], ib[k + 1], ia[k + 1]);
  // flip winding if the first triangle faces inward (check via normal . face normal)
  const e = (i, j) => [pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]];
  const a = e(idx[0], idx[1]), b = e(idx[0], idx[2]), fn = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (fn[0] * nor[idx[0] * 3] + fn[1] * nor[idx[0] * 3 + 1] + fn[2] * nor[idx[0] * 3 + 2] < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  // end caps
  for (const [z, s] of [[-L / 2, -1], [L / 2, 1]]) {
    const base = pos.length / 3; order.forEach(([x, y]) => { pos.push(x, y, z); nor.push(0, 0, s); uv.push(0.5, y / H); });
    for (let k = 1; k + 1 < order.length; k++) s > 0 ? idx.push(base, base + k, base + k + 1) : idx.push(base, base + k + 1, base + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

/** traffic cone 0.7 m with square base, white band; vertex colours; ~24 tris */
export function coneGeometry() {
  const pos = [], nor = [], col = [], idx = [], orange = lin('#ff5a0a'), white = lin('#f2f2ee'), base = lin('#1b1b1b');
  const R0 = 0.14, R1 = 0.035, H = 0.7, n = 8;
  const ring = (y, r, c) => { const ids = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; pos.push(Math.cos(a) * r, y, Math.sin(a) * r); const sl = (R0 - R1) / H; const l = Math.hypot(1, sl); nor.push(Math.cos(a) / l, sl / l, Math.sin(a) / l); col.push(...c); ids.push(pos.length / 3 - 1); } return ids; };
  const r0 = ring(0.045, R0, orange), r1 = ring(0.26, R0 - (R0 - R1) * 0.26 / H, orange), r2 = ring(0.26, R0 - (R0 - R1) * 0.26 / H, white), r3 = ring(0.43, R0 - (R0 - R1) * 0.43 / H, white), r4 = ring(0.43, R0 - (R0 - R1) * 0.43 / H, orange), r5 = ring(H + 0.045, R1, orange);
  const band = (a, b) => { for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; idx.push(a[k], b[k], b[k1], a[k], b[k1], a[k1]); } };
  band(r0, r1); band(r2, r3); band(r4, r5);
  // square base plate
  const hb = 0.19, y0 = 0, y1 = 0.045, add = (p, nn) => { pos.push(...p); nor.push(...nn); col.push(...base); return pos.length / 3 - 1; };
  const quad = (a, b, c, d, nn) => { const i = [add(a, nn), add(b, nn), add(c, nn), add(d, nn)]; idx.push(i[0], i[1], i[2], i[0], i[2], i[3]); };
  quad([-hb, y1, hb], [hb, y1, hb], [hb, y1, -hb], [-hb, y1, -hb], [0, 1, 0]);
  quad([-hb, y0, hb], [hb, y0, hb], [hb, y1, hb], [-hb, y1, hb], [0, 0, 1]); quad([hb, y0, -hb], [-hb, y0, -hb], [-hb, y1, -hb], [hb, y1, -hb], [0, 0, -1]);
  quad([hb, y0, hb], [hb, y0, -hb], [hb, y1, -hb], [hb, y1, hb], [1, 0, 0]); quad([-hb, y0, -hb], [-hb, y0, hb], [-hb, y1, hb], [-hb, y1, -hb], [-1, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}

/** double-sided panel on two posts, 3 m wide x 1 m high at 0.6 m (sponsor fence). UV rect set per-instance by shader (aUv). front +Z. */
export function bannerPanelGeometry(w = 3, h = 1.05, y0 = 0.45) {
  const hw = w / 2, g = new THREE.BufferGeometry();
  const pos = [-hw, y0, 0.03, hw, y0, 0.03, hw, y0 + h, 0.03, -hw, y0 + h, 0.03, hw, y0, -0.03, -hw, y0, -0.03, -hw, y0 + h, -0.03, hw, y0 + h, -0.03];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]; // back face mirrors so text is readable from both sides
  const uvb = [1, 0, 0, 0, 0, 1, 1, 1]; for (let i = 0; i < 8; i++) uv[8 + i] = uvb[i];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  // two posts
  const posts = new THREE.BoxGeometry(0.08, y0 + h + 0.1, 0.08); posts.translate(-hw + 0.1, (y0 + h + 0.1) / 2, -0.06);
  return { panel: g, post: posts };
}
