// Far-field LOD tiles (levels 1-4) for the streaming world + night "city lights" map.
//   public/tiles/<L>/<i>_<j>.glb   tile (L,i,j) covers x in [i*S, (i+1)*S), z in [j*S, (j+1)*S), S = 256 * 2^L
//   public/tiles/manifest.json     merged with public/tiles/m0.json written by tools/build-map.mjs (level 0 = full detail)
// Content: L1 terrain + simple roads + simplified buildings; L2 terrain + merged buildings; L3 terrain + big/tall buildings; L4 terrain only.
import fs from 'node:fs';
import earcut from 'earcut';
import sharp from 'sharp';
import { CENTER, project } from './config.mjs';
import { Hall, Hfine } from './lib/height.mjs';
import { Builder, tri, quad, signedArea, pip, hash, mkRng, simplifyRing, dist2 } from './lib/mesh.mjs';
import { writeGlb } from './lib/glb.mjs';

const only = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 2, 3, 4];
const LV = {
  1: { S: 512, R: 4096, drop: 0.35, bld: { minArea: 30, eps: 1.0 }, roads: true },
  2: { S: 1024, R: 4096, drop: 0.9, bld: { minArea: 110, eps: 2.5 }, roads: false },
  3: { S: 2048, R: 8192, drop: 2.2, bld: { minArea: 450, eps: 5, minH: 15 }, roads: false },
  4: { S: 4096, R: 16384, drop: 5.0, bld: null, roads: false },
};
const DATA_R = 4200;     // OSM coverage radius
const num = v => { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const pts = g => g.map(p => project(p.lat, p.lon));

// ------------------------------------------------------------------ OSM (chunks + centre file), de-duplicated
function assembleRings(segs) {
  const key = p => p.lat.toFixed(7) + ',' + p.lon.toFixed(7), rem = segs.filter(s => s.length > 1).map(s => s.slice()), rings = [];
  while (rem.length) { let cur = rem.pop(), guard = 0; while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 500) { const end = key(cur[cur.length - 1]); let k = rem.findIndex(s => key(s[0]) === end); if (k >= 0) { cur = cur.concat(rem.splice(k, 1)[0].slice(1)); continue; } k = rem.findIndex(s => key(s[s.length - 1]) === end); if (k >= 0) { cur = cur.concat(rem.splice(k, 1)[0].reverse().slice(1)); continue; } break; } if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur); }
  return rings;
}
const seen = new Set(), buildings = [], roads = [];
const files = fs.readdirSync('data/osm_far').filter(f => f.endsWith('.json')).map(f => 'data/osm_far/' + f);
if (!files.length) throw new Error('no data/osm_far/*.json - run: node tools/fetch-far.mjs osm');
for (const f of files) for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).elements) {
  const k = e.type + e.id; if (seen.has(k)) continue; seen.add(k);
  const t = e.tags || {};
  if (t.building && !t['building:part']) {
    if (e.type === 'way' && e.geometry) { const p = pts(e.geometry); if (p.length > 3) buildings.push({ id: e.id, outer: p.slice(0, -1), t }); }
    else if (e.type === 'relation' && e.members) { const O = assembleRings(e.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry)); O.forEach((o, n) => buildings.push({ id: e.id * 10 + n, rel: e.id, outer: pts(o).slice(0, -1), t })); }
  } else if (t.highway && e.type === 'way' && e.geometry && t.tunnel !== 'yes') roads.push({ id: e.id, line: pts(e.geometry), cls: t.highway, t });
}
const skip = fs.existsSync('data/landmark-skip.json') ? JSON.parse(fs.readFileSync('data/landmark-skip.json', 'utf8')) : { ids: [], circles: [] };
const skipIds = new Set(skip.ids ?? []);
console.log('far OSM:', buildings.length, 'buildings,', roads.length, 'roads;', skipIds.size, 'landmark ids skipped');

// ------------------------------------------------------------------ building height (must match build-map.mjs addBuilding so LOD swaps don't pop)
const PLAIN = /^(garage|garages|shed|roof|kiosk|carport|service|hut|container|greenhouse|construction|ruins)$/;
function farHeight(bd, area, centerDist) {
  const t = bd.t, rng = mkRng(bd.id), plain = PLAIN.test(t.building || '');
  let height = num(t.height), levels = num(t['building:levels']);
  if (height == null) {
    if (levels == null) levels = plain ? 1 : area < 50 ? 1 : area < 160 ? 2 + Math.floor(rng() * 2) : centerDist < 900 ? 4 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 4);
    height = levels * 3.2 + (t['roof:levels'] ? 1.5 : 0.4);
  }
  return { height: Math.max(2.6, height), rng };
}
const TUFF = [[0.88, 0.62, 0.48], [0.84, 0.56, 0.42], [0.92, 0.68, 0.46], [0.90, 0.78, 0.54], [0.80, 0.78, 0.72]], PANEL = [[0.78, 0.68, 0.56], [0.70, 0.66, 0.62], [0.82, 0.76, 0.66], [0.64, 0.60, 0.58]], HOUSE = [[0.90, 0.84, 0.72], [0.80, 0.86, 0.80], [0.92, 0.78, 0.70], [0.93, 0.91, 0.86]], MODERN = [[0.75, 0.82, 0.95], [0.86, 0.90, 1.0]];
function wallColor(id, height, centerDist) {
  const r = hash(id * 7 + 3), pal = height >= 38 ? MODERN : height < 8 ? HOUSE : centerDist < 950 && r < 0.72 ? TUFF : PANEL, c = pal[Math.floor(hash(id * 13 + 1) * pal.length)], br = 0.85 + hash(id * 5 + 9) * 0.3;
  return [c[0] * br * 255, c[1] * br * 255, c[2] * br * 255, (0.6 + hash(id * 3 + 2) * 0.4) * 255].map(Math.round);
}

// ------------------------------------------------------------------ geometry: terrain tile
function terrainTile(L, i, j) {
  const { S, drop } = LV[L], n = L === 4 ? 64 : 40, st = S / n, x0 = i * S, z0 = j * S, b = new Builder('far_terrain'); b.noUV = true; b.noColor = true;
  const hy = (x, z) => Hall(x, z) - drop;
  const idx = (a, c) => c * (n + 1) + a;
  let minY = Infinity, maxY = -Infinity;
  for (let c = 0; c <= n; c++) for (let a = 0; a <= n; a++) {
    const x = x0 + a * st, z = z0 + c * st, y = hy(x, z); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const nx = -(hy(x + st, z) - hy(x - st, z)) / (2 * st), nz = -(hy(x, z + st) - hy(x, z - st)) / (2 * st), l = Math.hypot(nx, 1, nz);
    b.v(x, y, z, nx / l, 1 / l, nz / l);
  }
  for (let c = 0; c < n; c++) for (let a = 0; a < n; a++) b.idx.push(idx(a, c), idx(a, c + 1), idx(a + 1, c), idx(a + 1, c), idx(a, c + 1), idx(a + 1, c + 1));
  // skirts hide cracks against neighbouring tiles of other levels
  const sk = Math.max(3, st * 2.5 + L * 2), base = b.n;
  const edge = []; for (let a = 0; a <= n; a++) edge.push([a, 0]); for (let c = 1; c <= n; c++) edge.push([n, c]); for (let a = n - 1; a >= 0; a--) edge.push([a, n]); for (let c = n - 1; c >= 1; c--) edge.push([0, c]);
  for (const [a, c] of edge) { const k = idx(a, c); b.v(b.pos[k * 3], b.pos[k * 3 + 1] - sk, b.pos[k * 3 + 2], b.nor[k * 3], b.nor[k * 3 + 1], b.nor[k * 3 + 2]); }
  for (let e = 0; e < edge.length; e++) { const e2 = (e + 1) % edge.length, t0 = idx(edge[e][0], edge[e][1]), t1 = idx(edge[e2][0], edge[e2][1]), s0 = base + e, s1 = base + e2; b.idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0); } // double-sided skirt
  return { b, minY: minY - sk, maxY };
}

// ------------------------------------------------------------------ geometry: simplified building
function addBuilding(b, bd, cfg, tile) {
  let outer = bd.outer; const area0 = Math.abs(signedArea(outer)); if (area0 < cfg.minArea) return false;
  const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length, cz = outer.reduce((s, p) => s + p[1], 0) / outer.length, cd = Math.hypot(cx, cz);
  const { height } = farHeight(bd, area0, cd);
  if (cfg.minH && height < cfg.minH && area0 < 2500) return false;
  outer = simplifyRing(outer, cfg.eps); if (outer.length < 3) return false;
  if (signedArea(outer) < 0) outer = outer.slice().reverse();
  let minG = Infinity; for (const p of outer) minG = Math.min(minG, Hfine(p[0], p[1]) * (Math.max(Math.abs(p[0]), Math.abs(p[1])) < 1000 ? 1 : 0) + (Math.max(Math.abs(p[0]), Math.abs(p[1])) < 1000 ? 0 : Hall(p[0], p[1])));
  const top = minG + height, col = wallColor(bd.id, height, cd), roof = [150, 150, 155, 255], floorM = 3.2, lv = Math.max(1, Math.round(height / 3.3)), vk = lv * floorM / height;
  let u = hash(bd.id) * 28;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], c = outer[(i + 1) % outer.length], L = dist2(a, c); if (L < 0.5) continue;
    const ox = (c[1] - a[1]) / L, oz = -(c[0] - a[0]) / L, ya = Hall(a[0], a[1]) - 0.7, yc = Hall(c[0], c[1]) - 0.7, bays = Math.max(1, Math.round(L / 3.5)), du = bays * 3.5;
    quad(b, [a[0], ya, a[1]], [c[0], yc, c[1]], [c[0], top, c[1]], [a[0], top, a[1]], [ox, 0, oz], [u, (ya - minG) * vk], [u + du, (yc - minG) * vk], [u + du, height * vk], [u, height * vk], col);
    u += du;
  }
  const flat = []; outer.forEach(p => flat.push(p[0], p[1]));
  const ids = earcut(flat, [], 2);
  for (let k = 0; k < ids.length; k += 3) { const P = q => [flat[q * 2], top, flat[q * 2 + 1]]; tri(b, P(ids[k]), P(ids[k + 1]), P(ids[k + 2]), [0, 1, 0], [0, 0], [1, 0], [0, 1], roof); }
  return true;
}

// ------------------------------------------------------------------ geometry: simple road ribbons (L1)
const RW = { motorway: 16, trunk: 14, primary: 13, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6, living_street: 5, pedestrian: 5, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 5.5 };
function ribbon(b, line, w) {
  if (line.length < 2) return; const L = [], R = [];
  const segN = []; for (let i = 0; i < line.length - 1; i++) { const dx = line[i + 1][0] - line[i][0], dz = line[i + 1][1] - line[i][1], l = Math.hypot(dx, dz) || 1; segN.push([-dz / l, dx / l]); }
  for (let i = 0; i < line.length; i++) { let nx, nz, m = 1; if (i === 0) [nx, nz] = segN[0]; else if (i === line.length - 1) [nx, nz] = segN[i - 1]; else { const a = segN[i - 1], c = segN[i]; nx = a[0] + c[0]; nz = a[1] + c[1]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; m = Math.min(2, 1 / Math.max(0.4, nx * a[0] + nz * a[1])); } L.push([line[i][0] + nx * w / 2 * m, line[i][1] + nz * w / 2 * m]); R.push([line[i][0] - nx * w / 2 * m, line[i][1] - nz * w / 2 * m]); }
  let prev = null;
  for (let i = 0; i < line.length; i++) { const y1 = Hall(L[i][0], L[i][1]) + 0.05, y2 = Hall(R[i][0], R[i][1]) + 0.05, l = b.v(L[i][0], y1, L[i][1], 0, 1, 0), r = b.v(R[i][0], y2, R[i][1], 0, 1, 0); if (prev) { b.idx.push(prev[1], prev[0], r, r, prev[0], l); const p0 = [b.pos[prev[1] * 3], 0, b.pos[prev[1] * 3 + 2]], p1 = [b.pos[prev[0] * 3], 0, b.pos[prev[0] * 3 + 2]], p2 = [b.pos[r * 3], 0, b.pos[r * 3 + 2]]; const g = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]); /* y component of (p1-p0)x(p2-p0) = dz1*dx2 - dx1*dz2 */ if (g < 0) { const k = b.idx.length; [b.idx[k - 5], b.idx[k - 4]] = [b.idx[k - 4], b.idx[k - 5]]; [b.idx[k - 2], b.idx[k - 1]] = [b.idx[k - 1], b.idx[k - 2]]; } } prev = [l, r]; }
}
const resample = (line, step) => { const out = [line[0]]; for (let i = 1; i < line.length; i++) { const a = line[i - 1], c = line[i], d = dist2(a, c), n = Math.max(1, Math.ceil(d / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n]); } return out; };

// ------------------------------------------------------------------ spatial index by tile
const bBy = new Map(); // key L|i|j -> buildings

for (const bd of buildings) { if (skipIds.has(bd.id) || (bd.rel && skipIds.has(bd.rel))) continue; /* relations carry id*10+n: match the OSM relation id too */ const cx = bd.outer.reduce((s, p) => s + p[0], 0) / bd.outer.length, cz = bd.outer.reduce((s, p) => s + p[1], 0) / bd.outer.length; bd.cx = cx; bd.cz = cz; if (Math.abs(cx) > DATA_R || Math.abs(cz) > DATA_R) continue; for (const L of only) { const S = LV[L].S, k = `${L}|${Math.floor(cx / S)}|${Math.floor(cz / S)}`; (bBy.get(k) ?? bBy.set(k, []).get(k)).push(bd); } }
const rBy = new Map(); // L1 roads by tile
if (only.includes(1)) for (const r of roads) { if (!RW[r.cls]) continue; const S = LV[1].S; const seen2 = new Set(); for (const p of r.line) { if (Math.abs(p[0]) > DATA_R || Math.abs(p[1]) > DATA_R) continue; const k = `${Math.floor(p[0] / S)}|${Math.floor(p[1] / S)}`; if (seen2.has(k)) continue; seen2.add(k); (rBy.get(k) ?? rBy.set(k, []).get(k)).push(r); } }

// ------------------------------------------------------------------ build all tiles
const manifest = {}; let totalBytes = 0, nTiles = 0;
for (const L of only) {
  const { S, R, bld, roads: withRoads } = LV[L], i0 = -R / S, i1 = R / S - 1; manifest[L] = [];
  for (let j = i0; j <= i1; j++) for (let i = i0; i <= i1; i++) {
    const T = terrainTile(L, i, j), bs = [T.b]; let maxY = T.maxY;
    if (bld && Math.abs(i * S + S / 2) < DATA_R + S && Math.abs(j * S + S / 2) < DATA_R + S) {
      const arr = bBy.get(`${L}|${i}|${j}`) ?? [], bb = new Builder('far_building');
      for (const bd of arr) addBuilding(bb, bd, bld);
      if (bb.idx.length) { bs.push(bb); for (let k = 1; k < bb.pos.length; k += 3) maxY = Math.max(maxY, bb.pos[k]); }
    }
    if (withRoads) { const rb = new Builder('far_road'); rb.noUV = true; rb.noColor = true; for (const r of rBy.get(`${i}|${j}`) ?? []) ribbon(rb, resample(r.line, 8), RW[r.cls]); if (rb.idx.length) bs.push(rb); }
    const bytes = await writeGlb(`public/tiles/${L}/${i}_${j}.glb`, bs, { name: `t${L}_${i}_${j}` });
    totalBytes += bytes; nTiles++; manifest[L].push([i, j, +T.minY.toFixed(1), +maxY.toFixed(1)]);
  }
  console.log(`L${L}: ${manifest[L].length} tiles (S=${S})  total ${(totalBytes / 1e6).toFixed(1)} MB so far`);
}
// merge with level-0 manifest written by build-map.mjs
let merged = {}; if (fs.existsSync('public/tiles/manifest.json')) merged = JSON.parse(fs.readFileSync('public/tiles/manifest.json', 'utf8')).levels ?? {};
if (fs.existsSync('public/tiles/m0.json')) merged[0] = JSON.parse(fs.readFileSync('public/tiles/m0.json', 'utf8'));
for (const L of only) merged[L] = manifest[L];
fs.writeFileSync('public/tiles/manifest.json', JSON.stringify({ size0: 256, regions: { 0: 1024, 1: 3072, 2: 4096, 3: 8192, 4: 16384 }, levels: merged }));

// ------------------------------------------------------------------ night "city lights" map (R = road glow, G = building coverage), 4 m/px over +-4400 m
if (only.includes(1)) {
  const E = 4400, P = 4, W = (2 * E) / P, R = new Uint8Array(W * W), G = new Uint8Array(W * W);
  const px = v => Math.floor((v + E) / P);
  for (const r of roads) { if (!RW[r.cls]) continue; const line = resample(r.line, 3); for (const p of line) { const x = px(p[0]), y = px(p[1]); if (x < 1 || y < 1 || x >= W - 1 || y >= W - 1) continue; const w = RW[r.cls] > 9 ? 1 : 0; for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) R[(y + dy) * W + x + dx] = RW[r.cls] > 9 ? 255 : 170; } }
  for (const bd of buildings) { if (Math.abs(bd.cx ?? 9e9) > E || Math.abs(bd.cz ?? 9e9) > E) continue; const o = bd.outer; let zmin = Infinity, zmax = -Infinity; for (const p of o) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); } for (let y = Math.max(0, px(zmin)); y <= Math.min(W - 1, px(zmax)); y++) { const z = y * P - E + P / 2, xs = []; for (let i = 0; i < o.length; i++) { const a = o[i], c = o[(i + 1) % o.length]; if ((a[1] > z) !== (c[1] > z)) xs.push(a[0] + (z - a[1]) / (c[1] - a[1]) * (c[0] - a[0])); } xs.sort((a, c) => a - c); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, px(xs[k])); x <= Math.min(W - 1, px(xs[k + 1])); x++) G[y * W + x] = 255; } }
  const raw = Buffer.alloc(W * W * 3); for (let i = 0; i < W * W; i++) { raw[i * 3] = R[i]; raw[i * 3 + 1] = G[i]; }
  await sharp(raw, { raw: { width: W, height: W, channels: 3 } }).blur(0.8).webp({ quality: 85 }).toFile('public/map/lights_far.webp');
  console.log('lights_far.webp', (fs.statSync('public/map/lights_far.webp').size / 1e6).toFixed(1), 'MB');
}
console.log(`done: ${nTiles} tiles, ${(totalBytes / 1e6).toFixed(1)} MB`);
