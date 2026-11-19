// Republic Square ensemble: Government House (+clock tower), History Museum / National Gallery, Marriott, Foreign Ministry, Post/Communications.
import { building, frameOf, profileRing, column } from './facade.js';
import { offsetRing, orient, simplify, rng, TAU } from './kit.js';

const norm2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
/** true if edge a->b (oriented ring) faces point P within the cosine threshold */
const facing = (a, b, P, thr = 0.35) => { const e = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(e[0], e[1]) || 1, n = [e[1] / l, -e[0] / l], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = norm2([P[0] - mid[0], P[1] - mid[1]]); return n[0] * d[0] + n[1] * d[1] > thr; };
const W = (floors, extra = {}) => ({ floors, ...extra });

export function buildEnsemble(m, fp, hidden) {
  const ringOf = id => fp.lm[id].rings[0];
  const out = {};
  const SQ = [0, 0];

  // ============================================================ Government House No.1 (Tamanian), SE side
  {
    const front = [{ h: 6.2, kind: 'arch', pier: 1.7, vs: 4.0 }, { h: 4.8, kind: 'loggia', cols: 2 }, { h: 4.0, kind: 'win', ww: 1.5, wh: 2.2, sill: 0.8, ped: 'seg' }];
    const side = [{ h: 5.2, kind: 'win', ww: 1.5, wh: 2.7, sill: 0.9, ped: (k) => k % 2 ? 'tri' : 'seg' }, { h: 4.7, kind: 'win', ww: 1.5, wh: 2.4, sill: 0.9, ped: 'seg' }, { h: 4.1, kind: 'win', ww: 1.4, wh: 2.0, sill: 0.8 }];
    const common = { wall: 'rose', trim: 'rose', tint: [1, 0.96, 0.94], plinth: 1.4, pilasters: { from: 1, to: 2, w: 0.7, proj: 0.2 }, cornice: { fh: 1.0 }, roof: { kind: 'hip', rise: 5.5, inset: 5.5, col: [1, 1, 1] }, bayW: 5.2, hidden, strings: [1] };
    // west wing: curved main front on the square
    out.gov1 = building(m, ringOf(31664493), { ...common, ...W(side), selfId: 31664493, seed: 11, edge: (i, a, b, L) => facing(a, b, SQ, 0.3) && L > 3 ? { floors: front } : undefined, lit: 0.1 });
    out.gov2 = building(m, ringOf(482593803), { ...common, ...W(side), selfId: 482593803, seed: 12, lit: 0.12 });
    out.gov3 = building(m, ringOf(82681471), { ...common, ...W(side), selfId: 82681471, seed: 13 });
    clockTower(m, 97.5, 8.0, Math.atan2(-0.607, 0.795), hidden);
  }

  // ============================================================ History Museum / National Gallery (NE), cream tuff
  {
    const fr = [{ h: 5.6, kind: 'archwin', aw: 2.4, sill: 0.4, wh: 3.6, vs: 4.0, rev: 0.6 }, { h: 6.4, kind: 'win', ww: 2.0, wh: 3.9, sill: 1.0, ped: (k) => k % 2 ? 'tri' : 'seg' }, { h: 5.4, kind: 'win', ww: 1.7, wh: 3.0, sill: 1.0 }];
    out.museum = building(m, ringOf(2983284), { wall: 'cream', trim: 'cream', tint: [1, 1, 1], plinth: 1.5, ...W(fr), pilasters: { from: 0, to: 2, w: 0.8, proj: 0.22 }, cornice: { fh: 1.2 }, balustrade: true, roof: { kind: 'flat' }, bayW: 5.8, hidden, selfId: 2983284, seed: 21, lit: 0.12, strings: [1, 2] });
    out.museumWing = building(m, ringOf(1556397988), { wall: 'cream', trim: 'cream', plinth: 1.2, ...W([{ h: 5.2, kind: 'win', ww: 1.8, wh: 3.0, sill: 0.8, ped: 'seg' }, { h: 5.0, kind: 'win', ww: 1.8, wh: 3.0, sill: 0.8 }, { h: 4.6, kind: 'win', ww: 1.6, wh: 2.5, sill: 0.8 }]), cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, bayW: 5.0, hidden, selfId: 1556397988, seed: 22, lit: 0.1 });
    // central block with the octagonal drum (National Gallery)
    const blk = building(m, ringOf(1556397989), { wall: 'cream', trim: 'cream', plinth: 0.0, noPlinth: true, y0: 2.0, ...W([{ h: 6, kind: 'win', ww: 1.6, wh: 3.2, sill: 1.0 }, { h: 6, kind: 'win', ww: 1.6, wh: 3.2, sill: 1.0 }, { h: 6, kind: 'win', ww: 1.6, wh: 3.2, sill: 1.0 }]), cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, bayW: 5.0, hidden, selfId: 1556397989, seed: 23, lit: 0.1 });
    portico(m, [94.5, -96.5], [-0.739, -0.674], 1.6);
    const cx = 123.5, cz = -125;
    const oct = []; for (let i = 0; i < 8; i++) { const a = TAU * (i + 0.5) / 8 + Math.atan2(0.677, 0.737) * 0; oct.push([cx + Math.cos(a) * 15.5, cz + Math.sin(a) * 15.5]); }
    building(m, oct, { wall: 'cream', trim: 'cream', noPlinth: true, plinth: 0, y0: blk.yRoof, ...W([{ h: 7, kind: 'win', ww: 1.4, wh: 4.2, sill: 1.2, ped: 'seg' }]), cornice: { fh: 0.9 }, roof: { kind: 'flat' }, bayW: 5.8, hidden: null, seed: 24, lit: 0.2 });
  }

  // ============================================================ Foreign Ministry (Government House No.2), north of the oval
  {
    const fr = [{ h: 5.4, kind: 'arch', pier: 1.4, vs: 3.7 }, { h: 4.6, kind: 'win', ww: 1.6, wh: 2.8, sill: 0.8, ped: (k) => k % 2 ? 'tri' : 'seg' }, { h: 4.6, kind: 'win', ww: 1.6, wh: 2.8, sill: 0.8 }, { h: 4.4, kind: 'loggia', cols: 2 }];
    const bk = [{ h: 5.4, kind: 'win', ww: 1.5, wh: 2.6, sill: 0.9 }, { h: 4.6, kind: 'win', ww: 1.6, wh: 2.8, sill: 0.8 }, { h: 4.6, kind: 'win', ww: 1.6, wh: 2.8, sill: 0.8 }, { h: 4.4, kind: 'win', ww: 1.5, wh: 2.2, sill: 0.8 }];
    out.fm = building(m, ringOf(31624091), { wall: 'rose', trim: 'rose', tint: [1.02, 0.97, 0.95], plinth: 1.4, ...W(bk), pilasters: { from: 1, to: 3, w: 0.7, proj: 0.2 }, cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, bayW: 5.0, hidden, selfId: 31624091, seed: 31, lit: 0.1, strings: [1], edge: (i, a, b, L) => facing(a, b, SQ, 0.3) && L > 3 ? { floors: fr } : undefined });
  }

  // ============================================================ Marriott (ex "Armenia" hotel), west of the oval
  {
    const fr = [{ h: 5.2, kind: 'arch', pier: 1.3, vs: 3.5 }, { h: 3.9, kind: 'win', ww: 1.4, wh: 2.4, sill: 0.8, ped: 'seg', balc: (k) => k % 2 === 0 }, { h: 3.9, kind: 'win', ww: 1.4, wh: 2.4, sill: 0.8 }, { h: 3.9, kind: 'win', ww: 1.4, wh: 2.4, sill: 0.8, balc: (k) => k % 2 === 1 }, { h: 3.9, kind: 'win', ww: 1.4, wh: 2.4, sill: 0.8 }, { h: 3.5, kind: 'win', ww: 1.3, wh: 2.0, sill: 0.7 }];
    const bk = fr.map((f, i) => i === 0 ? { h: 5.2, kind: 'win', ww: 1.4, wh: 2.6, sill: 0.9 } : { ...f, ped: undefined, balc: undefined });
    out.marriott = building(m, ringOf(31854855), { wall: 'rose', trim: 'rose', tint: [1.06, 0.97, 0.92], plinth: 1.3, ...W(bk), pilasters: { from: 1, to: 5, w: 0.6, proj: 0.16 }, cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, bayW: 4.4, hidden, selfId: 31854855, seed: 41, lit: 0.22, strings: [1, 5], edge: (i, a, b, L) => facing(a, b, SQ, 0.3) && L > 3 ? { floors: fr } : undefined });
    out.marriott2 = building(m, ringOf(1299235223), { wall: 'rose', trim: 'rose', plinth: 1.3, ...W(bk.slice(0, 4)), cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, bayW: 4.4, hidden, selfId: 1299235223, seed: 42, lit: 0.2 });
  }

  // ============================================================ Post / Communications (Trade Unions building), south of the oval
  {
    const fr = [{ h: 5.2, kind: 'arch', pier: 1.5, vs: 3.6 }, { h: 4.4, kind: 'win', ww: 1.6, wh: 2.6, sill: 0.8, ped: (k) => k % 2 ? 'seg' : 'tri' }, { h: 4.4, kind: 'win', ww: 1.6, wh: 2.6, sill: 0.8 }, { h: 4.0, kind: 'win', ww: 1.5, wh: 2.1, sill: 0.8 }];
    const bk = fr.map((f, i) => ({ ...f, kind: 'win', ww: 1.5, wh: i ? f.wh : 2.6, sill: i ? f.sill : 0.9, ped: undefined }));
    out.post = building(m, ringOf(531981199), { wall: 'cream', trim: 'cream', tint: [1, 0.98, 0.95], plinth: 1.3, ...W(bk), pilasters: { from: 1, to: 3, w: 0.7, proj: 0.2 }, cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, bayW: 5.0, hidden, selfId: 531981199, seed: 51, lit: 0.12, strings: [1], edge: (i, a, b, L) => facing(a, b, SQ, 0.3) && L > 3 ? { floors: fr } : undefined });
  }
  return out;
}

// ---------------------------------------------------------------- the clock tower of Government House
function clockTower(m, cx, cz, yaw, hidden) {
  const t = [Math.cos(yaw), Math.sin(yaw)]; const nrm = [-t[1], t[0]];
  const sq = (h) => [[cx + t[0] * h + nrm[0] * h, cz + t[1] * h + nrm[1] * h], [cx - t[0] * h + nrm[0] * h, cz - t[1] * h + nrm[1] * h], [cx - t[0] * h - nrm[0] * h, cz - t[1] * h - nrm[1] * h], [cx + t[0] * h - nrm[0] * h, cz + t[1] * h - nrm[1] * h]];
  const common = { wall: 'rose', trim: 'rose', tint: [1, 0.96, 0.94], pilasters: null, bayW: 11, seed: 61 };
  const s1 = building(m, sq(5.5), { ...common, plinth: 1.4, floors: [{ h: 9.5, kind: 'arch', aw: 5.2, vs: 5.4, rev: 2.2 }, { h: 7.5, kind: 'win', div: 2, ww: 1.7, wh: 3.6, sill: 1.5, ped: 'seg' }, { h: 6.0, kind: 'blank' }], cornice: { fh: 1.0 }, roof: { kind: 'none' }, lit: 0.3 });
  // clock faces on the 4 sides of stage 1
  const ringS = s1.ring; const yC = s1.yFloor0 + 9.5 + 7.5 + 3.0;
  for (let i = 0; i < 4; i++) {
    const a = ringS[i], b = ringS[(i + 1) % 4], F = frameOf(a, b), am = F.L / 2, R = 1.55;
    clockFace(m, F, am, yC, R);
  }
  const s2 = building(m, sq(4.3), { ...common, noPlinth: true, plinth: 0, y0: s1.yCor + 0.25, floors: [{ h: 6.4, kind: 'loggia', cols: 2, margin: 0.4, head: 0.9, rev: 1.2 }], cornice: { fh: 0.8 }, balustrade: false, roof: { kind: 'hip', rise: 8.5, apex: true, mat: 'tile' }, bayW: 8.6, seed: 62 });
  // spire finial
  const yTop = s2.yRoof;
  m.lathe('metal', cx, cz, [[0.34, 0], [0.34, 0.9], [0.16, 1.1], [0.16, 4.2], [0.0, 4.8]], 8, { y0: yTop });
  return s2;
}
function clockFace(m, F, a, y, R) {
  const d = 0.12, N = 28;
  const P = (aa, vv, dd) => m.P(F, aa, vv, dd);
  const ring = (r0, r1, mat, col, dd) => { for (let i = 0; i < N; i++) { const t0 = TAU * i / N, t1 = TAU * (i + 1) / N; m.face(mat, [P(a + Math.cos(t0) * r0, y + Math.sin(t0) * r0, dd), P(a + Math.cos(t1) * r0, y + Math.sin(t1) * r0, dd), P(a + Math.cos(t1) * r1, y + Math.sin(t1) * r1, dd), P(a + Math.cos(t0) * r1, y + Math.sin(t0) * r1, dd)], m.H(F, 0, 0, 1), { col }); } };
  ring(0.0001, R, 'clockface', [1.5, 1.35, 1.05], d);
  ring(R, R + 0.28, 'dark', [0.6, 0.55, 0.5], d + 0.05);
  for (let k = 0; k < 12; k++) { const t0 = TAU * k / 12; const ca = Math.cos(t0), sa = Math.sin(t0); m.face('dark', [P(a + ca * R * 0.82 - sa * 0.05, y + sa * R * 0.82 + ca * 0.05, d + 0.02), P(a + ca * R * 0.82 + sa * 0.05, y + sa * R * 0.82 - ca * 0.05, d + 0.02), P(a + ca * R * 0.95 + sa * 0.05, y + sa * R * 0.95 - ca * 0.05, d + 0.02), P(a + ca * R * 0.95 - sa * 0.05, y + sa * R * 0.95 + ca * 0.05, d + 0.02)], m.H(F, 0, 0, 1), { col: [0.1, 0.08, 0.06] }); }
  const hand = (ang, l, w) => { const ca = Math.cos(ang), sa = Math.sin(ang); m.face('dark', [P(a - sa * w, y + ca * w, d + 0.03), P(a + sa * w, y - ca * w, d + 0.03), P(a + ca * l + sa * w * 0.4, y + sa * l - ca * w * 0.4, d + 0.03), P(a + ca * l - sa * w * 0.4, y + sa * l + ca * w * 0.4, d + 0.03)], m.H(F, 0, 0, 1), { col: [0.08, 0.06, 0.05] }); };
  hand(Math.PI * 0.35, R * 0.52, 0.07); hand(Math.PI * 1.1, R * 0.78, 0.05);
}

// ---------------------------------------------------------------- museum entrance portico (hexastyle, steps, lit loggia behind)
function portico(m, P, t, hL) {
  const n = [t[1], -t[0]], gy = m.gy(P[0], P[1]);
  const F = { o: [P[0], 0, P[1]], t, n };
  const y0 = gy;
  // steps
  for (let k = 0; k < 6; k++) m.fbox('cream', F, -17.5, 17.5, y0 - 0.5, y0 + hL - 0.25 * k, 0, 6.5 + 1.1 * (k + 1), { skip: 'b', col: [1.05, 1.03, 1] });
  // lit recessed wall behind the columns
  const yb = y0 + hL, hC = 13.2;
  m.fq('glass', F, [[-15.5, yb, 0.35], [15.5, yb, 0.35], [15.5, yb + hC, 0.35], [-15.5, yb + hC, 0.35]], [0, 0, 1], { cols: [[0.9, 0.5, 0.22], [0.9, 0.5, 0.22], [1.6, 0.95, 0.45], [1.6, 0.95, 0.45]] });
  for (let i = 0; i <= 6; i++) { const a = -15.5 + i * 31 / 6; m.fbox('cream', F, a - 0.5, a + 0.5, yb, yb + hC, 0.2, 0.9, { skip: 'b' }); }
  m.fbox('cream', F, -15.5, 15.5, yb + hC - 1.2, yb + hC, 0.2, 0.7, { skip: 'b' });
  // columns
  const F2 = { o: [P[0] + n[0] * 5.6, 0, P[1] + n[1] * 5.6], t, n };
  for (let i = 0; i < 6; i++) { const a = -12.5 + i * 5; column(m, F2, a, yb, yb + hC, 0.62, 'cream', [1.05, 1.03, 1]); }
  // entablature + pediment
  const yE = yb + hC;
  m.fbox('cream', F, -15.4, 15.4, yE, yE + 1.1, 3.9, 7.0, { skip: 'b', col: [1.08, 1.05, 1] });
  m.fbox('cream', F, -15.9, 15.9, yE + 1.1, yE + 1.5, 3.6, 7.5, { skip: 'b', col: [1.1, 1.07, 1.02] });
  const ph = 3.6, yp = yE + 1.5;
  m.fq('cream', F, [[-15.9, yp, 7.5], [15.9, yp, 7.5], [0, yp + ph, 7.5]], [0, 0, 1], { col: [1.08, 1.05, 1] });
  m.fq('cream', F, [[-15.9, yp, 7.5], [0, yp + ph, 7.5], [0, yp + ph, 3.6], [-15.9, yp, 3.6]], [-ph, 15.9, 0], { col: [1.05, 1.03, 1] });
  m.fq('cream', F, [[0, yp + ph, 7.5], [15.9, yp, 7.5], [15.9, yp, 3.6], [0, yp + ph, 3.6]], [ph, 15.9, 0], { col: [1.05, 1.03, 1] });
  m.fq('cream', F, [[-15.9, yp, 3.6], [0, yp + ph, 3.6], [15.9, yp, 3.6]], [0, 0, -1], { col: [0.9, 0.88, 0.85] });
  // light fixtures on the steps
  for (let i = 0; i < 5; i++) { const a = -14 + i * 7; m.fbox('lamp', F, a - 0.3, a + 0.3, y0 + 0.1, y0 + 0.3, 13.2, 13.7, { col: [3.6, 2.3, 1.1] }); }
}
