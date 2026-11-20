// Data for the hand-modelled stretch of Orbeli Brothers Street around BISA (6 Orbeli Brothers St)  ->  public/map/orbeli.json
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
const out = { strip: { B: B.map(v => Math.round(v * 100) / 100), u: u.map(v => Math.round(v * 1e5) / 1e5), n: n.map(v => Math.round(v * 1e5) / 1e5), len: Math.round(L * 100) / 100, depth: Math.round(depth * 100) / 100 }, roads };
fs.writeFileSync('public/map/orbeli.json', JSON.stringify(out));
console.log(JSON.stringify(out.strip), 'road polylines', roads.length);
