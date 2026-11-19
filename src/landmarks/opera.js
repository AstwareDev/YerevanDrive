// Yerevan Opera House (Spendiaryan Theatre) at Freedom Square, end of Northern Avenue.
// Footprint from OSM relation 1267677 / aerial: drum of the main hall (north), stage block (middle), stepped semi-elliptical colonnaded front (south).
import { building, column, frameOf } from './facade.js';
import { TAU } from './kit.js';

export function buildOpera(m) {
  const gy = m.gy, C = [198.5, -950], R = 33;
  const y0 = gy(201, -930) + 0.1;
  // ---- main hall drum (NORTH end, z=-950) with shallow copper dome; the stepped colonnaded front faces SOUTH (Freedom Square / Northern Avenue)
  const poly = []; for (let i = 0; i < 32; i++) { const a = TAU * i / 32; poly.push([C[0] + Math.cos(a) * R, C[1] + Math.sin(a) * R]); }
  const drumFloors = [{ h: 8.0, kind: 'arch', pier: 2.4, vs: 4.6, rev: 1.6 }, { h: 8.0, kind: 'archwin', aw: 2.6, ww: 2.6, sill: 1.2, wh: 4.2, vs: 5.2, rev: 0.6, lit: 0.18 }, { h: 5.5, kind: 'win', ww: 1.6, wh: 2.6, sill: 1.2, ped: 'seg', lit: 0.12 }];
  const d = building(m, poly, { wall: 'cream', trim: 'cream', tint: [1, 0.98, 0.94], plinth: 1.2, y0, floors: drumFloors, bayW: 6.4, pilasters: { from: 1, to: 2, w: 0.6, proj: 0.18 }, cornice: { fh: 1.1 }, balustrade: true, balH: 0.9, roof: { kind: 'none' }, seed: 71, lit: 0.15, lightStep: 8, strings: [1, 2] });
  // dome: flat tuff saucer with copper-green cap and lantern
  const yd = d.yRoof, prof = [[R - 0.7, 0], [R - 0.7, 0.8]];
  for (let i = 1; i <= 10; i++) { const t = i / 10, r = (R - 0.7) * (1 - t); prof.push([r, 0.8 + 12.5 * Math.sin(t * Math.PI / 2) * (1 - 0.18 * t)]); }
  m.lathe('copper', C[0], C[1], prof.map((p, i) => [Math.max(p[0], 0.001), p[1]]), 40, { y0: yd, uRad: 20, uS: 6, uvS: 6 });
  m.lathe('cream', C[0], C[1], [[2.6, 12.9], [2.6, 15.2], [2.1, 15.6], [0.2, 15.9]], 14, { y0: yd });
  // ---- central stage block + wings
  const block = [[157, -906], [247.5, -906], [247.5, -915], [254, -920], [254, -935], [248, -941], [248, -950], [159, -950], [159, -941], [152, -935], [152, -927], [157, -921]];
  building(m, block, { wall: 'cream', trim: 'cream', tint: [1, 0.98, 0.94], plinth: 1.2, y0, floors: [{ h: 7.5, kind: 'win', ww: 1.8, wh: 3.6, sill: 1.0, ped: 'tri' }, { h: 7.0, kind: 'win', ww: 1.8, wh: 3.6, sill: 1.0, ped: 'seg' }, { h: 4.5, kind: 'win', ww: 1.6, wh: 2.2, sill: 0.8 }], bayW: 5.2, pilasters: { from: 0, to: 2, w: 0.7, proj: 0.2 }, cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, seed: 72, lit: 0.1, strings: [1, 2] });
  // ---- south front (+z): stepped half-round terraces + colonnaded rotunda
  const SC = [201.5, -907.5], A = 32.4, Bz = 32.4;
  const half = (a, b, n = 28) => { const p = []; for (let i = 0; i <= n; i++) { const t = Math.PI * i / n; p.push([SC[0] + Math.cos(t) * a, SC[1] + Math.sin(t) * b]); } return p; };
  const steps = [[1.0, 0.55], [0.93, 1.1], [0.86, 1.65], [0.8, 2.2]];
  for (const [f, h] of steps) m.prism('cream', half(A * f, Bz * f), y0 - 1.0, y0 + h, { col: [1.04, 1.02, 0.98] });
  const ya = y0 + 2.2;
  // lit wall of the rotunda
  const wallRing = half(20.5, 20.5);
  building(m, wallRing, { wall: 'cream', trim: 'cream', plinth: 0.0, noPlinth: true, y0: ya, floors: [{ h: 13.5, kind: 'archwin', aw: 2.6, ww: 2.6, sill: 0.6, wh: 8.0, vs: 8.6, rev: 0.7, lit: 0.5 }], bayW: 5.8, cornice: { fh: 0.9 }, roof: { kind: 'flat' }, seed: 73, lit: 0.5, lights: false });
  // columns + entablature
  const NC = 14, ca = 25.5, cb = 25.5, pts = [];
  for (let i = 0; i < NC; i++) { const t = Math.PI * (i + 0.5) / NC; pts.push([SC[0] + Math.cos(t) * ca, SC[1] + Math.sin(t) * cb, t]); }
  for (const p of pts) { const F = { o: [p[0], 0, p[1]], t: [1, 0], n: [0, 1] }; column(m, F, 0, ya, ya + 14.2, 0.55, 'cream', [1.06, 1.04, 1.0]); }
  for (let i = 0; i < NC - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), t = [dx / L, dz / L], n = [t[1], -t[0]];
    const F = { o: [a[0], 0, a[1]], t, n };
    m.fbox('cream', F, -0.6, L + 0.6, ya + 14.2, ya + 15.6, -0.9, 0.9, { col: [1.08, 1.05, 1.0] }); m.fbox('cream', F, -0.7, L + 0.7, ya + 15.6, ya + 16.2, -1.1, 1.1, { col: [1.1, 1.07, 1.02] });
  }
  return d;
}
