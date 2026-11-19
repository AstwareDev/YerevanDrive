// One shader for all car parts: the per-vertex `aMat` class selects roughness / metalness / emissive / plate texture, only paint
// takes the instance colour, dirt accumulates on the lower body. Single material => one draw call per model per LOD.
import * as THREE from 'three';
import { plateAtlas } from './textures.js';

export const carU = { uNight: { value: 1 }, uPlates: { value: null } };

export function makeCarMaterial({ physical = false, noise = true, envMapIntensity = 1.3 } = {}) {
  if (!carU.uPlates.value) carU.uPlates.value = plateAtlas();
  const base = { vertexColors: true, color: 0xffffff, roughness: 1, metalness: 1, envMapIntensity };
  const mat = physical ? new THREE.MeshPhysicalMaterial({ ...base, clearcoat: 1, clearcoatRoughness: 0.07 }) : new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = carU.uNight; sh.uniforms.uPlates = carU.uPlates;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMat; attribute float aLit; varying float vMat; varying float vLit; varying vec3 vLocal; varying vec2 vPlateUv; varying float vSeed;`)
      .replace('#include <color_vertex>', `
        vColor = vec4(1.0); vColor.rgb *= color; vColor.rgb *= (aMat < 0.5) ? instanceColor.rgb : vec3(1.0);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMat = aMat; vLit = aLit; vLocal = position;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        float ptile = floor(vSeed * 16.0);
        vPlateUv = (vec2(mod(ptile, 2.0), floor(ptile / 2.0)) + uv) / vec2(2.0, 8.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform sampler2D uPlates; varying float vMat; varying float vLit; varying vec3 vLocal; varying vec2 vPlateUv; varying float vSeed;
        float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mt = vMat;
        float dirt = 0.0;
        if (mt < 0.5) {
          float low = 1.0 - smoothstep(0.12, 0.9, vLocal.y);
          ${noise ? 'float nz = vnoise(vLocal * vec3(8.0, 12.0, 8.0)) * 0.65 + vnoise(vLocal * 31.0) * 0.35;' : 'float nz = 0.6;'}
          dirt = clamp((low * (0.3 + 0.9 * vSeed) + 0.1 * vSeed) * (0.45 + 1.0 * nz), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.12, 0.10), dirt * 0.62);
        } else if (mt > 6.5 && mt < 7.5) {
          diffuseColor.rgb = texture2D(uPlates, vPlateUv).rgb;
        }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (mt < 0.5) { roughnessFactor = mix(0.26, 0.62, dirt); metalnessFactor = mix(0.5, 0.12, dirt); }
        else if (mt < 1.5) { roughnessFactor = 0.04; metalnessFactor = 0.85; }
        else if (mt < 2.5) { roughnessFactor = 0.9; metalnessFactor = 0.0; }
        else if (mt < 3.5) { roughnessFactor = 0.24; metalnessFactor = 1.0; }
        else if (mt < 4.5) { roughnessFactor = 0.62; metalnessFactor = 0.0; }
        else if (mt < 6.5) { roughnessFactor = 0.1; metalnessFactor = 0.0; }
        else if (mt < 7.5) { roughnessFactor = 0.45; metalnessFactor = 0.0; }
        else if (mt < 8.5) { roughnessFactor = 0.85; metalnessFactor = 0.2; }
        else { roughnessFactor = 0.2; metalnessFactor = 0.0; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float lamp = mix(0.3, 1.0, uNight), em = 0.0;
          if (mt > 4.5 && mt < 6.5) em = vLit * lamp;
          else if (mt > 8.5 && mt < 9.5) em = (0.15 + 0.35 * vLit) * lamp;
          else if (mt > 9.5) em = 2.2 * lamp;
          totalEmissiveRadiance += diffuseColor.rgb * em;
        }`);
    if (physical) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n material.clearcoat *= step(mt, 0.5);\n#endif');
  };
  mat.customProgramCacheKey = () => 'car' + (physical ? 'P' : 'S') + (noise ? 'n' : '');
  return mat;
}
