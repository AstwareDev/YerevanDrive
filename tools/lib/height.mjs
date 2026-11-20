// Multi-resolution terrain height model: fine 5 m (+-3800) -> mid 10 m (+-4400) -> far 80 m (+-17600). 0 = Republic Square ground.
import fs from 'node:fs';
function load(name, blur) {
  const meta = JSON.parse(fs.readFileSync(`data/${name}.json`, 'utf8')), b = fs.readFileSync(`data/${name}.bin`);
  const g = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), N = meta.N;
  for (let pass = 0; pass < blur; pass++) { const s = g.slice(); for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { let t = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) t += s[(j + dj) * N + i + di]; g[j * N + i] = t / 9; } }
  return { ...meta, g };
}
const fine = load('height', 0), mid = load('height_mid', 2), far = load('height_far', 1);
const bil = (L, x, z) => {
  let fx = (x + L.R) / L.STEP, fz = (z + L.R) / L.STEP; fx = Math.min(Math.max(fx, 0), L.N - 1.001); fz = Math.min(Math.max(fz, 0), L.N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, N = L.N, g = L.g;
  return ((g[j * N + i] * (1 - tx) + g[j * N + i + 1] * tx) * (1 - tz) + (g[(j + 1) * N + i] * (1 - tx) + g[(j + 1) * N + i + 1] * tx) * tz) - L.base;
};
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Height at (x,z) blending the three grids across their borders. */
export function Hall(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  if (d < 3300) return bil(fine, x, z);
  if (d < 3800) return bil(fine, x, z) * (1 - sm(3300, 3800, d)) + bil(mid, x, z) * sm(3300, 3800, d);
  if (d < 4300) return bil(mid, x, z) * (1 - sm(3800, 4300, d)) + bil(far, x, z) * sm(3800, 4300, d);
  return bil(far, x, z);
}
export const Hfine = (x, z) => bil(fine, x, z);
