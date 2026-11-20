// Screen-space reflections for wet ground (asphalt / pavers). Ray-marches the depth buffer and reflects the HDR colour buffer, so neon,
// street lamps and lit windows streak across the road. Only pixels whose normal is ~up AND whose height matches the terrain grid
// (so roofs/cars are excluded) and that look like dark neutral surfaces (not vegetation) receive reflections.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse, tDepth, uHeight;
uniform mat4 uProj, uProjInv, uCamWorld;
uniform float uWet, uTime, uDay, uMaxDist, uExt;
uniform int uSteps;
uniform vec3 uSky;
varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
vec3 viewPos(vec2 uv, float d){ vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
float viewZ(vec2 uv, float d){ vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.z / v.w; }
void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  gl_FragColor = base;
  if (d >= 0.99999 || uWet <= 0.001) return;
  vec3 P = viewPos(vUv, d);
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  if (dot(N, P) > 0.0) N = -N;
  vec3 Nw = normalize(mat3(uCamWorld) * N);
  if (Nw.y < 0.9) return;
  vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
  vec2 hu = (W.xz + uExt) / (2.0 * uExt);
  if (hu.x < 0.0 || hu.x > 1.0 || hu.y < 0.0 || hu.y > 1.0) return;
  float dy = W.y - texture2D(uHeight, hu).r;
  if (dy > 0.55 || dy < -0.4) return;
  // looks like asphalt / pavement: dark-ish and not saturated (grass, plaza photos, cars excluded)
  vec3 c = base.rgb; float lum = dot(c, vec3(0.333)); float sat = (max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) / (lum + 0.02);
  float surf = smoothstep(0.9, 0.35, sat) * smoothstep(1.2, 0.25, lum);
  // patchy puddles that stay stable in world space
  float pud = vnoise(W.xz * 0.11) * 0.55 + vnoise(W.xz * 0.45 + 7.3) * 0.3 + vnoise(W.xz * 1.9) * 0.15;
  float wet = uWet * surf * (0.30 + 0.70 * smoothstep(0.35, 0.62, pud));
  if (wet < 0.02) return;
  vec3 V = normalize(P), R = reflect(V, N);
  float F = 0.04 + 0.96 * pow(clamp(1.0 - dot(-V, N), 0.0, 1.0), 5.0);
  vec3 refl = uSky; float conf = 0.0;
  if (R.z < -0.02) {
    float t = 0.25 + hash(gl_FragCoord.xy) * 0.3, stepLen = 0.45; vec2 huv = vec2(0.0);
    for (int i = 0; i < 40; i++) {
      if (i >= uSteps) break;
      vec3 Q = P + R * t; vec4 cl = uProj * vec4(Q, 1.0); vec2 uv = cl.xy / cl.w * 0.5 + 0.5;
      if (cl.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sd = texture2D(tDepth, uv).x; if (sd >= 0.99999) { t += stepLen; stepLen *= 1.13; continue; }
      float diff = viewZ(uv, sd) - Q.z;           // > 0: surface in front of the ray point
      if (diff > 0.0 && diff < max(0.5, t * 0.16)) { huv = uv; conf = 1.0; break; }
      t += stepLen; stepLen *= 1.13; if (t > uMaxDist) break;
    }
    if (conf > 0.0) {
      vec2 e = min(huv, 1.0 - huv); float ef = smoothstep(0.0, 0.08, min(e.x, e.y));
      vec3 hit = texture2D(tDiffuse, huv).rgb; if (any(isnan(hit)) || any(isinf(hit))) hit = uSky;
      refl = mix(uSky, hit, ef);
    }
  }
  gl_FragColor.rgb = base.rgb + min(refl, vec3(24.0)) * F * wet * 0.85;
}`;

export function createSSR({ camera, heightGrid, wetness, quality }) {
  const { N, STEP, R, base, g } = heightGrid;
  const half = new Uint16Array(g.length); for (let i = 0; i < g.length; i++) half[i] = THREE.DataUtils.toHalfFloat(g[i] - base);
  const tex = new THREE.DataTexture(half, N, N, THREE.RedFormat, THREE.HalfFloatType); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uHeight: { value: tex }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uWet: { value: 1 }, uTime: { value: 0 }, uDay: { value: 0 }, uMaxDist: { value: 70 }, uExt: { value: R }, uSteps: { value: quality.level === 'high' ? 36 : 22 }, uSky: { value: new THREE.Color(0.03, 0.025, 0.05) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: FRAG,
  });
  pass.update = (time, fogColor, day) => {
    const u = pass.uniforms; u.uProj.value.copy(camera.projectionMatrix); u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    u.uWet.value = wetness.value; u.uTime.value = time % 10; u.uDay.value = day; u.uSky.value.copy(fogColor).multiplyScalar(0.55 + 0.35 * day);
  };
  return pass;
}
