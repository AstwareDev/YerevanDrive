// Branded signage around Republic Square (from the 360 Stories ground views + the few OSM POIs): the Marriott entrance lettering, the BYUREGH neon blade
// sign on the pink corner, Pinkberry and Jazzve. Canvas-textured planes lit like shop signs (bright at night, readable by day).
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function plate(THREE, w, h, draw) {
  const c = document.createElement('canvas'); c.width = Math.round(w * 160); c.height = Math.round(h * 160); const g = c.getContext('2d'); draw(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat), mat };
}
const text = (g, w, h, s, col, font = '700', glow = null) => {
  let px = h * 0.78; g.font = `${font} ${px}px "Trebuchet MS", Arial, sans-serif`; while (g.measureText(s).width > w * 0.94 && px > 8) { px -= 2; g.font = `${font} ${px}px "Trebuchet MS", Arial, sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; if (glow) { g.shadowColor = glow; g.shadowBlur = h * 0.35; } g.fillStyle = col; g.fillText(s, w / 2, h / 2 + h * 0.03);
};

/** facade edge (CCW ring) that faces point P best, weighted by length: { mid, u (along), n (outward), L } */
function edgeFacing(ring, P) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 6) continue;
    const n = [dz / L, -dx / L], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v = [P[0] - mid[0], P[1] - mid[1]], vl = Math.hypot(v[0], v[1]) || 1, face = (n[0] * v[0] + n[1] * v[1]) / vl, score = face * Math.min(L, 40);
    if (face > 0.2 && (!best || score > best.score)) best = { mid, u: [dx / L, dz / L], n, L, score };
  }
  return best;
}

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const BRANDS = [['MANGO', '#111111', '#f2f2f2'], ['ZARA', '#f4f4f4', '#111111'], ['SAS', '#0b5d3a', '#ffffff'], ['Burger House', '#c8102e', '#ffe14d'], ['Cafe Central', '#3b2418', '#f1d9a8'], ['PANDOK', '#7a1f1f', '#ffffff'], ['Tashir Pizza', '#e8e0d0', '#b3141b'], ['Vero Mondo', '#1b2a49', '#e6c36a'], ['Pharm', '#0f7a4b', '#ffffff'], ['OPTICA', '#20232a', '#8fd3ff'], ['SPORT', '#f26a1b', '#ffffff'], ['Gold & Co', '#201a10', '#f0c75e'], ['Bakery', '#f1e3c6', '#6b3b1a'], ['BANK', '#0a3d91', '#ffffff']];

export function buildShopSigns({ THREE, root, H, fp, northern = [] }) {
  const items = [], night = () => window.__yerevan?.tod?.night ?? 1;
  const put = (m, pos, n, yaw, yOff = 0) => { m.position.set(pos[0] + n[0] * 0.12, H(pos[0], pos[1]) + yOff, pos[1] + n[1] * 0.12); m.rotation.y = yaw; root.add(m); };
  const yawOf = n => Math.atan2(n[0], n[1]);
  // ---- Marriott: lettering above the revolving-door entrance, neon BYUREGH blade on the corner, red cafe awning
  const mr = fp.lm?.[31854855]?.rings?.[0];
  if (mr) {
    const e = edgeFacing(mr, [0, 0]);
    if (e) {
      const at = s => [e.mid[0] + e.u[0] * s, e.mid[1] + e.u[1] * s];
      const a = plate(THREE, 4.6, 0.95, (g, w, h) => text(g, w, h, 'Marriott', '#c8102e', '600 italic'));
      put(a.mesh, at(0), e.n, yawOf(e.n), 7.4); items.push({ mat: a.mat, k: 0.85 });
      const b = plate(THREE, 0.9, 4.4, (g, w, h) => { g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); text(g, h, w, 'BYUREGH', '#ff5fa8', '800', '#ff2d8a'); g.restore(); g.strokeStyle = '#59b6ff'; g.lineWidth = 6; g.shadowColor = '#2f8cff'; g.shadowBlur = 14; g.strokeRect(5, 5, w - 10, h - 10); });
      put(b.mesh, at(Math.min(e.L * 0.5 - 2.5, 13)), e.n, yawOf(e.n), 3.2); items.push({ mat: b.mat, k: 1.0, glow: true });
    }
  }
  // ---- OSM brands: place on the nearest neighbour outline, facing away from it
  const brands = [['Pinkberry', [72, -149], '#ffffff', '#e0408f'], ['Jazzve', [99, -179], '#ffffff', '#7a2a1d']];
  for (const [name, p, fg, bg] of brands) {
    let best = null;
    for (const o of fp.others ?? []) { const r = o.r; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)), q = [a[0] + dx * t, a[1] + dz * t], d = dist(p, q); if (!best || d < best.d) best = { d, q, a, b, r }; } }
    if (!best || best.d > 25) continue;
    const dx = best.b[0] - best.a[0], dz = best.b[1] - best.a[1], L = Math.hypot(dx, dz) || 1; let n = [dz / L, -dx / L]; const cen = best.r.reduce((s, v) => [s[0] + v[0] / best.r.length, s[1] + v[1] / best.r.length], [0, 0]);
    if ((best.q[0] - cen[0]) * n[0] + (best.q[1] - cen[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const s = plate(THREE, 3.2, 0.7, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); text(g, w, h, name, fg, '800'); });
    put(s.mesh, best.q, n, yawOf(n), 3.3); items.push({ mat: s.mat, k: 0.9 });
  }
  // ---- Northern Avenue: brand fascias above the arcade, one every other bay, merged per brand (one draw call each)
  {
    const per = BRANDS.map(() => []), P = new THREE.Object3D(); let nS = 0;
    for (const inf of northern) for (const E of inf.avEdges || []) for (let k = 0; k < E.nB; k += 2) {
      const h = Math.abs(Math.sin(E.i * 12.9898 + k * 78.233 + inf.ring[0][0] * 0.37) * 43758.5453) % 1, b = Math.floor(h * BRANDS.length), w = Math.min(E.bw * 1.1, 4.2);
      const a = (k + 0.5) * E.bw, p = [E.F.o[0] + E.F.t[0] * a + E.F.n[0] * 0.2, E.F.o[2] + E.F.t[1] * a + E.F.n[1] * 0.2];
      const g = new THREE.PlaneGeometry(w, 0.8); P.position.set(p[0], inf.yFloor0 + 4.5, p[1]); P.rotation.set(0, Math.atan2(E.F.n[0], E.F.n[1]), 0); P.scale.set(1, 1, 1); P.updateMatrix(); g.applyMatrix4(P.matrix); per[b].push(g); nS++;
    }
    per.forEach((gs, b) => { if (!gs.length) return; const [name, bg, fg] = BRANDS[b]; const pl = plate(THREE, 4.2, 0.8, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8); g.globalAlpha = 1; text(g, w, h, name, fg, '800'); });
      const mesh = new THREE.Mesh(mergeGeometries(gs), pl.mat); mesh.frustumCulled = true; root.add(mesh); items.push({ mat: pl.mat, k: 0.95 }); });
    console.log('[shopsigns] northern', nS, 'fascias');
  }
  console.log('[shopsigns]', items.length, 'signs');
  return { update() { const n = night(); for (const it of items) { const k = it.k * (0.62 + 0.38 * n) * (it.glow ? 0.8 + 0.5 * n : 1); it.mat.color.setRGB(k, k, k); } } };
}
