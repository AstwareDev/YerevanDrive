// Drift visual effects: persistent rubber skid marks (ring buffer of tread-textured ribbons draped on the road), volumetric-looking tyre smoke
// (instanced billboards whose fragment shader ray-less "fakes" a lit, self-shadowed, wind-eroded puff from a tileable noise texture) and sparks
// (additive, bloom-friendly) from scrapes / impacts. Smoke + skid budgets scale with the quality preset (ultra = thousands of puffs, 3-tap lighting).
import * as THREE from 'three';
import { quality } from '../quality.js';

const LEVEL = { low: 0, med: 1, high: 2, ultra: 3 }[quality.level] ?? 1;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------------ skid marks
/** tread-pattern rubber stripe: u across the tyre (ragged soft edges, 3 grooves), v along the road (tileable blotches + grain) */
function skidTexture() {
  const W = 128, H = 256, d = new Uint8Array(W * H * 4);
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lat = (n, per) => { const g = Float32Array.from({ length: per }, rnd); return v => { const x = v * per, i = Math.floor(x), t = x - i, u = t * t * (3 - 2 * t); return g[i % per] * (1 - u) + g[(i + 1) % per] * u; }; };
  const edgeL = lat(0, 16), edgeR = lat(0, 16), blot = lat(0, 8), blot2 = lat(0, 32);
  for (let j = 0; j < H; j++) {
    const v = j / H, eL = 0.05 + 0.1 * edgeL(v) + 0.04 * blot2(v), eR = 0.05 + 0.1 * edgeR(v) + 0.04 * blot2((v + 0.3) % 1), body = 0.62 + 0.38 * blot(v) + 0.2 * (blot2(v) - 0.5);
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W, edge = sstep(eL - 0.05, eL + 0.07, u) * sstep(eR - 0.05, eR + 0.07, 1 - u);
      let tread = 1; for (const g of [0.27, 0.5, 0.73]) tread -= 0.42 * Math.exp(-Math.pow((u - g) / 0.028, 2));
      const grain = 0.72 + 0.28 * rnd(), a = Math.min(1, edge * Math.max(0.12, body) * tread * grain * 1.15);
      const k = (j * W + i) * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}

export function createSkids({ scene, ground, max = [5000, 9000, 14000, 22000][LEVEL] }) {
  const pos = new Float32Array(max * 12), uv = new Float32Array(max * 8), col = new Float32Array(max * 16), idx = new Uint32Array(max * 6);
  for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6); }
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), aUv = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage), aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('uv', aUv); geo.setAttribute('color', aCol);
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ map: skidTexture(), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'skid-marks'; scene.add(mesh);
  let head = 0, count = 0; const ranges = [];            // dirty segment ranges [from, to) since the last upload (partial GPU upload: the whole ring is megabytes)
  const touch = i => { const r = ranges[ranges.length - 1]; if (r && r[1] === i) r[1] = i + 1; else ranges.push([i, i + 1]); };
  const pen = Array.from({ length: 4 }, () => ({ on: false, has: false, x: 0, z: 0, dx: 0, dz: 1, a: 0, v: 0, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0 }));
  const Y = 0.13, TAPER = 0.55;
  function seg(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, a0, a1, v0, v1) {       // a,b = previous right/left edge, c,d = new edge
    const i = head, o = i * 12, u = i * 8, k = i * 16;
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az; pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz; pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz; pos[o + 9] = dx; pos[o + 10] = dy; pos[o + 11] = dz;
    uv[u] = 0; uv[u + 1] = v0; uv[u + 2] = 1; uv[u + 3] = v0; uv[u + 4] = 1; uv[u + 5] = v1; uv[u + 6] = 0; uv[u + 7] = v1;
    for (let n = 0; n < 4; n++) { col[k + n * 4] = 0.012; col[k + n * 4 + 1] = 0.011; col[k + n * 4 + 2] = 0.011; col[k + n * 4 + 3] = n < 2 ? a0 : a1; }
    touch(i); head = (head + 1) % max; count = Math.min(max, count + 1);
  }
  function endMark(p) {         // fade the stripe out over the last ~0.6 m instead of cutting it off
    if (!p.has) return;
    const half = p.half, nx = -p.dz * half, nz = p.dx * half, L = TAPER, x = p.x + p.dx * L, z = p.z + p.dz * L, y = ground.y(x, z) + Y;
    seg(p.lx, p.ly, p.lz, p.rx, p.ry, p.rz, x - nx, y, z - nz, x + nx, y, z + nz, p.a, 0, p.v, p.v + L / 1.4);
    p.has = false;
  }
  return {
    mesh,
    /** register a wheel's patch this frame. intensity 0..1, surf = ground surface id (marks only on hard surfaces) */
    feed(w, x, z, intensity, surf) {
      const p = pen[w], hard = surf !== 0 && surf !== 4; p.half = w < 2 ? 0.125 : 0.165;
      if (intensity < 0.05 || !hard) { if (p.on) { endMark(p); p.on = false; } return; }
      if (!p.on) { p.on = true; p.x = x; p.z = z; p.has = false; p.a = 0; return; }
      const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz);
      if (l < 0.16) return;
      if (l > 3) { p.on = true; p.x = x; p.z = z; p.has = false; return; }
      const half = p.half, ux = dx / l, uz = dz / l, nx = -uz * half, nz = ux * half, y0 = ground.y(p.x, p.z) + Y, y1 = ground.y(x, z) + Y;
      const a1 = Math.min(0.9, 0.34 + 0.72 * intensity), a0 = p.has ? p.a : 0;           // a new stripe starts transparent and builds up over its first segment
      const Lx = x + nx, Lz = z + nz, Rx = x - nx, Rz = z - nz;
      const Ax = p.has ? p.lx : p.x + nx, Ay = p.has ? p.ly : y0, Az = p.has ? p.lz : p.z + nz, Bx = p.has ? p.rx : p.x - nx, By = p.has ? p.ry : y0, Bz = p.has ? p.rz : p.z - nz;
      seg(Ax, Ay, Az, Bx, By, Bz, Rx, y1, Rz, Lx, y1, Lz, a0, a1, p.v, p.v + l / 1.4);
      p.lx = Lx; p.ly = y1; p.lz = Lz; p.rx = Rx; p.ry = y1; p.rz = Rz; p.has = true; p.x = x; p.z = z; p.dx = ux; p.dz = uz; p.a = a1; p.v += l / 1.4;
    },
    update() {
      if (!ranges.length) return;
      for (const [s, e] of ranges) { aPos.addUpdateRange(s * 12, (e - s) * 12); aUv.addUpdateRange(s * 8, (e - s) * 8); aCol.addUpdateRange(s * 16, (e - s) * 16); }
      ranges.length = 0; aPos.needsUpdate = aUv.needsUpdate = aCol.needsUpdate = true; geo.setDrawRange(0, count * 6);
    },
    clear() { head = 0; count = 0; ranges.length = 0; geo.setDrawRange(0, 0); for (const p of pen) { p.on = false; p.has = false; } },
  };
}

// ------------------------------------------------------------------------------------------------ smoke
/** tileable value-noise atlas in the 4 channels (R billow, G mid, B fine, A smooth warp field); sampled by the puff shader */
function noiseTexture(S = 256) {
  const d = new Uint8Array(S * S * 4);
  let seed = 90210; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const layer = (cells, amp) => { const g = Float32Array.from({ length: cells * cells }, rnd); return { cells, amp, g }; };
  const chans = [[3, 6, 12, 24], [5, 10, 20, 40], [9, 18, 36, 72], [2, 4, 8, 16]].map(f => f.map((c, i) => layer(c, Math.pow(0.5, i))));
  for (let ch = 0; ch < 4; ch++) {
    const L = chans[ch], norm = L.reduce((a, l) => a + l.amp, 0);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0;
      for (const l of L) {
        const fx = x / S * l.cells, fy = y / S * l.cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty), c = l.cells;
        const a = l.g[(iy % c) * c + (ix % c)], b = l.g[(iy % c) * c + ((ix + 1) % c)], e = l.g[((iy + 1) % c) * c + (ix % c)], f = l.g[((iy + 1) % c) * c + ((ix + 1) % c)];
        v += l.amp * ((a * (1 - ux) + b * ux) * (1 - uy) + (e * (1 - ux) + f * ux) * uy);
      }
      v /= norm; d[(y * S + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(((v - 0.5) * 1.5 + 0.5) * 255)));    // stretch the contrast: a sum of octaves is clustered around 0.5
    }
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}

const SMOKE_VS = /* glsl */`
  attribute vec2 aC; attribute vec3 iPos; attribute vec4 iA; attribute vec4 iS;
  uniform vec3 uCamR; uniform vec3 uCamU; uniform vec3 uCar;
  varying vec2 vC; varying vec4 vA; varying vec4 vS; varying vec2 vRot; varying float vWY; varying float vD; varying float vZ;
  #include <fog_pars_vertex>
  void main(){
    vec3 wp = iPos + (uCamR * aC.x + uCamU * aC.y) * iA.y;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vC = aC; vA = iA; vS = iS; vRot = vec2(cos(iA.w), sin(iA.w)); vWY = wp.y - iS.y; vD = length(iPos - uCar); vZ = -mvPosition.z;
    #include <fog_vertex>
  }`;
const smokeFS = detail => /* glsl */`
  #define DETAIL ${detail}
  uniform sampler2D uNoise; uniform vec3 uLightV; uniform vec3 uSun; uniform vec3 uSky; uniform vec3 uGnd; uniform vec3 uCarLight; uniform float uDay;
  varying vec2 vC; varying vec4 vA; varying vec4 vS; varying vec2 vRot; varying float vWY; varying float vD; varying float vZ;
  #include <fog_pars_fragment>
  // density of the puff at billboard-space point c (already rotated): round envelope eroded by warped fractal noise; erosion grows with age (wispy, torn edges)
  float D(vec2 c){
    float r = length(c), age = vA.x, t = age * vS.z;
    vec2 q = c * 0.5 + vec2(vS.x * 13.17, vS.x * 7.31);
    vec2 w = texture2D(uNoise, q * 0.7 + vec2(t * 0.10, -t * 0.06)).ar - 0.5;
    vec2 p = q + w * 0.85;
    vec4 n4 = texture2D(uNoise, p);
    float n = n4.r * 0.6 + n4.g * 0.4;
    #if DETAIL >= 2
      n = n * 0.82 + texture2D(uNoise, p * 2.3 + vec2(-t * 0.18, t * 0.07)).b * 0.18;
    #endif
    float shape = 1.0 - smoothstep(0.04, 1.0, r);
    return clamp(shape * 1.4 + (n - 0.5) * (1.1 + 1.5 * age) - 0.15 - 0.22 * age, 0.0, 1.0);
  }
  void main(){
    float age = vA.x;
    vec2 c = vec2(vRot.x * vC.x - vRot.y * vC.y, vRot.y * vC.x + vRot.x * vC.y);
    float d = D(c);
    float life = smoothstep(0.0, 0.04, age) * pow(1.0 - age, 1.35);
    float alpha = (1.0 - exp(-d * 3.4)) * vA.z * life * smoothstep(0.02, 0.32, vWY) * smoothstep(0.35, 2.2, vZ);
    if (alpha < 0.003) discard;
    // self-shadowing: short taps toward the light through the puff itself
    vec2 lr = vec2(vRot.x * uLightV.x - vRot.y * uLightV.y, vRot.y * uLightV.x + vRot.x * uLightV.y);
    float tl = 1.0;
    #if DETAIL >= 1
      tl = exp(-D(c + lr * 0.22) * 2.1);
    #endif
    #if DETAIL >= 3
      tl *= exp(-D(c + lr * 0.5) * 1.5);
    #endif
    float fwd = smoothstep(0.15, -0.85, uLightV.z);                       // sun behind the smoke as seen from the camera: thin edges glow (forward scattering)
    float phase = 0.55 + 0.45 * (1.0 - fwd) + 1.5 * fwd * (1.0 - d) * (1.0 - d);
    vec3 amb = mix(vec3(dot(uSky, vec3(0.333))), mix(uGnd, uSky, 0.5 + 0.4 * clamp(vC.y, -1.0, 1.0)), 0.55) * 0.62;
    vec3 albedo = vec3(0.86, 0.865, 0.89) * (0.82 + 0.18 * age) * (1.0 - 0.18 * vS.w);
    vec3 col = albedo * (amb + uSun * tl * phase * 0.92) + uCarLight * exp(-vD / 5.5) * 0.55 * (1.0 - uDay * 0.6);
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }`;

export function createSmoke({ scene, ground, max = [450, 1500, 3400, 7000][LEVEL] }) {
  const P = new Float32Array(max * 3), V = new Float32Array(max * 3), IA = new Float32Array(max * 4), IS = new Float32Array(max * 4);
  const life = new Float32Array(max), s0 = new Float32Array(max), s1 = new Float32Array(max), a0 = new Float32Array(max), spin = new Float32Array(max), heat = new Float32Array(max);
  let n = 0, frame = 0, time = 0;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));       // unused, but three wants a position attribute for the draw call
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = (a, k) => new THREE.InstancedBufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
  const aPos = mk(P, 3), aIA = mk(IA, 4), aIS = mk(IS, 4);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iA', aIA); geo.setAttribute('iS', aIS); geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uNoise: { value: noiseTexture() }, uDay: { value: 0 }, uCar: { value: new THREE.Vector3() }, uCarLight: { value: new THREE.Vector3(1.0, 0.82, 0.62) },
      uCamR: { value: new THREE.Vector3(1, 0, 0) }, uCamU: { value: new THREE.Vector3(0, 1, 0) }, uLightV: { value: new THREE.Vector3(0, 0, 1) },
      uSun: { value: new THREE.Vector3(1, 0.9, 0.7) }, uSky: { value: new THREE.Vector3(0.4, 0.5, 0.7) }, uGnd: { value: new THREE.Vector3(0.2, 0.18, 0.16) },
    }]),
    vertexShader: SMOKE_VS, fragmentShader: smokeFS(LEVEL),
  });
  const pts = new THREE.Mesh(geo, mat); pts.frustumCulled = false; pts.renderOrder = 7; pts.userData.noProbe = true; pts.name = 'tyre-smoke'; scene.add(pts);

  const rate = [0.45, 0.8, 1.2, 1.9][LEVEL], acc = [0, 0, 0, 0], last = Array.from({ length: 4 }, () => ({ has: false, x: 0, y: 0, z: 0 }));
  function spawn(x, y, z, vx, vy, vz, size, grow, alpha, lifeS, hot) {
    if (n >= max) return;
    const i = n++, o = i * 3, k = i * 4;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; V[o] = vx; V[o + 1] = vy; V[o + 2] = vz;
    life[i] = lifeS; s0[i] = size; s1[i] = size * grow; a0[i] = alpha; spin[i] = (Math.random() - 0.5) * 0.9; heat[i] = hot;
    IA[k] = 0; IA[k + 1] = size; IA[k + 2] = alpha; IA[k + 3] = Math.random() * 6.2832;
    IS[k] = Math.random(); IS[k + 1] = ground ? ground.y(x, z) : y - 0.1; IS[k + 2] = 0.6 + Math.random() * 0.9; IS[k + 3] = Math.random();
  }
  function kill(i) {
    const j = --n; if (i === j) return;
    const o = i * 3, p = j * 3, k = i * 4, q = j * 4;
    for (let c = 0; c < 3; c++) { P[o + c] = P[p + c]; V[o + c] = V[p + c]; }
    for (let c = 0; c < 4; c++) { IA[k + c] = IA[q + c]; IS[k + c] = IS[q + c]; }
    life[i] = life[j]; s0[i] = s0[j]; s1[i] = s1[j]; a0[i] = a0[j]; spin[i] = spin[j]; heat[i] = heat[j];
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const _R = new THREE.Vector3(), _U = new THREE.Vector3(), _B = new THREE.Vector3(), _L = new THREE.Vector3();
  return {
    mesh: pts, material: mat,
    /** emit for wheel w: world patch position, patch velocity, intensity 0..1 (spinning = burnout: the tyre flings smoke up and back instead of along the slide) */
    emit(wi, dt, x, y, z, vx, vz, intensity, spinning) {
      const L = last[wi];
      if (intensity < 0.12) { acc[wi] = 0; L.has = false; return; }
      acc[wi] += dt * (5 + 30 * intensity) * rate; let cnt = Math.floor(acc[wi]); acc[wi] -= cnt; cnt = Math.min(cnt, 40);
      const fx = L.has ? L.x : x, fy = L.has ? L.y : y, fz = L.has ? L.z : z;
      for (let k = 0; k < cnt; k++) {
        const t = (k + Math.random()) / cnt, px = fx + (x - fx) * t, py = fy + (y - fy) * t, pz = fz + (z - fz) * t;
        // smoke is shed by the tread: it leaves with a fraction of the patch velocity (the rest is scrubbed off by air drag within a few cm), the burnout case also gets flung up/back by the spinning tyre
        const big = Math.random() < 0.22, kv = spinning ? 0.12 : 0.22, j = big ? 0.7 : 0.45;
        const sz = big ? rnd(0.6, 1.0) : rnd(0.32, 0.55), a = (big ? rnd(0.12, 0.2) : rnd(0.22, 0.38)) * (0.4 + 0.6 * intensity);
        // hot smoke (tyre rubber vapour condensing, ~150 C): starts buoyant, cools by mixing with ambient air in ~1 s (see update)
        spawn(px + rnd(-0.1, 0.1), py + 0.06, pz + rnd(-0.1, 0.1), vx * kv * rnd(0.7, 1.2) + rnd(-j, j), (spinning ? rnd(0.7, 1.6) : rnd(0.3, 0.9)), vz * kv * rnd(0.7, 1.2) + rnd(-j, j),
          sz, big ? rnd(3.2, 4.6) : rnd(2.6, 3.8), a, big ? rnd(4.5, 7.5) : rnd(2.4, 4.2) + intensity, rnd(0.6, 1));
      }
      L.has = true; L.x = x; L.y = y; L.z = z;
    },
    /** env (optional): { camera, vel: car velocity, light: tod.light } */
    update(dt, carPos, day, env = {}) {
      frame++; time += dt;
      const U = mat.uniforms; U.uCar.value.copy(carPos); U.uDay.value = day;
      const cam = env.camera;
      if (cam) {
        const e = cam.matrixWorld.elements; _R.set(e[0], e[1], e[2]); _U.set(e[4], e[5], e[6]); _B.set(e[8], e[9], e[10]);
        U.uCamR.value.copy(_R); U.uCamU.value.copy(_U);
        const li = env.light;
        if (li) {
          _L.copy(li.dir).normalize(); U.uLightV.value.set(_L.dot(_R), _L.dot(_U), _L.dot(_B));
          const k = li.key, h = li.hemi, si = Math.min(1.2, k.intensity / 3.3) * sstepDown(_L.y);
          U.uSun.value.set(k.color.r, k.color.g, k.color.b).multiplyScalar(si);
          U.uSky.value.set(h.color.r, h.color.g, h.color.b).multiplyScalar(h.intensity * 0.8); U.uGnd.value.set(h.groundColor.r, h.groundColor.g, h.groundColor.b).multiplyScalar(h.intensity * 0.8);
        }
      }
      const cvx = env.vel ? env.vel.x : 0, cvz = env.vel ? env.vel.z : 0, cx = carPos.x, cz = carPos.z;
      const wx = 0.35 * Math.sin(time * 0.07), wz = 0.25 * Math.cos(time * 0.05);
      for (let i = 0; i < n;) {
        const a = IA[i * 4] + dt / life[i];
        if (a >= 1) { kill(i); continue; }
        const o = i * 3, k = i * 4, ph = IS[k] * 40;
        // the car drags the air behind it along for a moment (wake), then the cloud decouples and billows on its own
        const dx = P[o] - cx, dz = P[o + 2] - cz, d2 = dx * dx + dz * dz;
        if (d2 < 100) { const w = Math.exp(-d2 / 20) * (1 - a) * dt * 2.6; V[o] += (cvx * 0.42 - V[o]) * w; V[o + 2] += (cvz * 0.42 - V[o + 2]) * w; }
        // turbulence grows as the plume ages: rolling, swirling motion instead of a straight fade
        const tur = (0.2 + 1.5 * a) * dt * 1.7, px = P[o], py = P[o + 1], pz = P[o + 2];
        V[o] += Math.sin(py * 1.7 + time * 1.1 + ph) * Math.cos(pz * 1.2 - time * 0.8) * tur;
        V[o + 1] += Math.sin(px * 1.3 - time * 0.9 + ph * 0.7) * Math.cos(pz * 0.9 + time) * tur * 0.55;
        V[o + 2] += Math.cos(px * 1.5 + time * 0.7 + ph) * Math.sin(py * 1.4 - time * 1.2) * tur;
        // drag against the (slowly drifting) ambient air: big, diffuse puffs have more area per mass so they stop sooner
        const sz = IA[k + 1], damp = Math.exp(-dt * (0.9 + 0.9 * Math.min(1, sz)));
        V[o] = V[o] * damp + (wx - V[o]) * dt * 0.12 * a; V[o + 2] = V[o + 2] * damp + (wz - V[o + 2]) * dt * 0.12 * a;
        // buoyancy: excess temperature (-> density deficit) decays as the plume entrains cold air; vertical motion is also damped by the same drag
        const th = heat[i] *= Math.exp(-dt * 0.9);
        V[o + 1] = V[o + 1] * Math.exp(-dt * 1.3) + 1.8 * th * dt;
        P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
        if (((i + frame) & 7) === 0 && ground) IS[k + 1] = ground.y(P[o], P[o + 2]);
        const gy = IS[k + 1] + 0.05; if (P[o + 1] < gy) { P[o + 1] = gy; if (V[o + 1] < 0) V[o + 1] = 0; }
        const e = Math.sqrt(a) * 0.55 + a * 0.45;
        IA[k] = a; IA[k + 1] = s0[i] + (s1[i] - s0[i]) * e; IA[k + 2] = a0[i] * Math.min(1, s0[i] / IA[k + 1] * 1.6); IA[k + 3] += spin[i] * dt * (1 - 0.6 * a);
        i++;
      }
      geo.instanceCount = n; aPos.needsUpdate = aIA.needsUpdate = aIS.needsUpdate = true;
    },
    setScale() { /* billboards are sized in world units: no screen-space scale needed */ },
    clear() { n = 0; geo.instanceCount = 0; for (const l of last) l.has = false; },
  };
}
const sstepDown = y => 1 - 0.65 * (1 - sstep(-0.2, 0.05, y));        // light below the horizon: the key light fades out

// ------------------------------------------------------------------------------------------------ sparks
export function createSparks({ scene, max = 360 }) {
  const P = new Float32Array(max * 3), V = new Float32Array(max * 3), AP = new Float32Array(max * 2), age = new Float32Array(max), life = new Float32Array(max); let next = 0;
  for (let i = 0; i < max; i++) P[i * 3 + 1] = -1000;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aP', new THREE.BufferAttribute(AP, 2).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uScale: { value: 600 } },
    vertexShader: `attribute vec2 aP; uniform float uScale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(0.07 * uScale / max(-mv.z, 0.5), 1.0, 14.0); vA = aP.x; }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; float a = (1.0 - r) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(5.0, 2.1, 0.55) * a, a); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 8; scene.add(pts);
  return {
    burst(x, y, z, vx, vy, vz, n = 6) {
      for (let k = 0; k < n; k++) { const i = next; next = (next + 1) % max; age[i] = 0; life[i] = 0.25 + Math.random() * 0.5; P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; V[i * 3] = vx * 0.5 + (Math.random() - 0.5) * 5; V[i * 3 + 1] = vy * 0.3 + Math.random() * 3.2; V[i * 3 + 2] = vz * 0.5 + (Math.random() - 0.5) * 5; AP[i * 2] = 1; }
    },
    update(dt, ground) {
      for (let i = 0; i < max; i++) {
        if (AP[i * 2] <= 0) continue; age[i] += dt; if (age[i] >= life[i]) { AP[i * 2] = 0; P[i * 3 + 1] = -1000; continue; }
        const o = i * 3; V[o + 1] -= 9.81 * dt; P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
        const gy = ground.y(P[o], P[o + 2]) + 0.03; if (P[o + 1] < gy) { P[o + 1] = gy; V[o + 1] *= -0.35; V[o] *= 0.6; V[o + 2] *= 0.6; }
        AP[i * 2] = 1 - age[i] / life[i];
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.aP.needsUpdate = true;
    },
    setScale(h) { mat.uniforms.uScale.value = h * 0.62; },
  };
}
