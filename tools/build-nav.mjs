// Navigation + search data for the map UI / GPS navigator  ->  public/map/nav.json (+ public/map/nav_aerial.webp satellite basemap for the map)
//   road graph (drivable OSM ways, shared nodes, one-ways, classes), street / POI / house-number search index, building + park/water footprints.
//   node tools/build-nav.mjs
import fs from 'fs';
import sharp from 'sharp';
import { project, inRegion, REGION, NEAR, CENTER } from './config.mjs';

const osm = JSON.parse(fs.readFileSync('data/osm.json'));
const M = 150;                                           // keep data this far outside the drivable region (ways are cut there)
const dm = v => Math.round(v * 10);
const P = g => project(g.lat, g.lon);

// ---------------------------------------------------------------- Armenian -> Latin (for names without name:en and for addr:street, which is Armenian only)
const WORDS = [['փողոց', 'St'], ['պողոտա', 'Ave'], ['հրապարակ', 'Square'], ['նրբանցք', 'Lane'], ['փակուղի', 'Dead end'], ['խճուղի', 'Highway'], ['կամուրջ', 'Bridge'], ['պուրակ', 'Park'], ['այգի', 'Garden'], ['թաղամաս', 'District']];
const MAP = { ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't', ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh', ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz', ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch', պ: 'p', ջ: 'j', ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts', փ: 'p', ք: 'k', օ: 'o', ֆ: 'f', և: 'ev' };
function translit(s) {
  if (!s) return s;
  const out = s.split(/(\s+)/).map(word => {
    const lw = word.toLowerCase(); const hit = WORDS.find(w => lw === w[0]); if (hit) return hit[1];
    let r = '', low = lw.replace(/ու/g, 'u'); let first = true;
    for (const ch of low) { let m = MAP[ch]; if (m === undefined) m = /[Ա-֏]/.test(ch) ? '' : ch; if (first) { if (ch === 'ե') m = 'ye'; else if (ch === 'ո') m = 'vo'; } r += m; first = false; }
    return r ? r[0].toUpperCase() + r.slice(1) : r;
  });
  return out.join('');
}

// ---------------------------------------------------------------- names table
const names = [], nameKey = new Map();
function nameIdx(hy, tags) {
  if (!hy) return -1; let i = nameKey.get(hy);
  if (i === undefined) { i = names.length; nameKey.set(hy, i); names.push([hy, tags?.['name:en'] || null, tags?.['name:ru'] || null]); }
  else if (tags) { const n = names[i]; if (!n[1] && tags['name:en']) n[1] = tags['name:en']; if (!n[2] && tags['name:ru']) n[2] = tags['name:ru']; }
  return i;
}

// ---------------------------------------------------------------- road graph
const CLS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian'];
const clsOf = h => { const b = h.replace('_link', ''); return CLS.indexOf(b); };
const RENDER_ONLY = new Set(['pedestrian']);
const nodeIdx = new Map(), NX = [], NZ = [];
const ways = [];
const wayRaw = [];         // for the street index
for (const e of osm.elements) {
  if (e.type !== 'way' || !e.geometry || !e.nodes) continue;
  const t = e.tags || {}; const h = t.highway; if (!h) continue;
  const cls = clsOf(h); if (cls < 0) continue;
  if (h === 'pedestrian' && t.area === 'yes') continue;
  if (t.area === 'yes') continue;
  const svc = t.service;
  let flags = 0;
  if (RENDER_ONLY.has(h)) flags |= 2;
  if (cls === 8 && /^(parking_aisle|driveway|drive-through|emergency_access)$/.test(svc || '')) flags |= 4;       // routing avoids these unless it must
  if (/^(no|private)$/.test(t.access || '') && !/^(yes|destination|permissive)$/.test(t.motor_vehicle || '')) flags |= 2;
  if (t.motor_vehicle === 'no') flags |= 2;
  if (t.junction === 'roundabout') flags |= 1;
  if (h.endsWith('_link')) flags |= 8;
  let oneway = 0; const ow = t.oneway; if (ow === 'yes' || ow === '1' || ow === 'true' || t.junction === 'roundabout' || h === 'motorway') oneway = 1; else if (ow === '-1' || ow === 'reverse') oneway = -1;
  let ms = 0; if (t.maxspeed) { const v = parseFloat(t.maxspeed); if (v > 0) ms = Math.round(v); }
  const nm = nameIdx(t.name, t);
  // cut the polyline to the kept area
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const ids = run.map(([id, x, z]) => { let k = nodeIdx.get(id); if (k === undefined) { k = NX.length; nodeIdx.set(id, k); NX.push(dm(x)); NZ.push(dm(z)); } return k; });
      ways.push([cls, nm, oneway, flags, ms, ...ids]); wayRaw.push({ nm, cls, flags, ids, ref: t.ref });
    } run = [];
  };
  for (let i = 0; i < e.geometry.length; i++) { const [x, z] = P(e.geometry[i]); if (inRegion(x, z, M)) run.push([e.nodes[i], x, z]); else flush(); }
  flush();
}
// compact node table
const nodes = new Array(NX.length * 2); for (let i = 0; i < NX.length; i++) { nodes[i * 2] = NX[i]; nodes[i * 2 + 1] = NZ[i]; }

// ---------------------------------------------------------------- streets (one entry per connected component of same-name ways)
const streets = [];
{
  const byName = new Map();
  for (const w of wayRaw) { if (w.nm < 0 || w.cls === 9 && false) continue; (byName.get(w.nm) ?? byName.set(w.nm, []).get(w.nm)).push(w); }
  for (const [nm, list] of byName) {
    const par = list.map((_, i) => i); const find = i => par[i] === i ? i : (par[i] = find(par[i]));
    const owner = new Map();
    list.forEach((w, i) => { for (const n of w.ids) { const o = owner.get(n); if (o === undefined) owner.set(n, i); else par[find(i)] = find(o); } });
    const groups = new Map(); list.forEach((w, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)).push(w); });
    for (const g of groups.values()) {
      let sx = 0, sz = 0, c = 0, len = 0; const vs = [];
      for (const w of g) for (let k = 0; k < w.ids.length; k++) { const x = NX[w.ids[k]] / 10, z = NZ[w.ids[k]] / 10; sx += x; sz += z; c++; vs.push([x, z]); if (k) len += Math.hypot(x - NX[w.ids[k - 1]] / 10, z - NZ[w.ids[k - 1]] / 10); }
      sx /= c; sz /= c; let b = vs[0], bd = 1e18; for (const v of vs) { const d = (v[0] - sx) ** 2 + (v[1] - sz) ** 2; if (d < bd) { bd = d; b = v; } }
      if (len < 25 && g.every(w => w.cls >= 8)) continue;                    // tiny named alleys: noise
      streets.push([nm, Math.round(b[0]), Math.round(b[1]), Math.round(len), g[0].cls]);
    }
  }
}

// ---------------------------------------------------------------- POIs + addresses
const centroid = geom => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const g of geom) { const [x, z] = P(g); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [(x0 + x1) / 2, (z0 + z1) / 2]; };
const NOT_POI = new Set(['bench', 'waste_basket', 'parking_space', 'bicycle_parking', 'parking_entrance', 'shelter', 'recycling', 'vending_machine', 'post_box', 'toilets', 'drinking_water', 'clock', 'bbq', 'lounger', 'charging_station', 'fountain', 'telephone', 'atm']);
function catOf(t) {
  if (t.railway === 'station' || t.station === 'subway' || t.railway === 'subway_entrance') return 'metro';
  for (const k of ['amenity', 'tourism', 'historic', 'leisure', 'shop', 'office']) if (t[k] && t[k] !== 'yes' && !NOT_POI.has(t[k])) return k + ':' + t[k];
  if (t.shop === 'yes') return 'shop'; if (t.office === 'yes') return 'office';
  if (t.building && t.building !== 'yes' && t.name) return 'building:' + t.building;
  if (t.building && t.name) return 'building';
  if (t.public_transport === 'station') return 'station';
  if (t.man_made === 'tower' || t.man_made === 'monument') return 'man_made:' + t.man_made;
  return null;
}
const cats = [], catKey = new Map(); const catIdx = c => { let i = catKey.get(c); if (i === undefined) { i = cats.length; catKey.set(c, i); cats.push(c); } return i; };
const pois = [], addrByStreet = new Map(); let nAddr = 0;
const streetSeen = new Set();
for (const e of osm.elements) {
  const t = e.tags; if (!t) continue;
  if (t.highway) continue;
  let x, z;
  if (e.type === 'node') [x, z] = project(e.lat, e.lon);
  else if (e.geometry) [x, z] = centroid(e.geometry);
  else continue;
  if (!inRegion(x, z, M)) continue;
  const hn = t['addr:housenumber'], st = t['addr:street'];
  if (hn && st) {
    const si = nameIdx(st); let a = addrByStreet.get(si); if (!a) addrByStreet.set(si, a = []);
    a.push([String(hn), Math.round(x), Math.round(z), t.name ? nameIdx(t.name, t) : -1]); nAddr++;
  }
  if (!t.name) continue;
  const c = catOf(t); if (!c) continue;
  const key = t.name + '|' + Math.round(x / 30) + '|' + Math.round(z / 30); if (streetSeen.has(key)) continue; streetSeen.add(key);
  pois.push([nameIdx(t.name, t), catIdx(c), Math.round(x), Math.round(z), hn && st ? nameIdx(st) : -1, hn ? String(hn) : '']);
}
const addr = [...addrByStreet].map(([s, l]) => [s, l]);

// ---------------------------------------------------------------- footprints for the map (delta-encoded decimetres)
const ring = geom => { const out = []; let px = 0, pz = 0; for (let i = 0; i < geom.length - 1; i++) { const [x, z] = P(geom[i]); const X = dm(x), Z = dm(z); out.push(X - px, Z - pz); px = X; pz = Z; } return out; };
const buildings = [], areas = [];
const AREA = t => {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return 1;
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'pitch' || t.landuse === 'grass' || t.landuse === 'forest' || t.landuse === 'recreation_ground' || t.landuse === 'cemetery' || t.landuse === 'meadow' || t.landuse === 'orchard' || t.natural === 'wood' || t.natural === 'scrub' || t.natural === 'grassland' || t.landuse === 'village_green') return 0;
  return -1;
};
for (const e of osm.elements) {
  if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue; const t = e.tags || {};
  const g = e.geometry; const closed = g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon; if (!closed) continue;
  const [cx, cz] = centroid(g); if (!inRegion(cx, cz, M)) continue;
  if (t.building) buildings.push(ring(g));
  else { const a = AREA(t); if (a >= 0) areas.push([a, ...ring(g)]); }
}

// ---------------------------------------------------------------- write
const out = { v: 1, region: REGION, center: CENTER, nodes, ways, names, cats, streets, pois, addr, buildings, areas };
fs.writeFileSync('public/map/nav.json', JSON.stringify(out));
const mb = f => (fs.statSync(f).size / 1e6).toFixed(2) + ' MB';
console.log(`nav.json ${mb('public/map/nav.json')}: ${NX.length} nodes, ${ways.length} ways, ${names.length} names, ${streets.length} streets, ${pois.length} POIs, ${nAddr} addresses, ${buildings.length} buildings, ${areas.length} areas`);

// satellite basemap for the map UI: the near-field aerial mosaic (4096 px over 2*NEAR.half) at half resolution
await sharp('public/map/aerial.webp').resize(2048, 2048).webp({ quality: 74 }).toFile('public/map/nav_aerial.webp');
console.log('nav_aerial.webp', mb('public/map/nav_aerial.webp'));
