// Builds the Yerevan map GLB (chunked, merged per material) + metadata from OSM + elevation.
// Local frame: x east, y up (0 = Republic Square ground), z south.
import fs from 'node:fs';
import earcut from 'earcut';
import sharp from 'sharp';
import { pavement, polysOf as clipPolys, clipToRect } from './lib/pave.mjs';
import { writeGlb } from './lib/glb.mjs';
import { CENTER, HALF, REGION, NEAR, inRegion, project } from './config.mjs';

const osm = JSON.parse(fs.readFileSync('data/osm.json', 'utf8'));
const hm = JSON.parse(fs.readFileSync('data/height.json', 'utf8'));
const hb = fs.readFileSync('data/height.bin');
const grid = new Float32Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength));
const { N, STEP, R, base } = hm;

// ------------------------------------------------------------------ helpers
function H(x, z) {
  let fx = (x + R) / STEP, fz = (z + R) / STEP;
  fx = Math.min(Math.max(fx, 0), N - 1.001); fz = Math.min(Math.max(fz, 0), N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz - base;
}
const hash = n => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const mkRng = seed => { let s = (seed | 0) ^ 0x1234567; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const signedArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function pip(p, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
const num = v => { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const pts = geom => geom.map(g => project(g.lat, g.lon));
const inMap = (x, z, m = 0) => inRegion(x, z, m);     // extended free-drive region (tools/config.mjs)

// ------------------------------------------------------------------ mesh builders (chunked by cell)
const CELL = 256, TI0 = REGION.x0 / CELL, TI1 = REGION.x1 / CELL, TJ0 = REGION.z0 / CELL, TJ1 = REGION.z1 / CELL;   // level-0 tile index ranges (region is tile aligned)
const OX0 = NEAR.cx - NEAR.half, OZ0 = NEAR.cz - NEAR.half;      // origin of the near-field window (occupancy / AO / surface rasters share it with the aerial + road-field textures)
const cellIdx = v => Math.floor(v / CELL);
class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  v(x, y, z, nx, ny, nz, u, v, c = [255, 255, 255, 255]) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c[0], c[1], c[2], c[3]); return this.n++; }
}
const builders = new Map();
function B(mat, x, z) {
  const ci = cellIdx(x), cj = cellIdx(z), key = `${ci}|${cj}|${mat}`;
  let b = builders.get(key); if (!b) { b = new Builder(); b.mat = mat; b.ci = ci; b.cj = cj; builders.set(key, b); }
  return b;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// triangle with auto winding so the geometric normal agrees with n
function tri(b, p0, p1, p2, n, t0, t1, t2, c) {
  const g = cross(sub(p1, p0), sub(p2, p0));
  if (dot(g, n) < 0) { [p1, p2] = [p2, p1]; [t1, t2] = [t2, t1]; }
  const i0 = b.v(p0[0], p0[1], p0[2], n[0], n[1], n[2], t0[0], t0[1], c);
  const i1 = b.v(p1[0], p1[1], p1[2], n[0], n[1], n[2], t1[0], t1[1], c);
  const i2 = b.v(p2[0], p2[1], p2[2], n[0], n[1], n[2], t2[0], t2[1], c);
  b.idx.push(i0, i1, i2);
}
function quad(b, A, Bp, C, D, n, uA, uB, uC, uD, c) {
  const g = cross(sub(Bp, A), sub(C, A)), fwd = dot(g, n) >= 0;
  const i0 = b.v(A[0], A[1], A[2], n[0], n[1], n[2], uA[0], uA[1], c), i1 = b.v(Bp[0], Bp[1], Bp[2], n[0], n[1], n[2], uB[0], uB[1], c), i2 = b.v(C[0], C[1], C[2], n[0], n[1], n[2], uC[0], uC[1], c), i3 = b.v(D[0], D[1], D[2], n[0], n[1], n[2], uD[0], uD[1], c);
  if (fwd) b.idx.push(i0, i1, i2, i0, i2, i3); else b.idx.push(i0, i2, i1, i0, i3, i2);
}

// ------------------------------------------------------------------ occupancy raster (buildings / roads) 2 m cells
const OC = 2, ON = Math.round(2 * NEAR.half / OC);
const occB = new Uint8Array(ON * ON), occR = new Uint8Array(ON * ON);
function fillPoly(ring, arr) {
  let zmin = Infinity, zmax = -Infinity; for (const p of ring) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
  const j0 = Math.max(0, Math.floor((zmin - OZ0) / OC)), j1 = Math.min(ON - 1, Math.ceil((zmax - OZ0) / OC));
  for (let j = j0; j <= j1; j++) {
    const z = j * OC + OZ0 + OC / 2, xs = [];
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.floor((xs[k] - OX0) / OC)), i1 = Math.min(ON - 1, Math.floor((xs[k + 1] - OX0) / OC)); for (let i = i0; i <= i1; i++) arr[j * ON + i] = 1; }
  }
}
function stamp(arr, x, z, r) {
  const i0 = Math.floor((x - r - OX0) / OC), i1 = Math.floor((x + r - OX0) / OC), j0 = Math.floor((z - r - OZ0) / OC), j1 = Math.floor((z + r - OZ0) / OC);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && j >= 0 && i < ON && j < ON) { const cx = i * OC + OX0 + OC / 2 - x, cz = j * OC + OZ0 + OC / 2 - z; if (cx * cx + cz * cz <= r * r) arr[j * ON + i] = 1; }
}
const occAt = (arr, x, z) => { const i = Math.floor((x - OX0) / OC), j = Math.floor((z - OZ0) / OC); return i >= 0 && j >= 0 && i < ON && j < ON && arr[j * ON + i] === 1; };

// ------------------------------------------------------------------ ring assembly for multipolygon relations
function assembleRings(segs) {
  const key = p => p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
  const rem = segs.filter(s => s.length > 1).map(s => s.slice()), rings = [];
  while (rem.length) {
    let cur = rem.pop();
    let guard = 0;
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

// ------------------------------------------------------------------ classification
const elements = osm.elements;
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

const collB = [], collW = [];   // physics colliders: building footprints [flat ring, y0, y1], walls/fences [flat line, h]
const buildingsRaw = [], parts = [], vroads = [], pedWays = [], crossings = [], areas = [], waterLines = [], barriers = [];
const trees = [], lampNodes = [], signals = [], fountains = [];
for (const e of elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    const [x, z] = project(e.lat, e.lon);
    if (t.natural === 'tree') trees.push([x, z]);
    else if (t.highway === 'street_lamp') lampNodes.push([x, z]);
    else if (t.highway === 'traffic_signals') signals.push([x, z]);
    else if (t.amenity === 'fountain') fountains.push([x, z]);
    continue;
  }
  if (t['building:part']) { for (const p of polysOf(e)) parts.push({ id: e.id, ...p, t }); continue; }
  if (t.building) { for (const p of polysOf(e)) buildingsRaw.push({ id: e.id, ...p, t }); continue; }
  if (t.highway && e.type === 'way' && e.geometry) {
    if (t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.covered === 'yes') continue;
    if (t.area === 'yes') { for (const p of polysOf(e)) areas.push({ ...p, kind: 'plaza' }); continue; }
    const line = pts(e.geometry);
    if (ROAD[t.highway]) vroads.push({ id: e.id, t, line, nodes: e.nodes, cls: t.highway });
    else if (t.highway in PED) {
      if (t.highway === 'steps') continue;
      if (t.footway === 'crossing' || t.crossing) crossings.push({ line });
      else pedWays.push({ line, kind: t.highway });
    }
    continue;
  }
  if (t.waterway && e.type === 'way' && e.geometry) { if (t.waterway === 'river' || t.waterway === 'canal') waterLines.push({ line: pts(e.geometry), w: num(t.width) ?? (t.waterway === 'river' ? 14 : 5) }); continue; }
  if (t.barrier && e.type === 'way' && e.geometry) { barriers.push({ line: pts(e.geometry), t }); continue; }
  const polys = polysOf(e);
  if (polys.length) {
    let kind = null;
    if (t.natural === 'water' || t.amenity === 'fountain' || t.water) kind = 'water';
    else if (['park', 'garden', 'playground', 'recreation_ground', 'dog_park'].includes(t.leisure) || ['grass', 'meadow', 'recreation_ground', 'village_green', 'forest', 'orchard', 'flowerbed', 'cemetery'].includes(t.landuse) || ['wood', 'scrub', 'grassland', 'heath'].includes(t.natural)) kind = 'grass';
    else if (t.leisure === 'pitch' || t.leisure === 'track') kind = 'plaza';
    else if (t.amenity === 'parking' || t.landuse === 'garages') kind = 'lot';
    else if (t.landuse === 'construction' || t.landuse === 'brownfield') kind = 'dirt';
    else if (t.place === 'square' || t.amenity === 'marketplace') kind = 'plaza';
    if (kind) for (const p of polys) areas.push({ ...p, kind });
  }
}
console.log({ buildings: buildingsRaw.length, parts: parts.length, roads: vroads.length, ped: pedWays.length, crossings: crossings.length, areas: areas.length, barriers: barriers.length, trees: trees.length, lampNodes: lampNodes.length, signals: signals.length });

// ------------------------------------------------------------------ terrain (per level-0 tile, aligned with the far LOD tiles)
for (let tj = TJ0; tj < TJ1; tj++) for (let ti = TI0; ti < TI1; ti++) {
  const n = 48, st = CELL / n, x0 = ti * CELL, z0 = tj * CELL, tb = B('terrain', x0 + CELL / 2, z0 + CELL / 2), base0 = tb.n;
  for (let c = 0; c <= n; c++) for (let aa = 0; aa <= n; aa++) {
    const x = x0 + aa * st, z = z0 + c * st, y = H(x, z);
    const nx = -(H(x + st, z) - H(x - st, z)) / (2 * st), nz = -(H(x, z + st) - H(x, z - st)) / (2 * st), l = Math.hypot(nx, 1, nz);
    tb.v(x, y, z, nx / l, 1 / l, nz / l, x, z, [255, 255, 255, 255]);
  }
  const id = (aa, c) => base0 + c * (n + 1) + aa;
  for (let c = 0; c < n; c++) for (let aa = 0; aa < n; aa++) tb.idx.push(id(aa, c), id(aa, c + 1), id(aa + 1, c), id(aa + 1, c), id(aa, c + 1), id(aa + 1, c + 1));
  const edge = []; for (let aa = 0; aa <= n; aa++) edge.push([aa, 0]); for (let c = 1; c <= n; c++) edge.push([n, c]); for (let aa = n - 1; aa >= 0; aa--) edge.push([aa, n]); for (let c = n - 1; c >= 1; c--) edge.push([0, c]);
  const sb = tb.n;
  for (const [aa, c] of edge) { const k = id(aa, c) - 0; tb.v(tb.pos[k * 3], tb.pos[k * 3 + 1] - 2.5, tb.pos[k * 3 + 2], tb.nor[k * 3], tb.nor[k * 3 + 1], tb.nor[k * 3 + 2], tb.pos[k * 3], tb.pos[k * 3 + 2], [255, 255, 255, 255]); }
  for (let e = 0; e < edge.length; e++) { const e2 = (e + 1) % edge.length, t0 = id(edge[e][0], edge[e][1]), t1 = id(edge[e2][0], edge[e2][1]), s0 = sb + e, s1 = sb + e2; tb.idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0); }
}

// ------------------------------------------------------------------ polygons draped on terrain
function subdivide(a, b, c, maxEdge, out) {
  const ab = dist(a, b), bc = dist(b, c), ca = dist(c, a), m = Math.max(ab, bc, ca);
  if (m <= maxEdge) { out.push([a, b, c]); return; }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (m === ab) { const d = mid(a, b); subdivide(a, d, c, maxEdge, out); subdivide(d, b, c, maxEdge, out); }
  else if (m === bc) { const d = mid(b, c); subdivide(a, b, d, maxEdge, out); subdivide(a, d, c, maxEdge, out); }
  else { const d = mid(c, a); subdivide(a, b, d, maxEdge, out); subdivide(d, b, c, maxEdge, out); }
}
function addArea(mat, outer, holes, yoff, opts = {}) {
  const flat = [], hi = [];
  let ring = outer.slice(); if (signedArea(ring) < 0) ring.reverse();
  ring.forEach(p => flat.push(p[0], p[1]));
  for (const h0 of holes) { const h = h0.slice(); hi.push(flat.length / 2); h.forEach(p => flat.push(p[0], p[1])); }
  const ids = earcut(flat, hi, 2);
  const P = i => [flat[i * 2], flat[i * 2 + 1]];
  const col = opts.color ?? [255, 255, 255, 255];
  for (let k = 0; k < ids.length; k += 3) {
    const out = []; subdivide(P(ids[k]), P(ids[k + 1]), P(ids[k + 2]), opts.maxEdge ?? 18, out);
    for (const [a, b, c] of out) {
      const mx = (a[0] + b[0] + c[0]) / 3, mz = (a[1] + b[1] + c[1]) / 3, bl = B(mat, mx, mz);
      const v = p => [p[0], (opts.flatY ?? H(p[0], p[1])) + yoff, p[1]];
      tri(bl, v(a), v(b), v(c), [0, 1, 0], a, b, c, col);
    }
  }
}

// ------------------------------------------------------------------ ribbons (roads, sidewalks, markings, walls)
function resample(line, step) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], d = dist(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
function trimLine(line, s, e) {
  let total = 0; for (let i = 1; i < line.length; i++) total += dist(line[i - 1], line[i]);
  if (total < s + e + 4) return null;
  const out = []; let acc = 0;
  const at = d => { let a = 0; for (let i = 1; i < line.length; i++) { const l = dist(line[i - 1], line[i]); if (a + l >= d) { const t = (d - a) / l; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; } a += l; } return line[line.length - 1]; };
  out.push(at(s));
  for (let i = 1; i < line.length - 1; i++) { acc += dist(line[i - 1], line[i]); if (acc > s + 0.1 && acc < total - e - 0.1) out.push(line[i]); }
  out.push(at(total - e));
  return out;
}
// Ribbon between lateral offsets off0..off1 (metres, +left of travel direction). uvMode: 'world' | 'across'
function ribbon(line0, off0, off1, mat, yoff, uvMode = 'world', opts = {}) {
  if (line0.length < 2) return;
  const line = resample(line0, opts.step ?? 4);
  const n = line.length, L = [], Rr = [], d = [0];
  for (let i = 1; i < n; i++) d.push(d[i - 1] + dist(line[i - 1], line[i]));
  const segN = [];
  for (let i = 0; i < n - 1; i++) { const dx = line[i + 1][0] - line[i][0], dz = line[i + 1][1] - line[i][1], l = Math.hypot(dx, dz) || 1; segN.push([-dz / l, dx / l]); }
  for (let i = 0; i < n; i++) {
    let nx, nz, m = 1;
    if (i === 0) [nx, nz] = segN[0]; else if (i === n - 1) [nx, nz] = segN[n - 2];
    else { const a = segN[i - 1], b = segN[i]; nx = a[0] + b[0]; nz = a[1] + b[1]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; m = Math.min(2.2, 1 / Math.max(0.35, nx * a[0] + nz * a[1])); }
    L.push([line[i][0] + nx * off1 * m, line[i][1] + nz * off1 * m]);
    Rr.push([line[i][0] + nx * off0 * m, line[i][1] + nz * off0 * m]);
  }
  const col = opts.color ?? [255, 255, 255, 255];
  const vs = opts.vScale ?? 1;
  let lastB = null, li = 0, ri = 0;
  for (let i = 0; i < n; i++) {
    const mx = (L[i][0] + Rr[i][0]) / 2, mz = (L[i][1] + Rr[i][1]) / 2, b = B(mat, mx, mz);
    const pl = [L[i][0], H(L[i][0], L[i][1]) + yoff, L[i][1]], pr = [Rr[i][0], H(Rr[i][0], Rr[i][1]) + yoff, Rr[i][1]];
    const uvl = uvMode === 'world' ? [L[i][0], L[i][1]] : [1, d[i] * vs], uvr = uvMode === 'world' ? [Rr[i][0], Rr[i][1]] : [0, d[i] * vs];
    const nl = b.v(pl[0], pl[1], pl[2], 0, 1, 0, uvl[0], uvl[1], col), nr = b.v(pr[0], pr[1], pr[2], 0, 1, 0, uvr[0], uvr[1], col);
    if (i > 0 && lastB === b) {
      // verify winding: want up-facing (+y)
      b.idx.push(ri, li, nr, nr, li, nl);
      // compute actual orientation once; flip if downward
      const p0 = [b.pos[ri * 3], b.pos[ri * 3 + 1], b.pos[ri * 3 + 2]], p1 = [b.pos[li * 3], b.pos[li * 3 + 1], b.pos[li * 3 + 2]], p2 = [b.pos[nr * 3], b.pos[nr * 3 + 1], b.pos[nr * 3 + 2]];
      if (cross(sub(p1, p0), sub(p2, p0))[1] < 0) { const k = b.idx.length; [b.idx[k - 5], b.idx[k - 4]] = [b.idx[k - 4], b.idx[k - 5]]; [b.idx[k - 2], b.idx[k - 1]] = [b.idx[k - 1], b.idx[k - 2]]; }
    }
    lastB = b; li = nl; ri = nr;
  }
}

// ------------------------------------------------------------------ roads
const vclass = r => r.cls;
// intersection detection
const nodeWays = new Map();
for (const r of vroads) if (r.cls !== 'service' && r.cls !== 'track') r.nodes.forEach((id, k) => { let m = nodeWays.get(id); if (!m) nodeWays.set(id, m = new Map()); m.set(r.id, (m.get(r.id) ?? 0) + 1 + (k > 0 && k < r.nodes.length - 1 ? 10 : 0)); });
const isInter = id => { const m = nodeWays.get(id); if (!m) return false; if (m.size >= 3) return true; if (m.size === 2) return [...m.values()].some(v => v >= 10); return false; };

const roadSegs = new Map(); // spatial hash for "nearest road" queries
const SC = 24, addSeg = (a, b, hw) => { const k0 = [Math.floor(Math.min(a[0], b[0]) / SC), Math.floor(Math.min(a[1], b[1]) / SC)], k1 = [Math.floor(Math.max(a[0], b[0]) / SC), Math.floor(Math.max(a[1], b[1]) / SC)]; for (let i = k0[0]; i <= k1[0]; i++) for (let j = k0[1]; j <= k1[1]; j++) { const key = i + ',' + j; (roadSegs.get(key) ?? roadSegs.set(key, []).get(key)).push([a, b, hw]); } };
function nearestRoad(x, z, maxD) {
  let best = { d: Infinity, hw: 0, sx: 0, sz: 0 };
  const r = Math.ceil(maxD / SC);
  for (let i = Math.floor(x / SC) - r; i <= Math.floor(x / SC) + r; i++) for (let j = Math.floor(z / SC) - r; j <= Math.floor(z / SC) + r; j++) {
    const arr = roadSegs.get(i + ',' + j); if (!arr) continue;
    for (const [a, b, hw] of arr) {
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const px = a[0] + dx * t, pz = a[1] + dz * t, dd = Math.hypot(x - px, z - pz) - hw;
      if (dd < best.d) best = { d: dd, hw, px, pz };
    }
  }
  return best;
}

for (const b of buildingsRaw) fillPoly(b.outer, occB);   // pre-pass so lamps/trees can avoid building footprints
const roadShapes = [];
const lamps = [];
const sorted = vroads.slice().sort((a, b) => ROAD[a.cls].rank - ROAD[b.cls].rank);
for (const r of sorted) {
  const cls = ROAD[r.cls], t = r.t;
  const lanes = num(t.lanes), oneway = t.oneway === 'yes' || t.oneway === '1';
  let w = num(t.width) ?? (lanes ? lanes * 3.2 + (oneway ? 0.6 : 1.2) : cls.w);
  w = Math.max(3, Math.min(30, w));
  if (!r.line.some(p => inMap(p[0], p[1], 40))) continue;
  const hw = w / 2, yoff = 0.10 + cls.rank * 0.003;
  const mainRoad = cls.rank >= 4 && r.cls !== 'service';
  roadShapes.push({ line: r.line, hw, main: mainRoad, sw: cls.rank >= 6 ? 3.2 : 2.2 });   // asphalt + sidewalks are generated from the union of all roads below
  for (let i = 1; i < r.line.length; i++) { addSeg(r.line[i - 1], r.line[i], hw); if (r.cls !== 'service' && r.cls !== 'track') { const m = [(r.line[i - 1][0] + r.line[i][0]) / 2, (r.line[i - 1][1] + r.line[i][1]) / 2]; stamp(occR, m[0], m[1], hw + 1); } }
  // markings
  let mark = null;
  if (mainRoad) { if (oneway && w > 7) mark = 'mark_c'; else if (w >= 11.5) mark = 'mark_b'; else if (w >= 6) mark = 'mark_a'; }
  if (mark) {
    // split at intersection nodes, trim near them
    const idxs = [0]; r.nodes.forEach((id, k) => { if (k > 0 && k < r.nodes.length - 1 && isInter(id)) idxs.push(k); }); idxs.push(r.nodes.length - 1);
    for (let s = 0; s + 1 < idxs.length; s++) {
      const seg = r.line.slice(idxs[s], idxs[s + 1] + 1);
      const ts = (idxs[s] === 0 ? isInter(r.nodes[0]) : true) ? 7 + hw * 0.0 : 0, te = (idxs[s + 1] === r.nodes.length - 1 ? isInter(r.nodes[r.nodes.length - 1]) : true) ? 7 : 0;
      const tr = trimLine(seg, ts + (isInter(r.nodes[idxs[s]]) ? 2 : 0), te + (isInter(r.nodes[idxs[s + 1]]) ? 2 : 0));
      if (tr) ribbon(tr, -hw, hw, mark, yoff + 0.012, 'across', { vScale: 1 });
    }
  }
  // street lamps (procedural) along real roads
  if (cls.rank >= 3 && r.cls !== 'service') {
    const line = resample(r.line, 2); let acc = 0, side = hash(r.id) < 0.5 ? 1 : -1, next = 12 + hash(r.id + 7) * 18;
    for (let i = 1; i < line.length; i++) {
      acc += dist(line[i - 1], line[i]);
      if (acc >= next) {
        next = acc + (cls.rank >= 6 ? 34 : 28); side = -side;
        const dx = line[i][0] - line[i - 1][0], dz = line[i][1] - line[i - 1][1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        const off = hw + (cls.rank >= 6 ? 3.6 : 2.5);
        const x = line[i][0] + nx * off * side, z = line[i][1] + nz * off * side;
        if (!inMap(x, z, -15) || occAt(occB, x, z)) continue;
        lamps.push([x, H(x, z), z, -nx * side, -nz * side, cls.rank >= 6 ? 1 : 0]);
      }
    }
  }
}


// ------------------------------------------------------------------ pavement: asphalt + raised sidewalks + curb faces (Clipper union of all roads)
const SW_UP = 0.26, ROAD_Y = 0.10;
{
  const pav = pavement({ roads: roadShapes, buildings: buildingsRaw.map(b => b.outer), closeR: 2.5 });
  // 0.5 m raster of the road surface (even-odd over every ring) to classify curb edges
  const RC = 0.5, RN = Math.round(2 * NEAR.half / RC), roadMask = new Uint8Array(RN * RN);
  for (const P of clipPolys(pav.road)) {
    const rings = [P.outer, ...P.holes]; let zmin = Infinity, zmax = -Infinity; for (const q of P.outer) { zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]); }
    const edges = []; for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]); }
    for (let j = Math.max(0, Math.floor((zmin - OZ0) / RC)); j <= Math.min(RN - 1, Math.floor((zmax - OZ0) / RC)); j++) {
      const z = j * RC + OZ0 + RC / 2, xs = []; for (const e of edges) if (e[1] <= z && e[3] > z) xs.push(e[0] + (z - e[1]) / (e[3] - e[1]) * (e[2] - e[0])); xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.floor((xs[k] - OX0) / RC)); i <= Math.min(RN - 1, Math.floor((xs[k + 1] - OX0) / RC)); i++) roadMask[j * RN + i] = 1;
    }
  }
  const onRoad = (x, z) => { const i = Math.floor((x - OX0) / RC), j = Math.floor((z - OZ0) / RC); return i >= 0 && j >= 0 && i < RN && j < RN && roadMask[j * RN + i] === 1; };
  // surfaces, clipped per level-0 tile so they stay aligned with the tile grid
  let nRoad = 0, nWalk = 0;
  for (let tj = TJ0; tj < TJ1; tj++) for (let ti = TI0; ti < TI1; ti++) {
    const rect = [ti * CELL, tj * CELL, (ti + 1) * CELL, (tj + 1) * CELL];
    for (const P of clipToRect(pav.road, rect)) { addArea('asphalt', P.outer, P.holes, ROAD_Y, { maxEdge: 9 }); nRoad++; }
    for (const P of clipToRect(pav.sidewalk, rect)) { addArea('pavement', P.outer, P.holes, SW_UP, { maxEdge: 9 }); nWalk++; }
  }
  // curb faces along the sidewalk boundary: down to the road (kerb) or to the ground (property-side step); skipped against buildings
  let nCurb = 0;
  for (const P of clipPolys(pav.sidewalk)) for (const [ring0, isHole] of [[P.outer, false], ...P.holes.map(h => [h, true])]) {
    let ring = ring0; const ar = signedArea(ring); if ((!isHole && ar < 0) || (isHole && ar > 0)) ring = ring.slice().reverse();
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = dist(a, b); if (L < 0.15) continue;
      const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, qx = mx + nx * 0.35, qz = mz + nz * 0.35;
      if (!inMap(mx, mz, 30) || occAt(occB, qx, qz)) { u += L; continue; }
      const road = onRoad(qx, qz), steps = Math.max(1, Math.ceil(L / 5));
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps, ax = a[0] + (b[0] - a[0]) * t0, az = a[1] + (b[1] - a[1]) * t0, bx = a[0] + (b[0] - a[0]) * t1, bz = a[1] + (b[1] - a[1]) * t1;
        const ha = H(ax, az), hb = H(bx, bz), yb0 = road ? ROAD_Y : -0.05, bl = B('curb', (ax + bx) / 2, (az + bz) / 2), du = L / steps, hh = SW_UP - yb0;
        quad(bl, [ax, ha + yb0, az], [bx, hb + yb0, bz], [bx, hb + SW_UP, bz], [ax, ha + SW_UP, az], [nx, 0, nz], [u, 0], [u + du, 0], [u + du, hh], [u, hh], [255, 255, 255, 255]); u += du; nCurb++;
      }
    }
  }

  // ---- ground-offset raster for the physics (centimetres above the terrain, 0.5 m cells): grass/plaza/lot < asphalt 10 < sidewalk 26
  {
    const off = new Uint8Array(RN * RN).fill(4);
    const fillRings = (P, val) => {
      const rings = [P.outer, ...P.holes]; let zmin = Infinity, zmax = -Infinity; for (const q of P.outer) { zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]); }
      const edges = []; for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]); }
      for (let j = Math.max(0, Math.floor((zmin - OZ0) / RC)); j <= Math.min(RN - 1, Math.floor((zmax - OZ0) / RC)); j++) {
        const z = j * RC + OZ0 + RC / 2, xs = []; for (const e of edges) if (e[1] <= z && e[3] > z) xs.push(e[0] + (z - e[1]) / (e[3] - e[1]) * (e[2] - e[0])); xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.floor((xs[k] - OX0) / RC)); i <= Math.min(RN - 1, Math.floor((xs[k + 1] - OX0) / RC)); i++) off[j * RN + i] = val;
      }
    };
    for (const a of areas) fillRings({ outer: a.outer, holes: a.holes }, { grass: 4, plaza: 5, lot: 9, dirt: 3, water: 4 }[a.kind] ?? 4);
    for (const P of clipPolys(pav.road)) fillRings(P, 10);
    for (const P of clipPolys(pav.sidewalk)) fillRings(P, 26);
    // crop to the drivable region (+48 m): the near-field window is a bit bigger than the region
    const cx0 = Math.max(0, Math.floor((REGION.x0 - 48 - OX0) / RC)), cx1 = Math.min(RN, Math.ceil((REGION.x1 + 48 - OX0) / RC)), cz0 = Math.max(0, Math.floor((REGION.z0 - 48 - OZ0) / RC)), cz1 = Math.min(RN, Math.ceil((REGION.z1 + 48 - OZ0) / RC));
    const cw = cx1 - cx0, ch = cz1 - cz0, crop = Buffer.alloc(cw * ch);
    for (let j = 0; j < ch; j++) crop.set(off.subarray((cz0 + j) * RN + cx0, (cz0 + j) * RN + cx1), j * cw);
    const zlib = await import('node:zlib');
    fs.writeFileSync('public/map/surface.bin', zlib.deflateSync(crop, { level: 9 }));
    fs.writeFileSync('public/map/surface.json', JSON.stringify({ w: cw, h: ch, cell: RC, x0: OX0 + cx0 * RC, z0: OZ0 + cz0 * RC }));
    console.log('surface raster', cw, 'x', ch, (fs.statSync('public/map/surface.bin').size / 1e3).toFixed(0), 'KB');
  }
  console.log('pavement: road polys', nRoad, 'sidewalk polys', nWalk, 'curb faces', nCurb);
}


// ------------------------------------------------------------------ tour chains (long continuous roads for the demo camera / future AI paths)
const bigRoads = vroads.filter(r => ROAD[r.cls].rank >= 5 && r.cls !== 'service');
const endMap = new Map(); bigRoads.forEach((r, i) => { for (const k of [0, r.nodes.length - 1]) { const id = r.nodes[k]; (endMap.get(id) ?? endMap.set(id, []).get(id)).push([i, k === 0 ? 's' : 'e']); } });
const used = new Set(), chains = [];
const unit = (a, b) => { const l = dist(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
for (let s0 = 0; s0 < bigRoads.length; s0++) {
  if (used.has(s0)) continue; used.add(s0);
  let line = bigRoads[s0].line.slice(), endNode = bigRoads[s0].nodes[bigRoads[s0].nodes.length - 1];
  for (;;) {
    const cands = (endMap.get(endNode) ?? []).filter(([j]) => !used.has(j));
    const d0 = unit(line[line.length - 2], line[line.length - 1]); let best = null;
    for (const [j, which] of cands) {
      const lj = which === 's' ? bigRoads[j].line : bigRoads[j].line.slice().reverse();
      const d1 = unit(lj[0], lj[1]), dp = d0[0] * d1[0] + d0[1] * d1[1];
      if (dp > 0.8 && (!best || dp > best.dp)) best = { j, lj, dp, nodeEnd: which === 's' ? bigRoads[j].nodes[bigRoads[j].nodes.length - 1] : bigRoads[j].nodes[0] };
    }
    if (!best) break; used.add(best.j); line = line.concat(best.lj.slice(1)); endNode = best.nodeEnd;
  }
  chains.push(line);
}
const chainLen = c => c.reduce((s, p, i) => s + (i ? dist(c[i - 1], p) : 0), 0);
const tours = chains.map(c => c.filter(p => inMap(p[0], p[1], -20))).filter(c => c.length > 3).sort((a, b) => chainLen(b) - chainLen(a)).slice(0, 5)
  .map(c => resample(c, 3).flatMap(p => [+p[0].toFixed(2), +H(p[0], p[1]).toFixed(2), +p[1].toFixed(2)]));
console.log('tour chains', tours.map(t => Math.round(t.length / 3 * 3) + 'm'));

// pedestrian ways + crossings
for (const p of pedWays) {
  if (!p.line.some(q => inMap(q[0], q[1], 40))) continue;
  const w = PED[p.kind];
  if (p.kind === 'pedestrian') ribbon(p.line, -w / 2, w / 2, 'plaza', 0.07, 'world');
  else ribbon(p.line, -w / 2, w / 2, 'sidewalk', 0.075, 'across', { vScale: 1 });
}
for (const c of crossings) {
  if (!c.line.some(q => inMap(q[0], q[1], 40))) continue;
  ribbon(c.line, -1.6, 1.6, 'crossing', 0.135, 'across', { vScale: 1 });
}
// rivers / canals
for (const w of waterLines) ribbon(w.line, -w.w / 2, w.w / 2, 'water', 0.1, 'world', { step: 6 });

// ------------------------------------------------------------------ areas
for (const a of areas) {
  if (!a.outer.some(q => inMap(q[0], q[1], 60))) continue;
  const yo = { grass: 0.035, plaza: 0.05, lot: 0.085, dirt: 0.03, water: 0.04 }[a.kind];
  addArea(a.kind === 'lot' ? 'asphalt' : a.kind === 'dirt' ? 'dirt' : a.kind, a.outer, a.holes, yo);
}

// ------------------------------------------------------------------ buildings
const NEON = [[255, 40, 170], [30, 220, 255], [255, 170, 30], [150, 70, 255], [255, 60, 60], [120, 255, 90], [255, 255, 255]];
const PAL = {
  panel: [[0.78, 0.68, 0.56], [0.70, 0.66, 0.62], [0.82, 0.76, 0.66], [0.64, 0.60, 0.58], [0.72, 0.58, 0.50], [0.85, 0.80, 0.72], [0.60, 0.64, 0.68]],
  tuff: [[0.88, 0.62, 0.48], [0.84, 0.56, 0.42], [0.92, 0.68, 0.46], [0.90, 0.78, 0.54], [0.80, 0.78, 0.72], [0.88, 0.62, 0.48], [0.46, 0.45, 0.47]], // pink/orange/yellow tuff, ivory, rare basalt
  house: [[0.90, 0.84, 0.72], [0.80, 0.86, 0.80], [0.92, 0.78, 0.70], [0.78, 0.82, 0.90], [0.93, 0.91, 0.86], [0.86, 0.72, 0.60]],
  modern: [[0.86, 0.90, 1.0], [0.75, 0.82, 0.95], [0.92, 0.90, 0.86]],
};
const WIN = { panel: { x0: 0.234, x1: 0.766, y0: 0.203, y1: 0.828 }, tuff: { x0: 0.297, x1: 0.703, y0: 0.219, y1: 0.8125 }, house: { x0: 0.344, x1: 0.656, y0: 0.3125, y1: 0.75 } };
const STYLE = {
  panel: { mat: 'facade', bayW: 3.5, floorH: 3.2, tw: 28 }, tuff: { mat: 'facade_tuff', bayW: 4.0, floorH: 3.8, tw: 32 },
  modern: { mat: 'facade_modern', bayW: 3.0, floorH: 3.6, tw: 24 }, house: { mat: 'facade_house', bayW: 3.2, floorH: 3.0, tw: 25.6 },
};
// real aerial photo -> roof colour / roof-type hints
let aer = null;
if (fs.existsSync('public/map/aerial.webp')) { const { data, info } = await sharp('public/map/aerial.webp').removeAlpha().raw().toBuffer({ resolveWithObject: true }); aer = { data, w: info.width, h: info.height }; }
const aerAt = (x, z) => { if (!aer) return [90, 90, 95]; const px = Math.min(aer.w - 1, Math.max(0, Math.floor((x - OX0) / (2 * NEAR.half) * aer.w))), py = Math.min(aer.h - 1, Math.max(0, Math.floor((z - OZ0) / (2 * NEAR.half) * aer.h))), i = (py * aer.w + px) * 3; return [aer.data[i], aer.data[i + 1], aer.data[i + 2]]; };
function roofSample(outer, rng) {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity; for (const p of outer) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
  const acc = [0, 0, 0]; let n = 0;
  for (let k = 0; k < 40 && n < 9; k++) { const x = minx + rng() * (maxx - minx), z = minz + rng() * (maxz - minz); if (!pip([x, z], outer)) continue; const c = aerAt(x, z); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
  return n ? acc.map(v => v / n) : [90, 90, 95];
}
// bounding rectangle along the longest edge direction
function boundingRect(outer) {
  let best = [1, 0], ld = 0; for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length], l = dist(a, b); if (l > ld) { ld = l; best = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } }
  const ex = best, ez = [-best[1], best[0]]; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of outer) { const u = p[0] * ex[0] + p[1] * ex[1], v = p[0] * ez[0] + p[1] * ez[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return { ex, ez, u0, u1, v0, v1, area: (u1 - u0) * (v1 - v0) };
}
const partCentroids = parts.map(p => { const c = p.outer.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]); return [c[0] / p.outer.length, c[1] / p.outer.length]; });
let bCount = 0, neonCount = 0, hipCount = 0; const neonMeta = []; const styleCount = {};
const PLAIN = /^(garage|garages|shed|roof|kiosk|carport|service|hut|container|greenhouse|construction|ruins)$/;
function addBuilding(bd, isPart) {
  const t = bd.t;
  let outer = bd.outer.slice(); if (outer.length < 3) return;
  if (!outer.some(p => inMap(p[0], p[1], 20))) return;
  if (signedArea(outer) < 0) outer.reverse();
  const holes = bd.holes.map(h => { const hh = h.slice(); if (signedArea(hh) > 0) hh.reverse(); return hh; });
  const area = Math.abs(signedArea(outer));
  if (area < 6) return;
  const rng = mkRng(bd.id);
  const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length, cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
  const centerDist = Math.hypot(cx, cz);
  let minG = Infinity; for (const p of outer) minG = Math.min(minG, H(p[0], p[1]));
  const plain = PLAIN.test(t.building || '');
  let height = num(t.height) ?? null, levels = num(t['building:levels']);
  if (height == null) {
    if (levels == null) levels = plain ? 1 : area < 50 ? 1 : area < 160 ? 2 + Math.floor(rng() * 2) : centerDist < 900 ? 4 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 4);
    height = levels * 3.2 + (t['roof:levels'] ? 1.5 : 0.4);
  }
  height = Math.max(2.6, height);
  levels = Math.max(1, Math.round(height / 3.3));
  const minH = num(t.min_height) ?? (num(t['building:min_level']) ? num(t['building:min_level']) * 3.2 : 0);
  const top = minG + height;
  if (!isPart) collB.push({ r: outer.flatMap(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), a: +(minG - 1.5).toFixed(2), b: +top.toFixed(2) });
  const startYear = num(t.start_date);
  const special = (t.name || '').match(/կառավարություն|Կառավարական|գրասենյակ|պատկերասրահ|թանգարան|թատրոն|Post|Marriott|Government|museum|Museum|Gallery|Bank|Բանկ/);
  // roof colour from the photo -> pitched (red tile) detection
  const rc = roofSample(outer, rng), redness = rc[0] / ((rc[1] + rc[2]) / 2 + 1);
  const rect = boundingRect(outer), rectness = area / rect.area, shortSide = Math.min(rect.u1 - rect.u0, rect.v1 - rect.v0);
  // ---- facade style
  let style;
  const bt = t.building || 'yes';
  if (plain || ((levels <= 2 || (area < 130 && levels <= 3)) && centerDist > 250 && !special) || /^(house|detached|semidetached_house|bungalow|farm|cabin)$/.test(bt)) style = 'house';
  else if (height >= 38 || (/^(office|hotel|commercial)$/.test(bt) && levels >= 9) || t['building:material'] === 'glass') style = 'modern';
  else if (special || (startYear && startYear < 1965) || (centerDist < 950 && levels >= 3 && levels <= 9 && rng() < 0.72) || (levels <= 7 && rng() < 0.18)) style = 'tuff';
  else style = 'panel';
  const S = STYLE[style]; styleCount[style] = (styleCount[style] ?? 0) + 1;
  const pal = PAL[style][Math.floor(rng() * PAL[style].length)], br = 0.85 + rng() * 0.3;
  const litF = style === 'modern' ? 0.3 + rng() * 0.5 : 0.6 + rng() * 0.4;
  const wallCol = [pal[0] * br * 255, pal[1] * br * 255, pal[2] * br * 255, litF * 255].map(Math.round);
  const wallOpaque = [wallCol[0], wallCol[1], wallCol[2], 255];
  const roofCol = [rc[0] * 0.5, rc[1] * 0.5, rc[2] * 0.5, 255].map(Math.round);
  const u0 = Math.floor(rng() * 8) * S.bayW, shopRoll = rng();
  const hasShop = !isPart && !plain && height > 5.5 && shopRoll < (style === 'tuff' ? 0.62 : style === 'modern' ? 0.7 : 0.45) && minH === 0 && style !== 'house';
  const floorM = S.floorH, vk = levels * floorM / height;
  // ---- roof type
  const hip = !isPart && minH === 0 && (style === 'house' || levels <= 3) && rectness > 0.78 && shortSide >= 3.5 && shortSide <= 16 && holes.length === 0 && (redness > 1.14 || (style === 'house' && rng() < 0.3));
  const flatRoof = !hip;
  const cornice = flatRoof && style === 'tuff' && levels >= 3 && !plain, parapet = flatRoof && !plain && (levels >= 3 || style === 'modern');
  const pin = cornice ? 0.35 : 0.0, parH = style === 'tuff' ? 0.5 : 0.7;
  const rings = [outer, ...holes];
  let u = u0;
  for (const ring of rings) {
    const nR = ring.length;
    for (let i = 0; i < nR; i++) {
      const a = ring[i], b = ring[(i + 1) % nR], L = dist(a, b); if (L < 0.3) continue;
      const ox = (b[1] - a[1]) / L, oz = -(b[0] - a[0]) / L; // outward normal (xz)
      const n = [ox, 0, oz];
      const bays = Math.max(1, Math.round(L / S.bayW)), du = bays * S.bayW;
      const ya = H(a[0], a[1]), yb = H(b[0], b[1]);
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const shopEdge = hasShop && L >= 5 && (ya - minG) < 3 && (yb - minG) < 3;
      const bA = minH > 0 ? minG + minH : ya - 0.7, bB = minH > 0 ? minG + minH : yb - 0.7;
      let sA = bA, sB = bB;
      if (shopEdge) {
        const sh = 3.8, bl = B('shop', mx, mz);
        const A = [a[0], ya - 0.2, a[1]], Bp = [b[0], yb - 0.2, b[1]], C = [b[0], yb + sh, b[1]], D = [a[0], ya + sh, a[1]];
        quad(bl, A, Bp, C, D, n, [u, 0], [u + du, 0], [u + du, sh], [u, sh], wallCol);
        sA = ya + sh; sB = yb + sh;
        if (L >= 6 && rng() < 0.32) {
          const nr = nearestRoad(mx + ox * 6, mz + oz * 6, 30);
          if (nr.d < 26) {
            const c = NEON[Math.floor(rng() * NEON.length)], sl = Math.min(L * 0.7, 12), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
            const y0 = (ya + yb) / 2 + 3.9, y1 = y0 + 0.5, off = 0.08;
            const p0 = [mx - ux * sl / 2 + ox * off, y0, mz - uz * sl / 2 + oz * off], p1 = [mx + ux * sl / 2 + ox * off, y0, mz + uz * sl / 2 + oz * off];
            quad(B('neon', mx, mz), p0, p1, [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], n, [0, 0], [1, 0], [1, 1], [0, 1], [...c, 255]);
            neonCount++; neonMeta.push(+(mx + ox * 0.6).toFixed(2), +((ya + yb) / 2).toFixed(2), +(mz + oz * 0.6).toFixed(2), +ox.toFixed(3), +oz.toFixed(3), c[0], c[1], c[2]);
          }
        }
      }
      const bl = B(S.mat, mx, mz);
      const A = [a[0], sA, a[1]], Bp = [b[0], sB, b[1]], C = [b[0], top, b[1]], D = [a[0], top, a[1]];
      const vA = (sA - minG) * vk, vB = (sB - minG) * vk, vT = height * vk;
      quad(bl, A, Bp, C, D, n, [u, vA], [u + du, vB], [u + du, vT], [u, vT], wallCol);

      // ---- real 3D relief around the windows of street-facing walls: sills, lintels, balconies (separate 'trim' mesh -> hidden on the low preset)
      if ((style === 'tuff' || style === 'panel' || style === 'house') && !plain && L >= 5 && centerDist < 900 && minH === 0 && WIN[style]) {
        const nrd = nearestRoad(mx + ox * 6, mz + oz * 6, 30);
        if (nrd.d < 15 && centerDist < 650) {
          const W = WIN[style], fh = height / levels, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, tb = B('trim', mx, mz), col = wallOpaque, sill = col.map((v, i) => i < 3 ? v * 0.92 : v);
          const bayL = L / bays, baseY = Math.max(ya, yb) + (shopEdge ? 0.2 : 0.5);
          const P = (s, y, off) => [a[0] + ux * s + ox * off, y, a[1] + uz * s + oz * off];
          const box = (s0, s1, y0, y1, d, c, withTop = true) => {   // only the faces a street-level viewer can see
            const uv = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]], q = uv(s1 - s0, y1 - y0), qd = uv(s1 - s0, d);
            quad(tb, P(s0, y0, d), P(s1, y0, d), P(s1, y1, d), P(s0, y1, d), n, q[0], q[1], q[2], q[3], c);
            quad(tb, P(s0, y0, d), P(s1, y0, d), P(s1, y0, 0), P(s0, y0, 0), [0, -1, 0], qd[0], qd[1], qd[2], qd[3], c.map((v, i) => i < 3 ? v * 0.7 : v));
            if (withTop) quad(tb, P(s0, y1, 0), P(s1, y1, 0), P(s1, y1, d), P(s0, y1, d), [0, 1, 0], qd[0], qd[1], qd[2], qd[3], c);
          };
          const f0 = Math.max(0, Math.ceil((baseY - minG - W.y0 * fh) / fh)), f1 = Math.min(levels - 1, f0 + (style === 'house' ? 0 : 1));
          for (let f = f0; f <= f1; f++) {
            const fy = minG + f * fh;
            for (let bi = 0; bi < bays; bi++) {
              const s0 = (bi + W.x0) * bayL, s1 = (bi + W.x1) * bayL, wy0 = fy + W.y0 * fh, wy1 = fy + W.y1 * fh;
              box(s0 - 0.12, s1 + 0.12, wy0 - 0.14, wy0, 0.17, sill);                                // sill
              box(s0 - 0.08, s1 + 0.08, wy1, wy1 + (style === 'tuff' ? 0.2 : 0.12), 0.12, col, false);       // lintel / hood
              if (style === 'panel' && f >= 1 && bi % 3 === 1) box(s0 - 0.35, s1 + 0.35, fy + 0.04, fy + 0.2, 1.05, sill, false);   // balcony slab
            }
          }
        }
      }
      u += du;
      // ---- cornice / parapet (flat roofs): concrete-material bands with the wall tint
      if ((cornice || parapet) && L >= 2.5) {
        const wb = B('wall', mx, mz), uvq = (l, h) => [[0, 0], [l, 0], [l, h], [0, h]];
        const P = (px, pz, y, o) => [px + ox * o, y, pz + oz * o];
        if (cornice) {
          const co = 0.4, cy0 = top - 0.9, tint = wallOpaque;
          let q = uvq(L, 0.9); quad(wb, P(a[0], a[1], cy0, co), P(b[0], b[1], cy0, co), P(b[0], b[1], top, co), P(a[0], a[1], top, co), n, q[0], q[1], q[2], q[3], tint);     // front
          q = uvq(L, co); quad(wb, P(a[0], a[1], cy0, 0), P(b[0], b[1], cy0, 0), P(b[0], b[1], cy0, co), P(a[0], a[1], cy0, co), [0, -1, 0], q[0], q[1], q[2], q[3], tint.map(v => v * 0.7)); // soffit
          q = uvq(L, co - pin); quad(wb, P(a[0], a[1], top, co), P(b[0], b[1], top, co), P(b[0], b[1], top, pin), P(a[0], a[1], top, pin), [0, 1, 0], q[0], q[1], q[2], q[3], tint);  // top
        }
        if (parapet) {
          const y1 = top + parH, thick = 0.22, tint = wallOpaque, q = uvq(L, parH);
          quad(wb, P(a[0], a[1], top, -pin), P(b[0], b[1], top, -pin), P(b[0], b[1], y1, -pin), P(a[0], a[1], y1, -pin), n, q[0], q[1], q[2], q[3], tint);                                   // outer face
          quad(wb, P(a[0], a[1], top, -pin - thick), P(b[0], b[1], top, -pin - thick), P(b[0], b[1], y1, -pin - thick), P(a[0], a[1], y1, -pin - thick), [-ox, 0, -oz], q[0], q[1], q[2], q[3], tint.map(v => v * 0.6)); // inner face
          const q2 = uvq(L, thick); quad(wb, P(a[0], a[1], y1, -pin), P(b[0], b[1], y1, -pin), P(b[0], b[1], y1, -pin - thick), P(a[0], a[1], y1, -pin - thick), [0, 1, 0], q2[0], q2[1], q2[2], q2[3], tint);   // cap
        }
      }
    }
  }
  const rb = B('roof', cx, cz);
  if (hip) {
    // hipped tile roof over the bounding rectangle
    const { ex, ez, u0: ua, u1: ub, v0: va, v1: vb } = rect, ov = 0.35, hl = (ub - ua) / 2 + ov, hw = (vb - va) / 2 + ov;
    const mu = (ua + ub) / 2, mv = (va + vb) / 2, ccx = mu * ex[0] + mv * ez[0], ccz = mu * ex[1] + mv * ez[1];
    const long = hl >= hw, rh = Math.min(3.4, Math.min(hl, hw) * 0.6);
    const A1 = long ? ex : ez, A2 = long ? ez : ex, Lh = long ? hl : hw, Wh = long ? hw : hl;
    const rlen = Math.max(0, Lh - Wh * 0.85);
    const pt = (l, w, y) => [ccx + A1[0] * l + A2[0] * w, y, ccz + A1[1] * l + A2[1] * w];
    const e0 = pt(-Lh, -Wh, top), e1 = pt(Lh, -Wh, top), e2 = pt(Lh, Wh, top), e3 = pt(-Lh, Wh, top), r0 = pt(-rlen, 0, top + rh), r1 = pt(rlen, 0, top + rh);
    const uvXZ = p => [p[0], p[2]];
    const addTri = (p0, p1, p2) => { const g = cross(sub(p1, p0), sub(p2, p0)); const l = Math.hypot(...g) || 1; let nn = g.map(v => v / l); if (nn[1] < 0) nn = nn.map(v => -v); tri(rb, p0, p1, p2, nn, uvXZ(p0), uvXZ(p1), uvXZ(p2), roofCol); };
    addTri(e0, e1, r1); addTri(e0, r1, r0);
    addTri(e2, e3, r0); addTri(e2, r0, r1);
    addTri(e3, e0, r0); addTri(e1, e2, r1);
    hipCount++;
  } else {
    const flat = [], hi = []; outer.forEach(p => flat.push(p[0], p[1])); for (const h of holes) { hi.push(flat.length / 2); h.forEach(p => flat.push(p[0], p[1])); }
    const ids = earcut(flat, hi, 2);
    for (let k = 0; k < ids.length; k += 3) {
      const P = i => [flat[i * 2], top, flat[i * 2 + 1]];
      tri(rb, P(ids[k]), P(ids[k + 1]), P(ids[k + 2]), [0, 1, 0], [flat[ids[k] * 2], flat[ids[k] * 2 + 1]], [flat[ids[k + 1] * 2], flat[ids[k + 1] * 2 + 1]], [flat[ids[k + 2] * 2], flat[ids[k + 2] * 2 + 1]], roofCol);
    }
    // rooftop clutter: stairwell block / antenna
    if (!isPart && !plain && area > 90 && rng() < 0.55) {
      const sx = 1.4 + rng() * 2.0, sz = 1.4 + rng() * 2.0, hx = cx + (rng() - 0.5) * Math.sqrt(area) * 0.3, hz = cz + (rng() - 0.5) * Math.sqrt(area) * 0.3;
      if (pip([hx, hz], outer) && pip([hx + sx, hz + sz], outer) && pip([hx - sx, hz - sz], outer)) {
        const y1 = top + parH + 1.6 + rng() * 1.2, c = [78, 76, 80, 255], yb0 = top;
        const pts4 = [[hx - sx, hz - sz], [hx + sx, hz - sz], [hx + sx, hz + sz], [hx - sx, hz + sz]];
        for (let k = 0; k < 4; k++) { const a = pts4[k], b = pts4[(k + 1) % 4], d = dist(a, b), nn = [(b[1] - a[1]) / d, 0, -(b[0] - a[0]) / d]; quad(rb, [a[0], yb0, a[1]], [b[0], yb0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], nn, [0, 0], [1, 0], [1, 1], [0, 1], c); }
        quad(rb, [pts4[0][0], y1, pts4[0][1]], [pts4[1][0], y1, pts4[1][1]], [pts4[2][0], y1, pts4[2][1]], [pts4[3][0], y1, pts4[3][1]], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], c);
        if (rng() < 0.4) { const ax = hx + sx * 0.5, az = hz, ah = y1 + 4 + rng() * 5, w = 0.09; for (const nn of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) { const px = nn[2] !== 0 ? w : 0, pz = nn[0] !== 0 ? w : 0; quad(rb, [ax - px + nn[0] * w, y1, az - pz + nn[2] * w], [ax + px + nn[0] * w, y1, az + pz + nn[2] * w], [ax + px + nn[0] * w, ah, az + pz + nn[2] * w], [ax - px + nn[0] * w, ah, az - pz + nn[2] * w], nn, [0, 0], [1, 0], [1, 1], [0, 1], [30, 30, 34, 255]); } }
      }
    }
  }
  fillPoly(outer, occB);
  bCount++;
}
// Buildings replaced by hand-modelled landmarks: data/landmark-skip.json = { ids:[osm ids], circles:[[x,z,r],...] } (written by tools/build-landmarks.mjs)
const skip = fs.existsSync('data/landmark-skip.json') ? JSON.parse(fs.readFileSync('data/landmark-skip.json', 'utf8')) : { ids: [], circles: [] };
const skipIds = new Set(skip.ids ?? []);
const isSkipped = b => { if (skipIds.has(b.id)) return true; const c = b.outer.reduce((q, p) => [q[0] + p[0], q[1] + p[1]], [0, 0]); const cx = c[0] / b.outer.length, cz = c[1] / b.outer.length; return (skip.circles ?? []).some(([x, z, r]) => Math.hypot(cx - x, cz - z) < r); };
const partInside = bd => partCentroids.some(c => pip(c, bd.outer));
for (const b of buildingsRaw) if (!isSkipped(b) && !partInside(b)) addBuilding(b, false);
for (const p of parts) if (!isSkipped(p)) addBuilding({ ...p, id: p.id + 77 }, true);
for (const b of buildingsRaw) if (isSkipped(b) && b.outer.length >= 3 && b.outer.some(p => inMap(p[0], p[1], 20))) { let g = Infinity; for (const p of b.outer) g = Math.min(g, H(p[0], p[1])); collB.push({ r: b.outer.flatMap(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), a: +(g - 1.5).toFixed(2), b: +(g + 16).toFixed(2) }); }
console.log('buildings built', bCount, 'neon signs', neonCount, 'hipped roofs', hipCount, styleCount);

// baked contact-AO (building proximity), north-up, same extent as aerial.webp
{
  const raw = Buffer.alloc(ON * ON); for (let i = 0; i < raw.length; i++) raw[i] = occB[i] ? 255 : 0;
  await sharp(raw, { raw: { width: ON, height: ON, channels: 1 } }).blur(3.2).linear(1.7, 0).png().toFile('public/map/ao.png');
}
// ------------------------------------------------------------------ barriers (walls / fences)
for (const bw of barriers) {
  if (!bw.line.some(p => inMap(p[0], p[1], 20))) continue;
  const t = bw.t, hh = t.barrier === 'fence' ? 1.5 : t.barrier === 'retaining_wall' ? 1.2 : 2.0, th = 0.25;
  const line = resample(bw.line, 5), mat = t.barrier === 'fence' ? 'fence' : 'wall';
  collW.push({ l: line.flatMap(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), h: hh });
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], l = dist(a, b); if (l < 0.2) continue;
    const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l, nx = -dz, nz = dx;
    const ya = H(a[0], a[1]), yb = H(b[0], b[1]), bl = B(mat, a[0], a[1]);
    for (const s of [-1, 1]) {
      const A = [a[0] + nx * th / 2 * s, ya - 0.2, a[1] + nz * th / 2 * s], Bp = [b[0] + nx * th / 2 * s, yb - 0.2, b[1] + nz * th / 2 * s], C = [Bp[0], yb + hh, Bp[2]], D = [A[0], ya + hh, A[2]];
      quad(bl, A, Bp, C, D, [nx * s, 0, nz * s], [0, 0], [l, 0], [l, hh], [0, hh]);
    }
    const A = [a[0] - nx * th / 2, ya + hh, a[1] - nz * th / 2], Bp = [b[0] - nx * th / 2, yb + hh, b[1] - nz * th / 2], C = [b[0] + nx * th / 2, yb + hh, b[1] + nz * th / 2], D = [a[0] + nx * th / 2, ya + hh, a[1] + nz * th / 2];
    quad(bl, A, Bp, C, D, [0, 1, 0], [0, 0], [l, 0], [l, th], [0, th]);
  }
}

// ------------------------------------------------------------------ trees
const treeOut = [];
for (const [x, z] of trees) {
  if (!inMap(x, z, -4) || occAt(occB, x, z) || occAt(occR, x, z)) continue;
  treeOut.push(+x.toFixed(2), +H(x, z).toFixed(2), +z.toFixed(2), +(0.75 + hash(Math.floor(x * 10) * 7919 + Math.floor(z * 10)) * 0.7).toFixed(2));
}

// ------------------------------------------------------------------ level-0 tiles (public/tiles/0/<i>_<j>.glb)
fs.mkdirSync('public/map', { recursive: true });
let tris = 0, verts = 0, bytes = 0; const m0 = [], byTile = new Map();
for (const b of builders.values()) { if (!b.idx.length || b.ci < TI0 || b.ci >= TI1 || b.cj < TJ0 || b.cj >= TJ1) continue; const k = `${b.ci}_${b.cj}`; (byTile.get(k) ?? byTile.set(k, []).get(k)).push(b); tris += b.idx.length / 3; verts += b.n; }
fs.rmSync('public/tiles/0', { recursive: true, force: true });
for (const [k, bs] of byTile) {
  const [ci, cj] = k.split('_').map(Number); let mn = Infinity, mx = -Infinity;
  for (const b of bs) for (let q = 1; q < b.pos.length; q += 3) { mn = Math.min(mn, b.pos[q]); mx = Math.max(mx, b.pos[q]); }
  bytes += await writeGlb(`public/tiles/0/${k}.glb`, bs, { name: 't0_' + k }); m0.push([ci, cj, +mn.toFixed(1), +mx.toFixed(1)]);
}
fs.mkdirSync('public/tiles', { recursive: true }); fs.writeFileSync('public/tiles/m0.json', JSON.stringify(m0));
const cells = byTile;
fs.copyFileSync('data/height.bin', 'public/map/height.bin');
fs.writeFileSync('public/map/height.json', JSON.stringify({ N, STEP, R, base }));
const lampFlat = []; for (const l of lamps) lampFlat.push(+l[0].toFixed(2), +l[1].toFixed(2), +l[2].toFixed(2), +l[3].toFixed(3), +l[4].toFixed(3), l[5]);
const fountainFlat = fountains.filter(f => inMap(f[0], f[1])).flatMap(f => [+f[0].toFixed(2), +H(f[0], f[1]).toFixed(2), +f[1].toFixed(2)]);
// ------------------------------------------------------------------ named streets for the in-game teleport (J key): a point on the longest matching road inside the region
const PLACE_DEFS = [['Marshal Baghramyan Ave', /Baghramyan|Bagramyan|Բաղրամյան/i], ['Orbeli Brothers St', /Orbeli|Օրբելի/i], ['Barekamutyun', /Barekamutyun|Bareqamutyun|Բարեկամության/i], ['Komitas Ave', /Komitas|Կոմիտաս/i], ['Barekamutyun Metro', null, -1585, -2062]];      // Barekamutyun is only a metro station / bus stops in OSM: snap to the nearest road
const places = [];
for (const [label, re, fx, fz] of PLACE_DEFS) {
  let best = null;
  if (!re) {      // fixed coordinates -> nearest drivable road vertex
    let bd = 1e9;
    for (const e of elements) { if (e.type !== 'way' || !e.geometry || !/^(trunk|primary|secondary|tertiary|residential|unclassified)$/.test(e.tags?.highway ?? '')) continue; const line = pts(e.geometry); for (let i = 1; i < line.length - 1; i++) { const d = Math.hypot(line[i][0] - fx, line[i][1] - fz); if (d < bd) { bd = d; best = { len: 1, line, k: i }; } } }
  }
  else for (const e of elements) {
    if (e.type !== 'way' || !e.geometry || !e.tags?.highway || !/^(trunk|primary|secondary|tertiary|residential|unclassified|living_street)$/.test(e.tags.highway)) continue;
    if (!re.test((e.tags['name:en'] ?? '') + ' ' + (e.tags.name ?? ''))) continue;
    const line = pts(e.geometry).filter(p => inMap(p[0], p[1], -60)); if (line.length < 3) continue;
    let len = 0; for (let i = 1; i < line.length; i++) len += dist(line[i - 1], line[i]);
    if (!best || len > best.len) best = { len, line };
  }
  if (!best) { console.warn('place not found:', label); continue; }
  const k = best.k ?? Math.floor(best.line.length / 2), a = best.line[k - 1], b = best.line[k + 1] ?? best.line[k];
  places.push({ name: label, x: +best.line[k][0].toFixed(1), z: +best.line[k][1].toFixed(1), heading: +Math.atan2(b[0] - a[0], b[1] - a[1]).toFixed(3) });
}
console.log('places', places);

fs.writeFileSync('public/map/meta.json', JSON.stringify({
  places,
  center: CENTER, half: HALF, base, cell: CELL, extent: NEAR.half, near: NEAR, region: REGION, tile0: CELL,
  trees: treeOut, lamps: lampFlat, fountains: fountainFlat,
  neon: neonMeta, tours,
  signals: signals.filter(s => inMap(s[0], s[1])).flatMap(s => [+s[0].toFixed(2), +H(s[0], s[1]).toFixed(2), +s[1].toFixed(2)]),
}));
fs.writeFileSync('public/map/colliders.json', JSON.stringify({ buildings: collB, walls: collW }));
console.log(`colliders: ${collB.length} buildings, ${collW.length} walls`);
console.log(`L0 tiles: ${verts} verts, ${tris} tris, ${cells.size} tiles, ${(bytes / 1e6).toFixed(1)} MB; trees ${treeOut.length / 4}, lamps ${lamps.length}`);
