// Scene-space post effects that need the depth buffer, fused into ONE full-screen composite (plus a half-resolution AO chain):
//   * ambient occlusion: depth-only horizon AO at half resolution (normals reconstructed from depth, interleaved-gradient-noise sampling),
//     2 depth-aware blur passes, joint-bilateral upsample in the composite. Gives contact darkening at wall/ground seams, under eaves,
//     balconies, cars and trees, which the baked aerial AO map cannot.
//   * wet-road screen-space reflections (was post/ssr.js): ray-march of the depth buffer for ground pixels near the terrain height.
//   * atmospheric in-scattering: fog towards the sun / moon glows (forward-scattering phase), so low sun and haze look volumetric.
//   * the NaN/Inf guard that protects bloom.
// One pass instead of separate SSR + NaN-guard passes saves a full-screen read/write of the HDR buffer even with AO added.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RT_GLSL, rtUniforms } from './rtworld.js';
import { FINITE_GLSL } from '../world/probe.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COMMON = /* glsl */`
precision highp float;
uniform sampler2D tDepth; uniform mat4 uProj, uProjInv;
varying vec2 vUv;
vec3 viewPos(vec2 uv, float d){ vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
vec3 viewAt(vec2 uv){ return viewPos(uv, texture2D(tDepth, uv).x); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }   // interleaved gradient noise
${FINITE_GLSL}
bool bad3(vec3 c) { return nonFinite(c.r) || nonFinite(c.g) || nonFinite(c.b); }
`;

// ---------------------------------------------------------------------------------------------- AO (half resolution)
const AO_FRAG = COMMON + RT_GLSL + /* glsl */`
uniform vec2 uTexel; uniform float uRadius, uIntensity, uAspect, uMaxDist;
uniform mat4 uCamWorld; uniform vec3 uSunDir; uniform float uSunK, uShHalf; uniform vec2 uShC;
void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv, d); float dist = -P.z;
  // normal from the neighbours with the smaller depth step (no dark halos along silhouettes)
  vec3 pr = viewAt(vUv + vec2(uTexel.x, 0.0)), pl = viewAt(vUv - vec2(uTexel.x, 0.0)), pu = viewAt(vUv + vec2(0.0, uTexel.y)), pd = viewAt(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl, dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy)); if (dot(N, P) > 0.0) N = -N;
  float ao = 1.0;
  float rad = uRadius * (1.0 + dist * 0.004);                                   // grows slowly with distance so far blocks still read
  float rUV = rad * uProj[1][1] / dist * 0.5;                                    // world radius -> uv units (vertical)
  if (dist < uMaxDist && rUV > uTexel.y * 1.5) {
    rUV = min(rUV, 0.12);
    float n = ign(gl_FragCoord.xy), acc = 0.0;
    for (int i = 0; i < DIRS; i++) {
      float a = (float(i) + n) * (6.2831853 / float(DIRS));
      vec2 dir = vec2(cos(a) * uAspect, sin(a)) * rUV;
      float best = 0.0;
      for (int j = 0; j < STEPS; j++) {
        float s = (float(j) + fract(n * 7.31 + float(i) * 0.618)) / float(STEPS);
        vec2 uv = vUv + dir * (s * s * 0.85 + 0.15 * s);
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
        vec3 v = viewAt(uv) - P; float l2 = dot(v, v);
        float h = dot(N, v) * inversesqrt(l2 + 1e-4) - 0.12;                   // sine of the horizon angle above the tangent plane
        h *= clamp(1.0 - l2 / (rad * rad * 1.6), 0.0, 1.0);                      // samples outside the radius do not occlude
        best = max(best, h);
      }
      acc += best;
    }
    ao = clamp(1.0 - acc / float(DIRS) * uIntensity, 0.0, 1.0);
    ao = mix(ao, 1.0, smoothstep(uMaxDist * 0.6, uMaxDist, dist));
  }
  float sh = 0.0;
#ifdef USE_RT_SHADOW
  // ray-traced sun shadow through the city heightfield, only where the shadow map does not reach (its window is +-uShHalf around uShC)
  if (uSunK > 0.01) {
    vec3 W = (uCamWorld * vec4(P, 1.0)).xyz, Nw = normalize(mat3(uCamWorld) * N);
    float out_ = max(abs(W.x - uShC.x), abs(W.y * 0.0 + W.z - uShC.y)) / uShHalf;
    float fade = smoothstep(0.72, 0.95, out_);
    if (fade > 0.0 && dot(Nw, uSunDir) > 0.0) {
      vec3 hn; vec4 hi; float t = traceHF(W + Nw * (0.6 + dist * 0.004) + vec3(0.0, 0.3, 0.0), uSunDir, 900.0, hn, hi);
      sh = (t > 0.0 ? 1.0 : 0.0) * fade;
    }
  }
#endif
  gl_FragColor = vec4(ao, dist, sh, 1.0);
}`;
const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAO; uniform vec2 uStep; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tAO, vUv); float z = c.g; vec2 s = vec2(c.r, c.b); float w = 1.0;
  for (int i = -4; i <= 4; i++) {
    if (i == 0) continue;
    vec4 t = texture2D(tAO, vUv + uStep * float(i));
    float k = exp(-float(i * i) * 0.09) * max(0.0, 1.0 - abs(t.g - z) / (0.02 * z + 0.15));
    s += vec2(t.r, t.b) * k; w += k;
  }
  gl_FragColor = vec4(s.x / w, z, s.y / w, 1.0);
}`;

// ---------------------------------------------------------------------------------------------- composite (full resolution)
const REFL_FRAG = COMMON + RT_GLSL + /* glsl */`
uniform sampler2D tDiffuse, uHeight, tAO, tRefl; uniform vec2 uRTexel;
uniform vec3 uKeyDir, uKeyCol, uAmb; uniform float uSunK;
uniform mat4 uCamWorld;
uniform float uWet, uTime, uDay, uMaxDist, uExt, uAOStrength, uFogDensity;
uniform vec2 uAOTexel;
uniform int uSteps;
uniform vec3 uSky, uSunDir, uSunCol, uMoonDir, uMoonCol;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
float viewZ(vec2 uv, float d){ vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.z / v.w; }
void main(){
  // half resolution: reflection colour premultiplied by its weight (Fresnel x wetness) in rgb, view distance in a (for the bilateral upsample)
  vec4 base = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec3 P = viewPos(vUv, min(d, 0.99999)); float dist = -P.z;
  vec3 Ng = normalize(cross(dFdx(P), dFdy(P)));
  vec4 outc = vec4(0.0, 0.0, 0.0, dist);
  if (d < 0.99999) {
    if (uWet > 0.001) {
      vec3 N = Ng; if (dot(N, P) > 0.0) N = -N;
      vec3 Nw = normalize(mat3(uCamWorld) * N);
      vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
      vec2 hu = (W.xz + uExt) / (2.0 * uExt);
      float dy = (hu.x < 0.0 || hu.x > 1.0 || hu.y < 0.0 || hu.y > 1.0) ? 99.0 : W.y - texture2D(uHeight, hu).r;
      vec3 c = base.rgb; float lum = dot(c, vec3(0.333)); float sat = (max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) / (lum + 0.02);
      float surf = smoothstep(0.9, 0.35, sat) * smoothstep(1.2, 0.25, lum);
      float pud = vnoise(W.xz * 0.11) * 0.55 + vnoise(W.xz * 0.45 + 7.3) * 0.3 + vnoise(W.xz * 1.9) * 0.15;
      float wet = uWet * surf * (0.30 + 0.70 * smoothstep(0.35, 0.62, pud));
      if (Nw.y > 0.9 && dy < 0.55 && dy > -0.4 && wet > 0.02) {
        vec3 V = normalize(P), R = reflect(V, N);
        float F = 0.04 + 0.96 * pow(clamp(1.0 - dot(-V, N), 0.0, 1.0), 5.0);
        vec3 refl = vec3(0.0); float conf = 0.0, ef = 0.0; vec3 hit = vec3(0.0);
        float rw = F * wet * 0.85;                                                // final weight of the reflection in this pixel
        if (rw > 0.012) {                                                         // steep views of wet ground: Fresnel ~4 %, the march would be invisible
        if (R.z < -0.02) {
          float t = 0.25 + ign(gl_FragCoord.xy) * 0.3, stepLen = 0.45; vec2 huv = vec2(0.0);
          for (int i = 0; i < 64; i++) {
            if (i >= uSteps) break;
            vec3 Q = P + R * t; vec4 cl = uProj * vec4(Q, 1.0); vec2 uv = cl.xy / cl.w * 0.5 + 0.5;
            if (cl.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            float sd = texture2D(tDepth, uv).x; if (sd >= 0.99999) { t += stepLen; stepLen *= 1.13; continue; }
            float diff = viewZ(uv, sd) - Q.z;
            if (diff > 0.0 && diff < max(0.5, t * 0.16)) {
              // binary refinement: 4 bisection steps put the hit on the surface (sharper, less stair-stepped reflections)
              float t0 = t - stepLen, t1 = t;
              for (int k = 0; k < 4; k++) { float tm = 0.5 * (t0 + t1); vec3 Qm = P + R * tm; vec4 cm = uProj * vec4(Qm, 1.0); vec2 um = cm.xy / cm.w * 0.5 + 0.5; float dm = viewZ(um, texture2D(tDepth, um).x) - Qm.z; if (dm > 0.0) { t1 = tm; uv = um; } else t0 = tm; }
              huv = uv; conf = 1.0; break;
            }
            t += stepLen; stepLen *= 1.13; if (t > uMaxDist) break;
          }
          if (conf > 0.0) {
            vec2 e = min(huv, 1.0 - huv); ef = smoothstep(0.0, 0.08, min(e.x, e.y));
            hit = texture2D(tDiffuse, huv).rgb; if (bad3(hit)) hit = uSky;
          }
        }
        refl = hit * ef;
  #ifdef USE_RT_REFL
          // hybrid: where the screen-space ray missed (or ran off screen) trace the same ray through the city heightfield
          if (ef < 0.999) {
            vec3 Rw = normalize(mat3(uCamWorld) * R), hn; vec4 hi;
            float tH = traceHF(W + vec3(0.0, 0.15, 0.0), Rw, 900.0, hn, hi);
            vec3 env = mix(uSky * 1.25, uSky * 0.55, smoothstep(0.0, 0.5, Rw.y));
            vec3 rt = env;
            if (tH > 0.0) { vec3 ph = W + Rw * tH; rt = mix(shadeHF(ph, Rw, hn, hi, uKeyDir, uKeyCol, uAmb), env, 1.0 - exp(-uFogDensity * tH)); }
            refl += rt * (1.0 - ef);
          }
  #else
          refl += uSky * (1.0 - ef);
  #endif
        } else refl = uSky;
        outc = vec4(min(refl, vec3(24.0)) * rw, dist);
      }
    }
  }
  if (bad3(outc.rgb)) outc = vec4(0.0, 0.0, 0.0, dist);
  gl_FragColor = outc;
}`;

const COMP_FRAG = COMMON + RT_GLSL + /* glsl */`
uniform sampler2D tDiffuse, uHeight, tAO, tRefl; uniform vec2 uRTexel;
uniform vec3 uKeyDir, uKeyCol, uAmb; uniform float uSunK;
uniform mat4 uCamWorld;
uniform float uWet, uTime, uDay, uMaxDist, uExt, uAOStrength, uFogDensity;
uniform vec2 uAOTexel;
uniform int uSteps;
uniform vec3 uSky, uSunDir, uSunCol, uMoonDir, uMoonCol;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
float viewZ(vec2 uv, float d){ vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.z / v.w; }
void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec3 col = base.rgb;
  vec3 P = viewPos(vUv, min(d, 0.99999)); float dist = -P.z;
  vec3 Ng = normalize(cross(dFdx(P), dFdy(P)));                                   // derivatives taken in uniform control flow
  if (d < 0.99999) {
#ifdef USE_AO
    { // joint-bilateral upsample: of the 4 nearest half-res texels, trust the ones at our depth
      vec2 h = uAOTexel, f = vUv / h - 0.5, b = (floor(f) + 0.5) * h; vec2 fr = fract(f);
      vec4 a0 = texture2D(tAO, b), a1 = texture2D(tAO, b + vec2(h.x, 0.0)), a2 = texture2D(tAO, b + vec2(0.0, h.y)), a3 = texture2D(tAO, b + h);
      vec4 wb = vec4((1.0 - fr.x) * (1.0 - fr.y), fr.x * (1.0 - fr.y), (1.0 - fr.x) * fr.y, fr.x * fr.y);
      vec4 dz = abs(vec4(a0.g, a1.g, a2.g, a3.g) - dist) / (0.03 * dist + 0.1);
      vec4 w = wb * (1.0 / (1.0 + dz * dz * 8.0)) + 1e-4;
      float ao = dot(vec4(a0.r, a1.r, a2.r, a3.r), w) / dot(w, vec4(1.0));
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // emissive / light sources (HDR > ~2) are not occluded
      col *= mix(1.0, ao, uAOStrength * (1.0 - smoothstep(1.6, 4.0, lum)));
  #ifdef USE_RT_SHADOW
      float sh = dot(vec4(a0.b, a1.b, a2.b, a3.b), w) / dot(w, vec4(1.0));
      col *= 1.0 - sh * uSunK * (1.0 - smoothstep(1.6, 4.0, lum));         // traced far-field sun shadow (direct sun share of the pixel)
  #endif
    }
#endif
#ifdef USE_SSR
    { // reflections were traced at half resolution: depth-aware upsample
      vec2 h = uRTexel, f = vUv / h - 0.5, b = (floor(f) + 0.5) * h; vec2 fr = fract(f);
      vec4 r0 = texture2D(tRefl, b), r1 = texture2D(tRefl, b + vec2(h.x, 0.0)), r2 = texture2D(tRefl, b + vec2(0.0, h.y)), r3 = texture2D(tRefl, b + h);
      vec4 wb = vec4((1.0 - fr.x) * (1.0 - fr.y), fr.x * (1.0 - fr.y), (1.0 - fr.x) * fr.y, fr.x * fr.y);
      vec4 dz = abs(vec4(r0.a, r1.a, r2.a, r3.a) - dist) / (0.02 * dist + 0.08);
      vec4 w = wb / (1.0 + dz * dz * 12.0) + 1e-5;
      col += (r0.rgb * w.x + r1.rgb * w.y + r2.rgb * w.z + r3.rgb * w.w) / dot(w, vec4(1.0));
    }
#endif
#ifdef USE_SCATTER
    { // forward in-scattering of the key light in the haze (Henyey-Greenstein-ish lobe), grows with optical depth
      vec3 dirW = normalize(mat3(uCamWorld) * P);
      float od = 1.0 - exp(-uFogDensity * dist);
      float s = max(dot(dirW, uSunDir), 0.0), m = max(dot(dirW, uMoonDir), 0.0);
      col += od * (uSunCol * (pow(s, 6.0) * 0.55 + pow(s, 48.0) * 0.9) + uMoonCol * pow(m, 12.0) * 0.5);
    }
#endif
  }
  if (bad3(col)) col = vec3(0.0);       // NaN/Inf guard, bit-level: D3D's compiler drops isnan()/isinf() (warning X3577), which let Inf through as white
  gl_FragColor = vec4(min(col, vec3(48.0)), 1.0);
}`;

export class SceneFXPass extends Pass {
  constructor({ camera, depthTexture, heightGrid, wetness, quality }) {
    super();
    this.isFxPass = true; this.camera = camera; this.wetness = wetness; this.quality = quality;
    const ssr = !!quality.reflections && !!heightGrid, ao = !!quality.ao, scatter = true;
    const rtRefl = ssr && !!quality.rt, rtShadow = ao && quality.rt === 'full';
    this.useAO = ao; this.useSSR = ssr; this.rt = rtRefl || rtShadow; this.degrade = 0;     // perf governor: 1 = no ray tracing, 2 = + no AO, 3 = + no SSR
    const proj = { uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() } };
    const shared = { uCamWorld: { value: new THREE.Matrix4() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunK: { value: 0 }, ...rtUniforms };
    this.shared = shared;
    const rtSteps = quality.level === 'ultra' ? 72 : 48;
    this.proj = proj;
    // height grid (for "is this pixel ground?" in SSR), half float, relative to the grid base
    let hTex = null, ext = 1;
    if (ssr) {
      const { N, R, base, g } = heightGrid; const half = new Uint16Array(g.length); for (let i = 0; i < g.length; i++) half[i] = THREE.DataUtils.toHalfFloat(g[i] - base);
      hTex = new THREE.DataTexture(half, N, N, THREE.RedFormat, THREE.HalfFloatType); hTex.minFilter = hTex.magFilter = THREE.LinearFilter; hTex.needsUpdate = true; ext = R;
    }
    const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    if (ao) {
      this.aoA = new THREE.WebGLRenderTarget(1, 1, rtOpts); this.aoB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
      const hq = quality.ao === 'high';
      const aoDefines = { DIRS: hq ? 8 : 6, STEPS: hq ? 6 : 4, RT_COARSE_STEPS: rtSteps }; if (rtShadow) aoDefines.USE_RT_SHADOW = '';
      this.aoMat = new THREE.ShaderMaterial({ defines: aoDefines, uniforms: { tDepth: { value: depthTexture }, ...proj, ...shared, uShHalf: { value: 140 }, uShC: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: hq ? 1.9 : 1.6 }, uIntensity: { value: 1.25 }, uAspect: { value: 1 }, uMaxDist: { value: hq ? 420 : 260 } }, vertexShader: VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false });
      this.blurMat = new THREE.ShaderMaterial({ uniforms: { tAO: { value: null }, uStep: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    }
    const defines = { RT_COARSE_STEPS: rtSteps }; if (ssr) defines.USE_SSR = ''; if (ao) defines.USE_AO = ''; if (scatter) defines.USE_SCATTER = ''; if (rtRefl) defines.USE_RT_REFL = ''; if (rtShadow) defines.USE_RT_SHADOW = '';
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: depthTexture }, uHeight: { value: hTex }, tAO: { value: this.aoA?.texture ?? null }, ...proj, ...shared,
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
      uWet: { value: 1 }, uTime: { value: 0 }, uDay: { value: 0 }, uMaxDist: { value: quality.level === 'ultra' ? 110 : 70 }, uExt: { value: ext },
      uSteps: { value: quality.level === 'ultra' ? 48 : quality.level === 'high' ? 32 : 22 }, tRefl: { value: null }, uRTexel: { value: new THREE.Vector2() }, uSky: { value: new THREE.Color(0.03, 0.025, 0.05) },
      uAOStrength: { value: 0.85 }, uAOTexel: { value: new THREE.Vector2() }, uFogDensity: { value: 0.00075 },
      uSunCol: { value: new THREE.Color(0, 0, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonCol: { value: new THREE.Color(0, 0, 0) },
    };
    this.compMat = new THREE.ShaderMaterial({ defines, uniforms: this.uniforms, vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false });
    if (ssr) {   // reflections (SSR + traced fallback) at half resolution: ~4x fewer ray marches, bilateral upsample in the composite
      this.reflRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.reflMat = new THREE.ShaderMaterial({ defines, uniforms: this.uniforms, vertexShader: VERT, fragmentShader: REFL_FRAG, depthTest: false, depthWrite: false });
      this.uniforms.tRefl.value = this.reflRT.texture;
    }
    this.fsq = new FullScreenQuad(this.compMat);
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    if (this.reflRT) { this.reflRT.setSize(hw, hh); this.uniforms.uRTexel.value.set(1 / hw, 1 / hh); }
    if (!this.useAO) return;
    this.aoA.setSize(hw, hh); this.aoB.setSize(hw, hh);
    this.aoMat.uniforms.uTexel.value.set(1 / hw, 1 / hh); this.aoMat.uniforms.uAspect.value = h / w; this.uniforms.uAOTexel.value.set(1 / hw, 1 / hh);
  }
  /** per-frame state from main.js */
  update({ time, fog, day, dusk, sunDir, sunCol, moonDir, moonCol, fogDensity, keyDir, keyCol, amb, shadowCenter, shadowHalf }) {
    const u = this.uniforms, c = this.camera;
    this.proj.uProj.value.copy(c.projectionMatrix); this.proj.uProjInv.value.copy(c.projectionMatrixInverse); u.uCamWorld.value.copy(c.matrixWorld);
    u.uWet.value = this.wetness.value; u.uTime.value = time % 10; u.uDay.value = day; u.uSky.value.copy(fog).multiplyScalar(0.55 + 0.35 * day);
    u.uFogDensity.value = fogDensity; u.uSunDir.value.copy(sunDir); u.uMoonDir.value.copy(moonDir);
    u.uSunCol.value.copy(sunCol).multiplyScalar(day * 0.9 + dusk * 1.6); u.uMoonCol.value.copy(moonCol).multiplyScalar((1 - day) * 0.25);
    u.uAOStrength.value = 0.62 + 0.28 * day;
    if (keyDir) { u.uKeyDir.value.copy(keyDir); u.uKeyCol.value.copy(keyCol); u.uAmb.value.copy(amb); }
    this.shared.uNight.value = 1 - day;
    this.shared.uRTon.value = rtUniforms.uHF.value && this.degrade < 1 ? 1 : 0;
    if (this.degrade >= 2) u.uAOStrength.value = 0;
    if (this.degrade >= 3) u.uWet.value = 0;
    this.shared.uSunK.value = Math.max(0, day - 0.15) * 0.62 + dusk * 0.35;            // share of direct sun in a sunlit pixel (what a traced shadow removes)
    if (this.aoMat && shadowCenter) { this.aoMat.uniforms.uShC.value.set(shadowCenter.x, shadowCenter.z); this.aoMat.uniforms.uShHalf.value = shadowHalf; }                    // night: most light is local and already falls off; day: sky light is occluded more
  }
  render(renderer, writeBuffer, readBuffer) {
    if (this.useAO && this.degrade < 2) {
      this.fsq.material = this.aoMat; renderer.setRenderTarget(this.aoA); this.fsq.render(renderer);
      const t = this.aoMat.uniforms.uTexel.value; this.fsq.material = this.blurMat;
      this.blurMat.uniforms.tAO.value = this.aoA.texture; this.blurMat.uniforms.uStep.value.set(t.x, 0); renderer.setRenderTarget(this.aoB); this.fsq.render(renderer);
      this.blurMat.uniforms.tAO.value = this.aoB.texture; this.blurMat.uniforms.uStep.value.set(0, t.y); renderer.setRenderTarget(this.aoA); this.fsq.render(renderer);
      this.fsq.material = this.compMat;
    }
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.reflRT) { this.fsq.material = this.reflMat; renderer.setRenderTarget(this.reflRT); this.fsq.render(renderer); this.fsq.material = this.compMat; }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsq.render(renderer);
  }
  dispose() { this.reflRT?.dispose(); this.reflMat?.dispose(); this.aoA?.dispose(); this.aoB?.dispose(); this.aoMat?.dispose(); this.blurMat?.dispose(); this.compMat.dispose(); this.fsq.dispose(); }
}
