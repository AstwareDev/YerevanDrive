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
  const out = [];
  for (const id of ids) {
    const rec = fp.lm[id]; if (!rec) continue;
    const L = Math.max(4, Math.round(rec.levels || 8)), h = hash(id);
    const wallB = h < 0.45 ? 'rose' : h < 0.8 ? 'cream' : 'white';
    const tint = wallB === 'rose' ? [1.03, 0.97, 0.93] : [1, 0.98, 0.95];
    const mid = [];
    for (let i = 1; i < L - 1; i++) mid.push({ h: 3.3, kind: 'win', ww: 1.5, wh: 2.1, sill: 0.85, trim: i < 4, lit: 0.22, balc: (k) => i % 2 === 0 && k % 3 === 1 });
    const top = { h: 3.3, kind: 'win', ww: 1.5, wh: 2.0, sill: 0.8, ped: 'seg', lit: 0.2 };
    const ground = { h: 5.4, kind: 'arch', pier: 1.0, vs: 3.7, rev: 1.5 };
    const groundPlain = { h: 5.4, kind: 'win', ww: 1.5, wh: 2.6, sill: 1.0, lit: 0.25 };
    const floors = [ground, ...mid, top], plainFloors = [groundPlain, ...mid, top];
    const ring = rec.rings[0];
    out.push(building(m, ring, {
      wall: wallB, trim: wallB, tint, plinth: 1.0, floors, bayW: 3.9, hidden, selfId: id, seed: id % 997 + 3, lit: 0.22,
      pilasters: { from: 1, to: L - 1, w: 0.5, proj: 0.14 }, cornice: { fh: 0.9 }, balustrade: h > 0.5, balH: 0.9, roof: { kind: 'flat' }, lightStep: 11, strings: [1, L - 1],
      edge: (i, a, b, Len) => {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = [(b[1] - a[1]) / Len, -(b[0] - a[0]) / Len];
        const q = nearestOnAV(mid), dx = q.p[0] - mid[0], dz = q.p[1] - mid[1], dl = Math.hypot(dx, dz) || 1;
        const facesAv = q.d < 38 && (n[0] * dx + n[1] * dz) / dl > 0.35;
        return facesAv && Len > 3 ? undefined : { floors: plainFloors, plain: true };
      },
    }));
  }
  return out;
}
