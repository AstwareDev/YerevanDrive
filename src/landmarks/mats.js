// Procedural canvas textures + materials for the landmark buildings (tuff ashlar, roof tile, glass, floodlight shader patch).
import * as THREE from 'three';
import { quality } from '../quality.js';

function hash(ix, iy, seed) { let h = Math.imul(ix * 374761393 + iy * 668265263 + seed * 1442695041, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x, y, p, seed) { const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, s = t => t * t * (3 - 2 * t), sx = s(tx), sy = s(ty), w = v => ((v % p) + p) % p; return (hash(w(xi), w(yi), seed) * (1 - sx) + hash(w(xi + 1), w(yi), seed) * sx) * (1 - sy) + (hash(w(xi), w(yi + 1), seed) * (1 - sx) + hash(w(xi + 1), w(yi + 1), seed) * sx) * sy; }
function fbm(x, y, p, o, seed) { let v = 0, a = 0.5, t = 0, q = p; for (let i = 0; i < o; i++) { v += vn(x * q, y * q, q, seed + i * 13) * a; t += a; a *= 0.5; q *= 2; } return v / t; }

function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, srgb = true, rep = [1, 1], aniso = 8) { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }

/** ashlar tuff: 4 m x 4 m tile. base [r,g,b] 0..255, warm/yellow drift, course = 0.5 m. Returns {map,bump} */
function ashlar(base, { size = 512, courses = 8, seed = 3, yellow = 0.0, rustic = 0, pits = 1 } = {}) {
  const col = canvasOf(size, size), bmp = canvasOf(size, size), gc = col.getContext('2d'), gb = bmp.getContext('2d');
  const ic = gc.createImageData(size, size), ib = gb.createImageData(size, size);
  const ch = size / courses;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / ch), ly = y - row * ch;
    const blockW = size / (3 + (row % 2)) * (0.9 + hash(row, 1, seed) * 0.25);
    const off = hash(row, 2, seed) * blockW;
    for (let x = 0; x < size; x++) {
      const bx = Math.floor((x + off) / blockW), lx = (x + off) - bx * blockW;
      const bid = row * 17 + bx * 3;
      const tone = 0.94 + hash(bid, 5, seed) * 0.12, hue = hash(bid, 6, seed);
      const u = x / size, v = y / size;
      const n = fbm(u, v, 6, 3, seed + 4), grain = hash(x, y, seed + 9);
      let r = base[0], g = base[1], b = base[2];
      // pink<->yellow tuff variation per block
      const yl = (hue - 0.5) * 0.5 + yellow;
      r *= 1 + yl * 0.05; g *= 1 + yl * 0.22; b *= 1 - yl * 0.18;
      const k = tone * (0.86 + n * 0.3) * (0.95 + grain * 0.1);
      r *= k; g *= k; b *= k;
      // pores
      let h = 0.5 + (n - 0.5) * 0.3 + (grain - 0.5) * 0.12;
      if (pits && hash(x >> 1, y >> 1, seed + 21) > 0.992) { r *= 0.82; g *= 0.8; b *= 0.78; h -= 0.12; }
      // joints
      const jd = Math.min(ly, ch - ly, lx, blockW - lx);
      const jw = (rustic ? 4.5 : 1.5) * size / 512;
      if (jd < jw) { const f = rustic ? (jd < jw * 0.5 ? 0.5 : 0.75) : (jd < jw * 0.5 ? 0.7 : 0.86); r *= f; g *= f; b *= f; h -= 0.35; }
      else if (rustic && jd < jw + 3) { h -= 0.08; }
      const i = (y * size + x) * 4;
      ic.data[i] = Math.min(255, r); ic.data[i + 1] = Math.min(255, g); ic.data[i + 2] = Math.min(255, b); ic.data[i + 3] = 255;
      const hv = Math.max(0, Math.min(255, h * 255)); ib.data[i] = ib.data[i + 1] = ib.data[i + 2] = hv; ib.data[i + 3] = 255;
    }
  }
  gc.putImageData(ic, 0, 0); gb.putImageData(ib, 0, 0);
  return { col, bmp };
}

function tileTexture(size = 256) {
  const c = canvasOf(size, size), g = c.getContext('2d'), im = g.createImageData(size, size), rows = 16, bw = size / 8;
  for (let y = 0; y < size; y++) { const row = Math.floor(y / (size / rows)), ly = y % (size / rows); for (let x = 0; x < size; x++) {
    const bx = Math.floor((x + (row % 2) * bw / 2) / bw), lx = (x + (row % 2) * bw / 2) % bw;
    const t = 0.85 + hash(bx, row, 11) * 0.3, n = fbm(x / size, y / size, 6, 3, 8);
    let r = 205 * t, gg = 104 * t, b = 84 * t; const shade = 0.72 + 0.28 * (ly / (size / rows)); r *= shade * (0.9 + n * 0.2); gg *= shade * (0.9 + n * 0.2); b *= shade * (0.9 + n * 0.2);
    if (lx < 1.5) { r *= 0.55; gg *= 0.55; b *= 0.55; }
    const i = (y * size + x) * 4; im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = 255; } }
  g.putImageData(im, 0, 0); return c;
}

/** gnd-based floodlight emissive patch for stone-like materials. uniforms live in mat.userData.glow */
function floodPatch(mat, { col = [1.0, 0.62, 0.3], base = 0.04, up = 0.9, L = 12, plain = false } = {}) {
  const u = { uGC: { value: new THREE.Vector3(...col) }, uGB: { value: base }, uGU: { value: up }, uGL: { value: L } };
  mat.userData.glow = u;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float gnd; varying float vGnd; varying vec3 vWN2; varying vec3 vWP2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGnd = gnd; vWN2 = normalize(mat3(modelMatrix) * normal); vWP2 = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGnd; varying vec3 vWN2; varying vec3 vWP2; uniform vec3 uGC; uniform float uGB, uGU, uGL;')
      .replace('#include <common>', `#include <common>
float wH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wH(i), wH(i + vec2(1.0, 0.0)), f.x), mix(wH(i + vec2(0.0, 1.0)), wH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { float wl = 1.0 - abs(vWN2.y);                                           // walls only
          vec2 tg = normalize(vec2(-vWN2.z, vWN2.x) + 1e-4);
          vec2 w2 = vec2(dot(vWP2.xz, tg), vWP2.y);
          float tone = 0.86 + 0.26 * wN(w2 * 0.33) + 0.12 * (wN(w2 * 1.9) - 0.5);        // slow weathering patches
          float streak = smoothstep(0.55, 0.95, wN(vec2(w2.x * 3.1, w2.y * 0.11))) * (0.14 + 0.1 * wN(w2 * 0.2));   // rain streaks
          float soil = exp(-max(vGnd, 0.0) / 2.2) * 0.3;                                  // splash / traffic soiling at the base
          diffuseColor.rgb *= mix(1.0, tone * (1.0 - streak), wl);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.52, 0.46), soil * wl); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float h = max(vGnd, 0.0);
          float fall = exp(-h / uGL);
          float beam = 0.82 + 0.18 * sin((vWP2.x * 0.77 + vWP2.z * 0.53) * 1.7);
          float face = mix(0.55, 1.0, smoothstep(0.75, 0.0, vWN2.y)) ;
          float gl = (uGB + uGU * fall * beam) * face;
          totalEmissiveRadiance += diffuseColor.rgb * uGC * gl; }`);
  };
  mat.customProgramCacheKey = () => 'lmflood';
  return mat;
}

function glassPatch(mat, k = 1.0) {
  const U = { uEK: { value: k }, uDay: { value: 0 } }; mat.userData.glassU = U;   // uDay (0 night .. 1 day) is driven from landmarks.js
  // unlit panes carry a per-window id in vertex-colour blue (see facade.js glassCols) and window-local uv: draw a believable interior by day
  // (curtains with folds, slatted blinds, lace, a dim room) instead of a black hole; it is lit by the sun / shadows like any diffuse surface.
  mat.onBeforeCompile = sh => {
    sh.uniforms.uEK = U.uEK; sh.uniforms.uDay = U.uDay;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec2 vGuv;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vGuv = uv;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uEK, uDay; varying vec2 vGuv;
float gH(float x){ return fract(sin(x * 91.7 + 13.1) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gFm = 0.0;
        { float unl = step(0.001, vColor.r) * step(vColor.r, 0.03);
          float id = clamp((vColor.b - 0.034) * 1000.0, 0.0, 1.0);
          vec2 q = vGuv; vec3 fab = vec3(0.0); float cov = 0.0;
          vec3 room = mix(vec3(0.010, 0.014, 0.024), vec3(0.11, 0.09, 0.07), smoothstep(0.6, 0.0, q.y) * 0.7);
          if (id > 0.25 && id < 0.55) {
            vec3 pal[6]; pal[0] = vec3(0.62, 0.56, 0.45); pal[1] = vec3(0.50, 0.40, 0.30); pal[2] = vec3(0.50, 0.34, 0.31); pal[3] = vec3(0.34, 0.40, 0.31); pal[4] = vec3(0.40, 0.44, 0.52); pal[5] = vec3(0.70, 0.68, 0.64);
            int pi = int(floor(gH(id) * 5.99)); vec3 c = pal[0]; for (int i = 0; i < 6; i++) if (i == pi) c = pal[i];
            float full = step(gH(id * 3.1), 0.3), cw = 0.28 + 0.2 * gH(id * 7.3);
            cov = step(1.0 - (0.8 + 0.2 * gH(id * 5.0)), q.y) * max(full, step(q.x, cw) + step(1.0 - cw, q.x));
            float aa = clamp(1.0 - fwidth(q.x) * 14.0, 0.0, 1.0);                       // fade the folds out with distance (no shimmer)
            fab = c * (1.0 - 0.38 * aa + 0.38 * aa * sin(q.x * 44.0 + id * 9.0)) * (0.8 + 0.2 * smoothstep(1.0, 0.7, q.y));
          } else if (id >= 0.55 && id < 0.78) {
            float f = 0.3 + 0.7 * gH(id * 5.7); cov = step(1.0 - f, q.y);
            fab = mix(vec3(0.46, 0.44, 0.40), vec3(0.62, 0.60, 0.56), gH(id * 2.3)) * (1.0 - 0.22 * clamp(1.0 - fwidth(q.y) * 18.0, 0.0, 1.0) * (0.5 - 0.5 * sin(q.y * 100.0)));
          } else if (id >= 0.78 && id < 0.9) { cov = 0.55; fab = vec3(0.62, 0.6, 0.57); }
          vec3 inner = mix(room, fab, cov);
          diffuseColor.rgb = mix(diffuseColor.rgb, inner, unl);
          // lit rooms by day: a dim warm interior instead of a glowing white pane
          diffuseColor.rgb = mix(diffuseColor.rgb, room * 1.6 + vColor.rgb * 0.09, uDay * (1.0 - unl));
          gFm = unl * cov;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, gFm);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.0, gFm);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 totalEmissiveRadiance = vColor.rgb * uEK * mix(1.0, 0.05, uDay);`);
  };
  mat.customProgramCacheKey = () => 'lmglass3';
  return mat;
}

export function makeLandmarkMaterials(renderer, T) {
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
  const S = {}; const rep = [1, 1];   // uv is already in 4 m units (kit.js uvS): one 512 px ashlar tile = 4 m, 0.5 m courses
  const AS = quality.texSize >= 2048 ? 1024 : 512;
  const mk = (base, o, mo) => { const { col, bmp } = ashlar(base, { size: AS, ...o }); const map = toTex(col, true, rep, aniso), bump = toTex(bmp, false, rep, aniso); return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: mo?.bump ?? 1.6, roughness: mo?.rough ?? 0.9, metalness: 0, vertexColors: true }); };
  const M = {};
  M.rose = floodPatch(mk([224, 158, 124], { seed: 3, yellow: 0.0 }), { col: [1.0, 0.58, 0.28], base: 0.05, up: 0.85, L: 15 });
  M.pink = floodPatch(mk([200, 141, 131], { seed: 7, yellow: 0.0 }), { col: [1.0, 0.58, 0.34], base: 0.05, up: 0.85, L: 15 });   // Marriott block: mauve-pink tuff with pale bands (ground-level 360 Stories view)
  M.cream = floodPatch(mk([226, 196, 148], { seed: 5, yellow: 0.3 }), { col: [1.0, 0.64, 0.32], base: 0.05, up: 0.85, L: 15 });
  M.rust = floodPatch(mk([205, 140, 108], { seed: 9, yellow: -0.1, rustic: 1 }, { bump: 2.4 }), { col: [1.0, 0.55, 0.26], base: 0.05, up: 1.0, L: 10 });
  M.basalt = floodPatch(mk([88, 82, 84], { seed: 12, yellow: -0.3, pits: 1 }), { col: [1.0, 0.6, 0.3], base: 0.02, up: 0.9, L: 4 });
  M.grey = floodPatch(mk([148, 145, 140], { seed: 31, yellow: 0.12, courses: 10 }, { bump: 2.0 }), { col: [1.0, 0.66, 0.38], base: 0.05, up: 0.85, L: 16 });   // Opera: warm grey tuff/basalt (Wikimedia photos)
  M.sand = floodPatch(mk([228, 192, 150], { seed: 33, yellow: 0.2, courses: 6 }, { bump: 1.2 }), { col: [1.0, 0.64, 0.34], base: 0.05, up: 0.85, L: 18 });   // Cathedral: pale peach limestone
  M.white = floodPatch(mk([232, 226, 216], { seed: 14, yellow: 0.1 }), { col: [1.0, 0.66, 0.36], base: 0.05, up: 0.85, L: 18 });
  const tile = toTex(tileTexture(256), true, [1 / 3, 1 / 3], aniso);
  M.tile = floodPatch(new THREE.MeshStandardMaterial({ map: tile, roughness: 0.65, metalness: 0, vertexColors: true, color: 0xffd0c0 }), { col: [1, 0.55, 0.35], base: 0.07, up: 0.28, L: 40 });
  { // flat roofs: bitumen membrane strips with seams, gravel speckle, ponding stains and patches (4 m tile)
    const sz = 512, c = canvasOf(sz, sz), g = c.getContext('2d'), im = g.createImageData(sz, sz);
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const strip = Math.floor(x / 64), seam = (x % 64) < 2 ? 0.55 : 1, n = fbm(x / sz, y / sz, 5, 4, 41), st = 0.9 + hash(strip, 3, 5) * 0.2, gr = hash(x, y, 8);
      let k = (0.62 + n * 0.55) * st * seam * (0.92 + gr * 0.16); if (n > 0.62) k *= 0.8; if (gr > 0.985) k *= 1.6;
      const i = (y * sz + x) * 4; im.data[i] = 118 * k; im.data[i + 1] = 120 * k; im.data[i + 2] = 126 * k; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    M.roofflat = new THREE.MeshStandardMaterial({ map: toTex(c, true, [1, 1], aniso), color: 0xffffff, roughness: 0.88, vertexColors: true });
  }
  M.zinc = new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.55, metalness: 0.35, vertexColors: true, emissive: 0x0a0b0d });   // light-grey sheet-metal roofs (Government House, seen in the 360 Stories aerials)
  M.glass = glassPatch(new THREE.MeshStandardMaterial({ color: 0x06080c, roughness: 0.1, metalness: 0.65, vertexColors: true, envMapIntensity: 1.4 }), 1.0);
  M.frame = new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.6, metalness: 0.0, vertexColors: true, emissive: 0x1c140c });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x3b4a44, roughness: 0.45, metalness: 0.7, vertexColors: true });
  M.copper = new THREE.MeshStandardMaterial({ color: 0x4f8a7c, roughness: 0.5, metalness: 0.55, vertexColors: true, emissive: 0x0a1a16 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.6, metalness: 0.5, vertexColors: true });
  M.bronze = new THREE.MeshStandardMaterial({ color: 0x4a3f30, roughness: 0.45, metalness: 0.7, vertexColors: true });   // statues
  M.cypress = new THREE.MeshStandardMaterial({ color: 0x1d3a22, roughness: 0.95, metalness: 0, vertexColors: true });  // clipped cypress / evergreen cones
  M.lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  M.decal = new THREE.MeshBasicMaterial({ map: T?.glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  M.clockface = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  M.pave = new THREE.MeshStandardMaterial({ color: 0x8a6a5a, roughness: 0.7, vertexColors: true });
  return M;
}
export { floodPatch, glassPatch, ashlar, toTex, hash, fbm, canvasOf };
