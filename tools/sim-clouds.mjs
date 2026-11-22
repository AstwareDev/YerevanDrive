// CPU port of the volumetric cloud march in src/sky.js (no GPU / browser needed): renders small PNG stills to tune the look.
//   node tools/sim-clouds.mjs <out.png> <day 0..1> <yawDeg> <pitchDeg> [steps=22] [taps=3] [w=320] [h=180] [t=0] [camY=0]   (camY: camera altitude in m; the layer is 1800-4000 m, so try 2500 = inside, 5000 = above)
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createCloudNoise, CLOUD_NOISE_SIZE } from '../src/skyNoise.js';

const [, , OUT = 'clouds.png', DAY = '1', YAW = '0', PITCH = '12', STEPS = '22', TAPS = '3', W = '320', H = '180', TT = '0', CAMY = '0'] = process.argv;
const uDay = +DAY, uDusk = Math.max(0, 1 - Math.abs(2 * uDay - 1)), uSteps = +STEPS, uLT = +TAPS, uTime = +TT, uCover = 0.8, camY = +CAMY;
const w = +W, hgt = +H;
const t0 = Date.now();
const noise = await new Promise(res => { const n = createCloudNoise(() => res(n)); });
console.log('noise generated in', Date.now() - t0, 'ms');
const D = noise.texture.image.data, N = CLOUD_NOISE_SIZE;
const stats = [0, 1, 2, 3].map(c => { let s = 0, mn = 255, mx = 0; for (let i = c; i < D.length; i += 4) { s += D[i]; mn = Math.min(mn, D[i]); mx = Math.max(mx, D[i]); } return { mean: +(s / (D.length / 4) / 255).toFixed(3), mn, mx }; });
console.log('channel stats', JSON.stringify(stats));

const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), mix = (a, b, t) => a + (b - a) * t, fract = x => x - Math.floor(x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const vmix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// trilinear, repeat wrap, GL texel-centre convention
function tex(u, v, ww) {
  const x = u * N - 0.5, y = v * N - 0.5, z = ww * N - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  const o = [0, 0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const wt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    const ix = ((x0 + dx) % N + N) % N, iy = ((y0 + dy) % N + N) % N, iz = ((z0 + dz) % N + N) % N, i = ((iz * N + iy) * N + ix) * 4;
    for (let c = 0; c < 4; c++) o[c] += D[i + c] / 255 * wt;
  }
  return o;
}

const CH0 = 1800, CH1 = 4000, SIG = 0.0021; let gC = 0.6;
const hgp = (c, g) => { const g2 = g * g; return (1 - g2) / Math.pow(1 + g2 - 2 * g * c, 1.5); };
const cloudQ = p => [p[0] + uTime * 9, p[1], p[2] + uTime * 4];
const cloudMacro = q => tex(q[0] / 48000, 0.37, q[2] / 48000)[1];
function cloudBase(p, mc) {
  const q = cloudQ(p), hn = clamp((p[1] - CH0) / (CH1 - CH0), 0, 1), top = mix(0.42, 1, mc);
  const prof = smoothstep(0, 0.10, hn) * (1 - smoothstep(top * 0.55, top, hn));
  const n = tex(q[0] / 9000, q[1] / 9000, q[2] / 9000);
  const s = (n[0] * 0.40 + n[1] * 0.34 + n[2] * 0.26) * prof * mix(0.85, 1.25, mc);
  return clamp((s - mix(0.78, 0.23, gC)) / 0.24, 0, 1);
}
function erosion(p) { const q = cloudQ(p), n = tex(q[2] / 4500, q[1] / 4500, q[0] / 4500); return n[2] * 0.7 + n[3] * 0.3; }
function cloudDetail(er, hn, dn) { const k = mix(0.50, 0.90, hn); return clamp((dn - er * k) / (1 - er * k), 0, 1); }
function volClouds(d, L, sunC, ambHi, ambLo, px, py) {
  let ta, tb; const y0 = camY;
  if (Math.abs(d[1]) < 0.0005) { if (y0 < CH0 || y0 > CH1) return [0, 0, 0, 0]; ta = 0; tb = 1e9; }
  else { const tA = (CH0 - y0) / d[1], tB = (CH1 - y0) / d[1]; ta = Math.min(tA, tB); tb = Math.max(tA, tB); }
  const inside = ta <= 0; ta = Math.max(ta, 0);
  if (tb <= 0 || ta > 110000) return [0, 0, 0, 0];
  const len = Math.min(tb, ta + (inside ? 9000 : 28000)) - ta, Nn = uSteps, bias = inside ? 0.85 : 0.6;
  const jit = fract(52.9829189 * fract(px * 0.06711056 + py * 0.00583715)), cosT = dot(d, L);
  const ph = Math.min(mix(hgp(cosT, -0.22), hgp(cosT, 0.62), 0.5), 2.8), pwK = 0.5 * (1 - smoothstep(0.3, 0.9, cosT));
  let T = 1, tSum = 0, wSum = 0; const acc = [0, 0, 0];
  for (let i = 0; i < 48; i++) {
    if (i >= uSteps || T < 0.03) break;
    const s = (i + jit) / Nn, t = ta + len * mix(s, s * s, bias), dt = len / Nn * (1 - bias + 2 * bias * s), p = [d[0] * t, y0 + d[1] * t, d[2] * t];
    const mc = cloudMacro(cloudQ(p)); let dens = cloudBase(p, mc) * (1 - smoothstep(20000, 42000, t));
    if (dens > 0.004) {
      const hn = clamp((p[1] - CH0) / (CH1 - CH0), 0, 1), er0 = erosion(p);
      dens = cloudDetail(er0, hn, dens);
      if (dens > 0.004) {
        let lt = 0, ls = 140; const lp = [...p];
        for (let k = 0; k < 4; k++) { if (k >= uLT) break; lp[0] += L[0] * ls; lp[1] += L[1] * ls; lp[2] += L[2] * ls; lt += cloudBase(lp, mc) * ls; ls *= 2.0; }
        const tau = lt * SIG; let lightE = Math.max(Math.exp(-tau), 0.45 * Math.exp(-tau * 0.2));
        lightE *= mix(1, 1 - Math.exp(-dens * 4), pwK);
        lightE *= clamp(1 + 1.2 * (erosion([p[0] + L[0] * 130, p[1] + L[1] * 130, p[2] + L[2] * 130]) - er0), 0.5, 1.4);
        const am = vmix(ambLo, ambHi, smoothstep(0, 0.8, hn));
        const stepT = Math.exp(-dens * SIG * dt), wgt = T * (1 - stepT);
        for (let c = 0; c < 3; c++) acc[c] += wgt * (sunC[c] * lightE * ph + am[c]);
        tSum += wgt * t; wSum += wgt; T *= stepT;
      }
    }
  }
  const tm = wSum > 1e-4 ? tSum / wSum : ta, hz = Math.exp(-tm / 45000);
  return [acc[0] * hz, acc[1] * hz, acc[2] * hz, (1 - T) * hz];
}

// ---- sky background (same formulas as the legacy shader, sun / moon discs omitted)
const sunD = norm(vmix(norm([-0.55, 0.62, 0.55]), [-0.80, 0.05, 0.60], uDusk)), moon = norm([-0.45, 0.5, -0.7]);
function skyBase(d) {
  const h = d[1];
  let col = vmix(vmix([0.115, 0.075, 0.13], [0.020, 0.030, 0.070], smoothstep(0, 0.22, h)), [0.004, 0.007, 0.022], smoothstep(0.18, 0.85, h));
  if (h < 0) col = [0.115 * 0.85, 0.075 * 0.85, 0.13 * 0.85];
  { const dz = [0.16, 0.36, 0.78], dm = [0.42, 0.62, 0.90], dh = [0.74, 0.82, 0.92]; let dc = vmix(dh, dm, smoothstep(0, 0.18, h)); dc = vmix(dc, dz, smoothstep(0.15, 0.8, h)); const sd2 = Math.max(dot(d, sunD), 0); dc = dc.map((v, i) => v + [1, 0.9, 0.7][i] * (Math.pow(sd2, 40) * 0.25 + Math.pow(sd2, 6) * 0.08)); col = vmix(col, dc, uDay); }
  const sunH = norm([sunD[0], 0, sunD[2]]), ang = Math.max(dot(norm([d[0], 0.0001, d[2]]), sunH), 0);
  if (uDusk > 0.001) {
    const hz = vmix([0.50, 0.36, 0.42], [1, 0.58, 0.20], Math.pow(ang, 3)); let dk = vmix(hz, [0.10, 0.15, 0.33], smoothstep(0, 0.26, h)); dk = vmix(dk, [0.025, 0.045, 0.13], smoothstep(0.2, 0.9, h));
    const sdd = Math.max(dot(d, sunD), 0); const add = Math.pow(ang, 6) * Math.exp(-Math.max(h, 0) * 13) * 0.85 + Math.pow(sdd, 10) * 0.5 + Math.pow(sdd, 120) * 1.4;
    dk = dk.map((v, i) => v + [1, 0.52, 0.16][i] * add); col = vmix(col, dk, uDusk);
  }
  return col;
}

const img = Buffer.alloc(w * hgt * 3);
const yaw = +YAW * Math.PI / 180, pitch = +PITCH * Math.PI / 180, fov = 62 * Math.PI / 180, asp = w / hgt, tf = Math.tan(fov / 2);
const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];   // x east, z south: matches the shader's atan(d.x, d.z) azimuth
const right = norm([Math.cos(yaw), 0, -Math.sin(yaw)]), up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
const wN = (1 - uDay) * (1 - uDusk), wD = uDay * (1 - uDusk);
const L = norm(vmix(moon, sunD, Math.max(uDay, uDusk)));
const ts = Date.now();
for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
  const sx = ((i + 0.5) / w * 2 - 1) * tf * asp, sy = (1 - (j + 0.5) / hgt * 2) * tf;
  // up vector sign: make sure +y of the screen is world-up-ish
  const dd = norm([fwd[0] + right[0] * sx + up[0] * sy * -1, fwd[1] + right[1] * sx + up[1] * sy * -1, fwd[2] + right[2] * sx + up[2] * sy * -1]);
  let col = skyBase(dd); const h = dd[1];
  if (h > 0 || camY > CH0 - 1) {
    const glow = [0.17, 0.085, 0.12].map(v => v * Math.exp(-h * 4.5));
    const sunC = [0.30 * 0.22 * wN + 0.95 * wD + 1.25 * uDusk, 0.40 * 0.22 * wN + 0.90 * wD + 0.625 * uDusk, 0.70 * 0.22 * wN + 0.80 * wD + 0.225 * uDusk];
    const aHi = [0.012 * wN + 0.40 * wD + 0.10 * uDusk + glow[0] * 0.18 * wN, 0.016 * wN + 0.50 * wD + 0.14 * uDusk + glow[1] * 0.18 * wN, 0.040 * wN + 0.68 * wD + 0.30 * uDusk + glow[2] * 0.18 * wN];
    const aLo = [0.018 * wN + 0.26 * wD + 0.035 * uDusk + glow[0] * 0.55 * wN, 0.014 * wN + 0.32 * wD + 0.050 * uDusk + glow[1] * 0.55 * wN, 0.030 * wN + 0.46 * wD + 0.120 * uDusk + glow[2] * 0.55 * wN];
    { const k = mix(1, mix(0.08, 1, smoothstep(0.5, 0.99, dot(dd, L))), uDusk); sunC[0] *= k; sunC[1] *= k; sunC[2] *= k; }
    gC = clamp(uCover * mix(1, 0.62, uDay * (1 - uDusk)), 0, 1) * mix(1, 0.12 + 0.88 * smoothstep(0.02, 0.30, camY > CH0 ? 1 : h), uDusk);
    const vc = volClouds(dd, L, sunC, aHi, aLo, i, j), f = camY > CH0 ? 1 : smoothstep(0, 0.07, h);
    for (let c = 0; c < 3; c++) col[c] = col[c] * (1 - vc[3] * f) + vc[c] * f;
  }
  const o = (j * w + i) * 3;
  for (let c = 0; c < 3; c++) { let v = col[c] * (uDay > 0.5 ? 0.85 : 1.0); v = v / (1 + v * 0.35); img[o + c] = Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2)); }   // crude tone map + gamma, only for the preview
}
console.log('rendered', w, 'x', hgt, 'in', Date.now() - ts, 'ms');

// ---- PNG writer
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(t), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((w * 3 + 1) * hgt); for (let j = 0; j < hgt; j++) { raw[j * (w * 3 + 1)] = 0; img.copy(raw, j * (w * 3 + 1) + 1, j * w * 3, (j + 1) * w * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', OUT);
