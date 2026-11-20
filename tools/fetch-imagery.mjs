// Builds public/map/aerial.webp: 4096x4096 aerial mosaic covering the whole terrain extent (+-EXT m), north-up, aligned with local x/z.
// SOURCE: Esri World Imagery z18 (~0.46 m/px). Dev/prototype use - check the provider's terms before shipping; swap TILE_URL for a licensed source (Mapbox, Maxar, local survey).
import fs from 'node:fs';
import sharp from 'sharp';
import { CENTER } from './config.mjs';
const [ARG_Z, ARG_EXT, ARG_FILE, ARG_CX, ARG_CZ] = process.argv.slice(2);   // optional window centre offset in local metres (x east, z south)
const Z = +(ARG_Z ?? 18), EXT = +(ARG_EXT ?? 1100), OUT = 4096, TILE = 256, FILE = ARG_FILE ?? 'public/map/aerial.webp';
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const n = 2 ** Z;
const fx = lon => (lon + 180) / 360 * n;
const fy = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
const mPerPx = 156543.03392 * Math.cos(CENTER.lat * Math.PI / 180) / n / (256 / 256) / 1; // metres per pixel at this latitude
const mpp = 40075016.686 * Math.cos(CENTER.lat * Math.PI / 180) / (n * TILE);
const cx = fx(CENTER.lon) * TILE + (+(ARG_CX ?? 0)) / mpp, cy = fy(CENTER.lat) * TILE + (+(ARG_CZ ?? 0)) / mpp;           // centre in mosaic pixels (global)
const half = EXT / mpp;                                                  // half-size in source pixels
const x0 = Math.floor((cx - half) / TILE), x1 = Math.floor((cx + half) / TILE), y0 = Math.floor((cy - half) / TILE), y1 = Math.floor((cy + half) / TILE);
const W = (x1 - x0 + 1) * TILE, Hh = (y1 - y0 + 1) * TILE;
console.log(`tiles ${(x1 - x0 + 1)}x${(y1 - y0 + 1)}, source ${mpp.toFixed(3)} m/px`);
fs.mkdirSync('data/tiles', { recursive: true });
const jobs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
const bufs = new Map();
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const [x, y] = jobs[i++], f = `data/tiles/${Z}_${x}_${y}.jpg`;
    if (!fs.existsSync(f)) {
      for (let a = 0; a < 4; a++) {
        try { const r = await fetch(TILE_URL(Z, x, y), { headers: { 'User-Agent': 'YerevanCityDrift/0.1 (hobby game map build)' } }); if (!r.ok) throw new Error(r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; }
        catch (e) { if (a === 3) throw e; await new Promise(r => setTimeout(r, 1000 * (a + 1))); }
      }
    }
    bufs.set(`${x},${y}`, f);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
const comp = jobs.map(([x, y]) => ({ input: bufs.get(`${x},${y}`), left: (x - x0) * TILE, top: (y - y0) * TILE }));
const mosaic = await sharp({ create: { width: W, height: Hh, channels: 3, background: '#202020' } }).composite(comp).png().toBuffer();
const left = Math.round(cx - half - x0 * TILE), top = Math.round(cy - half - y0 * TILE), size = Math.round(half * 2);
await sharp(mosaic).extract({ left, top, width: size, height: size }).resize(OUT, OUT, { kernel: 'lanczos3' }).webp({ quality: 86 }).toFile(FILE);
console.log(FILE, (fs.statSync(FILE).size / 1e6).toFixed(1), 'MB');
