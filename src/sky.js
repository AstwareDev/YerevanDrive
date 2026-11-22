import * as THREE from 'three';
import { quality } from './quality.js';
import { sharedCloudNoise, cloudFade } from './skyNoise.js';
import { CLOUD_GLSL } from './skyClouds.js';

// Sky: night / dusk / day gradients + clouds + stars + moon + the Ararat massif (real bearing ~199 deg, 56 km away: snow-capped, lit from the sun side, hazed at the foot).
//   Clouds, two implementations (quality.clouds, ?clouds=0|1|2):
//     0  procedural 2D decks (banded, wind-driven, lit by sun or moon): Low / Med, and the stand-in while the 3D noise is still being generated
//     1/2  volumetric: a slab 1.8-4 km above the ground (src/skyClouds.js, shared with the depth-aware pass in post/scenefx.js for a camera inside / above it) is ray-marched through a tileable 3D noise texture (src/skyNoise.js) with Beer-Lambert extinction,
//          a 2-lobe Henyey-Greenstein phase (silver lining), a short march towards the light for self-shadowing, a multiple-scattering fudge and a height-based
//          ambient (bright tops, dark bellies, city glow underneath at night). 1 = High (12 steps, 2 light taps), 2 = Ultra (22 steps, 3 taps).
//     The thin high veil (layer 2 of the 2D version) stays on top of both.
export function createSky() {
  const cloudLv = quality.clouds | 0, volSteps = cloudLv >= 2 ? 22 : 12, volTaps = cloudLv >= 2 ? 3 : 2;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uMoon: { value: new THREE.Vector3(-0.45, 0.5, -0.7).normalize() }, uSun: { value: new THREE.Vector3(-0.55, 0.62, 0.55).normalize() }, uDay: { value: 0 }, uDusk: { value: 0 }, uTime: { value: 0 }, uCover: { value: 0.8 }, uOct: { value: quality.level === 'low' ? 3 : 5 },
      uClNoise: { value: null }, uVol: { value: 0 }, uClSteps: { value: volSteps }, uClLT: { value: volTaps }, uClTime: { value: 0 }, uClPos: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uMoon; uniform vec3 uSun; uniform float uDay, uDusk, uTime, uCover; uniform int uOct;
      uniform float uVol;
      ${CLOUD_GLSL}
      float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
      // value noise that wraps in x with integer period per (so clouds tile seamlessly around the horizon)
      float vnoiseP(vec2 p, float per){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); float x0 = mod(i.x, per), x1 = mod(i.x + 1., per);
        return mix(mix(hash21(vec2(x0, i.y)), hash21(vec2(x1, i.y)), f.x), mix(hash21(vec2(x0, i.y + 1.)), hash21(vec2(x1, i.y + 1.)), f.x), f.y); }
      float fbmP(vec2 p, float per){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ if (i >= uOct) break; v += a*vnoiseP(p, per); p = vec2(p.x*2., p.y*2.03 + 9.7); per *= 2.; a *= .5; } return v; }
      // q = (azimuth in 0..per, radial 1/(h+k)): horizontal, wavy cloud bands that keep their shape all around the sky
      float cloudDen(vec2 q, float per, float seed){
        q += vec2(uTime*0.045, seed);
        float w = fbmP(q*vec2(1., 1.1) + vec2(3.1, 1.7), per);
        q += vec2(w*0.9, w*0.5);
        return fbmP(q, per)*0.72 + fbmP(vec2(q.x*4., q.y*3.4 + 7.7), per*4.)*0.42;
      }

      float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float n1(float x){ return fract(sin(x*127.1)*43758.5453); }
      float vn(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(n1(i), n1(i+1.), f); }
      float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash21(i), hash21(i + vec2(1., 0.)), f.x), mix(hash21(i + vec2(0., 1.)), hash21(i + vec2(1., 1.)), f.x), f.y); }
      // ---------------------------------------------------------------- Ararat massif (angles in degrees, seen from Yerevan ~56 km away)
      float dAz(float az, float c){ float d = az - c; return d - 360.*floor((d + 180.)/360.); }
      // one volcano flank profile: S-curve (broad foot, straight slope, rounded crown) with a different half-width on each side; sharp -> conical
      float flank(float d, float hwL, float hwR, float H, float sharp){
        float t = clamp(1. - abs(d) / (d < 0. ? hwL : hwR), 0., 1.);
        return H * mix(t*t*(3. - 2.*t), pow(t, 1.12), sharp);
      }
      float smax(float a, float b, float k){ float h = clamp(.5 + .5*(a - b)/k, 0., 1.); return mix(b, a, h) + k*h*(1. - h); }
      // x = silhouette elevation, y = facing (-1 left .. 1 right) of the slope at this azimuth, z = azimuth offset from the nearest summit, w = that summit's height
      vec4 massif(float az){
        float dg = dAz(az, 199.), dl = dAz(az, 186.4);
        float g = flank(dg, 8.5, 15., 4.35, .2);                       // Greater Ararat (5137 m): broad dome, long gentle eastern shoulder
        g += flank(dAz(az, 206.5), 4.5, 5.5, .8, 0.) + flank(dAz(az, 191.5), 3.2, 3.2, .7, 0.);   // side ridges breaking up the flanks
        float l = flank(dl, 4.6, 6.2, 3.05, .8);                        // Little Ararat (3896 m): the sharper cone
        float m = smax(g, l, .35);
        float foot = .5 * smoothstep(48., 6., abs(dAz(az, 196.))) * (.75 + .5*vn(az*1.7));        // the highlands the pair rises from, melting into the horizon haze
        m = smax(m, foot, .25);
        m += ((vn(az*2.3) - .5)*.16 + (vn(az*8.7) - .5)*.07 + (vn(az*29.) - .5)*.022) * smoothstep(.05, 1.2, m);
        bool gr = g >= l;
        float d = gr ? dg : dl, hw = (d < 0.) ? (gr ? 8.5 : 4.6) : (gr ? 15. : 6.2);
        return vec4(m, clamp(d / hw * 1.5, -1., 1.), d, gr ? 4.35 : 3.05);
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sunD = normalize(mix(normalize(uSun), vec3(-0.80, 0.05, 0.60), uDusk));        // at dusk the sun sits low on the horizon
        vec3 horizon = vec3(0.115, 0.075, 0.13), mid = vec3(0.020, 0.030, 0.070), zen = vec3(0.004, 0.007, 0.022);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zen, smoothstep(0.18, 0.85, h));
        if (h < 0.0) col = horizon * 0.85;             // below the horizon: same colour as the fog
        // daytime sky (blended by uDay)
        {
          vec3 dz = vec3(0.16, 0.36, 0.78), dm = vec3(0.42, 0.62, 0.90), dh = vec3(0.74, 0.82, 0.92);
          vec3 dc = mix(dh, dm, smoothstep(0.0, 0.18, h)); dc = mix(dc, dz, smoothstep(0.15, 0.8, h));
          if (h < 0.0) dc = dh;
          float sd2 = max(dot(d, sunD), 0.);
          dc += vec3(1.0, 0.9, 0.7) * (pow(sd2, 900.) * 6. + pow(sd2, 40.) * 0.25 + pow(sd2, 6.) * 0.08);
          col = mix(col, dc, uDay);
        }
        // stars
        if (h > 0.02) { vec3 sd = d * 170.; vec3 id = floor(sd); vec3 f = fract(sd) - 0.5; vec3 off = vec3(h31(id+1.), h31(id+2.), h31(id+3.)) - 0.5; float s = h31(id); float dd = length(f - off * 0.7); float st = step(0.985, s) * smoothstep(0.14, 0.0, dd) * smoothstep(0.02, 0.3, h); col += vec3(0.8,0.85,1.) * st * (0.35 + 0.65*h31(id+9.)) * 1.4 * (1.-uDay) * (1.-uDusk); }
        // moon
        float md = dot(d, normalize(uMoon));
        float nightK = 1. - uDay;
        col += vec3(0.85,0.9,1.0) * smoothstep(0.99955, 0.99975, md) * 1.4 * nightK;
        col += (vec3(0.25,0.32,0.5) * pow(max(md,0.), 220.) * 0.5 + vec3(0.06,0.08,0.14) * pow(max(md,0.), 18.)) * nightK;
        // ---- dusk sky (golden hour): warm band towards the sun, deep blue above
        vec3 sunH = normalize(vec3(sunD.x, 0., sunD.z));
        float ang = max(dot(normalize(vec3(d.x, 0.0001, d.z)), sunH), 0.);
        if (uDusk > 0.001) {
          vec3 hz = mix(vec3(0.50, 0.36, 0.42), vec3(1.0, 0.58, 0.20), pow(ang, 3.));
          vec3 dk = mix(hz, vec3(0.10, 0.15, 0.33), smoothstep(0.0, 0.26, h)); dk = mix(dk, vec3(0.025, 0.045, 0.13), smoothstep(0.2, 0.9, h));
          float sdd = max(dot(d, sunD), 0.);
          dk += vec3(1.0, 0.52, 0.16) * (pow(ang, 6.) * exp(-max(h, 0.)*13.) * 0.85 + pow(sdd, 10.) * 0.5 + pow(sdd, 120.) * 1.4);
          if (h < 0.0) dk = hz * 0.8;
          col = mix(col, dk, uDusk);
        }
        // ---- Ararat: Greater (199 deg, 4.35 deg high) and Little Ararat (186.4 deg, 3.05 deg), drawn before the clouds (which are nearer, 1.8+ km up)
        {
          float az = mod(degrees(atan(d.x, -d.z)) + 360., 360.), el = degrees(asin(clamp(h, -1., 1.)));
          vec4 M = massif(az);
          float e = M.x - el, aw = max(fwidth(e), 1e-4);
          float cov = clamp(e / aw + .5, 0., 1.) * smoothstep(-3.6, -2.4, el);
          if (cov > 0.001) {
            // gullies fan out from the summit; they alternate the slope's facing (light / shade) and carve ragged snow tongues
            float gx = M.z / (M.w - el + .9);
            float gn = vn2(vec2(gx*4.5, el*.35))*.5 + vn2(vec2(gx*13. + 3., el*.8))*.3 + vn2(vec2(M.z*40., el*2.))*.2;
            float sunAz = degrees(atan(sunD.x, -sunD.z));
            float sgn = clamp(sin(radians(sunAz - az)) * 4., -1., 1.);
            float fc = clamp(M.y*1.2 + (gn - .5)*1.6*smoothstep(.1, 1., el), -1., 1.);
            float lit = smoothstep(.08, .92, .5 + .5*sgn*fc + .14*smoothstep(.65, 1., el / M.w));
            float snow = smoothstep(1.25 + (gn - .5)*1.5 - .1, 1.25 + (gn - .5)*1.5 + .1, el);
            float wN = (1. - uDay)*(1. - uDusk), wD = uDay*(1. - uDusk);
            vec3 snowLit = vec3(.20, .25, .38)*wN + vec3(.98, .98, 1.)*wD + vec3(1., .62, .42)*uDusk;
            vec3 snowSh  = vec3(.05, .07, .14)*wN + vec3(.60, .68, .86)*wD + vec3(.42, .42, .68)*uDusk;
            vec3 rockLit = vec3(.04, .045, .07)*wN + vec3(.56, .50, .48)*wD + vec3(.60, .32, .26)*uDusk;
            vec3 rockSh  = vec3(.02, .025, .045)*wN + vec3(.34, .37, .50)*wD + vec3(.20, .20, .36)*uDusk;
            vec3 mcol = mix(mix(rockSh, rockLit, lit), mix(snowSh, snowLit, lit), snow);
            // aerial perspective: everything is slightly veiled, the foothills melt into the horizon haze
            float hzv = .2 + .7*(1. - smoothstep(.1, 1.7, el));
            col = mix(col, mix(mcol, col, hzv), cov);
          }
        }
        // ---- clouds: a low dark banded deck + a higher thin veil, shaded against the sun (dusk/day) or the moon (night)
        if (h > 0.0) {
          float cov = mix(0.60, 0.40, uCover * mix(1., 0.62, uDay * (1. - uDusk)));       // broken cloud with blue gaps by day, heavy deck at dusk / night
          float hfade = smoothstep(0.0, 0.07, h), zen = smoothstep(0.82, 1.0, h);
          float th = atan(d.x, d.z) * 0.15915494;                       // azimuth as 0..1 turns
          float lz = mix(-0.14, 0.14, max(uDay, uDusk));                  // light comes from the horizon side at dusk/day, from above (moon) at night
          // layer 1: low dark banded deck (replaced by the volumetric slab once the 3D noise is ready)
          float a1 = 0., lit1 = 0., edge1 = 0.;
          if (uVol < 0.999){
            vec2 q1 = vec2(th * 10., 1.0 / (h + 0.13) * 2.1);
            float den1 = mix(cloudDen(q1, 10., 0.), 0.5, zen), dl1 = mix(cloudDen(q1 + vec2(0., lz), 10., 0.), 0.5, zen);
            a1 = smoothstep(cov, cov + 0.13, den1) * hfade;
            a1 *= mix(1., smoothstep(0.035, 0.28, h), uDusk);                                 // open golden gap just above the horizon at dusk
            lit1 = clamp(0.55 - (dl1 - den1) * 4.5, 0., 1.);
            edge1 = smoothstep(cov, cov + 0.05, den1) * (1. - smoothstep(cov + 0.07, cov + 0.32, den1));
            a1 *= 1. - uVol;
          }
          // layer 2: higher, thinner veil
          vec2 q2 = vec2(th * 6., 1.0 / (h + 0.3) * 1.3);
          float den2 = mix(cloudDen(q2, 6., 41.), 0.5, zen);
          float a2 = smoothstep(cov + 0.06, cov + 0.3, den2) * 0.55 * smoothstep(0.05, 0.3, h) * (1. - a1 * 0.6);
          float a = 1. - (1. - a1) * (1. - a2);
          float sunA = pow(ang, 2.);
          // night: dark blue-violet, silver rim facing the moon, orange-violet city glow underneath
          vec3 cN = mix(vec3(0.020, 0.026, 0.058), vec3(0.15, 0.19, 0.30), lit1 * max(dot(d, normalize(uMoon)) * 0.5 + 0.5, 0.) * 0.7) + vec3(0.17, 0.085, 0.12) * exp(-h * 4.5) * (1. - lit1 * 0.5);
          // day: white tops, blue-grey bellies
          vec3 cD = mix(vec3(0.50, 0.57, 0.70), vec3(1.0, 0.99, 0.96), lit1);
          // dusk: heavy dark-blue deck, gold rims where it thins towards the sun
          vec3 cU = mix(vec3(0.055, 0.080, 0.175), mix(vec3(0.24, 0.32, 0.54), vec3(1.0, 0.66, 0.28), sunA), lit1 * lit1 * 0.8) + vec3(1.0, 0.58, 0.20) * edge1 * sunA * 1.6;
          float wN = (1. - uDay) * (1. - uDusk), wD = uDay * (1. - uDusk);
          vec3 cc = cN * wN + cD * wD + cU * uDusk;
          // the high veil is brighter and catches more light
          vec3 cv2 = mix(cc, cc * (1.0 + 0.5 * (1. - uDusk)) + vec3(0.05, 0.04, 0.05) * (wN + wD) + vec3(0.25, 0.14, 0.06) * sunA * uDusk, 0.6);
          vec3 cl = mix(cc, cv2, a2 / max(a, 0.001) * (1. - a1));
          col = mix(col, cl, a);
          // volumetric slab on top (it is below the high veil). Only while the camera is below the layer: from inside / above it the depth-aware
          // pass in post/scenefx.js draws the clouds instead (a background dome cannot put the city inside the clouds)
          if (uVol > 0.001 && uClPos.y < CH0){
            vec4 vc = cloudsAt(d, 1e9, uDay, uDusk, uCover) * smoothstep(0.0, 0.07, h);
            col = col * (1. - vc.a * uVol) + vc.rgb * uVol;
          }
        }
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  if (cloudLv > 0) {
    // the 3D noise is generated in the background; the 2D clouds show until it is ready, then cross-fade over 2.5 s
    const noise = sharedCloudNoise(), u = mat.uniforms, cp = new THREE.Vector3();
    u.uClNoise.value = noise.texture;
    mesh.onBeforeRender = (renderer, scene, camera) => {
      const cube = !!renderer.getRenderTarget()?.isWebGLCubeRenderTarget;                // reflection-probe faces: a rough, cheap pass is plenty
      u.uVol.value = cloudFade(noise);
      u.uClSteps.value = cube ? 6 : volSteps; u.uClLT.value = cube ? 1 : volTaps;
      u.uClTime.value = u.uTime.value; u.uClPos.value.copy(camera.getWorldPosition(cp));
      mat.uniformsNeedUpdate = true;
    };
  }
  return mesh;
}
