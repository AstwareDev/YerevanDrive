// Placement tool for street life: vegetation, parked cars, signs, signals, street furniture, billboards.
// Reads data/osm.json, data/height.*, public/map/meta.json, public/map/aerial.webp -> writes public/map/props.json
// Run from the project root:  node tools/build-props.mjs   (add --debug to also write .scratch/props-debug-*.png)
// Local frame: x east, y up (0 = Republic Square ground), z south.
import fs from 'node:fs';
import sharp from 'sharp';
import { HALF, inRegion, project } from './config.mjs';
import { H, hash, mkRng } from './terrain.mjs';
import { SPECS, MODELS, MODEL_WEIGHT } from '../src/props/carspecs.js';

const DEBUG = process.argv.includes('--debug');
const osm = JSON.parse(fs.readFileSync('data/osm.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('public/map/meta.json', 'utf8'));
const skipFile = fs.existsSync('data/landmark-skip.json') ? JSON.parse(fs.readFileSync('data/landmark-skip.json', 'utf8')) : { ids: [], circles: [] };

// ------------------------------------------------------------------ helpers
const OXa = -3072, OZa = -3584, SZ = 4608, OC = 2, ON = Math.round(SZ / OC);     // near-field window (tools/config.mjs NEAR): aerial, occupancy rasters
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const signedArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function pip(p, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
const num = v => { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const pts = geom => geom.map(g => project(g.lat, g.lon));
const inMap = (x, z, m = 0) => inRegion(x, z, m);
const r2 = v => +v.toFixed(2);
const centroid = ring => { const c = ring.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]); return [c[0] / ring.length, c[1] / ring.length]; };
function resample(line, step) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], d = dist(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

// ------------------------------------------------------------------ rasters
const mk = () => new Uint8Array(ON * ON);
const occB = mk(), occR = mk(), occW = mk(), kind = mk(); // buildings, asphalt, water, area kind (1 grass 2 plaza 3 lot 4 dirt)
const cix = v => Math.floor((v - OXa) / OC), ciz = v => Math.floor((v - OZa) / OC);
function fillPoly(ring, arr, val = 1) {
  let zmin = Infinity, zmax = -Infinity; for (const p of ring) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
  const j0 = Math.max(0, ciz(zmin)), j1 = Math.min(ON - 1, ciz(zmax));
  for (let j = j0; j <= j1; j++) {
    const z = j * OC + OZa + OC / 2, xs = [];
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, cix(xs[k])), i1 = Math.min(ON - 1, cix(xs[k + 1])); for (let i = i0; i <= i1; i++) arr[j * ON + i] = val; }
  }
}
function stamp(arr, x, z, r, val = 1) {
  const i0 = cix(x - r), i1 = cix(x + r), j0 = ciz(z - r), j1 = ciz(z + r);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && j >= 0 && i < ON && j < ON) { const cx = i * OC + OXa + OC / 2 - x, cz = j * OC + OZa + OC / 2 - z; if (cx * cx + cz * cz <= r * r) arr[j * ON + i] = val; }
}
const at = (arr, x, z) => { const i = cix(x), j = ciz(z); return i >= 0 && j >= 0 && i < ON && j < ON ? arr[j * ON + i] : 0; };

// ------------------------------------------------------------------ OSM classification (mirrors tools/build-map.mjs)
function assembleRings(segs) {
  const key = p => p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
  const rem = segs.filter(s => s.length > 1).map(s => s.slice()), rings = [];
  while (rem.length) {
    let cur = rem.pop(), guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 500) {
      const end = key(cur[cur.length - 1]);
      let k = rem.findIndex(s => key(s[0]) === end);
      if (k >= 0) { cur = cur.concat(rem.splice(k, 1)[0].slice(1)); continue; }
      k = rem.findIndex(s => key(s[s.length - 1]) === end);
      if (k >= 0) { cur = cur.concat(rem.splice(k, 1)[0].reverse().slice(1)); continue; }
      break;
    }
    if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}
function relationPolys(rel) {
  const outers = assembleRings(rel.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry));
  const inners = assembleRings(rel.members.filter(m => m.type === 'way' && m.role === 'inner' && m.geometry).map(m => m.geometry));
  const O = outers.map(r => pts(r).slice(0, -1)), I = inners.map(r => pts(r).slice(0, -1));
  return O.map(o => ({ outer: o, holes: I.filter(h => pip(h[0], o)) }));
}
const ROAD = {
  trunk: { w: 14, rank: 8 }, trunk_link: { w: 7, rank: 6 }, primary: { w: 13, rank: 7 }, primary_link: { w: 7, rank: 5 },
  secondary: { w: 10, rank: 6 }, secondary_link: { w: 6, rank: 4 }, tertiary: { w: 8, rank: 5 }, tertiary_link: { w: 5.5, rank: 3 },
  residential: { w: 6.5, rank: 4 }, unclassified: { w: 6, rank: 4 }, living_street: { w: 5, rank: 3 }, service: { w: 3.8, rank: 2 }, track: { w: 3, rank: 1 },
};
const PED = { pedestrian: 6, footway: 2, path: 1.6, cycleway: 2, steps: 0 };
const polysOf = e => {
  if (e.type === 'way' && e.geometry) { const p = pts(e.geometry); if (p.length > 3 && dist(p[0], p[p.length - 1]) < 0.01) return [{ outer: p.slice(0, -1), holes: [] }]; return []; }
  if (e.type === 'relation' && e.members) return relationPolys(e);
  return [];
};
const buildings = [], parts = [], vroads = [], pedWays = [], crossings = [], areas = [], osmTrees = [], kiosks = [], shelters = [], flowerbeds = [], govBuildings = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'node') { if (t.natural === 'tree') { const [x, z] = project(e.lat, e.lon); osmTrees.push({ x, z, t }); } continue; }
  if (t['building:part']) { for (const p of polysOf(e)) parts.push({ id: e.id, ...p, t }); continue; }
  if (t.building) {
    for (const p of polysOf(e)) {
      const b = { id: e.id, ...p, t }; buildings.push(b);
      if (t.shop === 'kiosk' || t.building === 'kiosk') kiosks.push(b);
      if (t.amenity === 'shelter') shelters.push(b);
      if (/government|ministry|municipality|townhall|parliament|national assembly|presidential|court|prosecutor|embassy|central bank/i.test((t['name:en'] || '') + ' ' + (t.name || '')) || t.amenity === 'townhall' || t.amenity === 'embassy' || /government|ministry/i.test(t.office || '')) govBuildings.push(b);
    }
    continue;
  }
  if (t.highway && e.type === 'way' && e.geometry) {
    if (t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.covered === 'yes') continue;
    if (t.area === 'yes') { for (const p of polysOf(e)) areas.push({ ...p, kind: 'plaza' }); continue; }
    const line = pts(e.geometry);
    if (ROAD[t.highway]) vroads.push({ id: e.id, t, line, nodes: e.nodes, cls: t.highway });
    else if (t.highway in PED) { if (t.highway === 'steps') continue; if (t.footway === 'crossing' || t.crossing) crossings.push({ line }); else pedWays.push({ line, kind: t.highway }); }
    continue;
  }
  if (t.shop === 'kiosk' && e.type === 'way') { for (const p of polysOf(e)) kiosks.push({ id: e.id, ...p, t }); }
  if (t.amenity === 'shelter' && e.type === 'way') { for (const p of polysOf(e)) shelters.push({ id: e.id, ...p, t }); }
  const polys = polysOf(e);
  if (polys.length) {
    let k = null;
    if (t.natural === 'water' || t.amenity === 'fountain' || t.water) k = 'water';
    else if (['park', 'garden', 'playground', 'recreation_ground', 'dog_park'].includes(t.leisure) || ['grass', 'meadow', 'recreation_ground', 'village_green', 'forest', 'orchard', 'flowerbed', 'cemetery'].includes(t.landuse) || ['wood', 'scrub', 'grassland', 'heath'].includes(t.natural)) k = 'grass';
    else if (t.leisure === 'pitch' || t.leisure === 'track') k = 'plaza';
    else if (t.amenity === 'parking' || t.landuse === 'garages') k = 'lot';
    else if (t.landuse === 'construction' || t.landuse === 'brownfield') k = 'dirt';
    else if (t.place === 'square' || t.amenity === 'marketplace') k = 'plaza';
    if (k) for (const p of polys) areas.push({ ...p, kind: k, t });
    if (t.landuse === 'flowerbed') for (const p of polys) flowerbeds.push(p);
  }
}
const KIND = { grass: 1, plaza: 2, lot: 3, dirt: 4 };
for (const a of areas) { if (a.kind === 'water') fillPoly(a.outer, occW); else fillPoly(a.outer, kind, KIND[a.kind]); }
const isSkippedLandmark = b => { if ((skipFile.ids ?? []).includes(b.id)) return true; const [cx, cz] = centroid(b.outer); return (skipFile.circles ?? []).some(([x, z, r]) => Math.hypot(cx - x, cz - z) < r); };
for (const b of [...buildings, ...parts]) { if (b.t?.shop === 'kiosk' || b.t?.building === 'kiosk' || b.t?.amenity === 'shelter') continue; fillPoly(b.outer, occB); }
console.log({ buildings: buildings.length, roads: vroads.length, ped: pedWays.length, crossings: crossings.length, areas: areas.length, osmTrees: osmTrees.length });

// roads: widths, rasters, segment hash
const roads = [];
const nodeWays = new Map();
for (const r of vroads) if (r.cls !== 'service' && r.cls !== 'track') r.nodes.forEach((id, k) => { let m = nodeWays.get(id); if (!m) nodeWays.set(id, m = new Map()); m.set(r.id, (m.get(r.id) ?? 0) + 1 + (k > 0 && k < r.nodes.length - 1 ? 10 : 0)); });
const isInter = id => { const m = nodeWays.get(id); if (!m) return false; if (m.size >= 3) return true; if (m.size === 2) return [...m.values()].some(v => v >= 10); return false; };
const SC = 24, segHash = new Map();
const addSeg = (a, b, rd) => { const k0 = [Math.floor(Math.min(a[0], b[0]) / SC), Math.floor(Math.min(a[1], b[1]) / SC)], k1 = [Math.floor(Math.max(a[0], b[0]) / SC), Math.floor(Math.max(a[1], b[1]) / SC)]; for (let i = k0[0]; i <= k1[0]; i++) for (let j = k0[1]; j <= k1[1]; j++) { const key = i + ',' + j; (segHash.get(key) ?? segHash.set(key, []).get(key)).push([a, b, rd]); } };
for (const r of vroads) {
  const cls = ROAD[r.cls], t = r.t, lanes = num(t.lanes), oneway = t.oneway === 'yes' || t.oneway === '1';
  let w = num(t.width) ?? (lanes ? lanes * 3.2 + (oneway ? 0.6 : 1.2) : cls.w); w = Math.max(3, Math.min(30, w));
  if (!r.line.some(p => inMap(p[0], p[1], 40))) continue;
  const rd = { id: r.id, line: r.line, nodes: r.nodes, cls: r.cls, rank: cls.rank, hw: w / 2, w, oneway, t };
  roads.push(rd);
  const rs = resample(r.line, 1.5);
  for (let i = 0; i < rs.length; i++) stamp(occR, rs[i][0], rs[i][1], rd.hw + (r.cls === 'service' ? 0.2 : 0.4));
  for (let i = 1; i < r.line.length; i++) addSeg(r.line[i - 1], r.line[i], rd);
}
// nearest road centre line (excluding an id) -> { d (to centreline), rd, px, pz, tx, tz }
function nearestRoad(x, z, maxD, excludeId = -1, minRank = 0) {
  let best = { d: Infinity, rd: null };
  const rr = Math.ceil(maxD / SC);
  for (let i = Math.floor(x / SC) - rr; i <= Math.floor(x / SC) + rr; i++) for (let j = Math.floor(z / SC) - rr; j <= Math.floor(z / SC) + rr; j++) {
    const arr = segHash.get(i + ',' + j); if (!arr) continue;
    for (const [a, b, rd] of arr) {
      if (rd.id === excludeId || rd.rank < minRank) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const px = a[0] + dx * t, pz = a[1] + dz * t, dd = Math.hypot(x - px, z - pz);
      if (dd < best.d) { const l = Math.sqrt(l2); best = { d: dd, rd, px, pz, tx: dx / l, tz: dz / l }; }
    }
  }
  return best;
}
// does any OTHER road cross the lateral/longitudinal span around (x,z)?
function crossedByOther(x, z, rd, pad) {
  const rr = Math.ceil((pad + 14) / SC);
  for (let i = Math.floor(x / SC) - rr; i <= Math.floor(x / SC) + rr; i++) for (let j = Math.floor(z / SC) - rr; j <= Math.floor(z / SC) + rr; j++) {
    const arr = segHash.get(i + ',' + j); if (!arr) continue;
    for (const [a, b, o] of arr) {
      if (o.id === rd.id || o.rank < 2) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const dd = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      if (dd < o.hw + pad) return o;
    }
  }
  return null;
}

// ------------------------------------------------------------------ aerial imagery
console.log('reading aerial…');
const AER = await sharp('public/map/aerial.webp').raw().toBuffer({ resolveWithObject: true });
const AW = AER.info.width, aer = AER.data, AS = AW / SZ; // px per metre
const apx = (x, z) => { const px = Math.round((x - OXa) * AS), py = Math.round((z - OZa) * AS); return (px < 0 || py < 0 || px >= AW || py >= AW) ? -1 : (py * AW + px) * 3; };
const lumAt = (x, z) => { const i = apx(x, z); return i < 0 ? 0 : 0.3 * aer[i] + 0.59 * aer[i + 1] + 0.11 * aer[i + 2]; };
// vegetation / canopy masks on a 2x2 downsampled grid (~1.07 m cells)
const GN = AW / 2, GS = SZ / GN;
const canopy = new Uint8Array(GN * GN);
{
  const lum = new Float32Array(AW * AW), veg = new Uint8Array(AW * AW);
  for (let i = 0; i < AW * AW; i++) { const r = aer[i * 3], g = aer[i * 3 + 1], b = aer[i * 3 + 2]; lum[i] = 0.3 * r + 0.59 * g + 0.11 * b; veg[i] = (g - Math.max(r, b) >= 14 && g / (r + g + b + 1) > 0.38) ? 1 : 0; }
  for (let gy = 1; gy < GN - 1; gy++) for (let gx = 1; gx < GN - 1; gx++) {
    let cnt = 0, rough = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = (gy * 2 + dy) * AW + gx * 2 + dx; if (veg[i]) { cnt++; rough += Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + AW]); } }
    if (cnt >= 3 && (rough / cnt > 9 || lum[(gy * 2) * AW + gx * 2] < 75)) canopy[gy * GN + gx] = 1;
  }
}
const gxX = v => Math.floor((v - OXa) / GS), gxZ = v => Math.floor((v - OZa) / GS);
const canopyAt = (x, z) => { const i = gxX(x), j = gxZ(z); return i >= 0 && j >= 0 && i < GN && j < GN && canopy[j * GN + i] === 1; };

// ------------------------------------------------------------------ TREES
const rngT = mkRng(4242);
const GENUS = { Platanus: 0, Acer: 1, Tilia: 1, Quercus: 1, Carpinus: 1, Fraxinus: 1, Aesculus: 1, Robinia: 1, Cercis: 1, Ulmus: 1, Celtis: 1, Morus: 2, Juglans: 2, Prunus: 2, Malus: 2, Populus: 3, Thuja: 4, Cupressus: 4, Juniperus: 4, Pinus: 5, Picea: 5, Cedrus: 5, Abies: 5 };
// species: 0 plane, 1 round, 2 mulberry, 3 poplar, 4 cypress, 5 pine   (nominal rad/height in src/props/trees.js)
const NOM = [[5.4, 15], [3.6, 9.5], [4.0, 7.5], [1.5, 15], [1.0, 6], [3.6, 13]];
const trees = []; // [x,z,sp,rad,h,rot,tint]
const grid = new Map(); const GC = 8; // spatial hash of accepted trees for spacing
const addGrid = (x, z, r) => { const k = Math.floor(x / GC) + ',' + Math.floor(z / GC); (grid.get(k) ?? grid.set(k, []).get(k)).push([x, z, r]); };
const crowded = (x, z, f, rad) => { for (let i = Math.floor((x - 12) / GC); i <= Math.floor((x + 12) / GC); i++) for (let j = Math.floor((z - 12) / GC); j <= Math.floor((z + 12) / GC); j++) for (const [px, pz, pr] of grid.get(i + ',' + j) ?? []) if (Math.hypot(px - x, pz - z) < f * Math.max(pr, rad)) return true; return false; };
const blocked = (x, z) => at(occB, x, z) || at(occR, x, z) || at(occW, x, z) || !inMap(x, z, -3);
function pickSpecies(x, z, rad) {
  const park = at(kind, x, z) === 1, u = rngT();
  if (park) return u < 0.22 ? 0 : u < 0.5 ? 1 : u < 0.6 ? 2 : u < 0.68 ? 3 : u < 0.78 ? 4 : 5;
  if (rad > 4.8) return u < 0.65 ? 0 : u < 0.9 ? 1 : 2;
  return u < 0.42 ? 0 : u < 0.72 ? 1 : u < 0.88 ? 2 : u < 0.94 ? 3 : u < 0.98 ? 4 : 5;
}
for (const { x, z, t } of osmTrees) {
  if (blocked(x, z)) continue;
  let sp = null; const genus = (t.genus || '').split(' ')[0] || (t.species || '').split(' ')[0];
  if (genus in GENUS) sp = GENUS[genus]; else if (t.leaf_type === 'needleleaved') sp = rngT() < 0.5 ? 4 : 5;
  let cr = num(t.diameter_crown), h = num(t.height);
  if (cr != null) cr = Math.max(0.6, cr / 2);
  if (sp == null) sp = pickSpecies(x, z, cr ?? 3.5);
  const nom = NOM[sp];
  let rad = cr ?? nom[0] * (0.75 + rngT() * 0.5), ht = h ?? nom[1] * (0.7 + rngT() * 0.55);
  if (cr != null && h == null) ht = nom[1] * Math.min(1.2, Math.max(0.35, cr / nom[0] * 0.9 + 0.1));
  if (h != null && cr == null) rad = nom[0] * Math.min(1.3, Math.max(0.4, h / nom[1]));
  rad = Math.min(rad, nom[0] * 1.5); ht = Math.min(ht, nom[1] * 1.5);
  trees.push([x, z, sp, rad, ht, rngT() * 6.283, rngT()]); addGrid(x, z, rad * 0.7);
}
const nOsm = trees.length;
// aerial canopy -> extra trees (greedy circle packing on distance transform)
{
  const D = new Float32Array(GN * GN);
  for (let i = 0; i < GN * GN; i++) D[i] = canopy[i] ? 1e4 : 0;
  for (let y = 1; y < GN; y++) for (let x = 1; x < GN - 1; x++) { const i = y * GN + x; if (D[i]) D[i] = Math.min(D[i], D[i - 1] + 1, D[i - GN] + 1, D[i - GN - 1] + 1.414, D[i - GN + 1] + 1.414); }
  for (let y = GN - 2; y >= 0; y--) for (let x = GN - 2; x >= 1; x--) { const i = y * GN + x; if (D[i]) D[i] = Math.min(D[i], D[i + 1] + 1, D[i + GN] + 1, D[i + GN + 1] + 1.414, D[i + GN - 1] + 1.414); }
  const cand = []; for (let i = 0; i < GN * GN; i++) if (D[i] >= 1.6) cand.push(i);
  cand.sort((a, b) => D[b] - D[a]);
  const taken = new Uint8Array(GN * GN);
  const mark = (cx, cz, r) => { const rc = r / GS; for (let y = Math.floor(cz - rc); y <= Math.ceil(cz + rc); y++) for (let x = Math.floor(cx - rc); x <= Math.ceil(cx + rc); x++) if (x >= 0 && y >= 0 && x < GN && y < GN && (x - cx) ** 2 + (y - cz) ** 2 <= rc * rc) taken[y * GN + x] = 1; };
  for (const t of trees) mark((t[0] - OXa) / GS, (t[1] - OZa) / GS, t[3] * 0.85);
  const CAP = 12.5, FILL = 1.05;
  let added = 0, bushes = [];
  for (const i of cand) {
    if (taken[i]) continue;
    const cx = i % GN, cz = Math.floor(i / GN), x = (cx + 0.5) * GS + OXa, z = (cz + 0.5) * GS + OZa;
    const natural = D[i] * GS * 1.05; // inscribed crown radius (m)
    const rad = Math.min(natural, CAP * (0.6 + rngT() * 0.45));
    mark(cx, cz, rad * FILL);
    if (blocked(x, z) || !inMap(x, z, -4)) continue;
    // keep trunks off building walls and kerb lines a little
    if (rad >= 2.7) {
      const sp = pickSpecies(x, z, rad), nom = NOM[sp];
      const r = Math.max(1.3, sp === 3 ? Math.min(rad, 2.2) : sp === 4 ? Math.min(rad, 1.6) : rad);
      trees.push([x, z, sp, r, nom[1] * Math.min(1.35, Math.max(0.5, 0.55 + r / nom[0] * 0.55)) * (0.9 + rngT() * 0.2), rngT() * 6.283, rngT()]); added++;
    } else if (kind[ciz(z) * ON + cix(x)] !== 2 && rngT() < 0.45) bushes.push([x, z, 0.7 + rad * 0.5 + rngT() * 0.5, rngT()]);
  }
  console.log('trees: osm', nOsm, '+ aerial', added, 'bushes', bushes.length);
  var aerialBushes = bushes;
}
let treeCap = 8000;
if (trees.length > treeCap) { console.log('trimming trees', trees.length, '->', treeCap); const keep = trees.slice(0, nOsm), extra = trees.slice(nOsm).sort((a, b) => b[3] - a[3]).slice(0, treeCap - nOsm); trees.length = 0; trees.push(...keep, ...extra); }
const bushes = []; // [x,z,kind,rad,rot,tint]  kind 0 round bush, 1 hedge segment (length rad), 2 conifer shrub
for (const [x, z, r, tn] of aerialBushes.slice(0, 5000)) bushes.push([x, z, rngT() < 0.15 ? 2 : 0, r, rngT() * 6.283, tn]);
// hedges along park borders
for (const a of areas) {
  if (a.kind !== 'grass' || !a.t || !['park', 'garden'].includes(a.t.leisure)) continue;
  if (!a.outer.some(q => inMap(q[0], q[1], -10))) continue;
  const ring = a.outer.slice(); if (signedArea(ring) < 0) ring.reverse();
  const line = resample([...ring, ring[0]], 1.4);
  let on = false, left = 0;
  for (let i = 1; i < line.length; i++) {
    if (left <= 0) { on = rngT() < 0.82; left = 10 + rngT() * 36; } left -= 1.4;
    if (!on) continue;
    const a0 = line[i - 1], b0 = line[i], dx = b0[0] - a0[0], dz = b0[1] - a0[1], l = Math.hypot(dx, dz) || 1;
    const nx = dz / l, nz = -dx / l; // inward-ish; test both
    let x = b0[0] + nx * 0.9, z = b0[1] + nz * 0.9; if (!pip([x, z], ring)) { x = b0[0] - nx * 0.9; z = b0[1] - nz * 0.9; if (!pip([x, z], ring)) continue; }
    if (blocked(x, z) || at(occB, x + nx * 0.8, z + nz * 0.8)) continue;
    bushes.push([x, z, 1, 0.8, Math.atan2(dx, dz), rngT()]);
  }
}
// flower beds: OSM flowerbeds + small lawn islands inside plazas
const flowers = []; // [x,z,rx,rz,rot,palette]
const fbPoly = (p, pal) => {
  const [cx, cz] = centroid(p.outer); let sxx = 0, sxz = 0, szz = 0; for (const q of p.outer) { sxx += (q[0] - cx) ** 2; sxz += (q[0] - cx) * (q[1] - cz); szz += (q[1] - cz) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), c = Math.cos(ang), s = Math.sin(ang); let ex = 0, ez = 0;
  for (const q of p.outer) { ex = Math.max(ex, Math.abs((q[0] - cx) * c + (q[1] - cz) * s)); ez = Math.max(ez, Math.abs(-(q[0] - cx) * s + (q[1] - cz) * c)); }
  flowers.push([cx, cz, Math.min(ex, 9), Math.min(ez, 9), ang, pal]);
};
for (const p of flowerbeds) if (inMap(centroid(p.outer)[0], centroid(p.outer)[1], -5)) fbPoly(p, Math.floor(rngT() * 4));
for (const a of areas) {
  if (a.kind !== 'grass') continue; const ar = Math.abs(signedArea(a.outer)); if (ar < 14 || ar > 450) continue;
  const [cx, cz] = centroid(a.outer); if (!inMap(cx, cz, -8) || canopyAt(cx, cz) || rngT() > 0.45) continue;
  fbPoly(a, Math.floor(rngT() * 4));
}
console.log('bushes/hedges', bushes.length, 'flowerbeds', flowers.length);

// ------------------------------------------------------------------ PARKED CARS
// models (src/props/carspecs.js): vaz2107 niva samara astra camry prius rav4 w124 elantra e39 mazda3 transit gazelle taxi
const VLEN = MODELS.map(m => SPECS[m].L), VWID = MODELS.map(m => SPECS[m].W), TAXI = MODELS.indexOf('taxi');
let acc = 0; const VCUM = MODEL_WEIGHT.map(w => (acc += w));
const pickVariant = rng => { const u = rng() * acc; return VCUM.findIndex(c => u <= c); };
const PAL = [[0.93, 0.93, 0.92, 22], [0.04, 0.04, 0.05, 20], [0.62, 0.63, 0.66, 16], [0.30, 0.31, 0.34, 10], [0.45, 0.46, 0.5, 5], [0.55, 0.04, 0.05, 5], [0.04, 0.10, 0.30, 5], [0.62, 0.55, 0.40, 3], [0.06, 0.22, 0.10, 3], [0.30, 0.04, 0.10, 2], [0.75, 0.32, 0.06, 2], [0.55, 0.50, 0.12, 2], [0.07, 0.30, 0.45, 2]];
const palSum = PAL.reduce((s, p) => s + p[3], 0);
const pickCol = rng => { let u = rng() * palSum; for (let i = 0; i < PAL.length; i++) { u -= PAL[i][3]; if (u <= 0) return i; } return 0; };
const cars = []; // [x,z,yaw,model,col,lights,jitter]
const rngC = mkRng(777);
const PARK_P = { primary: 0.2, trunk: 0.06, secondary: 0.5, tertiary: 0.7, residential: 0.78, unclassified: 0.7, living_street: 0.62, service: 0.45, tertiary_link: 0.1, secondary_link: 0, primary_link: 0, trunk_link: 0 };
const crossingLines = crossings.map(c => c.line);
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)); return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)); };
const crossHash = new Map();
crossingLines.forEach((ln, ix) => { const c = centroid(ln); const k = Math.floor(c[0] / 30) + ',' + Math.floor(c[1] / 30); (crossHash.get(k) ?? crossHash.set(k, []).get(k)).push(ix); });
const nearCrossing = (x, z, d) => { for (let i = Math.floor((x - 40) / 30); i <= Math.floor((x + 40) / 30); i++) for (let j = Math.floor((z - 40) / 30); j <= Math.floor((z + 40) / 30); j++) for (const ix of crossHash.get(i + ',' + j) ?? []) { const ln = crossingLines[ix]; for (let k = 1; k < ln.length; k++) if (segDist([x, z], ln[k - 1], ln[k]) < d) return true; } return false; };
// evidence from the aerial photo: fraction of car-like pixels in the slot rectangle vs the local asphalt reference
function evidence(x, z, fx, fz, len, wid) {
  const nx = -fz, nz = fx; let ref = 0, nref = 0;
  for (let k = -2; k <= 2; k++) { const l = lumAt(x + nx * (wid * 1.6) + fx * k * 2, z + nz * (wid * 1.6) + fz * k * 2); ref += l; nref++; }
  ref /= nref;
  let hit = 0, n = 0, lit = 0;
  for (let a = -len / 2 + 0.3; a <= len / 2 - 0.3; a += 0.45) for (let b = -wid / 2 + 0.2; b <= wid / 2 - 0.2; b += 0.4) {
    const px = x + fx * a + nx * b, pz = z + fz * a + nz * b, i = apx(px, pz); if (i < 0) continue;
    const r = aer[i], g = aer[i + 1], bl = aer[i + 2], l = 0.3 * r + 0.59 * g + 0.11 * bl, chroma = Math.max(r, g, bl) - Math.min(r, g, bl);
    n++; if (l > 60) lit++;
    if (Math.abs(l - ref) > 42 || (chroma > 55 && !(g > r + 12 && g > bl + 12))) hit++;
  }
  return { ev: n ? hit / n : 0, lit: n ? lit / n : 0, ref };
}
const addCar = (x, z, yaw, v, rng, lights = null) => cars.push([x, z, yaw, v, v === TAXI ? (rng() < 0.65 ? 100 : 0) : pickCol(rng), lights ?? (rng() < 0.05 ? 1 : rng() < 0.015 ? 2 : 0), rng()]);
let evUsed = 0, evSkipped = 0, angled = 0, dbl = 0;
for (const rd of roads) {
  if (rd.cls === 'track') continue;
  const pBase = PARK_P[rd.cls] ?? 0.3;
  if (pBase <= 0) continue;
  const line = resample(rd.line, 1), n = line.length; if (n < 8) continue;
  const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
  const L = cum[n - 1];
  const rng = mkRng(rd.id);
  const sideTag = side => { const t = rd.t, nm = side > 0 ? 'right' : 'left'; return { v: t['parking:' + nm] ?? t['parking:both'], o: t['parking:' + nm + ':orientation'] ?? t['parking:both:orientation'] }; };
  for (const side of [1, -1]) {
    const { v: tag, o: orient } = sideTag(side);
    let p = pBase; if (tag === 'no') p = 0; else if (tag && tag !== 'separate') p = Math.max(p, 0.85); else if (tag === 'separate') p = 0.6;
    if (rd.cls === 'service' && side < 0 && rng() < 0.5) p = 0; // alleys: parked on one side mostly
    if (rd.hw < 2.4) p = 0;
    if (p <= 0) continue;
    let s = 2 + rng() * 5, k = 1;
    while (s < L - 3) {
      const v = pickVariant(rng), len = VLEN[v], wid = VWID[v] + 0.08;
      const sc = s + len / 2; while (k < n - 1 && cum[k] < sc) k++;
      const a = line[k - 1], b = line[k], seg = cum[k] - cum[k - 1] || 1, f = (sc - cum[k - 1]) / seg;
      const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg, nx = -tz, nz = tx;
      const bx = a[0] + (b[0] - a[0]) * f, bz = a[1] + (b[1] - a[1]) * f;
      const off = side * (rd.hw - 0.3 - wid / 2 - (rng() < 0.15 ? rng() * 0.45 : rng() * 0.12));
      const cx = bx + nx * off, cz = bz + nz * off;
      let gap = 0.18 + (rng() < 0.14 ? 1.2 + rng() * 5 : rng() * 0.55); // tight rows, a few longer gaps
      if (!inMap(cx, cz, -8) || at(occB, cx, cz)) { s += len + gap; continue; }
      // keep clear of junctions / crossings / driveways
      if (crossedByOther(cx, cz, rd, 5.2) || nearCrossing(cx, cz, 4.2)) { s += len + gap; continue; }
      if (sc < 5 && isInter(rd.nodes[0])) { s += len + gap; continue; } if (L - sc < 5 && isInter(rd.nodes[rd.nodes.length - 1])) { s += len + gap; continue; }
      let dir = 1; if (side < 0 && !rd.oneway && rng() < 0.94) dir = -1; if (rng() < 0.05) dir = -dir;
      let fx = tx * dir, fz = tz * dir;
      // angled bays: tagged in OSM, or detected in the aerial photo on wide roads
      let ang = 0, bay = 0;
      if ((orient === 'perpendicular' || orient === 'diagonal') && rd.hw >= 4.5) ang = orient === 'perpendicular' ? Math.PI / 2 : Math.PI / 3.4;
      else if (rd.hw >= 5.2 && rd.cls !== 'primary' && rd.cls !== 'trunk') {
        // probe a perpendicular / diagonal slot at the kerb
        let best = null;
        for (const [a2, plen] of [[Math.PI / 2, 4.6], [Math.PI / 3.4, 4.8]]) {
          const dx = -side * nx, dz2 = -side * nz; // kerb -> road centre
          const c2 = Math.cos(a2), s2 = Math.sin(a2); const ax = (-nx * side) * 0, az = 0; void ax; void az;
          // car axis rotated from the road tangent by a2, pointing away from the road centre
          const px = tx * c2 + (side * nx) * s2, pz = tz * c2 + (side * nz) * s2;
          const mx = bx + nx * side * (rd.hw - 0.3) - px * plen / 2 * 0.98 * (1) , mz = bz + nz * side * (rd.hw - 0.3) - pz * plen / 2 * 0.98 * (1);
          void dx; void dz2;
          const e2 = evidence(mx, mz, px, pz, plen, 2.0); if (e2.lit > 0.7 && (!best || e2.ev > best.e.ev)) best = { e: e2, a2, px, pz, mx, mz };
        }
        const par = evidence(cx, cz, fx, fz, len, wid);
        if (best && best.e.ev > 0.5 && best.e.ev > par.ev * 1.25) { ang = best.a2; bay = 1; cars.push([best.mx + (rng() - 0.5) * 0.15, best.mz + (rng() - 0.5) * 0.15, Math.atan2(best.px, best.pz), v, pickCol(rng), rng() < 0.05 ? 1 : 0, rng()]); angled++; s += 2.6 + rng() * 0.5; continue; }
      }
      if (ang && !bay) {
        const c2 = Math.cos(ang), s2 = Math.sin(ang), px = tx * c2 + side * nx * s2, pz = tz * c2 + side * nz * s2, plen = len * 0.98;
        const mx = bx + nx * side * (rd.hw - 0.3) - px * plen / 2, mz = bz + nz * side * (rd.hw - 0.3) - pz * plen / 2;
        if (rng() < p && !at(occB, mx, mz)) { addCar(mx + (rng() - 0.5) * 0.1, mz + (rng() - 0.5) * 0.1, Math.atan2(px, pz) + (rng() - 0.5) * 0.04, v, rng); angled++; }
        s += 2.65 + rng() * 0.35; continue;
      }
      s += len + gap;
      const e = evidence(cx, cz, fx, fz, len, wid);
      let q = p;
      if (e.lit > 0.7) { if (e.ev > 0.3) q = 0.97; else if (e.ev < 0.1) q = p * 0.25; }
      if (rng() > q) { if (e.lit > 0.7) evSkipped++; continue; }
      if (e.lit > 0.7 && e.ev > 0.3) evUsed++;
      const yaw = Math.atan2(fx, fz) + (rng() - 0.5) * 0.03;
      addCar(cx + (rng() - 0.5) * 0.1, cz + (rng() - 0.5) * 0.1, yaw, v, rng, v === TAXI ? 0 : null);
      // a few double-parked cars with hazards on, where the road is wide enough to stay passable
      if (rd.hw >= 5.5 && rd.rank >= 4 && rng() < 0.035 && !nearCrossing(cx, cz, 12)) {
        const off2 = side * (rd.hw - 0.3 - wid - 0.35 - wid / 2), dx2 = bx + nx * off2, dz3 = bz + nz * off2;
        if (!at(occB, dx2, dz3)) { addCar(dx2, dz3, yaw + (rng() - 0.5) * 0.06, pickVariant(rng), rng, 1); dbl++; }
      }
    }
  }
}
console.log('parked cars', cars.length, '(aerial-confirmed', evUsed, 'aerial-rejected', evSkipped, 'angled', angled, 'double', dbl, ')');
// parking lots / plazas / dirt: orientation + occupancy from the aerial photo (Republic Square parking), then a grid fill of OSM parking polygons
{
  const taken = new Map(); const tk = (x, z) => Math.floor(x / 2.4) + ',' + Math.floor(z / 2.4);
  const free = (x, z, r) => { for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const q of taken.get((Math.floor(x / 2.4) + i) + ',' + (Math.floor(z / 2.4) + j)) ?? []) if (Math.hypot(q[0] - x, q[1] - z) < r) return false; return true; };
  const mark = (x, z) => { const k = tk(x, z); (taken.get(k) ?? taken.set(k, []).get(k)).push([x, z]); };
  for (const c of cars) mark(c[0], c[1]);
  const rngL = mkRng(31415); let added = 0;
  // 1. Republic Square parking aprons (not mapped as parking in OSM; positions read off the aerial photo): rows of cars in rectangles
  //    [centre x, centre z, across (m), along (m), car yaw, occupancy]
  const SQUARE_LOTS = [[-46, -77, 44, 9, 0, 0.85], [-77, -28, 19, 32, 0.3, 0.8], [62.5, 34, 40, 11, Math.PI / 2, 0.85], [66, 5, 12, 9, Math.PI / 2 + 0.6, 0.8], [3, 62, 36, 8, 0.35, 0.55]];
  for (const [cx, cz, w, d, yaw, occ] of SQUARE_LOTS) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), ux = fz, uz = -fx; // along (forward) and across axes
    for (let u = -w / 2 + 1.3; u <= w / 2 - 1.3; u += 2.55) for (let v = -d / 2 + 2.3; v <= d / 2 - 2.0; v += 4.9) {
      const x = cx + ux * u + fx * v, z = cz + uz * u + fz * v; if (at(occB, x, z) || at(occW, x, z) || !free(x, z, 2.1) || rngL() > occ) continue;
      addCar(x + (rngL() - 0.5) * 0.2, z + (rngL() - 0.5) * 0.2, yaw + (rngL() < 0.5 ? 0 : Math.PI) + (rngL() - 0.5) * 0.05, pickVariant(rngL), rngL); mark(x, z); added++;
    }
  }
  console.log('open-area cars from aerial', added);
  // 2. OSM parking polygons: grid fill with PCA orientation, perpendicular or 60-degree bays
  for (const a of areas) {
    if (a.kind !== 'lot' || !a.outer.some(q => inMap(q[0], q[1], -10))) continue;
    const [cx, cz] = centroid(a.outer); let sxx = 0, sxz = 0, szz = 0; for (const q of a.outer) { sxx += (q[0] - cx) ** 2; sxz += (q[0] - cx) * (q[1] - cz); szz += (q[1] - cz) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), c = Math.cos(ang), s = Math.sin(ang), rng = mkRng(Math.round(cx * 7 + cz)), bayAng = rng() < 0.4 ? Math.PI / 3 : Math.PI / 2;
    for (let u = -60; u <= 60; u += 2.55) for (let v = -60; v <= 60; v += 5.6) {
      const x = cx + u * s + v * c, z = cz - u * c + v * s; // u across, v along
      if (!pip([x, z], a.outer) || at(occB, x, z) || !free(x, z, 2.1)) continue;
      if (!pip([x + c * 2.4, z + s * 2.4], a.outer) || !pip([x - c * 2.4, z - s * 2.4], a.outer)) continue;
      if (rng() < 0.72) { const yawA = Math.atan2(c, s) + (bayAng === Math.PI / 2 ? 0 : (u > 0 ? 0.52 : -0.52)); addCar(x, z, yawA + (rng() < 0.5 ? 0 : Math.PI), pickVariant(rng), rng); mark(x, z); }
    }
  }
}
console.log('cars total', cars.length);

// ------------------------------------------------------------------ STREET FURNITURE
const props = { tables: [], signals: [], signs: [], names: [], busstops: [], benches: [], bins: [], bollards: [], hydrants: [], kiosks: [], flags: [], rooftop: [], blades: [], awnings: [], poles: [] };
const rngF = mkRng(9090);
// ---- traffic signals (meta.signals) : pole on the kerb, mast across the road, heads facing both ways
{
  const arr = meta.signals;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], z = arr[i + 2]; const nr = nearestRoad(x, z, 22, -1, 3);
    if (!nr.rd) continue;
    const { rd, tx, tz } = nr; const nx = -tz, nz = tx;
    const side = ((x - nr.px) * nx + (z - nr.pz) * nz) >= 0 ? 1 : -1; // which side of the centreline the node lies on
    const off = rd.hw + 0.7;
    let px = nr.px + nx * off * side, pz = nr.pz + nz * off * side; if (at(occB, px, pz)) { px = nr.px - nx * off * side; pz = nr.pz - nz * off * side; if (at(occB, px, pz)) continue; }
    const sd = ((px - nr.px) * nx + (pz - nr.pz) * nz) >= 0 ? 1 : -1;
    // pole base, road tangent (direction faced by head A), mast length toward the road centre, phase group
    props.signals.push([r2(px), r2(pz), r2(tx), r2(tz), r2(-sd * Math.min(rd.hw * 0.9, 8)), Math.abs(tx) > Math.abs(tz) ? 0 : 1, rd.hw > 6.5 ? 1 : 0]);
  }
}
// ---- road signs
const signKeys = new Set();
const sgn = (x, z, yaw, type, y = 0) => { const k = Math.round(x / 2) + ',' + Math.round(z / 2); if (signKeys.has(k) || !inMap(x, z, -10) || at(occB, x, z)) return; signKeys.add(k); props.signs.push([r2(x), r2(z), r2(yaw), type]); };
// 0 stop 1 yield 2 one-way 3 parking 4 speed 40 5 speed 60 6 pedestrian crossing 7 no entry 8 no parking 9 priority road 10 speed 30 11 roundabout
for (const c of crossings) {
  const ln = c.line; if (ln.length < 2 || !inMap(ln[0][0], ln[0][1], -10)) continue;
  const a = ln[0], b = ln[ln.length - 1], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = dist(a, b); if (L < 3) continue;
  const nr = nearestRoad(mid[0], mid[1], 12, -1, 3); if (!nr.rd) continue;
  const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  for (const [e, dirv] of [[a, -1], [b, 1]]) {
    // sign stands 1.1 m beyond the crossing end, facing approaching traffic (normal = +-road tangent)
    const sx = e[0] + ux * dirv * 1.1, sz = e[1] + uz * dirv * 1.1;
    const rightOfT = ((sx - nr.px) * -nr.tz + (sz - nr.pz) * nr.tx) > 0; // on the right of +t?
    const fy = rightOfT ? Math.atan2(-nr.tx, -nr.tz) : Math.atan2(nr.tx, nr.tz);
    if (rngF() < 0.6) sgn(sx, sz, fy, 6);
  }
}
for (const rd of roads) {
  if (rd.cls === 'service' || rd.cls === 'track') continue;
  const L = rd.line.length; if (L < 2) continue;
  const fy = (a, b, flip) => Math.atan2(flip * (b[0] - a[0]), flip * (b[1] - a[1]));
  // approach signs at the end of minor ways meeting a more important road
  for (const endIdx of [0, rd.line.length - 1]) {
    const nid = rd.nodes[endIdx], p = rd.line[endIdx], q = rd.line[endIdx === 0 ? 1 : endIdx - 1];
    if (!inMap(p[0], p[1], -10)) continue;
    const major = nearestRoad(p[0], p[1], 3 + 6, rd.id, rd.rank + 1);
    if (!major.rd || major.d > major.rd.hw + 3) continue;
    const L1 = dist(p, q) || 1, ux = (q[0] - p[0]) / L1, uz = (q[1] - p[1]) / L1; // pointing away from the junction
    const back = major.rd.hw + 5.5, nx = -uz, nz = ux;
    const sx = p[0] + ux * back + nx * (rd.hw + 0.6) * -1, sz = p[1] + uz * back + nz * (rd.hw + 0.6) * -1; // right-hand side for traffic heading toward the junction
    const yaw = Math.atan2(ux, uz); // plate faces away from the junction, toward approaching drivers
    if (rd.rank >= 3 && rngF() < 0.75) sgn(sx, sz, yaw, rngF() < 0.55 ? 1 : 0);
  }
  if (rd.oneway && rd.rank >= 4 && rngF() < 0.5) { const a = rd.line[0], b = rd.line[1], l = dist(a, b) || 1, ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l; sgn(a[0] + ux * 9 - uz * (rd.hw + 0.7), a[1] + uz * 9 + ux * (rd.hw + 0.7), Math.atan2(-ux, -uz), 2); }
  // sparse long-road signs: speed / parking / priority
  const rs = resample(rd.line, 3); let nextS = 25 + hash(rd.id) * 60, accL = 0;
  for (let i = 1; i < rs.length; i++) {
    accL += dist(rs[i - 1], rs[i]); if (accL < nextS) continue; accL = 0; nextS = (rd.rank >= 6 ? 150 : 110) + rngF() * 100;
    const a = rs[i - 1], b = rs[i], l = dist(a, b) || 1, ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l, nx = -uz, nz = ux, off = rd.hw + 1.0;
    const x = b[0] + nx * off, z = b[1] + nz * off; // right-hand side
    const u = rngF(); const type = rd.rank >= 6 ? (u < 0.45 ? 5 : u < 0.7 ? 9 : 3) : (u < 0.35 ? 4 : u < 0.55 ? 10 : u < 0.8 ? 3 : 8);
    sgn(x, z, Math.atan2(-ux, -uz), type);
  }
}
// street name plates at junctions of the named streets (picked per name)
const nameCount = new Map();
for (const rd of roads) { const n = rd.t['name:en'] || rd.t.name; if (n && rd.rank >= 4) nameCount.set(n, (nameCount.get(n) ?? 0) + 1); }
const nameList = [...nameCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(e => e[0]);
const nameIdx = new Map(nameList.map((n, i) => [n, i]));
for (const rd of roads) {
  const n = rd.t['name:en'] || rd.t.name, ix = nameIdx.get(n); if (ix == null) continue;
  for (const endIdx of [0, rd.line.length - 1]) {
    const p = rd.line[endIdx], q = rd.line[endIdx === 0 ? 1 : endIdx - 1]; if (!inMap(p[0], p[1], -15) || rngF() > 0.5) continue;
    const l = dist(p, q) || 1, ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l;
    // plate at the corner, 3 m back from the junction, along the building line, facing along the road
    const x = p[0] + ux * (rd.hw + 4) + -uz * (rd.hw + 1.6), z = p[1] + uz * (rd.hw + 4) + ux * (rd.hw + 1.6);
    if (at(occB, x, z) || at(occR, x, z) || !inMap(x, z, -15)) continue;
    props.names.push([r2(x), r2(z), r2(Math.atan2(ux, uz)), ix]);
  }
}
props.nameList = nameList;
// ---- bus stops: shelters (OSM amenity=shelter) + generated along main roads
{
  const pushStop = (x, z, yaw, ad) => props.busstops.push([r2(x), r2(z), r2(yaw), ad]);
  let nOsmStops = 0;
  // (OSM amenity=shelter are park gazebos; not used as bus stops)
  for (const rd of roads) {
    if (rd.rank < 5 || rd.cls.endsWith('_link')) continue;
    const rs = resample(rd.line, 2); let accL = 0, nextS = 40 + hash(rd.id + 3) * 100, side = hash(rd.id + 5) < 0.5 ? 1 : -1;
    for (let i = 1; i < rs.length; i++) {
      accL += dist(rs[i - 1], rs[i]); if (accL < nextS) continue; accL = 0; nextS = 120 + rngF() * 150; side = -side;
      const a = rs[i - 1], b = rs[i], l = dist(a, b) || 1, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l, nx = -tz, nz = tx;
      const off = rd.hw + 1.7, x = b[0] + nx * off * side, z = b[1] + nz * off * side;
      if (!inMap(x, z, -20) || at(occB, x, z) || at(occB, x + nx * side * 1.2, z + nz * side * 1.2) || crossedByOther(b[0], b[1], rd, 14) || nearCrossing(x, z, 8)) continue;
      pushStop(x, z, Math.atan2(nx * side, nz * side) + Math.PI, Math.floor(rngF() * 6)); // glass front faces the road: local +z toward road
    }
  }
  console.log('bus stops', props.busstops.length, '(osm shelters', nOsmStops, ')');
}
// ---- benches, bins, bollards along paths in parks and pedestrian streets; bins/hydrants on main sidewalks
{
  for (const p of pedWays) {
    const ped = p.kind === 'pedestrian'; if (p.kind !== 'pedestrian' && p.kind !== 'footway' && p.kind !== 'path') continue;
    const rs = resample(p.line, 2); if (rs.length < 8) continue;
    let accL = 0, nextS = 8 + rngF() * 30, side = rngF() < 0.5 ? 1 : -1, nextBin = 25 + rngF() * 30;
    for (let i = 1; i < rs.length; i++) {
      accL += 2; const a = rs[i - 1], b = rs[i], l = dist(a, b) || 1, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l, nx = -tz, nz = tx;
      if (!inMap(b[0], b[1], -15)) continue;
      const park = at(kind, b[0], b[1]) === 1, wide = ped ? 3.4 : 1.7;
      if (accL >= nextS) {
        nextS = accL + (ped ? 34 : park ? 52 : 120) + rngF() * 30; side = -side;
        if (!(ped || park || rngF() < 0.25)) continue;
        const x = b[0] + nx * side * wide, z = b[1] + nz * side * wide;
        if (blocked(x, z) && !(ped || park)) continue; if (at(occB, x, z) || at(occW, x, z) || at(occR, x, z)) continue;
        props.benches.push([r2(x), r2(z), r2(Math.atan2(-nx * side, -nz * side))]);
      }
      if (accL >= nextBin) {
        nextBin = accL + (ped ? 55 : park ? 75 : 160) + rngF() * 40;
        if (!(ped || park)) continue;
        const x = b[0] - nx * (wide + 0.4), z = b[1] - nz * (wide + 0.4);
        if (at(occB, x, z) || at(occW, x, z) || at(occR, x, z)) continue;
        props.bins.push([r2(x), r2(z), r2(rngF() * 6.28)]);
      }
      if (ped && i % 7 === 0 && rngF() < 0.5) { for (const sd of [-1, 1]) { const x = b[0] + nx * sd * 3.1, z = b[1] + nz * sd * 3.1; if (!at(occB, x, z) && !at(occR, x, z)) props.bollards.push([r2(x), r2(z)]); } }
    }
  }
  // sidewalk bins + hydrants + bollards at crossings
  for (const rd of roads) {
    if (rd.rank < 4 || rd.cls.endsWith('_link')) continue;
    const rs = resample(rd.line, 3); let accL = 0, nextS = 20 + rngF() * 60, nextH = 60 + rngF() * 120;
    for (let i = 1; i < rs.length; i++) {
      accL += 3; const a = rs[i - 1], b = rs[i], l = dist(a, b) || 1, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l, nx = -tz, nz = tx;
      if (accL >= nextS) {
        nextS = accL + 70 + rngF() * 90; const side = rngF() < 0.5 ? 1 : -1, off = rd.hw + 1.9, x = b[0] + nx * off * side, z = b[1] + nz * off * side;
        if (inMap(x, z, -15) && !at(occB, x, z) && !at(occB, x + nx * side * 0.9, z + nz * side * 0.9) && !nearCrossing(x, z, 3)) props.bins.push([r2(x), r2(z), r2(rngF() * 6.28)]);
      }
      if (accL >= nextH) {
        nextH = accL + 120 + rngF() * 160; const side = rngF() < 0.5 ? 1 : -1, off = rd.hw + 1.4, x = b[0] + nx * off * side, z = b[1] + nz * off * side;
        if (inMap(x, z, -15) && !at(occB, x, z) && !nearCrossing(x, z, 3)) props.hydrants.push([r2(x), r2(z)]);
      }
    }
  }
  for (const c of crossings) {
    const ln = c.line; if (ln.length < 2 || !inMap(ln[0][0], ln[0][1], -10)) continue; const a = ln[0], b = ln[ln.length - 1], L = dist(a, b); if (L < 3) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
    for (const [e, dv] of [[a, -1], [b, 1]]) for (const sd of [-0.9, 0.9]) { if (rngF() < 0.45) continue; const x = e[0] + ux * dv * 0.6 + nx * sd, z = e[1] + uz * dv * 0.6 + nz * sd; if (!at(occB, x, z)) props.bollards.push([r2(x), r2(z)]); }
  }
  console.log('benches', props.benches.length, 'bins', props.bins.length, 'bollards', props.bollards.length, 'hydrants', props.hydrants.length);
}
// ---- kiosks (OSM)
for (const b of kiosks) {
  const [cx, cz] = centroid(b.outer); if (!inMap(cx, cz, -10)) continue;
  let best = 0, bl = 0, ax = 1, az = 0; for (let i = 0; i < b.outer.length; i++) { const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length], l = dist(p, q); if (l > bl) { bl = l; ax = (q[0] - p[0]) / l; az = (q[1] - p[1]) / l; } }
  const area = Math.abs(signedArea(b.outer)); const w = Math.max(2, Math.min(bl, 6)), d = Math.max(1.8, Math.min(area / Math.max(bl, 1), 4));
  props.kiosks.push([r2(cx), r2(cz), r2(Math.atan2(ax, az)), r2(w), r2(d), Math.floor(rngF() * 5)]);
}
// ---- cafe terraces (tables + umbrellas) in front of cafes / restaurants / bars, and OSM outdoor seating polygons
{
  const rngK = mkRng(5151);
  const cafes = buildings.filter(b => ['cafe', 'restaurant', 'bar', 'pub', 'fast_food'].includes(b.t.amenity));
  for (const b of cafes) {
    const outer = b.outer.slice(); if (signedArea(outer) < 0) outer.reverse(); const [cx, cz] = centroid(outer); if (!inMap(cx, cz, -10)) continue;
    let best = null;
    for (let i = 0; i < outer.length; i++) { const p = outer[i], q = outer[(i + 1) % outer.length], L = dist(p, q); if (L < 5) continue; const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L, ox = uz, oz = -ux, mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2; const nr = nearestRoad(mx + ox * 5, mz + oz * 5, 22, -1, 3); if (!nr.rd || nr.d - nr.rd.hw > 12 || at(occB, mx + ox * 2, mz + oz * 2)) continue; const sc = L - nr.d * 0.5; if (!best || sc > best.sc) best = { p, ux, uz, ox, oz, L, sc }; }
    if (!best) continue;
    const n = Math.min(6, Math.max(2, Math.floor(best.L / 2.6))), col = Math.floor(rngK() * 6);
    for (let k = 0; k < n; k++) { const u = best.L * (k + 0.5) / n, x = best.p[0] + best.ux * u + best.ox * 2.0, z = best.p[1] + best.uz * u + best.oz * 2.0; if (at(occB, x, z) || at(occR, x, z) || at(occW, x, z) || !inMap(x, z, -10)) continue; props.tables.push([r2(x), r2(z), r2(rngK() * 6.28), col]); }
  }
  for (const a of areas) { if (a.t?.leisure !== 'outdoor_seating') continue; const [cx, cz] = centroid(a.outer); if (!inMap(cx, cz, -10)) continue; const col = Math.floor(rngK() * 6); for (let x = cx - 12; x <= cx + 12; x += 2.6) for (let z = cz - 12; z <= cz + 12; z += 2.6) if (pip([x, z], a.outer) && !at(occB, x, z) && !at(occR, x, z)) props.tables.push([r2(x + (rngK() - 0.5) * 0.4), r2(z + (rngK() - 0.5) * 0.4), r2(rngK() * 6.28), col]); }
  console.log('cafe tables', props.tables.length);
}
// ---- flags at government buildings (+ a few at hotels/museums handled by rooftop signs)
for (const b of govBuildings) {
  const [cx, cz] = centroid(b.outer); if (!inMap(cx, cz, -10) || Math.abs(signedArea(b.outer)) < 150) continue;
  const nr = nearestRoad(cx, cz, 80, -1, 3); if (!nr.rd) continue;
  // find the edge closest to the road, put 3 poles along it on the forecourt
  let bestE = null, bd = 1e9; for (let i = 0; i < b.outer.length; i++) { const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], d = Math.hypot(m[0] - nr.px, m[1] - nr.pz); if (d < bd && dist(p, q) > 8) { bd = d; bestE = [p, q]; } }
  if (!bestE) continue;
  const [p, q] = bestE, l = dist(p, q), ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l; let ox = uz, oz = -ux; if (signedArea(b.outer) < 0) { ox = -ox; oz = -oz; }
  // outward normal check
  const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2; if (pip([mx + ox * 1.5, mz + oz * 1.5], b.outer)) { ox = -ox; oz = -oz; }
  for (const f of [-0.28, 0, 0.28]) { const x = mx + ux * l * f + ox * 2.4, z = mz + uz * l * f + oz * 2.4; if (!at(occR, x, z)) props.flags.push([r2(x), r2(z), r2(Math.atan2(ox, oz)), f === 0 ? 1 : 0]); }
}
console.log('flags', props.flags.length, 'gov buildings', govBuildings.length);

// ---- buildings: rooftop signs, blade signs, awnings
{
  const rngB = mkRng(31337);
  const heightEst = b => { const t = b.t, area = Math.abs(signedArea(b.outer)), rng = mkRng(b.id); let h = num(t.height), lv = num(t['building:levels']); if (h == null) { if (lv == null) lv = area < 50 ? 1 : area < 160 ? 2 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 4); h = lv * 3.1 + (t['roof:levels'] ? 1.5 : 0.6); } return Math.max(2.6, h); };
  const cand = [];
  for (const b of buildings) {
    if (b.t.shop === 'kiosk' || b.t.amenity === 'shelter' || isSkippedLandmark(b)) continue;
    const outer = b.outer.slice(); if (signedArea(outer) < 0) outer.reverse();
    const area = Math.abs(signedArea(outer)); if (area < 40) continue;
    const [cx, cz] = centroid(outer); if (!inMap(cx, cz, -25)) continue;
    const ht = heightEst(b), rng = mkRng(b.id * 7 + 1);
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i], q = outer[(i + 1) % outer.length], L = dist(p, q); if (L < 5.5) continue;
      const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L, ox = uz, oz = -ux, mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      const nr = nearestRoad(mx + ox * 6, mz + oz * 6, 22, -1, 3); if (!nr.rd || nr.d - nr.rd.hw > 16) continue;
      // edge must face the road and not be walled in by another building
      if (at(occB, mx + ox * 2.5, mz + oz * 2.5)) continue;
      cand.push({ b, p, q, L, ux, uz, ox, oz, mx, mz, ht, area, rank: nr.rd.rank, d: nr.d - nr.rd.hw, rng, cx, cz });
    }
  }
  console.log('building edges facing roads', cand.length);
  // rooftop signs: taller buildings on main roads, spread out
  const roofSorted = cand.filter(c => c.ht >= 13 && c.L >= 9 && c.rank >= 4).sort((a, b) => (b.ht * (b.rank >= 6 ? 1.6 : 1) * (1 - Math.hypot(b.cx, b.cz) / 1600)) - (a.ht * (a.rank >= 6 ? 1.6 : 1) * (1 - Math.hypot(a.cx, a.cz) / 1600)));
  const usedB = new Set(), roofPts = [];
  for (const c of roofSorted) {
    if (props.rooftop.length >= 130) break; if (usedB.has(c.b.id) || c.rng() < 0.55) continue;
    if (roofPts.some(q => Math.hypot(q[0] - c.mx, q[1] - c.mz) < 60)) continue;
    usedB.add(c.b.id); roofPts.push([c.mx, c.mz]);
    const w = Math.min(c.L * 0.8, 6 + rngB() * 9), h = w * 0.25;
    props.rooftop.push([r2(c.mx - c.ox * 0.9), r2(c.mz - c.oz * 0.9), r2(Math.atan2(c.ox, c.oz)), r2(w), r2(h), Math.floor(rngB() * 12), r2(c.ht)]);
  }
  // blade signs (vertical lightboxes on the facade at shop level) and awnings
  const used2 = new Set();
  for (const c of cand) {
    if (c.ht < 5.5 || c.L < 6.5 || c.d > 11 || Math.hypot(c.cx, c.cz) > 1050) continue;
    const r = c.rng();
    if (r < 0.20 && props.blades.length < 1500) {
      const end = r < 0.1 ? 0.14 : 0.86, x = c.p[0] + c.ux * c.L * end + c.ox * 0.05, z = c.p[1] + c.uz * c.L * end + c.oz * 0.05;
      props.blades.push([r2(x), r2(z), r2(Math.atan2(c.ox, c.oz)), r2(3.3 + c.rng() * 1.2), Math.floor(c.rng() * 12)]);
    } else if (r < 0.40 && props.awnings.length < 1600) {
      const len = Math.min(c.L - 1.5, 3 + c.rng() * 5), u0 = c.rng() * (c.L - len - 1) + 0.5 + len / 2;
      props.awnings.push([r2(c.p[0] + c.ux * u0 + c.ox * 0.04), r2(c.p[1] + c.uz * u0 + c.oz * 0.04), r2(Math.atan2(c.ox, c.oz)), r2(len), Math.floor(c.rng() * 8)]);
    }
  }
  console.log('rooftop', props.rooftop.length, 'blades', props.blades.length, 'awnings', props.awnings.length);
}

// ---- extra street furniture: bike racks, planters, morris columns, phone boxes, newspaper / ATM kiosks, manholes + kerb drains, bus-stop poles, cones + barriers, utility poles
Object.assign(props, { bikeracks: [], planters: [], morris: [], phones: [], news: [], manholes: [], stoppoles: [], cones: [], poles: [], benches2: [] });
{
  const rngX = mkRng(2468);
  const free = (x, z, pad = 0) => inMap(x, z, -12) && !at(occB, x, z) && !at(occR, x, z) && !at(occW, x, z);
  const nearProp = (list, x, z, d) => list.some(p => Math.hypot(p[0] - x, p[1] - z) < d);
  // walk a polyline, calling fn(point, tangent, normal, distance) every `step` metres
  const walk = (line, step, fn) => { const rs = resample(line, step); let acc2 = 0; for (let i = 1; i < rs.length; i++) { const a = rs[i - 1], b = rs[i], l = dist(a, b) || 1, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l; acc2 += l; fn(b, [tx, tz], [-tz, tx], acc2); } };
  // pedestrian streets / plazas: planters, bike racks, morris columns, phone boxes
  let lastMorris = [], lastPhone = [];
  for (const p of pedWays) {
    if (p.kind !== 'pedestrian' && p.kind !== 'footway') continue; const ped = p.kind === 'pedestrian';
    let nextPl = 6 + rngX() * 14, nextBike = 20 + rngX() * 50, nextMor = 40 + rngX() * 110, nextPh = 60 + rngX() * 140;
    walk(p.line, 2, (b, t, n, d) => {
      if (!inMap(b[0], b[1], -12)) return; const wide = ped ? 3.5 : 1.9;
      if (d >= nextPl && ped) { nextPl = d + (ped ? 12 : 40) + rngX() * 14; const sd = rngX() < 0.5 ? 1 : -1, x = b[0] + n[0] * wide * sd, z = b[1] + n[1] * wide * sd; if (free(x, z)) props.planters.push([r2(x), r2(z), r2(Math.atan2(t[0], t[1])), Math.floor(rngX() * 3)]); }
      if (d >= nextBike && ped) { nextBike = d + 40 + rngX() * 70; const sd = rngX() < 0.5 ? 1 : -1, x = b[0] + n[0] * (wide + 0.4) * sd, z = b[1] + n[1] * (wide + 0.4) * sd; if (free(x, z)) props.bikeracks.push([r2(x), r2(z), r2(Math.atan2(t[0], t[1]))]); }
      if (d >= nextMor && ped) { nextMor = d + 120 + rngX() * 160; const sd = rngX() < 0.5 ? 1 : -1, x = b[0] + n[0] * (wide + 0.2) * sd, z = b[1] + n[1] * (wide + 0.2) * sd; if (free(x, z) && !nearProp(lastMorris, x, z, 60)) { lastMorris.push([x, z]); props.morris.push([r2(x), r2(z), r2(Math.atan2(n[0] * sd, n[1] * sd)), Math.floor(rngX() * 6)]); } }
      if (d >= nextPh && ped) { nextPh = d + 160 + rngX() * 200; const sd = rngX() < 0.5 ? 1 : -1, x = b[0] + n[0] * (wide + 0.3) * sd, z = b[1] + n[1] * (wide + 0.3) * sd; if (free(x, z) && !nearProp(lastPhone, x, z, 80)) { lastPhone.push([x, z]); props.phones.push([r2(x), r2(z), r2(Math.atan2(n[0] * sd, n[1] * sd))]); } }
    });
  }
  // plaza / park edges: planters + a few more bike racks
  for (const a of areas) {
    if (a.kind !== 'plaza' || !a.outer.some(q => inMap(q[0], q[1], -12))) continue; const ar = Math.abs(signedArea(a.outer)); if (ar < 1500) continue;
    const ring = a.outer.slice(); if (signedArea(ring) < 0) ring.reverse();
    walk([...ring, ring[0]], 2, (b, t, n, d) => { if (!inMap(b[0], b[1], -12) || rngX() > 0.014) return; const x = b[0] - n[0] * 1.2, z = b[1] - n[1] * 1.2; if (free(x, z) && at(kind, x, z) === 2) props.planters.push([r2(x), r2(z), r2(Math.atan2(t[0], t[1])), Math.floor(rngX() * 3)]); });
  }
  for (const c of crossings) {
    const ln = c.line; if (ln.length < 2 || !inMap(ln[0][0], ln[0][1], -20)) continue; const a = ln[0], b = ln[ln.length - 1], L = dist(a, b); if (L < 3) continue; const nr = nearestRoad((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 14, -1, 4); if (!nr.rd) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, e = rngX() < 0.5 ? a : b, dv = e === a ? -1 : 1, x = e[0] + ux * dv * 2.6 + -uz * 0.0, z = e[1] + uz * dv * 2.6; const r = rngX();
    if (r < 0.045 && free(x, z) && !nearProp(props.morris, x, z, 120)) props.morris.push([r2(x), r2(z), r2(Math.atan2(ux * dv, uz * dv) + Math.PI), Math.floor(rngX() * 6)]);
    else if (r > 0.97 && free(x, z) && !nearProp(props.phones, x, z, 90)) props.phones.push([r2(x), r2(z), r2(Math.atan2(ux * dv, uz * dv) + Math.PI)]);
  }
  for (let i = 0; i < props.tables.length; i += 4) if (rngX() < 0.4) { const t = props.tables[i], x = t[0] + 2.4, z = t[1] + 0.5; if (free(x, z)) props.bikeracks.push([r2(x), r2(z), r2(rngX() * 3.14)]); }
  // kerbside: bus-stop poles, benches near lamps' side, kerb drains, manholes
  for (const rd of roads) {
    if (rd.cls === 'track' || rd.hw < 2.4) continue;
    const lane = rd.hw >= 5.5 && !rd.oneway ? rd.hw * 0.5 : 0;
    let nextM = 12 + rngX() * 30, nextD = 8 + rngX() * 14, nextSP = 50 + rngX() * 120;
    walk(rd.line, 2, (b, t, n, d) => {
      if (!inMap(b[0], b[1], -15)) return;
      if (d >= nextM && rd.rank >= 3) { nextM = d + 35 + rngX() * 40; const lat = lane ? (rngX() < 0.5 ? -lane : lane) * (0.85 + rngX() * 0.3) : (rngX() - 0.5) * rd.hw * 0.5; if (at(occR, b[0] + n[0] * lat, b[1] + n[1] * lat) && !nearCrossing(b[0], b[1], 6)) props.manholes.push([r2(b[0] + n[0] * lat), r2(b[1] + n[1] * lat), r2(Math.atan2(t[0], t[1])), 0]); }
      if (d >= nextD && rd.rank >= 4) { nextD = d + 20 + rngX() * 16; for (const sd of [-1, 1]) { if (rngX() < 0.55) continue; const off = rd.hw - 0.28, x = b[0] + n[0] * off * sd, z = b[1] + n[1] * off * sd; if (!at(occB, x, z) && !nearCrossing(x, z, 3)) props.manholes.push([r2(x), r2(z), r2(Math.atan2(t[0], t[1])), 1]); } }
      if (d >= nextSP && rd.rank >= 4 && !rd.cls.endsWith('_link')) { nextSP = d + 110 + rngX() * 150; const sd = rngX() < 0.5 ? 1 : -1, off = rd.hw + 1.55, x = b[0] + n[0] * off * sd, z = b[1] + n[1] * off * sd; if (free(x, z) && !nearCrossing(x, z, 9) && !crossedByOther(b[0], b[1], rd, 12) && !nearProp(props.busstops, x, z, 25)) props.stoppoles.push([r2(x), r2(z), r2(Math.atan2(n[0] * sd, n[1] * sd))]); }
    });
  }
  // utility poles (concrete, cross-arm) with sagging wires along residential / service streets; link=1 connects to the previous pole of the chain
  for (const rd of roads) {
    if (!(rd.rank >= 2 && rd.rank <= 4) || rd.cls.endsWith('_link')) continue; if (hash(rd.id + 11) < 0.4) continue;
    const side = hash(rd.id + 13) < 0.5 ? 1 : -1; let first = true, last = null;
    walk(rd.line, 1.5, (b, t, n, d) => {
      if (d < (last ? last : 8 + hash(rd.id) * 20)) return; last = d + 33 + rngX() * 8;
      const off = rd.hw + 0.9, x = b[0] + n[0] * off * side, z = b[1] + n[1] * off * side;
      if (!inMap(x, z, -10) || at(occB, x, z) || at(occR, x, z)) { first = true; return; }
      props.poles.push([r2(x), r2(z), r2(Math.atan2(t[0], t[1])), first ? 0 : 1]); first = false;
    });
  }
  // traffic cones + barriers: construction areas (dirt polygons) and a few lane closures
  for (const a of areas) {
    if (a.kind !== 'dirt' || !a.outer.some(q => inMap(q[0], q[1], -10))) continue; if (Math.abs(signedArea(a.outer)) < 200) continue;
    const ring = a.outer.slice(); let k = 0;
    walk([...ring, ring[0]], 3, (b, t, n, d) => { k++; if (!inMap(b[0], b[1], -10) || at(occB, b[0], b[1])) return; if (k % 4 === 0) props.cones.push([r2(b[0]), r2(b[1]), r2(Math.atan2(t[0], t[1])), 1]); else if (k % 2 === 0) props.cones.push([r2(b[0]), r2(b[1]), 0, 0]); });
  }
  {
    const cand2 = roads.filter(r => r.rank >= 3 && r.rank <= 6 && r.line.length > 3 && r.line.some(q => inMap(q[0], q[1], -150))); let made = 0;
    for (const rd of cand2) {
      if (hash(rd.id + 5) > 0.1 || made >= 24) continue; const rs = resample(rd.line, 2); if (rs.length < 20) continue; const i0 = Math.floor(hash(rd.id + 9) * (rs.length - 18)) + 4;
      const side = hash(rd.id + 3) < 0.5 ? 1 : -1; let ok = true; const tmp = [];
      for (let i = 0; i < 12; i++) { const a = rs[i0 + i], b = rs[i0 + i + 1], l = dist(a, b) || 1, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l, nx = -tz, nz = tx; const off = rd.hw - 1.6 - Math.min(i, 3) * 0.0; const x = a[0] + nx * side * off, z = a[1] + nz * side * off; if (!inMap(x, z, -20) || at(occB, x, z) || nearCrossing(x, z, 8)) { ok = false; break; } if (i % 3 === 0 && i > 0 && i < 11) tmp.push([r2(x), r2(z), r2(Math.atan2(tx, tz)), 1]); else tmp.push([r2(x), r2(z), 0, 0]); }
      if (ok) { props.cones.push(...tmp); made++; }
    }
  }
  // newspaper / ATM kiosks on sidewalks in front of shops (re-use the facade edges that face main roads)
  {
    let n = 0; const rngN = mkRng(9911);
    for (const b of buildings) {
      if (n >= 70) break; if (b.t.shop === 'kiosk' || isSkippedLandmark(b)) continue; const area = Math.abs(signedArea(b.outer)); if (area < 120) continue;
      const outer = b.outer.slice(); if (signedArea(outer) < 0) outer.reverse(); const [cx, cz] = centroid(outer); if (!inMap(cx, cz, -20) || Math.hypot(cx, cz) > 900 || rngN() > 0.09) continue;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i], q = outer[(i + 1) % outer.length], L = dist(p, q); if (L < 8) continue; const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L, ox = uz, oz = -ux, mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        const nr = nearestRoad(mx + ox * 5, mz + oz * 5, 20, -1, 4); if (!nr.rd || nr.d - nr.rd.hw > 8) continue; const x = mx + ox * 1.5 + ux * L * 0.3, z = mz + oz * 1.5 + uz * L * 0.3;
        if (at(occB, x, z) || at(occR, x, z) || nearCrossing(x, z, 5)) continue; props.news.push([r2(x), r2(z), r2(Math.atan2(ox, oz)), rngN() < 0.45 ? 1 : 0]); n++; break;
      }
    }
  }
  console.log('extra furniture:', Object.fromEntries(['bikeracks', 'planters', 'morris', 'phones', 'news', 'manholes', 'stoppoles', 'cones', 'poles'].map(k => [k, props[k].length])));
}

// ---- keep trunks away from furniture
{
  const keep = [];
  const pts2 = [];
  for (const s of props.tables) pts2.push([s[0], s[1], 1.3]); for (const s of props.signals) pts2.push([s[0], s[1], 1.4]); for (const s of props.busstops) pts2.push([s[0], s[1], 3.2]); for (const s of props.kiosks) pts2.push([s[0], s[1], 3.0]); for (const s of props.flags) pts2.push([s[0], s[1], 1.5]);
  for (const k of ['planters', 'bikeracks', 'phones', 'poles', 'stoppoles']) for (const s of props[k]) pts2.push([s[0], s[1], 0.9]); for (const s of props.morris) pts2.push([s[0], s[1], 1.2]); for (const s of props.news) pts2.push([s[0], s[1], 1.5]);
  for (const s of props.signs) pts2.push([s[0], s[1], 0.9]); for (const s of props.benches) pts2.push([s[0], s[1], 1.2]); for (const s of props.bins) pts2.push([s[0], s[1], 0.7]); for (const s of props.hydrants) pts2.push([s[0], s[1], 0.7]);
  const gh = new Map(); for (const p of pts2) { const k = Math.floor(p[0] / 8) + "," + Math.floor(p[1] / 8); (gh.get(k) ?? gh.set(k, []).get(k)).push(p); }
  const near = (x, z) => { for (let i = Math.floor((x - 4) / 8); i <= Math.floor((x + 4) / 8); i++) for (let j = Math.floor((z - 4) / 8); j <= Math.floor((z + 4) / 8); j++) for (const p of gh.get(i + "," + j) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < p[2]) return true; return false; };
  const before = trees.length; const kept = trees.filter(t => !near(t[0], t[1])); trees.length = 0; trees.push(...kept); console.log("trees removed near furniture", before - trees.length);
  const bk = bushes.filter(b => !near(b[0], b[1])); bushes.length = 0; bushes.push(...bk);
}

// ------------------------------------------------------------------ write
const out = {
  version: 2,
  trees: trees.flatMap(t => [r2(t[0]), r2(t[1]), t[2], r2(t[3]), r2(t[4]), r2(t[5]), r2(t[6])]),
  bushes: bushes.flatMap(b => [r2(b[0]), r2(b[1]), b[2], r2(b[3]), r2(b[4]), r2(b[5])]),
  flowers: flowers.flatMap(f => [r2(f[0]), r2(f[1]), r2(f[2]), r2(f[3]), r2(f[4]), f[5]]),
  cars: cars.flatMap(c => [r2(c[0]), r2(c[1]), +c[2].toFixed(3), c[3], c[4], c[5], +c[6].toFixed(2)]),
  palette: PAL.map(p => p.slice(0, 3)), nameList: props.nameList,
  tables: props.tables.flat(), signals: props.signals.flat(), signs: props.signs.flat(), names: props.names.flat(), busstops: props.busstops.flat(), benches: props.benches.flat(), bins: props.bins.flat(),
  bollards: props.bollards.flat(), hydrants: props.hydrants.flat(), kiosks: props.kiosks.flat(), flags: props.flags.flat(), rooftop: props.rooftop.flat(), blades: props.blades.flat(), awnings: props.awnings.flat(),
  bikeracks: props.bikeracks.flat(), planters: props.planters.flat(), morris: props.morris.flat(), phones: props.phones.flat(), news: props.news.flat(), manholes: props.manholes.flat(), stoppoles: props.stoppoles.flat(), cones: props.cones.flat(), poles: props.poles.flat(),
  models: MODELS,
};
fs.writeFileSync('public/map/props.json', JSON.stringify(out));
console.log('wrote public/map/props.json', (fs.statSync('public/map/props.json').size / 1e3).toFixed(0), 'kB', { trees: trees.length, cars: cars.length });

// ------------------------------------------------------------------ debug overlay
if (DEBUG) {
  fs.mkdirSync('.scratch', { recursive: true });
  const view = async (cx, cz, w, name) => {
    const S = 1400 / w, P = (x, z) => [(x - (cx - w / 2)) * S, (z - (cz - w / 2)) * S];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1400">`;
    for (const t of trees) { const [x, y] = P(t[0], t[1]); if (x < 0 || y < 0 || x > 1400 || y > 1400) continue; svg += `<circle cx="${x}" cy="${y}" r="${t[3] * S * 0.8}" fill="none" stroke="${t[2] === 0 ? '#0f0' : t[2] === 5 ? '#08f' : '#ff0'}" stroke-width="1.5"/>`; }
    for (const c of cars) { const [x, y] = P(c[0], c[1]); if (x < 0 || y < 0 || x > 1400 || y > 1400) continue; const dx = Math.sin(c[2]) * 2 * S, dz = Math.cos(c[2]) * 2 * S; svg += `<line x1="${x - dx}" y1="${y - dz}" x2="${x + dx}" y2="${y + dz}" stroke="#f0f" stroke-width="${1.7 * S}" stroke-linecap="butt" opacity="0.65"/>`; }
    for (const s of props.signals) { const [x, y] = P(s[0], s[1]); svg += `<circle cx="${x}" cy="${y}" r="6" fill="red"/>`; }
    for (const s of props.signs) { const [x, y] = P(s[0], s[1]); svg += `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="cyan"/>`; }
    for (const s of props.busstops) { const [x, y] = P(s[0], s[1]); svg += `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="orange"/>`; }
    for (const s of props.benches) { const [x, y] = P(s[0], s[1]); svg += `<circle cx="${x}" cy="${y}" r="4" fill="white"/>`; }
    svg += '</svg>';
    const px = (cx - OXa) * AS, py = (cz - OZa) * AS, pw = w * AS;
    const base = await sharp('public/map/aerial.webp').extract({ left: Math.round(px - pw / 2), top: Math.round(py - pw / 2), width: Math.round(pw), height: Math.round(pw) }).resize(1400, 1400).toBuffer();
    await sharp(base).composite([{ input: Buffer.from(svg) }]).png().toFile(name);
  };
  await view(0, 0, 250, '.scratch/props-debug-0.png'); await view(-150, -420, 300, '.scratch/props-debug-1.png'); await view(250, -100, 300, '.scratch/props-debug-2.png');
}
