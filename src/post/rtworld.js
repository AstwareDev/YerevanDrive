// Hybrid ray tracing, world part. WebGL has no hardware ray tracing, so rays are traced in the fragment shader through a GPU proxy of
// the city: a 2 m heightfield (terrain + every building footprint extruded to its real height, from public/map/colliders.json) with a
// 16 m max-height level for empty-space skipping (two-level "Hi-Z"-style march + linear refine + bisection). Used by post/scenefx.js for
//   * ray-traced reflections where screen-space rays fail (reflected object off screen / behind something): facades with lit windows,
//     rooftops and streets from the aerial photo, distant road glow at night, sky otherwise;
//   * ray-traced sun shadows beyond the 280 m shadow-map window (whole-city shadows in day / dusk views).
// The bake runs in a worker (src/post/rtbake.worker.js) so loading is not blocked; until it arrives the tracer is switched off (uRTon = 0).
import * as THREE from 'three';
import { shared } from '../materials.js';
import { fetchJSON } from '../net.js';
import { farShared } from '../world/farMaterials.js';

export const RT = { CELL: 2, COARSE: 8, rect: { x0: -2688, z0: -3712, w: 3840, h: 4864 } };     // REGION (tools/config.mjs) + 128 m apron

export const rtUniforms = {
  uRTon: { value: 0 }, uHF: { value: null }, uHFc: { value: null }, uHFRect: { value: new THREE.Vector4(RT.rect.x0, RT.rect.z0, 1 / RT.rect.w, 1 / RT.rect.h) },
  uHFTexel: { value: new THREE.Vector2(1, 1) }, uAerialRT: shared.uAerial, uLightsRT: farShared.uLights, uNight: { value: 1 },     // aerial photo / far night-lights holders fill in as they load
};

// GLSL: world-space heightfield tracer (needs the uniforms above)
export const RT_GLSL = /* glsl */`
uniform float uRTon, uNight; uniform sampler2D uHF, uHFc, uAerialRT, uLightsRT; uniform vec4 uHFRect; uniform vec2 uHFTexel;
vec2 hfUV(vec2 xz) { return (xz - uHFRect.xy) * uHFRect.zw; }
// returns t of the first hit (or -1). hitN = surface normal, hitInfo = (top, ground, seed, isWall)
float traceHF(vec3 ro, vec3 rd, float tMax, out vec3 hitN, out vec4 hitInfo) {
  hitN = vec3(0.0, 1.0, 0.0); hitInfo = vec4(0.0);
  if (uRTon < 0.5) return -1.0;
  float t = 0.6; const float CS = 16.0;                                   // coarse cell = 8 x 2 m
  for (int i = 0; i < RT_COARSE_STEPS; i++) {
    vec3 p = ro + rd * t; vec2 uv = hfUV(p.xz);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1.0;
    float hc = textureLod(uHFc, uv, 0.0).r;
    if (p.y < hc) {                                                         // something in this 16 m cell is above the ray: walk it at 1 m
      float tf = max(t - CS * 0.75, 0.3), prevY = 0.0; bool prevWall = false; float tPrev = tf;
      for (int j = 0; j < 28; j++) {
        vec3 q = ro + rd * tf; vec4 h = textureLod(uHF, hfUV(q.xz), 0.0);
        if (q.y < h.r) {
          float a = tPrev, b = tf;                                         // bisection between the last free and the first blocked sample
          for (int k = 0; k < 5; k++) { float m = 0.5 * (a + b); vec3 qm = ro + rd * m; if (qm.y < textureLod(uHF, hfUV(qm.xz), 0.0).r) b = m; else a = m; }
          vec3 qh = ro + rd * b; vec4 hh = textureLod(uHF, hfUV(qh.xz), 0.0);
          bool wall = hh.b > 0.0 && qh.y < hh.r - 0.35;                   // entered a building through its side
          if (wall) {
            vec2 e = uHFTexel; float hl = textureLod(uHF, hfUV(qh.xz) - vec2(e.x, 0.0), 0.0).r, hr = textureLod(uHF, hfUV(qh.xz) + vec2(e.x, 0.0), 0.0).r;
            float hd = textureLod(uHF, hfUV(qh.xz) - vec2(0.0, e.y), 0.0).r, hu = textureLod(uHF, hfUV(qh.xz) + vec2(0.0, e.y), 0.0).r;
            vec3 n = vec3(hl - hr, 0.0, hd - hu); hitN = dot(n, n) > 1e-4 ? normalize(n) : normalize(vec3(-rd.x, 0.0, -rd.z));
            if (dot(hitN, rd) > 0.0) hitN = -hitN;
          }
          hitInfo = vec4(hh.r, hh.g, hh.b, wall ? 1.0 : 0.0); return b;
        }
        tPrev = tf; tf += 1.0; if (tf > t + CS * 0.5) break;
      }
    }
    // step: at least half a coarse cell; much longer when far above the local maximum
    t += max(CS * 0.5, (p.y - hc) * 0.7);
    if (t > tMax) return -1.0;
  }
  return -1.0;
}
// shading of a traced hit (proxy materials, consistent with the far-LOD buildings in world/farMaterials.js)
vec3 shadeHF(vec3 p, vec3 rd, vec3 n, vec4 info, vec3 sunDir, vec3 sunCol, vec3 amb) {
  vec2 nuv = vec2((p.x + 3072.0) / 4608.0, 1.0 - (p.z + 3584.0) / 4608.0);   // aerial window (NEAR, see src/materials.js)
  if (info.a > 0.5) {
    float s = info.b;
    vec3 wallC = s < 0.55 ? mix(vec3(0.62, 0.36, 0.25), vec3(0.75, 0.52, 0.36), fract(s * 7.0)) : mix(vec3(0.52, 0.5, 0.47), vec3(0.72, 0.66, 0.56), fract(s * 5.0));
    vec2 wc = vec2(dot(p.xz, vec2(-n.z, n.x)) / 3.4, (p.y - info.g) / 3.1); vec2 f = fract(wc), id = floor(wc);
    float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) * step(f.y, 0.8) * step(1.0, wc.y);
    float h = fract(sin(dot(id + s * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 c = wallC * mix(1.0, 0.25, win) * (amb + sunCol * max(dot(n, sunDir), 0.0));
    c += win * step(h, 0.38) * uNight * vec3(1.0, 0.72, 0.42) * 2.2;          // lit windows at night
    return c;
  }
  vec3 aer = texture2D(uAerialRT, nuv).rgb;
  vec3 c = aer * (amb + sunCol * max(n.y * sunDir.y, 0.0) + 0.0);
  if (info.b <= 0.0) { vec3 lt = texture2D(uLightsRT, vec2((p.x + 4400.0) / 8800.0, 1.0 - (p.z + 4400.0) / 8800.0)).rgb; c += uNight * vec3(1.0, 0.55, 0.22) * lt.r * 1.4; }  // street-light glow
  return c;
}
`;

/** start the bake; resolves when the textures are live (tracer switches itself on) */
export async function initRTWorld({ heightGrid }) {
  const col = await fetchJSON('/map/colliders.json');
  const buildings = col.buildings.filter(b => b.r?.length >= 6 && Number.isFinite(b.b)).map(b => ({ r: b.r, b: b.b }));
  const worker = new Worker(new URL('./rtbake.worker.js', import.meta.url), { type: 'module' });
  const { N, STEP, R, base, g } = heightGrid;
  const res = await new Promise((ok, fail) => { worker.onmessage = e => ok(e.data); worker.onerror = fail; worker.postMessage({ buildings, hg: { N, STEP, R, base, g: Float32Array.from(g) }, rect: RT.rect, cell: RT.CELL, coarse: RT.COARSE }); });
  worker.terminate();
  const fine = new THREE.DataTexture(res.fine, res.W, res.H, THREE.RGBAFormat, THREE.HalfFloatType); fine.minFilter = fine.magFilter = THREE.NearestFilter; fine.flipY = false; fine.needsUpdate = true;
  const coarse = new THREE.DataTexture(res.coarse, res.CW, res.CH, THREE.RedFormat, THREE.HalfFloatType); coarse.minFilter = coarse.magFilter = THREE.NearestFilter; coarse.needsUpdate = true;
  rtUniforms.uHF.value = fine; rtUniforms.uHFc.value = coarse; rtUniforms.uHFTexel.value.set(1 / res.W, 1 / res.H); rtUniforms.uRTon.value = 1;
  console.log(`rt: city heightfield ${res.W}x${res.H} @ ${RT.CELL} m (${buildings.length} buildings), coarse ${res.CW}x${res.CH}`);
  return rtUniforms;
}
