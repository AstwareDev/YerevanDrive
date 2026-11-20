import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { quality } from './quality.js';
import { pbr, slot, loadPBR } from './pbr.js';

export const wetness = { value: 1.0 };   // 0 = dry, 1 = rain-soaked
const NEAR = { cx: -768, cz: -1280, half: 2304 };   // near-field window (aerial / AO / road field), must match tools/config.mjs NEAR
const EXT = NEAR.half;                        // terrain/aerial extent half-size (m); must match tools/fetch-imagery.mjs and tools/build-textures.mjs (road field)
const FULL = quality.level !== 'low';    // low: one albedo+normal+ORM fetch per surface, no road decals / second asphalt scale / manholes

// Shared uniforms (aerial photo + baked building-contact AO, both in world XZ, north-up)
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
export const shared = { uAerial: { value: white }, uAO: { value: white }, uWet: wetness, uDay: { value: 0 }, uAerialHi: { value: white } };
const HI = 500; // half-extent (m) of aerial_hi.webp

// ------------------------------------------------------------------------------------------------------------------
// GLSL shared by every PBR-upgraded material. Uniform naming: uA0/uN0/uO0 = albedo / normal / ORM of the main set (+ uOn0 loaded flag,
// uS0 = 1 / metres per tile, uAv0 = linear mean albedo); uA1.. = secondary set. The procedural look stays in place until uOn0 flips to 1.
const COMMON = /* glsl */`
varying vec3 vWP; varying vec2 vPUv; varying vec3 vWN;
uniform sampler2D uPud; uniform sampler2D uAerial; uniform sampler2D uAO; uniform sampler2D uAerialHi; uniform float uWet; uniform float uDay;
uniform sampler2D uA0; uniform sampler2D uN0; uniform sampler2D uO0; uniform float uOn0; uniform float uS0; uniform vec3 uAv0;
uniform sampler2D uA1; uniform sampler2D uN1; uniform sampler2D uO1; uniform float uOn1; uniform float uS1; uniform vec3 uAv1;
uniform sampler2D uRF; uniform float uRFon; uniform sampler2D uMask; uniform float uMaskOn;
uniform sampler2D uMhA; uniform sampler2D uMhN; uniform float uMhOn;
vec3 pbrN(vec4 s) { vec2 xy = s.xy * 2.0 - 1.0; return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))); }
mat3 pbrTBN(vec3 eye, vec3 N, vec2 uv) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye); vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, N), q0p = cross(N, q0);
  vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * sc, B * sc, N);
}
vec3 pbrBump(vec3 eye, vec3 N, vec2 dH, float fd) {
  vec3 sX = normalize(dFdx(eye)), sY = normalize(dFdy(eye));
  vec3 R1 = cross(sY, N), R2 = cross(N, sX); float fDet = dot(sX, R1) * fd;
  return normalize(abs(fDet) * N - sign(fDet) * (dH.x * R1 + dH.y * R2));
}
vec2 pbrDir(vec2 cs) {  // road direction from (cos2a, sin2a)
  vec2 c = cs / max(length(cs), 1e-3);
  return vec2(sqrt(max(0.5 * (1.0 + c.x), 0.0)), (c.y >= 0.0 ? 1.0 : -1.0) * sqrt(max(0.5 * (1.0 - c.x), 0.0)));
}
`;

const f1 = (v) => (+v).toFixed(3);
// world position / normal varyings; streamed tiles are drawn through THREE.BatchedMesh (src/world/batches.js), whose per-instance matrix must be applied too
export const WORLD_VARYINGS = `
#ifdef USE_BATCHING
  vWP = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * mat3(batchingMatrix) * normal);
#else
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);
#endif
  vPUv = uv;`;

// ground-ish surfaces: asphalt, sidewalk, plaza, terrain, grass, dirt, roof ------------------------------------------
function groundFrag(kind, c) {
  const aerial = c.aerial ?? 0, hasWet = (c.wet ?? 0) > 0;
  const needPud = hasWet || kind === 'asphalt';
  const aerialBlock = aerial > 0 ? `
        vec3 aerC = vec3(1.0);
        { vec3 aer = texture2D(uAerial, wuv).rgb; vec2 hq = vec2(vWP.x, -vWP.z) / ${HI}.0 * 0.5 + 0.5; float hm = smoothstep(0.0, 0.06, min(min(hq.x, 1.0 - hq.x), min(hq.y, 1.0 - hq.y))); if (hm > 0.0) aer = mix(aer, texture2D(uAerialHi, hq).rgb, hm); aerC = aer; }
        float aerG = mix(${f1(c.gain ?? 0.8)}, 0.62, uDay);
        float dl = dot(diffuseColor.rgb, vec3(0.333));
        diffuseColor.rgb = mix(diffuseColor.rgb, aerC * aerG * (0.45 + dl * 1.9), ${f1(aerial)});` : '';
  const aoBlock = (c.ao ?? 0) > 0 ? `diffuseColor.rgb *= 1.0 - ${f1(c.ao)} * texture2D(uAO, wuv).r;` : '';
  const tint = f1(c.tint ?? 1);
  const aoK = f1(c.ormAO ?? 0.6);
  const head = `
        vec2 wuv = vec2((vWP.x + ${NEAR.half - NEAR.cx}.0) / ${NEAR.half * 2}.0, 1.0 - (vWP.z + ${NEAR.half - NEAR.cz}.0) / ${NEAR.half * 2}.0);
        float pdist = length(vViewPosition);
        float wetm = 0.0;
        ${needPud ? 'float pud = texture2D(uPud, vWP.xz * 0.0075).r * 0.55 + texture2D(uPud, vWP.xz * 0.031 + 0.37).r * 0.45;' : 'float pud = 0.5;'}
        vec4 pO = vec4(1.0, 0.8, 0.0, 1.0); float pRM = 1.0;
        vec3 procOut = diffuseColor.rgb;`;
  let map, normalUV, normalExtra = '', roughExtra = '';

  if (kind === 'roof') {
    // flat roofs -> bitumen set (uA0), sloped -> clay tile set (uA1); selected by the geometric normal, explicit gradients keep mips correct
    map = `
        #include <map_fragment>
        ${head}
        ${aerialBlock}
        vec2 pgx = dFdx(vWP.xz), pgy = dFdy(vWP.xz); float flatRoof = step(0.985, vWN.y); vec2 puv = vWP.xz * mix(uS1, uS0, flatRoof);
        vec3 pbrOut = diffuseColor.rgb;
        if (uOn0 > 0.5) {
          vec3 pA; vec3 av;
          if (flatRoof > 0.5) { pA = textureGrad(uA0, puv, pgx * uS0, pgy * uS0).rgb; pO = textureGrad(uO0, puv, pgx * uS0, pgy * uS0); av = uAv0; }
          else { pA = textureGrad(uA1, puv, pgx * uS1, pgy * uS1).rgb; pO = textureGrad(uO1, puv, pgx * uS1, pgy * uS1); av = uAv1; }
          vec3 det = clamp(pA / av, 0.3, 2.4); det = mix(det, vec3(1.0), smoothstep(80.0, 260.0, pdist)); float dlum = dot(det, vec3(0.333));
          float ao = mix(1.0, pO.r, ${aoK});
          pbrOut = aerC * aerG * ${f1(c.aerialBase ?? 1.15)} * mix(vec3(dlum), det, 0.6) * ao;
          pbrOut = mix(diffuseColor.rgb, pbrOut, ${f1(aerial)});
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, pbrOut, uOn0);
        ${aoBlock}`;
    normalExtra = `
        if (uOn0 > 0.5) {
          vec3 nt = flatRoof > 0.5 ? pbrN(textureGrad(uN0, puv, pgx * uS0, pgy * uS0)) : pbrN(textureGrad(uN1, puv, pgx * uS1, pgy * uS1));
          nt.xy *= ${f1(c.ns ?? 1)} * (1.0 - smoothstep(40.0, 130.0, pdist));
          normal = normalize(pbrTBN(-vViewPosition, normal, puv) * normalize(nt));
        }`;
    normalUV = null;
  } else {
    let uv, albedo = '', post = '';
    if (kind === 'sidewalk') {
      uv = 'vec2(vPUv.x * 3.0, vPUv.y) * uS0';
      albedo = `
          float cu = min(vPUv.x, 1.0 - vPUv.x);
          float curb = 1.0 - smoothstep(0.040, 0.046, cu), gut = smoothstep(0.044, 0.048, cu) * (1.0 - smoothstep(0.062, 0.067, cu));
          pA *= mix(1.0, 1.3, curb) * mix(1.0, 0.32, gut);`;
    } else uv = 'vWP.xz * uS0';
    if (c.anti) albedo += `
          { vec2 u2 = mat2(0.8, 0.6, -0.6, 0.8) * vWP.xz * uS0 * 0.37 + vec2(0.23, 0.61); pA *= mix(vec3(1.0), clamp(texture2D(uA0, u2).rgb / uAv0, 0.4, 2.0), 0.55); }
          pA *= 0.86 + 0.28 * pud;`;
    let decals = '';
    if (kind === 'asphalt') {
      if (c.set1) albedo += `
          if (uOn1 > 0.5) pA *= clamp(texture2D(uA1, vWP.xz * uS1 + vec2(0.31, 0.17)).rgb / uAv1, 0.4, 2.2);`;
      albedo += `
          pA *= 0.84 + 0.32 * pud;`;
      if (c.roadDecals) decals = `
          if (uRFon > 0.5) {
            vec4 rf = texture2D(uRF, wuv);
            float hw = max(rf.a * 16.0, 0.5), latN = (rf.b - 0.5) * 2.0;
            float onRoad = step(0.02, rf.a) * (1.0 - smoothstep(0.88, 1.0, abs(latN)));
            float conf = clamp(length(rf.rg * 2.0 - 1.0) * 1.6, 0.0, 1.0);
            vec2 dir = pbrDir(rf.rg * 2.0 - 1.0), prp = vec2(-dir.y, dir.x);
            float along = dot(vWP.xz, dir), across = dot(vWP.xz, prp), lat = latN * hw;
            float nL = max(1.0, floor(2.0 * hw / 3.3 + 0.5)), laneW = 2.0 * hw / nL;
            float lc = (fract((lat + hw) / laneW) - 0.5) * laneW;
            float wob = 0.12 * sin(along * 0.31 + across * 0.2) + 0.07 * sin(along * 0.97 + 1.7);
            float q = (abs(lc) - 0.82 + wob) / 0.24;
            float wheel = exp(-q * q) * smoothstep(2.3, 3.1, laneW) * onRoad * conf;
            float oil = exp(-(lc / 0.16) * (lc / 0.16)) * onRoad * conf;
            vec3 mk = vec3(0.0);
            if (uMaskOn > 0.5) { vec2 mg = vec2(1.0 / 6.0); mk = textureGrad(uMask, vec2(across, along) / 6.0, dFdx(vWP.xz) * mg, dFdy(vWP.xz) * mg).rgb; }
            float rub = mk.r * wheel;
            float crack = mk.g * (1.0 - smoothstep(0.2, 0.33, pud));
            float stain = mk.b * (0.3 + 0.7 * wheel + 0.6 * oil);
            float edge = smoothstep(0.72, 0.95, abs(latN)) * step(0.02, rf.a);
            pA *= 1.0 - 0.2 * wheel - 0.5 * rub - 0.6 * crack - 0.42 * stain;
            pA = mix(pA, pA * 0.5 + vec3(0.05, 0.045, 0.04), edge * 0.8);
            pRM *= 1.0 - (0.22 * wheel + 0.32 * rub) * (0.45 + 0.55 * uWet) - 0.5 * stain;
            pRM = mix(pRM, 1.2, edge * 0.6);
            pHgt = -crack * 1.0 + rub * 0.15;
            ${c.manhole ? `
            if (uMhOn > 0.5) {
              vec2 cell = floor(vWP.xz / 24.0);
              vec3 h3 = fract(vec3(cell.xyx) * vec3(0.1031, 0.1030, 0.0973)); h3 += dot(h3, h3.yzx + 33.33); vec2 hh = fract((h3.xx + h3.yz) * h3.zy);
              vec2 cc = (cell + 0.12 + 0.76 * hh) * 24.0, dd = vWP.xz - cc;
              if (dot(dd, dd) < 0.6) {
                vec4 rc = textureLod(uRF, vec2((cc.x + ${NEAR.half - NEAR.cx}.0) / ${NEAR.half * 2}.0, 1.0 - (cc.y + ${NEAR.half - NEAR.cz}.0) / ${NEAR.half * 2}.0), 0.0);
                if (rc.a > 0.06 && abs(rc.b - 0.5) < 0.24) {
                  vec2 d2 = pbrDir(rc.rg * 2.0 - 1.0), p2 = vec2(-d2.y, d2.x);
                  vec2 muv = vec2(dot(dd, d2), dot(dd, p2)) / ${f1(c.manholeSize ?? 1.0)} + 0.5;
                  if (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) {
                    vec2 gx = dFdxWP / ${f1(c.manholeSize ?? 1.0)}, gy = dFdyWP / ${f1(c.manholeSize ?? 1.0)};
                    vec4 mn = textureGrad(uMhN, muv, gx, gy);
                    mhOp = smoothstep(0.35, 0.65, mn.b);
                    pA = mix(pA, textureGrad(uMhA, muv, gx, gy).rgb * 0.8, mhOp);
                    mhRN = (mn.x * 2.0 - 1.0) * d2 + (mn.y * 2.0 - 1.0) * p2;
                    pO.g = mix(pO.g, 0.5, mhOp); pRM = mix(pRM, 1.0, mhOp);
                  }
                }
              }
            }` : ''}
          }`;
      post = ' ';
    }
    const aerialPbr = aerial > 0 ? `
          vec3 det = clamp(pA / uAv0, 0.3, 2.4); det = mix(det, vec3(1.0), smoothstep(60.0, 220.0, pdist)); float dlum = dot(det, vec3(0.333));
          pA = mix(pA * ${tint} * ao, aerC * aerG * ${f1(c.aerialBase ?? 0.56)} * mix(vec3(dlum), det, 0.55) * ao, ${f1(aerial)});` : `
          pA *= ${tint} * (1.0 + ${f1(c.dayGain ?? 0)} * uDay) * ao;`;
    map = `
        #include <map_fragment>
        ${head}
        ${aerialBlock}
        vec2 puv = ${uv};
        float pHgt = 0.0, mhOp = 0.0; vec2 mhRN = vec2(0.0);
        ${kind === 'asphalt' && c.manhole && c.roadDecals ? 'vec2 dFdxWP = dFdx(vWP.xz), dFdyWP = dFdy(vWP.xz);' : ''}
        vec3 pbrOut = diffuseColor.rgb;
        if (uOn0 > 0.5) {
          vec3 pA = texture2D(uA0, puv).rgb; pO = texture2D(uO0, puv);
          float ao = mix(1.0, pO.r, ${aoK});
          ${albedo}
          ${decals}
          ${aerialPbr}
          pbrOut = pA;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, pbrOut, uOn0);
        ${aoBlock}`;
    normalExtra = `
        if (uOn0 > 0.5) {
          vec3 nt = pbrN(texture2D(uN0, puv));
          ${mhRN(kind, c)}
          float nf = (1.0 - smoothstep(30.0, 90.0, pdist)) * (1.0 - wetm * 0.9);
          nt.xy *= ${f1(c.ns ?? 1)} * nf;
          normal = normalize(pbrTBN(-vViewPosition, normal, puv) * normalize(nt));
          ${kind === 'asphalt' && c.roadDecals ? `if (pHgt != 0.0) normal = pbrBump(-vViewPosition, normal, vec2(dFdx(pHgt), dFdy(pHgt)) * ${f1(c.bump ?? 1.3)}, faceDirection);` : ''}
        }`;
    void post; void normalUV;
  }

  const rough = `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, clamp(pO.g * pRM * ${f1(c.rm ?? 1)}, 0.04, 1.0), uOn0);
        ${hasWet ? `float wetPud = smoothstep(0.42, 0.62, pud) * uWet * ${f1(c.wet)};
        wetm = wetPud;
        roughnessFactor = mix(roughnessFactor * mix(1.0, 0.55, uWet * ${f1(c.wet)}), 0.035, wetm);
        diffuseColor.rgb *= mix(1.0, 0.62, wetm);` : ''}
        ${c.dayRough ? `roughnessFactor = mix(roughnessFactor, max(roughnessFactor, ${f1(c.dayRough)}), uDay * 0.6 * (1.0 - uWet * 0.7));` : ''}`;
  return { map, rough, normal: `#include <normal_fragment_maps>\n${normalExtra}` };
}
function mhRN(kind, c) { return kind === 'asphalt' && c.manhole && c.roadDecals ? 'nt.xy = mix(nt.xy, mhRN, mhOp);' : ''; }

// painted markings: alpha-tested decals with dirt/wear taken from the asphalt aggregate texture --------------------------
function markFrag(c) {
  const map = `
        #include <map_fragment>
        float pdist = length(vViewPosition);
        vec2 puv = vWP.xz * uS0; float wetm = 0.0; vec4 pO = vec4(1.0, 0.75, 0.0, 1.0);
        float pud = texture2D(uPud, vWP.xz * 0.0075).r * 0.55 + texture2D(uPud, vWP.xz * 0.031 + 0.37).r * 0.45;
        if (uOn0 > 0.5) {
          vec3 ag = texture2D(uA0, puv).rgb; pO = texture2D(uO0, puv);
          float agg = clamp(dot(ag, vec3(0.333)) / dot(uAv0, vec3(0.333)), 0.0, 2.0);
          float wear = smoothstep(0.30, 0.75, texture2D(uPud, vWP.xz * 0.11).r);
          float pit = clamp((1.12 - agg) * 1.7, 0.0, 1.0);
          diffuseColor.a -= (0.12 + 0.8 * wear) * pit * 2.0;
          diffuseColor.rgb *= 0.7 + 0.3 * min(agg, 1.2) - 0.12 * wear;
        }`;
  const rough = `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.5, pO.g * 0.9, 0.55), uOn0);
        wetm = smoothstep(0.42, 0.62, pud) * uWet;
        roughnessFactor = mix(roughnessFactor * mix(1.0, 0.55, uWet), 0.035, wetm);
        diffuseColor.rgb *= mix(1.0, 0.62, wetm);`;
  const normal = `#include <normal_fragment_maps>
        if (uOn0 > 0.5) {
          vec3 nt = pbrN(texture2D(uN0, puv));
          nt.xy *= 0.8 * (1.0 - smoothstep(25.0, 70.0, pdist)) * (1.0 - wetm * 0.9);
          normal = normalize(pbrTBN(-vViewPosition, normal, puv) * normalize(nt));
        }`;
  return { map, rough, normal };
}

// walls / facades / shopfronts / metal: a tiling detail set (stucco, stone, concrete) in wall metres multiplies into the atlas -----------------
function wallFrag(kind, c) {
  const maskExpr = kind === 'facade' ? 'smoothstep(0.4, 0.7, roughnessFactor)'          // atlas ORM: glass is smooth, wall is rough
    : kind === 'shop' ? 'smoothstep(0.03, 0.12, dot(diffuseColor.rgb, vec3(0.333)))'     // glass / dark surrounds stay untouched
      : '1.0';
  const uv = kind === 'metal' ? 'vec2(vWP.x + vWP.z, vWP.y) * uS0' : 'vPUv * uS0';
  const soil = kind === 'facade' || kind === 'shop' ? `diffuseColor.rgb *= 1.0 - ${f1(c.soil ?? 0.28)} * (1.0 - smoothstep(0.0, 2.4, vPUv.y)) * wallM;` : '';
  const map = '#include <map_fragment>';
  const metal = `
        #include <metalnessmap_fragment>
        float pdist = length(vViewPosition);
        vec2 puv = ${uv};
        float wallM = ${maskExpr};
        if (uOn0 > 0.5) {
          vec3 dA = texture2D(uA0, puv).rgb; vec4 dO = texture2D(uO0, puv);
          vec3 ratio = pow(clamp(dA / uAv0, 0.25, 2.4), vec3(${f1(c.gain ?? 1)}));
          ratio *= mix(1.0, dO.r, ${f1(c.ormAO ?? 0.7)});
          ratio = mix(ratio, vec3(dot(ratio, vec3(0.333))), ${f1(c.desat ?? 0.0)});
          diffuseColor.rgb *= mix(vec3(1.0), ratio, wallM);
          roughnessFactor = mix(roughnessFactor, clamp(dO.g * ${f1(c.rm ?? 1)}, 0.05, 1.0), wallM * ${f1(c.rmMix ?? 1)});
          ${soil}
        }`;
  const normal = `#include <normal_fragment_maps>
        if (uOn0 > 0.5) {
          vec3 nt = pbrN(texture2D(uN0, puv));
          nt.xy *= ${f1(c.ns ?? 1)} * wallM * (1.0 - smoothstep(50.0, 160.0, pdist));
          normal = normalize(pbrTBN(-vViewPosition, normal, puv) * normalize(nt));
        }`;
  return { map, rough: '#include <roughnessmap_fragment>', metal, normal };
}

/** Installs the PBR upgrade on `mat`. kind: asphalt sidewalk plaza terrain grass dirt roof | mark | facade shop wall metal. */
function surface(mat, kind, puddle, c = {}) {
  const s0 = c.set0 ? slot(c.set0) : null, s1 = c.set1 ? slot(c.set1) : null, sMh = c.manhole ? slot('decal_manhole') : null;
  if (c.roadDecals) pbr.wantMask = true;
  const gen = kind === 'mark' ? markFrag(c) : ['facade', 'shop', 'wall', 'metal'].includes(kind) ? wallFrag(kind, c) : groundFrag(kind, c);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uPud: { value: puddle }, uWet: shared.uWet, uAerial: shared.uAerial, uAO: shared.uAO, uDay: shared.uDay, uAerialHi: shared.uAerialHi });
    if (s0) Object.assign(sh.uniforms, { uA0: s0.albedo, uN0: s0.normal, uO0: s0.orm, uOn0: s0.on, uS0: s0.inv, uAv0: s0.avg });
    else Object.assign(sh.uniforms, { uOn0: { value: 0 } });
    if (s1) Object.assign(sh.uniforms, { uA1: s1.albedo, uN1: s1.normal, uO1: s1.orm, uOn1: s1.on, uS1: s1.inv, uAv1: s1.avg });
    if (c.roadDecals) Object.assign(sh.uniforms, { uRF: pbr.roadField, uRFon: pbr.roadFieldOn, uMask: pbr.decalMask, uMaskOn: pbr.decalMaskOn });
    if (sMh) Object.assign(sh.uniforms, { uMhA: sMh.albedo, uMhN: sMh.normal, uMhOn: sMh.on });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec2 vPUv; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLD_VARYINGS);
    let fs = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON);
    fs = fs.replace('#include <map_fragment>', gen.map).replace('#include <roughnessmap_fragment>', gen.rough).replace('#include <normal_fragment_maps>', gen.normal);
    if (gen.metal) fs = fs.replace('#include <metalnessmap_fragment>', gen.metal);
    if (c.lit) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR_ALPHA\n totalEmissiveRadiance *= vColor.a;\n#endif');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `pbr|${kind}|${quality.level}|${c.key ?? ''}|${JSON.stringify(c)}`;
  return mat;
}

export function loadAerial(renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  new THREE.TextureLoader().load('/map/aerial.webp', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; shared.uAerial.value = t; }, undefined, () => console.warn('aerial.webp missing'));
  new THREE.TextureLoader().load('/map/aerial_hi.webp', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; shared.uAerialHi.value = t; }, undefined, () => console.warn('aerial_hi.webp missing'));
  new THREE.TextureLoader().load('/map/ao.png', t => { t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; shared.uAO.value = t; }, undefined, () => console.warn('ao.png missing'));
}

export function createMaterials(renderer) {
  const T = makeTextures(renderer.capabilities.getMaxAnisotropy());
  loadAerial(renderer);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const po = (f) => ({ polygonOffset: true, polygonOffsetFactor: -f, polygonOffsetUnits: -f });
  const M = {};

  // ---- ground (world-space metres; puddles / aerial colour / contact AO keep working exactly as before)
  M.terrain = surface(std({ map: T.terrain, roughness: 0.92, metalness: 0 }), 'terrain', T.puddle, { key: 'terrain', set0: 'terrain_earth', wet: 0.3, aerial: 0.85, gain: 0.8, ao: 0.5, ns: 0.8 });
  M.asphalt = surface(std({ map: T.asphalt, roughnessMap: T.asphaltRough, bumpMap: T.asphaltBump, bumpScale: 0.6, roughness: 0.62, metalness: 0.0, ...po(1) }), 'asphalt', T.puddle,
    { key: 'asphalt', set0: 'asphalt_fine', set1: FULL ? 'asphalt_road' : null, roadDecals: FULL, manhole: FULL, manholeSize: 0.95, wet: 1.0, ao: 0.55, tint: 1.0, dayGain: 0.45, dayRough: 0.9, ns: 1.0, rm: 1.0, ormAO: 0.5 });
  M.sidewalk = surface(std({ map: T.sidewalk, roughness: 0.7, metalness: 0, ...po(1) }), 'sidewalk', T.puddle, { key: 'sidewalk', set0: 'sidewalk_slab', wet: 0.7, ao: 0.6, tint: 0.75, ns: 1.0 });
  M.plaza = surface(std({ map: T.plaza, roughness: 0.55, metalness: 0, ...po(1) }), 'plaza', T.puddle, { key: 'plaza', set0: 'plaza_tuff', wet: 0.9, aerial: 0.8, gain: 0.85, ao: 0.4, ns: 1.0, aerialBase: 0.62 });
  M.grass = surface(std({ map: T.grass, roughness: 1, metalness: 0, ...po(1) }), 'grass', T.puddle, { key: 'grass', set0: 'grass_short', aerial: 0.75, gain: 0.8, ao: 0.4, ns: 0.7, aerialBase: 0.56 });
  // raised sidewalk tops (uv = world metres): slabs with anti-tiling, light wet patches, no aerial blend
  M.pavement = surface(std({ map: T.plaza, roughness: 0.7, metalness: 0, ...po(1) }), 'pavement', T.puddle, { key: 'pavement', set0: 'sidewalk_slab', wet: 0.55, ao: 0.6, tint: 0.78, ns: 1.0, anti: true });
  M.dirt = surface(std({ map: T.dirt, roughness: 1, metalness: 0, ...po(1) }), 'dirt', T.puddle, { key: 'dirt', set0: 'dirt', aerial: 0.7, gain: 0.8, ao: 0.4, ns: 1.0 });
  M.water = std({ color: 0x0a2236, roughness: 0.04, metalness: 0.0, emissive: 0x04121f, emissiveIntensity: 1, ...po(2) });
  // ---- walls / fences
  M.wall = surface(std({ map: T.concrete, roughness: 0.9, metalness: 0, vertexColors: true }), 'wall', T.puddle, { key: 'wall', set0: 'concrete_dark', ns: 1.0, gain: 0.9 });
  // curb faces (uv = metres along, metres up) and facade trim (sills, lintels, balcony slabs; vertex colour = wall tint)
  M.curb = surface(std({ color: 0xa8a5a0, roughness: 0.85, metalness: 0 }), 'wall', T.puddle, { key: 'curb', set0: 'concrete_dark', ns: 1.0, gain: 0.9 });
  M.trim = surface(std({ roughness: 0.85, metalness: 0, vertexColors: true }), 'wall', T.puddle, { key: 'trim', set0: 'concrete_light', ns: 1.0, gain: 0.9 });
  M.fence = surface(std({ color: 0x1b1c20, roughness: 0.6, metalness: 0.6 }), 'metal', T.puddle, { key: 'fence', set0: 'metal_dark', ns: 0.8, rmMix: 0.6 });
  // roofs: real aerial photo colours (vertex colour fallback keeps them dark while the photo loads); flat = bitumen, sloped = clay tiles
  M.roof = surface(std({ map: T.roof, vertexColors: true, roughness: 0.85, metalness: 0 }), 'roof', T.puddle, { key: 'roof', set0: 'roof_bitumen', set1: 'roof_clay', aerial: 0.92, gain: 0.95, ao: 0, ns: 0.9, aerialBase: 1.15 });
  // ---- facades: emissive window atlases stay; the detail set adds stucco / stone depth and wear (wall metres in uv)
  const facade = (albedo, emissive, orm, strength, key, c) => surface(std({ map: albedo, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: strength, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, vertexColors: true }), 'facade', T.puddle, { key, lit: true, ...c });
  M.facade = facade(T.facadeAlbedo, T.facadeEmissive, T.facadeORM, 2.4, 'facade', { set0: 'plaster_a', ns: 1.0, gain: 1.0, rm: 1.0 });
  M.facade_tuff = facade(T.tuffAlbedo, T.tuffEmissive, T.tuffORM, 2.6, 'facade_tuff', { set0: 'tuff_block_a', ns: 1.1, gain: 0.95, rm: 1.0, soil: 0.3 });
  M.facade_modern = facade(T.modernAlbedo, T.modernEmissive, T.modernORM, 2.2, 'facade_modern', { set0: 'concrete_light', ns: 0.8, gain: 0.8, rm: 1.0, soil: 0.2 });
  M.facade_house = facade(T.houseAlbedo, T.houseEmissive, T.houseORM, 2.4, 'facade_house', { set0: 'plaster_b', ns: 1.1, gain: 1.0, rm: 1.0 });
  M.shop = surface(std({ map: T.shopAlbedo, emissiveMap: T.shopEmissive, emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 0.5, metalness: 0.1, vertexColors: true }), 'shop', T.puddle, { key: 'shop', set0: 'concrete_light', ns: 0.8, gain: 0.8, rm: 1.0, rmMix: 0.7 });
  M.neon = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  M.neon.color.setScalar(3.2);
  // ---- worn lane markings and crossings: alpha-tested paint, pitted by the asphalt aggregate, dirty, wet-aware
  const mark = (map, key) => surface(std({ map, alphaTest: 0.45, roughness: 0.45, metalness: 0, emissive: 0x111111, ...po(3) }), 'mark', T.puddle, { key, set0: 'asphalt_fine' });
  M.mark_a = mark(T.markA, 'mark_a'); M.mark_b = mark(T.markB, 'mark_b'); M.mark_c = mark(T.markC, 'mark_c');
  M.crossing = mark(T.zebra, 'crossing');

  // background upgrade: the old procedural look renders right away, photographic maps stream in one set per frame
  loadPBR(renderer).then(() => {
    // photographic maps replace the procedural albedo / roughness / bump on ground surfaces: drop the fallback fetches
    for (const [k, set] of [['terrain', 'terrain_earth'], ['asphalt', 'asphalt_fine'], ['sidewalk', 'sidewalk_slab'], ['pavement', 'sidewalk_slab'], ['plaza', 'plaza_tuff'], ['grass', 'grass_short'], ['dirt', 'dirt'], ['roof', 'roof_bitumen']]) {
      if (!slot(set).on.value) continue;
      const m = M[k]; m.map = null; m.bumpMap = null; m.roughnessMap = null; m.needsUpdate = true;
    }
  });
  return { M, T };
}
