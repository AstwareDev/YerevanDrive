// Shared quality presets. Target: GTX 1660 Super / laptops at 60 fps. Override with ?q=low|med|high in the URL.
// Every feature (textures, shadows, reflections, props, LOD distances) must read from `quality` so the game can scale down.
// ao: screen-space AO ('low' 6x4 / 'high' 8x6 taps, half res) · rt: hybrid ray tracing through the city heightfield (post/rtworld.js):
// 'refl' = traced reflections where screen-space rays miss, 'full' = + traced sun shadows beyond the shadow map · probe: live reflection probe
const PRESETS = {
  low:  { texSize: 512,  anisotropy: 4,  shadows: false, shadowMap: 1024, reflections: false, reflectionScale: 0.35, bloom: false, msaa: 0, pixelRatio: 1.0, propScale: 0.35, carDetail: 0, treeDetail: 0, detailRadius: 220, lodScale: 0.6, farRadius: 5000, ao: false, rt: false, probe: false },
  med:  { texSize: 1024, anisotropy: 8,  shadows: true,  shadowMap: 2048, reflections: true,  reflectionScale: 0.4,  bloom: true,  msaa: 2, pixelRatio: 1.25, propScale: 0.7,  carDetail: 1, treeDetail: 1, detailRadius: 380, lodScale: 0.85, farRadius: 9000, ao: 'low', rt: false, probe: false },
  high: { texSize: 2048, anisotropy: 16, shadows: true,  shadowMap: 4096, reflections: true,  reflectionScale: 0.6,  bloom: true,  msaa: 4, pixelRatio: 1.5,  propScale: 1.0,  carDetail: 2, treeDetail: 2, detailRadius: 520, lodScale: 1.0,  farRadius: 14000, ao: 'low', rt: 'refl', probe: true },
  // opt-in only (menu or ?q=ultra, never auto-detected): the culling/LOD savings are spent on resolution, shadows, reflections and draw distance. The perf governor still scales down if fps drops.
  ultra: { texSize: 2048, anisotropy: 16, shadows: true, shadowMap: 6144, reflections: true,  reflectionScale: 0.8,  bloom: true,  msaa: 4, pixelRatio: 2.0, supersample: 1.5, propScale: 1.0,  carDetail: 2, treeDetail: 2, detailRadius: 700, lodScale: 1.35, farRadius: 18000, ao: 'high', rt: 'full', probe: true },
};
function detect() {
  let saved = null; try { saved = localStorage.getItem('yd.q'); } catch { /* ignore */ }
  const q = new URLSearchParams(location.search).get('q') || saved;
  if (q && PRESETS[q]) return q;
  try {
    const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/RTX (30[7-9]|40|50)|RX (6[789]|7)\d\d/i.test(r)) return 'high';
    if (/Intel|UHD|Iris|Apple|Adreno|Mali|Vega|Radeon\(TM\) Graphics|Microsoft Basic|SwiftShader/i.test(r) && !/Arc A[5-7]/.test(r)) return 'low';
  } catch { /* ignore */ }
  return 'med';
}
const level = detect();
export const quality = { level, ...PRESETS[level] };
// Texture resolution is its own setting (menu "Textures" / ?tex=512|1024|2048), independent of the preset.
try { const t = +(new URLSearchParams(location.search).get('tex') || localStorage.getItem('yd.tex') || 0); if ([512, 1024, 2048].includes(t)) quality.texSize = t; } catch { /* ignore */ }
// Feature overrides for A/B testing: ?ao=0|low|high  ?rt=0|refl|full  ?probe=0|1
try {
  const P = new URLSearchParams(location.search), f = v => (v === '0' || v === 'false' ? false : v === '1' ? true : v);
  for (const k of ['ao', 'rt', 'probe']) if (P.has(k)) quality[k] = f(P.get(k));
} catch { /* ignore */ }
// Final render scale: device ratio, optionally supersampled (ultra renders 1.5x above native so a 1x monitor is still sharper than High), capped by `pixelRatio`.
quality.targetPR = Math.min(devicePixelRatio * (quality.supersample ?? 1), quality.pixelRatio);
export const qualityLevels = PRESETS;
