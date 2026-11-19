// Procedural canvas textures + materials for the landmark buildings (tuff ashlar, roof tile, glass, floodlight shader patch).
import * as THREE from 'three';

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
      const tone = 0.9 + hash(bid, 5, seed) * 0.22, hue = hash(bid, 6, seed);
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
      const jw = rustic ? 4.5 : 2.2;
      if (jd < jw) { const f = jd < jw * 0.5 ? 0.5 : 0.75; r *= f; g *= f; b *= f; h -= 0.35; }
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
  mat.onBeforeCompile = sh => {
    sh.uniforms.uEK = { value: k };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uEK;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = vColor.rgb * uEK;');
  };
  mat.customProgramCacheKey = () => 'lmglass';
  return mat;
}

export function makeLandmarkMaterials(renderer, T) {
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
  const S = {}; const rep = [1 / 4, 1 / 4];
  const mk = (base, o, mo) => { const { col, bmp } = ashlar(base, o); const map = toTex(col, true, rep, aniso), bump = toTex(bmp, false, rep, aniso); return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: mo?.bump ?? 1.6, roughness: mo?.rough ?? 0.9, metalness: 0, vertexColors: true }); };
  const M = {};
  M.rose = floodPatch(mk([224, 158, 124], { seed: 3, yellow: 0.0 }), { col: [1.0, 0.58, 0.28], base: 0.05, up: 0.85, L: 15 });
  M.cream = floodPatch(mk([226, 196, 148], { seed: 5, yellow: 0.3 }), { col: [1.0, 0.64, 0.32], base: 0.05, up: 0.85, L: 15 });
  M.rust = floodPatch(mk([205, 140, 108], { seed: 9, yellow: -0.1, rustic: 1 }, { bump: 2.4 }), { col: [1.0, 0.55, 0.26], base: 0.05, up: 1.0, L: 10 });
  M.basalt = floodPatch(mk([88, 82, 84], { seed: 12, yellow: -0.3, pits: 1 }), { col: [1.0, 0.6, 0.3], base: 0.02, up: 0.9, L: 4 });
  M.white = floodPatch(mk([232, 226, 216], { seed: 14, yellow: 0.1 }), { col: [1.0, 0.66, 0.36], base: 0.05, up: 0.85, L: 18 });
  const tile = toTex(tileTexture(256), true, [1 / 3, 1 / 3], aniso);
  M.tile = floodPatch(new THREE.MeshStandardMaterial({ map: tile, roughness: 0.65, metalness: 0, vertexColors: true, color: 0xffd0c0 }), { col: [1, 0.55, 0.35], base: 0.07, up: 0.28, L: 40 });
  M.roofflat = new THREE.MeshStandardMaterial({ color: 0x3c3d44, roughness: 0.9, vertexColors: true, emissive: 0x0a0a10 });
  M.glass = glassPatch(new THREE.MeshStandardMaterial({ color: 0x06080c, roughness: 0.1, metalness: 0.65, vertexColors: true, envMapIntensity: 1.4 }), 1.0);
  M.frame = new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.6, metalness: 0.0, vertexColors: true, emissive: 0x1c140c });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x3b4a44, roughness: 0.45, metalness: 0.7, vertexColors: true });
  M.copper = new THREE.MeshStandardMaterial({ color: 0x4f8a7c, roughness: 0.5, metalness: 0.55, vertexColors: true, emissive: 0x0a1a16 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.6, metalness: 0.5, vertexColors: true });
  M.lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  M.decal = new THREE.MeshBasicMaterial({ map: T?.glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  M.clockface = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  M.pave = new THREE.MeshStandardMaterial({ color: 0x8a6a5a, roughness: 0.7, vertexColors: true });
  return M;
}
export { floodPatch, glassPatch, ashlar, toTex, hash, fbm, canvasOf };
