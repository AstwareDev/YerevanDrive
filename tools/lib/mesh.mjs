// Tiny mesh-builder helpers shared by tile generators. Local frame: x east, y up, z south.
export class Builder {
  constructor(mat) { this.mat = mat; this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  v(x, y, z, nx, ny, nz, u = 0, v = 0, c = [255, 255, 255, 255]) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c[0], c[1], c[2], c[3]); return this.n++; }
}
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function tri(b, p0, p1, p2, n, t0, t1, t2, c) {
  const g = cross(sub(p1, p0), sub(p2, p0));
  if (dot(g, n) < 0) { [p1, p2] = [p2, p1]; [t1, t2] = [t2, t1]; }
  const i0 = b.v(p0[0], p0[1], p0[2], n[0], n[1], n[2], t0[0], t0[1], c), i1 = b.v(p1[0], p1[1], p1[2], n[0], n[1], n[2], t1[0], t1[1], c), i2 = b.v(p2[0], p2[1], p2[2], n[0], n[1], n[2], t2[0], t2[1], c);
  b.idx.push(i0, i1, i2);
}
export function quad(b, A, B, C, D, n, uA, uB, uC, uD, c) {
  const fwd = dot(cross(sub(B, A), sub(C, A)), n) >= 0;
  const i0 = b.v(A[0], A[1], A[2], n[0], n[1], n[2], uA[0], uA[1], c), i1 = b.v(B[0], B[1], B[2], n[0], n[1], n[2], uB[0], uB[1], c), i2 = b.v(C[0], C[1], C[2], n[0], n[1], n[2], uC[0], uC[1], c), i3 = b.v(D[0], D[1], D[2], n[0], n[1], n[2], uD[0], uD[1], c);
  if (fwd) b.idx.push(i0, i1, i2, i0, i2, i3); else b.idx.push(i0, i2, i1, i0, i3, i2);
}
export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const signedArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
export function pip(p, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
export const hash = n => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
export const mkRng = seed => { let s = (seed | 0) ^ 0x1234567; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
/** Douglas-Peucker on a closed ring (returns >= 3 points) */
export function simplifyRing(ring, eps) {
  if (ring.length <= 4) return ring;
  const dp = (pts, e) => { if (pts.length < 3) return pts; let md = 0, mi = 0; const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    for (let i = 1; i < pts.length - 1; i++) { const t = Math.max(0, Math.min(1, ((pts[i][0] - a[0]) * dx + (pts[i][1] - a[1]) * dz) / l2)); const d = Math.hypot(pts[i][0] - (a[0] + dx * t), pts[i][1] - (a[1] + dz * t)); if (d > md) { md = d; mi = i; } }
    if (md > e) { const l = dp(pts.slice(0, mi + 1), e), r = dp(pts.slice(mi), e); return l.slice(0, -1).concat(r); } return [a, b]; };
  // split at the two farthest points so a closed ring simplifies properly
  let bi = 0, bd = 0; for (let i = 1; i < ring.length; i++) { const d = dist2(ring[0], ring[i]); if (d > bd) { bd = d; bi = i; } }
  const A = dp(ring.slice(0, bi + 1), eps), B2 = dp(ring.slice(bi).concat([ring[0]]), eps);
  const out = A.slice(0, -1).concat(B2.slice(0, -1)); return out.length >= 3 ? out : ring;
}
