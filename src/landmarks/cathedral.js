// Saint Gregory the Illuminator Cathedral (Yerevan, 2001), modelled from the reference photos in .scratch/ref/lm (cath1, cath2).
// Pale peach limestone cruciform hall. The main (west) facade carries a stepped gable with a belfry, a three-order round-arched
// portal, two deep side arches and two wings with lean-to roofs, each wing capped by a four-gabled corner tower with a pyramid roof.
// A square central tower over the crossing has four gables and a pyramid roof. Fourteen steps descend west from the portal,
// lined by lamp standards (opal globes, gold crosses) and cypresses.
//
// Facade frame F = { o:[305.2,0,622], t:[0,-1], n:[-1,0] }: a grows toward -z (north is -z), d grows west (outward), v is absolute height.
// Heights are metres above yB = ground under the portal + 1 m.
import earcut from 'earcut';
import { building } from './facade.js';

const SAND = [1.0, 0.97, 0.9];        // limestone tint
const ROOF = [0.94, 0.88, 0.78];      // pitched roofs
const MOULD = [1.08, 1.03, 0.94];     // cornices, caps, bands
const CARVE = [0.88, 0.8, 0.7];       // cross reliefs, recess reveals
const BACK = [0.78, 0.7, 0.6];        // recess back panels
const ORDER = [1.06, 1.0, 0.92];      // portal archivolt orders
const ROOF_LEAN = [0.92, 0.86, 0.76]; // lean-to roofs over the wings
const DARK_STONE = [0.35, 0.3, 0.25]; // belfry openings
const FRAME = [0.85, 0.82, 0.75];     // window frames
const IRON = [0.5, 0.52, 0.5];        // finial crosses
const POST = [0.12, 0.14, 0.13];      // lamp standards
const BELL = [0.8, 0.7, 0.5];         // bronze bells
const GOLD = [2.2, 1.7, 0.7];         // gold crosses
const OPAL = [1.35, 1.3, 1.2];         // opal globes
const STEP = [0.98, 0.95, 0.92];      // steps
const CHEEK = [0.82, 0.8, 0.78];      // cheek walls

const rect = (a0, a1, v0, v1) => [[a0, v0], [a1, v0], [a1, v1], [a0, v1]];
const colsAt = (pts, split, lo, hi) => pts.map(q => (q[1] > split ? hi : lo));

/** arch outline as [a, v] pairs: straight jambs from base v0 to springline v0+h, then a semicircle of radius w (closed) */
function archPts(a, v0, w, h, N = 12) {
  const p = [[a - w, v0], [a + w, v0]];
  for (let k = 0; k <= N; k++) { const t = Math.PI * k / N; p.push([a + Math.cos(t) * w, v0 + h + Math.sin(t) * w]); }
  return p;
}
/** same outline at frame depth d, as [a, v, d] triples */
function archPoly(a, v0, w, h, d, N = 12) { return archPts(a, v0, w, h, N).map(q => [q[0], q[1], d]); }

/** planar face at depth d in frame F: outline and optional holes given as [a, v] rings, triangulated with earcut, one m.face per triangle */
function plate(m, name, F, outer, d, opt = {}, holes = []) {
  const data = [], hl = [];
  for (const p of outer) data.push(p[0], p[1]);
  for (const h of holes) { hl.push(data.length / 2); for (const p of h) data.push(p[0], p[1]); }
  const tri = earcut(data, hl), hint = m.H(F, 0, 0, 1);
  for (let i = 0; i < tri.length; i += 3) {
    const V = [0, 1, 2].map(q => { const k = tri[i + q]; return m.P(F, data[2 * k], data[2 * k + 1], d); });
    m.face(name, V, hint, opt);
  }
}

/** flat arch-shaped face (whole outline) at depth d */
function archFace(m, name, F, a, v0, w, h, d, opt = {}) {
  const poly = archPts(a, v0, w, h).map(q => m.P(F, q[0], q[1], d));
  m.face(name, poly, m.H(F, 0, 0, 1), opt);
}

/**
 * Side walls along a closed 2D outline R (a,v) in frame F, between depths dA and dB. The outline's first edge (its base) is skipped.
 * inward=true for walls whose outward normal points into the outline centre (openings, hole walls), false for solid outer edges.
 */
function sides(m, name, F, R, cen, dA, dB, opt, inward) {
  for (let k = 1; k < R.length; k++) {
    const j = (k + 1) % R.length;
    const mx = (R[k][0] + R[j][0]) / 2 - cen[0], mv = (R[k][1] + R[j][1]) / 2 - cen[1];
    const s = (inward ? -1 : 1) / (Math.hypot(mx, mv) || 1);
    m.fq(name, F, [[R[k][0], R[k][1], dA], [R[j][0], R[j][1], dA], [R[j][0], R[j][1], dB], [R[k][0], R[k][1], dB]], [mx * s, mv * s, 0], opt);
  }
}

/** thick round-arched band (archivolt order): outer half-width w, inner w - t, from the wall plane d0 out to its front plane d1 */
function archBand(m, name, F, a, v0, w, h, t, d0, d1, col) {
  const O = archPts(a, v0, w, h), I = archPts(a, v0, w - t, h), cen = [a, v0 + h], n = O.length;
  for (let k = 1; k < n; k++) {
    const j = (k + 1) % n;
    m.fq(name, F, [[O[k][0], O[k][1], d1], [O[j][0], O[j][1], d1], [I[j][0], I[j][1], d1], [I[k][0], I[k][1], d1]], [0, 0, 1], { col });
  }
  sides(m, name, F, O, cen, d0, d1, { col }, false);
  sides(m, name, F, I, cen, d0, d1, { col }, true);
}

/** deep round-arched recess cut into a front plane at dFront: reveal walls back to dBack, plus a back panel at dBack */
function recess(m, name, F, a, v0, w, h, dFront, dBack) {
  sides(m, name, F, archPts(a, v0, w, h), [a, v0 + h], dBack, dFront, { col: CARVE }, true);
  archFace(m, name, F, a, v0, w, h, dBack, { col: BACK });
}

/** sphere (lathe) of radius r centred at (x, y, z) */
function orb(m, name, x, y, z, r, col, seg = 8) {
  m.lathe(name, x, z, [[0.001, 0], [r * 0.707, r * 0.293], [r, r], [r * 0.707, r * 1.707], [0.001, 2 * r]], seg, { y0: y - r, col });
}

/** small bronze bell hanging at (x, y, z) (y = bottom of the bell) */
function bell(m, x, y, z) {
  m.lathe('dark', x, z, [[0.001, 0], [0.1, 0.04], [0.2, 0.2], [0.25, 0.38], [0.22, 0.46], [0.12, 0.5], [0.001, 0.52]], 10, { y0: y, col: BELL });
}

/**
 * Square tower: walls with arched windows, four pedimented gables (vertical triangle, two raking shoulders back to the wall,
 * base moulding, cross relief), pyramid roof via building() and a cross finial with a ball under it.
 * o: { cx, cz, hw (half side), y0 (base), floors, rise (roof), gh (gable height), cH (finial cross height), bayW, seed }
 */
function gabledTower(m, o) {
  const { cx, cz, hw, y0, floors, rise, gh, cH, seed } = o;
  const sq = [[cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw]];
  const t = building(m, sq, {
    wall: 'sand', trim: 'sand', plinthMat: 'sand', tint: SAND, y0, noPlinth: true, plinth: 0, floors,
    bayW: o.bayW ?? 2 * hw, cornice: { fh: 0.7, dentils: false, blocks: false },
    roof: { kind: 'hip', rise, apex: true, mat: 'sand', uvS: 6, col: ROOF }, seed, lights: false, lit: 0.35,
  });
  const yE = t.yCor, dg = 0.5, gw = hw * 0.78, cw = 0.2 + 0.04 * gh;   // gable plane out to dg, bar thickness
  for (const [tx, tz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const F = { o: [cx + tx * hw, 0, cz + tz * hw], t: [-tz, tx], n: [tx, tz] };
    m.fq('sand', F, [[-gw, yE, dg], [gw, yE, dg], [0, yE + gh, dg]], [0, 0, 1], { col: MOULD });                        // gable triangle
    m.fq('sand', F, [[-gw, yE, dg], [0, yE + gh, dg], [0, yE + gh, 0], [-gw, yE, 0]], [-gh, gw, 0], { col: ROOF });   // raking shoulder (left)
    m.fq('sand', F, [[0, yE + gh, dg], [gw, yE, dg], [gw, yE, 0], [0, yE + gh, 0]], [gh, gw, 0], { col: ROOF });      // raking shoulder (right)
    m.fbox('sand', F, -gw - 0.15, gw + 0.15, yE - 0.18, yE + 0.1, 0.25, dg + 0.15, { col: MOULD, skip: 'b' });          // base moulding
    // cross relief on the gable: upright and transom, scaled to the gable
    m.fbox('sand', F, -cw / 2, cw / 2, yE + 0.25 * gh, yE + 0.85 * gh, dg, dg + 0.16, { col: CARVE, skip: 'b' });
    m.fbox('sand', F, -0.27 * gh, 0.27 * gh, yE + 0.55 * gh - cw / 2, yE + 0.55 * gh + cw / 2, dg, dg + 0.16, { col: CARVE, skip: 'b' });
  }
  // finial: upright and arm (0.32 square section), a ball under the arm
  const top = t.yRoof, cf = { o: [cx, 0, cz], t: [1, 0], n: [0, 1] };
  m.fbox('dark', cf, -0.16, 0.16, top - 0.2, top + cH, -0.16, 0.16, { col: IRON });
  m.fbox('dark', cf, -0.2 * cH, 0.2 * cH, top + 0.6 * cH - 0.16, top + 0.6 * cH + 0.16, -0.12, 0.12, { col: IRON });
  orb(m, 'dark', cx, top + 0.35 * cH, cz, 0.25, IRON);
  return t;
}

/** cathedral lamp standard: fluted dark post, four scroll arms with opal globes, a gold cross on top (photo: cath1, cath2) */
function lamp(m, x, z) {
  const y = m.gy(x, z), F = { o: [x, 0, z], t: [1, 0], n: [0, 1] };
  m.lathe('dark', x, z, [[0.36, 0], [0.36, 0.12], [0.27, 0.2], [0.2, 0.35], [0.14, 0.5], [0.12, 2.5], [0.135, 3.5], [0.11, 3.7], [0.13, 3.85], [0.09, 4.0], [0.07, 4.2]], 8, { y0: y, col: POST });
  const av = y + 3.2;   // arm height
  for (const [a0, a1, d0, d1] of [[0, 0.9, -0.035, 0.035], [-0.9, 0, -0.035, 0.035], [-0.035, 0.035, 0, 0.9], [-0.035, 0.035, -0.9, 0]]) {
    m.fbox('dark', F, a0, a1, av, av + 0.08, d0, d1, { col: POST });
  }
  for (const [da, dd] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) orb(m, 'lamp', x + da, av + 0.3, z + dd, 0.22, OPAL);
  orb(m, 'lamp', x, y + 4.25, z, 0.22, OPAL);
  m.fbox('metal', F, -0.05, 0.05, y + 4.4, y + 5.3, -0.05, 0.05, { col: GOLD });
  m.fbox('metal', F, -0.3, 0.3, y + 4.75, y + 4.87, -0.05, 0.05, { col: GOLD });
}

/** cypress: narrow evergreen cone, clipped along the approach */
function cypress(m, x, z) {
  m.lathe('cypress', x, z, [[0.001, 0], [0.55, 0.3], [0.75, 1.5], [0.7, 3.0], [0.45, 4.2], [0.001, 5.0]], 8, { y0: m.gy(x, z) });
}

export function buildCathedral(m, fp) {
  const ring = fp.lm[31622320].rings[0];
  const y0 = Math.min(...ring.map(p => m.gy(p[0], p[1]))) + 0.15;
  const yB = m.gy(305, 622) + 1.0;
  const F = { o: [305.2, 0, 622], t: [0, -1], n: [-1, 0] };   // west (main) facade: outward is west

  // ---- 1. body: low cruciform hall with arched windows and a hipped roof (kept low so the towers dominate)
  const body = building(m, ring, {
    wall: 'sand', trim: 'sand', plinthMat: 'grey', tint: SAND, trimTint: [1.1, 1.06, 0.98],
    y0, plinth: 1.0, bayW: 5.0, lit: 0.2, glow: 1.2, lightStep: 10,
    floors: [
      { h: 7.5, kind: 'archwin', aw: 1.7, ww: 1.7, sill: 1.5, wh: 4.4, vs: 5.4, rev: 0.9, lit: 0.35, mw: 0.3 },
      { h: 6.0, kind: 'blank' },
    ],
    cornice: { fh: 0.8 },
    roof: { kind: 'hip', rise: 6, inset: 9, mat: 'sand', uvS: 9, col: ROOF },
    seed: 81, lights: true,
  });

  // ---- 2. central tower over the crossing (three windows a face, four-gabled, tall cross)
  const central = gabledTower(m, {
    cx: 331, cz: 622, hw: 7.6, y0: yB + 16, bayW: 5, rise: 10, gh: 6.5, cH: 4.5, seed: 82,   // photos: the main tower rises right behind the west gable and dominates the silhouette
    floors: [
      { h: 9, kind: 'blank' },
      { h: 10, kind: 'archwin', aw: 1.2, ww: 1.2, sill: 1.5, wh: 6, vs: 7.5, rev: 0.9, lit: 0.55 },
    ],
  });

  // ---- 3. corner towers on the wings, set 4 m behind the facade line
  for (const sg of [-1, 1]) {
    const p = m.P(F, sg * 16.5, 0, -4);
    gabledTower(m, {
      cx: p[0], cz: p[2], hw: 4.6, y0: yB + 12, rise: 6, gh: 3.4, cH: 3.2, seed: sg < 0 ? 83 : 84,
      floors: [
        { h: 3, kind: 'blank' },
        { h: 6.5, kind: 'archwin', aw: 0.9, ww: 0.9, sill: 1.2, wh: 3.6, vs: 4.8, rev: 0.7, lit: 0.5 },
      ],
    });
  }

  // ---- 4. west frontispiece: central block with the side arches cut out of its front plane
  const BLOCK_TOP = yB + 17, SIDE_ARCH = [-8.3, 8.3];
  plate(m, 'sand', F, rect(-12, 12, yB - 1, BLOCK_TOP), 1.2, { col: SAND }, SIDE_ARCH.map(a => archPts(a, yB, 3.0, 9.5)));
  m.fbox('sand', F, -12, 12, yB - 1, BLOCK_TOP, 0, 1.2, { col: SAND, skip: 'fb' });

  // stepped gable: 3.5 m step, cap moulding, then the belfry step
  const TOP1 = yB + 20.5, TOP2 = yB + 24;
  m.fbox('sand', F, -7, 7, BLOCK_TOP, TOP1, 0.2, 1.2, { col: SAND, skip: 'b' });
  m.fbox('sand', F, -7.15, 7.15, TOP1, TOP1 + 0.25, 0.2, 1.35, { col: MOULD, skip: 'b' });
  m.fbox('sand', F, -3.8, 3.8, TOP1, TOP2, 0.2, 1.2, { col: SAND, skip: 'b' });
  m.fbox('sand', F, -3.95, 3.95, TOP2, TOP2 + 0.25, 0.2, 1.35, { col: MOULD, skip: 'b' });
  // belfry: two round-arched openings with a bell hung just in front of each
  for (const a of [-1.2, 1.2]) {
    archFace(m, 'sand', F, a, yB + 19.5, 0.75, 2.7, 1.25, { col: DARK_STONE });
    const bp = m.P(F, a, 0, 1.45);
    bell(m, bp[0], yB + 21.0, bp[2]);
  }

  // main portal: three nested archivolt orders (outer order projects most), lit doorway, band and cross above
  for (const [w, dOut] of [[4.9, 1.7], [4.3, 1.55], [3.7, 1.4]]) archBand(m, 'sand', F, 0, yB, w, 6.5, 0.55, 1.2, dOut, ORDER);
  const door = archPts(0, yB, 3.15, 6.5);
  m.face('glass', door.map(q => m.P(F, q[0], q[1], 1.21)), m.H(F, 0, 0, 1), { cols: colsAt(door, yB + 3, [0.7, 0.42, 0.2], [1.5, 0.9, 0.45]) });
  m.fbox('sand', F, -6, 6, yB + 11.5, yB + 12, 1.2, 1.5, { col: MOULD, skip: 'b' });
  m.fbox('sand', F, -0.25, 0.25, yB + 12.6, yB + 15.6, 1.2, 1.45, { col: CARVE, skip: 'b' });
  m.fbox('sand', F, -1.1, 1.1, yB + 13.8, yB + 14.3, 1.2, 1.45, { col: CARVE, skip: 'b' });

  // side big arches: deep recesses with a lit arched window above a small door
  for (const a of SIDE_ARCH) {
    recess(m, 'sand', F, a, yB, 3.0, 9.5, 1.2, 0.05);
    const win = archPts(a, yB + 6.2, 1.15, 3.0);
    archFace(m, 'glass', F, a, yB + 6.2, 1.15, 3.0, 0.15, { cols: colsAt(win, yB + 8.2, [0.8, 0.5, 0.25], [1.4, 0.85, 0.42]) });
    m.fbox('frame', F, a - 0.05, a + 0.05, yB + 6.2, yB + 10.35, 0.15, 0.24, { col: FRAME, skip: 'b' });
    m.fbox('frame', F, a - 1.15, a + 1.15, yB + 8.0, yB + 8.1, 0.15, 0.24, { col: FRAME, skip: 'b' });
    archFace(m, 'sand', F, a, yB, 1.6, 2.6, 0.1, { col: [0.3, 0.26, 0.22] });
  }

  // ---- 5. wings: flat-fronted, one deep arch each, lean-to roof rising back to the central block
  for (const sg of [-1, 1]) {
    const lo = Math.min(sg * 12, sg * 21), hi = Math.max(sg * 12, sg * 21), ac = sg * 16.5;
    plate(m, 'sand', F, rect(lo, hi, yB - 1, yB + 12), 1.0, { col: SAND }, [archPts(ac, yB, 2.6, 4.5)]);
    m.fbox('sand', F, lo, hi, yB - 1, yB + 12, 0, 1.0, { col: SAND, skip: 'fb' });
    recess(m, 'sand', F, ac, yB, 2.6, 4.5, 1.0, 0.05);
    m.fq('sand', F, [[sg * 12, yB + 17, 1.2], [sg * 21.5, yB + 12, 1.2], [sg * 21.5, yB + 12, -10], [sg * 12, yB + 17, -10]], [sg * 5, 9.5, 0], { col: ROOF_LEAN });
    m.fq('sand', F, [[sg * 12, yB + 12, 1.0], [sg * 21.5, yB + 12, 1.0], [sg * 12, yB + 17, 1.0]], [0, 0, 1], { col: SAND });   // infill under the roof edge
  }

  // ---- 6. steps: 14 risers descending west from the portal, cheek walls stepping with them
  for (let k = 0; k < 14; k++) {
    const top = yB - 0.16 * k, d0 = 1.2 + 1.5 * k, d1 = 2.7 + 1.5 * k;
    m.fbox('grey', F, -13, 13, yB - 3, top, d0, d1, { col: STEP, skip: 'b' });
    for (const [a0, a1] of [[-13.9, -13], [13, 13.9]]) m.fbox('grey', F, a0, a1, yB - 3, top, d0, d1, { col: CHEEK, skip: 'b' });
  }

  // ---- 7. lamp standards and cypresses along both sides of the approach
  for (const sg of [-1, 1]) {
    for (let k = 0; k < 9; k++) { const p = m.P(F, sg * 15.5, 0, 3 + 6.5 * k); lamp(m, p[0], p[2]); }
    for (let k = 0; k < 9; k++) { const p = m.P(F, sg * 17.5, 0, 6.25 + 6.5 * k); cypress(m, p[0], p[2]); }
  }

  return { body, c: central };
}
