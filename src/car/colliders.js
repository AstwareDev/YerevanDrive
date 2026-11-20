// Static world colliders for Rapier, streamed in around the car. Everything is bucketed into 96 m cells; each loaded cell becomes ONE fixed
// triangle-mesh collider (building walls, OSM walls/fences, circuit barriers, tree trunks, lamp poles, bollards, parked cars).
const CELL = 96, LOAD_R = 150, DROP_R = 210;
const key = (i, j) => i * 4096 + j;

export async function createColliders({ RAPIER, world, ground, meta, circuits }) {
  const colliders = await (await fetch('/map/colliders.json')).json();
  let props = null; try { props = await (await fetch('/map/props.json')).json(); } catch (e) { /* optional */ }
  const cells = new Map();   // key -> { i, j, items: [], handle: collider | null }
  const cellOf = v => Math.floor(v / CELL);
  function bucket(x0, z0, x1, z1, item) {
    for (let i = cellOf(x0); i <= cellOf(x1); i++) for (let j = cellOf(z0); j <= cellOf(z1); j++) {
      const k = key(i, j); let c = cells.get(k); if (!c) cells.set(k, c = { i, j, items: [], handle: null });
      c.items.push(item);
    }
  }
  // ---- register items (data kept as the original arrays; geometry is only generated when a cell loads)
  for (const b of colliders.buildings) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let k = 0; k < b.r.length; k += 2) { x0 = Math.min(x0, b.r[k]); x1 = Math.max(x1, b.r[k]); z0 = Math.min(z0, b.r[k + 1]); z1 = Math.max(z1, b.r[k + 1]); } bucket(x0, z0, x1, z1, { t: 0, b }); }
  for (const w of colliders.walls) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let k = 0; k < w.l.length; k += 2) { x0 = Math.min(x0, w.l[k]); x1 = Math.max(x1, w.l[k]); z0 = Math.min(z0, w.l[k + 1]); z1 = Math.max(z1, w.l[k + 1]); } bucket(x0 - 1, z0 - 1, x1 + 1, z1 + 1, { t: 1, w }); }
  for (const c of circuits ?? []) for (const b of c.barriers ?? []) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); } bucket(x0 - 1, z0 - 1, x1 + 1, z1 + 1, { t: 2, b }); }
  const pts = (arr, stride, t, extra) => { for (let n = 0; n < arr.length; n += stride) { const x = arr[n + (extra?.xo ?? 0)], z = arr[n + (extra?.zo ?? 1)]; bucket(x - 3, z - 3, x + 3, z + 3, { t, x, z, a: arr, n }); } };
  if (meta?.trees) for (let n = 0; n < meta.trees.length; n += 4) { const x = meta.trees[n], z = meta.trees[n + 2]; bucket(x, z, x, z, { t: 3, x, z, r: 0.2 + 0.1 * meta.trees[n + 3] }); }
  // lamp poles / bollards are deliberately NOT solid: free roam is more fun when a pole does not stop the car dead
  if (props?.cars && new URLSearchParams(location.search).get('cars') === '1') for (let n = 0; n < props.cars.length; n += 7) { const x = props.cars[n], z = props.cars[n + 1]; bucket(x - 3, z - 3, x + 3, z + 3, { t: 4, x, z, yaw: props.cars[n + 2] }); }

  // ---- geometry emitters ------------------------------------------------------------------------------
  const V = [], I = [];
  const vert = (x, y, z) => { V.push(x, y, z); return V.length / 3 - 1; };
  const quad = (a, b, c, d) => { I.push(a, b, c, a, c, d); };
  // closed box between two ground points a,b (xz) with half-thickness th, from ya..ya+h (y per end)
  function segBox(ax, ay, az, bx, by, bz, th, h) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 1e-3) return;
    const nx = -dz / l * th, nz = dx / l * th;
    const p = [vert(ax + nx, ay, az + nz), vert(bx + nx, by, bz + nz), vert(bx - nx, by, bz - nz), vert(ax - nx, ay, az - nz),
      vert(ax + nx, ay + h, az + nz), vert(bx + nx, by + h, bz + nz), vert(bx - nx, by + h, bz - nz), vert(ax - nx, ay + h, az - nz)];
    quad(p[0], p[1], p[5], p[4]); quad(p[1], p[2], p[6], p[5]); quad(p[2], p[3], p[7], p[6]); quad(p[3], p[0], p[4], p[7]); quad(p[4], p[5], p[6], p[7]); quad(p[3], p[2], p[1], p[0]);
  }
  function prism(x, z, r, y0, y1, sides = 8) {
    const lo = [], hi = [];
    for (let k = 0; k < sides; k++) { const a = k / sides * Math.PI * 2; lo.push(vert(x + Math.cos(a) * r, y0, z + Math.sin(a) * r)); hi.push(vert(x + Math.cos(a) * r, y1, z + Math.sin(a) * r)); }
    for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; quad(lo[k], lo[k2], hi[k2], hi[k]); }
    for (let k = 1; k < sides - 1; k++) I.push(hi[0], hi[k], hi[k + 1]);
  }
  function emit(it) {
    switch (it.t) {
      case 0: { const r = it.b.r, n = r.length / 2; const lo = [], hi = []; for (let k = 0; k < n; k++) { lo.push(vert(r[k * 2], it.b.a, r[k * 2 + 1])); hi.push(vert(r[k * 2], it.b.b, r[k * 2 + 1])); } for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; quad(lo[k], lo[k2], hi[k2], hi[k]); }
        // roof cap (fan; footprints are mostly near-convex, and nothing ever lands there at game speeds) so a launched car cannot fall into a building
        for (let k = 1; k < n - 1; k++) I.push(hi[0], hi[k], hi[k + 1]); break; }
      case 1: { const l = it.w.l; for (let k = 2; k < l.length; k += 2) { const ax = l[k - 2], az = l[k - 1], bx = l[k], bz = l[k + 1]; segBox(ax, ground.terrain(ax, az) - 0.3, az, bx, ground.terrain(bx, bz) - 0.3, bz, 0.14, it.w.h + 0.3); } break; }
      case 2: { const p = it.b.pts, th = Math.max(0.15, it.b.w / 2); for (let k = 1; k < p.length; k++) segBox(p[k - 1][0], p[k - 1][1] - 0.05, p[k - 1][2], p[k][0], p[k][1] - 0.05, p[k][2], th, it.b.h + 0.05); break; }
      case 3: { const y = ground.y(it.x, it.z); prism(it.x, it.z, it.r, y - 0.2, y + (it.h ?? 3.0)); break; }
      case 4: { const y = ground.y(it.x, it.z) - 0.1, c = Math.cos(it.yaw), s = Math.sin(it.yaw), hw = 0.92, hl = 2.2, h = 1.35;
        const P = (lx, lz) => [it.x + lx * c + lz * s, it.z - lx * s + lz * c];
        const corners = [P(-hw, -hl), P(hw, -hl), P(hw, hl), P(-hw, hl)]; const lo = corners.map(q => vert(q[0], y, q[1])), hi = corners.map(q => vert(q[0], y + h, q[1]));
        for (let k = 0; k < 4; k++) quad(lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]); quad(hi[0], hi[1], hi[2], hi[3]); break; }
    }
  }
  function load(c) {
    V.length = 0; I.length = 0; for (const it of c.items) emit(it);
    if (!I.length) { c.handle = false; return; }
    const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(V), new Uint32Array(I)).setFriction(0.35).setRestitution(0.12);
    c.handle = world.createCollider(desc);
  }
  function unload(c) { if (c.handle) world.removeCollider(c.handle, false); c.handle = null; }

  let loadedCount = 0, enabled = true;
  return {
    setEnabled(e) { enabled = e; if (!e) for (const c of cells.values()) if (c.handle) { unload(c); loadedCount--; } },
    cells,
    get loaded() { return loadedCount; },
    /** call every ~0.25 s with the car position; loads at most `budget` cells per call */
    update(px, pz, budget = 3) {
      if (!enabled) return;
      const ci = cellOf(px), cj = cellOf(pz), R = Math.ceil(LOAD_R / CELL) + 1;
      let made = 0;
      for (let i = ci - R; i <= ci + R && made < budget; i++) for (let j = cj - R; j <= cj + R && made < budget; j++) {
        const c = cells.get(key(i, j)); if (!c || c.handle !== null) continue;
        const dx = Math.max(i * CELL - px, 0, px - (i + 1) * CELL), dz = Math.max(j * CELL - pz, 0, pz - (j + 1) * CELL);
        if (dx * dx + dz * dz > LOAD_R * LOAD_R) continue; load(c); if (c.handle) loadedCount++; made++;
      }
      for (const c of cells.values()) if (c.handle) { const dx = Math.max(c.i * CELL - px, 0, px - (c.i + 1) * CELL), dz = Math.max(c.j * CELL - pz, 0, pz - (c.j + 1) * CELL); if (dx * dx + dz * dz > DROP_R * DROP_R) { unload(c); loadedCount--; } }
    },
    /** load everything around a point right now (used at spawn so the car never starts inside an unloaded cell) */
    prime(px, pz) { for (let n = 0; n < 40; n++) this.update(px, pz, 50); },
  };
}
