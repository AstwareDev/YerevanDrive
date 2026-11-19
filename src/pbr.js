// Real CC0 PBR texture library (ambientCG; built by tools/build-textures.mjs into public/tex/).
// The app renders immediately with the old procedural look; materials hold stable uniform "slots" that this loader fills in
// (one texture set per frame, so uploads never hitch) and then flips `on` to 1 -> the shaders cross over to the photographic maps.
import * as THREE from 'three';
import { quality } from './quality.js';

const BASE = '/tex/';
const blank = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); blank.needsUpdate = true;
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
const blankRF = new THREE.DataTexture(new Uint8Array([128, 128, 128, 0]), 1, 1); blankRF.needsUpdate = true;

export const pbr = {
  manifest: null,
  ready: false,
  slots: {},                          // name -> { albedo, normal, orm: {value}, on: {value}, inv: {value 1/scale}, avg: {value Vector3 linear}, size }
  roadField: { value: blankRF },      // world-space road direction / lateral position raster (see build-textures.mjs)
  roadFieldOn: { value: 0 },
  decalMask: { value: white },        // R rubber streaks, G cracks, B stains (seamless, 6 m)
  decalMaskOn: { value: 0 },
  wantMask: false,
};

/** Stable uniform holders for one set. Safe to call before the textures exist. */
export function slot(name) {
  let s = pbr.slots[name];
  if (!s) s = pbr.slots[name] = { albedo: { value: white }, normal: { value: blank }, orm: { value: white }, on: { value: 0 }, inv: { value: 0.5 }, avg: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, size: 0, name };
  return s;
}

const frame = () => new Promise(res => { let done = false; const f = () => { if (!done) { done = true; res(); } }; requestAnimationFrame(f); setTimeout(f, 80); });

function loadBitmap(url, loader) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
function makeTexture(bitmap, { srgb, aniso, repeat = true, mips = true }) {
  const t = new THREE.Texture(bitmap);
  t.flipY = false; t.premultiplyAlpha = false;                       // the bitmap is already flipped at decode time
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = mips; t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  t.onUpdate = () => { try { bitmap.close(); } catch { /* ignore */ } t.onUpdate = null; };   // free the CPU copy once uploaded
  return t;
}

const PRIORITY = ['asphalt_fine', 'asphalt_road', 'road_decals', 'sidewalk_slab', 'plaza_tuff', 'plaster_a', 'tuff_block_a', 'concrete_dark', 'grass_short', 'terrain_earth', 'dirt', 'roof_clay', 'roof_bitumen', 'plaster_b', 'concrete_light', 'decal_manhole', 'metal_dark'];

/** Starts loading everything in the background. Resolves (never rejects) with { name: {albedo, normal, orm} } once all sets are in. */
export async function loadPBR(renderer) {
  const textures = {};
  try {
    const manifest = await (await fetch(BASE + 'manifest.json')).json();
    pbr.manifest = manifest;
    if (!window.createImageBitmap) throw new Error('createImageBitmap unavailable');
    const aniso = Math.min(quality.anisotropy, renderer.capabilities.getMaxAnisotropy());
    const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    // road field: raw RGBA, no mipmaps, bilinear
    if (manifest.roadfield && quality.level !== 'low') {
      try { const bm = await loadBitmap(BASE + manifest.roadfield.file, loader); const t = makeTexture(bm, { srgb: false, aniso: 1, repeat: false, mips: false }); renderer.initTexture(t); pbr.roadField.value = t; pbr.roadFieldOn.value = 1; } catch (e) { console.warn('roadfield missing', e); }
    }
    // only sets some material asked for via slot() (and the shared decal mask) are fetched: keeps VRAM and bandwidth down
    const asked = n => manifest.sets[n] && (pbr.slots[n] || (n === 'road_decals' && pbr.wantMask));
    const names = [...PRIORITY.filter(asked), ...Object.keys(manifest.sets).filter(n => !PRIORITY.includes(n) && asked(n))];
    for (const name of names) {
      const info = manifest.sets[name];
      const want = info.kind === 'mask' ? Math.min(1024, quality.texSize) : quality.texSize;
      const size = [...info.sizes].sort((a, b) => a - b).filter(s => s <= want).pop() ?? info.sizes[0];
      try {
        if (info.kind === 'mask') {
          if (quality.level === 'low') continue;
          const bm = await loadBitmap(`${BASE}${name}/mask_${size}.webp`, loader);
          const t = makeTexture(bm, { srgb: false, aniso, repeat: true }); renderer.initTexture(t);
          pbr.decalMask.value = t; pbr.decalMaskOn.value = 1; textures[name] = { mask: t }; await frame(); continue;
        }
        if (info.kind === 'decal' && quality.level === 'low') continue;
        const [a, n, o] = await Promise.all(['albedo', 'normal', 'orm'].map(k => loadBitmap(`${BASE}${name}/${k}_${size}.webp`, loader)));
        const decal = info.kind === 'decal';
        const ta = makeTexture(a, { srgb: true, aniso, repeat: !decal }), tn = makeTexture(n, { srgb: false, aniso, repeat: !decal }), to = makeTexture(o, { srgb: false, aniso, repeat: !decal });
        for (const t of [ta, tn, to]) renderer.initTexture(t);
        const s = slot(name);
        s.albedo.value = ta; s.normal.value = tn; s.orm.value = to; s.size = size;
        s.inv.value = 1 / info.scale; s.avg.value.set(info.avg[0], info.avg[1], info.avg[2]);   // linear-light mean albedo
        s.on.value = 1;
        textures[name] = { albedo: ta, normal: tn, orm: to, size };
        await frame();                                              // one set per frame: no upload hitches
      } catch (e) { console.warn('pbr set failed', name, e); }
    }
    pbr.ready = true;
    console.log(`pbr: ${Object.keys(textures).length} texture sets ready (q=${quality.level}, ${quality.texSize}px)`);
  } catch (e) { console.warn('PBR textures unavailable, keeping procedural surfaces:', e.message ?? e); }
  return textures;
}
