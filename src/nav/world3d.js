// 3D side of the navigator: glowing route ribbon draped on the road ahead of the car, and light-beam beacons for the selected place / destination.
const STEP = 4, WIN = 170, BACK = 3;           // resample step (m), ribbon window (points), points kept behind the car

export function createWorld3D({ THREE, scene, groundY }) {
  // ------------------------------------------------------------------ ribbon
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = 'rgba(30,140,255,.26)'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = 'rgba(215,245,255,.92)';
  g.beginPath(); g.moveTo(10, 96); g.lineTo(32, 66); g.lineTo(54, 96); g.lineTo(54, 110); g.lineTo(32, 82); g.lineTo(10, 110); g.closePath(); g.fill();   // chevron (points towards +v = travel direction)
  g.fillStyle = 'rgba(150,220,255,.85)'; g.fillRect(0, 0, 4, 128); g.fillRect(60, 0, 4, 128);
  const tex = new THREE.CanvasTexture(cv); tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(WIN * 2 * 3), uv = new Float32Array(WIN * 2 * 2), col = new Float32Array(WIN * 2 * 4), idx = new Uint16Array((WIN - 1) * 6);
  for (let i = 0; i < WIN - 1; i++) { const a = i * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const ribbon = new THREE.Mesh(geo, mat); ribbon.frustumCulled = false; ribbon.renderOrder = 7; ribbon.visible = false; scene.add(ribbon);
  let RX = [], RZ = [], RY = [], count = 0;

  function setRoute(route) {
    RX = []; RZ = []; RY = []; if (!route) { ribbon.visible = false; count = 0; return; }
    const { pts, cum } = route, np = pts.length / 2; let i = 1;
    for (let s = 0; s <= cum[np - 1]; s += STEP) {
      while (i < np - 1 && cum[i] < s) i++; const k = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const x = pts[i * 2 - 2] + (pts[i * 2] - pts[i * 2 - 2]) * k, z = pts[i * 2 - 1] + (pts[i * 2 + 1] - pts[i * 2 - 1]) * k;
      RX.push(x); RZ.push(z); RY.push(groundY(x, z));
    }
    count = RX.length; ribbon.visible = count > 1;
  }
  let scroll = 0;
  /** s = distance driven along the route (m) */
  function updateRibbon(s, dt) {
    if (count < 2) return;
    const i0 = Math.max(0, Math.floor(s / STEP) - BACK), n = Math.min(WIN, count - i0); if (n < 2) { geo.setDrawRange(0, 0); return; }
    const hw = 1.15;
    for (let k = 0; k < n; k++) {
      const i = i0 + k, j0 = Math.max(0, i - 1), j1 = Math.min(count - 1, i + 1);
      let dx = RX[j1] - RX[j0], dz = RZ[j1] - RZ[j0]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz * hw, nz = dx * hw, y = RY[i] + 0.2;
      pos[k * 6] = RX[i] + nx; pos[k * 6 + 1] = y; pos[k * 6 + 2] = RZ[i] + nz; pos[k * 6 + 3] = RX[i] - nx; pos[k * 6 + 4] = y; pos[k * 6 + 5] = RZ[i] - nz;
      const v = i * STEP / 5 + scroll; uv[k * 4] = 0; uv[k * 4 + 1] = v; uv[k * 4 + 2] = 1; uv[k * 4 + 3] = v;
      const fadeNear = Math.min(1, (i * STEP - s + 6) / 10), fadeFar = Math.min(1, (n - 1 - k) / 14), a = Math.max(0, Math.min(fadeNear, fadeFar));
      for (let q = 0; q < 2; q++) { const o = (k * 2 + q) * 4; col[o] = 1; col[o + 1] = 1; col[o + 2] = 1; col[o + 3] = a; }
    }
    geo.attributes.position.needsUpdate = geo.attributes.uv.needsUpdate = geo.attributes.color.needsUpdate = true; geo.setDrawRange(0, (n - 1) * 6);
  }

  // ------------------------------------------------------------------ beacons
  const gc = document.createElement('canvas'); gc.width = 4; gc.height = 128; const gg = gc.getContext('2d'); const gr = gg.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.15, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); gg.fillStyle = gr; gg.fillRect(0, 0, 4, 128);
  const gtex = new THREE.CanvasTexture(gc);
  function beacon(color) {
    const grp = new THREE.Group(); grp.visible = false;
    const bm = new THREE.MeshBasicMaterial({ map: gtex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 220, 20, 1, true).translate(0, 110, 0), bm); beam.renderOrder = 8; beam.frustumCulled = false;
    const rm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.8, 48).rotateX(-Math.PI / 2), rm); ring.position.y = 0.3; ring.renderOrder = 8;
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 48).rotateX(-Math.PI / 2), rm); ring2.position.y = 0.32; ring2.renderOrder = 8;
    const pm = new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false });
    const pin = new THREE.Group(); const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.2, 20).rotateX(Math.PI), pm); cone.position.y = 2.1; const ball = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), pm); ball.position.y = 5.4; pin.add(cone, ball); pin.position.y = 14;
    grp.add(beam, ring, ring2, pin); scene.add(grp);
    return {
      group: grp, set(x, z) { grp.position.set(x, groundY(x, z), z); grp.visible = true; }, hide() { grp.visible = false; }, get visible() { return grp.visible; },
      update(camera, t) {
        if (!grp.visible) return; const d = camera.position.distanceTo(grp.position);
        const r = Math.min(14, Math.max(0.55, d * 0.0045)); beam.scale.set(r, 1, r);
        const k = Math.min(10, Math.max(1, d / 160)); pin.scale.setScalar(k); pin.position.y = 12 * k + Math.sin(t * 2.4) * 0.6 * k; pin.rotation.y = t * 1.2; ring.scale.setScalar(1 + 0.12 * Math.sin(t * 3)); ring2.scale.setScalar(1 + (t * 0.9 % 1) * 2.4);
        rm.opacity = 0.9;
      },
    };
  }
  return {
    ribbon, setRoute, updateRibbon: (s, dt) => { scroll -= dt * 0.0; updateRibbon(s, dt); },
    pin: beacon(0xff4d6d), dest: beacon(0x2fe08a),
  };
}
