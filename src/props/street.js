// Street furniture, part 2: slatted benches, litter bins, reflective bollards, hydrants, bike racks, planters, advertising (Morris) columns,
// phone boxes, newspaper / ATM kiosks, manhole + kerb-drain decals, bus-stop poles with timetables, traffic cones + barriers (also exposed as
// window.__props.cones for circuits), utility poles with sagging wires, and cables between the street lamps along the avenues.
import * as THREE from 'three';
import { GeoBuilder, composeInto, lin, mkRng, track } from './util.js';
import { adAtlas } from './textures.js';
import { C, GY, tileMaterial, addTileAttr, tilePos, tileEx, quality } from './fhelp.js';

const blob = (b, c, r, col, rng, jit = 0.15) => { // low-poly lumpy sphere
  const ico = new THREE.IcosahedronGeometry(1, 1), pa = ico.attributes.position, base = b.n;
  for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), k = 1 + (rng() - 0.5) * jit, sh = 0.7 + 0.3 * (y * 0.5 + 0.5); b.v([c[0] + x * r[0] * k, c[1] + y * r[1] * k, c[2] + z * r[2] * k], [x, y * 0.9 + 0.1, z], [0, 0], [col[0] * sh, col[1] * sh, col[2] * sh]); }
  for (let i = 0; i < pa.count; i += 3) b.tri(base + i, base + i + 1, base + i + 2); ico.dispose();
};

export function buildStreet(F, ctx, { arrOf }) {
  const { scene, H, data, meta } = ctx, { metal, matte, glow } = F.mats, ps = quality.propScale, td = quality.treeDetail;
  const ada = () => (F.shared.ad ??= adAtlas());
  const place = (list, stride, fn, y0 = GY) => { const L = arrOf(list, stride), m = new Float32Array(L.n * 16); for (let i = 0; i < L.n; i++) { const x = L.at(i, 0), z = L.at(i, 1); fn(m, i, x, H(x, z) + y0, z, L); } return { n: L.n, m, L }; };
  const rng = mkRng(8080);

  // ================================================================== benches (slatted wood seat + back, cast-iron ends with armrests)
  {
    const b = new GeoBuilder(), W1 = C.wood, W2 = C.wood2;
    for (let k = 0; k < 4; k++) b.box(0, 0.455, -0.13 + k * 0.088, 0.9, 0.016, 0.036, k % 2 ? W1 : W2);
    for (let k = 0; k < 3; k++) b.box(0, 0.64 + k * 0.1, -0.215 - k * 0.012, 0.9, 0.034, 0.011, k % 2 ? W2 : W1);
    for (const sx of [-0.82, 0.82]) {
      b.box(sx, 0.22, 0.13, 0.025, 0.22, 0.025, C.dark); b.box(sx, 0.4, -0.12, 0.025, 0.4, 0.025, C.dark); b.box(sx, 0.43, 0.0, 0.022, 0.02, 0.16, C.dark);
      b.box(sx, 0.66, -0.02, 0.028, 0.014, 0.19, C.dark); b.box(sx, 0.55, 0.19, 0.022, 0.1, 0.022, C.dark); b.box(sx, 0.05, 0.0, 0.03, 0.03, 0.19, C.dark);
    }
    b.box(0, 0.4, -0.12, 0.82, 0.014, 0.018, C.dark);
    const { n, m } = place(data.benches, 3, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2)));
    if (n) F.fam([F.mesh(b.build(), metal, n)], m, 150, { radius: 1.2, mid: 0.5, keepFrac: Math.max(ps, 0.6), name: 'benches' });
  }
  // ================================================================== litter bins (steel drum, rain lid, ash tray, band)
  {
    const b = new GeoBuilder(), body = lin('#2a3a30');
    b.tube([0, 0.06, 0], [0, 0.78, 0], 0.2, 0.225, 14, body, body, true); b.tube([0, 0.78, 0], [0, 0.84, 0], 0.24, 0.24, 14, C.dark, C.dark, true); b.tube([0, 0.84, 0], [0, 0.9, 0], 0.15, 0.05, 12, C.grey, C.grey, true);
    b.tube([0, 0.45, 0], [0, 0.5, 0], 0.222, 0.222, 14, lin('#c8a24a'), lin('#c8a24a')); b.box(0, 0.62, 0.215, 0.1, 0.09, 0.012, C.black); for (const y of [0.08, 0.7]) b.tube([0, y, 0], [0, y + 0.02, 0], 0.235, 0.235, 14, C.grey, C.grey);
    const { n, m } = place(data.bins, 3, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2)));
    if (n) F.fam([F.mesh(b.build(), metal, n)], m, 110, { radius: 0.5, mid: 0.4, keepFrac: Math.max(ps, 0.6), name: 'bins' });
  }
  // ================================================================== bollards with reflective bands + hydrants
  {
    const b = new GeoBuilder(), bands = new GeoBuilder(), body = lin('#2b2e35');
    b.tube([0, 0, 0], [0, 0.8, 0], 0.055, 0.055, 10, body, body, true); b.tube([0, 0.8, 0], [0, 0.86, 0], 0.055, 0.01, 10, body, body, true); b.tube([0, 0, 0], [0, 0.04, 0], 0.085, 0.085, 10, body, body, true);
    bands.tube([0, 0.66, 0], [0, 0.72, 0], 0.057, 0.057, 10, [0.8, 0.8, 0.72], [0.8, 0.8, 0.72]); bands.tube([0, 0.54, 0], [0, 0.58, 0], 0.057, 0.057, 10, [0.8, 0.8, 0.72], [0.8, 0.8, 0.72]);
    const { n, m } = place(data.bollards, 2, (m, i, x, y, z) => composeInto(m, i, x, y, z, 0));
    if (n) F.fam([F.mesh(b.build(), metal, n), F.mesh(bands.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(0.18, 0.18, 0.16) }), n)], m, 110, { radius: 0.3, mid: 0.4, keepFrac: Math.max(ps, 0.5), name: 'bollards' });
    const h = new GeoBuilder(), R = C.red;
    h.tube([0, 0, 0], [0, 0.07, 0], 0.13, 0.13, 12, R, R, true); h.tube([0, 0.07, 0], [0, 0.55, 0], 0.095, 0.085, 12, R, R, true); h.tube([0, 0.5, 0], [0, 0.56, 0], 0.115, 0.115, 12, R, R, true); h.tube([0, 0.56, 0], [0, 0.66, 0], 0.095, 0.03, 12, R, R, true); h.tube([0, 0.66, 0], [0, 0.69, 0], 0.03, 0.03, 8, C.grey, C.grey, true);
    for (const s of [-1, 1]) { h.tube([s * 0.09, 0.34, 0], [s * 0.17, 0.34, 0], 0.036, 0.036, 8, R, R, true); h.tube([s * 0.17, 0.34, 0], [s * 0.19, 0.34, 0], 0.045, 0.045, 8, C.grey, C.grey, true); }
    h.tube([0, 0.3, 0.085], [0, 0.3, 0.16], 0.05, 0.05, 8, R, R, true);
    const hy = place(data.hydrants, 2, (m, i, x, y, z) => composeInto(m, i, x, y, z, 0));
    if (hy.n) F.fam([F.mesh(h.build(), metal, hy.n)], hy.m, 100, { radius: 0.3, mid: 0.4, name: 'hydrants' });
  }
  // ================================================================== bicycle racks (3 hoops)
  {
    const b = new GeoBuilder(), s = C.steel;
    for (let k = -1; k <= 1; k++) { const z = k * 0.5; b.tube([0, 0, z], [0, 0.55, z], 0.016, 0.016, 6, s, s); b.tube([0, 0.55, z], [0.16, 0.8, z], 0.016, 0.016, 6, s, s); b.tube([0.16, 0.8, z], [0.5, 0.8, z], 0.016, 0.016, 6, s, s); b.tube([0.5, 0.8, z], [0.66, 0.55, z], 0.016, 0.016, 6, s, s); b.tube([0.66, 0.55, z], [0.66, 0, z], 0.016, 0.016, 6, s, s); b.box(0.33, 0.01, z, 0.36, 0.008, 0.03, C.dark); }
    const { n, m } = place(data.bikeracks, 3, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2)));
    if (n) F.fam([F.mesh(b.build(), metal, n)], m, 110, { radius: 1.2, mid: 0.4, name: 'bikeracks' });
  }
  // ================================================================== planters (concrete boxes with shrubs)
  {
    const b = new GeoBuilder(), cc = C.concrete, r = mkRng(31);
    b.box(0, 0.3, 0, 0.62, 0.3, 0.34, cc); b.box(0, 0.62, 0, 0.66, 0.03, 0.38, mul3(cc, 1.15)); b.box(0, 0.605, 0, 0.55, 0.012, 0.27, lin('#2c2118'));
    for (const [x, rr] of [[-0.35, 0.22], [0, 0.3], [0.36, 0.2]]) blob(b, [x, 0.78, 0], [rr, rr * 0.9, rr * 0.9], lin('#3f7a35'), r, 0.3);
    blob(b, [0.1, 0.95, 0.04], [0.15, 0.14, 0.14], lin('#62a04a'), r, 0.3);
    const { n, m } = place(data.planters, 4, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2), 1 + L.at(i, 3) * 0.5, 1, 1));
    if (n) F.fam([F.mesh(b.build(), matte, n)], m, 120, { radius: 1.6, mid: 0.5, keepFrac: Math.max(ps, 0.5), name: 'planters' });
  }
  // ================================================================== advertising (Morris) columns + phone boxes
  {
    const b = new GeoBuilder(), g = lin('#1c3a2a');
    b.tube([0, 0, 0], [0, 0.35, 0], 0.62, 0.55, 16, g, g, true); b.tube([0, 0.35, 0], [0, 0.4, 0], 0.58, 0.58, 16, C.dark, C.dark, true); b.tube([0, 2.6, 0], [0, 2.7, 0], 0.58, 0.58, 16, C.dark, C.dark, true);
    b.tube([0, 2.7, 0], [0, 3.1, 0], 0.62, 0.16, 16, g, g, true); b.tube([0, 3.1, 0], [0, 3.35, 0], 0.14, 0.05, 10, C.dark, C.dark, true); b.tube([0, 0.4, 0], [0, 2.6, 0], 0.04, 0.04, 6, C.dark, C.dark);
    const post = new THREE.CylinderGeometry(0.56, 0.56, 2.1, 20, 1, true).translate(0, 1.5, 0), n0 = data.morris ? data.morris.length / 4 : 0;
    if (n0) {
      const tiles = []; for (let i = 0; i < n0; i++) tiles.push(tilePos(data.morris[i * 4 + 3] % 6, 3, 2)); addTileAttr(post, n0, tiles);
      const pm = tileMaterial(new THREE.MeshBasicMaterial({ map: ada(), color: new THREE.Color(0.8, 0.8, 0.8), toneMapped: false, side: THREE.FrontSide }), 1 / 3, 1 / 2);
      const { n, m } = place(data.morris, 4, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2)));
      const bm = F.mesh(b.build(), metal, n), poster = F.mesh(post, pm, n);
      F.fam([bm], m, 200, { radius: 0.8, mid: 1.6, name: 'morris' }); F.fam([poster], m, 200, { extras: [tileEx(poster)], radius: 0.8, mid: 1.6, name: 'morrisAds' });
    }
    // phone box: frame, glazing, lit panel
    const fb = new GeoBuilder(), gl = new GeoBuilder(), fr = lin('#a41018'), glc = lin('#1a2a38');
    for (const [x, z] of [[-0.42, -0.4], [0.42, -0.4], [-0.42, 0.4], [0.42, 0.4]]) fb.box(x, 1.1, z, 0.025, 1.1, 0.025, fr);
    fb.box(0, 2.25, 0, 0.5, 0.05, 0.46, fr); fb.box(0, 0.05, 0, 0.5, 0.05, 0.46, fr); fb.box(0, 2.4, 0, 0.44, 0.06, 0.4, [0.8, 0.8, 0.8]);
    for (const y of [0.6, 1.2, 1.8]) for (const s of [-1, 1]) { fb.box(0, y, s * 0.4, 0.42, 0.012, 0.012, fr); fb.box(s * 0.42, y, 0, 0.012, 0.012, 0.4, fr); }
    gl.box(0, 1.15, 0.4, 0.4, 1.0, 0.006, glc); gl.box(-0.42, 1.15, 0, 0.006, 1.0, 0.38, glc); gl.box(0.42, 1.15, 0, 0.006, 1.0, 0.38, glc); gl.box(0, 1.2, -0.37, 0.38, 0.8, 0.006, [1.6, 1.7, 1.8]);
    gl.box(0, 1.2, -0.3, 0.12, 0.1, 0.04, C.dark);
    const ph = place(data.phones, 3, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2)));
    if (ph.n) F.fam([F.mesh(fb.build(), metal, ph.n), F.mesh(gl.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.8 }), ph.n)], ph.m, 130, { radius: 0.9, mid: 1.2, name: 'phones' });
  }
  // ================================================================== newspaper kiosks + ATM pods (data.news kind 0 / 1)
  {
    const L = arrOf(data.news, 4), nk = [], na = []; for (let i = 0; i < L.n; i++) (L.at(i, 3) ? na : nk).push(i);
    const mk = (idx, geoBody, geoGlow, name, y) => {
      if (!idx.length) return; const m = new Float32Array(idx.length * 16); idx.forEach((i, k) => { const x = L.at(i, 0), z = L.at(i, 1); composeInto(m, k, x, H(x, z) + GY, z, L.at(i, 2)); });
      F.fam([F.mesh(geoBody, metal, idx.length), F.mesh(geoGlow, glow, idx.length)], m, 130, { radius: 1.6, mid: y, name });
    };
    { // newspaper stand: shuttered booth with a display shelf of papers
      const b = new GeoBuilder(), g = new GeoBuilder(), c = lin('#2d5f78');
      b.box(0, 1.2, 0, 0.55, 1.2, 0.45, c); b.box(0, 2.46, 0, 0.62, 0.05, 0.52, C.dark); b.box(0, 0.05, 0, 0.58, 0.05, 0.48, C.dark);
      b.box(0, 1.15, 0.55, 0.5, 0.025, 0.12, lin('#cfd2d6')); for (let k = 0; k < 5; k++) b.box(-0.4 + k * 0.2, 1.38, 0.52, 0.085, 0.16, 0.012, [0.8 - k * 0.1, 0.75, 0.4 + k * 0.1]);
      g.box(0, 1.7, 0.455, 0.48, 0.35, 0.01, [2.4, 2.0, 1.3]); g.box(0, 2.4, 0.5, 0.5, 0.06, 0.012, [0.7, 1.8, 2.6]);
      mk(nk, b.build(), g.build(), 'newsKiosks', 1.2);
    }
    { // ATM pod
      const b = new GeoBuilder(), g = new GeoBuilder();
      b.box(0, 1.1, 0, 0.45, 1.1, 0.22, lin('#3a3f48')); b.box(0, 2.25, 0, 0.5, 0.06, 0.28, C.dark); b.box(0, 1.15, 0.24, 0.3, 0.02, 0.04, C.black);
      g.box(0, 1.5, 0.225, 0.28, 0.22, 0.008, [0.5, 2.1, 1.2]); g.box(0, 2.1, 0.23, 0.36, 0.1, 0.008, [0.2, 1.4, 2.4]); g.box(0, 1.05, 0.225, 0.1, 0.05, 0.008, [2, 2, 1.8]);
      mk(na, b.build(), g.build(), 'atms', 1.1);
    }
  }
  // ================================================================== manhole covers + kerb drains (decals on the asphalt), data.manholes kind 0 round / 1 grate
  {
    const L = arrOf(data.manholes, 4), r0 = [], r1 = []; for (let i = 0; i < L.n; i++) (L.at(i, 3) ? r1 : r0).push(i);
    const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mk = (idx, geo, name, dist) => { if (!idx.length) return; const m = new Float32Array(idx.length * 16); idx.forEach((i, k) => { const x = L.at(i, 0), z = L.at(i, 1); composeInto(m, k, x, H(x, z) + 0.133, z, L.at(i, 2)); }); F.fam([F.mesh(geo, roadMat, idx.length)], m, dist, { radius: 0.5, mid: 0, name }); };
    { const b = new GeoBuilder(), dk = [0.045, 0.045, 0.05], lt = [0.12, 0.115, 0.11]; b.tube([0, 0, 0], [0, 0.008, 0], 0.36, 0.36, 18, dk, dk, true); b.tube([0, 0.008, 0], [0, 0.012, 0], 0.3, 0.3, 18, lt, lt, true);
      for (const a of [0, Math.PI / 2]) b.box(0, 0.016, 0, 0.29 * Math.cos(a) + 0.008, 0.004, 0.29 * Math.sin(a) + 0.008, dk); for (const rr of [0.14, 0.22]) b.tube([0, 0.012, 0], [0, 0.017, 0], rr + 0.01, rr + 0.01, 14, dk, dk); mk(r0, b.build(), 'manholes', 90); }
    { const b = new GeoBuilder(), dk = [0.05, 0.05, 0.055], bl = [0.01, 0.01, 0.012]; b.box(0, 0.006, 0, 0.3, 0.006, 0.22, dk); for (let k = -3; k <= 3; k++) b.box(k * 0.075, 0.013, 0, 0.022, 0.004, 0.19, bl); b.box(0, 0.016, 0.0, 0.3, 0.003, 0.012, dk); mk(r1, b.build(), 'drains', 70); }
  }
  // ================================================================== bus-stop poles (stop sign + timetable board)
  {
    const b = new GeoBuilder(), s = C.steel, bl = lin('#0a4ea8');
    b.tube([0, 0, 0], [0, 3.1, 0], 0.045, 0.04, 8, s, s, true); b.box(0, 2.75, 0.04, 0.2, 0.2, 0.012, bl); b.box(0, 1.9, 0.045, 0.19, 0.27, 0.012, lin('#d8d8d0')); b.box(0, 0.05, 0, 0.1, 0.05, 0.1, C.dark);
    const g = new GeoBuilder(); g.box(0, 1.9, 0.056, 0.17, 0.25, 0.004, [1.2, 1.2, 1.1]);
    const { n, m } = place(data.stoppoles, 3, (m, i, x, y, z, L) => composeInto(m, i, x, y, z, L.at(i, 2)));
    if (n) { const bm = F.mesh(b.build(), metal, n), gm = F.mesh(g.build(), glow, n); F.fam([bm, gm], m, 150, { radius: 0.6, mid: 1.5, name: 'stopPoles' }); }
  }
  // ================================================================== traffic cones + barriers (data.cones kind 0 cone / 1 barrier)
  {
    const L = arrOf(data.cones, 4), c0 = [], c1 = []; for (let i = 0; i < L.n; i++) (L.at(i, 3) ? c1 : c0).push(i);
    const mk = (idx, geo, name, dist) => { if (!idx.length) return null; const m = new Float32Array(idx.length * 16); idx.forEach((i, k) => { const x = L.at(i, 0), z = L.at(i, 1); composeInto(m, k, x, H(x, z) + 0.12, z, L.at(i, 2)); }); return F.fam([F.mesh(geo, metal, idx.length)], m, dist, { radius: 1.2, mid: 0.4, name }); };
    { const b = new GeoBuilder(), o = C.orange, w = C.white; b.box(0, 0.015, 0, 0.17, 0.015, 0.17, C.black); b.tube([0, 0.03, 0], [0, 0.55, 0], 0.115, 0.03, 12, o, o, true); b.tube([0, 0.26, 0], [0, 0.34, 0], 0.088, 0.071, 12, w, w); b.tube([0, 0.34, 0], [0, 0.36, 0], 0.071, 0.07, 12, w, w); mk(c0, b.build(), 'cones', 120); }
    { const b = new GeoBuilder(), w = C.white, r = lin('#c81414'); for (const sx of [-0.55, 0.55]) { b.box(sx, 0.25, 0, 0.025, 0.25, 0.22, C.steel); b.box(sx, 0.02, 0, 0.03, 0.02, 0.3, C.steel); }
      for (let k = 0; k < 5; k++) { b.box(-0.5 + k * 0.25 + 0.125, 0.82, 0, 0.125, 0.09, 0.02, k % 2 ? w : r); b.box(-0.5 + k * 0.25 + 0.125, 0.56, 0, 0.125, 0.09, 0.02, k % 2 ? r : w); } b.box(0, 1.03, 0, 0.62, 0.012, 0.03, C.steel); mk(c1, b.build(), 'barriers', 120); }
  }
  // circuits can add / remove their own cones: window.__props.cones.add([[x,z,yaw,kind]...]) -> removes with .remove()
  F.api = F.api ?? {};
  F.api.cones = {
    add(list) { // list of [x, z, yaw, kind]; builds throw-away instanced meshes (a circuit marking its apexes / gates)
      const b = new GeoBuilder(); const o = C.orange, w = C.white; b.box(0, 0.015, 0, 0.17, 0.015, 0.17, C.black); b.tube([0, 0.03, 0], [0, 0.55, 0], 0.115, 0.03, 12, o, o, true); b.tube([0, 0.26, 0], [0, 0.34, 0], 0.088, 0.071, 12, w, w);
      const im = new THREE.InstancedMesh(b.build(), metal, list.length); list.forEach(([x, z, yaw], i) => { const m = new Float32Array(16); composeInto(m, 0, x, H(x, z) + 0.12, z, yaw ?? 0); im.instanceMatrix.array.set(m, i * 16); }); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; scene.add(im); return { remove() { scene.remove(im); im.geometry.dispose(); } };
    },
  };
  // ================================================================== utility poles + wires (data.poles [x,z,yaw,link]) and lamp-to-lamp cables (meta.lamps)
  {
    const P = arrOf(data.poles, 4), b = new GeoBuilder(), conc = lin('#8a877f');
    b.tube([0, 0, 0], [0, 8.6, 0], 0.15, 0.09, 10, conc, lin('#9a978f'), true); b.tube([0, 0, 0], [0, 0.4, 0], 0.17, 0.15, 10, lin('#6a675f'), conc);
    for (const [y, hw] of [[8.0, 0.85], [7.35, 0.6]]) { b.box(0, y, 0, hw, 0.045, 0.05, C.grey); b.box(0, y - 0.14, 0.0, 0.03, 0.14, 0.03, C.grey); }
    for (const x of [-0.75, 0, 0.75]) { b.tube([x, 8.03, 0], [x, 8.2, 0], 0.035, 0.02, 6, lin('#6a8a8a'), lin('#8ab0b0'), true); }
    const wires = []; // chunked line segments
    const wire = (x0, y0, z0, x1, y1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); if (L < 4 || L > 70) return; const sag = 0.0007 * L * L, N = Math.max(5, Math.ceil(L / 4)); let px = x0, py = y0, pz = z0; for (let k = 1; k <= N; k++) { const t = k / N, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t); wires.push(px, py, pz, x, y, z); px = x; py = y; pz = z; } };
    if (P.n) {
      const m = new Float32Array(P.n * 16), at = []; for (let i = 0; i < P.n; i++) { const x = P.at(i, 0), z = P.at(i, 1), y = H(x, z) + GY, yaw = P.at(i, 2); composeInto(m, i, x, y, z, yaw); at.push([x, y, z, yaw]); }
      F.fam([F.mesh(b.build(), metal, P.n)], m, 230, { radius: 1.2, mid: 4.5, name: 'poles' });
      for (let i = 1; i < P.n; i++) if (P.at(i, 3)) { const a = at[i - 1], c = at[i]; for (const lx of [-0.75, 0, 0.75]) { const wxA = a[0] + lx * Math.cos(a[3]), wzA = a[2] - lx * Math.sin(a[3]), wxB = c[0] + lx * Math.cos(c[3]), wzB = c[2] - lx * Math.sin(c[3]); wire(wxA, a[1] + 8.2, wzA, wxB, c[1] + 8.2, wzB); } }
    }
    // lamp-to-lamp cables: link each lamp to the next one along the same side of the same road
    const lp = meta?.lamps ?? [], nl = lp.length / 6, cell = new Map(), key = (x, z) => Math.floor(x / 50) + ',' + Math.floor(z / 50);
    for (let i = 0; i < nl; i++) { const k = key(lp[i * 6], lp[i * 6 + 2]); (cell.get(k) ?? cell.set(k, []).get(k)).push(i); }
    for (let i = 0; i < nl; i++) {
      const x = lp[i * 6], y = lp[i * 6 + 1], z = lp[i * 6 + 2], dx = lp[i * 6 + 3], dz = lp[i * 6 + 4], big = lp[i * 6 + 5], tx = -dz, tz = dx; let best = -1, bd = 1e9;
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const j of cell.get((Math.floor(x / 50) + a) + ',' + (Math.floor(z / 50) + c)) ?? []) {
        if (j === i) continue; const jx = lp[j * 6] - x, jz = lp[j * 6 + 2] - z, d = Math.hypot(jx, jz); if (d < 14 || d > 52) continue;
        if (lp[j * 6 + 3] * dx + lp[j * 6 + 4] * dz < 0.9) continue; if ((jx * tx + jz * tz) / d < 0.93 && (jx * tx + jz * tz) / d > -0.93) continue; // along the road tangent
        if ((jx * tx + jz * tz) < 0) continue; if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) { const j = best, h0 = big ? 9 : 6.6, h1 = lp[j * 6 + 5] ? 9 : 6.6; wire(x + dx * 0.9, y + h0 - 0.25, z + dz * 0.9, lp[j * 6] + lp[j * 6 + 3] * 0.9, lp[j * 6 + 1] + h1 - 0.25, lp[j * 6 + 2] + lp[j * 6 + 4] * 0.9); }
    }
    // chunk by 300 m cells so the engine culls them
    const chunks = new Map(); for (let i = 0; i < wires.length; i += 6) { const k = Math.floor(wires[i] / 300) + ',' + Math.floor(wires[i + 2] / 300); let c = chunks.get(k); if (!c) chunks.set(k, c = []); c.push(wires[i], wires[i + 1], wires[i + 2], wires[i + 3], wires[i + 4], wires[i + 5]); }
    const lmat = new THREE.LineBasicMaterial({ color: 0x15161a }), lines = [];
    for (const arr of chunks.values()) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeBoundingSphere(); const ls = new THREE.LineSegments(g, lmat); ls.frustumCulled = true; F.group.add(track(ls)); lines.push(ls); }
    F.updates.push((dt, cam) => { const p = cam.position ?? cam; for (const ls of lines) { const c = ls.geometry.boundingSphere; ls.visible = Math.hypot(c.center.x - p.x, c.center.z - p.z) < c.radius + 650; } });
    F.wireCount = wires.length / 6;
  }
}
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
