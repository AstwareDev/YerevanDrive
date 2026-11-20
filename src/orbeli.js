// Hand-modelled stretch of Orbeli Brothers Street, matched to Street View reference photos:
//   * the 104 m block at no. 6 (OSM: one 10-storey box) = red-brown Soviet apartment blocks + the glass-fronted BISA building set back behind an iron fence
//   * stone fence posts with diamond iron panels, flags at the entrance
//   * concrete utility poles with overhead wires along the street
// Data: public/map/orbeli.json (tools/build-orbeli.mjs). The generic OSM box is suppressed via data/landmark-skip.json (tools/build-landmarks.mjs, id 82662788).
// Contract: default export async ctx => ({ update(dt, camera, time) })
const FLOOR_B = 3.1, FLOOR_G = 3.7, BAY_B = 3.3, BAY_G = 4;
const hash = (a, b = 0) => { let x = Math.imul((a * 374761393 + b * 668265263) | 0, 1274126177); x = Math.imul(x ^ (x >>> 13), 1103515245); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export default async function (ctx) {
  const { THREE, scene, H, tod } = ctx;
  const data = await (await fetch('/map/orbeli.json')).json();
  const { B, u, n, len, depth } = data.strip;
  const root = new THREE.Group(); root.name = 'orbeli'; scene.add(root);
  const P = (s, d) => [B[0] + u[0] * s - n[0] * d, B[1] + u[1] * s - n[1] * d];       // frontage coordinates: s along the street, d into the block
  const theta = Math.atan2(n[0], n[1]);
  const emis = [];                                                                       // materials whose emissive follows the night factor

  // ------------------------------------------------------------------ textures
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const tex = (c, repeat = [1, 1], srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const speckle = (g, w, h, base, amp, n0, seed) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n0; i++) { const v = (hash(i, seed) - 0.5) * amp; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 235 : 0},${v > 0 ? 220 : 0},${Math.abs(v) / 255})`; g.fillRect(hash(i, seed + 1) * w, hash(i, seed + 2) * h, 1 + hash(i, seed + 3) * 3, 1 + hash(i, seed + 4) * 2); } };

  /** Soviet apartment block facade: 4 bays x 2 floors per tile (13.2 m x 6.2 m). */
  function sovietFacade({ base, frame, seed, brick }) {
    const W = 512, Hh = 256, c = cv(W, Hh), g = c.getContext('2d'), e = cv(W, Hh), ge = e.getContext('2d');
    speckle(g, W, Hh, base, 70, 3500, seed); ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh);
    if (brick) { g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 1; for (let y = 0; y < Hh; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
      const x0 = k * 128, y0 = r * 128, wx = x0 + 34, wy = y0 + 26, ww = 60, wh = 74, h = hash(r * 4 + k, seed);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(wx - 6, wy - 6, ww + 12, 6);                 // lintel shadow
      g.fillStyle = frame; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, '#2b3947'); gr.addColorStop(1, '#141b24'); g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = frame; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.38, ww, 3);                // mullion + transom
      g.fillStyle = 'rgba(235,225,205,.85)'; g.fillRect(wx - 6, wy + wh + 3, ww + 12, 5);                                  // sill
      if (h < 0.3) { g.fillStyle = 'rgba(30,26,24,.75)'; g.fillRect(x0 + 14, y0 + 104, 100, 4); g.fillStyle = 'rgba(25,22,20,.55)'; g.fillRect(x0 + 14, y0 + 108, 100, 16); }   // balcony slab + railing
      else if (h < 0.5) { g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(wx + 4, wy + 4, ww - 8, wh * 0.3); }           // curtain / reflection
      if (hash(r * 4 + k, seed + 9) < 0.34) { ge.fillStyle = h < 0.5 ? '#ffd28a' : '#cfe4ff'; ge.globalAlpha = 0.55 + hash(k, r + seed) * 0.4; ge.fillRect(wx, wy, ww, wh); ge.globalAlpha = 1; }
    }
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 127, W, 2);                                                     // floor line
    return { map: c, emi: e };
  }
  /** BISA curtain-wall facade: the whole front, 4 bays (16 m) x 5 floors (18.5 m); ground floor = shop-front glass with a central entrance. */
  function glassFacade() {
    const bw = 128, bh = 128, W = bw * 4, Hh = bh * 5, c = cv(W, Hh), g = c.getContext('2d'), e = cv(W, Hh), ge = e.getContext('2d');
    g.fillStyle = '#7d928c'; g.fillRect(0, 0, W, Hh); ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh);
    for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) {
      const x0 = k * bw, y0 = r * bh, ground = r === 4, glassH = ground ? bh - 14 : bh - 36;
      const gr = g.createLinearGradient(0, y0, 0, y0 + glassH); gr.addColorStop(0, '#5fa598'); gr.addColorStop(0.55, '#2f7569'); gr.addColorStop(1, '#194c47');
      g.fillStyle = gr; g.fillRect(x0 + 3, y0 + (ground ? 10 : 4), bw - 6, glassH - 4);
      g.fillStyle = 'rgba(255,255,255,.13)'; g.beginPath(); g.moveTo(x0 + 10, y0 + 6); g.lineTo(x0 + 52, y0 + 6); g.lineTo(x0 + 14, y0 + glassH); g.lineTo(x0 + 4, y0 + glassH); g.closePath(); g.fill();        // sky reflection streak
      g.fillStyle = '#1b2224'; g.fillRect(x0, y0, 4, bh); g.fillRect(x0 + bw - 3, y0, 3, bh); g.fillRect(x0 + bw / 2 - 1, y0 + 4, 2, glassH - 4);                                                  // mullions
      if (!ground) { g.fillStyle = '#8fa39d'; g.fillRect(x0, y0 + bh - 32, bw, 28); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x0, y0 + bh - 5, bw, 2); }                                            // spandrel panel
      else if (k === 1 || k === 2) { g.fillStyle = '#10161a'; g.fillRect(x0 + (k === 1 ? bw / 2 : 4), y0 + 22, bw / 2 - 4, bh - 22); g.fillStyle = '#c9d2d0'; g.fillRect(x0 + (k === 1 ? bw / 2 : 4), y0 + 22, 3, bh - 22); ge.fillStyle = '#ffd9a0'; ge.globalAlpha = 0.8; ge.fillRect(x0 + (k === 1 ? bw / 2 + 4 : 8), y0 + 26, bw / 2 - 14, bh - 28); ge.globalAlpha = 1; }
      if (!ground && hash(r * 4 + k, 77) < 0.42) { ge.fillStyle = hash(k, r) < 0.5 ? '#ffe2b0' : '#d6ecff'; ge.globalAlpha = 0.5; ge.fillRect(x0 + 6, y0 + 6, bw - 12, glassH - 12); ge.globalAlpha = 1; }
    }
    g.fillStyle = '#1b2224'; g.fillRect(0, 0, W, 5);          // top edge
    return { map: c, emi: e };
  }
  const plain = (base, seed) => sovietFacade({ base, frame: '#d8d2c6', seed, brick: false });

  const mat = (t, rep, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: tex(t.map, rep), roughness: o.rough ?? 0.88, metalness: o.metal ?? 0, emissive: 0xffffff, emissiveMap: tex(t.emi, rep), emissiveIntensity: 0, envMapIntensity: o.env ?? 0.5 });
    emis.push({ m, k: o.glow ?? 0.9 }); return m;
  };
  const flat = (hex, rough = 0.9, metal = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });

  // ------------------------------------------------------------------ building volumes
  const cornerH = (s0, s1, d0, d1) => { let lo = 1e9, hi = -1e9; for (const s of [s0, s1]) for (const d of [d0, d1]) { const p = P(s, d), y = H(p[0], p[1]); lo = Math.min(lo, y); hi = Math.max(hi, y); } return [lo, hi]; };
  const sovietA = sovietFacade({ base: '#a65a40', frame: '#e7e1d3', seed: 11, brick: true }), sovietB = sovietFacade({ base: '#b46a4a', frame: '#e7e1d3', seed: 23, brick: true }), glassT = glassFacade(), plainT = plain('#cfc9bd', 5);
  const stone = flat(0x56504a, 0.95), roofM = flat(0x2c2d31, 0.95), corniceM = flat(0xc9bfae, 0.9), steel = flat(0x3a3f44, 0.6, 0.6);
  function volume({ s0, s1, d0, d1, floors, floorH, front, side, back, name, cornice = true }) {
    const [lo, hi] = cornerH(s0, s1, d0, d1), w = s1 - s0, dp = d1 - d0, y0 = hi + 0.45, h = floors * floorH;
    const cs = (s0 + s1) / 2, cd = (d0 + d1) / 2, c = P(cs, cd);
    // plinth (covers the slope under the building)
    const pl = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, y0 - lo + 0.5, dp + 0.06), stone); pl.position.set(c[0], (y0 + lo - 0.5) / 2, c[1]); pl.rotation.y = theta; pl.receiveShadow = true; root.add(pl);
    const mats = [side(dp), side(dp), roofM, stone, front(w, h), back(w, h)];                 // +x, -x, roof, floor, +z (road side), -z
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mats); b.position.set(c[0], y0 + h / 2, c[1]); b.rotation.y = theta; b.castShadow = b.receiveShadow = true; b.name = name; root.add(b);
    if (cornice) { const co = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.5, dp + 0.5), corniceM); co.position.set(c[0], y0 + h + 0.25, c[1]); co.rotation.y = theta; co.castShadow = true; root.add(co); }
    return { y0, h, c };
  }
  const brickFront = (t, floorH) => (w, h) => mat(t, [w / (BAY_B * 4), h / (floorH * 2)]);
  const brickSide = t => dp => mat(t, [dp / (BAY_B * 4), 3]);
  const SB = 42.5, SE = 58.5, SETBACK = 3.5;                    // BISA occupies s = 42.5 .. 58.5, set back 3.5 m behind the fence line
  // left block (west), 6 floors; right block (east), 6 floors
  volume({ s0: 0, s1: SB, d0: 0, d1: depth, floors: 6, floorH: FLOOR_B, name: 'orbeli-west', front: brickFront(sovietA, FLOOR_B), back: brickFront(sovietA, FLOOR_B), side: brickSide(sovietA) });
  volume({ s0: SE, s1: len, d0: 0, d1: depth, floors: 6, floorH: FLOOR_B, name: 'orbeli-east', front: brickFront(sovietB, FLOOR_B), back: brickFront(sovietB, FLOOR_B), side: brickSide(sovietB) });
  // BISA: 5 floors of curtain wall, flat roof with a small plant room
  const bisa = volume({ s0: SB, s1: SE, d0: SETBACK, d1: depth, floors: 5, floorH: FLOOR_G, name: 'bisa', cornice: false,
    front: () => mat(glassT, [1, 1], { rough: 0.25, metal: 0.35, env: 1.4, glow: 1.0 }), back: () => mat(plainT, [4, 3]), side: dp => mat(plainT, [dp / 13.2, 5 * FLOOR_G / 6.2]) });
  { const pr = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 6), steel); const c = P((SB + SE) / 2, depth * 0.55); pr.position.set(c[0], bisa.y0 + bisa.h + 1.2, c[1]); pr.rotation.y = theta; root.add(pr); }
  // entrance canopy
  { const cn = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.25, 2.6), steel); const c = P((SB + SE) / 2, SETBACK - 1.1), [, hi] = cornerH(SB, SE, SETBACK, SETBACK + 1); cn.position.set(c[0], hi + 0.45 + 3.7, c[1]); cn.rotation.y = theta; root.add(cn); }

  // ------------------------------------------------------------------ fence along the frontage (stone posts + diamond iron panels), flags
  {
    const fc = cv(256, 128), g = fc.getContext('2d'); g.clearRect(0, 0, 256, 128);
    g.fillStyle = '#6d675f'; g.fillRect(0, 96, 256, 32);                        // low stone plinth
    g.strokeStyle = '#17191c'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 8); g.lineTo(256, 8); g.moveTo(0, 90); g.lineTo(256, 90); g.stroke();
    g.lineWidth = 3; for (let x = 8; x < 256; x += 16) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, 92); g.stroke(); }
    g.lineWidth = 3; for (let x = 0; x < 256; x += 64) { g.beginPath(); g.moveTo(x + 32, 24); g.lineTo(x + 52, 49); g.lineTo(x + 32, 74); g.lineTo(x + 12, 49); g.closePath(); g.stroke(); }   // diamonds
    const ft = tex(fc); const fm = new THREE.MeshStandardMaterial({ map: ft, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.3 });
    const postM = flat(0xb9b3a6, 0.95); const S0 = 40, S1 = 61, step = 3.5, D = 0.35;
    const posts = Math.round((S1 - S0) / step); const post = new THREE.BoxGeometry(0.55, 2.1, 0.55);
    for (let i = 0; i <= posts; i++) {
      const s = S0 + (S1 - S0) * i / posts, p = P(s, D), y = H(p[0], p[1]); const m = new THREE.Mesh(post, postM); m.position.set(p[0], y + 1.0, p[1]); m.rotation.y = theta; m.castShadow = true; root.add(m);
      if (i < posts) { const s2 = S0 + (S1 - S0) * (i + 1) / posts, sm = (s + s2) / 2, q = P(sm, D), pa = P(s, D), pb = P(s2, D); if (Math.abs(sm - (SB + SE) / 2) < 1.6) continue;          // gap = entrance gate
        const pw = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) - 0.55; const pm = new THREE.Mesh(new THREE.PlaneGeometry(pw, 1.75), fm.clone()); pm.material.map = ft.clone(); pm.material.map.needsUpdate = true; pm.material.map.repeat.set(pw / 3.5, 1); pm.position.set(q[0], H(q[0], q[1]) + 0.9, q[1]); pm.rotation.y = theta; root.add(pm); }
    }
    // flags at the entrance (Armenian tricolour + white/blue)
    const flagTex = (cols) => { const c = cv(96, 64), g2 = c.getContext('2d'); cols.forEach((col, i) => { g2.fillStyle = col; g2.fillRect(0, i * 64 / cols.length, 96, 64 / cols.length + 1); }); return tex(c); };
    for (const [s, cols] of [[SB + 4, ['#d90012', '#0033a0', '#f2a800']], [SE - 4, ['#f2f2f2', '#0033a0', '#f2f2f2']]]) {
      const p = P(s, SETBACK - 1.2), y = H(p[0], p[1]); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6.2, 8), steel); pole.position.set(p[0], y + 3.1, p[1]); root.add(pole);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex(cols), side: THREE.DoubleSide, roughness: 0.9 })); f.position.set(p[0] + u[0] * 0.9, y + 5.5, p[1] + u[1] * 0.9); f.rotation.y = theta; root.add(f);
    }
  }

  // ------------------------------------------------------------------ poles + overhead wires
  const poleSpots = [];
  for (const rd of data.roads) {
    let acc = 0, side = 1;
    for (let i = 2; i < rd.length; i += 2) {
      const ax = rd[i - 2], az = rd[i - 1], bx = rd[i], bz = rd[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue; const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let s = (38 - acc % 38) % 38 || 0; s < L; s += 38) { const off = 11.6 * side; side = -side; const x = ax + ux * s - uz * off, z = az + uz * s + ux * off; poleSpots.push({ x, z, y: H(x, z), side: Math.sign(off), ux, uz, road: rd }); }
      acc += L;
    }
  }
  if (poleSpots.length) {
    const poleM = flat(0x8d8c86, 0.95), arm = flat(0x55524e, 0.8);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.17, 9.6, 8).translate(0, 4.8, 0), poleM, poleSpots.length), arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), arm, poleSpots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    poleSpots.forEach((p, i) => { q.setFromAxisAngle(up, Math.atan2(p.ux, p.uz)); m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, sc); poles.setMatrixAt(i, m4); m4.compose(new THREE.Vector3(p.x, p.y + 8.7, p.z), q, sc); arms.setMatrixAt(i, m4); });
    poles.castShadow = true; root.add(poles, arms);
    // wires: 3 along each side between consecutive poles on the same side, 2 cross-street spans to the nearest opposite pole
    const seg = [], sag = (a, b, drop, k = 10) => { for (let i = 0; i < k; i++) { const t0 = i / k, t1 = (i + 1) / k, f = t => 4 * t * (1 - t); seg.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 - drop * f(t0), a[2] + (b[2] - a[2]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 - drop * f(t1), a[2] + (b[2] - a[2]) * t1); } };
    const perp = p => [p.uz, -p.ux];
    for (const sd of [-1, 1]) {
      const list = poleSpots.filter(p => p.side === sd);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i]; if (Math.hypot(a.x - b.x, a.z - b.z) > 60 || a.road !== b.road) continue; const pa = perp(a), pb = perp(b);
        for (const off of [-1, 0, 1]) sag([a.x + pa[0] * off, a.y + 8.7, a.z + pa[1] * off], [b.x + pb[0] * off, b.y + 8.7, b.z + pb[1] * off], 0.35);
      }
    }
    for (const a of poleSpots) {
      let best = null, bd = 40; for (const b of poleSpots) { if (b.side === a.side) continue; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = b; } }
      if (best && a.side > 0) for (const h of [8.5, 7.7]) sag([a.x, a.y + h, a.z], [best.x, best.y + h, best.z], 0.7);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1a1a1c, transparent: true, opacity: 0.85 })); wires.frustumCulled = false; root.add(wires);
  }

  console.log(`[orbeli] ${root.children.length} objects, ${poleSpots.length} poles`);
  window.__orbeli = { root, data };
  return {
    update(dt, camera, time) {
      const n = tod?.night ?? 1; for (const e of emis) e.m.emissiveIntensity = e.k * n;
    },
  };
}
