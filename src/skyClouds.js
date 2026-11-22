// Shared GLSL for the volumetric clouds (quality.clouds >= 1). Used by
//   * src/sky.js            the sky dome (camera BELOW the cloud layer: the clouds are only ever seen against the sky, so a background pass is enough)
//   * src/post/scenefx.js   a depth-aware post pass (camera INSIDE or ABOVE the layer, free camera): the march stops at the scene depth, so the city sits correctly
//                           inside / below the clouds. Only runs while the camera is up there.
// World space: x east, y up (0 = Square ground), z south. The layer is a slab CH0..CH1 metres above the ground, the camera position comes in as uClPos.
// Entry point: cloudsAt(rayDir, maxDistance, day, dusk, cover) -> premultiplied radiance (rgb) + opacity (a), already faded with distance.
export const CLOUD_BASE_Y = 1800, CLOUD_TOP_Y = 4000;

export const CLOUD_GLSL = /* glsl */`
uniform sampler3D uClNoise; uniform float uClTime; uniform vec3 uClPos; uniform int uClSteps, uClLT;
const float CH0 = ${CLOUD_BASE_Y.toFixed(1)}, CH1 = ${CLOUD_TOP_Y.toFixed(1)}, SIG = 0.0021;       // slab base / top (m), extinction per metre at density 1
float gC = 0.6;                                                     // coverage of the current ray (0 clear .. 1 overcast)
float hgp(float c, float g){ float g2 = g*g; return (1. - g2) / pow(1. + g2 - 2.*g*c, 1.5); }
vec3 cloudQ(vec3 p){ return vec3(p.x + uClTime*9., p.y, p.z + uClTime*4.); }       // world position drifting with the wind
// large-scale 'where are the big cloud masses / how tall' map (one 48 km tile of the shape noise, in the xz plane)
float cloudMacro(vec3 q){ return textureLod(uClNoise, vec3(q.x*(1./48000.), 0.37, q.z*(1./48000.)), 0.).g; }
// coarse density: lumpy base shape x height profile (flat bellies, rounded tops, taller where the macro map is high) against a coverage threshold
float cloudBase(vec3 p, float mc){
  vec3 q = cloudQ(p);
  float hn = clamp((p.y - CH0) / (CH1 - CH0), 0., 1.);
  float top = mix(0.42, 1.0, mc);
  float prof = smoothstep(0., 0.10, hn) * (1. - smoothstep(top*0.55, top, hn));
  vec4 n = textureLod(uClNoise, q*(1./9000.), 0.);
  float s = (n.r*0.40 + n.g*0.34 + n.b*0.26) * prof * mix(0.85, 1.25, mc);          // r/g = big billows, b = mid-size lumps
  return clamp((s - mix(0.78, 0.23, gC)) / 0.24, 0., 1.);
}
// erosion noise (also sampled towards the light for bump shading) and the edge erosion it drives (more at the tops: wispy)
float erosion(vec3 p){ vec4 n = textureLod(uClNoise, cloudQ(p).zyx*(1./4500.), 0.); return n.b*0.7 + n.a*0.3; }
float cloudDetail(float er, float hn, float dn){ float k = mix(0.50, 0.90, hn); return clamp((dn - er*k) / (1. - er*k), 0., 1.); }

// light direction + colours per time of day (night: moon, silver, city glow under the bellies; dusk: dark blue deck, gold only towards the low sun)
void cloudLight(vec3 d, float day, float dusk, out vec3 L, out vec3 sunC, out vec3 aHi, out vec3 aLo){
  float wN = (1. - day) * (1. - dusk), wD = day * (1. - dusk);
  vec3 sunD = normalize(mix(normalize(vec3(-0.55, 0.62, 0.55)), vec3(-0.80, 0.05, 0.60), dusk));
  L = normalize(mix(normalize(vec3(-0.45, 0.5, -0.7)), sunD, max(day, dusk)));
  vec3 glow = vec3(0.17, 0.085, 0.12) * exp(-max(d.y, 0.) * 4.5);
  sunC = vec3(0.30, 0.40, 0.70) * 0.22 * wN + vec3(0.95, 0.90, 0.80) * wD + vec3(1.0, 0.50, 0.18) * 1.25 * dusk;
  sunC *= mix(1., mix(0.08, 1., smoothstep(0.5, 0.99, dot(d, L))), dusk);
  aHi = vec3(0.012, 0.016, 0.040) * wN + vec3(0.40, 0.50, 0.68) * wD + vec3(0.10, 0.14, 0.30) * dusk + glow * 0.18 * wN;
  aLo = vec3(0.018, 0.014, 0.030) * wN + vec3(0.26, 0.32, 0.46) * wD + vec3(0.035, 0.050, 0.120) * dusk + glow * 0.55 * wN;
}
float cloudCover(float cover, float day, float dusk, float h){
  float hh = uClPos.y > CH0 ? 1. : h;                                // no golden gap at the horizon when we are up in / above the layer
  return clamp(cover * mix(1., 0.62, day * (1. - dusk)), 0., 1.) * mix(1., 0.12 + 0.88 * smoothstep(0.02, 0.30, hh), dusk);
}

vec4 volClouds(vec3 d, float tMax, vec3 L, vec3 sunC, vec3 ambHi, vec3 ambLo){
  // ray / slab intersection from the camera (below, inside or above the layer)
  float y0 = uClPos.y, ta, tb;
  if (abs(d.y) < 0.0005){ if (y0 < CH0 || y0 > CH1) return vec4(0.); ta = 0.; tb = 1e9; }
  else { float tA = (CH0 - y0) / d.y, tB = (CH1 - y0) / d.y; ta = min(tA, tB); tb = max(tA, tB); }
  bool inside = ta <= 0.;
  ta = max(ta, 0.);
  if (tb <= 0. || ta > 110000. || ta >= tMax) return vec4(0.);
  float len = min(min(tb, tMax), ta + (inside ? 9000. : 28000.)) - ta;
  float N = float(uClSteps), bias = inside ? 0.85 : 0.6;                           // steps get denser near the camera (much more so when we are inside the cloud)
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float cosT = dot(d, L);
  float ph = min(mix(hgp(cosT, -0.22), hgp(cosT, 0.62), 0.5), 2.8);               // back lobe + forward lobe (silver lining towards the light)
  float pwK = 0.5 * (1. - smoothstep(0.3, 0.9, cosT));
  float T = 1., tSum = 0., wSum = 0.; vec3 acc = vec3(0.);
  for (int i = 0; i < 48; i++){
    if (i >= uClSteps || T < 0.03) break;
    float s = (float(i) + jit) / N;
    float t = ta + len * mix(s, s*s, bias);
    float dt = len / N * (1. - bias + 2. * bias * s);
    vec3 p = uClPos + d * t;
    float mc = cloudMacro(cloudQ(p));
    float dens = cloudBase(p, mc) * (1. - smoothstep(20000., 42000., t));          // clouds end in the haze: far samples are too coarse to look clean
    if (dens > 0.004){
      float hn = clamp((p.y - CH0) / (CH1 - CH0), 0., 1.), er0 = erosion(p);
      dens = cloudDetail(er0, hn, dens);
      if (dens > 0.004){
        float lt = 0., ls = 140.; vec3 lp = p;
        for (int k = 0; k < 4; k++){ if (k >= uClLT) break; lp += L * ls; lt += cloudBase(lp, mc) * ls; ls *= 2.0; }
        float tau = lt * SIG;
        float lightE = max(exp(-tau), 0.45 * exp(-tau * 0.2));                     // multiple-scattering fudge: shadowed cores keep some light
        lightE *= mix(1., 1. - exp(-dens * 4.), pwK);                              // 'powder': thin edges facing away from the light are darker
        lightE *= clamp(1. + 1.2 * (erosion(p + L * 130.) - er0), 0.5, 1.4);       // bump shading: lumps whose surface faces the light are brighter than their far sides
        vec3 S = sunC * (lightE * ph) + mix(ambLo, ambHi, smoothstep(0., 0.8, hn));
        float stepT = exp(-dens * SIG * dt), w = T * (1. - stepT);
        acc += w * S; tSum += w * t; wSum += w;
        T *= stepT;
      }
    }
  }
  float tm = wSum > 0.0001 ? tSum / wSum : ta;
  float hz = exp(-tm / 45000.);
  return vec4(acc * hz, (1. - T) * hz);
}

vec4 cloudsAt(vec3 d, float tMax, float day, float dusk, float cover){
  vec3 L, sunC, aHi, aLo; cloudLight(d, day, dusk, L, sunC, aHi, aLo);
  gC = cloudCover(cover, day, dusk, d.y);
  return volClouds(d, tMax, L, sunC, aHi, aLo);
}
`;
