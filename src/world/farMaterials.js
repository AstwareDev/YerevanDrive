// Materials for the far / low-LOD world tiles: terrain with a 3-layer aerial cascade, simplified buildings with procedural windows,
// simple roads. At night, distant districts glow (road lights + lit windows) *through* the fog so the horizon never looks empty.
import * as THREE from 'three';

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
export const farShared = { uMid: { value: white }, uFar: { value: white }, uLights: { value: white } };

const GLSL = /* glsl */`
  vec3 farAerial(vec2 xz, vec3 near) {
    float d = max(abs(xz.x), abs(xz.y));
    vec2 u2 = vec2((xz.x + 4400.) / 8800., 1. - (xz.y + 4400.) / 8800.);
    vec2 u3 = vec2((xz.x + 17600.) / 35200., 1. - (xz.y + 17600.) / 35200.);
    vec3 c = texture2D(uFar, u3).rgb;
    c = mix(c, texture2D(uMid, u2).rgb, 1.0 - smoothstep(3600., 4400., d));
    return mix(c, near, 1.0 - smoothstep(900., 1100., d));
  }
  float fhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;
const HEAD = 'varying vec3 vWP; varying vec3 vWN; varying vec2 vFUv;';
const UNI = 'uniform sampler2D uMid; uniform sampler2D uFar; uniform sampler2D uLights; uniform sampler2D uNear; uniform float uDay; uniform float uGain;';

function patch(mat, shared, fragBody, kind) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMid = farShared.uMid; sh.uniforms.uFar = farShared.uFar; sh.uniforms.uLights = farShared.uLights;
    sh.uniforms.uNear = shared.uAerial; sh.uniforms.uDay = shared.uDay; sh.uniforms.uGain = { value: 0.8 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normal; vFUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${HEAD}\n${UNI}\n${GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n vec3 farGlow = vec3(0.0); float night = 1.0 - uDay;\n${fragBody}`)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n gl_FragColor.rgb += farGlow * mix(1.0, 0.55, fogFactor);\n#else\n gl_FragColor.rgb += farGlow;\n#endif');
  };
  mat.customProgramCacheKey = () => 'far_' + kind;
  return mat;
}

export function createFarMaterials(shared, renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url, target, srgb = true) => new THREE.TextureLoader().load(url, t => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; target.value = t; }, undefined, () => console.warn('missing', url));
  load('/map/aerial_mid.webp', farShared.uMid); load('/map/aerial_far.webp', farShared.uFar); load('/map/lights_far.webp', farShared.uLights, false);
  const F = {};

  // ---- terrain: aerial cascade + night city lights (R = road glow, G = building coverage; +-4400 m)
  F.far_terrain = patch(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), shared, `
    vec3 aerN = texture2D(uNear, vec2((vWP.x + 1100.) / 2200., 1. - (vWP.z + 1100.) / 2200.)).rgb;
    diffuseColor.rgb = farAerial(vWP.xz, aerN) * mix(uGain, 0.62, uDay);
    vec2 lu = vec2((vWP.x + 4400.) / 8800., 1. - (vWP.z + 4400.) / 8800.);
    float inLights = 1.0 - smoothstep(3900., 4400., max(abs(vWP.x), abs(vWP.z)));
    vec3 lt = texture2D(uLights, lu).rgb;
    float spark = step(0.80, fhash(floor(vWP.xz / 7.0)));
    farGlow += night * inLights * (vec3(1.0, 0.52, 0.18) * lt.r * 0.9 + vec3(1.0, 0.78, 0.5) * lt.g * spark * 0.55);
  `, 'terrain');

  // ---- simplified buildings: wall colour + procedural windows, roofs from the aerial photo
  F.far_building = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), shared, `
    float roofK = step(0.7, vWN.y);
    vec3 aerN2 = texture2D(uNear, vec2((vWP.x + 1100.) / 2200., 1. - (vWP.z + 1100.) / 2200.)).rgb;
    vec3 roofCol = farAerial(vWP.xz, aerN2) * mix(0.95, 0.62, uDay);
    vec2 cell = vFUv / vec2(3.5, 3.2); vec2 fc = fract(cell), id = floor(cell);
    vec2 wv = step(vec2(0.2, 0.22), fc) - step(vec2(0.76, 0.8), fc); float win = wv.x * wv.y;
    float px = fwidth(cell.x) + fwidth(cell.y); float vis = 1.0 - smoothstep(0.5, 1.2, px);      // windows vanish with distance
    float lit = step(fhash(id + floor(vWP.xz * 0.37)), 0.34 * vColor.a);
    float wallWin = win * vis * (1.0 - roofK);
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.0 * wallWin), roofCol, roofK);
    diffuseColor.rgb *= mix(1.0, 0.22, wallWin);
    farGlow += (1.0 - roofK) * wallWin * lit * night * vec3(1.0, 0.74, 0.42) * 1.9 + (1.0 - roofK) * (1.0 - vis) * lit * 0.1 * night * vec3(1.0, 0.7, 0.4);
  `, 'building');

  F.far_road = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return F;
}
