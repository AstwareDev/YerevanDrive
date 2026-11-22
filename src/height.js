// Runtime terrain height function (metres, 0 = Republic Square ground). Same math as tools/terrain.mjs.
import { fetchJSON, fetchBuffer } from './net.js';
export async function loadHeight() {
  const [meta, buf] = await Promise.all([fetchJSON('/map/height.json'), fetchBuffer('/map/height.bin')]);
  const grid = new Float32Array(buf);
  const { N, STEP, R, base } = meta;
  const H = function H(x, z) {
    let fx = (x + R) / STEP, fz = (z + R) / STEP;
    fx = Math.min(Math.max(fx, 0), N - 1.001); fz = Math.min(Math.max(fz, 0), N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz - base;
  };
  H.grid = { N, STEP, R, base, g: grid };
  return H;
}
