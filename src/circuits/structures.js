// Trackside structures: start/finish gantry, sector arches, braking boards + corner signs, pit boxes + timing tower,
// spectator stands, sponsor banner fences, floodlight towers. All merged into cell-bucketed static batches.
import { mkRng, lin, clamp, mod } from './util.js';

const C = {
  white: lin('#e6e6e1'), black: lin('#18191c'), steel: lin('#8d9199'), dark: lin('#33363c'), concrete: lin('#8c8b86'), yellow: lin('#e9b500'),
  red: lin('#c3161c'), blue: lin('#1d4fb3'), green: lin('#1f8a4c'), orange: lin('#f07a00'), glass: lin('#1e2a38'), roof: lin('#5b5f66'), team: ['#c3161c', '#1d4fb3', '#e9b500', '#1f8a4c', '#f07a00', '#7b2d9e', '#00a3a3', '#e6e6e1'].map(lin),
};
const LAMP = [1.0, 0.92, 0.75], RED_LAMP = [1.0, 0.08, 0.05], WIN = [0.5, 0.42, 0.3];

export function dressStructures(kit, tr) {
  const { gb: G, quality, H } = kit, c = tr.c, n = tr.n, ds = tr.ds, ps = quality.propScale, lowQ = quality.level === 'low';
  const rng = mkRng(tr.id.length * 977 + 13), f = {}, f2 = {}, S = G.solid, L = G.lamps;
  const bannerUV = tile => { const col = tile % kit.atlas.banner.cols, row = Math.floor(tile / kit.atlas.banner.cols), cw = 1 / kit.atlas.banner.cols, rh = 1 / kit.atlas.banner.rows; return [col * cw, 1 - (row + 1) * rh, (col + 1) * cw, 1 - row * rh]; };
  const gy = (x, z) => H(x, z) + 0.09;
  /** world point from a track frame + lateral offset + height */
  const P = (fr, lat, y = 0, fwd = 0) => { const x = fr.cx + fr.rx * lat + fr.tx * fwd, z = fr.cz + fr.rz * lat + fr.tz * fwd; return [x, gy(x, z) + y, z]; };
  const stats = { gantry: 1, arches: 0, boards: 0, pitBoxes: 0, stands: 0, towers: 0, fences: 0 };

  // ------------------------------------------------------------ start / finish gantry
  {
    tr.at(0, 0, f); const hw = f.hw, span = f.w + 3.2, off = hw + 1.4, h = 7.0;
    S.at(f.cx, f.cz); L.at(f.cx, f.cz); G.gantry[tr.id].at(f.cx, f.cz);
    for (const sg of [-1, 1]) {
      const [x, y, z] = P(f, sg * off); const gx = x, gz = z;
      for (let k = 0; k < Math.ceil(h / 0.6); k++) S.box(gx, y + 0.3 + k * 0.6, gz, 0.7, 0.6, 0.7, f.yaw, k & 1 ? C.black : C.white);
      S.box(gx, y + 0.2, gz, 1.1, 0.4, 1.1, f.yaw, C.dark);
    }
    const [bx, by, bz] = P(f, 0, h, 0);
    S.box(bx, by + 0.35, bz, span + 1.6, 0.8, 0.9, f.yaw, C.dark);  // top truss (local x = across the road)
    S.box(bx, by - 0.1, bz, span + 1.6, 0.18, 0.18, f.yaw, C.steel);
    // banner both sides
    const bw = span - 1.0, bh = bw * 160 / 1024, yb = by - bh - 0.3;
    for (const dir of [1, -1]) {
      const fx = f.tx * dir * 0.46, fz = f.tz * dir * 0.46, p = (lat, y) => [bx - f.rx * lat * dir + fx, y, bz - f.rz * lat * dir + fz];
      G.gantry[tr.id].quad(p(-bw / 2, yb), p(bw / 2, yb), p(bw / 2, yb + bh), p(-bw / 2, yb + bh), [0, 0, 1, 1], [1, 1, 1], [f.tx * dir, 0, f.tz * dir]);
    }
    S.box(bx, yb + bh / 2, bz, 0.12, bh + 0.2, 0.12, f.yaw, C.dark); // centre hanger
    // start light bar under the beam: 5 red lamps + a row of white work lights
    for (let k = -2; k <= 2; k++) { const [lx, ly, lz] = P(f, k * 1.2, h - 0.35); for (const dir of [1, -1]) L.box(lx + f.tx * 0.5 * dir, ly + 0.05, lz + f.tz * 0.5 * dir, 0.5, 0.5, 0.12, f.yaw, RED_LAMP); S.box(lx, ly + 0.05, lz, 0.62, 0.62, 0.8, f.yaw, C.black); }
    for (let k = -4; k <= 4; k += 2) { const [lx, ly, lz] = P(f, k * (span / 11), h - 0.2); L.box(lx, ly, lz, 0.9, 0.12, 0.4, f.yaw, LAMP); }
    S.free(); L.free(); G.gantry[tr.id].free();
  }

  // ------------------------------------------------------------ sector arches
  for (const cp of c.checkpoints) {
    tr.at(cp.index, 0, f); if (f.w > 24) continue; const hw = f.hw, off = hw + 0.9, h = 5.4, span = f.w + 1.8;
    S.at(f.cx, f.cz); L.at(f.cx, f.cz); G.banner.at(f.cx, f.cz);
    for (const sg of [-1, 1]) { const [x, y, z] = P(f, sg * off); S.box(x, y + h / 2, z, 0.42, h, 0.42, f.yaw, C.yellow); S.box(x, y + 0.15, z, 0.8, 0.3, 0.8, f.yaw, C.dark); }
    const [bx, by, bz] = P(f, 0, h);
    S.box(bx, by + 0.15, bz, span, 0.5, 0.5, f.yaw, C.black);
    const tile = 16 + ((cp.n - 1) % 14), bw = Math.min(span - 1.2, 7.5), bh = bw / 4, yb = by - bh - 0.1, uv = bannerUV(tile);
    for (const dir of [1, -1]) { const fx = f.tx * dir * 0.27, fz = f.tz * dir * 0.27, p = (lat, y) => [bx - f.rx * lat * dir + fx, y, bz - f.rz * lat * dir + fz]; G.banner.quad(p(-bw / 2, yb), p(bw / 2, yb), p(bw / 2, yb + bh), p(-bw / 2, yb + bh), uv, [1, 1, 1], [f.tx * dir, 0, f.tz * dir]); }
    for (let k = -1; k <= 1; k++) { const [lx, ly, lz] = P(f, k * span * 0.28, h - 0.22); L.box(lx, ly, lz, 0.5, 0.1, 0.3, f.yaw, LAMP); }
    S.free(); L.free(); G.banner.free(); stats.arches++;
  }

  // ------------------------------------------------------------ braking boards (150/100/50) and corner number signs
  const signUV = tile => kit.atlas.sign.tile(tile);
  const post = (fr, lat, hgt, rad = 0.045) => { const a = P(fr, lat, 0), b = P(fr, lat, hgt); S.cyl(a, b, rad, rad, 6, C.dark, true); };
  const board = (fr, lat, y0, size, tile) => {
    const u = signUV(tile), cx = fr.cx + fr.rx * lat, cz = fr.cz + fr.rz * lat, base = gy(cx, cz) + y0, hs = size / 2, nx = -fr.tx, nz = -fr.tz; // faces oncoming traffic (-forward)
    const p = (a, y) => [cx + fr.rx * a - fr.tx * 0.03, base + y, cz + fr.rz * a - fr.tz * 0.03];
    // quad ordered CCW as seen from the front (viewer looking along +forward): left is -right... viewer at -forward looking +forward: right-hand = +r
    G.signs.quad(p(-hs, 0), p(hs, 0), p(hs, size), p(-hs, size), [u[0], u[1], u[0] + u[2], u[1] + u[3]], [1, 1, 1], [nx, 0, nz]);
    { const q = (a, y) => { const r = p(a, y); r[0] += fr.tx * 0.06; r[2] += fr.tz * 0.06; return r; }; G.signs.quad(q(hs, 0), q(-hs, 0), q(-hs, size), q(hs, size), [u[0], u[1], u[0] + u[2], u[1] + u[3]], [1, 1, 1], [-nx, 0, -nz]); }
    S.box(cx, base + size / 2, cz, 0.05, size + 0.08, 0.05, fr.yaw, C.dark); // frame backing (slim) keeps the sign from looking paper-thin
  };
  const wallOf = {}; for (const w of kit.walls[tr.id] ?? []) wallOf[w.co.n] = w;
  const showSigns = new URLSearchParams(location.search).get('signs') === '1';     // road signs are off by default (?signs=1 restores them)
  for (const co of (showSigns ? c.corners : [])) {
    if (co.severity < 2 || (lowQ && co.severity < 3)) continue;
    const sg = co.dir === 'R' ? -1 : 1, w = wallOf[co.n], extra = w ? 0.5 + w.cols * 0.64 + 0.5 : 0.8;
    const signTile = kit.signTile(tr.id, co.n);
    // corner number sign on the outside, just before turn-in
    tr.at(co.entry - 10 / ds, 0, f); post(f, sg * (f.hw + 0.5 + extra + 0.2), 2.5); board(f, sg * (f.hw + 0.5 + extra + 0.2), 1.6, 1.0, signTile); S.at(f.cx, f.cz); stats.boards++;
    if (co.severity >= 3) for (const [d, tile] of [[150, 0], [100, 1], [50, 2]]) {
      if (d === 150 && co.severity < 4) continue; tr.at(co.entry - d / ds, 0, f);
      const lat = sg * (f.hw + 1.4); post(f, lat, 1.5); board(f, lat, 0.7, 0.9, tile); stats.boards++;
    }
  }
  // start/finish board near the line
  { tr.at(-12 / ds, 0, f); const lat = -(f.hw + 1.4); post(f, lat, 1.5); board(f, lat, 0.7, 0.9, 3); }

  // ------------------------------------------------------------ pit boxes + timing tower
  const pit = c.pit, psg = pit.side === 'R' ? 1 : -1;
  {
    const boxW = 7.6, depth = 7.0, hgt = 4.3, count = 8, doorH = 3.2;
    for (let k = 0; k < count; k++) {
      const ii = pit.index + (k - (count - 1) / 2) * boxW / ds; tr.at(ii, 0, f);
      const lat = psg * (f.hw + 3.4 + 0.8 + depth / 2), [x, y, z] = P(f, lat), yaw = f.yaw + (psg > 0 ? Math.PI : 0), team = C.team[k % C.team.length];
      S.at(x, z); L.at(x, z); G.banner.at(x, z);
      const co = Math.cos(yaw), si = Math.sin(yaw); const loc = (a, b) => [x + a * co + b * si, z - a * si + b * co]; // a: outward (+x), b: along (+z)
      S.box(x, y + 0.07, z, depth, 0.14, boxW, yaw, lin('#2b2d31'));
      { const [bwx, bwz] = loc(depth / 2 - 0.15, 0); S.box(bwx, y + hgt / 2, bwz, 0.3, hgt, boxW, yaw, lin('#d8d6cf')); }
      for (const sd of [-1, 1]) { const [sx, sz] = loc(0, sd * (boxW / 2 - 0.15)); S.box(sx, y + hgt / 2, sz, depth, hgt, 0.3, yaw, sd > 0 ? lin('#cfcdc6') : lin('#cfcdc6')); }
      { const [rx, rz] = loc(-0.3, 0); S.box(rx, y + hgt + 0.15, rz, depth + 0.6, 0.3, boxW + 0.3, yaw, C.roof); }
      { const [lx, lz] = loc(-depth / 2 + 0.25, 0); S.box(lx, y + doorH + (hgt - doorH) / 2, lz, 0.5, hgt - doorH, boxW, yaw, team); }   // lintel in team colour
      for (const sd of [-1, 1]) { const [px, pz] = loc(-depth / 2 + 0.25, sd * (boxW / 2 - 0.35)); S.box(px, y + doorH / 2, pz, 0.5, doorH, 0.7, yaw, C.dark); }
      { const [ex, ez] = loc(-depth / 2 + 0.55, 0); L.box(ex, y + doorH - 0.12, ez, 0.12, 0.1, boxW - 1.8, yaw, LAMP); }
      // rolled-up door slab + sponsor strip on the lintel face
      { const [dx, dz] = loc(-depth / 2 + 0.7, 0); S.box(dx, y + doorH - 0.2, dz, 0.2, 0.4, boxW - 1.5, yaw, C.steel); }
      const uv = bannerUV((k * 3 + 1) % 16), fx = f.tx, fz = f.tz, rxn = f.rx * -psg, rzn = f.rz * -psg; // face normal toward the road
      const [fxx, fzz] = loc(-depth / 2 - 0.03, 0), by0 = y + doorH + 0.15, bw2 = boxW - 1.0, bh2 = Math.min(hgt - doorH - 0.3, bw2 / 4);
      const p = (a, yy) => [fxx - f.tx * a * psg, by0 + yy, fzz - f.tz * a * psg];
      // orientation: for psg>0 (right side) the face looks to the left (-r); viewer there sees +forward on their ... build both orders to be safe via two quads
      G.banner.quad(p(-bw2 / 2, 0), p(bw2 / 2, 0), p(bw2 / 2, bh2), p(-bw2 / 2, bh2), uv, [1, 1, 1], [rxn, 0, rzn]);
      { const q = (a, yy) => { const r = p(a, yy); r[0] -= rxn * 0.05; r[2] -= rzn * 0.05; return r; }; G.banner.quad(q(bw2 / 2, 0), q(-bw2 / 2, 0), q(-bw2 / 2, bh2), q(bw2 / 2, bh2), uv, [1, 1, 1], [-rxn, 0, -rzn]); }
      S.free(); L.free(); G.banner.free(); stats.pitBoxes++;
    }
    // timing tower at the downstream end
    const ii = pit.index + (count / 2 + 0.9) * boxW / ds + 5 / ds; tr.at(ii, 0, f);
    const lat = psg * (f.hw + 3.4 + 0.8 + 3.2), [x, y, z] = P(f, lat), yaw = f.yaw + (psg > 0 ? Math.PI : 0), co = Math.cos(yaw), si = Math.sin(yaw);
    S.at(x, z); L.at(x, z);
    const bodyH = 10.6, W = 9.0, D = 6.4;
    S.box(x, y + bodyH / 2, z, D, bodyH, W, yaw, lin('#c9c7c0'));
    for (let fl = 0; fl < 3; fl++) { // ribbon windows towards the track (-x local)
      const wy = y + 1.6 + fl * 3.1; const [wx, wz] = [x - 3.23 * co, z + 3.23 * si];
      L.box(wx, wy + 0.7, wz, 0.1, 1.5, W - 1.2, yaw, WIN); S.box(wx - 0.02 * co, wy - 0.25, wz + 0.02 * si, 0.2, 0.3, W - 0.8, yaw, C.dark);
    }
    S.box(x, y + bodyH + 0.18, z, D + 0.6, 0.36, W + 0.6, yaw, C.roof);
    S.box(x - 3.3 * co, y + bodyH + 0.7, z + 3.3 * si, 0.2, 1.0, W + 0.6, yaw, C.red); // roof parapet stripe
    S.cyl([x + 1.5 * co, y + bodyH, z - 1.5 * si], [x + 1.5 * co, y + bodyH + 7, z - 1.5 * si], 0.08, 0.04, 6, C.steel, true); // antenna mast
    L.box(x + 1.5 * co, y + bodyH + 7.1, z - 1.5 * si, 0.25, 0.25, 0.25, yaw, RED_LAMP);
    // exterior stairs
    S.box(x + (W / 2 + 0.7) * si, y + 3.2, z + (W / 2 + 0.7) * co, 1.0, 6.4, 1.2, yaw, C.steel); // stair tower
    // big timing screen facing the road (emissive) + title banner
    L.box(x - 3.28 * co, y + bodyH + 1.9, z + 3.28 * si, 0.12, 2.0, 5.2, yaw, [0.25, 0.6, 1.0]);
    S.box(x - 3.2 * co, y + bodyH + 1.9, z + 3.2 * si, 0.2, 2.2, 5.5, yaw, C.black);
    S.free(); L.free(); stats.tower = 1;
  }

  // ------------------------------------------------------------ spectator stands (follow the track on the outside of the bend) + fence + canopy
  const standTier = 0.45, standRun = 0.95, module = 6.0;
  for (const st of c.stands) {
    const sg = st.side === 'R' ? 1 : -1, tiers = clamp(Math.floor((st.room - 4.0) / standRun), 2, 6), mods = Math.floor(st.length / module);
    for (let m = 0; m < mods; m++) {
      const ii = st.index + (m - (mods - 1) / 2) * module / ds; tr.at(ii, 0, f); tr.at(ii + 3 / ds, 0, f2);
      const yaw = f.yaw + (sg > 0 ? Math.PI : 0), co = Math.cos(yaw), si = Math.sin(yaw), baseLat = f.hw + 3.0;
      const [x0, y0, z0] = P(f, sg * baseLat);
      S.at(x0, z0); G.stand.at(x0, z0);
      for (let t = 0; t < tiers; t++) { // local +x = outward
        const lat = sg * (baseLat + t * standRun + standRun / 2), [x, y, z] = P(f, lat), hh = standTier * (t + 1);
        G.stand.box(x, y + hh / 2, z, standRun, hh, module + 0.04, yaw, [1, 1, 1], [0, 0, 1, 0.5]);
      }
      // canopy over the top tiers: slab + 2 posts per module
      const topLat = sg * (baseLat + tiers * standRun), [bx, by, bz] = P(f, sg * (baseLat + tiers * standRun - 2.2));
      S.box(bx, by + standTier * tiers + 3.3, bz, 6.6, 0.22, module + 0.1, yaw, C.roof);
      const [px, py, pz] = P(f, topLat - sg * 0.2); S.box(px, py + (standTier * tiers + 3.3) / 2, pz, 0.22, standTier * tiers + 3.3, 0.22, yaw, C.steel);
      if (m % 2 === 0) { const [qx, qy, qz] = P(f, sg * (baseLat + 0.4)); S.box(qx, qy + 1.65, qz, 0.18, 3.3 + standTier * 0.5, 0.18, yaw, C.steel); }
      // front railing
      const [rx, ry, rz] = P(f, sg * (baseLat - 0.1)); S.box(rx, ry + 0.55, rz, 0.06, 0.08, module, yaw, C.steel); S.box(rx, ry + 1.05, rz, 0.06, 0.08, module, yaw, C.steel);
      S.free(); G.stand.free();
    }
    stats.stands++;
    // sponsor fence in front of the stand
    fence(tr, kit, st.index - st.length / 2 / ds, st.length / ds, sg, 1.9, rng);
  }

  // ------------------------------------------------------------ sponsor banner fences: pit straight, opposite side of S/F, behind tyre walls
  function fence(tr, kit, i0, len, sg, extra, rng2) {
    const panelW = 3.0, panels = Math.floor(len * ds / panelW);
    for (let k = 0; k < panels; k++) {
      const ii = i0 + (k + 0.5) * panelW / ds; tr.at(ii, 0, f); tr.at(ii + 1 / ds, 0, f2);
      const lat = sg * (f.hw + extra), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat, y = gy(x, z), uv = bannerUV(Math.floor(rng2() * 16));
      if (tr.clear(ii, sg) < extra + 0.4) continue;
      const nx = -f.rx * sg, nz = -f.rz * sg;    // faces the road
      const p = (a, yy) => [x - f.tx * a * sg, y + yy, z - f.tz * a * sg];
      G.banner.at(x, z); G.banner.quad(p(-panelW / 2, 0.35), p(panelW / 2, 0.35), p(panelW / 2, 1.4), p(-panelW / 2, 1.4), uv, [1, 1, 1], [nx, 0, nz]);
      { const q = (a, yy) => { const r = p(a, yy); r[0] -= nx * 0.05; r[2] -= nz * 0.05; return r; }; G.banner.quad(q(panelW / 2, 0.35), q(-panelW / 2, 0.35), q(-panelW / 2, 1.4), q(panelW / 2, 1.4), uv, [1, 1, 1], [-nx, 0, -nz]); }
      if (k % 1 === 0) { S.at(x, z); S.box(x - f.tx * panelW / 2, y + 0.75, z - f.tz * panelW / 2, 0.07, 1.5, 0.07, f.yaw, C.steel); S.free(); }
      G.banner.free(); stats.fences++;
    }
  }
  // pit straight: fence on the opposite side of the road
  fence(tr, kit, pit.index - 40 / ds, 80 / ds, -psg, 0.9, rng);
  // finish straight: both sides for 36 m either side of the line
  fence(tr, kit, -34 / ds, 68 / ds, 1, 0.9, rng); fence(tr, kit, -34 / ds, 68 / ds, -1, 0.9, rng);
  // behind tyre walls on a share of the corners
  for (const w of kit.walls[tr.id] ?? []) { if (w.co.severity < 3 || rng() > 0.35 + ps * 0.5) continue; fence(tr, kit, w.i0 + 8 / ds, Math.min(w.len - 10 / ds, 42 / ds), w.sg, 0.5 + w.cols * 0.64 + 0.5, rng); }

  // ------------------------------------------------------------ floodlight towers (emissive heads, glow pools, scaled by tod.night in update)
  const towerSites = [];
  const addTower = (i, sg) => { if (tr.clear(i, sg) < 5) return; towerSites.push([i, sg]); };
  for (const st of c.stands) { addTower(st.index - st.length / 2 / ds - 4 / ds, st.side === 'R' ? 1 : -1); addTower(st.index + st.length / 2 / ds + 4 / ds, st.side === 'R' ? 1 : -1); }
  addTower(pit.index - 38 / ds, psg); addTower(pit.index + 38 / ds, psg); addTower(-20 / ds, -1);
  for (const co of c.corners) if (co.severity >= 4 && rng() < 0.7) addTower(co.apex, co.dir === 'R' ? -1 : 1);
  const maxT = lowQ ? 4 : highQ(quality) ? 14 : 9; towerSites.splice(maxT);
  for (const [i, sg] of towerSites) {
    tr.at(i, 0, f); const lat = sg * (f.hw + 2.8), [x, y, z] = P(f, lat), h = 19, yaw = f.yaw + (sg > 0 ? Math.PI : 0), co = Math.cos(yaw), si = Math.sin(yaw);
    S.at(x, z); L.at(x, z); G.pool.at(x, z);
    S.cyl([x, y, z], [x, y + h, z], 0.22, 0.12, 8, C.steel, true); S.box(x, y + 0.2, z, 0.7, 0.4, 0.7, yaw, C.dark);
    const hx = x - 1.2 * co, hz = z + 1.2 * si; // head leans toward the road (local -x)
    S.box(hx, y + h + 0.35, hz, 0.35, 1.5, 4.2, yaw, C.black);
    for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) { const bz = k * 0.78, lx = hx - 0.22 * co + bz * si, lz = hz + 0.22 * si + bz * co; L.box(lx, y + h + 0.05 + r * 0.7, lz, 0.1, 0.5, 0.62, yaw, [1.4, 1.25, 1.0]); }
    // ground pool on the road side
    const px = x - 9 * co * 1.0, pz = z + 9 * si, py = H(px, pz) + 0.19, R = 22;
    G.pool.quad([px - R, py, pz + R], [px + R, py, pz + R], [px + R, py, pz - R], [px - R, py, pz - R], [0, 0, 1, 1], [1, 1, 1], [0, 1, 0]);
    S.free(); L.free(); G.pool.free(); stats.towers++;
  }
  kit.stats[tr.id] = { ...(kit.stats[tr.id] ?? {}), ...stats };
}
function highQ(q) { return q.level === 'high'; }
