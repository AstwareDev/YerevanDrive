// Parametric neoclassical / Soviet-Armenian facade builder: footprint ring -> bays, windows, arches, pilasters, cornices, roofs.
import { Mesher, offsetRing, orient, simplify, rng, TAU, area2 } from './kit.js';

const WARM = [[1.9, 1.25, 0.6], [1.7, 1.15, 0.62], [1.5, 1.2, 0.8], [1.3, 1.0, 0.55], [1.1, 1.05, 1.0]];
const DARK = [0.012, 0.018, 0.034];

/** Sweep a (out, y) profile around a ring. y may be a number or fn(point)->y. */
export function profileRing(m, name, ring, prof, opt = {}) {
  const cache = new Map(); const R = d => { if (!cache.has(d)) cache.set(d, d === 0 ? ring : offsetRing(ring, d)); return cache.get(d); };
  const n = ring.length;
  for (let k = 0; k < prof.length - 1; k++) {
    const [oa, ya] = prof[k], [ob, yb] = prof[k + 1];
    const Ra = R(oa), Rb = R(ob);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = [ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]]; const l = Math.hypot(e[0], e[1]); if (l < 1e-3) continue;
      const Y = (y, p) => typeof y === 'function' ? y(p) : y;
      const a0 = [Ra[i][0], Y(ya, Ra[i]), Ra[i][1]], a1 = [Ra[j][0], Y(ya, Ra[j]), Ra[j][1]], b1 = [Rb[j][0], Y(yb, Rb[j]), Rb[j][1]], b0 = [Rb[i][0], Y(yb, Rb[i]), Rb[i][1]];
      const dy = ((b0[1] + b1[1]) - (a0[1] + a1[1])) / 2, dO = ob - oa; if (Math.abs(dy) < 1e-5 && Math.abs(dO) < 1e-5) continue;
      const nx = e[1] / l, nz = -e[0] / l;
      m.quad(name, a0, a1, b1, b0, [nx * dy, -dO, nz * dy], opt);
    }
  }
}

function frameOf(a, b) { const e = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(e[0], e[1]); const t = [e[0] / L, e[1] / L]; return { o: [a[0], 0, a[1]], t, n: [t[1], -t[0]], L }; }

// ---------------------------------------------------------------------------- openings
// cell = [A0,A1,V0,V1] in frame-local; wall pieces are written into bucket `wall`
function wallRect(m, F, wall, a0, a1, v0, v1, col) { if (a1 - a0 > 1e-3 && v1 - v0 > 1e-3) m.fq(wall, F, [[a0, v0, 0], [a1, v0, 0], [a1, v1, 0], [a0, v1, 0]], [0, 0, 1], { col }); }

function glassCols(rnd, lit, gradient = true) {
  if (!lit) return [DARK, DARK, DARK, DARK];
  const c = WARM[Math.floor(rnd() * WARM.length)], k = 0.55 + rnd() * 0.65, cur = rnd() < 0.5 ? 0.25 + rnd() * 0.4 : 1;
  const top = c.map(x => x * k * cur), bot = c.map(x => x * k);
  return [bot, bot, top, top];
}

/** rectangular window in the cell; returns nothing. o:{ww,wh,sill,rev,ped,lit,trim,balc} */
function rectWindow(m, F, cell, o, rnd, B) {
  const [A0, A1, V0, V1] = cell, am = (A0 + A1) / 2, ww = o.ww, wh = o.wh, v0 = V0 + o.sill, v1 = v0 + wh, a0 = am - ww / 2, a1 = am + ww / 2, rev = o.rev ?? 0.4;
  const w = B.wall, col = B.wallCol;
  wallRect(m, F, w, A0, a0, V0, V1, col); wallRect(m, F, w, a1, A1, V0, V1, col); wallRect(m, F, w, a0, a1, V0, v0, col); wallRect(m, F, w, a0, a1, v1, V1, col);
  // reveal
  m.fq(w, F, [[a0, v0, 0], [a1, v0, 0], [a1, v0, -rev], [a0, v0, -rev]], [0, 1, 0], { col });
  m.fq(w, F, [[a0, v1, -rev], [a1, v1, -rev], [a1, v1, 0], [a0, v1, 0]], [0, -1, 0], { col });
  m.fq(w, F, [[a0, v0, 0], [a0, v0, -rev], [a0, v1, -rev], [a0, v1, 0]], [1, 0, 0], { col });
  m.fq(w, F, [[a1, v0, -rev], [a1, v0, 0], [a1, v1, 0], [a1, v1, -rev]], [-1, 0, 0], { col });
  const lit = rnd() < (o.lit ?? 0.2);
  m.fq('glass', F, [[a0, v0, -rev], [a1, v0, -rev], [a1, v1, -rev], [a0, v1, -rev]], [0, 0, 1], { cols: glassCols(rnd, lit) });
  // frame: mullion + transom
  const fc = B.frameCol;
  m.fbox('frame', F, am - 0.035, am + 0.035, v0, v1, -rev, -rev + 0.07, { col: fc, skip: 'blrt' });
  m.fbox('frame', F, a0, a1, v0 + wh * 0.72, v0 + wh * 0.72 + 0.07, -rev, -rev + 0.07, { col: fc, skip: 'blrt' });
  if (o.trim !== false && !B.plain) {
    const tw = 0.2, pr = 0.1, tc = B.trimCol, T = B.trim;
    m.fbox(T, F, a0 - tw, a0, v0, v1, 0, pr, { col: tc, skip: 'b' }); m.fbox(T, F, a1, a1 + tw, v0, v1, 0, pr, { col: tc, skip: 'b' });
    m.fbox(T, F, a0 - tw - 0.12, a1 + tw + 0.12, v0 - 0.16, v0, 0, 0.25, { col: tc, skip: 'b' });              // sill
    m.fbox(T, F, a0 - tw - 0.1, a1 + tw + 0.1, v1, v1 + 0.3, 0, 0.2, { col: tc, skip: 'b' });                  // lintel
    if (o.ped === 'tri') {
      const pa0 = a0 - tw - 0.22, pa1 = a1 + tw + 0.22, ph = (pa1 - pa0) * 0.2, vb = v1 + 0.3;
      m.fq(T, F, [[pa0, vb, 0.22], [pa1, vb, 0.22], [am, vb + ph, 0.22]], [0, 0, 1], { col: tc });
      m.fq(T, F, [[pa0, vb, 0.22], [am, vb + ph, 0.22], [am, vb + ph, 0], [pa0, vb, 0]], [-ph, (am - pa0), 0], { col: tc });
      m.fq(T, F, [[am, vb + ph, 0.22], [pa1, vb, 0.22], [pa1, vb, 0], [am, vb + ph, 0]], [ph, (pa1 - am), 0], { col: tc });
    } else if (o.ped === 'seg') {
      const pa0 = a0 - tw - 0.2, pa1 = a1 + tw + 0.2, ph = (pa1 - pa0) * 0.14, vb = v1 + 0.3, N = 6; const pts = [];
      for (let i = 0; i <= N; i++) { const u = i / N, a = pa0 + (pa1 - pa0) * u, v = vb + ph * Math.sin(Math.PI * u); pts.push([a, v]); }
      m.face(T, [[pa0, vb, 0.2], ...pts.map(p => [p[0], p[1], 0.2])].map(p => m.P(F, p[0], p[1], p[2])), m.H(F, 0, 0, 1), { col: tc });
      for (let i = 0; i < N; i++) m.fq(T, F, [[pts[i][0], pts[i][1], 0.2], [pts[i + 1][0], pts[i + 1][1], 0.2], [pts[i + 1][0], pts[i + 1][1], 0], [pts[i][0], pts[i][1], 0]], [0, 1, 0], { col: tc });
    }
    if (o.balc) {
      const bd = 0.9, bv = V0 + 0.02, rail = 0.95; const bw0 = a0 - 0.5, bw1 = a1 + 0.5;
      m.fbox(T, F, bw0, bw1, bv - 0.18, bv, 0, bd, { col: tc });
      const nPost = Math.max(3, Math.round((bw1 - bw0) / 0.28));
      for (let i = 0; i <= nPost; i++) { const a = bw0 + (bw1 - bw0 - 0.08) * i / nPost; m.fbox(T, F, a, a + 0.08, bv, bv + rail, bd - 0.1, bd - 0.02, { col: tc, skip: 'btlr' }); }
      m.fbox(T, F, bw0, bw1, bv + rail, bv + rail + 0.08, bd - 0.14, bd, { col: tc, skip: 'b' });
    }
  }
}

/** arched opening: window (rev small, glass) or portal/arcade (deep rev, lit interior). o:{aw (opening width), vb, vs (spring), rev, lit, mould, deep} */
function archOpening(m, F, cell, o, rnd, B) {
  const [A0, A1, V0, V1] = cell, am = (A0 + A1) / 2, r = o.aw / 2, vb = V0 + (o.vb ?? 0), vs = V0 + o.vs, rev = o.rev ?? 0.5, col = B.wallCol, w = B.wall;
  const N = o.seg ?? 10, arcPts = [];
  for (let i = 0; i <= N; i++) { const th = Math.PI * i / N; arcPts.push([am - r * Math.cos(th), vs + r * Math.sin(th)]); }
  wallRect(m, F, w, A0, am - r, V0, V1, col); wallRect(m, F, w, am + r, A1, V0, V1, col); wallRect(m, F, w, am - r, am + r, V0, vb, col);
  for (let i = 0; i < N; i++) { const p = arcPts[i], q = arcPts[i + 1]; m.fq(w, F, [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], V1, 0], [p[0], V1, 0]], [0, 0, 1], { col }); }
  // reveal
  for (let i = 0; i < N; i++) { const p = arcPts[i], q = arcPts[i + 1], mx = (p[0] + q[0]) / 2, mv = (p[1] + q[1]) / 2; m.fq(w, F, [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], -rev], [p[0], p[1], -rev]], [am - mx, vs - mv, 0], { col }); }
  m.fq(w, F, [[am - r, vb, 0], [am - r, vb, -rev], [am - r, vs, -rev], [am - r, vs, 0]], [1, 0, 0], { col });
  m.fq(w, F, [[am + r, vb, -rev], [am + r, vb, 0], [am + r, vs, 0], [am + r, vs, -rev]], [-1, 0, 0], { col });
  m.fq(w, F, [[am - r, vb, 0], [am + r, vb, 0], [am + r, vb, -rev], [am - r, vb, -rev]], [0, 1, 0], { col });
  // back panel
  const poly = [[am - r, vb, -rev], [am + r, vb, -rev]]; for (let i = N; i >= 0; i--) poly.push([arcPts[i][0], arcPts[i][1], -rev]);
  const lit = o.deep ? true : rnd() < (o.lit ?? 0.2);
  let cols;
  if (o.deep) { const k = 0.55 + rnd() * 0.3; cols = poly.map(p => p[1] > vs ? [1.5 * k, 0.9 * k, 0.45 * k] : [0.55 * k, 0.33 * k, 0.17 * k]); }
  else { const gc = glassCols(rnd, lit); cols = poly.map(p => (p[1] > vs ? gc[2] : gc[0])); }
  m.face(B.deep ? 'glass' : 'glass', poly.map(p => m.P(F, p[0], p[1], p[2])), m.H(F, 0, 0, 1), { cols });
  if (!o.deep) {
    m.fbox('frame', F, am - 0.035, am + 0.035, vb, vs + r, -rev, -rev + 0.07, { col: B.frameCol, skip: 'blrt' });
    m.fbox('frame', F, am - r, am + r, vs - 0.04, vs + 0.04, -rev, -rev + 0.07, { col: B.frameCol, skip: 'blrt' });
  }
  // archivolt
  if (o.mould !== false && !B.plain) {
    const mw = o.mw ?? 0.35, pr = 0.12, T = B.trim, tc = B.trimCol;
    for (let i = 0; i < N; i++) {
      const th0 = Math.PI * i / N, th1 = Math.PI * (i + 1) / N;
      const p0 = [am - r * Math.cos(th0), vs + r * Math.sin(th0)], p1 = [am - r * Math.cos(th1), vs + r * Math.sin(th1)];
      const q0 = [am - (r + mw) * Math.cos(th0), vs + (r + mw) * Math.sin(th0)], q1 = [am - (r + mw) * Math.cos(th1), vs + (r + mw) * Math.sin(th1)];
      m.fq(T, F, [[p0[0], p0[1], pr], [p1[0], p1[1], pr], [q1[0], q1[1], pr], [q0[0], q0[1], pr]], [0, 0, 1], { col: tc });
      m.fq(T, F, [[q0[0], q0[1], 0], [q1[0], q1[1], 0], [q1[0], q1[1], pr], [q0[0], q0[1], pr]], [-Math.cos((th0 + th1) / 2), Math.sin((th0 + th1) / 2), 0], { col: tc });
    }
    // jamb strips
    m.fbox(T, F, am - r - mw, am - r, vb, vs, 0, pr, { col: tc, skip: 'b' }); m.fbox(T, F, am + r, am + r + mw, vb, vs, 0, pr, { col: tc, skip: 'b' });
    // keystone
    m.fbox(T, F, am - 0.28, am + 0.28, vs + r - 0.05, vs + r + mw + 0.35, 0, pr + 0.1, { col: tc, skip: 'b' });
    // impost blocks
    m.fbox(T, F, am - r - mw - 0.12, am - r + 0.05, vs - 0.15, vs + 0.15, 0, pr + 0.05, { col: tc, skip: 'b' }); m.fbox(T, F, am + r - 0.05, am + r + mw + 0.12, vs - 0.15, vs + 0.15, 0, pr + 0.05, { col: tc, skip: 'b' });
  }
}

/** open loggia / colonnade box: recessed lit interior, balustrade, paired columns */
function loggia(m, F, cell, o, rnd, B) {
  const [A0, A1, V0, V1] = cell, ins = o.margin ?? 0.5, a0 = A0 + ins, a1 = A1 - ins, vb = V0 + 0.0, vt = V1 - (o.head ?? 0.85), rev = o.rev ?? 1.6, col = B.wallCol, w = B.wall, T = B.trim, tc = B.trimCol;
  wallRect(m, F, w, A0, a0, V0, V1, col); wallRect(m, F, w, a1, A1, V0, V1, col); wallRect(m, F, w, a0, a1, vt, V1, col);
  m.fq(w, F, [[a0, vb, 0], [a1, vb, 0], [a1, vb, -rev], [a0, vb, -rev]], [0, 1, 0], { col });
  m.fq(w, F, [[a0, vt, -rev], [a1, vt, -rev], [a1, vt, 0], [a0, vt, 0]], [0, -1, 0], { col });
  m.fq(w, F, [[a0, vb, 0], [a0, vb, -rev], [a0, vt, -rev], [a0, vt, 0]], [1, 0, 0], { col });
  m.fq(w, F, [[a1, vb, -rev], [a1, vb, 0], [a1, vt, 0], [a1, vt, -rev]], [-1, 0, 0], { col });
  const k = 0.5 + rnd() * 0.3;
  m.fq('glass', F, [[a0, vb, -rev], [a1, vb, -rev], [a1, vt, -rev], [a0, vt, -rev]], [0, 0, 1], { cols: [[0.5 * k, 0.3 * k, 0.15 * k], [0.5 * k, 0.3 * k, 0.15 * k], [1.4 * k, 0.85 * k, 0.4 * k], [1.4 * k, 0.85 * k, 0.4 * k]] });
  // balustrade
  const bh = 0.95, d0 = 0.05, nP = Math.max(4, Math.round((a1 - a0) / 0.32));
  m.fbox(T, F, a0, a1, vb, vb + 0.16, d0 - 0.08, d0 + 0.3, { col: tc, skip: 'b' });
  for (let i = 0; i < nP; i++) { const a = a0 + 0.12 + (a1 - a0 - 0.3) * (i + 0.5) / nP; m.fbox(T, F, a - 0.07, a + 0.07, vb + 0.16, vb + bh, d0, d0 + 0.14, { col: tc, skip: 'btlr' }); }
  m.fbox(T, F, a0, a1, vb + bh, vb + bh + 0.1, d0 - 0.06, d0 + 0.22, { col: tc, skip: 'b' });
  // columns (round) + architrave
  const nc = o.cols ?? 2; const bw = a1 - a0;
  for (let i = 0; i < nc; i++) { const a = a0 + bw * (i + 0.5) / nc; column(m, F, a, vb + bh + 0.1, vt - 0.05, 0.19, T, tc); }
  m.fbox(T, F, a0 - 0.05, a1 + 0.05, vt - 0.05, vt + 0.22, -0.1, 0.35, { col: tc, skip: 'b' });
}

function column(m, F, a, v0, v1, r, bucket, col) {
  const P = m.P(F, a, v0, 0.15); const h = v1 - v0;
  m.lathe(bucket, P[0], P[2], [[r * 1.45, 0], [r * 1.45, 0.14], [r * 1.15, 0.2], [r * 1.0, 0.35], [r * 0.9, h - 0.55], [r * 1.0, h - 0.4], [r * 1.35, h - 0.25], [r * 1.5, h - 0.14], [r * 1.5, h]], 9, { y0: v0, col, uvS: 2 });
  m.disc(bucket, P[0], v0 + h, P[2], r * 1.5, 9, { col });
}

// ---------------------------------------------------------------------------- the building
/**
 * m: Mesher, ringIn: [[x,z]..], o: {
 *   wall:'rose', trim:'rose', plinthMat:'basalt', tint:[r,g,b], trimTint, y0, plinth:1.3,
 *   floors:[{h, kind:'win'|'arch'|'archwin'|'loggia'|'blank'|'door', ww, wh, sill, ped, lit, rev, ...}],
 *   bayW, cornice:{fh, dentils, blocks}, roof:{kind:'hip'|'flat'|'none', rise, inset, mat}, balustrade:bool,
 *   pilasters:{from,to,w,proj}, strings:[floorIndexAbove...], edge:(i,a,b,L)=>undefined|'skip'|'plain'|{floors?...}, seed }
 */
export function building(m, ringIn, o) {
  const ring = orient(simplify(ringIn, o.minEdge ?? 0.45));
  const gy = m.gy, n = ring.length, R = rng(o.seed ?? 7);
  const gmin = Math.min(...ring.map(p => gy(p[0], p[1])));
  const y0 = o.y0 ?? gmin + 0.12, ph = o.plinth ?? 1.3;
  const wallB = o.wall ?? 'rose', trimB = o.trim ?? wallB;
  const tint = o.tint ?? [1, 1, 1], trimTint = o.trimTint ?? [1.12, 1.1, 1.06];
  const B = { wall: wallB, trim: trimB, wallCol: tint, trimCol: trimTint, frameCol: [0.85, 0.82, 0.75], plain: false };
  const yFloor0 = y0 + ph; let yTop = yFloor0; for (const f of o.floors) yTop += f.h;
  const info = { ring, y0, yFloor0, yTop, edges: [] };
  const topH = yTop - y0;
  const skipE = ring.map((a, i) => { const b = ring[(i + 1) % n], e = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(e[0], e[1]) || 1; if (l < 0.6) return true; if (!o.hidden) return false; const nx = e[1] / l, nz = -e[0] / l; const hh = o.hidden([(a[0] + b[0]) / 2 + nx * 0.8, (a[1] + b[1]) / 2 + nz * 0.8], o.selfId); return hh >= 0.5 * topH; });
  info.skipE = skipE;
  // plinth
  if (!o.noPlinth) profileRing(m, o.plinthMat ?? 'basalt', ring, [[0.2, p => gy(p[0], p[1]) - 0.9], [0.2, yFloor0 - 0.12], [0.05, yFloor0 - 0.12], [0.05, yFloor0]], {});
  const rootRnd = R;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n]; const F = frameOf(a, b); if (F.L < 0.6) continue;
    if (skipE[i]) continue; const ov = o.edge ? o.edge(i, a, b, F.L) : undefined; if (ov === 'skip') continue;
    const Bi = { ...B, plain: ov === 'plain' || (ov && ov.plain) || false };
    if (ov && ov.tint) Bi.wallCol = ov.tint;
    const floors = (ov && ov.floors) || o.floors;
    const bayW = (ov && ov.bayW) || o.bayW || 4.6;
    const nB = Math.max(1, Math.round(F.L / bayW)), bw = F.L / nB;
    const rnd = rng((o.seed ?? 7) * 131 + i * 17);
    info.edges.push({ i, a, b, F, nB, bw, plain: Bi.plain });
    // wall below first floor to the plinth is covered by plinth ledge; floors:
    let y = yFloor0;
    floors.forEach((f, fi) => {
      const dv = f.div ?? 1, nC = nB * dv, cw = bw / dv;
      for (let k = 0; k < nC; k++) {
        const cell = [k * cw, (k + 1) * cw, y, y + f.h];
        const kind = (typeof f.kind === 'function') ? f.kind(k, nC, i) : f.kind;
        const lit = f.lit ?? o.lit ?? 0.2;
        if (kind === 'blank') wallRect(m, F, wallB, cell[0], cell[1], y, y + f.h, Bi.wallCol);
        else if (kind === 'arch' || kind === 'door' || kind === 'archwin') {
          const aw = f.aw ?? (kind === 'archwin' ? Math.min(f.ww ?? 1.5, cw - 1) : cw - (f.pier ?? 1.5));
          const vs = f.vs ?? (kind === 'archwin' ? f.sill + f.wh : f.h * 0.62);
          archOpening(m, F, cell, { aw, vb: kind === 'archwin' ? (f.sill ?? 0.3) : 0, vs, rev: f.rev ?? (kind === 'archwin' ? 0.4 : 1.8), deep: kind !== 'archwin', lit, mould: f.mould, mw: f.mw }, rnd, Bi);
        } else if (kind === 'loggia') loggia(m, F, cell, { margin: f.margin, head: f.head, rev: f.rev, cols: f.cols }, rnd, Bi);
        else rectWindow(m, F, cell, { ww: f.ww ?? 1.5, wh: f.wh ?? f.h * 0.6, sill: f.sill ?? f.h * 0.22, ped: typeof f.ped === 'function' ? f.ped(k, nC) : f.ped, lit, rev: f.rev, trim: f.trim, balc: typeof f.balc === 'function' ? f.balc(k, nC) : f.balc }, rnd, Bi);
      }
      y += f.h;
    });
    // pilasters at bay boundaries
    if (o.pilasters && !Bi.plain && !(ov && ov.nopil)) {
      const P = o.pilasters, pw = P.w ?? 0.6, pr = P.proj ?? 0.16; let yb = yFloor0, yt = yFloor0, yy = yFloor0;
      floors.forEach((f, fi) => { if (fi === P.from) yb = yy; yy += f.h; if (fi === P.to) yt = yy; });
      for (let k = 0; k <= nB; k++) {
        let a0 = k * bw - pw / 2, a1 = k * bw + pw / 2; if (k === 0) { a0 = 0; a1 = pw; } if (k === nB) { a1 = F.L; a0 = F.L - pw; }
        m.fbox(trimB, F, a0, a1, yb, yt, 0, pr, { col: Bi.wallCol, skip: 'b' });
        m.fbox(trimB, F, a0 - 0.08, a1 + 0.08, yb, yb + 0.5, 0, pr + 0.05, { col: Bi.trimCol, skip: 'b' });
        m.fbox(trimB, F, a0 - 0.12, a1 + 0.12, yt - 0.55, yt, 0, pr + 0.1, { col: Bi.trimCol, skip: 'b' });
      }
    }
    // string courses written at ring level below
    info.edges[info.edges.length - 1].rnd = rnd;
  }
  // string courses
  if (o.strings) { let yy = yFloor0; o.floors.forEach((f, fi) => { if (fi > 0 && o.strings.includes(fi)) profileRing(m, trimB, ring, [[0, yy], [0.2, yy], [0.2, yy + 0.3], [0, yy + 0.3]], { col: trimTint }); yy += f.h; }); }
  // cornice
  const C = o.cornice ?? {}, fh = C.fh ?? 0.9;
  const yT = yTop;
  const prof = [[0, yT], [0, yT + fh], [0.35, yT + fh], [0.35, yT + fh + 0.25], [0.72, yT + fh + 0.55], [0.98, yT + fh + 0.55], [0.98, yT + fh + 0.9], [0.62, yT + fh + 1.0], [0.62, yT + fh + 1.12]];
  profileRing(m, trimB, ring, prof, { col: trimTint });
  const yCor = yT + fh + 1.12; info.yCor = yCor; info.corOut = 0.62;
  // frieze blocks + dentils on exposed edges
  for (const E of info.edges) {
    const { F, nB } = E; if (E.plain) continue;
    if (C.dentils !== false) { const nd = Math.floor(F.L / 0.55); for (let k = 0; k < nd; k++) { const a = 0.3 + k * (F.L - 0.6) / nd; m.fbox(trimB, F, a, a + 0.26, yT + fh - 0.3, yT + fh, 0, 0.3, { col: trimTint, skip: 'btlr' }); } }
    if (C.blocks !== false) { const nb = Math.floor(F.L / 1.5); for (let k = 0; k < nb; k++) { const a = (k + 0.5) * F.L / nb; m.fbox(trimB, F, a - 0.35, a + 0.35, yT + 0.18, yT + fh - 0.38, 0, 0.07, { col: [0.88, 0.85, 0.82], skip: 'btlr' }); } }
  }
  // attic / parapet + balustrade
  let yRoof = yCor;
  if (o.balustrade) {
    const bo = 0.5, bh = o.balH ?? 1.0;
    profileRing(m, trimB, ring, [[bo + 0.12, yCor], [bo + 0.12, yCor + 0.28], [bo + 0.05, yCor + 0.28]], { col: trimTint });
    const Rb = offsetRing(ring, bo);
    for (let i = 0; i < n; i++) {
      const a = Rb[i], b = Rb[(i + 1) % n], F = frameOf(a, b); if (F.L < 0.5 || skipE[i]) continue; if (o.edge && o.edge(i, ring[i], ring[(i + 1) % n], F.L) === 'skip') continue;
      const np = Math.max(2, Math.floor(F.L / 0.42));
      for (let k = 0; k < np; k++) { const aa = (k + 0.5) * F.L / np; m.fbox(trimB, F, aa - 0.09, aa + 0.09, yCor + 0.28, yCor + 0.28 + bh, -0.09, 0.09, { col: trimTint, skip: 'btlr' }); }
      m.fbox(trimB, F, 0, F.L, yCor + 0.28 + bh, yCor + 0.28 + bh + 0.14, -0.14, 0.14, { col: trimTint, skip: 'b' });
      const pc = Math.max(1, Math.round(F.L / 6));
      for (let k = 0; k <= pc; k++) { const aa = Math.min(F.L - 0.2, Math.max(0.2, k * F.L / pc)); m.fbox(trimB, F, aa - 0.2, aa + 0.2, yCor + 0.28, yCor + 0.28 + bh + 0.35, -0.2, 0.2, { col: trimTint }); }
    }
    yRoof = yCor + 0.28;
  }
  // floodlight fixtures + warm ground glow along exposed facades
  if (o.lights !== false) for (const E of info.edges) {
    if (E.plain) continue; const { F } = E, step = o.lightStep ?? 9, nl = Math.max(1, Math.floor(F.L / step));
    for (let k = 0; k < nl; k++) {
      const a = (k + 0.5) * F.L / nl, c = m.P(F, a, 0, 0), gyc = gy(c[0], c[2]);
      const lc = [3.5, 2.2, 1.0];
      m.fbox('lamp', F, a - 0.25, a + 0.25, gyc + 0.05 - F.o[1] * 0, gyc + 0.25, 0.55, 0.85, { col: lc, skip: 'b' });
      const S = 5.0, D = 6.5, k2 = 0.5 * (o.glow ?? 1), col = [0.62 * k2, 0.34 * k2, 0.13 * k2], y = gyc + 0.24;
      m.face('decal', [m.P(F, a - S, y, 0.3), m.P(F, a + S, y, 0.3), m.P(F, a + S, y, D), m.P(F, a - S, y, D)].map(p => [p[0], y, p[2]]), [0, 1, 0], { col, uvFn: (i) => [[0, 0], [1, 0], [1, 1], [0, 1]][i] });
    }
  }
  // roof
  const rf = o.roof ?? { kind: 'flat' };
  if (rf.kind === 'hip') {
    const eave = offsetRing(ring, info.corOut - 0.02), rise = rf.rise ?? 3;
    let per = 0; for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const arA = Math.abs(area2(ring)), inr = arA / per;
    const dI = rf.apex ? inr * 1.92 : Math.min((rf.inset ?? 4) - 0.62, inr * 0.95);
    const inset = dI + 0.62;
    const ridge = offsetRing(ring, -dI);
    const rc = rf.col ?? [1, 1, 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, e = [ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]], l = Math.hypot(e[0], e[1]); if (l < 1e-3) continue;
      const hn = [e[1] / l, 0, -e[0] / l];
      m.quad(rf.mat ?? 'tile', [eave[i][0], yRoof, eave[i][1]], [eave[j][0], yRoof, eave[j][1]], [ridge[j][0], yRoof + rise, ridge[j][1]], [ridge[i][0], yRoof + rise, ridge[i][1]], [hn[0] * rise, 0.6 + dI, hn[2] * rise], { col: rc, uvS: rf.uvS ?? 3 });
    }
    m.face(rf.mat ?? 'tile', ridge.map(p => [p[0], yRoof + rise, p[1]]), [0, 1, 0], { col: rc, uvS: rf.uvS ?? 3 });
    info.yRoof = yRoof + rise;
  } else if (rf.kind === 'flat') {
    const eave = offsetRing(ring, info.corOut - 0.02);
    m.face('roofflat', eave.map(p => [p[0], yRoof, p[1]]), [0, 1, 0], { uvS: 6 });
    info.yRoof = yRoof;
  } else info.yRoof = yRoof;
  return info;
}

// ---------------------------------------------------------------------------- exports for other modules
export { rectWindow, archOpening, loggia, column, frameOf, glassCols, WARM, DARK };
