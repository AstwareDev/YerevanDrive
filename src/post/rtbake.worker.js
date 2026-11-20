// Worker: bakes the ray-tracing proxy of the city -- a 2 m heightfield of terrain + extruded building footprints -- plus a coarse
// max-height level (16 m cells) for empty-space skipping. Exact scanline polygon fill (no canvas anti-aliasing smearing heights).
// in : { buildings: [{ r: [x,z,...], b: topY }], hg: { N, STEP, R, base, g: Float32Array }, rect: { x0, z0, w, h }, cell, coarse }
// out: { fine: Uint16Array (RGBA half: top y, ground y, building seed, 1), coarse: Uint16Array (R half: max top y), W, H, CW, CH }
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {                                   // float -> IEEE half (round-to-nearest), enough range for heights in metres
  f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return s; if (e >= 31) return s | 0x7c00;
  m += 0x1000; if (m & 0x800000) { m = 0; e++; if (e >= 31) return s | 0x7c00; }
  return s | (e << 10) | (m >>> 13);
}
self.onmessage = ({ data }) => {
  const { buildings, hg, rect, cell, coarse } = data;
  const W = Math.ceil(rect.w / cell), H = Math.ceil(rect.h / cell);
  const top = new Float32Array(W * H), ground = new Float32Array(W * H), seed = new Float32Array(W * H);
  // terrain from the 5 m grid (bilinear)
  const { N, STEP, R, base, g } = hg;
  const Hs = (x, z) => { let fx = (x + R) / STEP, fz = (z + R) / STEP; fx = Math.min(Math.max(fx, 0), N - 1.001); fz = Math.min(Math.max(fz, 0), N - 1.001); const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j; return (g[j * N + i] * (1 - tx) + g[j * N + i + 1] * tx) * (1 - tz) + (g[(j + 1) * N + i] * (1 - tx) + g[(j + 1) * N + i + 1] * tx) * tz - base; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const y = Hs(rect.x0 + (i + 0.5) * cell, rect.z0 + (j + 0.5) * cell); top[j * W + i] = y; ground[j * W + i] = y; }
  // buildings: even-odd scanline fill at cell centres
  const xs = [];
  for (let n = 0; n < buildings.length; n++) {
    const { r, b } = buildings[n]; const m = r.length / 2; if (m < 3) continue;
    let z0 = Infinity, z1 = -Infinity; for (let k = 0; k < m; k++) { const z = r[k * 2 + 1]; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const j0 = Math.max(0, Math.floor((z0 - rect.z0) / cell)), j1 = Math.min(H - 1, Math.ceil((z1 - rect.z0) / cell));
    const sd = ((Math.imul(n + 1, 2654435761) >>> 0) % 997) / 997 + 0.0005;
    for (let j = j0; j <= j1; j++) {
      const zc = rect.z0 + (j + 0.5) * cell; xs.length = 0;
      for (let k = 0; k < m; k++) { const ax = r[k * 2], az = r[k * 2 + 1], bx = r[((k + 1) % m) * 2], bz = r[((k + 1) % m) * 2 + 1]; if ((az <= zc) !== (bz <= zc)) xs.push(ax + (zc - az) / (bz - az) * (bx - ax)); }
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - rect.x0) / cell - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[k + 1] - rect.x0) / cell - 0.5));
        for (let i = i0; i <= i1; i++) { const o = j * W + i; if (b > top[o]) { top[o] = b; seed[o] = sd; } }
      }
    }
  }
  const fine = new Uint16Array(W * H * 4);
  for (let o = 0; o < W * H; o++) { fine[o * 4] = toHalf(top[o]); fine[o * 4 + 1] = toHalf(ground[o]); fine[o * 4 + 2] = toHalf(seed[o]); fine[o * 4 + 3] = 0x3c00; }
  const CW = Math.ceil(W / coarse), CH = Math.ceil(H / coarse), cmax = new Uint16Array(CW * CH);
  for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CW; ci++) {
    let mx = -1e9; for (let j = cj * coarse - 1; j <= (cj + 1) * coarse; j++) for (let i = ci * coarse - 1; i <= (ci + 1) * coarse; i++) { if (i < 0 || j < 0 || i >= W || j >= H) continue; const v = top[j * W + i]; if (v > mx) mx = v; }   // 1-texel apron: no misses at cell borders
    cmax[cj * CW + ci] = toHalf(mx + 0.25);
  }
  self.postMessage({ fine, coarse: cmax, W, H, CW, CH }, [fine.buffer, cmax.buffer]);
};
