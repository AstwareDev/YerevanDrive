// Shared quality presets. Override with ?q=low|med|high|ultra in the URL (or Settings > Graphics). Every feature (textures, shadows, reflections,
// props, LOD distances) must read from `quality` so the game can scale down.
//
// Cost model (what each knob buys on a GTX 1660 S + slow Xeon class machine, the reference "weak PC"):
//   budget     max internal render pixels (the pixel ratio is clamped so width*height*PR^2 <= budget): the single biggest GPU + VRAM lever
//   lights     pooled street-lamp point lights: every one is paid per pixel in every lit material
//   shadowEvery  re-render the shadow map every N frames (the shadow pass doubles the draw calls, i.e. CPU time)
//   aerial     texture sizes of the photo layers (VRAM: 4096^2 RGBA + mips = 89 MB each)
//   ao / rt / probe / fx   screen-space AO, ray-traced reflections/shadows, live reflection probe, scene post chain (low runs without it)
//   clouds     0 = 2D procedural cloud decks, 1 = volumetric raymarched clouds (12 steps), 2 = volumetric, full quality (22 steps, 3 light taps); ?clouds=0|1|2
const PRESETS = {
  low:  { texSize: 512,  anisotropy: 4,  shadows: false, shadowMap: 1024, shadowEvery: 1, reflections: false, reflectionScale: 0.35, bloom: false, msaa: 0, pixelRatio: 1.0, budget: 1.5e6, propScale: 0.35, carDetail: 0, treeDetail: 0, detailRadius: 220, lodScale: 0.6,  farRadius: 5000,  lights: 2,  ao: false, rt: false,  probe: false, fx: false, aerial: { near: 2048, mid: 2048, hi: 0,    road: 0 }, clouds: 0 },
  med:  { texSize: 1024, anisotropy: 8,  shadows: true,  shadowMap: 2048, shadowEvery: 2, reflections: true,  reflectionScale: 0.4,  bloom: true,  msaa: 2, pixelRatio: 1.0, budget: 2.6e6, propScale: 0.7,  carDetail: 1, treeDetail: 1, detailRadius: 380, lodScale: 0.85, farRadius: 9000,  lights: 5,  ao: 'low', rt: false, probe: false, fx: true,  aerial: { near: 2048, mid: 2048, hi: 2048, road: 2048 }, clouds: 0 },
  high: { texSize: 1024, anisotropy: 16, shadows: true,  shadowMap: 3072, shadowEvery: 1, reflections: true,  reflectionScale: 0.6,  bloom: true,  msaa: 4, pixelRatio: 1.5, budget: 4.2e6, propScale: 1.0,  carDetail: 2, treeDetail: 2, detailRadius: 520, lodScale: 1.0,  farRadius: 14000, lights: 9,  ao: 'low', rt: 'refl', probe: true, fx: true, aerial: { near: 4096, mid: 2048, hi: 4096, road: 4096 }, clouds: 1 },
  // opt-in only (menu or ?q=ultra, never auto-detected): the culling/LOD savings are spent on resolution, shadows, reflections and draw distance. The perf governor still scales down if fps drops.
  ultra: { texSize: 2048, anisotropy: 16, shadows: true, shadowMap: 4096, shadowEvery: 1, reflections: true,  reflectionScale: 0.8,  bloom: true,  msaa: 4, pixelRatio: 2.0, supersample: 1.5, budget: 5.6e6, propScale: 1.0,  carDetail: 2, treeDetail: 2, detailRadius: 700, lodScale: 1.35, farRadius: 18000, lights: 14, ao: 'high', rt: 'full', probe: true, fx: true, aerial: { near: 4096, mid: 4096, hi: 4096, road: 4096 }, clouds: 2 },
};
const ORDER = ['low', 'med', 'high', 'ultra'];
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } } };
// the boot flag lives in sessionStorage: per tab (a second tab loading at the same time must not look like a crash) and it survives a reload of a crashed tab
const SS = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }, del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } } };
const P = new URLSearchParams(location.search);

/** GPU + device class -> the best preset the machine can hold. Auto mode only; never returns 'ultra'. */
function detect() {
  let r = '';
  try { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''; } catch { /* ignore */ }
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory ?? 8;
  const touch = (navigator.maxTouchPoints || 0) > 1 && !matchMedia('(pointer: fine)').matches;       // phones / tablets (iPadOS reports a Mac, touch tells it apart)
  let tier = 'med';
  if (/RTX (30[7-9]|40|50)|RX (6[789]|7)\d\d|Apple M[1-9]/i.test(r)) tier = 'high';
  else if (/Intel|UHD|Iris|Adreno|Mali|PowerVR|Vega \d|Radeon\(TM\) Graphics|Radeon Graphics|Microsoft Basic|SwiftShader|llvmpipe|GT [0-9]{3}\b|MX ?\d{3}/i.test(r) && !/Arc A[5-7]/.test(r)) tier = 'low';
  else if (/Apple/i.test(r)) tier = touch ? 'low' : 'med';
  if (touch) tier = 'low';
  if (mem <= 4 || cores <= 2) tier = 'low';
  else if (cores <= 4 && tier === 'high') tier = 'med';
  return tier;
}

// ---- crash recovery: the page sets a flag while it is loading and clears it once the loading screen is gone (or the page is left normally).
// If the flag is still set at the next start, the browser died during loading (out of memory / GPU reset): the next start is capped one tier lower.
let crashed = false;
{
  const boot = SS.get('yd.boot');
  if (boot) { try { const b = JSON.parse(boot); if (Date.now() - b.t < 20 * 60e3) crashed = true; } catch { crashed = true; } }
  SS.del('yd.boot');
}

const saved = LS.get('yd.q'), asked = P.get('q') || saved;
let level = asked && PRESETS[asked] ? asked : detect();
if (crashed && !(asked && PRESETS[asked])) { const cur = ORDER.indexOf(LS.get('yd.cap') && PRESETS[LS.get('yd.cap')] ? LS.get('yd.cap') : level); LS.set('yd.cap', ORDER[Math.max(0, Math.min(cur, ORDER.indexOf(level)) - 1)]); }
const cap = LS.get('yd.cap');
const capped = !(asked && PRESETS[asked]) && cap && PRESETS[cap] && ORDER.indexOf(level) > ORDER.indexOf(cap);
if (capped) level = cap;

export const quality = { level, ...PRESETS[level], requested: asked && PRESETS[asked] ? asked : 'auto', crashRecovered: crashed, capped: !!capped, auto: !(asked && PRESETS[asked]) };
// Texture resolution is its own setting (menu "Textures" / ?tex=512|1024|2048), independent of the preset.
{ const t = +(P.get('tex') || LS.get('yd.tex') || 0); if ([512, 1024, 2048].includes(t)) quality.texSize = t; }
// Feature overrides for A/B testing: ?ao=0|low|high  ?rt=0|refl|full  ?probe=0|1  ?lights=N  ?shadowEvery=N
{
  const f = v => (v === '0' || v === 'false' ? false : v === '1' ? true : v);
  for (const k of ['ao', 'rt', 'probe']) if (P.has(k)) quality[k] = f(P.get(k));
  for (const k of ['lights', 'shadowEvery', 'msaa', 'clouds']) if (P.has(k)) quality[k] = Math.max(0, +P.get(k) | 0);
}
quality.fx = quality.fx || !!quality.ao || !!quality.reflections;

/** Final render scale: device ratio, optionally supersampled (ultra renders 1.5x above native so a 1x monitor is still sharper than High),
 *  capped by `pixelRatio` and by the pixel budget (a 1440p monitor at 1.5x supersampling is a 4K render: 8.3 M pixels with 4x MSAA). */
export function renderScale(w = innerWidth, h = innerHeight) {
  const want = Math.min(devicePixelRatio * (quality.supersample ?? 1), quality.pixelRatio);
  const fit = Math.sqrt(quality.budget / Math.max(1, w * h));
  const forced = +P.get('pr');
  return forced > 0 ? forced : Math.max(0.5, Math.min(want, fit));
}
quality.targetPR = renderScale();
export const qualityLevels = PRESETS;
export const qualityOrder = ORDER;

/** main.js: call when the loading screen closed. Clears the crash flag. */
export function bootStart() { SS.set('yd.boot', JSON.stringify({ t: Date.now(), q: level })); addEventListener('pagehide', () => SS.del('yd.boot')); }
export function bootDone() { SS.del('yd.boot'); }
/** Settings > Graphics: an explicit choice lifts the automatic crash cap. */
export function clearCap() { LS.del('yd.cap'); }
