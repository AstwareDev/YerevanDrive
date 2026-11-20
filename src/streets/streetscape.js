// Street furniture that defines Orbeli Brothers St and Komitas Ave (survey: .scratch/streets-reference.md):
//   Komitas: trolleybus overhead line from Mher Mkrtchyan Sq (Vazgen I) eastwards -- galvanised poles on both kerbs every ~30 m, transverse
//            span wires across the whole avenue, two contact wires (+/-) per direction over the middle lane, hangers.
//   Orbeli : dark rock-faced basalt retaining walls along the uphill north side (grass bank on top), whitewashed tree trunks,
//            the white steel bus shelter at No. 12, the basalt + granite street-name stele at the Baghramyan corner.
//   Both   : yellow zebra crossings (all Yerevan crossings in the reference photos are yellow).
import * as THREE from 'three';
import { h3 } from './facade.js';

const lines = flat => flat.map(r => { const p = []; for (let i = 0; i < r.length; i += 2) p.push([r[i], r[i + 1]]); return p; });
function nearestOn(pls, x, z, skip = null) {
  let best = { d: 1e9, p: null, t: null, pl: null };
  for (const pl of pls) { if (pl === skip) continue; for (let i = 1; i < pl.length; i++) { const [ax, az] = pl[i - 1], [bx, bz] = pl[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz); if (d < best.d) { const L = Math.sqrt(L2); best = { d, p: [px, pz], t: [dx / L, dz / L], pl }; } } }
  return best;
}
/** samples along a polyline every `step` metres: { x, z, tx, tz } */
function sample(pl, step, start = 0) {
  const out = []; let acc = -start;
  for (let i = 1; i < pl.length; i++) {
    const [ax, az] = pl[i - 1], [bx, bz] = pl[i], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue; const tx = (bx - ax) / L, tz = (bz - az) / L;
    let s = acc < 0 ? -acc : (step - acc % step) % step;
    for (; s <= L; s += step) out.push({ x: ax + tx * s, z: az + tz * s, tx, tz });
    acc += L;
  }
  return out;
}

export function buildStreetscape({ data, H, root, M }) {
  const std = (hex, rough = 0.9, metal = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const stats = {};

  // ------------------------------------------------------------------ yellow zebras (shared crossing material of the map tiles)
  if (M?.crossing) M.crossing.color.set(0xe6c84a);

  // ------------------------------------------------------------------ Komitas trolleybus overhead line
  const K = lines(data.komitas ?? []).filter(pl => pl.some(p => p[0] > -1480));
  if (K.length) {
    const poles = [], seg = [];
    const sag = (a, b, drop, k = 8) => { for (let i = 0; i < k; i++) { const t0 = i / k, t1 = (i + 1) / k, f = t => 4 * t * (1 - t); seg.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 - drop * f(t0), a[2] + (b[2] - a[2]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 - drop * f(t1), a[2] + (b[2] - a[2]) * t1); } };
    for (const pl of K) {
      const pts = sample(pl, 30, 5).filter(s => s.x > -1480 && s.x < 1090);
      let prev = null;
      for (const s of pts) {
        const o = nearestOn(K, s.x, s.z, pl); if (o.d > 26) { prev = null; continue; }   // only where both directions run side by side
        const nx = -s.tz, nz = s.tx, side = Math.sign((o.p[0] - s.x) * nx + (o.p[1] - s.z) * nz) || 1;
        const kerb = 7.4;                                                              // pole stands behind the outer kerb of this carriageway
        const px = s.x - nx * side * kerb, pz = s.z - nz * side * kerb, py = H(px, pz);
        poles.push({ x: px, z: pz, y: py, ry: Math.atan2(nx * side, nz * side) });
        const yW = H(s.x, s.z) + 5.9;
        // contact wire pair over this carriageway, sagging between hangers
        if (prev) for (const off of [-0.3, 0.3]) sag([prev.x + prev.nx * off, prev.yW, prev.z + prev.nz * off], [s.x + nx * off, yW, s.z + nz * off], 0.18);
        // span wire from this pole across the avenue to the opposite pole (drawn from the eastbound side only, so once)
        if (s.tx > 0) { const ox = o.p[0] + nx * side * kerb, oz = o.p[1] + nz * side * kerb; sag([px, py + 7.1, pz], [ox, H(ox, oz) + 7.1, oz], 0.55, 12); }
        prev = { x: s.x, z: s.z, nx, nz, yW };
      }
    }
    // hangers: short drops from the span wires to the contact wires are implied by the span sag; add the bracket arms on the poles
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 9.2, 10).translate(0, 4.6, 0), armGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6).rotateX(Math.PI / 2).translate(0, 7.2, 0.8);
    const galv = std(0x9a9c9c, 0.45, 0.75);
    const P = new THREE.InstancedMesh(poleGeo, galv, poles.length), A = new THREE.InstancedMesh(armGeo, galv, poles.length);
    poles.forEach((p, i) => { q.setFromAxisAngle(up, p.ry); m4.compose(v3.set(p.x, p.y, p.z), q, sc.set(1, 1, 1)); P.setMatrixAt(i, m4); A.setMatrixAt(i, m4); });
    P.castShadow = true; root.add(P, A);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x141416 })); wires.frustumCulled = false; root.add(wires);
    stats.trolleyPoles = poles.length;
  }

  // ------------------------------------------------------------------ Orbeli: basalt retaining walls on the north (uphill) side
  const O = lines(data.orbeli ?? []), J = data.junctions ?? [];
  if (O.length) {
    const wall = [], idx = [], nrm = [], uv = [];
    const bankP = [], bankN = [], bankI = [];
    const quad = (arr, ni, iu, a, b, c, d, n, u0, u1, v0, v1) => { const o = arr.length / 3; arr.push(...a, ...b, ...c, ...d); for (let k = 0; k < 4; k++) ni.push(...n); if (iu) iu.push(u0, v0, u1, v0, u1, v1, u0, v1); return o; };
    const ranges = [[-1952, -1655], [-1505, -1470]];                                  // survey: x -1950..-1650 and the east-central blocks
    for (const pl of O) {
      const pts = sample(pl, 2.0);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]; const mx = (a.x + b.x) / 2; if (!ranges.some(([x0, x1]) => mx > x0 && mx < x1)) continue;
        // north side = the side with more negative z
        const nx = -a.tz, nz = a.tx, s = nz < 0 ? 1 : -1, off = 10.8;
        const A = [a.x + nx * s * off, a.z + nz * s * off], B = [b.x + nx * s * off, b.z + nz * s * off];
        if (J.some(j => Math.hypot(j[0] - (A[0] + B[0]) / 2, j[1] - (A[1] + B[1]) / 2) < 9)) continue;     // gap where a side street / drive meets the road
        if ((data.blocks ?? []).some(bl => bl.ring.some(p => Math.hypot(p[0] - A[0], p[1] - A[1]) < 2.5))) continue;
        const ya = H(A[0], A[1]), yb = H(B[0], B[1]);
        const ha = 1.6 + 1.3 * h3(Math.round(A[0] / 9), Math.round(A[1] / 9), 4), hb = 1.6 + 1.3 * h3(Math.round(B[0] / 9), Math.round(B[1] / 9), 4);
        const n = [-nx * s, 0, -nz * s];                                                // faces the street
        const sA = i * 2.0, sB = sA + 2.0;
        const o = quad(wall, nrm, uv, [A[0], ya - 0.3, A[1]], [B[0], yb - 0.3, B[1]], [B[0], yb + hb, B[1]], [A[0], ya + ha, A[1]], n, sA, sB, -0.3, Math.max(ha, hb));
        idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
        // coping + grass bank sloping back up from the wall top
        const back = 4.5, A2 = [A[0] + nx * s * back, A[1] + nz * s * back], B2 = [B[0] + nx * s * back, B[1] + nz * s * back];
        const o2 = quad(bankP, bankN, null, [A[0], ya + ha, A[1]], [B[0], yb + hb, B[1]], [B2[0], Math.max(H(B2[0], B2[1]), yb + hb * 0.6), B2[1]], [A2[0], Math.max(H(A2[0], A2[1]), ya + ha * 0.6), A2[1]], [0, 1, 0]);
        bankI.push(o2, o2 + 2, o2 + 1, o2, o2 + 3, o2 + 2);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      const basalt = new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.95, side: THREE.DoubleSide });
      basalt.onBeforeCompile = sh => {         // rock-faced basalt blocks, ~0.6 x 0.3 m courses, per-block tone, recessed joints
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBu;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBu = uv;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vBu;\nfloat bh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }')
          .replace('#include <map_fragment>', `#include <map_fragment>
            vec2 bu = vec2(vBu.x / 0.62, vBu.y / 0.31); float crs = floor(bu.y); bu.x += mod(crs, 2.0) * 0.5 + bh(vec2(crs, 3.0)) * 0.3;
            vec2 bi = floor(bu), bf = fract(bu); float tone = 0.75 + 0.45 * bh(bi);
            vec2 e = min(bf, 1.0 - bf) * vec2(0.62, 0.31); float jnt = 1.0 - smoothstep(0.01, 0.025, min(e.x, e.y));
            float rock = bh(floor(vBu * 22.0)) * 0.25;
            diffuseColor.rgb *= tone * (1.0 - 0.55 * jnt) * (0.88 + rock);`);
      };
      const w = new THREE.Mesh(g, basalt); w.castShadow = w.receiveShadow = true; root.add(w);
      const gb = new THREE.BufferGeometry(); gb.setAttribute('position', new THREE.Float32BufferAttribute(bankP, 3)); gb.setAttribute('normal', new THREE.Float32BufferAttribute(bankN, 3)); gb.setIndex(bankI); gb.computeVertexNormals();
      const bank = new THREE.Mesh(gb, M?.grass ?? std(0x4a5a30, 1)); bank.receiveShadow = true; root.add(bank);
      stats.retainingWall = Math.round(idx.length / 6 * 2) + ' m';
    }
  }

  // ------------------------------------------------------------------ Orbeli: whitewashed trunks (every street tree within 16 m of the street)
  stats.whitewash = 0;
  const addWhitewash = (trees) => {
    if (!trees || !O.length) return;
    const pick = [];
    for (let i = 0; i < trees.length / 7; i++) { const x = trees[i * 7], z = trees[i * 7 + 1]; if (x < -2200 || x > -1290 || z < -1900 || z > -1650) continue; if (nearestOn(O, x, z).d < 16) pick.push(i); }
    if (!pick.length) return;
    const geo = new THREE.CylinderGeometry(1, 1.08, 1, 10, 1, true).translate(0, 0.5, 0), mat = std(0xe8e6df, 0.95);
    const im = new THREE.InstancedMesh(geo, mat, pick.length);
    pick.forEach((i, k) => { const x = trees[i * 7], z = trees[i * 7 + 1], h = trees[i * 7 + 4], r = Math.max(0.1, Math.min(0.24, 0.035 * h)); m4.compose(v3.set(x, H(x, z) - 0.05, z), q.identity(), sc.set(r, 1.15, r)); im.setMatrixAt(k, m4); });
    im.receiveShadow = true; root.add(im); stats.whitewash = pick.length;
  };
  fetch('/map/props.json').then(r => r.json()).then(p => addWhitewash(p.trees)).catch(() => {});

  // ------------------------------------------------------------------ Orbeli 12 bus shelter + Baghramyan-corner street-name stele
  if (O.length) {
    const white = std(0xeeeeec, 0.4, 0.3), glass = new THREE.MeshStandardMaterial({ color: 0x9fb3bd, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 });
    const at = (x, z, mesh, ry = 0) => { mesh.position.set(x, H(x, z), z); mesh.rotation.y = ry; mesh.castShadow = true; root.add(mesh); return mesh; };
    { // shelter at the kerb in front of No. 12 (building centroid (-1796,-1718))
      const o = nearestOn(O, -1796, -1718), [tx, tz] = o.t, nx = -tz, nz = tx, s = (-1718 - o.p[1]) * nz + (-1796 - o.p[0]) * nx > 0 ? 1 : -1;
      const x = o.p[0] + nx * s * 8.6, z = o.p[1] + nz * s * 8.6, g = new THREE.Group();
      const B = (w, h, d, px, py, pz, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(px, py, pz); b.castShadow = true; g.add(b); };
      B(4.2, 0.12, 1.7, 0, 2.55, 0, white); for (const px of [-2, 2]) for (const pz of [-0.75, 0.75]) B(0.08, 2.5, 0.08, px, 1.25, pz, white);
      B(4.0, 1.9, 0.03, 0, 1.25, -0.78 * s, glass); B(0.03, 1.9, 1.5, -2, 1.25, 0, glass); B(3.2, 0.06, 0.4, 0, 0.48, -0.5 * s, white);
      at(x, z, g, Math.atan2(tx, tz) + Math.PI / 2);
    }
    { // stele: rock-faced basalt plinth + light granite slab with the carved name
      const g = new THREE.Group(); const bas = std(0x4f4d4b, 0.95), gran = std(0xb8b6b0, 0.6);
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.9), bas); p1.position.y = 0.8; g.add(p1);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.5), gran); sl.position.y = 2.05; g.add(sl);
      const o = nearestOn(O, -1387, -1863); at(-1387, -1863, g, Math.atan2(o.t[0], o.t[1]) + Math.PI / 2);
    }
  }
  // ------------------------------------------------------------------ landmarks: Komitas Market portico, Komitas 15 clock
  for (const bl of data.blocks ?? []) {
    if (bl.style !== 'market' && !bl.clock) continue;
    const ring = bl.ring, N = ring.length; let best = -1, bestL = 0;
    for (let i = 0; i < N; i++) { const p = ring[i], qq = ring[(i + 1) % N], L = Math.hypot(qq[0] - p[0], qq[1] - p[1]); if ((bl.front?.[i] || best < 0) && L > bestL) { best = i; bestL = L; } }
    const p = ring[best], qq = ring[(best + 1) % N], ux = (qq[0] - p[0]) / bestL, uz = (qq[1] - p[1]) / bestL, nx = uz, nz = -ux;
    let hi = -1e9; for (const r of ring) hi = Math.max(hi, H(r[0], r[1])); const y0 = hi + 0.3;
    const G = { market: [4.4, 4.4], tower: [3.1, 2.9] }[bl.style] ?? [3.5, 3.3], top = y0 + G[0] + (bl.lv - 1) * G[1];
    const at = (s, o) => [p[0] + ux * s + nx * o, p[1] + uz * s + nz * o];
    if (bl.style === 'market') {                     // two porticoes of 4 square columns with bracket capitals + entablature, basalt steps across the front
      const tuff = std(0xbe9884, 0.85), bas = std(0x4e4c4b, 0.95), g = new THREE.Group(), colH = G[0] + G[1] - 0.6;
      for (const c0 of [0.16, 0.66]) {
        for (let k = 0; k < 4; k++) { const [x, z] = at(bestL * (c0 + k * 0.06), 2.0); const col = new THREE.Mesh(new THREE.BoxGeometry(0.75, colH, 0.75), tuff); col.position.set(x, y0 + colH / 2, z); col.rotation.y = Math.atan2(ux, uz); col.castShadow = true; g.add(col); }
        const [ex, ez] = at(bestL * (c0 + 0.09), 1.6), ent = new THREE.Mesh(new THREE.BoxGeometry(bestL * 0.2, 0.9, 3.4), tuff); ent.position.set(ex, y0 + colH + 0.45, ez); ent.rotation.y = Math.atan2(nx, nz) + 0; ent.rotation.y = Math.atan2(ux, uz) + Math.PI / 2; ent.castShadow = true; g.add(ent);
      }
      for (let k = 0; k < 3; k++) { const [x, z] = at(bestL / 2, 3.6 + k * 0.45), st = new THREE.Mesh(new THREE.BoxGeometry(bestL * 0.9, 0.3, 0.45), bas); st.position.set(x, y0 - 0.15 - k * 0.3, z); st.rotation.y = Math.atan2(ux, uz) + Math.PI / 2; st.receiveShadow = true; g.add(st); }
      root.add(g); stats.market = true;
    }
    if (bl.clock) {                                  // Komitas 15: clock face at the top of the facade, lit at night
      const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
      c.fillStyle = '#f2ead8'; c.beginPath(); c.arc(128, 128, 124, 0, 7); c.fill(); c.strokeStyle = '#2a2420'; c.lineWidth = 8; c.stroke();
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.lineWidth = i % 3 ? 5 : 10; c.beginPath(); c.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96); c.lineTo(128 + Math.sin(a) * 114, 128 - Math.cos(a) * 114); c.stroke(); }
      c.lineWidth = 10; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + 50, 128 - 30); c.stroke(); c.lineWidth = 6; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 - 20, 128 - 92); c.stroke();
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.5 }));
      const [x, z] = at(bestL / 2, 0.08); face.position.set(x, top - 2.2, z); face.rotation.y = Math.atan2(nx, nz); root.add(face); stats.clock = true;
    }
  }
  return { stats };
}
