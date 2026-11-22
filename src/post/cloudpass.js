// Depth-aware volumetric clouds for a camera INSIDE or ABOVE the cloud layer (free camera / orbit high up). The sky dome (sky.js) only draws the clouds
// while the camera is below the layer, because a background pass cannot put the city inside or beneath them. Here the same march (src/skyClouds.js) runs
// over the finished scene: it stops at the scene depth, so buildings far below fade into the cloud haze, and flying into the layer gives real mist.
// SceneFXPass renders its composite into `target` instead of the writeBuffer while `active`, then this pass reads it and writes the writeBuffer.
// Costs nothing while the camera is under the layer (no render target, no draw).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CLOUD_GLSL, CLOUD_BASE_Y } from '../skyClouds.js';
import { sharedCloudNoise, cloudFade } from '../skyNoise.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = CLOUD_GLSL + /* glsl */`
uniform sampler2D tDiffuse, tDepth; uniform mat4 uProjInv, uCamWorld; uniform float uDay, uDusk, uVol;
varying vec2 vUv;
void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  float dpt = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, min(dpt, 0.99999) * 2.0 - 1.0, 1.0);
  vec3 P = v.xyz / v.w;
  vec3 dirW = normalize(mat3(uCamWorld) * P);
  float tMax = dpt < 0.99999 ? length(P) : 1e9;                                  // ray distance to the scene (sky pixels: unbounded)
  vec4 vc = cloudsAt(dirW, tMax, uDay, uDusk, 0.8);
  vec3 col = base.rgb * (1.0 - vc.a * uVol) + vc.rgb * uVol;
  gl_FragColor = vec4(min(col, vec3(48.0)), 1.0);
}`;

export class CloudComposite {
  constructor({ camera, depthTexture, quality }) {
    this.camera = camera; this.noise = sharedCloudNoise(); this.active = false; this.target = null; this.w = 1; this.h = 1;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: depthTexture }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uDay: { value: 0 }, uDusk: { value: 0 }, uVol: { value: 0 }, uClNoise: { value: this.noise.texture }, uClTime: { value: 0 }, uClPos: { value: new THREE.Vector3() },
      uClSteps: { value: quality.clouds >= 2 ? 26 : 14 }, uClLT: { value: quality.clouds >= 2 ? 3 : 2 },        // a few more steps than the dome: inside the layer the detail is close
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    this.fsq = new FullScreenQuad(this.mat);
  }
  setSize(w, h) { this.w = w; this.h = h; this.target?.setSize(w, h); }
  /** per frame: decides whether the pass runs (camera at / above the cloud base and the noise is ready) */
  update(time, day, dusk) {
    const c = this.camera, u = this.uniforms, vol = cloudFade(this.noise);
    this.active = vol > 0.001 && c.position.y > CLOUD_BASE_Y - 1;
    if (!this.active) return;
    u.uVol.value = vol; u.uDay.value = day; u.uDusk.value = dusk; u.uClTime.value = time; u.uClPos.value.copy(c.position);
    u.uProjInv.value.copy(c.projectionMatrixInverse); u.uCamWorld.value.copy(c.matrixWorld);
  }
  /** render target the scene composite must write into while `active` (created on first use) */
  getTarget() {
    return this.target ??= new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  }
  render(renderer, output) {
    this.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(output); this.fsq.render(renderer);
  }
  dispose() { this.target?.dispose(); this.mat.dispose(); this.fsq.dispose(); }
}
