// 2D map renderer (canvas) used by the full-screen map and the driving minimap.
// view = { cx, cz, mpp, rot }  world centre (metres), metres per CSS pixel, rotation (radians, 0 = north up; heading-up uses rot = heading - PI)
// All geometry comes from nav.json (roads, buildings, parks, water) + the satellite mosaic for the optional photo basemap.
const STYLE = {
  dark: { bg: '#0e1522', green: '#13281f', water: '#102a43', bld: '#1b2538', bldLine: '#2a3752', casing: '#080c14', text: '#cfd8ea', halo: 'rgba(8,12,20,.85)' },
};
//                 fill      width(m) minPx casingPx
const ROAD = [['#ffa45c', 17, 3.2, 1.6], ['#ffb26a', 16, 3.2, 1.6], ['#f5d98f', 15, 3, 1.5], ['#ece6cf', 12, 2.6, 1.4], ['#d3dae8', 10, 2.2, 1.2], ['#aab5cb', 8, 1.8, 1.1], ['#8f9bb5', 8, 1.8, 1.1], ['#7f8aa3', 6, 1.4, 1], ['#5b667f', 4.5, 1, 0.9], ['#46516b', 5, 1, 0.8]];
const PX_MAX = 0.62;                       // road class visibility: skip classes whose px width would be below this
export const SAT_RECT = { x0: -3072, z0: -3584, size: 4608 };

export class MapRenderer {
  constructor(nav) {
    this.nav = nav; const j = nav.j;
    // roads
    this.roads = j.ways.map((w, wi) => {
      const n = w.length - 5, pts = new Float32Array(n * 2); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < n; k++) { const x = nav.X[w[5 + k]], z = nav.Z[w[5 + k]]; pts[k * 2] = x; pts[k * 2 + 1] = z; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      return { wi, cls: w[0], name: w[1], flags: w[3], pts, x0, x1, z0, z1, label: undefined };
    });
    this.byCls = Array.from({ length: 10 }, () => []); for (const r of this.roads) this.byCls[r.cls].push(r);
    // polygons (delta-encoded decimetres)
    const dec = (flat, off) => { const n = (flat.length - off) / 2, p = new Float32Array(n * 2); let x = 0, z = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let k = 0; k < n; k++) { x += flat[off + k * 2]; z += flat[off + k * 2 + 1]; const X = x / 10, Z = z / 10; p[k * 2] = X; p[k * 2 + 1] = Z; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z; } return { p, x0, x1, z0, z1 }; };
    this.buildings = j.buildings.map(r => dec(r, 0));
    this.areas = j.areas.map(r => ({ t: r[0], ...dec(r, 1) }));
    this.labelW = new Map(); this.sat = null; this.satReady = false;
  }
  loadSat(cb) { if (this.sat) return; const im = this.sat = new Image(); im.onload = () => { this.satReady = true; cb?.(); }; im.src = '/map/nav_aerial.webp'; }

  /** draw into ctx (CSS pixel coordinates; the caller has already applied devicePixelRatio scaling) */
  draw(ctx, W, H, view, o = {}) {
    const S = STYLE.dark, { cx, cz, mpp, rot = 0 } = view, ax = o.anchorX ?? 0.5, ay = o.anchorY ?? 0.5;
    const sat = !!o.satellite && this.satReady;
    ctx.save(); ctx.setTransform(o.dpr ?? 1, 0, 0, o.dpr ?? 1, 0, 0);
    ctx.fillStyle = S.bg; ctx.fillRect(0, 0, W, H);
    // world -> screen
    const c = Math.cos(rot), s = Math.sin(rot), px = W * ax, py = H * ay, inv = 1 / mpp;
    const sx = (x, z) => px + ((x - cx) * c - (z - cz) * s) * inv, sy = (x, z) => py + ((x - cx) * s + (z - cz) * c) * inv;
    // visible world AABB
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (const [qx, qy] of [[0, 0], [W, 0], [0, H], [W, H]]) { const u = (qx - px) * mpp, v = (qy - py) * mpp; const wx = cx + u * c + v * s, wz = cz - u * s + v * c; bx0 = Math.min(bx0, wx); bx1 = Math.max(bx1, wx); bz0 = Math.min(bz0, wz); bz1 = Math.max(bz1, wz); }
    const vis = r => r.x1 >= bx0 && r.x0 <= bx1 && r.z1 >= bz0 && r.z0 <= bz1;
    // world transform: screen = T * R * (world - c) / mpp
    ctx.translate(px, py); ctx.rotate(rot); ctx.scale(inv, inv); ctx.translate(-cx, -cz);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (sat) { ctx.globalAlpha = 1; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.sat, SAT_RECT.x0, SAT_RECT.z0, SAT_RECT.size, SAT_RECT.size); ctx.fillStyle = 'rgba(6,10,18,.18)'; ctx.fillRect(bx0, bz0, bx1 - bx0, bz1 - bz0); }
    else {
      // parks / water
      for (const pass of [0, 1]) { ctx.fillStyle = pass ? S.water : S.green; ctx.beginPath(); for (const a of this.areas) { if (a.t !== pass || !vis(a)) continue; if ((a.x1 - a.x0) * inv < 2 && (a.z1 - a.z0) * inv < 2) continue; const p = a.p; ctx.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]); ctx.closePath(); } ctx.fill(); }
      // buildings
      if (mpp < 5.5) {
        ctx.fillStyle = S.bld; ctx.beginPath(); let n = 0;
        for (const b of this.buildings) { if (!vis(b) || (b.x1 - b.x0) * inv < 1.2) continue; const p = b.p; ctx.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]); ctx.closePath(); n++; }
        ctx.fill(); if (mpp < 1.6) { ctx.lineWidth = 0.8 * mpp; ctx.strokeStyle = S.bldLine; ctx.stroke(); }
      }
    }
    // roads (low class first)
    const minVisible = (cls) => ROAD[cls][1] * inv >= PX_MAX || ROAD[cls][2] >= 1 && mpp < (cls <= 3 ? 40 : cls <= 6 ? 14 : 5);
    for (let cls = 9; cls >= 0; cls--) {
      if (!minVisible(cls)) continue; const [fill, wm, minPx, casPx] = ROAD[cls]; const list = this.byCls[cls];
      const w = Math.max(wm * inv, minPx) * mpp;       // world units
      const draw = (width, style) => { ctx.lineWidth = width; ctx.strokeStyle = style; ctx.beginPath(); let any = false; for (const r of list) { if (!vis(r)) continue; if (cls >= 7 && r.flags & 4 && mpp > 2) continue; const p = r.pts; ctx.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]); any = true; } if (any) ctx.stroke(); };
      if (!sat) draw(w + casPx * 2 * mpp, S.casing);
      draw(sat ? Math.max(w * 0.5, 1.2 * mpp) : w, sat ? 'rgba(255,255,255,.55)' : fill);
    }
    ctx.restore(); ctx.save(); ctx.setTransform(o.dpr ?? 1, 0, 0, o.dpr ?? 1, 0, 0);

    // ---------------------------------------------------------------- route (screen space strokes keep the width constant)
    const proj = (x, z) => [sx(x, z), sy(x, z)];
    const placed = [];
    const free = (x, y, w, h) => { for (const r of placed) if (x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]) return false; placed.push([x, y, w, h]); return true; };
    if (o.route) {
      const rt = o.route, np = rt.pts.length / 2, from = o.routeFrom ?? 0;
      const stroke = (i0, w, col) => { ctx.beginPath(); for (let i = i0; i < np; i++) { const [x, y] = proj(rt.pts[i * 2], rt.pts[i * 2 + 1]); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke(); };
      const wpx = Math.max(5, Math.min(11, 12 / Math.sqrt(mpp)));
      if (from > 0) { ctx.beginPath(); for (let i = 0; i <= Math.min(np - 1, from); i++) { const [x, y] = proj(rt.pts[i * 2], rt.pts[i * 2 + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.lineWidth = wpx; ctx.strokeStyle = 'rgba(120,150,190,.45)'; ctx.stroke(); }
      stroke(from, wpx + 4, 'rgba(6,16,30,.9)'); stroke(from, wpx, '#37c8ff');
    }
    // ---------------------------------------------------------------- labels
    if (o.labels !== false) {
      const font = (px, w = 600) => `${w} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const fpx = Math.max(10, Math.min(13, 15 / Math.sqrt(mpp) + 6));
      ctx.font = font(fpx);
      const maxCls = mpp > 12 ? -1 : mpp > 6 ? 2 : mpp > 3 ? 4 : mpp > 1.6 ? 6 : 9;
      const drawn = new Set();
      for (let cls = 0; cls <= maxCls; cls++) for (const r of this.byCls[cls]) {
        if (r.name < 0 || !vis(r) || drawn.has(r.name * 10 + cls) && mpp > 2.5) continue;
        if (r.label === undefined) { // longest segment
          let bl = 0, bi = -1; const p = r.pts; for (let k = 0; k + 3 < p.length; k += 2) { const l = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]); if (l > bl) { bl = l; bi = k; } }
          r.label = bi < 0 ? null : { x: (p[bi] + p[bi + 2]) / 2, z: (p[bi + 1] + p[bi + 3]) / 2, a: Math.atan2(p[bi + 3] - p[bi + 1], p[bi + 2] - p[bi]), len: bl };
        }
        const L = r.label; if (!L) continue; const txt = this.nav.name(r.name); if (!txt) continue;
        let w0 = this.labelW.get(txt); if (w0 === undefined) { ctx.save(); ctx.font = font(12); w0 = ctx.measureText(txt).width / 12; ctx.restore(); this.labelW.set(txt, w0); }
        const tw = w0 * fpx;
        if (L.len * inv < tw * 0.9 + 10) continue;
        const x = sx(L.x, L.z), y = sy(L.x, L.z); if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
        let ang = L.a + rot; if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        if (!free(x - tw / 2 - 4, y - fpx / 2 - 4, tw + 8, fpx + 8)) continue;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.lineWidth = 3.2; ctx.strokeStyle = S.halo; ctx.strokeText(txt, 0, 0); ctx.fillStyle = S.text; ctx.fillText(txt, 0, 0); ctx.restore(); drawn.add(r.name * 10 + cls);
      }
      // places
      if (o.pois !== false && mpp < 3 && o.search) {
        ctx.font = font(11, 600); ctx.textAlign = 'left';
        for (const p of o.search.pois) {
          const x = sx(p.x, p.z), y = sy(p.x, p.z); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
          const t = p.title, tw = t.length * 5.6; if (!free(x - 5, y - 6, tw + 12, 13)) continue;
          ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fillStyle = p.cat === 'metro' ? '#ff5d7a' : /park|garden/.test(p.cat) ? '#5fd38a' : '#7fb2ff'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#06101c'; ctx.stroke();
          ctx.lineWidth = 3; ctx.strokeStyle = S.halo; ctx.strokeText(t, x + 7, y); ctx.fillStyle = '#e6edf9'; ctx.fillText(t, x + 7, y);
        }
      }
    }
    // ---------------------------------------------------------------- markers
    if (o.dest) { const [x, y] = proj(o.dest.x, o.dest.z); marker(ctx, x, y, '#2fd27a', true); }
    if (o.pin) { const [x, y] = proj(o.pin.x, o.pin.z); marker(ctx, x, y, '#ff4d6d', false); }
    if (o.car) {
      const [x, y] = proj(o.car.x, o.car.z);
      // forward (sin h, cos h) in world -> screen
      const fx = Math.sin(o.car.heading) * c - Math.cos(o.car.heading) * s, fy = Math.sin(o.car.heading) * s + Math.cos(o.car.heading) * c, ang = Math.atan2(fy, fx) + Math.PI / 2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fillStyle = 'rgba(55,140,255,.2)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4.5); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fillStyle = '#3d8bff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    return { sx, sy, toWorld: (qx, qy) => { const u = (qx - px) * mpp, v = (qy - py) * mpp; return [cx + u * c + v * s, cz - u * s + v * c]; } };
  }
}

function marker(ctx, x, y, col, flag) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.ellipse(0, 1, 7, 3, 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-4, -9, -12, -13, -12, -22); ctx.arc(0, -22, 12, Math.PI, 0); ctx.bezierCurveTo(12, -13, 4, -9, 0, 0); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.beginPath(); if (flag) { ctx.rect(-4, -29, 8, 14); ctx.fillStyle = '#fff'; ctx.fill(); ctx.fillStyle = col; ctx.fillRect(-4, -29, 4, 7); ctx.fillRect(0, -22, 4, 7); } else { ctx.arc(0, -22, 4.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); }
  ctx.restore();
}
