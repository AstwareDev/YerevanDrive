// Shared quality presets. Target: GTX 1660 Super / laptops at 60 fps. Override with ?q=low|med|high in the URL.
// Every feature (textures, shadows, reflections, props, LOD distances) must read from `quality` so the game can scale down.
const PRESETS = {
  low:  { texSize: 512,  anisotropy: 4,  shadows: false, shadowMap: 1024, reflections: false, reflectionScale: 0.35, bloom: false, msaa: 0, pixelRatio: 1.0, propScale: 0.35, carDetail: 0, treeDetail: 0, detailRadius: 220, lodScale: 0.6, farRadius: 5000 },
  med:  { texSize: 1024, anisotropy: 8,  shadows: true,  shadowMap: 2048, reflections: true,  reflectionScale: 0.4,  bloom: true,  msaa: 2, pixelRatio: 1.25, propScale: 0.7,  carDetail: 1, treeDetail: 1, detailRadius: 380, lodScale: 0.85, farRadius: 9000 },
  high: { texSize: 2048, anisotropy: 16, shadows: true,  shadowMap: 4096, reflections: true,  reflectionScale: 0.6,  bloom: true,  msaa: 4, pixelRatio: 1.5,  propScale: 1.0,  carDetail: 2, treeDetail: 2, detailRadius: 520, lodScale: 1.0,  farRadius: 14000 },
};
function detect() {
  const q = new URLSearchParams(location.search).get('q');
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
export const qualityLevels = PRESETS;
