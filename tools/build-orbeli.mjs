// Data for Orbeli Brothers St + Komitas Ave (hand-modelled BISA strip + every block along both streets)  ->  public/map/orbeli.json
//   strip  : the 104 m x 20 m OSM block (way 82662788) as an origin B on the street frontage, unit vectors u (along the frontage) and n (towards the road)
//   roads  : centre lines of Orbeli Brothers Street within R metres of the strip, for the utility poles and overhead wires
//   node tools/build-orbeli.mjs
import fs from 'node:fs';
import { project } from './config.mjs';

const osm = JSON.parse(fs.readFileSync('data/osm.json', 'utf8'));
const way = osm.elements.find(e => e.id === 82662788);
const r = way.geometry.map(g => project(g.lat, g.lon)).slice(0, -1);
// frontage = the long edge nearest to the road (the one whose outward normal points at it)
const road = osm.elements.find(e => e.id === 424592850).geometry.map(g => project(g.lat, g.lon));
let best = null;
for (let i = 0; i < r.length; i++) {
  const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 60) continue;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; let d = 1e9; for (const p of road) d = Math.min(d, Math.hypot(p[0] - mid[0], p[1] - mid[1]));
  if (!best || d < best.d) best = { a, b, L, d };
}
let { a, b, L } = best; let u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-u[1], u[0]];
// n must point from the building to the road
const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; let rp = road[0], rd = 1e9; for (const p of road) { const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]); if (d < rd) { rd = d; rp = p; } }
if ((rp[0] - mid[0]) * n[0] + (rp[1] - mid[1]) * n[1] < 0) { n = [-n[0], -n[1]]; }
// make u run so that (u, n) = local (x, z) of a rotation about Y: x -> (cos t, -sin t), z -> (sin t, cos t)  i.e. u = (n.z, -n.x)
u = [n[1], -n[0]];
// B = frontage end such that the strip spans s = 0..L along u
let B = a; if ((b[0] - a[0]) * u[0] + (b[1] - a[1]) * u[1] < 0) B = b;
// depth: distance of the opposite edge
let depth = 0; for (const p of r) depth = Math.max(depth, -((p[0] - B[0]) * n[0] + (p[1] - B[1]) * n[1]));
const c = [0, 0]; const roads = [];
const cx = B[0] + u[0] * L / 2, cz = B[1] + u[1] * L / 2;
for (const e of osm.elements) {
  if (e.type !== 'way' || !e.geometry || !e.tags?.highway || !/orbeli/i.test(e.tags['name:en'] || '')) continue;
  const pl = e.geometry.map(g => project(g.lat, g.lon)); const near = pl.filter(p => Math.hypot(p[0] - cx, p[1] - cz) < 330);
  if (near.length >= 2) roads.push(near.flatMap(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]));
}
// ---- every apartment block / tower / landmark along the WHOLE of Orbeli Brothers St (Kievyan -> Baghramyan) and Komitas Ave
//      (Hakob Hakobyan -> the L0 region edge), replaced at runtime by the procedural facade system (src/streets/facade.js).
//      Styles / colours / roofs follow the street survey in .scratch/streets-reference.md (OSM + Wikimedia Commons photos).
const shoelace = ring => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2;
const blocks = [], seen = new Set(), allRoads = [...roads];
const lineOf = e => e.geometry.map(g => project(g.lat, g.lon));
const XMAX = 1010;                                                  // REGION.x1 (tools/config.mjs): full-detail tiles end here
const H = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hsh = (n, k = 0) => { let x = Math.imul((n | 0) ^ (k * 0x9e3779b9), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const pick = (id, list) => list[Math.floor(hsh(id, 7) * list.length)];
// hand-identified buildings (research doc): style, palette, roof, extras
const SPECIAL = {
  49643711: { style: 'tower', pal: '#c8643c', band: '#e8dcc4', clock: 1, podium: 2, name: 'Komitas 15' },
  57872903: { style: 'market', pal: '#be9884', roof: 'flat', name: 'Komitas Market' },
  49194994: { style: 'glass', pal: '#6fae7a', band: '#d09a3a', name: 'Mergelyan Institute' },
  514941217: { style: 'ribbon', pal: '#9c7a5c', name: 'Mergelyan wing' }, 33168977: { style: 'ribbon', pal: '#9c7a5c', name: 'Mergelyan wing' },
  82681402: { style: 'slab', pal: '#8d6f66', slats: '#5a4636', name: 'Orbeli 8' },
  117960803: { style: 'tower', pal: '#8e817c', loggias: 1, name: 'Orbeli 10' },
  82681484: { style: 'stalin', pal: '#b9a197', pilasters: 1, roof: 'flat', gf: 'res', name: 'Institute of Physiology' },
  82681491: { style: 'school', pal: '#a5786a', band: '#e8dcc4', roof: 'flat', name: 'School No. 83' },
  117960873: { style: 'stalin', pal: '#b4613f', roof: 'hipped', gf: 'shops', name: 'Kievyan 10' },
  223145464: { style: 'stalin', pal: '#7e4a42', arches: 1, roof: 'flat', gf: 'shops', name: 'Kievyan 12' },
  796464186: { style: 'tower', pal: '#e6e1d6', topArch: 1, name: 'Orbeli 67/2' },
  82681523: { style: 'stalin', pal: '#8f6a68', roof: 'flat', gf: 'mixed', name: 'Orbeli 12' },
};
function selectBlocks(street, lines, { maxD = 75, malls = false, xmax = XMAX } = {}) {
  const nearestOnRoad = (x, z) => { let best = { d: 1e9, p: null }; for (const pl of lines) for (let i = 1; i < pl.length; i++) { const [ax, az] = pl[i - 1], [bx, bz] = pl[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz); if (d < best.d) best = { d, p: [px, pz] }; } return best; };
  for (const e of osm.elements) {
    if (e.type !== 'way' || !e.geometry || !e.tags?.building || e.id === 82662788 || seen.has(e.id)) continue;
    const t = e.tags, sp = SPECIAL[e.id];
    let lv = +t['building:levels'] || 0; const kind = t.building; if (!sp && /garage|construction|house|shed|roof|kiosk|hut|service/.test(kind)) continue;
    const ring = e.geometry.map(g => project(g.lat, g.lon)).slice(0, -1); if (ring.length < 3 || ring.length > (sp ? 40 : 24)) continue;
    const A = shoelace(ring), area = Math.abs(A);
    const isMall = malls && /retail|commercial|supermarket/.test(kind) && lv <= 3 && area >= 1500, isApt = (lv >= 4 || (lv >= 3 && area >= 600)) && area >= 150;
    if (!sp && !isMall && !isApt) continue;
    if (A < 0) ring.reverse();                                   // counter-clockwise in (x, z): outward normal of edge (dx, dz) is (dz, -dx)
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
    if (c[0] > xmax) continue;
    const nr = nearestOnRoad(c[0], c[1]); if (nr.d > (isMall ? 130 : sp ? 120 : maxD)) continue;
    const front = ring.map((p, i) => { const q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); if (L < 8) return 0; const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], n = nearestOnRoad(m[0], m[1]); if (n.d > 110 || n.d < 1) return 0; const vx = n.p[0] - m[0], vz = n.p[1] - m[1]; return (dz * vx - dx * vz) / (L * n.d) > 0.55 ? 1 : 0; });
    lv = Math.max(lv, sp ? 3 : 1);
    // ---- style from the survey
    let style, pal, roof = t['roof:shape'] === 'hipped' || t['roof:shape'] === 'gabled' ? 'hipped' : t['roof:shape'] === 'flat' ? 'flat' : null, gf;
    if (isMall && !sp) { style = 'mall'; pal = street === 'k' ? '#3a6fb0' : '#c9c4ba'; roof = 'flat'; gf = 'shops'; }
    else if (lv >= 9) { style = 'tower'; pal = pick(e.id, street === 'k' ? ['#9c8784', '#aba7a1', '#a39088', '#b2aead'] : ['#8e817c', '#a08c88', '#9c8784']); roof = 'flat'; gf = nr.d < 30 ? 'mixed' : 'res'; }
    else if (street === 'k') {                                  // Komitas: Stalin-era tuff, hipped sheet-metal roofs, continuous glass shopfronts
      style = 'stalin'; roof ??= lv <= 7 ? 'hipped' : 'flat'; gf = nr.d < 34 ? 'shops' : 'res';
      if (c[0] < -1490) pal = c[1] > -2520 + (c[0] + 1797) * -0.5 ? '#7d4c44' : '#9c8580';     // west boulevard: south row red-brown, north row mauve-beige
      else pal = pick(e.id, ['#8a7470', '#75625b', '#8a7470', '#7f6a64', '#c08a6a', '#b07a62']);
    } else {                                                    // Orbeli: red-mauve tuff Stalin / Khrushchev blocks, flat roofs, sparse shops
      style = 'stalin'; roof ??= 'flat'; gf = nr.d < 26 && hsh(e.id, 3) < 0.35 ? 'mixed' : 'res';
      pal = pick(e.id, ['#8f6a68', '#7a5555', '#a07a74', '#b08a86', '#8a6660']);
    }
    const b = { id: e.id, lv, ring: ring.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), front, street, style, pal: H(pal), roof, gf };
    if (sp) { const { pal: sPal, band, slats, name, ...rest } = sp; Object.assign(b, rest, { pal: H(sPal) }); if (band) b.band = H(band); if (slats) b.slats = H(slats); b.name = name; b.gf ??= gf ?? 'res'; b.roof ??= 'flat'; }
    if (isMall) b.style = 'mall';
    seen.add(e.id); blocks.push(b);
  }
}
const toLines = rs => rs.map(r => { const p = []; for (let i = 0; i < r.length; i += 2) p.push([r[i], r[i + 1]]); return p; });
const streetLines = re => { const out = []; for (const e of osm.elements) { if (e.type !== 'way' || !e.geometry || !e.tags?.highway) continue; if (!re.test(e.tags['name:en'] || '')) continue; out.push(lineOf(e)); } return out; };
const orbeliLines = streetLines(/orbeli/i), komitasLines = streetLines(/komitas avenue/i);
for (const l of komitasLines) allRoads.push(l.flatMap(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]));
selectBlocks('o', orbeliLines, { maxD: 70 });
selectBlocks('k', komitasLines, { maxD: 78, malls: true });
console.log('styles:', JSON.stringify(blocks.reduce((m, b) => (m[b.street + ':' + b.style] = (m[b.street + ':' + b.style] || 0) + 1, m), {})));
// zebra crossings (footway=crossing ways) that cross either street, and junction points (where other roads meet Orbeli: gaps in the retaining walls)
const near = (x, z, lines, d) => { for (const pl of lines) for (let i = 1; i < pl.length; i++) { const [ax, az] = pl[i - 1], [bx, bz] = pl[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); if (Math.hypot(x - ax - dx * t, z - az - dz * t) < d) return true; } return false; };
const crossings = [], junctions = [];
for (const e of osm.elements) {
  if (e.type !== 'way' || !e.geometry || !e.tags) continue;
  const pl = lineOf(e);
  if (e.tags.footway === 'crossing' && e.tags.tunnel !== 'yes' && pl.length >= 2) { const a = pl[0], b = pl[pl.length - 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (near(m[0], m[1], [...orbeliLines, ...komitasLines], 9)) crossings.push([a[0], a[1], b[0], b[1]].map(v => Math.round(v * 10) / 10)); }
  else if (e.tags.highway && !/orbeli/i.test(e.tags['name:en'] || '') && !/footway|path|steps|cycleway|crossing/.test(e.tags.highway)) for (const q of [pl[0], pl[pl.length - 1]]) if (near(q[0], q[1], orbeliLines, 14)) junctions.push(q.map(v => Math.round(v)));
}
console.log('crossings', crossings.length, 'junctions', junctions.length);
const out = { v: 2, blocks, crossings, junctions, strip: { B: B.map(v => Math.round(v * 100) / 100), u: u.map(v => Math.round(v * 1e5) / 1e5), n: n.map(v => Math.round(v * 1e5) / 1e5), len: Math.round(L * 100) / 100, depth: Math.round(depth * 100) / 100 }, roads: allRoads,
  komitas: komitasLines.map(l => l.flatMap(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])), orbeli: orbeliLines.map(l => l.flatMap(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])) };
fs.writeFileSync('public/map/orbeli.json', JSON.stringify(out));
fs.writeFileSync('data/orbeli-skip.json', JSON.stringify({ ids: blocks.map(b => b.id) }));   // merged into data/landmark-skip.json by tools/build-landmarks.mjs
console.log('blocks:', blocks.length, ' orbeli', blocks.filter(b => b.street === 'o').length, ' komitas', blocks.filter(b => b.street === 'k').length, ' special', blocks.filter(b => b.name).map(b => b.name).join(', '));
console.log(JSON.stringify(out.strip), 'road polylines', roads.length);
