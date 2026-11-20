// Downloads the fine-detail OSM layer (footways, service roads, barriers, trees, lamps, signals, building parts) for the extended free-drive region
// in ~1 km chunks; buildings / main roads / landuse come from data/osm_far (tools/fetch-far.mjs). Original header: Downloads full-detail OSM data for the extended free-drive region (tools/config.mjs REGION) in ~1 km chunks and merges it into data/osm.json.
//   data/osm_region_x/<i>_<j>.json   raw chunks (re-runnable: finished chunks are skipped)
//   data/osm_center.json           backup of the original 2 km x 2 km download
import fs from 'node:fs';
import { CENTER, REGION, project } from './config.mjs';

const UA = 'YerevanCityDrift/0.1 (hobby game map build)';
const MPL = 110946, MPLON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('data/osm_region_x', { recursive: true });
const M = 80, x0 = REGION.x0 - M, x1 = REGION.x1 + M, z0 = REGION.z0 - M, z1 = REGION.z1 + M;
const NX = Math.ceil((x1 - x0) / 1000), NZ = Math.ceil((z1 - z0) / 1000), sx = (x1 - x0) / NX, sz = (z1 - z0) / NZ;
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const f = `data/osm_region_x/${i}_${j}.json`; if (fs.existsSync(f)) continue;
  const ax = x0 + i * sx, bx = ax + sx, az = z0 + j * sz, bz = az + sz;
  const bb = [CENTER.lat - bz / MPL, CENTER.lon + ax / MPLON, CENTER.lat - az / MPL, CENTER.lon + bx / MPLON].map(v => v.toFixed(5)).join(',');
  const q = `[out:json][timeout:180];(
    way["highway"~"^(service|footway|path|pedestrian|steps|cycleway|track|living_street|busway)$"](${bb}); way["building:part"](${bb});
    way["amenity"="fountain"](${bb}); way["man_made"](${bb}); way["barrier"~"wall|fence|retaining_wall"](${bb});
    node["natural"="tree"](${bb}); node["highway"~"street_lamp|traffic_signals"](${bb}); node["amenity"="fountain"](${bb}); way["railway"~"rail|tram|light_rail"](${bb});
  );out geom;`;
  let done = false;
  for (let attempt = 0; attempt < 6 && !done; attempt++) for (const url of MIRRORS) {
    try {
      console.log(`chunk ${i},${j}: ${url} (attempt ${attempt + 1})`);
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(170000) });
      if (!r.ok) { console.log('  ->', r.status); continue; }
      const json = JSON.parse(await r.text()); if (!json.elements) continue;
      fs.writeFileSync(f, JSON.stringify(json)); console.log(`  ok ${json.elements.length} elements`); done = true; break;
    } catch (e) { console.log('  ->', e.message); }
    await sleep(4000);
  }
  if (!done) throw new Error('chunk failed ' + f);
  await sleep(2500);
}
// merge (dedupe by type+id)
if (!fs.existsSync('data/osm_center.json') && fs.existsSync('data/osm.json')) fs.copyFileSync('data/osm.json', 'data/osm_center.json');
const seen = new Set(), elements = [];
const srcs = [...(fs.existsSync('data/osm_center.json') ? ['data/osm_center.json'] : []), ...(fs.existsSync('data/osm_region/0_0.json') ? ['data/osm_region/0_0.json'] : []), ...fs.readdirSync('data/osm_far').filter(n => n.endsWith('.json')).map(n => 'data/osm_far/' + n)];
for (const f of srcs) for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).elements) { const k = e.type + e.id; if (seen.has(k)) continue; seen.add(k); elements.push(e); }
for (const f of fs.readdirSync('data/osm_region_x').filter(n => n.endsWith('.json'))) for (const e of JSON.parse(fs.readFileSync('data/osm_region_x/' + f, 'utf8')).elements) { const k = e.type + e.id; if (seen.has(k)) continue; seen.add(k); elements.push(e); }
fs.writeFileSync('data/osm.json', JSON.stringify({ version: 0.6, generator: 'fetch-region', elements }));
console.log('merged', elements.length, 'elements ->', 'data/osm.json');
