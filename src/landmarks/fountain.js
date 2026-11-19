// Republic Square "Singing Fountains": stone basin + circular island fountain + animated colour-cycling water jets (GPU ballistic droplets).
import * as THREE from 'three';
import { profileRing } from './facade.js';
import { offsetRing, orient, TAU, rng } from './kit.js';

// OSM outline of the pool (way 1132931823, "Singing fountains"), local metres (x east, z south). The notch at ~(79,-77) is the round island fountain.
const POOL = [[56.1, -107.4], [69.4, -95.4], [67.5, -93.6], [76.0, -85.9], [73.4, -84.1], [71.8, -81.7], [71.1, -79.1], [71.0, -77.1], [71.5, -75.4], [72.5, -73.4], [74.0, -71.7], [75.7, -70.7], [77.6, -70.1], [79.9, -69.8], [82.0, -70.2], [84.4, -71.5], [86.1, -73.6], [87.1, -75.9], [92.0, -71.5], [93.7, -73.4], [107.9, -60.6], [86.8, -38.1], [83.0, -36.0], [80.2, -36.0], [76.2, -38.3], [35.6, -76.8], [34.6, -80.1], [34.9, -83.2], [36.8, -85.9]];
export const POOL_CENTER = [71.6, -70.7], ISLAND = [79.4, -77.4, 8.4];
const U = [0.743, 0.669], V = [0.669, -0.743]; // pool axes (long axis u, short axis v towards the museum)
const loc = (u, v) => [POOL_CENTER[0] + U[0] * u + V[0] * v, POOL_CENTER[1] + U[1] * u + V[1] * v];

export function buildFountain({ m, root, H, renderer, camera, mats }) {
  const yG = H(POOL_CENTER[0], POOL_CENTER[1]);
  const yW = yG + 0.36;
  const ring = orient(POOL);
  // ---- basin coping (rose tuff / basalt)
  profileRing(m, 'cream', ring, [[0.75, yG - 0.4], [0.75, yG + 0.58], [0.62, yG + 0.62], [0.0, yG + 0.62], [0.0, yG + 0.26]], {});
  profileRing(m, 'basalt', ring, [[0.0, yG + 0.26], [0.0, yG - 0.1]], {});
  // water floor so the pool does not show the terrain through shallow bases
  m.face('basalt', ring.map(p => [p[0], yG + 0.02, p[1]]), [0, 1, 0], { col: [0.5, 0.55, 0.6], uvS: 3 });
  // ---- island fountain: stepped circular basin, tiered bowl, central pillar
  const [ix, iz, ir] = ISLAND;
  m.lathe('cream', ix, iz, [[ir + 0.4, yG - 0.2], [ir + 0.4, yG + 0.5], [ir - 0.2, yG + 0.5], [ir - 0.2, yG + 0.9], [ir - 1.0, yG + 0.9], [ir - 1.0, yG + 0.55]], 40, { uRad: ir });
  m.lathe('basalt', ix, iz, [[0.1, yG + 0.5], [4.2, yG + 0.5], [4.2, yG + 1.05], [3.7, yG + 1.05], [3.7, yG + 1.5], [1.6, yG + 1.5], [1.5, yG + 2.3], [0.9, yG + 2.9], [1.5, yG + 3.4], [2.6, yG + 3.7], [2.6, yG + 3.9], [0.4, yG + 3.9], [0.3, yG + 4.4]], 28, { uRad: 3 });
  m.lathe('cream', ix, iz, [[4.2, yG + 0.5], [4.2, yG + 1.05], [4.7, yG + 1.05], [4.7, yG + 0.5]], 40, { uRad: 4 });

  // ---- water surface (animated normals, colour-cycling emissive)
  const wpos = [], widx = [];
  const wuniform = { uTime: { value: 0 }, uTint: { value: new THREE.Color(0.1, 0.4, 0.8) } };
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x03121c, roughness: 0.05, metalness: 0.15, emissive: 0x000000, envMapIntensity: 1.8 });
  waterMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, wuniform);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform float uTime; uniform vec3 uTint;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 q = vWp.xz; float t = uTime;
          vec2 g = vec2(cos(q.x*1.9 + t*1.3) + 0.6*cos(q.x*4.3 - q.y*3.1 + t*2.1), cos(q.y*2.3 - t*1.1) + 0.6*cos(q.y*4.7 + q.x*2.9 - t*1.7));
          normal = normalize(normal + vec3(g.x, 0.0, g.y) * 0.035); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uTint * (0.06 + 0.05 * sin(vWp.x*0.5 + uTime));');
  };
  waterMat.customProgramCacheKey = () => 'lmwater';
  const waterGeo = (() => {
    const g = new THREE.BufferGeometry(); const P = [], N = [], I = [];
    // triangulate the ring via kit.face on a private mesher would duplicate code; use THREE.ShapeUtils
    const pts = ring.map(p => new THREE.Vector2(p[0], p[1]));
    const tri = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const p of ring) { P.push(p[0], yW, p[1]); N.push(0, 1, 0); }
    for (const t of tri) { // ensure facing up
      const a = ring[t[0]], b = ring[t[1]], c = ring[t[2]]; const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cr > 0) I.push(t[0], t[2], t[1]); else I.push(t[0], t[1], t[2]);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I); return g;
  })();
  const water = new THREE.Mesh(waterGeo, waterMat); water.renderOrder = 1; root.add(water);
  // island water disc
  const iw = new THREE.Mesh(new THREE.CircleGeometry(ir - 1.0, 40).rotateX(-Math.PI / 2).translate(ix, yG + 0.78, iz), waterMat); root.add(iw);

  // ---- jets
  const jets = []; // {x,z,y,group,phase,h, dx,dz (horizontal travel), anim}
  const add = (p, group, phase, h, anim = 1, dx = 0, dz = 0, y = yW) => jets.push({ x: p[0], z: p[1], y, group, phase, h, anim, dx, dz });
  // central line along the long axis
  for (let i = 0; i < 17; i++) { const u = -30 + i * 3.75; add(loc(u, -5), 0, i * 0.55, 17); }
  // side rows
  for (let i = 0; i < 14; i++) { const u = -29 + i * 4.4; add(loc(u, -14.5), 1, i * 0.7, 8.5); if (Math.abs(u) > 11) add(loc(u, 9.5), 2, i * 0.7 + 1.3, 8.5); }
  // arches: pairs facing each other across the short axis
  for (let i = 0; i < 7; i++) { const u = -27 + i * 9; const a = loc(u, -16), b = loc(u, -7.5); add(a, 3, i, 7.5, 0, b[0] - a[0], b[1] - a[1], yW); add(b, 3, i + 0.5, 7.5, 0, a[0] - b[0], a[1] - b[1], yW); }
  // end groups: fans
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) { const a = loc(s * 31, -14 + k * 5); const ang = (k - 2) * 0.35; const dir = [U[0] * s * Math.cos(ang) + V[0] * Math.sin(ang), U[1] * s * Math.cos(ang) + V[1] * Math.sin(ang)]; add(a, 4, k + (s > 0 ? 2 : 0), 7.5, 0, -dir[0] * 7, -dir[1] * 7, yW); }
  // island: tall central jet + ring of angled jets
  add([ix, iz], 5, 0, 26, 1, 0, 0, yG + 4.4);
  for (let k = 0; k < 14; k++) { const a = TAU * k / 14; add([ix + Math.cos(a) * 5.2, iz + Math.sin(a) * 5.2], 6, k * 0.45, 5.2, 0, Math.cos(a) * 2.6, Math.sin(a) * 2.6, yG + 1.1); }
  for (let k = 0; k < 8; k++) { const a = TAU * (k + 0.5) / 8; add([ix + Math.cos(a) * 3.0, iz + Math.sin(a) * 3.0], 7, k * 0.8, 9, 1, Math.cos(a) * 1.5, Math.sin(a) * 1.5, yG + 1.5); }

  const PER = 96, nPts = jets.length * PER;
  const aNoz = new Float32Array(nPts * 3), aJ = new Float32Array(nPts * 4), aD = new Float32Array(nPts * 4), aR = new Float32Array(nPts);
  const R = rng(99);
  jets.forEach((j, ji) => {
    for (let k = 0; k < PER; k++) {
      const i = ji * PER + k;
      aNoz.set([j.x, j.y, j.z], i * 3); aJ.set([j.group, j.phase, j.h, j.anim], i * 4); aD.set([j.dx, j.dz, ji, (k + R() * 0.8) / PER], i * 4); aR[i] = R();
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nPts * 3), 3));
  geo.setAttribute('aNoz', new THREE.BufferAttribute(aNoz, 3)); geo.setAttribute('aJ', new THREE.BufferAttribute(aJ, 4)); geo.setAttribute('aD', new THREE.BufferAttribute(aD, 4)); geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(POOL_CENTER[0], yG + 8, POOL_CENTER[1]), 70);
  const U2 = { uTime: { value: 0 }, uScale: { value: 600 } };
  const jetMat = new THREE.ShaderMaterial({
    uniforms: U2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aNoz; attribute vec4 aJ; attribute vec4 aD; attribute float aR;
      uniform float uTime; uniform float uScale; varying vec4 vC;
      vec3 hsv(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(0.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.), clamp(p-1.,0.,1.), c.y); }
      float hh(float n){ return fract(sin(n*91.345)*47453.5453); }
      void main(){
        float g = 9.8, t = uTime;
        float wave = 0.5 + 0.5*sin(t*0.95 + aJ.y), pulse = 0.5 + 0.5*sin(t*1.9 + aJ.y*0.6);
        float show = smoothstep(-0.3, 0.3, sin(t*0.11 + aJ.x*0.4));
        float hf = mix(wave, pulse, show);
        float h = aJ.z * mix(1.0, 0.18 + 0.82*hf, aJ.w);
        float v0 = sqrt(2.0*g*max(h,0.05)), T = 2.0*v0/g;
        float spd = 0.45 + 0.12*hh(aD.z);
        float tau = fract(aD.w + t*spd);
        float ts = tau*T;
        vec3 p = aNoz;
        p.y += v0*ts - 0.5*g*ts*ts;
        p.xz += aD.xy * tau;
        float sc = (0.10 + 0.9*tau*tau) * (0.12 + 0.03*h);
        p.x += (hh(aR*17.0 + aD.z) - 0.5) * 2.0 * sc; p.z += (hh(aR*31.0 + aD.z*1.3) - 0.5) * 2.0 * sc;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = 0.2 + 0.2*tau;
        gl_PointSize = clamp(uScale * size / max(-mv.z, 0.1), 1.0, 48.0);
        float hue = fract(t*0.045 + aJ.x*0.095 + 0.55);
        vec3 col = hsv(vec3(hue, 0.7, 1.0));
        float white = smoothstep(0.55, 1.0, tau) * 0.6;
        col = mix(col, vec3(1.0), 0.25 + white);
        float a = smoothstep(0.0, 0.04, tau) * (1.0 - smoothstep(0.9, 1.0, tau)) * step(0.4, h);
        vC = vec4(col * 1.7, a);
      }`,
    fragmentShader: `varying vec4 vC; void main(){ vec2 q = gl_PointCoord*2.0-1.0; float r2 = dot(q,q); if (r2 > 1.0) discard; float f = exp(-r2*2.2); gl_FragColor = vec4(vC.rgb, vC.a * f * 0.5); }`,
  });
  const pts = new THREE.Points(geo, jetMat); pts.frustumCulled = false; pts.renderOrder = 6; root.add(pts);

  // ---- coloured light pools on the water under each jet (additive decals, colours cycled per group in update())
  const gq = [], gc = [], gi = []; let qi = 0; const gcol = new THREE.Color();
  for (const j of jets) {
    const s = j.anim ? 6.5 : 4.0, y = (j.y > yW + 1 ? j.y - 0.25 : yW + 0.04);
    gq.push(j.x - s, y, j.z - s, j.x + s, y, j.z - s, j.x + s, y, j.z + s, j.x - s, y, j.z + s); gc.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    gi.push(qi, qi + 2, qi + 1, qi, qi + 3, qi + 2); qi += 4;
  }
  // decals use their own uv
  const guv = []; for (let i = 0; i < jets.length; i++) guv.push(0, 0, 1, 0, 1, 1, 0, 1);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gq, 3)); gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gc), 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2)); gg.setIndex(gi);
  const glow = new THREE.Mesh(gg, mats.decal); glow.frustumCulled = false; glow.renderOrder = 7; root.add(glow);
  const cattr = gg.getAttribute('color');
  const hsv = (h, s, v) => gcol.setHSL(h, s, v);

  return {
    yG, yW, jets,
    update(dt, cam, time) {
      U2.uTime.value = time; wuniform.uTime.value = time;
      const size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
      U2.uScale.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
      // light colours per group (match jet hue in the shader)
      for (let i = 0; i < jets.length; i++) {
        const j = jets[i];
        const hue = ((time * 0.045 + j.group * 0.095 + 0.55) % 1 + 1) % 1;
        const wave = 0.5 + 0.5 * Math.sin(time * 0.95 + j.phase), pulse = 0.5 + 0.5 * Math.sin(time * 1.9 + j.phase * 0.6), show = Math.min(1, Math.max(0, (Math.sin(time * 0.11 + j.group * 0.4) + 0.3) / 0.6));
        const hf = j.anim ? (0.18 + 0.82 * (wave + (pulse - wave) * show)) : 1;
        gcol.setHSL(hue, 0.9, 0.5);
        const k = (j.anim ? 0.38 : 0.2) * (0.35 + 0.65 * hf);
        for (let v = 0; v < 4; v++) cattr.setXYZ(i * 4 + v, gcol.r * k, gcol.g * k, gcol.b * k);
      }
      cattr.needsUpdate = true;
      // water tint follows group 0 hue
      wuniform.uTint.value.setHSL(((time * 0.045 + 0.55) % 1), 0.8, 0.35);
    },
  };
}
