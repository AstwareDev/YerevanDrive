// Tileable 3D noise for the volumetric clouds (src/sky.js). 64^3 RGBA8 = 1 MB, generated on the CPU in small time slices (a few ms each) so the loading
// screen / first frames never hitch; the sky keeps the old 2D clouds until `onReady` fires and then cross-fades to the volumetric ones.
//   R  Perlin-Worley  (value-noise fbm pushed up by an inverted Worley): the billowy base shape
//   G  Worley fbm 4/8/16 cells : second base-shape channel (lumps of several sizes)
//   B  Worley fbm 8/16/32 cells: erosion detail
//   A  Worley   16/32 cells    : fine erosion detail
// Each channel is stretched so its 2nd..98th percentile spans 0..1 (the shader's coverage thresholds then mean the same thing for every channel).
import * as THREE from 'three';

export const CLOUD_NOISE_SIZE = 64;

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lattice = (f, seed, comps) => { const r = mulberry(seed), a = new Float32Array(f * f * f * comps); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };

/** inverted, periodic Worley (F1): 1 at a feature point, falling to 0 about one cell away */
function worley(L, x, y, z) {
  const f = L.f, px = x * f, py = y * f, pz = z * f, cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz), P = L.p;
  let m = 9;
  for (let dz = -1; dz <= 1; dz++) {
    const iz = (cz + dz + f) % f, fz = cz + dz - pz;
    for (let dy = -1; dy <= 1; dy++) {
      const iy = (cy + dy + f) % f, fy = cy + dy - py;
      for (let dx = -1; dx <= 1; dx++) {
        const ix = (cx + dx + f) % f, k = ((iz * f + iy) * f + ix) * 3;
        const ax = cx + dx - px + P[k], ay = fy + P[k + 1], az = fz + P[k + 2], d = ax * ax + ay * ay + az * az;
        if (d < m) m = d;
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(m));
}
/** periodic trilinear value noise with smooth fade */
function vnoise(L, x, y, z) {
  const f = L.f, px = x * f, py = y * f, pz = z * f, ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let fx = px - ix, fy = py - iy, fz = pz - iz; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const x0 = ix % f, x1 = (ix + 1) % f, y0 = iy % f, y1 = (iy + 1) % f, z0 = iz % f, z1 = (iz + 1) % f, V = L.v;
  const at = (a, b, c) => V[(c * f + b) * f + a];
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(at(x0, y0, z0), at(x1, y0, z0), fx), l(at(x0, y1, z0), at(x1, y1, z0), fx), fy), l(l(at(x0, y0, z1), at(x1, y0, z1), fx), l(at(x0, y1, z1), at(x1, y1, z1), fx), fy), fz);
}

/** @returns {{ texture: THREE.Data3DTexture, ready: boolean, cancel(): void }} `onReady` is called once the texture has been uploaded */
export function createCloudNoise(onReady) {
  const N = CLOUD_NOISE_SIZE, total = N * N * N;
  const data = new Uint8Array(total * 4); let raw = new Float32Array(total * 4);
  const texture = new THREE.Data3DTexture(data, N, N, N);
  texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping; texture.unpackAlignment = 1;
  const W = [4, 8, 16, 32].map((f, i) => ({ f, p: lattice(f, 1000 + i * 77, 3) }));
  const Vn = [4, 8, 16].map((f, i) => ({ f, v: lattice(f, 5000 + i * 31, 1) }));
  const out = { texture, ready: false, cancel() { dead = true; } };
  let dead = false, z = 0;
  const SLICES = 1;                                                     // z slices per time slice (~10-15 ms on a slow CPU)
  function slice() {
    if (dead) return;
    for (let s = 0; s < SLICES && z < N; s++, z++) {
      const zz = z / N;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = x / N, v = y / N, o = ((z * N + y) * N + x) * 4;
        const vf = 0.5 * vnoise(Vn[0], u, v, zz) + 0.3 * vnoise(Vn[1], u, v, zz) + 0.2 * vnoise(Vn[2], u, v, zz);
        const w4 = worley(W[0], u, v, zz), w8 = worley(W[1], u, v, zz), w16 = worley(W[2], u, v, zz), w32 = worley(W[3], u, v, zz);
        raw[o] = w4 + vf * (1 - w4);
        raw[o + 1] = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;
        raw[o + 2] = w8 * 0.625 + w16 * 0.25 + w32 * 0.125;
        raw[o + 3] = w16 * 0.6 + w32 * 0.4;
      }
    }
    if (z < N) { setTimeout(slice, 10); return; }
    // percentile stretch per channel (histogram, 1024 bins)
    for (let c = 0; c < 4; c++) {
      const hist = new Uint32Array(1024); let lo = 1e9, hi = -1e9;
      for (let i = c; i < raw.length; i += 4) { const v = raw[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const span = Math.max(1e-6, hi - lo);
      for (let i = c; i < raw.length; i += 4) hist[Math.min(1023, ((raw[i] - lo) / span * 1024) | 0)]++;
      let acc = 0, p2 = 0, p98 = 1023; const a = total * 0.02, b = total * 0.98;
      for (let k = 0; k < 1024; k++) { acc += hist[k]; if (acc < a) p2 = k; if (acc <= b) p98 = k; }
      const mn = lo + (p2 / 1024) * span, mx = lo + ((p98 + 1) / 1024) * span, inv = 1 / Math.max(1e-6, mx - mn);
      for (let i = c; i < raw.length; i += 4) data[i] = Math.max(0, Math.min(255, Math.round((raw[i] - mn) * inv * 255)));
    }
    raw = null;                                                          // free the 4 MB scratch buffer
    texture.needsUpdate = true; out.ready = true; onReady?.();
  }
  setTimeout(slice, 0);
  return out;
}

// One shared texture for the sky dome and the depth-aware cloud pass (post/scenefx.js): generated on first use.
let shared = null;
export function sharedCloudNoise() {
  if (!shared) { shared = createCloudNoise(() => { shared.readyAt = performance.now(); }); shared.readyAt = 0; }
  return shared;
}
/** 0 while the noise is generating, then fades 0 -> 1 over 2.5 s (the 2D clouds cross-fade into the volumetric ones) */
export const cloudFade = n => (n.ready ? Math.min(1, (performance.now() - n.readyAt) / 2500) : 0);
