// Orbeli Brothers St street features from the Street View survey: the raised central median (concrete kerb, dark soil, red flower bed,
// clipped shrubs) along the 4-lane stretch in front of BISA, an AVANTA-style pillar billboard and a tall Armenian flagpole on the far verge.
// OSM has a single carriageway here, so the median is laid on its centre line (data.roads) and gets a real trimesh collider (added to the
// Rapier world as soon as the car module is ready, same friction as the other static colliders).
import * as THREE from 'three';

const MEDIAN_HALF = 1.55, KERB = 0.17, S_MIN = -170, S_MAX = 150, GAP_EVERY = 90, GAP = 7;   // gaps = pedestrian/turning openings
const hash = (a, b = 0) => { let x = Math.imul((a * 374761393 + b * 668265263) | 0, 1274126177); x = Math.imul(x ^ (x >>> 13), 1103515245); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export function buildOrbeliMedian({ data, H, root }) {
  const { B, u, n } = data.strip, S = (x, z) => [(x - B[0]) * u[0] + (z - B[1]) * u[1], (x - B[0]) * n[0] + (z - B[1]) * n[1]];
  // ---- centre-line chains: Orbeli polylines clipped to the stretch in front of the block, resampled every 2 m
  const chains = [];
  for (const r of data.roads ?? []) {
    let cur = [];
    const flush = () => { if (cur.length > 2) chains.push(cur); cur = []; };
    for (let i = 2; i < r.length; i += 2) {
      const ax = r[i - 2], az = r[i - 1], bx = r[i], bz = r[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      for (let t = 0; t < L; t += 2) { const x = ax + (bx - ax) * t / L, z = az + (bz - az) * t / L, [s, d] = S(x, z); if (s > S_MIN && s < S_MAX && d > 4 && d < 26) cur.push({ x, z, s }); else flush(); }
    }
    flush();
  }
  if (!chains.length) return { update() {} };
  // direction + openings
  for (const c of chains) for (let i = 0; i < c.length; i++) { const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; c[i].tx = dx / l; c[i].tz = dz / l; c[i].y = H(c[i].x, c[i].z); c[i].open = ((c[i].s - S_MIN) % GAP_EVERY) < GAP; }

  const soilM = new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 1 }), kerbM = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 });
  const pos = [], idx = [], kpos = [], kidx = [], col = { V: [], I: [] };
  const flowers = [], shrubs = [];
  const run = (c, i0, i1) => {                                                              // a continuous stretch c[i0..i1]
    const P = (p, off, up) => [p.x - p.tz * off, p.y + up, p.z + p.tx * off];
    const strip = (arrP, arrI, a, b, o0, u0, o1, u1) => {                                    // quad strip between two offsets along the run
      const base = arrP.length / 3;
      for (let i = i0; i <= i1; i++) { arrP.push(...P(c[i], o0, u0), ...P(c[i], o1, u1)); }
      for (let k = 0; k < i1 - i0; k++) { const q = base + k * 2; arrI.push(q, q + 1, q + 3, q, q + 3, q + 2); }
      void a; void b;
    };
    const W = MEDIAN_HALF, Wi = MEDIAN_HALF - 0.28;
    strip(pos, idx, 0, 0, -Wi, KERB - 0.05, Wi, KERB - 0.05);                               // soil
    strip(kpos, kidx, 0, 0, -W, 0, -W, KERB); strip(kpos, kidx, 0, 0, W, KERB, W, 0);          // kerb faces
    strip(kpos, kidx, 0, 0, -W, KERB, -Wi, KERB); strip(kpos, kidx, 0, 0, Wi, KERB, W, KERB);  // kerb tops
    // collision hull of the same raised box (trimesh like the other static colliders)
    const b0 = col.V.length / 3; for (let i = i0; i <= i1; i++) col.V.push(...P(c[i], -W, -0.2), ...P(c[i], W, -0.2), ...P(c[i], -W, KERB), ...P(c[i], W, KERB));
    for (let k = 0; k < i1 - i0; k++) { const q = b0 + k * 4; for (const [a, b, d, e] of [[0, 1, 5, 4], [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6], [2, 3, 1, 0]]) col.I.push(q + a, q + b, q + e, q + a, q + e, q + d); }
    // planting: red flower bed in two rows + a clipped shrub every ~7 m
    for (let i = i0; i <= i1; i++) for (const row of [-0.6, -0.2, 0.2, 0.6]) for (let q = 0; q < 4; q++) { const k = hash(i * 4 + q, row * 10); if (k < 0.1) continue; const j = (hash(i * 4 + q, 7) - 0.5) * 0.25, p = c[i], along = q * 0.5 + (hash(i * 4 + q, 3) - 0.5) * 0.3; flowers.push([p.x - p.tz * (row + j) + p.tx * along, p.y + KERB + 0.06, p.z + p.tx * (row + j) + p.tz * along, 0.8 + k * 0.7, k]); }
    for (let i = i0 + 2; i <= i1; i += 4 + ((hash(i, 11) * 2) | 0)) { const p = c[i]; shrubs.push([p.x, p.y + KERB + 0.25, p.z, 0.45 + hash(i, 5) * 0.4]); }
  };
  for (const c of chains) { let i0 = -1; for (let i = 0; i <= c.length; i++) { const ok = i < c.length && !c[i].open; if (ok && i0 < 0) i0 = i; if (!ok && i0 >= 0) { if (i - 1 - i0 >= 3) run(c, i0, i - 1); i0 = -1; } } }

  const mk = (p, ix, m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals(); const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.castShadow = false; root.add(mesh); return mesh; };
  mk(pos, idx, soilM).material.side = THREE.DoubleSide; mk(kpos, kidx, kerbM).material.side = THREE.DoubleSide;
  const group = new THREE.Group(); group.name = 'orbeli-median-planting'; root.add(group);
  if (flowers.length) {
    const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), flowers.length), m4 = new THREE.Matrix4(), c3 = new THREE.Color();
    flowers.forEach((f, i) => { m4.compose(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Quaternion(), new THREE.Vector3(1, 0.8, 1).multiplyScalar(f[3])); fm.setMatrixAt(i, m4); fm.setColorAt(i, c3.setRGB(0.72 + f[4] * 0.25, 0.04 + f[4] * 0.05, 0.05 + f[4] * 0.04)); });
    fm.frustumCulled = false; group.add(fm);
  }
  if (shrubs.length) {
    const sm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x2f6b2c, roughness: 0.95 }), shrubs.length), m4 = new THREE.Matrix4(), c3 = new THREE.Color();
    shrubs.forEach((f, i) => { m4.compose(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Quaternion(), new THREE.Vector3(f[3] * 1.2, f[3] * 0.8, f[3] * 1.2)); sm.setMatrixAt(i, m4); sm.setColorAt(i, c3.setHSL(0.3 + hash(i, 2) * 0.06, 0.5, 0.22 + hash(i, 3) * 0.1)); });
    sm.frustumCulled = false; sm.castShadow = true; group.add(sm);
  }

  // ---- physics: add the median hull to the Rapier world once the car module exists
  if (col.I.length) {
    const t0 = performance.now(), poll = setInterval(() => {
      const car = window.__car; if (car?.world && car?.RAPIER) {
        clearInterval(poll); car.world.createCollider(car.RAPIER.ColliderDesc.trimesh(new Float32Array(col.V), new Uint32Array(col.I)).setFriction(0.35).setRestitution(0.12));
      } else if (performance.now() - t0 > 120000) clearInterval(poll);
    }, 500);
  }

  // ---- far-verge props, placed from the strip frame (s along the street, d towards the road)
  const at = (s, d) => [B[0] + u[0] * s + n[0] * d, B[1] + u[1] * s + n[1] * d], yaw = Math.atan2(-u[0], -u[1]);
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  // billboard: concrete pillar + backlit panel (generic ad design, "AVANTA" wordmark only)
  const glow = [];
  {
    const [x, z] = at(122, 23.5), y = H(x, z), c = cv(1024, 512), g = c.getContext('2d');
    g.fillStyle = '#f4f6f4'; g.fillRect(0, 0, 1024, 512); g.fillStyle = '#e5ece6'; g.fillRect(0, 380, 1024, 132);
    g.fillStyle = '#43b54a'; g.beginPath(); g.arc(170, 190, 92, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f4f6f4'; g.beginPath(); g.arc(214, 160, 36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#43b54a'; g.font = '900 150px Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('AVANTA', 290, 190);
    g.fillStyle = '#25302a'; g.font = '700 54px Arial, sans-serif'; g.fillText('ՆՈՐ ԱՌԱՋԱՐԿ ԱՅՍՕՐ', 64, 440);
    const t = tex(c), pm = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.15, roughness: 0.6 });
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.6, 0.9), new THREE.MeshStandardMaterial({ color: 0xcfd2d0, roughness: 0.9 })); pillar.position.set(x, y + 3.3, z); pillar.rotation.y = yaw; pillar.castShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 0.3), [new THREE.MeshStandardMaterial({ color: 0x3a3d3c }), new THREE.MeshStandardMaterial({ color: 0x3a3d3c }), new THREE.MeshStandardMaterial({ color: 0x3a3d3c }), new THREE.MeshStandardMaterial({ color: 0x3a3d3c }), pm, pm]);
    panel.position.set(x, y + 8.2, z); panel.rotation.y = yaw; panel.castShadow = true; root.add(pillar, panel); glow.push(pm);
  }
  // flagpole with an animated tricolour
  let flag = null;
  {
    const [x, z] = at(140, 25), y = H(x, z), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.14, 13, 10), new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.5, metalness: 0.5 })); pole.position.set(x, y + 6.5, z); pole.castShadow = true;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd9b24a, metalness: 0.8, roughness: 0.3 })); ball.position.set(x, y + 13.2, z);
    const c = cv(96, 64), g = c.getContext('2d'); ['#d90012', '#0033a0', '#f2a800'].forEach((col2, i) => { g.fillStyle = col2; g.fillRect(0, i * 64 / 3, 96, 64 / 3 + 1); });
    const geo = new THREE.PlaneGeometry(4.2, 2.8, 24, 1), fm = new THREE.MeshStandardMaterial({ map: tex(c), side: THREE.DoubleSide, roughness: 0.9 }); flag = new THREE.Mesh(geo, fm); flag.position.set(x + u[0] * 2.1, y + 11.6, z + u[1] * 2.1); flag.rotation.y = yaw + Math.PI / 2 * 0; flag.frustumCulled = false;
    flag.userData.base = Float32Array.from(geo.attributes.position.array); root.add(pole, ball, flag);
  }
  console.log(`[orbeli/median] ${chains.length} chains, ${flowers.length} flowers, ${shrubs.length} shrubs`);
  return {
    update(time, night = 0) {
      for (const m of glow) m.emissiveIntensity = 0.15 + 0.85 * night;
      if (flag) { const a = flag.geometry.attributes.position, b = flag.userData.base; for (let i = 0; i < a.count; i++) { const x = b[i * 3], k = (x + 2.1) / 4.2; a.setZ(i, Math.sin(time * 3.2 + x * 1.6) * 0.28 * k); a.setY(i, b[i * 3 + 1] + Math.sin(time * 2.1 + x) * 0.05 * k); } a.needsUpdate = true; }
    },
  };
}
