// Landmark data builder.  `node tools/build-landmarks.mjs`
//  1. extracts the OSM footprints of the hand-modelled landmarks (+ outlines of neighbouring buildings, used to hide party walls)
//     -> public/map/lm/footprints.json   (read at runtime by src/landmarks.js, which generates the geometry procedurally)
//  2. writes data/landmark-skip.json so tools/build-map.mjs does not extrude generic boxes for the replaced buildings.
// Then regenerate the base map:  node tools/build-map.mjs && node tools/optimize.mjs
import fs from 'node:fs';
import { project } from './config.mjs';

const osm = JSON.parse(fs.readFileSync('data/osm.json', 'utf8'));

// ids of OSM buildings (ways / relations) that are replaced by hand-made models
const LANDMARK_IDS = {
  // Republic Square ensemble
  govHouse: [31664493, 482593803, 82681471, 1015255216],
  museum: [2983284, 1556397989, 1556397988],
  foreignMinistry: [31624091],
  marriott: [31854855, 1299235227, 1299235223],
  post: [531981199],
  // Opera House (Freedom Square, end of Northern Avenue) and Saint Gregory the Illuminator Cathedral
  opera: [1267677, 412870637],
  cathedral: [31622320],
};

const area = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const r1 = v => Math.round(v * 20) / 20;
function ringsOf(e) {
  if (e.type === 'way' && e.geometry) return [e.geometry.map(g => project(g.lat, g.lon)).slice(0, -1)];
  if (e.type === 'relation' && e.members) { const out = []; for (const m of e.members) if (m.geometry && m.role === 'outer') out.push(m.geometry.map(g => project(g.lat, g.lon)).slice(0, -1)); return out; }
  return [];
}
function simplify(ring, minLen = 0.45, angTol = 0.01) {
  const r = ring.slice(); let ch = true;
  while (ch && r.length > 3) { ch = false; for (let i = 0; i < r.length; i++) { const p = r[(i + r.length - 1) % r.length], c = r[i], n = r[(i + 1) % r.length]; const d1 = Math.hypot(c[0] - p[0], c[1] - p[1]), d2 = Math.hypot(n[0] - c[0], n[1] - c[1]); const cr = ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0])) / ((d1 * d2) || 1); if (d1 < minLen || Math.abs(cr) < angTol) { r.splice(i, 1); ch = true; break; } } }
  return r;
}
const mkh = t => { const h = parseFloat(t.height); if (h > 0) return h; const l = parseFloat(t['building:levels']); return (l > 0 ? l : 3) * 3.1; };

// Northern Avenue: every building >= 4 storeys within 34 m of the pedestrian boulevard (OSM ways 1181099232 .. 1181099210, x 150..199, z -267..-875)
const AV = [[150, -267], [154, -329], [160, -404], [161, -416], [163, -446], [168, -497], [175, -576], [177, -589], [178, -604], [178, -608], [184, -698], [185, -710], [186, -720], [186, -726], [188, -739], [189, -752], [193, -794], [195, -819], [196, -835], [199, -872]];
const dseg = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz); t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
const dav = p => Math.min(...AV.slice(1).map((b, i) => dseg(p, AV[i], b)));
const taken = new Set(Object.values(LANDMARK_IDS).flat());
LANDMARK_IDS.northern = [];
for (const e of osm.elements) {
  const t = e.tags || {}; if (!t.building || t['building:part'] || taken.has(e.id) || e.type !== 'way' || !e.geometry) continue;
  const lv = parseFloat(t['building:levels']) || 0; if (lv < 4) continue;
  const r = e.geometry.map(g => project(g.lat, g.lon)); if (Math.min(...r.map(dav)) < 34) LANDMARK_IDS.northern.push(e.id);
}
const wanted = new Set(Object.values(LANDMARK_IDS).flat());
const lm = {}, others = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (!(t.building || t['building:part'])) continue;
  const rings = ringsOf(e); if (!rings.length) continue;
  if (wanted.has(e.id)) {
    lm[e.id] = { rings: rings.map(r => { r = simplify(r); if (area(r) < 0) r.reverse(); return r.map(p => [r1(p[0]), r1(p[1])]); }), levels: +t['building:levels'] || 0, height: +t.height || 0, name: t['name:en'] || t.name || '' };
  }
  const r = rings[0]; const c = r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
  if (Math.hypot(c[0], c[1]) < 420 && !t['building:part']) others.push({ id: e.id, h: Math.round(mkh(t) * 10) / 10, r: simplify(r, 0.6).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) });
}
for (const id of wanted) if (!lm[id]) console.warn('landmark id not found in osm.json:', id);
fs.mkdirSync('public/map/lm', { recursive: true });
fs.writeFileSync('public/map/lm/footprints.json', JSON.stringify({ groups: LANDMARK_IDS, lm, others }));
const CIRCLES = []; // [x,z,r] areas where every generic building is suppressed (e.g. around a landmark that has no usable OSM outline)
const skip = { ids: [...wanted], circles: CIRCLES };
fs.writeFileSync('data/landmark-skip.json', JSON.stringify(skip));
console.log('landmarks:', Object.keys(lm).length, 'neighbour outlines:', others.length, 'skip ids:', skip.ids.length);
