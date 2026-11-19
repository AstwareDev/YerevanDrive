// Shared helpers for all map tools. Local frame: x east, y up (0 = Republic Square ground), z south.
import fs from 'node:fs';
export { CENTER, HALF, project } from './config.mjs';
const hm = JSON.parse(fs.readFileSync('data/height.json', 'utf8'));
const hb = fs.readFileSync('data/height.bin');
const grid = new Float32Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength));
const { N, STEP, R, base } = hm;
/** Terrain height (metres, 0 = Republic Square) at local (x, z). */
export function H(x, z) {
  let fx = (x + R) / STEP, fz = (z + R) / STEP;
  fx = Math.min(Math.max(fx, 0), N - 1.001); fz = Math.min(Math.max(fz, 0), N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz - base;
}
export const hash = n => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
export const mkRng = seed => { let s = (seed | 0) ^ 0x1234567; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
