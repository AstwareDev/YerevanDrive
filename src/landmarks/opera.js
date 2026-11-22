// Yerevan Opera House (Spendiaryan Theatre) at Freedom Square, end of Northern Avenue.
// Footprint from OSM relation 1267677. Facade from Wikimedia photos: warm-grey tuff, a two-storey half-round front (brown doors under tall arched windows with
// wooden fanlights, pilasters with carved capital blocks, ornament frieze), an open paired-column colonnade tier on the main-hall drum, flat roofs with stepped attics,
// wide steps, bronze statues of Spendiaryan and Tamanyan on pink pedestals.
import { building } from './facade.js';
import { TAU } from './kit.js';

const BROWN = [0.5, 0.33, 0.2];

/** seated bronze figure on a stepped pink pedestal, facing yaw (0 = +z) */
function statue(m, x, z, yaw) {
  const gy = m.gy(x, z), t = [Math.cos(yaw), -Math.sin(yaw)], n = [Math.sin(yaw), Math.cos(yaw)], F = { o: [x, 0, z], t, n };
  m.fbox('pink', F, -3.6, 3.6, gy, gy + 0.5, -3.6, 3.6, { col: [0.72, 0.56, 0.54] }); m.fbox('pink', F, -3.0, 3.0, gy + 0.5, gy + 1.1, -3.0, 3.0, { col: [0.72, 0.56, 0.54] });
  m.fbox('pink', F, -2.0, 2.0, gy + 1.1, gy + 4.6, -1.7, 1.7, { col: [0.66, 0.5, 0.48] }); m.fbox('pink', F, -2.35, 2.35, gy + 4.6, gy + 5.0, -2.0, 2.0, { col: [0.76, 0.6, 0.58] });
  const y = gy + 5.0, g = 'bronze', c = [1, 1, 1];
  m.fbox(g, F, -0.9, 0.9, y, y + 0.6, -0.9, 1.0, { col: c });                        // seat
  m.fbox(g, F, -0.8, 0.8, y + 0.6, y + 2.3, -0.8, 0.3, { col: c });                  // torso
  m.fbox(g, F, -0.75, 0.75, y + 0.6, y + 1.0, 0.3, 1.9, { col: c });                 // thighs
  m.fbox(g, F, -0.55, -0.15, y, y + 0.7, 1.7, 2.1, { col: c }); m.fbox(g, F, 0.15, 0.55, y, y + 0.7, 1.7, 2.1, { col: c });   // shins
  m.lathe(g, x + n[0] * -0.25, z + n[1] * -0.25, [[0.0, 0], [0.34, 0.12], [0.36, 0.45], [0.2, 0.62], [0.001, 0.66]], 10, { y0: y + 2.3, col: c });   // head
  m.fbox(g, F, 0.5, 1.0, y + 1.3, y + 1.9, 0.45, 1.0, { col: [0.8, 0.8, 0.8] });   // book / score
}

export function buildOpera(m) {
  const gy = m.gy, C = [198.5, -950], R = 33;
  const y0 = gy(201, -930) + 0.1;
  const G = { wall: 'grey', trim: 'grey', tint: [1, 0.985, 0.96], trimTint: [1.1, 1.08, 1.04], frameCol: BROWN, plinthMat: 'grey' };
  // shared front elevation: brown doors + tall arched windows with fanlights, pilasters, ornament belt
  const front = [
    { h: 5.4, kind: 'win', ww: 2.3, wh: 4.4, sill: 0.1, rev: 0.6, lit: 0.55, trim: true },   // tall brown doors
    { h: 9.2, kind: 'archwin', aw: 3.4, ww: 3.4, sill: 0.9, wh: 6.6, vs: 6.2, rev: 0.75, lit: 0.5, mw: 0.5 },
  ];
  // ---- main hall drum (NORTH): same two storeys, then an open paired-column colonnade tier, flat roof with a stepped attic
  const poly = []; for (let i = 0; i < 32; i++) { const a = TAU * i / 32; poly.push([C[0] + Math.cos(a) * R, C[1] + Math.sin(a) * R]); }
  const d = building(m, poly, { ...G, plinth: 1.2, y0, floors: [...front, { h: 7.6, kind: 'loggia', cols: 2, rev: 2.2, margin: 0.6, head: 1.0 }], bayW: 6.4, pilasters: { from: 0, to: 1, w: 0.7, proj: 0.24 }, cornice: { fh: 1.3 }, balustrade: true, balH: 0.9, roof: { kind: 'flat' }, seed: 71, lit: 0.3, lightStep: 8, strings: [1, 2] });
  const att = []; for (let i = 0; i < 24; i++) { const a = TAU * i / 24; att.push([C[0] + Math.cos(a) * (R - 8), C[1] + Math.sin(a) * (R - 8)]); }
  m.prism('grey', att, d.yRoof, d.yRoof + 4.2, { col: [1.0, 0.98, 0.94] });                         // stepped attic over the hall
  m.prism('roofflat', att.map(p => [C[0] + (p[0] - C[0]) * 1.02, C[1] + (p[1] - C[1]) * 1.02]), d.yRoof + 4.2, d.yRoof + 4.45, { col: [1, 1, 1] });
  for (let k = 0; k < 7; k++) { const a = TAU * k / 7 + 0.3, x = C[0] + Math.cos(a) * 9, z = C[1] + Math.sin(a) * 9; m.cyl('metal', x, d.yRoof + 4.4, z, 0.06, 6 + (k % 3), 5, { col: [0.7, 0.72, 0.75] }); }   // roof antennas
  // ---- central stage block + wings
  const block = [[157, -906], [247.5, -906], [247.5, -915], [254, -920], [254, -935], [248, -941], [248, -950], [159, -950], [159, -941], [152, -935], [152, -927], [157, -921]];
  building(m, block, { ...G, plinth: 1.2, y0, floors: [{ h: 7.5, kind: 'win', ww: 1.8, wh: 3.6, sill: 1.0, ped: 'tri' }, { h: 7.0, kind: 'win', ww: 1.8, wh: 3.6, sill: 1.0, ped: 'seg' }, { h: 4.5, kind: 'win', ww: 1.6, wh: 2.2, sill: 0.8 }], bayW: 5.2, pilasters: { from: 0, to: 2, w: 0.7, proj: 0.2 }, cornice: { fh: 1.0 }, balustrade: true, roof: { kind: 'flat' }, seed: 72, lit: 0.25, strings: [1, 2] });
  // ---- south front (+z): stepped half-round terraces + the two-storey rotunda wall
  const SC = [201.5, -907.5], A = 32.4, Bz = 32.4;
  const half = (a, b, n = 36) => { const p = []; for (let i = 0; i <= n; i++) { const t = Math.PI * i / n; p.push([SC[0] + Math.cos(t) * a, SC[1] + Math.sin(t) * b]); } return p; };
  const steps = [[1.0, 0.45], [0.965, 0.9], [0.93, 1.35], [0.895, 1.8], [0.86, 2.25], [0.83, 2.7]];
  for (const [f, h] of steps) m.prism('grey', half(A * f, Bz * f), y0 - 1.0, y0 + h, { col: [1.03, 1.01, 0.97] });
  const ya = y0 + 2.7;
  const rot = building(m, half(26.4, 26.4, 14), { ...G, plinth: 0.0, noPlinth: true, y0: ya, floors: front, bayW: 6.0, pilasters: { from: 0, to: 1, w: 0.85, proj: 0.3 }, cornice: { fh: 1.4 }, balustrade: true, balH: 1.0, roof: { kind: 'flat' }, seed: 73, lit: 0.55, lights: false, strings: [1] });
  // ornament frieze (carved band) + pilaster capital blocks read as shadow rhythm on the entablature
  const nb = 56; for (let i = 0; i <= nb; i++) { const t = Math.PI * (i + 0.5) / (nb + 1), px = SC[0] + Math.cos(t) * 26.5, pz = SC[1] + Math.sin(t) * 26.5, F = { o: [px, 0, pz], t: [-Math.sin(t), Math.cos(t)], n: [Math.cos(t), Math.sin(t)] }; m.fbox('grey', F, -0.38, 0.38, rot.yRoof - 3.0, rot.yRoof - 1.9, 0, 0.18, { col: [0.82, 0.78, 0.74] }); }
  // carved capital blocks crowning every pilaster of the rotunda (big console + small impost), as in the photos
  for (const E of rot.edges) { const { F, nB, bw } = E; for (let k = 0; k <= nB; k++) { const a = Math.min(F.L - 0.8, Math.max(0.8, k * bw));
    m.fbox('grey', F, a - 0.8, a + 0.8, rot.yTop - 1.5, rot.yTop - 0.15, 0, 0.6, { col: [0.9, 0.86, 0.82], skip: 'b' }); m.fbox('grey', F, a - 0.55, a + 0.55, rot.yTop - 2.1, rot.yTop - 1.5, 0, 0.45, { col: [0.84, 0.8, 0.76], skip: 'b' });
    m.fbox('grey', F, a - 0.62, a + 0.62, rot.yFloor0 + front[0].h - 0.45, rot.yFloor0 + front[0].h + 0.1, 0, 0.42, { col: [0.95, 0.92, 0.88], skip: 'b' }); } }
  // set-back colonnade tier (paired columns, balustrade) and attic over the rotunda
  const col2 = building(m, half(20.6, 20.6, 14), { ...G, noPlinth: true, plinth: 0, y0: rot.yRoof, floors: [{ h: 7.2, kind: 'loggia', cols: 2, rev: 1.8, margin: 0.35, head: 1.0 }], bayW: 4.6, cornice: { fh: 1.0 }, balustrade: true, balH: 0.85, roof: { kind: 'flat' }, seed: 74, lit: 0.6, lights: false });
  building(m, half(15.5, 15.5, 10), { ...G, noPlinth: true, plinth: 0, y0: col2.yRoof, floors: [{ h: 3.2, kind: 'blank' }], bayW: 6, cornice: { fh: 0.7, dentils: false }, roof: { kind: 'flat' }, seed: 75, lights: false });
  // tall corner blocks where the rotunda meets the wings, and the fly tower over the stage
  for (const sg of [-1, 1]) { const cx = SC[0] + sg * 27.5, cz = SC[1] - 5.5, w = 4.8; building(m, [[cx - w, cz - w], [cx + w, cz - w], [cx + w, cz + w], [cx - w, cz + w]], { ...G, plinth: 1.2, y0, floors: [{ h: 5.4, kind: 'blank' }, { h: col2.yRoof - y0 - 5.4 + 2.5, kind: 'win', ww: 1.2, wh: 2.2, sill: 9, lit: 0.2 }], bayW: 9.6, pilasters: { from: 0, to: 1, w: 0.7, proj: 0.2 }, cornice: { fh: 1.2 }, roof: { kind: 'flat' }, seed: 76, lights: false }); }
  building(m, [[185, -942], [218, -942], [218, -922], [185, -922]], { ...G, noPlinth: true, plinth: 0, y0: y0 + 18, floors: [{ h: col2.yRoof - y0 - 18 + 6, kind: 'blank' }], bayW: 8, cornice: { fh: 1.0 }, roof: { kind: 'flat' }, seed: 77, lights: false });
  // flagpoles along the east side of the square
  for (let k = 0; k < 8; k++) { const x = 262 + k * 4.2, z = -878; m.cyl('frame', x, m.gy(x, z), z, 0.09, 14, 6, { col: [1.15, 1.15, 1.15] }); }
  // statues in the square, either side of the front
  statue(m, SC[0] - 52, SC[1] + 28, 0.1); statue(m, SC[0] + 52, SC[1] + 28, -0.1);
  return d;
}
