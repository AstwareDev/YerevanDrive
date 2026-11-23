// Dynamic, time-sliced reflection probe. scene.environment used to be a fixed synthetic night dome, so car paint, glass and wet metal
// reflected the same purple blobs at noon and in every street. Here a cube map is captured from the live scene around the player /
// camera focus and prefiltered with PMREM into the SAME render target every time (same size -> no shader recompiles):
//   * one cube face per frame (6 frames per refresh) at 128-256 px, far plane 600 m, shadow map NOT re-rendered for the probe
//   * refreshes only when the focus moved > 12 m, time of day changed, or every few seconds, so a parked camera costs nothing
//   * the player's car meshes, tyre smoke and sparks are hidden while a face renders (no self-reflection); its LIGHTS stay on, so the
//     light count -- part of every program key -- is the same as in the main view (no program switch per probe face)
//   * the prefiltered map is SANITISED (NaN / Inf -> 0, HDR clamped) before any material sees it: one bad texel in a capture used to be
//     blurred over the whole environment by PMREM and turned every lit surface white (D3D's shader compiler strips isnan()/isinf()).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// bit-level non-finite test: survives compilers that assume no NaN/Inf and drop isnan()/isinf()
export const FINITE_GLSL = /* glsl */`
bool nonFinite(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
vec4 sanitize(vec4 c, float maxV) { if (nonFinite(c.r) || nonFinite(c.g) || nonFinite(c.b) || nonFinite(c.a)) return vec4(0.0, 0.0, 0.0, 1.0); return vec4(clamp(c.rgb, 0.0, maxV), c.a); }
`;
void Pass;

export function createProbe({ renderer, scene, quality, fallback }) {
  const size = quality.level === 'ultra' ? 256 : 128;
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(1, 600, cubeRT); cam.coordinateSystem = renderer.coordinateSystem; cam.updateCoordinateSystem();
  const pmrem = new THREE.PMREMGenerator(renderer);
  // cube-UV copy that materials actually sample (2D, so the copy cannot get the cube orientation wrong)
  let cleanRT = null; const cleanMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FINITE_GLSL + 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = sanitize(texture2D(tSrc, vUv), 24.0); }' });
  const cleanQuad = new FullScreenQuad(cleanMat);
  let envRT = null, face = -1, last = new THREE.Vector3(1e9, 0, 0), lastDay = -1, lastT = -1e9, hidden = [];
  const pos = new THREE.Vector3();
  const hideList = () => { const out = []; const car = scene.getObjectByName('player-car'); car?.traverse(o => { if ((o.isMesh || o.isLine) && o.visible) out.push(o); }); scene.traverse(o => { if ((o.isPoints || o.userData.noProbe) && o.visible) out.push(o); }); return out; };

  function renderFace(i) {
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevXr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    for (const o of hidden) o.visible = false;
    const c = cam.children[i]; c.updateMatrixWorld();
    renderer.setRenderTarget(cubeRT, i); renderer.render(scene, c);
    for (const o of hidden) o.visible = true;
    renderer.setRenderTarget(prevTarget); renderer.shadowMap.autoUpdate = prevAuto; renderer.xr.enabled = prevXr;
  }
  let paceTick = 0;
  return {
    get texture() { return cleanRT?.texture ?? fallback; },
    /** call once per frame before the main render */
    enabled: true,
    minInterval: quality.level === 'ultra' ? 2.5 : 4,        // seconds between two refreshes (a refresh = 6 scene renders + a prefilter)
    moveDist: quality.level === 'ultra' ? 30 : 45,           // metres the focus must move before the street counts as changed
    stale: 10,                                               // refresh anyway after this many seconds
    pace: quality.level === 'ultra' ? 1 : 2,                 // render a cube face every N frames (higher = the cost is spread thinner)
    update(focus, day, time) {
      if (!this.enabled) return false;
      if (face < 0) {
        const moved = last.distanceToSquared(focus) > this.moveDist * this.moveDist, todChanged = Math.abs(day - lastDay) > 0.02, stale = time - lastT > this.stale;
        if (!(moved || todChanged || stale)) return false;
        if (time - lastT < this.minInterval && lastT > -1e8) return false;
        pos.set(focus.x, focus.y + 2.2, focus.z); cam.position.copy(pos); cam.updateMatrixWorld(true);
        last.copy(focus); lastDay = day; lastT = time; face = 0; hidden = hideList();
      }
      if (face >= 0 && ++paceTick % this.pace !== 0) return false;
      renderFace(face++);
      if (face === 6) {
        face = -1;
        envRT = pmrem.fromCubemap(cubeRT.texture, envRT);      // reuses the same target after the first time
        if (!cleanRT) { cleanRT = envRT.clone(); cleanRT.texture.mapping = THREE.CubeUVReflectionMapping; }
        const prev = renderer.getRenderTarget(); cleanMat.uniforms.tSrc.value = envRT.texture; renderer.setRenderTarget(cleanRT); cleanQuad.render(renderer); renderer.setRenderTarget(prev);
        if (scene.environment !== cleanRT.texture) scene.environment = cleanRT.texture;
        return true;
      }
      return false;
    },
    dispose() { cubeRT.dispose(); envRT?.dispose(); cleanRT?.dispose(); cleanMat.dispose(); cleanQuad.dispose(); pmrem.dispose(); },
  };
}
