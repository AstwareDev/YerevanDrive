// Car lamp + glass + trim materials. The GLBs ship "emissive" lamps with the whole mesh uniformly glowing (BMW: one mesh holds head AND tail lamps, brake light lit the headlights too;
// McLaren: white-hot emissive chrome x10). We take over the emissive term:
//   emissive = tint x lens luminance^2 x level, where level / tint come from per-vertex head/tail classification and two uniforms (head, tail) per material instance.
// Glass: fresnel-driven alpha, so it is dark and see-through head-on but reflects the sky almost opaquely at grazing angles.
import * as THREE from 'three';

const LAMP_HOOK = function (shader) {
  const L = this.lamp;
  shader.uniforms.uHead = L.uHead; shader.uniforms.uTail = L.uTail;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aTail; varying float vTail;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTail = aTail;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uHead; uniform float uTail; varying float vTail;')
    .replace('#include <emissivemap_fragment>', `
      float lampLvl = mix(uHead, uTail, vTail);
      float lampLum = 1.0;
      #ifdef USE_MAP
        vec3 lampTex = texture2D(map, vMapUv).rgb;
        lampLum = clamp(pow(dot(lampTex, vec3(0.3, 0.55, 0.15)), 1.6) * 2.4 + 0.05, 0.0, 1.0);
      #endif
      totalEmissiveRadiance = mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.045, 0.015), vTail) * lampLum * lampLvl;`);
};
const GLASS_HOOK = function (shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
    float gFr = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
    diffuseColor.a = mix(diffuseColor.a, 1.0, gFr * 0.9);
    #include <opaque_fragment>`);
};

const newLamp = () => ({ uHead: { value: 0 }, uTail: { value: 0 } });

/** attaches the lamp hook to material m (call once per material); kind 'head' | 'tail' | 'split' (decided per vertex by z, front = +z) */
function makeLamp(m) {
  m.lamp = newLamp(); m.onBeforeCompile = LAMP_HOOK; m.customProgramCacheKey = () => 'lamp';
  m.emissive.setRGB(1, 1, 1); m.emissiveMap = null; m.emissiveIntensity = 1; m.needsUpdate = true;
}
/** remote players need their own copy (own uniforms) of every lamp material */
export function cloneLamp(m) { const c = m.clone(); c.lamp = newLamp(); c.onBeforeCompile = LAMP_HOOK; c.customProgramCacheKey = m.customProgramCacheKey; return c; }
export function setLamp(m, head, tail) { m.lamp.uHead.value = head; m.lamp.uTail.value = tail; }
/** head / tail lamp levels (0..~2.5, >1 blooms) */
export function lampLevels(night, lightsOn, braking) {
  const head = lightsOn ? 0.18 + 1.5 * night : 0.0;
  const tail = (lightsOn ? 0.12 + 0.4 * night : 0.0) + (braking ? 2.4 : 0.0);
  return [head, tail];
}

/** walks a freshly loaded GLB scene: lamps, glass, emissive clean-up. Returns the lamp materials. */
export function prepareMaterials(scene) {
  scene.updateMatrixWorld(true);
  const lamps = [], v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    arr.forEach(m => {
      const n = m.name || '';
      if (/^paint$/i.test(n)) return;
      let kind = null;
      if (/Light/i.test(n)) kind = /tail/i.test(n) ? 'tail' : /head/i.test(n) ? 'head' : 'split';
      else if (/^Chrome\.002$/.test(n)) kind = 'head';        // McLaren: nose strip / DRL, was emissive white x10
      else if (/^Chrome\.003$/.test(n)) kind = 'tail';        // McLaren: rear strip, was emissive red x5.5
      if (kind && !m.isMeshStandardMaterial) return;
      if (kind) {
        if (!m.lamp) { makeLamp(m); lamps.push(m); }
        const g = o.geometry; if (!g.getAttribute('aTail')) {
          const pos = g.getAttribute('position'), a = new Float32Array(pos.count);
          if (kind === 'tail') a.fill(1); else if (kind === 'split') for (let i = 0; i < pos.count; i++) a[i] = v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).z < 0 ? 1 : 0;
          g.setAttribute('aTail', new THREE.BufferAttribute(a, 1));
        }
        m.roughness = Math.min(m.roughness, 0.2);
        return;
      }
      if (m.emissive && m.emissive.getHex() > 0) {                  // interior dash / screens: exporter strength x5-10 blows the cabin out
        m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.7);
      }
      if (m.transparent && /glass|window/i.test(n) && !m.glassDone) {   // only real BLEND glass (window surrounds are opaque in the source)
        m.glassDone = true;
        const red = m.color.r > 0.3 && m.color.g < 0.1;
        m.opacity = red ? Math.max(m.opacity, 0.55) : THREE.MathUtils.clamp(m.opacity, 0.42, 0.6);
        m.roughness = 0.03; m.metalness = 0; m.envMapIntensity = 2.2; m.depthWrite = false;
        m.onBeforeCompile = GLASS_HOOK; m.customProgramCacheKey = () => 'glass';
        m.needsUpdate = true;
      }
    });
  });
  return lamps;
}
