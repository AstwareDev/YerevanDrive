// Drift visual effects: persistent rubber skid marks (ring buffer of ribbon quads draped on the road), tyre smoke (soft sprite particles lit
// by the car at night), and sparks (additive, bloom-friendly) from scrapes / impacts.
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------ skid marks
export function createSkids({ scene, ground, max = 8000 }) {
  const pos = new Float32Array(max * 4 * 3), col = new Float32Array(max * 4 * 4), idx = new Uint32Array(max * 6);
  for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; scene.add(mesh);
  let head = 0, count = 0, dirty = false;
  const pen = Array.from({ length: 4 }, () => ({ on: false, x: 0, z: 0, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0 }));
  const HALF = 0.15;
  function write(i, a, b, c, d, alpha) {
    const o = i * 12; pos.set(a, o); pos.set(b, o + 3); pos.set(c, o + 6); pos.set(d, o + 9);
    const k = i * 16; for (let n = 0; n < 4; n++) { col[k + n * 4] = 0.015; col[k + n * 4 + 1] = 0.013; col[k + n * 4 + 2] = 0.012; col[k + n * 4 + 3] = alpha; }
    // soften the leading / trailing edge a little so segments with different intensity blend
  }
  return {
    mesh,
    /** register a wheel's patch this frame. intensity 0..1, surf = ground surface id (marks only on hard surfaces) */
    feed(w, x, z, intensity, surf) {
      const p = pen[w]; const hard = surf !== 0 && surf !== 4;
      if (intensity < 0.06 || !hard) { p.on = false; return; }
      if (!p.on) { p.on = true; p.x = x; p.z = z; p.has = false; return; }
      const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz);
      if (l < 0.22) return;
      if (l > 3) { p.on = true; p.x = x; p.z = z; p.has = false; return; }
      const nx = -dz / l * HALF, nz = dx / l * HALF, y0 = ground.y(p.x, p.z) + 0.13, y1 = ground.y(x, z) + 0.13;
      const L = [x + nx, y1, z + nz], Rr = [x - nx, y1, z - nz];
      const A = p.has ? [p.lx, p.ly, p.lz] : [p.x + nx, y0, p.z + nz], B = p.has ? [p.rx, p.ry, p.rz] : [p.x - nx, y0, p.z - nz];
      write(head, A, B, Rr, L, Math.min(0.62, intensity * 0.7));
      p.lx = L[0]; p.ly = L[1]; p.lz = L[2]; p.rx = Rr[0]; p.ry = Rr[1]; p.rz = Rr[2]; p.has = true; p.x = x; p.z = z;
      head = (head + 1) % max; count = Math.min(max, count + 1); dirty = true;
    },
    update() { if (!dirty) return; dirty = false; geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.setDrawRange(0, count * 6); },
    clear() { head = 0; count = 0; geo.setDrawRange(0, 0); for (const p of pen) p.on = false; },
  };
}

// ------------------------------------------------------------------------------------------------ smoke
function cloudTexture() {
  const S = 96, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.8) * S * 0.28, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, rad = S * (0.10 + rnd() * 0.17);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  // overall round falloff
  const im = g.getImageData(0, 0, S, S), d = im.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const dx = (i + 0.5) / S - 0.5, dy = (j + 0.5) / S - 0.5, r = Math.hypot(dx, dy) * 2, f = Math.max(0, 1 - r); const k = (j * S + i) * 4; d[k + 3] = Math.min(255, d[k + 3] * 2.2 * f * f * (3 - 2 * f)); d[k] = d[k + 1] = d[k + 2] = 255; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export function createSmoke({ scene, max = 1400 }) {
  const P = new Float32Array(max * 3), V = new Float32Array(max * 3), AP = new Float32Array(max * 4), age = new Float32Array(max), life = new Float32Array(max), s0 = new Float32Array(max), s1 = new Float32Array(max), a0 = new Float32Array(max);
  const alive = new Uint8Array(max); let next = 0;
  for (let i = 0; i < max; i++) P[i * 3 + 1] = -1000;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aP', new THREE.BufferAttribute(AP, 4).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: cloudTexture() }, uScale: { value: 600 }, uDay: { value: 0 }, uCar: { value: new THREE.Vector3() }, uCarLight: { value: new THREE.Vector3(1.0, 0.82, 0.62) } }]),
    vertexShader: /* glsl */`
      attribute vec4 aP; uniform float uScale; uniform vec3 uCar; varying vec4 vP; varying float vD;
      #include <fog_pars_vertex>
      void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; gl_PointSize = clamp(aP.y * uScale / max(-mvPosition.z, 0.5), 0.0, 420.0); vP = aP; vD = length(position - uCar);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; uniform float uDay; uniform vec3 uCarLight; varying vec4 vP; varying float vD;
      #include <fog_pars_fragment>
      void main(){
        float a = vP.w * 6.2831; vec2 c = gl_PointCoord - 0.5; c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c + 0.5;
        float t = texture2D(uTex, c).a; float age = vP.x;
        float alpha = t * vP.z * (1.0 - age) * smoothstep(0.0, 0.06, age);
        if (alpha < 0.004) discard;
        vec3 col = mix(vec3(0.20, 0.21, 0.25), vec3(0.80, 0.80, 0.82), uDay) + uCarLight * exp(-vD / 5.5) * 0.55 * (1.0 - uDay * 0.6);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 7; scene.add(pts);
  let acc = [0, 0, 0, 0];
  function spawn(x, y, z, vx, vy, vz, size, alpha, lifeS) {
    const i = next; next = (next + 1) % max; alive[i] = 1; age[i] = 0; life[i] = lifeS; s0[i] = size; s1[i] = size * (2.6 + Math.random() * 1.2); a0[i] = alpha;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz; AP[i * 4 + 3] = Math.random();
  }
  return {
    mesh: pts, material: mat,
    /** emit for wheel w: world patch position, patch velocity, intensity 0..1 */
    emit(wi, dt, x, y, z, vx, vz, intensity, spinning) {
      if (intensity < 0.05) { acc[wi] = 0; return; }
      acc[wi] += dt * (18 + 70 * intensity); let guard = 0;
      while (acc[wi] >= 1 && guard++ < 12) {
        acc[wi] -= 1; const j = 0.9;
        spawn(x + (Math.random() - 0.5) * 0.25, y + 0.1, z + (Math.random() - 0.5) * 0.25, vx * (spinning ? 0.35 : 0.55) + (Math.random() - 0.5) * j, 0.5 + Math.random() * 0.9, vz * (spinning ? 0.35 : 0.55) + (Math.random() - 0.5) * j,
          0.42 + Math.random() * 0.3, (0.16 + 0.26 * intensity) * (0.7 + Math.random() * 0.5), 1.3 + Math.random() * 1.4 + intensity);
      }
    },
    update(dt, carPos, day) {
      mat.uniforms.uCar.value.copy(carPos); mat.uniforms.uDay.value = day;
      const damp = Math.exp(-dt * 1.1);
      for (let i = 0; i < max; i++) {
        if (!alive[i]) continue;
        age[i] += dt / life[i]; if (age[i] >= 1) { alive[i] = 0; P[i * 3 + 1] = -1000; AP[i * 4 + 2] = 0; continue; }
        const o = i * 3; V[o] *= damp; V[o + 1] = V[o + 1] * damp + 0.25 * dt; V[o + 2] *= damp;
        P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
        const a = age[i], e = 1 - Math.pow(1 - a, 2);
        AP[i * 4] = a; AP[i * 4 + 1] = s0[i] + (s1[i] - s0[i]) * e; AP[i * 4 + 2] = a0[i];
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.aP.needsUpdate = true;
    },
    setScale(h) { mat.uniforms.uScale.value = h * 0.62; },
    clear() { alive.fill(0); for (let i = 0; i < max; i++) { P[i * 3 + 1] = -1000; AP[i * 4 + 2] = 0; } },
  };
}

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
