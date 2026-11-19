import * as THREE from 'three';

// Night sky: gradient + city glow + stars + moon + the Ararat silhouette (real bearing ~199 deg, 56 km away).
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uMoon: { value: new THREE.Vector3(-0.45, 0.5, -0.7).normalize() }, uSun: { value: new THREE.Vector3(-0.55, 0.62, 0.55).normalize() }, uDay: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uMoon; uniform vec3 uSun; uniform float uDay;
      float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float n1(float x){ return fract(sin(x*127.1)*43758.5453); }
      float vn(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(n1(i), n1(i+1.), f); }
      float ridge(float az, float c, float hgt, float hw, float roughness){
        float d = abs(az - c); d = min(d, 360. - d);
        float t = clamp(1. - d / hw, 0., 1.);
        float prof = hgt * pow(t, 1.25);
        prof += (vn(az*3.1) - .5) * roughness * smoothstep(0.,.3,t) + (vn(az*11.) - .5) * roughness*.35 * smoothstep(0.,.3,t);
        return prof;
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 horizon = vec3(0.115, 0.075, 0.13), mid = vec3(0.020, 0.030, 0.070), zen = vec3(0.004, 0.007, 0.022);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zen, smoothstep(0.18, 0.85, h));
        if (h < 0.0) col = horizon * 0.85;             // below the horizon: same colour as the fog
        // daytime sky (blended by uDay)
        {
          vec3 dz = vec3(0.16, 0.36, 0.78), dm = vec3(0.42, 0.62, 0.90), dh = vec3(0.74, 0.82, 0.92);
          vec3 dc = mix(dh, dm, smoothstep(0.0, 0.18, h)); dc = mix(dc, dz, smoothstep(0.15, 0.8, h));
          if (h < 0.0) dc = dh;
          float sd2 = max(dot(d, normalize(uSun)), 0.);
          dc += vec3(1.0, 0.9, 0.7) * (pow(sd2, 900.) * 6. + pow(sd2, 40.) * 0.25 + pow(sd2, 6.) * 0.08);
          // thin cloud streaks
          float cl = smoothstep(0.55, 0.9, vn(d.x * 7. + vn(d.z * 5.) * 2.) * vn(d.z * 6. + d.y * 9.)) * smoothstep(0.05, 0.35, h) * 0.35;
          dc = mix(dc, vec3(1.), cl);
          col = mix(col, dc, uDay);
        }
        // stars
        if (h > 0.02) { vec3 sd = d * 170.; vec3 id = floor(sd); vec3 f = fract(sd) - 0.5; vec3 off = vec3(h31(id+1.), h31(id+2.), h31(id+3.)) - 0.5; float s = h31(id); float dd = length(f - off * 0.7); float st = step(0.985, s) * smoothstep(0.14, 0.0, dd) * smoothstep(0.02, 0.3, h); col += vec3(0.8,0.85,1.) * st * (0.35 + 0.65*h31(id+9.)) * 1.4 * (1.-uDay); }
        // moon
        float md = dot(d, normalize(uMoon));
        float nightK = 1. - uDay;
        col += vec3(0.85,0.9,1.0) * smoothstep(0.99955, 0.99975, md) * 1.4 * nightK;
        col += (vec3(0.25,0.32,0.5) * pow(max(md,0.), 220.) * 0.5 + vec3(0.06,0.08,0.14) * pow(max(md,0.), 18.)) * nightK;
        // Ararat (greater 199 deg, 4.3 deg high) and Little Ararat (186.5 deg, 3.1 deg)
        float az = degrees(atan(d.x, -d.z)); az = mod(az + 360., 360.);
        float el = degrees(asin(clamp(h, -1., 1.)));
        float m1 = ridge(az, 199., 4.4, 11., 0.22), m2 = ridge(az, 186.5, 3.1, 7., 0.16);
        float m = max(m1, m2);
        if (m > 0.05 && el < m && el > -0.2) {
          float k = el / max(m, 0.001);
          vec3 rock = mix(vec3(0.020, 0.026, 0.045), vec3(0.44, 0.40, 0.42), uDay), snow = mix(vec3(0.12, 0.15, 0.24), vec3(0.95, 0.96, 1.0), uDay);
          vec3 mc = mix(mix(horizon * 0.55, vec3(0.64, 0.7, 0.82), uDay), rock, smoothstep(0.0, 0.4, k));
          mc = mix(mc, snow, smoothstep(0.62, 0.82, k) * smoothstep(1.6, 2.6, m));
          col = mc;
        }
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}
