// Downloads OSM vector data (Overpass) + elevation (AWS Terrain Tiles, Terrarium encoding).
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { CENTER, HALF, FINE_R, bbox, project } from './config.mjs';

const UA = 'YerevanCityDrift/0.1 (hobby game map build)';
fs.mkdirSync('data', { recursive: true });

// ---------- OSM ----------
const b = bbox(60);
const bb = `${b.south},${b.west},${b.north},${b.east}`;
const query = `[out:json][timeout:180];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["building:part"](${bb});
  way["highway"](${bb});
  way["landuse"](${bb});
  way["leisure"](${bb});
  relation["leisure"](${bb});
  way["natural"](${bb});
  relation["natural"](${bb});
  way["waterway"](${bb});
  way["amenity"="fountain"](${bb});
  way["man_made"](${bb});
  way["barrier"~"wall|fence|retaining_wall"](${bb});
  node["natural"="tree"](${bb});
  node["highway"~"street_lamp|traffic_signals"](${bb});
  node["amenity"="fountain"](${bb});
  way["railway"~"rail|tram|light_rail"](${bb});
);
out geom;`;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass() {
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of MIRRORS) {
      try {
        console.log(`Overpass: ${url} (attempt ${attempt + 1})`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) { console.log('  ->', res.status); continue; }
        const text = await res.text();
        const json = JSON.parse(text);
        if (json.elements?.length) return json;
      } catch (e) { console.log('  ->', e.message); }
    }
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error('Overpass failed on all mirrors');
}

if (!fs.existsSync('data/osm.json')) {
  const json = await overpass();
  fs.writeFileSync('data/osm.json', JSON.stringify(json));
  console.log('OSM elements:', json.elements.length);
} else console.log('data/osm.json exists, skipping');

// ---------- Elevation (Terrarium z15) ----------
const Z = 15;
const n = 2 ** Z;
const lonToX = lon => (lon + 180) / 360 * n;
const latToY = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
const e = bbox(FINE_R - HALF + 200);
const x0 = Math.floor(lonToX(e.west)), x1 = Math.floor(lonToX(e.east));
const y0 = Math.floor(latToY(e.north)), y1 = Math.floor(latToY(e.south));
const tiles = {};
for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`tile ${url}: ${res.status}`);
  tiles[`${tx},${ty}`] = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  console.log('tile', tx, ty);
}
const sample = (lat, lon) => {          // bilinear over the tile mosaic, metres
  const fx = lonToX(lon), fy = latToY(lat);
  const px = (fx - Math.floor(fx)) * 256, py = (fy - Math.floor(fy)) * 256;
  const get = (gx, gy) => {
    const tx = Math.floor(fx) + Math.floor(gx / 256), ty = Math.floor(fy) + Math.floor(gy / 256);
    const t = tiles[`${tx},${ty}`]; if (!t) return 0;
    const ix = ((gx % 256) + 256) % 256, iy = ((gy % 256) + 256) % 256;
    const i = (iy * 256 + ix) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const ax = Math.floor(px - 0.5), ay = Math.floor(py - 0.5);
  const tx = px - 0.5 - ax, ty = py - 0.5 - ay;
  const v = (a, b) => get(ax + a, ay + b);
  return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
};

// Regular grid in local metres, 5 m spacing, covering the map + margin.
const STEP = 5, R = FINE_R, N = Math.round(2 * R / STEP) + 1;
const MPL = 110946, MPLON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
const grid = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = -R + i * STEP, z = -R + j * STEP;
  grid[j * N + i] = sample(CENTER.lat - z / MPL, CENTER.lon + x / MPLON);
}
// light smoothing (box blur x2) - terrain tiles carry building/vegetation noise & DEM stair-steps
for (let pass = 0; pass < 2; pass++) {
  const src = grid.slice();
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += src[(j + dj) * N + i + di];
    grid[j * N + i] = s / 9;
  }
}
const [cx, cz] = project(CENTER.lat, CENTER.lon);
const base = grid[Math.round(R / STEP) * N + Math.round(R / STEP)];
let min = Infinity, max = -Infinity; for (const v of grid) { min = Math.min(min, v); max = Math.max(max, v); }
fs.writeFileSync('data/height.bin', Buffer.from(grid.buffer));
fs.writeFileSync('data/height.json', JSON.stringify({ N, STEP, R, base, min, max }));
console.log(`height grid ${N}x${N}, base(center)=${base.toFixed(1)}m, range ${min.toFixed(1)}..${max.toFixed(1)}m`);
