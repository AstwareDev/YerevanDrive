// Procedural car bodywork. A car is described by a handful of side-profile / plan-view curves (see SPECS in carspecs.js);
// the body is lofted from cross-sections (smooth shared vertices + averaged normals), glass is inset into the shell,
// wheel arches are cut into the shell, wheels have tyre sidewall / rim / spokes / brake disc, and details (lamps, grille, plates,
// mirrors, door lines...) are added on top. Three LODs are generated from the same spec.
//
// Vertex attributes: position, normal, uv, color (linear, multiplies the material colour), aMat (material class, see carmat.js):
//   0 paint (instance colour) 1 glass 2 tyre 3 chrome/metal 4 black plastic/rubber 5 head lamp lens (emissive) 6 tail lamp lens (emissive)
//   7 licence plate 8 underbody 9 amber indicator 10 taxi sign (emissive)
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _c = new THREE.Color();
const lin = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

export const COL = {
  glass: [0.010, 0.014, 0.019], tyre: [0.020, 0.020, 0.022], chrome: [0.62, 0.64, 0.67], alloy: [0.42, 0.43, 0.46], plastic: [0.028, 0.028, 0.03], dark: [0.006, 0.006, 0.007],
  head: [1.0, 0.92, 0.74], tail: [0.85, 0.025, 0.02], amber: [1.0, 0.42, 0.03], white: [0.9, 0.9, 0.88], disc: [0.18, 0.17, 0.17], taxi: [1.0, 0.82, 0.25],
};

// ------------------------------------------------------------------------------------------------ curves
export function pchip(pts) {
  const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]);
  return v => {
    if (v <= x[0]) return y[0]; if (v >= x[n - 1]) return y[n - 1];
    let i = 0; while (i < n - 2 && v > x[i + 1]) i++;
    const h = x[i + 1] - x[i], t = (v - x[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
/** polyline [[x,y,r]] with corner fillets of radius r -> dense [[x,y]] */
export function fillet(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const B = pts[i], r = B[2] ?? 0;
    if (!r || i === 0 || i === pts.length - 1) { out.push([B[0], B[1]]); continue; }
    const A = pts[i - 1], C = pts[i + 1];
    let ax = A[0] - B[0], ay = A[1] - B[1], cx = C[0] - B[0], cy = C[1] - B[1]; const la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy); ax /= la; ay /= la; cx /= lc; cy /= lc;
    const ph = Math.acos(clamp(ax * cx + ay * cy, -1, 1)); if (ph > 3.05 || ph < 0.05) { out.push([B[0], B[1]]); continue; }
    const d = Math.min(r / Math.tan(ph / 2), 0.48 * Math.min(la, lc));
    const t1 = [B[0] + ax * d, B[1] + ay * d], t2 = [B[0] + cx * d, B[1] + cy * d];
    for (let k = 0; k <= 8; k++) { const t = k / 8, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; out.push([a * t1[0] + b * B[0] + c * t2[0], a * t1[1] + b * B[1] + c * t2[1]]); }
  }
  return out;
}
export function polyFn(dense) {
  for (let i = 1; i < dense.length; i++) if (dense[i][0] <= dense[i - 1][0]) dense[i][0] = dense[i - 1][0] + 1e-4;
  return v => {
    if (v <= dense[0][0]) return dense[0][1]; const n = dense.length; if (v >= dense[n - 1][0]) return dense[n - 1][1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (dense[mid][0] <= v) lo = mid; else hi = mid; }
    const a = dense[lo], b = dense[hi]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]);
  };
}

// ------------------------------------------------------------------------------------------------ mesh accumulator
class MB {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.M = []; this.I = []; this.n = 0; }
  v(p, n, uv, c, m) { this.P.push(p[0], p[1], p[2]); const l = Math.hypot(n[0], n[1], n[2]) || 1; this.N.push(n[0] / l, n[1] / l, n[2] / l); this.U.push(uv[0], uv[1]); this.C.push(c[0], c[1], c[2]); this.M.push(m); return this.n++; }
  tri(a, b, c) { this.I.push(a, b, c); }
  quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
  /** flat quad, CCW seen from outside */
  fq(p0, p1, p2, p3, c, m, uv) {
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const t = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.quad(this.v(p0, n, t[0], c, m), this.v(p1, n, t[1], c, m), this.v(p2, n, t[2], c, m), this.v(p3, n, t[3], c, m));
  }
  box(cx, cy, cz, hx, hy, hz, c, m, skip = '') {
    const X0 = cx - hx, X1 = cx + hx, Y0 = cy - hy, Y1 = cy + hy, Z0 = cz - hz, Z1 = cz + hz;
    if (!skip.includes('+z')) this.fq([X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], c, m);
    if (!skip.includes('-z')) this.fq([X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0], c, m);
    if (!skip.includes('+x')) this.fq([X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], c, m);
    if (!skip.includes('-x')) this.fq([X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], c, m);
    if (!skip.includes('+y')) this.fq([X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0], c, m);
    if (!skip.includes('-y')) this.fq([X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], c, m);
  }
  /** ellipsoid with smooth normals */
  blob(cx, cy, cz, rx, ry, rz, c, m, seg = 8, rings = 5) {
    const base = this.n;
    for (let r = 0; r <= rings; r++) { const a = r / rings * Math.PI, sy = Math.cos(a), sr = Math.sin(a); for (let s = 0; s <= seg; s++) { const t = s / seg * Math.PI * 2, nx = Math.cos(t) * sr, nz = Math.sin(t) * sr; this.v([cx + nx * rx, cy + sy * ry, cz + nz * rz], [nx / rx, sy / ry, nz / rz], [s / seg, r / rings], c, m); } }
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) { const a = base + r * (seg + 1) + s, b = a + seg + 1; this.tri(a, a + 1, b); this.tri(a + 1, b + 1, b); }
  }
  /** capped tube between two points */
  tube(p0, p1, r0, r1, seg, c, m, cap = true) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d) || 1, a = [d[0] / L, d[1] / L, d[2] / L];
    const up = Math.abs(a[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]; let u = [a[1] * up[2] - a[2] * up[1], a[2] * up[0] - a[0] * up[2], a[0] * up[1] - a[1] * up[0]]; const ul = Math.hypot(...u); u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const w = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]], base = this.n;
    for (let k = 0; k <= seg; k++) { const th = k / seg * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), nr = [u[0] * cs + w[0] * sn, u[1] * cs + w[1] * sn, u[2] * cs + w[2] * sn]; this.v([p0[0] + nr[0] * r0, p0[1] + nr[1] * r0, p0[2] + nr[2] * r0], nr, [k / seg, 0], c, m); this.v([p1[0] + nr[0] * r1, p1[1] + nr[1] * r1, p1[2] + nr[2] * r1], nr, [k / seg, 1], c, m); }
    for (let k = 0; k < seg; k++) { const i = base + k * 2; this.tri(i, i + 3, i + 1); this.tri(i, i + 2, i + 3); }
    if (cap) for (const [p, r, s] of [[p1, r1, 1], [p0, r0, -1]]) { const n = [a[0] * s, a[1] * s, a[2] * s], ctr = this.v(p, n, [0.5, 0.5], c, m), ring = []; for (let k = 0; k < seg; k++) { const th = k / seg * Math.PI * 2; ring.push(this.v([p[0] + (u[0] * Math.cos(th) + w[0] * Math.sin(th)) * r, p[1] + (u[1] * Math.cos(th) + w[1] * Math.sin(th)) * r, p[2] + (u[2] * Math.cos(th) + w[2] * Math.sin(th)) * r], n, [0.5, 0.5], c, m)); } for (let k = 0; k < seg; k++) { const A = ring[k], B = ring[(k + 1) % seg]; if (s > 0) this.tri(ctr, A, B); else this.tri(ctr, B, A); } }
  }
  /** lathe around the x axis through (cx,cy,cz). prof: [[r, a]] traversed so that normal=(da,-dr) points outward. side +1 => a grows with +x */
  lathe(prof, seg, cx, cy, cz, side, c, m, smooth = true) {
    const np = prof.length, base = this.n, nn = [];
    for (let k = 0; k < np; k++) {
      let nr = 0, na = 0;
      for (const [a, b] of [[k - 1, k], [k, k + 1]]) if (a >= 0 && b < np) { const dr = prof[b][0] - prof[a][0], da = prof[b][1] - prof[a][1], l = Math.hypot(dr, da) || 1; nr += da / l; na += -dr / l; }
      const l = Math.hypot(nr, na) || 1; nn.push([nr / l, na / l]);
    }
    for (let k = 0; k < np; k++) for (let t = 0; t <= seg; t++) {
      const th = t / seg * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), r = prof[k][0], a = prof[k][1];
      this.v([cx + side * a, cy + r * cs, cz + r * sn], [side * nn[k][1], nn[k][0] * cs, nn[k][0] * sn], [t / seg, k / (np - 1)], c, m);
    }
    for (let k = 0; k < np - 1; k++) for (let t = 0; t < seg; t++) {
      const A = base + k * (seg + 1) + t, B = A + seg + 1, C = B + 1, D = A + 1;
      if (side > 0) { this.tri(A, D, C); this.tri(A, C, B); } else { this.tri(A, C, D); this.tri(A, B, C); }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.M, 1));
    g.setIndex(new THREE.Uint16BufferAttribute(this.I, 1)); g.computeBoundingSphere(); g.userData.tris = this.I.length / 3; return g;
  }
}

// ------------------------------------------------------------------------------------------------ body functions
const HALF_FULL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HALF_LOD1 = [0, 2, 4, 6, 8, 9, 10, 12];
const HALF_LOD2 = [0, 4, 6, 9, 10, 12];

export function bodyFns(S) {
  const L = S.L, Lh = L / 2, Wh = S.W / 2;
  const dense = fillet(S.top.map(([u, y, r = 0]) => [u * L, y, r]));
  const topF0 = polyFn(dense), topF = z => topF0(z + Lh);
  const hwF = pchip(S.hw ?? [[0, 0.79], [0.025, 0.905], [0.07, 0.97], [0.16, 0.995], [0.3, 1], [0.7, 1], [0.86, 0.995], [0.94, 0.965], [0.985, 0.9], [1, 0.8]]);
  const ybF = pchip(S.ybc ?? [[0, S.yb + 0.16], [0.02, S.yb + 0.07], [0.07, S.yb + 0.005], [0.5, S.yb], [0.93, S.yb + 0.005], [0.98, S.yb + 0.07], [1, S.yb + 0.14]]);
  const beltF = pchip([[0, S.beltR ?? S.belt], [0.5, S.belt], [1, S.beltF ?? S.belt]]);
  const rollR = S.roll ?? 0.17, kEnd = 0.18;
  function sec(z) {
    const u = z / L + 0.5, d = Lh - Math.abs(z);
    const k = d >= rollR ? 1 : kEnd + (1 - kEnd) * Math.sqrt(Math.max(0, 1 - ((rollR - d) / rollR) ** 2));
    let hw = Wh * hwF(u) * (0.35 + 0.65 * k) ** 0.8, yb = ybF(u), top = topF(z), belt = Math.min(beltF(u), top - 0.025);
    const yc = (yb + top) / 2; yb = yc + (yb - yc) * k; top = yc + (top - yc) * k; belt = yc + (belt - yc) * k;
    belt = Math.min(belt, top - 0.02);
    const cabH = Math.max(0, top - belt - 0.03), cabF = sstep(0, 0.28, cabH);
    const rr = lerp(0.035, S.roofR ?? 0.085, cabF), rho = lerp(S.hoodW ?? 0.88, S.roofW ?? 0.79, cabF), xb = hw * 0.975, xr = hw * rho;
    const yR = Math.max(top - rr, belt + 0.012), P = [];
    P.push([0, yb], [0.62 * hw, yb], [0.91 * hw, yb + 0.03], [0.985 * hw, yb + 0.115], [hw, yb + 0.42 * (belt - yb)], [hw * 0.997, yb + 0.78 * (belt - yb)], [xb, belt]);
    for (const s of [0.34, 0.68]) P.push([xb + (xr - xb) * s + hw * 0.012 * Math.sin(Math.PI * s) * cabF, belt + (yR - belt) * s]);
    P.push([xr, yR], [xr * 0.8, top - 0.2 * rr - 0.002], [xr * 0.45, top - 0.012 * cabF - 0.002], [0, top]);
    return { z, u, hw, yb, belt, top, cabH, P };
  }
  function zFront(x, y) { for (let z = Lh; z > 0; z -= 0.004) { const s = sec(z); if (x <= s.hw * 0.995 && y >= s.yb && y <= s.top) return z; } return Lh; }
  function zRear(x, y) { for (let z = -Lh; z < 0; z += 0.004) { const s = sec(z); if (x <= s.hw * 0.995 && y >= s.yb && y <= s.top) return z; } return -Lh; }
  return { sec, zFront, zRear, topF, hwF, Lh, Wh };
}

// ------------------------------------------------------------------------------------------------ the build
export function buildCarModel(S, lod) {
  const b = new MB(), F = bodyFns(S), { sec, topF } = F, L = S.L, Lh = L / 2, hs = lod === 0 ? HALF_FULL : lod === 1 ? HALF_LOD1 : HALF_LOD2, nh = hs.length, C = 2 * nh - 2;
  const wr = S.wr, ra = Math.min(wr * 1.14 + 0.035, (S.belt ?? 0.9) - wr - 0.09), zFa = Lh - S.fo, zRa = zFa - S.wb;
  const wheels = [[zFa, 1], [zFa, -1], [zRa, 1], [zRa, -1]];
  const zOf = u => (u - 0.5) * L;
  // ---- stations
  const zs = new Set(); const addZ = z => { if (z > -Lh - 1e-6 && z < Lh + 1e-6) zs.add(+z.toFixed(4)); };
  const nBase = [0, 36, 12, 6][lod + 1] ?? 12;
  for (let i = 0; i <= nBase; i++) addZ(-Lh + L * i / nBase);
  const endD = lod === 0 ? [0, 0.015, 0.04, 0.08, 0.14, 0.2] : lod === 1 ? [0, 0.04, 0.12] : [0, 0.12];
  for (const d of endD) { addZ(-Lh + d); addZ(Lh - d); }
  if (lod < 2) for (const u of [S.rwB, S.rwT, S.wsT, S.wsB]) if (u != null) addZ(zOf(u));
  if (lod === 0) for (const u of (S.doors ?? [])) { addZ(zOf(u) - 0.006); addZ(zOf(u) + 0.006); }
  if (lod < 2) for (const [a, c] of S.bp ?? []) { addZ(zOf(a)); addZ(zOf(c)); }
  if (lod < 2) for (const [a, c] of S.win ?? []) { addZ(zOf(a)); addZ(zOf(c)); }
  if (lod === 0) for (const [zw] of wheels) for (let k = -6; k <= 6; k++) addZ(zw + k * ra / 4.5);
  else if (lod === 1) for (const zw of [zFa, zRa]) { addZ(zw - ra); addZ(zw + ra); }
  let Z = [...zs].sort((a, c) => a - c); const Z2 = [Z[0]]; for (let i = 1; i < Z.length; i++) if (Z[i] - Z2[Z2.length - 1] > (lod === 0 ? 0.011 : 0.03)) Z2.push(Z[i]); Z = Z2;
  const R = Z.length, rows = Z.map(sec);
  // ---- grid positions
  const colHalf = j => (j < nh ? hs[j] : hs[C - j]), colSign = j => (j < nh ? 1 : -1);
  const pos = rows.map(r => Array.from({ length: C }, (_, j) => { const p = r.P[colHalf(j)]; return [p[0] * colSign(j), p[1], r.z]; }));
  const inside = rows.map(() => new Uint8Array(C));
  if (lod === 0) {
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const h = colHalf(j); if (h < 2 || h > 5) continue; const p = pos[i][j];
      for (const [zw] of wheels.slice(0, 4).filter((w, k) => (k % 2 === 0) === (colSign(j) > 0))) {
        const dz = p[2] - zw, dy = p[1] - wr, dd = Math.hypot(dz, dy);
        if (dd < ra) { inside[i][j] = 1; if (dy >= 0) { const f = ra / (dd || 1); p[2] = zw + dz * f; p[1] = wr + dy * f; } else p[2] = zw + (dz >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, ra * ra - dy * dy)); }
      }
    }
  }
  // ---- smooth normals
  const nor = pos.map(r => r.map(() => [0, 0, 0]));
  const faceN = (A, B, Cc, D) => { const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]], e3 = [D[0] - A[0], D[1] - A[1], D[2] - A[2]]; const c1 = cr(e2, e1), c2 = cr(e3, e2); return [c1[0] + c2[0], c1[1] + c2[1], c1[2] + c2[2]]; };
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C; j++) {
    const j2 = (j + 1) % C, A = pos[i][j], B = pos[i + 1][j], D = pos[i + 1][j2], Cc = pos[i][j2]; const n = faceN(A, B, D, Cc);
    for (const [ii, jj] of [[i, j], [i + 1, j], [i + 1, j2], [i, j2]]) { const t = nor[ii][jj]; t[0] += n[0]; t[1] += n[1]; t[2] += n[2]; }
  }
  for (const r of nor) for (const n of r) { const l = Math.hypot(...n); if (l < 1e-9) { n[0] = 0; n[1] = 1; n[2] = 0; } else { n[0] /= l; n[1] /= l; n[2] /= l; } }
  // ---- cell classification
  const winSide = S.win ?? [[S.rwB ?? 0.05, S.wsT ?? 0.6]], bp = S.bp ?? [], plasticBumper = S.bumper === 'plastic';
  const inR = (z, list) => list.some(([a, c]) => z >= zOf(a) && z <= zOf(c));
  const cellKind = (i, j) => {
    if (inside[i][j] && inside[i][(j + 1) % C] && inside[i + 1][j] && inside[i + 1][(j + 1) % C]) return { drop: true };
    const ha = colHalf(j), hb = colHalf((j + 1) % C), a = Math.min(ha, hb), c = Math.max(ha, hb), zc = (Z[i] + Z[i + 1]) / 2, r0 = rows[i], r1 = rows[i + 1], cab = (r0.cabH + r1.cabH) / 2;
    const yc = (pos[i][j][1] + pos[i + 1][j][1] + pos[i][(j + 1) % C][1] + pos[i + 1][(j + 1) % C][1]) / 4;
    if (a <= 1 && c <= 2 && lod === 0) { for (const zw of [zFa, zRa]) if (Math.abs(zc - zw) < ra * 0.98) return { drop: true }; }
    if (a >= 6 && c <= 9 && cab > 0.1 && inR(zc, winSide) && !inR(zc, bp)) return { glass: true };
    if (a >= 10 && !S.noTopGlass) { if (zc >= zOf(S.wsT) && zc <= zOf(S.wsB)) return { glass: true }; if (S.rwB != null && !S.noRearGlass && zc >= zOf(S.rwB) && zc <= zOf(S.rwT) && cab > 0.02) return { glass: true }; }
    if (c <= 1) return { mat: 8, col: COL.dark };
    if (a <= 2 && c <= 3 && S.skirts) return { mat: 4, col: COL.plastic };
    if (plasticBumper && yc < (S.bumperY ?? 0.6) && (zc < -Lh + (S.bumperLen ?? 0.34) || zc > Lh - (S.bumperLen ?? 0.34)) && a >= 2) return { mat: 4, col: COL.plastic };
    return { mat: 0 };
  };
  const paintCol = y => { const k = 0.5 + 0.5 * sstep(S.yb, S.yb + 0.45, y); return [k, k, k]; };
  const inset = lod === 0 ? 0.013 : 0;
  const kinds = []; for (let i = 0; i < R - 1; i++) { kinds.push([]); for (let j = 0; j < C; j++) kinds[i].push(cellKind(i, j)); }
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C; j++) {
    const k = kinds[i][j]; if (k.drop) continue; const j2 = (j + 1) % C, g = k.glass;
    const idx = [[i, j], [i + 1, j], [i + 1, j2], [i, j2]].map(([ii, jj]) => {
      const p = pos[ii][jj], n = nor[ii][jj], q = g ? [p[0] - n[0] * inset, p[1] - n[1] * inset, p[2] - n[2] * inset] : p;
      return b.v(q, n, [jj / C, ii / R], g ? COL.glass : (k.col ?? paintCol(p[1])), g ? 1 : k.mat);
    });
    // winding: (A, C, D) (A, D, B) with A=(i,j) B=(i+1,j) D=(i+1,j+1) C=(i,j+1)  -> idx = [A,B,D,C]
    b.tri(idx[0], idx[3], idx[2]); b.tri(idx[0], idx[2], idx[1]);
  }
  // window frame walls (lod0)
  if (lod === 0) {
    const isG = (i, j) => i >= 0 && i < R - 1 && kinds[i][((j % C) + C) % C].glass;
    const isD = (i, j) => i >= 0 && i < R - 1 && kinds[i][((j % C) + C) % C].drop;
    const wall = (A, B, nA, nB, cen) => {
      const A2 = [A[0] - nA[0] * inset, A[1] - nA[1] * inset, A[2] - nA[2] * inset], B2 = [B[0] - nB[0] * inset, B[1] - nB[1] * inset, B[2] - nB[2] * inset];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [A2[0] - A[0], A2[1] - A[1], A2[2] - A[2]]; let n = cr(e1, e2); const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      const toC = [cen[0] - mid[0], cen[1] - mid[1], cen[2] - mid[2]]; const flip = n[0] * toC[0] + n[1] * toC[1] + n[2] * toC[2] < 0; if (flip) n = [-n[0], -n[1], -n[2]];
      const ids = [A, B, B2, A2].map(p => b.v(p, n, [0, 0], COL.plastic, 4));
      if (flip) { b.tri(ids[0], ids[2], ids[1]); b.tri(ids[0], ids[3], ids[2]); } else { b.tri(ids[0], ids[1], ids[2]); b.tri(ids[0], ids[2], ids[3]); }
    };
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < C; j++) if (isG(i, j)) {
      const j2 = (j + 1) % C, cen = [0, 0, 0]; for (const [ii, jj] of [[i, j], [i + 1, j], [i + 1, j2], [i, j2]]) { cen[0] += pos[ii][jj][0] / 4; cen[1] += pos[ii][jj][1] / 4; cen[2] += pos[ii][jj][2] / 4; }
      if (!isG(i - 1, j) && !isD(i - 1, j)) wall(pos[i][j], pos[i][j2], nor[i][j], nor[i][j2], cen);
      if (!isG(i + 1, j) && !isD(i + 1, j)) wall(pos[i + 1][j], pos[i + 1][j2], nor[i + 1][j], nor[i + 1][j2], cen);
      if (!isG(i, j - 1)) wall(pos[i][j], pos[i + 1][j], nor[i][j], nor[i + 1][j], cen);
      if (!isG(i, j + 1)) wall(pos[i][j2], pos[i + 1][j2], nor[i][j2], nor[i + 1][j2], cen);
    }
  }
  // ---- end caps (fans)
  for (const [i, nz] of [[0, -1], [R - 1, 1]]) {
    const ctr = [0, 0, 0]; pos[i].forEach(p => { ctr[0] += p[0] / C; ctr[1] += p[1] / C; ctr[2] += p[2] / C; });
    const n = [0, 0, nz], c0 = b.v(ctr, n, [0.5, 0.5], paintCol(ctr[1]), 0), ids = pos[i].map((p, j) => b.v(p, n, [0, 0], paintCol(p[1]), 0));
    for (let j = 0; j < C; j++) { if (nz > 0) b.tri(c0, ids[j], ids[(j + 1) % C]); else b.tri(c0, ids[(j + 1) % C], ids[j]); }
  }
  // ---- wheel arch liners (lod0) or arch discs (lod1)
  const hwAt = z => sec(z).hw;
  if (lod === 0) {
    for (const [zw, s] of wheels) {
      const hw = hwAt(zw), xo = hw * 0.992, xi = hw - 0.3, a0 = Math.asin(clamp((S.yb + 0.03 - wr) / ra, -1, 1)), N = 18, ids = [];
      for (let k = 0; k <= N; k++) { const th = -a0 + k / N * (Math.PI + 2 * a0), cz = Math.cos(th), sy = Math.sin(th), pz = zw + ra * cz, py = wr + ra * sy, n = [0, -sy, -cz]; ids.push([b.v([s * xo, py, pz], n, [0, 0], COL.dark, 8), b.v([s * xi, py, pz], n, [1, 0], COL.dark, 8)]); }
      for (let k = 0; k < N; k++) { const [a, c] = ids[k], [a2, c2] = ids[k + 1]; if (s > 0) { b.tri(a, c, c2); b.tri(a, c2, a2); } else { b.tri(a, c2, c); b.tri(a, a2, c2); } }
      const ctr = b.v([s * xi, wr, zw], [-s, 0, 0], [0, 0], COL.dark, 8), ring = []; for (let k = 0; k <= N; k++) { const th = -a0 + k / N * (Math.PI + 2 * a0); ring.push(b.v([s * xi, wr + ra * Math.sin(th), zw + ra * Math.cos(th)], [-s, 0, 0], [0, 0], COL.dark, 8)); }
      for (let k = 0; k < N; k++) { if (s > 0) b.tri(ctr, ring[k + 1], ring[k]); else b.tri(ctr, ring[k], ring[k + 1]); }
    }
  } else if (lod === 1) {
    for (const [zw, s] of wheels) { const hw = hwAt(zw), ctr = b.v([s * (hw + 0.004), wr + 0.02, zw], [s, 0, 0], [0, 0], COL.dark, 8), N = 10, ring = []; for (let k = 0; k < N; k++) { const th = k / N * 6.283; ring.push(b.v([s * (hw + 0.004), wr + 0.02 + Math.sin(th) * ra * 0.98, zw + Math.cos(th) * ra * 0.98], [s, 0, 0], [0, 0], COL.dark, 8)); } for (let k = 0; k < N; k++) { if (s > 0) b.tri(ctr, ring[(k + 1) % N], ring[k]); else b.tri(ctr, ring[k], ring[(k + 1) % N]); } }
  }
  // ---- wheels
  for (const [zw, s] of wheels) addWheel(b, S, lod, s, hwAt(zw), zw);
  // ---- details
  addDetails(b, S, F, lod, sec, Z, rows);
  if (lod === 2) { /* tiny: nothing more */ }
  return b.build();
}
const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------------------------------------ wheels
function addWheel(b, S, lod, s, hw, zw) {
  const wr = S.wr, tw = S.tw ?? 0.2, ht = tw / 2, rim = wr * (S.rimK ?? 0.66), cx = s * (hw - 0.045 - ht) * 1, cy = wr;
  // note lathe adds side*a to cx, so mirror the centre offset: build for side s, centre x = s * xc
  const xc = hw - 0.05 - ht, X = s * xc;
  if (lod === 2) { b.box(X, cy, zw, ht, wr, wr, COL.tyre, 2); return; }
  if (lod === 1) {
    const seg = 12, tyre = [[rim, -ht], [wr * 0.96, -ht * 0.95], [wr, -ht * 0.7], [wr, ht * 0.7], [wr * 0.96, ht * 0.95], [rim, ht]];
    b.lathe(tyre, seg, X, cy, zw, s, COL.tyre, 2);
    b.lathe([[rim, ht * 0.92], [rim * 0.5, ht * 0.8], [0.02, ht * 0.8]], seg, X, cy, zw, s, COL.alloy, 3);
    return;
  }
  const seg = 24;
  // tyre: sidewall bulge, shoulder, tread
  const tyre = [[rim * 0.985, -ht * 0.92], [rim * 1.12, -ht * 1.0], [lerp(rim, wr, 0.45), -ht * 1.04], [lerp(rim, wr, 0.8), -ht * 0.98], [wr * 0.985, -ht * 0.82], [wr, -ht * 0.55], [wr * 1.0005, 0], [wr, ht * 0.55], [wr * 0.985, ht * 0.82], [lerp(rim, wr, 0.8), ht * 0.98], [lerp(rim, wr, 0.45), ht * 1.04], [rim * 1.12, ht * 1.0], [rim * 0.985, ht * 0.92]];
  b.lathe(tyre, seg, X, cy, zw, s, COL.tyre, 2);
  // rim barrel (inside) and lip
  b.lathe([[rim * 0.99, ht * 0.92], [rim * 0.96, ht * 0.7], [rim * 0.9, -ht * 0.5], [rim * 0.9, -ht * 0.9]], seg, X, cy, zw, s, COL.alloy, 3);
  // dish / face
  const style = S.rimStyle ?? 'alloy5', fx = ht * 0.62;
  if (style === 'steel') {
    b.lathe([[rim * 0.99, ht * 0.9], [rim * 0.93, ht * 0.8], [rim * 0.8, ht * 0.5], [rim * 0.35, ht * 0.5]], seg, X, cy, zw, s, [0.42, 0.43, 0.45], 4);
    b.lathe([[rim * 0.35, ht * 0.5], [rim * 0.3, ht * 0.62], [0.012, ht * 0.62]], seg, X, cy, zw, s, [0.55, 0.56, 0.58], 3);
    for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283 + 0.4; b.tube([X + s * ht * 0.5, cy + Math.cos(a) * rim * 0.16, zw + Math.sin(a) * rim * 0.16], [X + s * ht * 0.66, cy + Math.cos(a) * rim * 0.16, zw + Math.sin(a) * rim * 0.16], 0.014, 0.012, 6, COL.chrome, 3); }
    for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; b.box(X + s * ht * 0.5, cy + Math.cos(a) * rim * 0.62, zw + Math.sin(a) * rim * 0.62, 0.006, 0.025, 0.025, COL.dark, 4, ''); }
  } else {
    b.lathe([[rim * 0.99, ht * 0.9], [rim * 0.94, ht * 0.62], [rim * 0.7, ht * 0.18], [rim * 0.26, ht * 0.18], [rim * 0.22, ht * 0.4], [0.012, ht * 0.4]], seg, X, cy, zw, s, [0.07, 0.07, 0.08], 3);
    const nSp = style === 'alloy10' ? 10 : style === 'alloy6' ? 6 : 5, tw2 = style === 'alloy10' ? 0.02 : 0.034;
    for (let k = 0; k < nSp; k++) {
      const a = k / nSp * 6.283 + 0.3, ca = Math.cos(a), sa = Math.sin(a), ta = -sa, tb = ca, ax = X + s * ht * 0.2;
      const rr0 = rim * 0.2, rr1 = rim * 0.93, w0 = tw2, w1 = tw2 * 1.35, h2 = ht * 0.16;
      const P = (r, w, x) => [ax + s * x, cy + ca * r + ta * w, zw + sa * r + tb * w];
      const top = [P(rr0, -w0, h2), P(rr0, w0, h2), P(rr1, w1, h2 * 0.7), P(rr1, -w1, h2 * 0.7)];
      const q = s > 0 ? [top[0], top[3], top[2], top[1]] : [top[0], top[1], top[2], top[3]];
      b.fq(q[0], q[1], q[2], q[3], COL.alloy, 3);
      const sideA = [P(rr0, w0, h2), P(rr0, w0, 0), P(rr1, w1, 0), P(rr1, w1, h2 * 0.7)], sideB = [P(rr0, -w0, 0), P(rr0, -w0, h2), P(rr1, -w1, h2 * 0.7), P(rr1, -w1, 0)];
      if (s > 0) { b.fq(sideA[0], sideA[1], sideA[2], sideA[3], COL.alloy, 3); b.fq(sideB[0], sideB[1], sideB[2], sideB[3], COL.alloy, 3); } else { b.fq(sideA[0], sideA[3], sideA[2], sideA[1], COL.alloy, 3); b.fq(sideB[0], sideB[3], sideB[2], sideB[1], COL.alloy, 3); }
    }
    b.lathe([[rim * 0.2, ht * 0.3], [rim * 0.2, ht * 0.5], [rim * 0.12, ht * 0.56], [0.01, ht * 0.56]], 12, X, cy, zw, s, COL.chrome, 3);
  }
  // brake disc + caliper (seen through the spokes)
  b.lathe([[rim * 0.82, -ht * 0.1], [rim * 0.82, 0], [rim * 0.2, 0], [rim * 0.2, -ht * 0.1], [rim * 0.82, -ht * 0.1]], 20, X, cy, zw, s, COL.disc, 3);
  b.box(X - s * ht * 0.1, cy + rim * 0.55, zw + rim * 0.2, ht * 0.18, rim * 0.16, rim * 0.18, S.caliper ?? [0.55, 0.04, 0.03], 3);
}

// ------------------------------------------------------------------------------------------------ details
function lampPanel(b, cx, cy, z, dz, hx, hy, col, mat, frame, round = false) {
  // flat rounded plate facing +-z (dz = +1 front / -1 rear), optional frame ring
  const N = round ? 12 : 8, pts = [];
  for (let k = 0; k < N; k++) { const a = k / N * 6.283, c = Math.cos(a), s = Math.sin(a), e = round ? 1 : 0.5; pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), e) * hx, cy + Math.sign(s) * Math.pow(Math.abs(s), e) * hy]); }
  if (frame) { const fp = pts.map(p => [cx + (p[0] - cx) * 1.14, cy + (p[1] - cy) * 1.22]); b.poly(fp.map(p => [p[0], p[1], z]), [0, 0, dz], frame.col, frame.mat, dz); }
  b.poly(pts.map(p => [p[0], p[1], z + dz * 0.004]), [0, 0, dz], col, mat, dz);
}
MB.prototype.poly = function (pts, n, c, m, dz) { const ids = pts.map(p => this.v(p, n, [0, 0], c, m)); for (let k = 1; k < ids.length - 1; k++) { if (dz > 0) this.tri(ids[0], ids[k], ids[k + 1]); else this.tri(ids[0], ids[k + 1], ids[k]); } };

function addDetails(b, S, F, lod, sec, Z, rows) {
  const { Lh, zFront, zRear } = F, L = S.L, zOf = u => (u - 0.5) * L, hwA = z => sec(z).hw;
  const frontZ = zFront, rear = zRear;
  const hd = S.head ?? {}, tl = S.tail ?? {};
  const hy = hd.y ?? 0.66, hx = hd.x ?? 0.62, hw_ = hd.w ?? 0.17, hh = hd.h ?? 0.06;
  const ty = tl.y ?? 0.86, tx = tl.x ?? 0.66, tw_ = tl.w ?? 0.17, th = tl.h ?? 0.07;
  const W2 = S.W / 2;
  // ---- lamps
  for (const s of [-1, 1]) {
    const x = s * W2 * hx, zf = frontZ(Math.abs(x), hy) + 0.002;
    if (lod <= 1) {
      lampPanel(b, x, hy, zf, 1, hw_, hh, COL.head, 5, lod === 0 ? { col: hd.round ? COL.chrome : COL.chrome, mat: 3 } : null, !!hd.round);
      if (lod === 0) { lampPanel(b, x - s * hw_ * 0.15, hy - hh - 0.045, zf - 0.004, 1, hw_ * 0.55, 0.022, COL.amber, 9, null); }
      const xt = s * W2 * tx, zr = rear(Math.abs(xt), ty) - 0.002;
      lampPanel(b, xt, ty, zr, -1, tw_, th, COL.tail, 6, lod === 0 ? { col: COL.plastic, mat: 4 } : null);
      if (lod === 0) lampPanel(b, xt - s * tw_ * 0.55, ty - th - 0.03, zr + 0.004, -1, tw_ * 0.3, 0.02, COL.white, 5, null);
    }
    if (lod === 2) { b.box(x, hy, zf, hw_, hh, 0.01, COL.head, 5); b.box(s * W2 * tx, ty, rear(Math.abs(s * W2 * tx), ty), tw_, th, 0.01, COL.tail, 6); }
  }
  // ---- grille
  const g = S.grille;
  if (g && lod <= 1) {
    const gy = g.y, gh = g.h, gw = g.w;
    const zg = frontZ(gw * 0.5, gy) + 0.003;
    if (g.style === 'kidney') for (const s of [-1, 1]) { lampPanel(b, s * gw * 0.5, gy, zg, 1, gw * 0.46, gh, COL.dark, 4, { col: COL.chrome, mat: 3 }, false); }
    else { b.poly([[-gw, gy - gh, zg], [gw, gy - gh, zg], [gw, gy + gh, zg], [-gw, gy + gh, zg]].map(p => p), [0, 0, 1], COL.dark, 4, 1); }
    if (lod === 0) {
      const n = g.bars ?? 4; for (let k = 0; k < n; k++) { const y = gy - gh * 0.8 + (k + 0.5) / n * gh * 1.6; b.box(0, y, zg + 0.008, g.style === 'kidney' ? gw * 0.9 : gw * 0.97, 0.007, 0.007, g.style === 'kidney' ? COL.dark : COL.chrome, 3); }
      if (g.frame !== false && g.style !== 'kidney') { b.box(0, gy + gh, zg + 0.006, gw * 1.02, 0.009, 0.009, COL.chrome, 3); b.box(0, gy - gh, zg + 0.006, gw * 1.02, 0.009, 0.009, COL.chrome, 3); for (const s of [-1, 1]) b.box(s * gw, gy, zg + 0.006, 0.009, gh, 0.009, COL.chrome, 3); }
      if (g.logo) { b.tube([0, gy + gh + 0.04, zg + 0.012], [0, gy + gh + 0.04, zg + 0.026], 0.04, 0.04, 14, COL.chrome, 3); }
    }
  }
  // ---- plates
  if (lod <= 1) {
    const py = S.plateY ?? 0.5, pw = 0.26, ph = 0.0625;
    const zf = frontZ(0.1, py) + 0.003, zr = rear(0.1, S.plateYR ?? (py + 0.2)) - 0.003, pyR = S.plateYR ?? (py + 0.2);
    b.fq([-pw, py - ph, zf], [pw, py - ph, zf], [pw, py + ph, zf], [-pw, py + ph, zf], [1, 1, 1], 7, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    b.fq([pw, pyR - ph, zr], [-pw, pyR - ph, zr], [-pw, pyR + ph, zr], [pw, pyR + ph, zr], [1, 1, 1], 7, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // ---- bumpers (chrome / painted blade strips on older cars)
  if (S.bumper === 'chrome' && lod <= 1) {
    for (const [zz, sg] of [[frontZ(0.1, 0.34) + 0.005, 1], [rear(0.1, 0.34) - 0.005, -1]]) {
      const hw = hwA(zz * 0.97) * 0.94;
      for (const s of [-1, 1]) b.box(s * hw * 0.55, 0.37, zz + sg * 0.03, hw * 0.46, 0.055, 0.03, COL.chrome, 3);
      b.box(0, 0.37, zz + sg * 0.03, hw * 0.1, 0.055, 0.03, COL.chrome, 3);
      b.box(0, 0.22, zz - sg * 0.02, hw * 0.8, 0.05, 0.04, COL.plastic, 4);
    }
  }
  if (lod === 2) return;
  // ---- mirrors
  const wsBz = zOf(S.wsB), my = sec(wsBz + 0.12).belt + 0.12, mz = wsBz + 0.1, mx = sec(mz).hw * 0.96 + 0.1;
  for (const s of [-1, 1]) {
    if (lod === 0) { b.blob(s * (mx + 0.03), my, mz, 0.06, 0.05, 0.085, S.mirrorCol ?? [0.5, 0.5, 0.5], 0, 8, 5); b.box(s * (mx - 0.05), my - 0.03, mz + 0.02, 0.05, 0.012, 0.02, COL.plastic, 4); }
    else b.box(s * mx, my, mz, 0.06, 0.05, 0.08, [0.5, 0.5, 0.5], 0);
  }
  // ---- door shut lines, belt moulding, door handles
  if (lod === 0) {
    const ribbon = (z, from, to, wdt, col, mat, off) => {
      const s0 = sec(z); for (const sgn of [-1, 1]) {
        const pts = []; for (let h = from; h <= to; h++) pts.push([s0.P[h][0] * sgn, s0.P[h][1]]);
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], c = pts[k + 1], ex = c[0] - a[0], ey = c[1] - a[1], l = Math.hypot(ex, ey) || 1, o = [ey / l, -ex / l];
          // outward = away from the section centre
          const mxx = (a[0] + c[0]) / 2, myy = (a[1] + c[1]) / 2, cen = [0, s0.yb * 0.5 + s0.top * 0.5]; let ox = o[0], oy = o[1]; if (ox * (mxx - cen[0]) + oy * (myy - cen[1]) < 0) { ox = -ox; oy = -oy; }
          const p = (q, dz) => [q[0] + ox * off, q[1] + oy * off, z + dz];
          const n = [ox, oy, 0], i0 = b.v(p(a, -wdt), n, [0, 0], col, mat), i1 = b.v(p(a, wdt), n, [0, 1], col, mat), i2 = b.v(p(c, wdt), n, [1, 1], col, mat), i3 = b.v(p(c, -wdt), n, [1, 0], col, mat);
          // facing: (i0,i1,i2) should have +n; flip when needed
          const e1 = [0, 0, 2 * wdt], e2 = [c[0] - a[0], c[1] - a[1], 0], cc = cr(e1, e2); if (cc[0] * ox + cc[1] * oy > 0) { b.tri(i0, i1, i2); b.tri(i0, i2, i3); } else { b.tri(i0, i2, i1); b.tri(i0, i3, i2); }
        }
      }
    };
    for (const u of S.doors ?? []) ribbon(zOf(u), 3, 6, 0.0045, COL.dark, 4, 0.003);
    if (S.hoodLine !== false) { ribbon(zOf(S.wsB) + 0.05, 6, 12, 0.0045, COL.dark, 4, 0.002); }
    if (S.trunkLine && S.rwB != null) ribbon(zOf(S.rwB) - 0.05, 6, 12, 0.0045, COL.dark, 4, 0.002);
    // door handles
    const ds = S.doors ?? []; for (let k = 0; k + 1 < ds.length; k += 1) { if (k > 0 && ds.length < 3) continue; const z = zOf(ds[k + 1]) - 0.2, s0 = sec(z); if (z < zOf(ds[k]) + 0.35) continue; for (const s of [-1, 1]) b.box(s * (s0.P[5][0] + 0.008), s0.belt - 0.06, z, 0.008, 0.012, 0.065, COL.chrome, 3); }
    // belt moulding strip under the windows
    for (const s of [-1, 1]) { const za = zOf(S.rwB ?? 0.1), zb = zOf(S.wsB); const sa = sec(za), sb = sec(zb); void sa; void sb; b.box(s * (sec((za + zb) / 2).P[6][0] + 0.003), sec((za + zb) / 2).belt + 0.003, (za + zb) / 2, 0.004, 0.007, Math.abs(zb - za) / 2, COL.dark, 4); }
    // exhaust, antenna
    b.tube([0.45 * W2, 0.2, -Lh + 0.1], [0.45 * W2, 0.2, -Lh - 0.02], 0.026, 0.026, 8, COL.chrome, 3);
    if (!S.noAntenna) { const rz = zOf(S.rwT ?? 0.3) + 0.15, ry = S.top.reduce((m, p) => Math.max(m, p[1]), 0); b.tube([0, ry - 0.02, rz], [-0.02, ry + 0.38, rz - 0.12], 0.006, 0.003, 4, COL.dark, 4); }
  } else {
    for (const u of S.doors ?? []) { const z = zOf(u), s0 = sec(z); for (const s of [-1, 1]) b.box(s * (s0.hw + 0.001), (s0.belt + s0.yb) / 2 + 0.02, z, 0.003, (s0.belt - s0.yb) / 2 - 0.05, 0.004, COL.dark, 4); }
  }
  // ---- roof extras
  const roofY = S.roofY ?? S.top.reduce((m, p) => Math.max(m, p[1]), 0), rzA = zOf(S.rwT ?? 0.3), rzB = zOf(S.wsT ?? 0.6);
  if (S.taxi) {
    const zc = (rzA + rzB) / 2; b.box(0, roofY + 0.07, zc, 0.24, 0.06, 0.1, COL.taxi, 10); b.box(0, roofY + 0.013, zc, 0.2, 0.014, 0.08, COL.plastic, 4);
    if (lod === 0) { b.box(0, roofY + 0.07, zc + 0.103, 0.2, 0.04, 0.002, [1, 0.9, 0.4], 10); }
  }
  if (S.rack) {
    const hwR = sec((rzA + rzB) / 2).hw * (S.roofW ?? 0.79);
    for (const s of [-1, 1]) b.box(s * hwR * 0.8, roofY + 0.045, (rzA + rzB) / 2, 0.018, 0.018, (rzB - rzA) / 2, COL.plastic, 4);
    const nb = lod === 0 ? 4 : 2; for (let k = 0; k < nb; k++) b.box(0, roofY + 0.05, lerp(rzA, rzB, (k + 0.5) / nb), hwR * 0.82, 0.012, 0.012, COL.plastic, 4);
  }
  if (S.extras) S.extras(b, { sec, zOf, W2, lod, Lh, COL });
}
