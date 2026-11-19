// Geometry kit for hand-modelled landmarks. Pure JS (no DOM) so it can also run under node.
// Local frame: x east, y up, z south. Everything is accumulated into per-material buckets (=> one draw call per material).
import earcut from 'earcut';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const TAU = Math.PI * 2;

export class Mesher {
  /** @param gy ground height fn (x,z)->y used for the per-vertex "height above ground" (drives the floodlight falloff) */
  constructor(gy = () => 0) { this.gy = gy; this.b = {}; this.uvS = 4; }
  bk(name) { return this.b[name] ??= { p: [], n: [], u: [], c: [], g: [], i: [] }; }
  count() { let t = 0; for (const k in this.b) t += this.b[k].i.length / 3; return t; }

  // ------------------------------------------------------------------ raw faces
  /** convex-ish/any planar polygon; verts = [[x,y,z],...]; hint = outward normal (decides winding). opt: {col,uvS,nrm:[n per vertex],uvOff,uvFn} */
  face(name, verts, hint, opt = {}) {
    const k = verts.length; if (k < 3) return;
    let n = [0, 0, 0];
    for (let i = 1; i < k - 1; i++) { const c = cross(sub(verts[i], verts[0]), sub(verts[i + 1], verts[0])); n[0] += c[0]; n[1] += c[1]; n[2] += c[2]; }
    const ln = len(n); if (ln < 1e-9) return;
    n = [n[0] / ln, n[1] / ln, n[2] / ln];
    let flip = false;
    if (hint && dot(n, hint) < 0) { flip = true; n = [-n[0], -n[1], -n[2]]; }
    const b = this.bk(name), base = b.p.length / 3, S = opt.uvS ?? this.uvS, col0 = opt.col ?? [1, 1, 1];
    // uv basis
    let vd, t;
    if (Math.abs(n[1]) > 0.985) { vd = [0, 0, 1]; t = [1, 0, 0]; }
    else { vd = norm([-n[0] * n[1], 1 - n[1] * n[1], -n[2] * n[1]]); t = norm(cross(vd, n)); }
    const [uo = 0, vo = 0] = opt.uvOff ?? [];
    for (let i = 0; i < k; i++) {
      const v = verts[i];
      b.p.push(v[0], v[1], v[2]);
      const nn = opt.nrm ? opt.nrm[i] : n; b.n.push(nn[0], nn[1], nn[2]);
      if (opt.uvFn) { const uv = opt.uvFn(i, v); b.u.push(uv[0], uv[1]); }
      else b.u.push((dot(v, t) / S) + uo, (dot(v, vd) / S) + vo);
      const col = opt.cols ? opt.cols[i] : col0; b.c.push(col[0], col[1], col[2]);
      b.g.push(v[1] - this.gy(v[0], v[2]));
    }
    if (k === 3) { if (flip) b.i.push(base, base + 2, base + 1); else b.i.push(base, base + 1, base + 2); }
    else if (k === 4) { if (flip) b.i.push(base, base + 3, base + 2, base, base + 2, base + 1); else b.i.push(base, base + 1, base + 2, base, base + 2, base + 3); }
    else {
      // earcut in the plane's dominant projection
      const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
      const flat = []; for (const v of verts) { if (ax === 0) flat.push(v[1], v[2]); else if (ax === 1) flat.push(v[0], v[2]); else flat.push(v[0], v[1]); }
      const ids = earcut(flat);
      // earcut winding is arbitrary -> fix against n
      for (let q = 0; q < ids.length; q += 3) {
        const A = verts[ids[q]], B = verts[ids[q + 1]], C = verts[ids[q + 2]];
        const cn = cross(sub(B, A), sub(C, A)); const ok = dot(cn, n) >= 0;
        if (ok) b.i.push(base + ids[q], base + ids[q + 1], base + ids[q + 2]); else b.i.push(base + ids[q], base + ids[q + 2], base + ids[q + 1]);
      }
    }
  }
  quad(name, a, b, c, d, hint, opt) { this.face(name, [a, b, c, d], hint, opt); }
  tri(name, a, b, c, hint, opt) { this.face(name, [a, b, c], hint, opt); }

  // ------------------------------------------------------------------ frames: F = { o:[x,y,z], t:[tx,tz], n:[nx,nz] }, local (a along t, v up, d along n)
  P(F, a, v, d) { return [F.o[0] + F.t[0] * a + F.n[0] * d, F.o[1] + v, F.o[2] + F.t[1] * a + F.n[1] * d]; }
  H(F, da, dv, dd) { return [F.t[0] * da + F.n[0] * dd, dv, F.t[1] * da + F.n[1] * dd]; }
  fq(name, F, pts, hintLocal, opt) { this.face(name, pts.map(p => this.P(F, p[0], p[1], p[2])), this.H(F, hintLocal[0], hintLocal[1], hintLocal[2]), opt); }
  /** oriented box in a frame (faces: front(+d), left(-a), right(+a), top, bottom; back omitted) */
  fbox(name, F, a0, a1, v0, v1, d0, d1, opt = {}) {
    const P = (a, v, d) => this.P(F, a, v, d), s = opt.skip ?? '';
    if (!s.includes('f')) this.face(name, [P(a0, v0, d1), P(a1, v0, d1), P(a1, v1, d1), P(a0, v1, d1)], this.H(F, 0, 0, 1), opt);
    if (!s.includes('l')) this.face(name, [P(a0, v0, d0), P(a0, v0, d1), P(a0, v1, d1), P(a0, v1, d0)], this.H(F, -1, 0, 0), opt);
    if (!s.includes('r')) this.face(name, [P(a1, v0, d1), P(a1, v0, d0), P(a1, v1, d0), P(a1, v1, d1)], this.H(F, 1, 0, 0), opt);
    if (!s.includes('t')) this.face(name, [P(a0, v1, d1), P(a1, v1, d1), P(a1, v1, d0), P(a0, v1, d0)], [0, 1, 0], opt);
    if (!s.includes('b')) this.face(name, [P(a0, v0, d0), P(a1, v0, d0), P(a1, v0, d1), P(a0, v0, d1)], [0, -1, 0], opt);
  }
  /** axis-aligned-in-yaw box centred on (x,z) with base at y. yaw rotates about Y. */
  obox(name, x, y, z, w, h, d, yaw = 0, opt = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const F = { o: [x, y, z], t: [c, -s], n: [s, c] };
    this.fbox(name, F, -w / 2, w / 2, 0, h, -d / 2, d / 2, opt);
  }

  // ------------------------------------------------------------------ solids of revolution (smooth normals). profile = [[r,y],...] bottom->top
  lathe(name, cx, cz, profile, seg = 24, opt = {}) {
    const b = this.bk(name), S = opt.uvS ?? this.uvS, col = opt.col ?? [1, 1, 1], base0 = b.p.length / 3;
    const np = profile.length, y0 = opt.y0 ?? 0, a0 = opt.a0 ?? 0, a1 = opt.a1 ?? TAU, ys = opt.sy ?? 1;
    // profile normals (2D): perpendicular to segment, pointing outward
    const pn = [];
    for (let j = 0; j < np; j++) {
      const A = profile[Math.max(0, j - 1)], B = profile[Math.min(np - 1, j + 1)];
      let dr = B[0] - A[0], dy = (B[1] - A[1]); const l = Math.hypot(dr, dy) || 1; pn.push([dy / l, -dr / l]); // (nr, ny)
    }
    if (opt.flipNormals) for (const q of pn) { q[0] = -q[0]; q[1] = -q[1]; }
    let arc = 0;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * i / seg, ca = Math.cos(a), sa = Math.sin(a);
      let h = 0;
      for (let j = 0; j < np; j++) {
        const [r, y] = profile[j]; const px = cx + ca * r, pz = cz + sa * r, py = y0 + y * ys;
        b.p.push(px, py, pz); b.n.push(ca * pn[j][0], pn[j][1], sa * pn[j][0]);
        if (j > 0) h += Math.hypot(r - profile[j - 1][0], y - profile[j - 1][1]);
        b.u.push((a * (opt.uR ?? 1) * (opt.uRad ?? profile[Math.floor(np / 2)][0])) / S + (opt.uoff ?? 0), h / S + (opt.voff ?? 0)); b.c.push(col[0], col[1], col[2]); b.g.push(py - this.gy(px, pz));
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < np - 1; j++) {
      const A = base0 + i * np + j, B = A + np, C = B + 1, D = A + 1;
      if (opt.flipNormals) b.i.push(A, B, C, A, C, D); else b.i.push(A, C, B, A, D, C);
    }
    // cap with winding fix is left to caller (profile starting at r=0 closes the bottom)
  }
  /** vertical cylinder/prism with n sides. closed top cap optional */
  cyl(name, cx, y0, cz, r, h, seg = 16, opt = {}) {
    const prof = [[r, 0], [r, h]]; if (opt.capTop) prof.push([0, h]);
    this.lathe(name, cx, cz, [[r, 0], [r, h]], seg, { y0, ...opt });
    if (opt.capTop) { const verts = []; for (let i = 0; i < seg; i++) { const a = TAU * i / seg; verts.push([cx + Math.cos(a) * r, y0 + h, cz + Math.sin(a) * r]); } this.face(name, verts, [0, 1, 0], opt); }
  }
  /** disc (flat polygon) */
  disc(name, cx, y, cz, r, seg = 24, opt = {}) {
    const verts = []; for (let i = 0; i < seg; i++) { const a = TAU * i / seg; verts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); }
    this.face(name, verts, opt.down ? [0, -1, 0] : [0, 1, 0], opt);
  }

  // ------------------------------------------------------------------ extrusion of a 2D polygon [[x,z],...] between y0,y1 (flat caps)
  prism(name, ring, y0, y1, opt = {}) {
    const R = orient(ring);
    for (let i = 0; i < R.length; i++) {
      const a = R[i], b = R[(i + 1) % R.length]; const e = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(e[0], e[1]); if (l < 1e-4) continue;
      this.quad(name, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [e[1], 0, -e[0]], opt);
    }
    if (!opt.noTop) this.face(name, R.map(p => [p[0], y1, p[1]]), [0, 1, 0], opt);
    if (opt.bottom) this.face(name, R.map(p => [p[0], y0, p[1]]), [0, -1, 0], opt);
  }

  // ------------------------------------------------------------------ output
  toThree(THREE, materials) {
    const out = [];
    for (const name in this.b) {
      const b = this.b[name]; if (!b.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setAttribute('gnd', new THREE.Float32BufferAttribute(b.g, 1));
      g.setIndex(b.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mat = materials[name]; if (!mat) { console.warn('landmarks: no material', name); continue; }
      const m = new THREE.Mesh(g, mat); m.name = 'lm_' + name; m.matrixAutoUpdate = false; m.userData.tris = b.i.length / 3;
      out.push(m);
    }
    return out;
  }
}

// ---------------------------------------------------------------------- 2D ring helpers (x,z)
export const area2 = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
/** positive shoelace area (in x,z) => outward normal of edge e is (ez,-ex) */
export const orient = r => area2(r) < 0 ? r.slice().reverse() : r;
export const pip = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
export const centroid = r => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
/** drop near-duplicate and (almost) collinear vertices */
export function simplify(ring, minLen = 0.35, angTol = 0.01) {
  let r = ring.slice();
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length; i++) {
      const p = r[(i + r.length - 1) % r.length], c = r[i], n = r[(i + 1) % r.length];
      const d1 = Math.hypot(c[0] - p[0], c[1] - p[1]), d2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
      const cr = ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0])) / ((d1 * d2) || 1);
      if (d1 < minLen || Math.abs(cr) < angTol) { r.splice(i, 1); changed = true; break; }
    }
  }
  return r;
}
/** miter offset (d>0 outward) of a positively-oriented ring */
export function offsetRing(ring, d) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
    let e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1; e1 = [e1[0] / l1, e1[1] / l1]; e2 = [e2[0] / l2, e2[1] / l2];
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    let m = [n1[0] + n2[0], n1[1] + n2[1]]; const ml = Math.hypot(...m) || 1; m = [m[0] / ml, m[1] / ml];
    const cosHalf = Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
    out.push([c[0] + m[0] * d / cosHalf, c[1] + m[1] * d / cosHalf]);
  }
  return out;
}
/** resample an open polyline to roughly uniform spacing */
export function resample(line, step) {
  const out = [line[0]]; let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = step - carry;
    while (s <= L) { out.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]); s += step; }
    carry = L - (s - step);
  }
  return out;
}
/** smooth sampled arc: centre (cx,cz) radius r from angle a0 to a1 */
export const arc = (cx, cz, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
export const rng = seed => { let s = (seed | 0) ^ 0x1234567; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
