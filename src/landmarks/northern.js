// Northern Avenue (Hyusisayin poghota): tuff-clad 8-17 storey blocks with lit arcaded ground floors.
import { building } from './facade.js';

const AV = [[150, -267], [154, -329], [160, -404], [161, -416], [163, -446], [168, -497], [175, -576], [177, -589], [178, -604], [178, -608], [184, -698], [185, -710], [186, -720], [186, -726], [188, -739], [189, -752], [193, -794], [195, -819], [196, -835], [199, -872]];
function nearestOnAV(p) {
  let best = 1e9, q = null;
  for (let i = 1; i < AV.length; i++) {
    const a = AV[i - 1], b = AV[i], dx = b[0] - a[0], dz = b[1] - a[1]; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz); t = Math.max(0, Math.min(1, t));
    const x = a[0] + dx * t, z = a[1] + dz * t, d = Math.hypot(p[0] - x, p[1] - z); if (d < best) { best = d; q = [x, z]; }
  }
  return { d: best, p: q };
}
const hash = n => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

export function buildNorthern(m, fp, hidden) {
  const ids = fp.groups.northern || [];
  const out = [], H = id => hash(id);
  for (const id of ids) {
    const rec = fp.lm[id]; if (!rec) continue;
    const L = Math.max(4, Math.round(rec.levels || 8)), h = hash(id);
    const wallB = h < 0.45 ? 'rose' : h < 0.8 ? 'cream' : 'white';
    const tint = wallB === 'rose' ? [1.03, 0.97, 0.93] : [1, 0.98, 0.95];
    const mid = [];
    for (let i = 1; i < L - 1; i++) mid.push({ h: 3.3, kind: (k) => (i >= 2 && i % 2 === 0 && k % 2 === 0 ? 'archwin' : 'win'), aw: 1.9, ww: 1.8, wh: 2.3, sill: 0.7, rev: i % 2 === 0 ? 1.1 : 0.55, trim: i < 5, lit: 0.22, mw: 0.4, balc: (k) => i % 2 === 1 && k % 2 === 1 });
    const top = { h: 3.3, kind: 'win', ww: 1.5, wh: 2.0, sill: 0.8, ped: 'seg', lit: 0.2 };
    const ground = { h: 5.4, kind: 'arch', pier: 1.0, vs: 3.7, rev: 1.5, mw: 0.45 };
    const groundPlain = { h: 5.4, kind: 'win', ww: 1.5, wh: 2.6, sill: 1.0, lit: 0.25 };
    const floors = [ground, ...mid, top], plainFloors = [groundPlain, ...mid, top];
    const ring = rec.rings[0];
    const info = building(m, ring, {
      wall: wallB, trim: wallB, tint, frameCol: [0.4, 0.27, 0.2], plinth: 1.0, floors, bayW: 3.9, hidden, selfId: id, seed: id % 997 + 3, lit: 0.22,
      pilasters: { from: 1, to: L - 1, w: 0.5, proj: 0.14 }, cornice: { fh: 0.9 }, balustrade: h > 0.5, balH: 0.9, roof: { kind: 'flat' }, lightStep: 11, strings: [1, L - 1],
      edge: (i, a, b, Len) => {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = [(b[1] - a[1]) / Len, -(b[0] - a[0]) / Len];
        const q = nearestOnAV(mid), dx = q.p[0] - mid[0], dz = q.p[1] - mid[1], dl = Math.hypot(dx, dz) || 1;
        const facesAv = q.d < 38 && (n[0] * dx + n[1] * dz) / dl > 0.35;
        return facesAv && Len > 3 ? undefined : { floors: plainFloors, plain: true };
      },
    });
    const av = (a, b, Len) => { const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = [(b[1] - a[1]) / Len, -(b[0] - a[0]) / Len]; const q = nearestOnAV(mid), dx = q.p[0] - mid[0], dz = q.p[1] - mid[1], dl = Math.hypot(dx, dz) || 1; return q.d < 38 && (n[0] * dx + n[1] * dz) / dl > 0.35 && Len > 3; };
    info.avEdges = [];
    for (const E of info.edges) {
      if (E.plain || !av(E.a, E.b, E.F.L)) continue; info.avEdges.push(E);
      const { F, nB, bw } = E, yg = info.yFloor0;
      for (let k = 0; k < nB; k++) if (hash(id * 31 + E.i * 7 + k) < 0.6) {          // navy shop awnings over the arcade openings
        const a0 = k * bw + 0.5, a1 = (k + 1) * bw - 0.5, ya = yg + 3.0, col = hash(id + k) < 0.7 ? [0.1, 0.16, 0.34] : [0.34, 0.1, 0.1];
        m.fq('frame', F, [[a0, ya, 0.1], [a1, ya, 0.1], [a1, ya - 0.5, 1.5], [a0, ya - 0.5, 1.5]], [0, 1, 0.4], { col });
        m.fq('frame', F, [[a0, ya, 0.1], [a0, ya - 0.5, 1.5], [a0, ya - 0.5, 0.1]], [-1, 0, 0], { col }); m.fq('frame', F, [[a1, ya, 0.1], [a1, ya - 0.5, 0.1], [a1, ya - 0.5, 1.5]], [1, 0, 0], { col });
        m.fq('frame', F, [[a0, ya - 0.5, 1.5], [a1, ya - 0.5, 1.5], [a1, ya - 0.62, 1.5], [a0, ya - 0.62, 1.5]], [0, 0, 1], { col: [col[0] * 1.6, col[1] * 1.6, col[2] * 1.6] });
      }
      if (E.F.L > 9) m.fq('glass', F, [[0.6, info.yRoof, -0.3], [E.F.L - 0.6, info.yRoof, -0.3], [E.F.L - 0.6, info.yRoof + 3.2, -5.2], [0.6, info.yRoof + 3.2, -5.2]], [0, 1, 0.6], { cols: [[0.045, 0.07, 0.1], [0.045, 0.07, 0.1], [0.055, 0.085, 0.12], [0.055, 0.085, 0.12]], uvFn: i => [[0, 0], [1, 0], [1, 1], [0, 1]][i] });      // sloped glass roof (Northern Avenue skylights)
    }
    out.push(info);
  }
  return out;
}
