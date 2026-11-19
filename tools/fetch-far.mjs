// Far-field data for the streaming world: OSM chunks (+-4.2 km), elevation (10 m +-4.4 km, 80 m +-17.6 km), imagery layers.
//   data/osm_far/<i>_<j>.json   height_mid.bin/json   height_far.bin/json   public/map/aerial_mid.webp (Esri z17)  public/map/aerial_far.webp (EOX Sentinel-2 cloudless, CC BY 4.0)
// Usage: node tools/fetch-far.mjs [osm|elev|imagery|all]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { CENTER } from './config.mjs';

const UA = 'YerevanCityDrift/0.1 (hobby game map build)';
const what = process.argv[2] ?? 'all';
const MPL = 110946, MPLON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('data/osm_far', { recursive: true }); fs.mkdirSync('data/tiles', { recursive: true });

// ------------------------------------------------------------------ OSM chunks
async function osm() {
  const R = 4200, N = 4, step = (2 * R) / N, MARGIN = 60;
  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (let cj = 0; cj < N; cj++) for (let ci = 0; ci < N; ci++) {
    const f = `data/osm_far/${ci}_${cj}.json`; if (fs.existsSync(f)) continue;
    const x0 = -R + ci * step - MARGIN, x1 = -R + (ci + 1) * step + MARGIN, z0 = -R + cj * step - MARGIN, z1 = -R + (cj + 1) * step + MARGIN; // z south
    const south = CENTER.lat - z1 / MPL, north = CENTER.lat - z0 / MPL, west = CENTER.lon + x0 / MPLON, east = CENTER.lon + x1 / MPLON;
    const bb = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
    const q = `[out:json][timeout:240];(
      way["building"](${bb}); relation["building"]["type"="multipolygon"](${bb});
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|pedestrian)$"](${bb});
      way["landuse"~"^(grass|forest|meadow|recreation_ground|cemetery|industrial|commercial|retail|residential|farmland|orchard|vineyard|quarry|construction|military)$"](${bb});
      way["leisure"~"^(park|garden|pitch|stadium|sports_centre|golf_course)$"](${bb});
      way["natural"~"^(water|wood|scrub|grassland|bare_rock|scree)$"](${bb}); relation["natural"="water"](${bb});
      way["waterway"~"^(river|canal)$"](${bb});
    );out geom qt;`;
    let done = false;
    for (let attempt = 0; attempt < 6 && !done; attempt++) for (const url of MIRRORS) {
      try {
        console.log(`osm chunk ${ci},${cj}: ${url} (attempt ${attempt + 1})`);
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(150000) });
        if (!r.ok) { console.log('  ->', r.status); continue; }
        const j = JSON.parse(await r.text()); if (!j.elements) continue;
        fs.writeFileSync(f, JSON.stringify(j)); console.log(`  ok ${j.elements.length} elements`); done = true; break;
      } catch (e) { console.log('  ->', e.message); }
      await sleep(4000);
    }
    if (!done) throw new Error('osm chunk failed ' + f);
    await sleep(2500);
  }
}

// ------------------------------------------------------------------ elevation (terrarium)
function mercator(z) { const n = 2 ** z; return { lonToX: lon => (lon + 180) / 360 * n, latToY: lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n }; }
async function elevGrid({ z, R, step, name }) {
  const { lonToX, latToY } = mercator(z);
  const ext = R + step * 4, west = CENTER.lon - ext / MPLON, east = CENTER.lon + ext / MPLON, north = CENTER.lat + ext / MPL, south = CENTER.lat - ext / MPL;
  const x0 = Math.floor(lonToX(west)), x1 = Math.floor(lonToX(east)), y0 = Math.floor(latToY(north)), y1 = Math.floor(latToY(south));
  const tiles = {};
  const jobs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let k = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < jobs.length) { const [x, y] = jobs[k++]; const f = `data/tiles/ter_${z}_${x}_${y}.png`; if (!fs.existsSync(f)) { for (let a = 0; a < 4; a++) { try { const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; } catch (e) { if (a === 3) throw e; await sleep(800 * (a + 1)); } } } tiles[`${x},${y}`] = PNG.sync.read(fs.readFileSync(f)); } }));
  const sample = (lat, lon) => {
    const fx = lonToX(lon), fy = latToY(lat), px = (fx - Math.floor(fx)) * 256, py = (fy - Math.floor(fy)) * 256;
    const get = (gx, gy) => { const tx = Math.floor(fx) + Math.floor(gx / 256), ty = Math.floor(fy) + Math.floor(gy / 256), t = tiles[`${tx},${ty}`]; if (!t) return 0; const ix = ((gx % 256) + 256) % 256, iy = ((gy % 256) + 256) % 256, i = (iy * 256 + ix) * 4; return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768; };
    const ax = Math.floor(px - 0.5), ay = Math.floor(py - 0.5), tx = px - 0.5 - ax, ty = py - 0.5 - ay, v = (a, b) => get(ax + a, ay + b);
    return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
  };
  const N = Math.round(2 * R / step) + 1, grid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) grid[j * N + i] = sample(CENTER.lat - (-R + j * step) / MPL, CENTER.lon + (-R + i * step) / MPLON);
  // same base elevation as the fine grid so heights agree (0 = Republic Square)
  const fine = JSON.parse(fs.readFileSync('data/height.json', 'utf8'));
  const base = sample(CENTER.lat, CENTER.lon);
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < grid.length; i++) { mn = Math.min(mn, grid[i]); mx = Math.max(mx, grid[i]); }
  fs.writeFileSync(`data/${name}.bin`, Buffer.from(grid.buffer)); fs.writeFileSync(`data/${name}.json`, JSON.stringify({ N, STEP: step, R, base, fineBase: fine.base, min: mn, max: mx }));
  console.log(`${name}: ${N}x${N} @${step} m, ${jobs.length} tiles, base ${base.toFixed(1)} (fine grid base ${fine.base.toFixed(1)}), range ${mn.toFixed(0)}..${mx.toFixed(0)}`);
}

// ------------------------------------------------------------------ imagery mosaic
async function imagery({ z, ext, out, size, url, label }) {
  const { lonToX, latToY } = mercator(z), n = 2 ** z, TILE = 256;
  const mpp = 40075016.686 * Math.cos(CENTER.lat * Math.PI / 180) / (n * TILE);
  const cx = lonToX(CENTER.lon) * TILE, cy = latToY(CENTER.lat) * TILE, half = ext / mpp;
  const x0 = Math.floor((cx - half) / TILE), x1 = Math.floor((cx + half) / TILE), y0 = Math.floor((cy - half) / TILE), y1 = Math.floor((cy + half) / TILE);
  console.log(`${label}: z${z} ${x1 - x0 + 1}x${y1 - y0 + 1} tiles @ ${mpp.toFixed(2)} m/px`);
  const jobs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let k = 0; const files = new Map();
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < jobs.length) { const [x, y] = jobs[k++]; const f = `data/tiles/${label}_${z}_${x}_${y}.jpg`; if (!fs.existsSync(f)) { for (let a = 0; a < 4; a++) { try { const r = await fetch(url(z, x, y), { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; } catch (e) { if (a === 3) throw e; await sleep(1000 * (a + 1)); } } } files.set(`${x},${y}`, f); } }));
  const mosaic = await sharp({ create: { width: (x1 - x0 + 1) * TILE, height: (y1 - y0 + 1) * TILE, channels: 3, background: '#202020' } }).composite(jobs.map(([x, y]) => ({ input: files.get(`${x},${y}`), left: (x - x0) * TILE, top: (y - y0) * TILE }))).png().toBuffer();
  const left = Math.round(cx - half - x0 * TILE), top = Math.round(cy - half - y0 * TILE), s = Math.round(half * 2);
  await sharp(mosaic).extract({ left, top, width: s, height: s }).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 82 }).toFile(out);
  console.log(out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
}

if (what === 'osm' || what === 'all') await osm();
if (what === 'elev' || what === 'all') { await elevGrid({ z: 15, R: 4400, step: 10, name: 'height_mid' }); await elevGrid({ z: 12, R: 17600, step: 80, name: 'height_far' }); }
if (what === 'imagery' || what === 'all') {
  await imagery({ z: 17, ext: 4400, out: 'public/map/aerial_mid.webp', size: 4096, label: 'esri', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` });
  await imagery({ z: 13, ext: 17600, out: 'public/map/aerial_far.webp', size: 2048, label: 'eox', url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg` });
}
console.log('done');
