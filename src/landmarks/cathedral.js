// Saint Gregory the Illuminator Cathedral (Yerevan, 2001): cruciform sand-coloured tuff hall, folded gabled roofs, tall 12-sided drum with a conical cap.
import { building } from './facade.js';
import { TAU } from './kit.js';

export function buildCathedral(m, fp) {
  const ring = fp.lm[31622320].rings[0], gy = m.gy;
  const y0 = Math.min(...ring.map(p => gy(p[0], p[1]))) + 0.15;
  const common = { wall: 'cream', trim: 'cream', tint: [1.0, 0.95, 0.86], plinth: 1.0, bayW: 5.0, lit: 0.2, glow: 1.2, lightStep: 10 };
  // low body following the OSM outline: lancet windows, hipped (folded) stone roof
  const body = building(m, ring, { ...common, y0, floors: [{ h: 7.5, kind: 'archwin', aw: 1.6, ww: 1.6, sill: 1.5, wh: 4.4, vs: 5.4, rev: 0.8, lit: 0.35 }, { h: 6.0, kind: 'blank' }], cornice: { fh: 0.8 }, roof: { kind: 'hip', rise: 9.5, inset: 9, mat: 'cream', uvS: 9, col: [0.95, 0.9, 0.82] }, seed: 81, lights: true });
  // central drum
  const C = [365.5, 626.5], R = 10.6, n = 12, poly = []; for (let i = 0; i < n; i++) { const a = TAU * (i + 0.5) / n; poly.push([C[0] + Math.cos(a) * R, C[1] + Math.sin(a) * R]); }
  const yb = body.yRoof - 3;
  const drum = building(m, poly, { ...common, y0: yb, noPlinth: true, plinth: 0, floors: [{ h: 9, kind: 'blank' }, { h: 10, kind: 'archwin', aw: 1.5, ww: 1.5, sill: 1.2, wh: 6.5, vs: 6.8, rev: 0.9, lit: 0.5 }], bayW: 6.5, cornice: { fh: 0.9 }, roof: { kind: 'hip', rise: 16, apex: true, mat: 'cream', uvS: 9, col: [0.93, 0.88, 0.8] }, seed: 82, lights: false });
  m.lathe('metal', C[0], C[1], [[0.18, 0], [0.18, 4.2], [0.05, 4.5]], 6, { y0: drum.yRoof });
  m.fbox('metal', { o: [C[0], 0, C[1]], t: [1, 0], n: [0, 1] }, -1.1, 1.1, drum.yRoof + 2.8, drum.yRoof + 3.1, -0.1, 0.1, { col: [1, 1, 1] });
  m.fbox('metal', { o: [C[0], 0, C[1]], t: [1, 0], n: [0, 1] }, -0.1, 0.1, drum.yRoof + 1.9, drum.yRoof + 4.2, -0.1, 0.1, { col: [1, 1, 1] });
  // smaller flanking chapels: low drums with cones
  for (const [cx, cz, r, h] of [[322, 604, 5.5, 8], [322, 640, 4.8, 7]]) {
    const p = []; for (let i = 0; i < 10; i++) { const a = TAU * (i + 0.5) / 10; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    building(m, p, { ...common, y0: y0 + 0.2, floors: [{ h: h + 4, kind: 'archwin', aw: 1.1, ww: 1.1, sill: 1.2, wh: 4.2, vs: 5.2, rev: 0.6, lit: 0.3 }], bayW: 6, cornice: { fh: 0.5 }, roof: { kind: 'hip', rise: 8, apex: true, mat: 'cream', uvS: 9, col: [0.93, 0.88, 0.8] }, seed: 83, lights: false });
  }
}
