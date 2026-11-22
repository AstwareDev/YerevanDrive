// Removes street furniture and vegetation that was placed ON the carriageway. Lamps, hydrants, bins, bollards, benches, planters, bushes and trees are
// placed relative to the centre line of ONE road, so at junctions, dual carriageways and side streets they landed in the lanes of another road
// (24 % of the street lamps, 1 600 collider trees, 190 hydrants ...). The baked 0.5 m surface raster (public/map/surface.bin, the same one the car's
// tyres read) says exactly where the asphalt is.
// Usage: node tools/clean-onroad.mjs        (idempotent; run after build-map.mjs + build-props.mjs)
import fs from 'node:fs';
import zlib from 'node:zlib';

const info = JSON.parse(fs.readFileSync('public/map/surface.json', 'utf8'));
const off = zlib.inflateSync(fs.readFileSync('public/map/surface.bin'));
const { w: W, h: H, cell, x0: X0, z0: Z0 } = info, inv = 1 / cell;
const onAsphalt = (x, z) => { const i = Math.floor((x - X0) * inv), j = Math.floor((z - Z0) * inv); if (i < 0 || j < 0 || i >= W || j >= H) return false; const v = off[j * W + i]; return v >= 9 && v < 26; };

/** drop every item of a flat array (stride floats per item, position at xo / zo) that stands on asphalt */
function clean(arr, stride, xo, zo) {
  if (!Array.isArray(arr)) return [arr, 0];
  const out = []; let dropped = 0;
  for (let n = 0; n + stride <= arr.length; n += stride) { if (onAsphalt(arr[n + xo], arr[n + zo])) { dropped++; continue; } for (let k = 0; k < stride; k++) out.push(arr[n + k]); }
  return [out, dropped];
}

const metaPath = 'public/map/meta.json', propsPath = 'public/map/props.json';
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')), props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
const report = [];
for (const [obj, key, stride, xo, zo, label] of [
  [meta, 'lamps', 6, 0, 2, 'lamps'], [meta, 'trees', 4, 0, 2, 'collider trees'],
  [props, 'trees', 7, 0, 1, 'trees'], [props, 'bushes', 6, 0, 1, 'bushes'], [props, 'hydrants', 2, 0, 1, 'hydrants'], [props, 'bins', 3, 0, 1, 'bins'],
  [props, 'bollards', 2, 0, 1, 'bollards'], [props, 'benches', 4, 0, 1, 'benches'], [props, 'planters', 3, 0, 1, 'planters'],
]) { const [a, d] = clean(obj[key], stride, xo, zo); obj[key] = a; report.push(`${label} -${d}`); }
fs.writeFileSync(metaPath, JSON.stringify(meta)); fs.writeFileSync(propsPath, JSON.stringify(props));
console.log('removed from the road:', report.join(', '));
