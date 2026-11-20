// Final display pass: replaces three's OutputPass (tone mapping + sRGB) and folds the camera/film grade into the same full-screen pass:
// lens vignette (linear light, before tone mapping), subtle lateral chromatic aberration (ultra), display-space saturation/contrast,
// and blue-noise-like grain that doubles as dithering (kills 8-bit banding in the dark night-sky / fog gradients).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;                                   // (toneMappingExposure is declared by tonemapping_pars_fragment)
uniform float uVignette, uGrain, uCA, uSat, uContrast, uTime; uniform vec2 uRes;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 d = vUv - 0.5; vec3 c;
  if (uCA > 0.0) { vec2 o = d * dot(d, d) * uCA; c = vec3(texture2D(tDiffuse, vUv - o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + o).b); }
  else c = texture2D(tDiffuse, vUv).rgb;
  float r = length(d * vec2(uRes.x / uRes.y, 1.0));
  c *= mix(1.0, 1.0 - smoothstep(0.35, 1.15, r) * 0.85, uVignette);
  #if defined( LINEAR_TONE_MAPPING )
    c = LinearToneMapping( c );
  #elif defined( REINHARD_TONE_MAPPING )
    c = ReinhardToneMapping( c );
  #elif defined( CINEON_TONE_MAPPING )
    c = CineonToneMapping( c );
  #elif defined( ACES_FILMIC_TONE_MAPPING )
    c = ACESFilmicToneMapping( c );
  #elif defined( AGX_TONE_MAPPING )
    c = AgXToneMapping( c );
  #elif defined( NEUTRAL_TONE_MAPPING )
    c = NeutralToneMapping( c );
  #endif
  c = sRGBTransferOETF( vec4( c, 1.0 ) ).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = clamp(c, 0.0, 1.0); c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);               // gentle S-curve
  float n = ign(gl_FragCoord.xy + fract(uTime * 7.31) * 64.0) - 0.5;
  c += n * uGrain * (1.0 - l * 0.6);                                                     // grain is stronger in the shadows, like film
  gl_FragColor = vec4(c, 1.0);
}`;

export class FinalPass extends Pass {
  constructor(quality) {
    super();
    const ultra = quality.level === 'ultra', hi = ultra || quality.level === 'high';
    this.uniforms = {
      tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uVignette: { value: hi ? 0.32 : 0.2 }, uGrain: { value: ultra ? 0.022 : 0.012 }, uCA: { value: ultra ? 0.006 : 0 }, uSat: { value: 1.06 }, uContrast: { value: hi ? 0.14 : 0.08 },
    };
    // RawShaderMaterial (like OutputPass): a plain ShaderMaterial would get three's own tone-mapping prefix and apply it twice when rendering to screen
    this.material = new THREE.RawShaderMaterial({ uniforms: this.uniforms, vertexShader: 'precision highp float; attribute vec3 position; attribute vec2 uv; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRAG, depthTest: false, depthWrite: false });
    this.fsq = new FullScreenQuad(this.material); this._tm = null;
  }
  setSize(w, h) { this.uniforms.uRes.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms; u.tDiffuse.value = readBuffer.texture; u.toneMappingExposure.value = renderer.toneMappingExposure; u.uTime.value = performance.now() / 1000;
    if (this._tm !== renderer.toneMapping) {
      this._tm = renderer.toneMapping; const T = THREE, m = this.material; m.defines = {};
      const map = { [T.LinearToneMapping]: 'LINEAR', [T.ReinhardToneMapping]: 'REINHARD', [T.CineonToneMapping]: 'CINEON', [T.ACESFilmicToneMapping]: 'ACES_FILMIC', [T.AgXToneMapping]: 'AGX', [T.NeutralToneMapping]: 'NEUTRAL' };
      if (map[this._tm]) m.defines[map[this._tm] + '_TONE_MAPPING'] = ''; m.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsq.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsq.dispose(); }
}
