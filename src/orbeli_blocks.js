// Detailed apartment blocks for Orbeli Brothers St: OSM footprints (public/map/orbeli.json "blocks") extruded with
//   * tuff-stone ashlar / concrete-panel facades (canvas-painted: recessed windows, stone surrounds, sills, curtains, glazed loggias, AC units)
//   * shop-front ground floors on the street side, blind gable walls with stair windows, courtyard-side ground floors
//   * real 3D balconies (instanced slabs + railings), stepped cornice, parapet, roof plant boxes
// Facade cell contents are derived from hash(seed, bay, floor) so the painted tile and the 3D balconies always agree.
const BAY = 3.3, FL = 3.1, GF = 4.2, TB = 4, TF = 3;                // bay width, floor height, ground-floor height, tile = 4 bays x 3 floors
const TW = BAY * TB, TH = FL * TF, PXM = 80;                         // px per metre in the logical canvas
export const hash = (a, b = 0, c = 0) => { let x = Math.imul((a * 374761393 + b * 668265263 + c * 2147483647) | 0, 1274126177); x = Math.imul(x ^ (x >>> 13), 1103515245); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

// palette: base = wall colour, trim = stone surrounds / sills, frame = window frames, panel = prefab concrete instead of ashlar
const PALETTES = [
  { name: 'red tuff',  base: [166, 92, 70],  trim: '#d9ccb4', frame: '#e8e2d4' },
  { name: 'pink tuff', base: [190, 132, 108], trim: '#e3d6bf', frame: '#f0ebe0' },
  { name: 'cream',     base: [214, 178, 138], trim: '#efe5cf', frame: '#7a5a44' },
  { name: 'grey panel', base: [168, 160, 150], trim: '#cfcac0', frame: '#f1efe9', panel: true },
  { name: 'orange old', base: [196, 98, 52], trim: '#d8c4a0', frame: '#f4efe6', old: true },
];
export const cellType = (seed, k, r) => { const h = hash(seed, k + 1, r + 7); return h < 0.27 ? 'balc' : h < 0.36 ? 'loggia' : 'win'; };

export function makeBlockKit(THREE, { scale = 1, emis, tex }) {
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale); const g = c.getContext('2d'); g.scale(scale, scale); return [c, g]; };
  const rgb = (b, k) => `rgb(${Math.min(255, b[0] * k) | 0},${Math.min(255, b[1] * k) | 0},${Math.min(255, b[2] * k) | 0})`;

  function wall(g, W, Hh, pal, seed, bump, gb) {
    const b = pal.base;
    if (pal.panel) {                                                        // prefab concrete: big panels, dark joints, rain streaks
      g.fillStyle = rgb(b, 0.55); g.fillRect(0, 0, W, Hh);
      const pw = BAY * PXM, ph = FL * PXM;
      for (let y = 0; y < Hh; y += ph) for (let x = 0; x < W; x += pw) { g.fillStyle = rgb(b, 0.93 + hash(seed, x, y) * 0.14); g.fillRect(x + 2, y + 2, pw - 4, ph - 4); }
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(40,36,30,${0.03 + hash(i, seed) * 0.05})`; g.fillRect(hash(i, seed, 1) * W, hash(i, seed, 2) * Hh, 2 + hash(i, seed, 3) * 3, 40 + hash(i, seed, 4) * 120); }
      gb.fillStyle = '#7a7a7a'; gb.fillRect(0, 0, W, Hh); gb.fillStyle = '#3a3a3a'; for (let y = 0; y < Hh; y += ph) gb.fillRect(0, y, W, 3); for (let x = 0; x < W; x += pw) gb.fillRect(x, 0, 3, Hh); return;
    }
    const rh = pal.old ? 31 : 37.2, rw = pal.old ? 66 : 66;
    g.fillStyle = rgb(b, 0.62); g.fillRect(0, 0, W, Hh); gb.fillStyle = '#5a5a5a'; gb.fillRect(0, 0, W, Hh);       // mortar
    for (let r = 0, y = 0; y < Hh - 1; r++, y += rh) for (let x = (r % 2 ? -rw / 2 : 0); x < W; x += rw) {
      const j = 0.82 + hash(seed, Math.round(x), r) * 0.3, tint = hash(seed + 5, Math.round(x), r) < 0.12 ? 0.72 : 1;     // the odd darker (basalt) block
      g.fillStyle = rgb(b, j * tint); g.fillRect(x + 1, y + 1, rw - 2, rh - 2);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 1, y + 1, rw - 2, 2);
      gb.fillStyle = `rgb(${150 + hash(seed, r, Math.round(x)) * 40 | 0},0,0)`; gb.fillStyle = '#9a9a9a'; gb.fillRect(x + 1, y + 1, rw - 2, rh - 2);
    }
    for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(20,16,12,${0.025 + hash(i, seed, 9) * 0.05})`; g.fillRect(hash(i, seed, 1) * W, hash(i, seed, 2) * Hh, 2 + hash(i, seed, 3) * 4, 30 + hash(i, seed, 4) * 110); }
  }

  function window_(g, gb, ge, pal, x, y, w, h, lit, curtain) {
    const t = pal.trim; g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x - 10, y - 12, w + 20, 6);                            // shadow above lintel
    g.fillStyle = t; g.fillRect(x - 8, y - 10, w + 16, h + 10 + 8); gb.fillStyle = '#c0c0c0'; gb.fillRect(x - 8, y - 10, w + 16, h + 18);                  // stone surround
    g.fillStyle = '#16191d'; g.fillRect(x, y, w, h); gb.fillStyle = '#202020'; gb.fillRect(x, y, w, h);                                                   // reveal
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x, y, 7, h); g.fillRect(x, y, w, 7);                                                                       // reveal depth shading
    const gx = x + 6, gy = y + 6, gw = w - 12, gh = h - 12, gr = g.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, '#5d7388'); gr.addColorStop(0.5, '#2f3e4c'); gr.addColorStop(1, '#1b232c');
    g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(gx + 6, gy); g.lineTo(gx + gw * 0.55, gy); g.lineTo(gx + gw * 0.2, gy + gh); g.lineTo(gx, gy + gh); g.closePath(); g.fill();
    if (curtain) { g.fillStyle = curtain; g.fillRect(gx, gy, gw * 0.38, gh); g.fillRect(gx + gw * 0.62, gy, gw * 0.38, gh); }
    g.fillStyle = pal.frame; g.fillRect(x + 3, y + 3, w - 6, 5); g.fillRect(x + 3, y + h - 8, w - 6, 5); g.fillRect(x + 3, y + 3, 5, h - 6); g.fillRect(x + w - 8, y + 3, 5, h - 6);   // frame
    g.fillRect(x + w / 2 - 2, y + 3, 4, h - 6); g.fillRect(x + 3, y + h * 0.3, w - 6, 4);                                                                  // mullion + fanlight transom
    gb.fillStyle = '#b0b0b0'; gb.fillRect(x + 3, y + 3, w - 6, 5); gb.fillRect(x + w / 2 - 2, y + 3, 4, h - 6);
    g.fillStyle = t; g.fillRect(x - 12, y + h + 8, w + 24, 8); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x - 12, y + h + 16, w + 24, 4);                 // projecting sill + drop shadow
    gb.fillStyle = '#e0e0e0'; gb.fillRect(x - 12, y + h + 8, w + 24, 8);
    if (lit) { ge.fillStyle = lit; ge.globalAlpha = 0.7; ge.fillRect(gx, gy, gw, gh); ge.globalAlpha = 1; }
  }

  /** upper-floor facade tile: 4 bays x 3 floors */
  function upper(pal, seed, blind) {
    const [c, g] = cv(TW * PXM, TH * PXM), [b, gb] = cv(TW * PXM, TH * PXM), [e, ge] = cv(TW * PXM, TH * PXM);
    wall(g, TW * PXM, TH * PXM, pal, seed, b, gb); ge.fillStyle = '#000'; ge.fillRect(0, 0, TW * PXM, TH * PXM);
    const bw = BAY * PXM, fh = FL * PXM;
    for (let r = 0; r < TF; r++) for (let k = 0; k < TB; k++) {
      const x0 = k * bw, y0 = r * fh, type = cellType(seed, k, r), h = hash(seed, k, r + 40);
      const lit = hash(seed, k, r + 90) < 0.3 ? (h < 0.5 ? '#ffd28a' : '#cfe4ff') : null, curtain = h < 0.45 ? `rgba(${200 + h * 90 | 0},${190 + h * 50 | 0},${170},.8)` : null;
      if (blind) { if (k === 1) window_(g, gb, ge, pal, x0 + bw / 2 - 28, y0 + 90, 56, 70, lit, null); continue; }          // gable: narrow stair windows only
      const wy = y0 + (pal.old ? 36 : 52), wh = pal.old ? 150 : 124;
      if (type === 'win') { window_(g, gb, ge, pal, x0 + (bw - (pal.old ? 130 : 122)) / 2, wy, pal.old ? 130 : 122, wh, lit, curtain); if (h > 0.82) { g.fillStyle = '#e9e9e6'; g.fillRect(x0 + bw / 2 - 26, y0 + wy - y0 + wh + 20, 52, 30); g.fillStyle = '#9aa'; g.fillRect(x0 + bw / 2 - 20, y0 + wy - y0 + wh + 26, 40, 4); } }   // + AC unit
      else if (type === 'balc') { window_(g, gb, ge, pal, x0 + 34, wy, 84, wh, lit, curtain); const dx = x0 + 150, dy = y0 + 40; g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(dx - 6, dy - 4, 98, fh - 40 - 4); g.fillStyle = pal.frame; g.fillRect(dx, dy, 86, fh - 50); g.fillStyle = '#212a33'; g.fillRect(dx + 7, dy + 7, 72, fh - 64); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(dx + 7, dy + 7, 30, fh - 64); gb.fillStyle = '#303030'; gb.fillRect(dx, dy, 86, fh - 50); if (lit) { ge.fillStyle = lit; ge.globalAlpha = 0.6; ge.fillRect(dx + 7, dy + 7, 72, fh - 64); ge.globalAlpha = 1; } }
      else {                                                              // glazed loggia: whole bay closed in with tinted glass + dark spandrel
        const lx = x0 + 16, ly = y0 + 34, lw = bw - 32, lh = fh - 52; g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(lx - 4, ly - 4, lw + 8, lh + 8);
        const gr = g.createLinearGradient(0, ly, 0, ly + lh); gr.addColorStop(0, '#7fa0a6'); gr.addColorStop(1, '#3a5558'); g.fillStyle = gr; g.fillRect(lx, ly, lw, lh);
        g.fillStyle = pal.frame; for (let q = 0; q <= 3; q++) g.fillRect(lx + (lw - 4) * q / 3, ly, 4, lh); g.fillRect(lx, ly, lw, 4); g.fillRect(lx, ly + lh * 0.62, lw, 4); g.fillRect(lx, ly + lh - 4, lw, 4);
        g.fillStyle = 'rgba(25,22,20,.55)'; g.fillRect(lx + 4, ly + lh * 0.62 + 4, lw - 8, lh * 0.38 - 8); gb.fillStyle = '#404040'; gb.fillRect(lx, ly, lw, lh); if (lit) { ge.fillStyle = lit; ge.globalAlpha = 0.45; ge.fillRect(lx + 4, ly + 4, lw - 8, lh * 0.55); ge.globalAlpha = 1; }
      }
    }
    for (let r = 1; r < TF; r++) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, r * fh - 2, TW * PXM, 3); }                               // floor-slab joint line
    return { map: c, bump: b, emi: e };
  }

  /** ground floor tile (4.2 m): shop fronts, shutters, stair doors with canopies; `rear` = courtyard side (doors + small windows only) */
  function ground(pal, seed, rear) {
    const Wp = TW * PXM, Hp = GF * PXM, bw = BAY * PXM;
    const [c, g] = cv(Wp, Hp), [b, gb] = cv(Wp, Hp), [e, ge] = cv(Wp, Hp); wall(g, Wp, Hp, pal, seed + 3, b, gb); ge.fillStyle = '#000'; ge.fillRect(0, 0, Wp, Hp);
    g.fillStyle = 'rgba(40,36,32,.8)'; g.fillRect(0, Hp - 34, Wp, 34); gb.fillStyle = '#c8c8c8'; gb.fillRect(0, Hp - 34, Wp, 34);                         // stone plinth
    const signs = ['#c5352b', '#2a5da8', '#e0a526', '#2b8a57', '#6b3fa0'];
    for (let k = 0; k < TB; k++) {
      const x0 = k * bw, h = hash(seed, k, 200), kind = rear ? (h < 0.5 ? 'door' : 'small') : h < 0.5 ? 'shop' : h < 0.72 ? 'door' : h < 0.87 ? 'shutter' : 'arch';
      if (kind === 'shop') {
        g.fillStyle = pal.trim; g.fillRect(x0 + 6, 46, bw - 12, Hp - 80); g.fillStyle = '#12171c'; g.fillRect(x0 + 14, 92, bw - 28, Hp - 130);
        const gr = g.createLinearGradient(0, 92, 0, Hp - 40); gr.addColorStop(0, '#5f7f93'); gr.addColorStop(1, '#202c36'); g.fillStyle = gr; g.fillRect(x0 + 18, 96, bw - 36, Hp - 138);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x0 + 24, 96, 36, Hp - 138); g.fillStyle = pal.frame; g.fillRect(x0 + bw / 2 - 2, 96, 4, Hp - 138);
        g.fillStyle = signs[(hash(seed, k, 7) * 5) | 0]; g.fillRect(x0 + 18, 56, bw - 36, 30); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x0 + 30, 66, bw - 100, 9);       // sign band
        gb.fillStyle = '#d0d0d0'; gb.fillRect(x0 + 6, 46, bw - 12, 46); gb.fillStyle = '#202020'; gb.fillRect(x0 + 18, 96, bw - 36, Hp - 138);
        ge.fillStyle = '#ffe2a8'; ge.globalAlpha = 0.5 + hash(seed, k, 8) * 0.3; ge.fillRect(x0 + 18, 96, bw - 36, Hp - 138); ge.globalAlpha = 1; ge.fillStyle = '#fff'; ge.fillRect(x0 + 18, 56, bw - 36, 30);
      } else if (kind === 'door') {
        g.fillStyle = pal.trim; g.fillRect(x0 + 62, 70, bw - 124, Hp - 104); g.fillStyle = '#1c130f'; g.fillRect(x0 + 74, 84, bw - 148, Hp - 120);
        g.fillStyle = '#5a3a26'; g.fillRect(x0 + 80, 90, (bw - 160) / 2 - 2, Hp - 132); g.fillRect(x0 + bw / 2 + 2, 90, (bw - 160) / 2 - 2, Hp - 132);
        g.fillStyle = 'rgba(80,90,100,.8)'; g.fillRect(x0 + 86, 98, (bw - 172) / 2 - 2, 70); g.fillRect(x0 + bw / 2 + 8, 98, (bw - 172) / 2 - 2, 70);
        g.fillStyle = '#c9c2b4'; g.fillRect(x0 + 48, 62, bw - 96, 12); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x0 + 48, 74, bw - 96, 8);        // canopy slab + shadow
        gb.fillStyle = '#e0e0e0'; gb.fillRect(x0 + 48, 62, bw - 96, 12); gb.fillStyle = '#202020'; gb.fillRect(x0 + 74, 84, bw - 148, Hp - 120);
      } else if (kind === 'shutter') {
        g.fillStyle = pal.trim; g.fillRect(x0 + 10, 60, bw - 20, Hp - 94); g.fillStyle = '#7d8185'; g.fillRect(x0 + 18, 76, bw - 36, Hp - 120); g.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 78; y < Hp - 50; y += 7) g.fillRect(x0 + 18, y, bw - 36, 2);
        gb.fillStyle = '#707070'; gb.fillRect(x0 + 18, 76, bw - 36, Hp - 120);
      } else if (kind === 'arch') {
        g.fillStyle = pal.trim; g.beginPath(); g.moveTo(x0 + 40, Hp - 34); g.lineTo(x0 + 40, 120); g.arc(x0 + bw / 2, 120, bw / 2 - 40, Math.PI, 0); g.lineTo(x0 + bw - 40, Hp - 34); g.fill();
        g.fillStyle = '#0c0c0e'; g.beginPath(); g.moveTo(x0 + 56, Hp - 34); g.lineTo(x0 + 56, 122); g.arc(x0 + bw / 2, 122, bw / 2 - 56, Math.PI, 0); g.lineTo(x0 + bw - 56, Hp - 34); g.fill();       // courtyard passage
        gb.fillStyle = '#101010'; gb.fillRect(x0 + 56, 100, bw - 112, Hp - 134);
      } else {                                                           // small basement/utility window
        window_(g, gb, ge, pal, x0 + bw / 2 - 40, 120, 80, 64, null, null);
      }
    }
    return { map: c, bump: b, emi: e };
  }

  const matCache = new Map();
  function material(pi, seed, kind) {                                    // kind: upper | blind | ground | rear
    const key = `${pi}|${seed}|${kind}`; if (matCache.has(key)) return matCache.get(key);
    const pal = PALETTES[pi], t = kind === 'upper' ? upper(pal, seed, false) : kind === 'blind' ? upper(pal, seed, true) : ground(pal, seed, kind === 'rear');
    const m = new THREE.MeshStandardMaterial({ map: tex(t.map), bumpMap: tex(t.bump, false), bumpScale: 2.2, roughness: 0.9, metalness: 0, emissive: 0xffffff, emissiveMap: tex(t.emi), emissiveIntensity: 0, envMapIntensity: 0.45 });
    emis.push({ m, k: 0.9 }); matCache.set(key, m); return m;
  }
  /** retail / trade-centre skin: tinted shop-front glass (4.6 m), grey aluminium fascia (2 m), blue mural panel */
  function mallMaterial(kind) {
    const key = 'mall|' + kind; if (matCache.has(key)) return matCache.get(key);
    const mk = (W, Hh, draw) => { const [c, g] = cv(W, Hh), [e, ge] = cv(W, Hh); ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh); draw(g, ge, W, Hh); return { c, e }; };
    let t;
    if (kind === 'glass') t = mk(6 * PXM, 4.6 * PXM, (g, ge, W, Hh) => {
      const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#6f8da3'); gr.addColorStop(0.45, '#2f4252'); gr.addColorStop(1, '#161d24'); g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + hash(i, 3) * 0.06})`; g.fillRect(hash(i, 1) * W, 0, 20 + hash(i, 2) * 60, Hh * (0.5 + hash(i, 4) * 0.5)); }   // reflections
      g.fillStyle = '#b9bdc2'; for (let x = 0; x <= W; x += 3 * PXM) g.fillRect(Math.min(x, W - 5), 0, 5, Hh); g.fillRect(0, 3.1 * PXM, W, 4); g.fillStyle = '#4a4e53'; g.fillRect(0, Hh - 22, W, 22);
      g.fillStyle = '#c5352b'; g.fillRect(14, 14, 120, 26); g.fillStyle = '#fff'; g.fillRect(22, 22, 70, 8); ge.fillStyle = '#ffe9bd'; ge.globalAlpha = 0.5; ge.fillRect(0, 0.4 * PXM, W, 2.6 * PXM); ge.globalAlpha = 1; });
    else if (kind === 'fascia') t = mk(6 * PXM, 2 * PXM, (g, ge, W, Hh) => { g.fillStyle = '#8f9399'; g.fillRect(0, 0, W, Hh); g.fillStyle = 'rgba(0,0,0,.28)'; for (let x = 0; x < W; x += 1.5 * PXM) g.fillRect(x, 0, 3, Hh); g.fillRect(0, Hh - 6, W, 6); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, W, 8); });
    else t = mk(24 * 24, 4 * 24, (g, ge, W, Hh) => { g.fillStyle = '#1a3fa8'; g.fillRect(0, 0, W, Hh); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${hash(i, 8) * 0.12})`; g.fillRect(hash(i, 1) * W, hash(i, 2) * Hh, 30 + hash(i, 3) * 90, 6); } g.fillStyle = '#fff'; g.font = `900 ${Hh * 0.8}px Arial Black, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CITY', W * 0.62, Hh * 0.54); g.fillStyle = '#d6232f'; g.fillRect(W * 0.08, Hh * 0.2, W * 0.22, Hh * 0.6); ge.fillStyle = '#fff'; ge.globalAlpha = 0.7; ge.fillRect(0, 0, W, Hh); ge.globalAlpha = 1; });
    const m = new THREE.MeshStandardMaterial({ map: tex(t.c), roughness: kind === 'glass' ? 0.25 : 0.7, metalness: kind === 'glass' ? 0.35 : 0.2, emissive: 0xffffff, emissiveMap: tex(t.e), emissiveIntensity: 0, envMapIntensity: kind === 'glass' ? 1.3 : 0.5 });
    emis.push({ m, k: 0.8 }); matCache.set(key, m); return m;
  }
  return { material, mallMaterial, PALETTES, cellType };
}

/** Build all blocks into `root`. H = terrain height fn. Returns { tris, balconies }. */
export function buildBlocks(THREE, mergeGeometries, { blocks, H, root, kit }) {
  const groups = new Map();                                                // material key -> { m, pos, nrm, uv, idx }
  const grp = (key, m) => { let g = groups.get(key); if (!g) groups.set(key, g = { m, pos: [], nrm: [], uv: [], idx: [] }); return g; };
  const quad = (g, p, uvs, n) => { const o = g.pos.length / 3; for (let i = 0; i < 4; i++) { g.pos.push(p[i][0], p[i][1], p[i][2]); g.nrm.push(n[0], n[1], n[2]); g.uv.push(uvs[i][0], uvs[i][1]); } g.idx.push(o, o + 3, o + 2, o, o + 2, o + 1); };
  const flatMat = (hex, rough = 0.95, side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, side });
  const stone = flatMat(0x4a4540), roofM = flatMat(0x5a5b60, 0.95, THREE.DoubleSide), corniceM = flatMat(0xcfc4b0, 0.9, THREE.DoubleSide), plantM = flatMat(0x6a6761, 0.95, THREE.DoubleSide);
  const balc = [];                                                         // { x, y, z, ry }

  for (const b of blocks) {
    const ring = b.ring, N = ring.length, seed = b.id % 997, lv = b.lv;
    const pi = b.pi ?? (b.lv >= 9 ? (hash(seed, 3) < 0.5 ? 1 : 3) : b.lv <= 3 ? 4 : [0, 0, 1, 2, 3][(hash(seed, 1) * 5) | 0]);
    let lo = 1e9, hi = -1e9; const mids = ring.map((p, i) => { const q = ring[(i + 1) % N]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
    for (const p of [...ring, ...mids]) { const y = H(p[0], p[1]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const mall = b.style === 'mall', y0 = hi + 0.35, yu = y0 + (mall ? 4.6 : GF), top = mall ? y0 + 6.6 : yu + Math.max(1, lv - 1) * FL;
    const nrm = ring.map((p, i) => { const q = ring[(i + 1) % N], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; return [dz / L, -dx / L, L, dx / L, dz / L]; });   // outward normal, length, dir
    for (let i = 0; i < N; i++) {
      const p = ring[i], q = ring[(i + 1) % N], [nx, nz, L, ux, uz] = nrm[i], front = b.front[i] === 1, gable = L < 14 && !front, long = L >= 14;
      if (mall) {
        const uvq = (w, h, tw, th) => [[0, 0], [w / tw, 0], [w / tw, h / th], [0, h / th]];
        if (front) { quad(grp('mall-glass', kit.mallMaterial('glass')), [[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], yu, q[1]], [p[0], yu, p[1]]], uvq(L, 4.6, 6, 4.6), [nx, 0, nz]); quad(grp('mall-fascia', kit.mallMaterial('fascia')), [[p[0], yu, p[1]], [q[0], yu, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], uvq(L, 2, 6, 2), [nx, 0, nz]); }
        else quad(grp('mall-fascia', kit.mallMaterial('fascia')), [[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], uvq(L, 6.6, 6, 2), [nx, 0, nz]);
        quad(grp('plinth', stone), [[p[0], lo - 0.6, p[1]], [q[0], lo - 0.6, q[1]], [q[0], y0, q[1]], [p[0], y0, p[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [nx, 0, nz]);
        if (front && b.id === 119516064 && L === Math.max(...nrm.filter((_, j) => b.front[j]).map(r => r[2]))) { const w = Math.min(26, L - 2), s0 = L * 0.5 - w / 2, a = [p[0] + ux * s0 + nx * 0.06, p[1] + uz * s0 + nz * 0.06], c2 = [a[0] + ux * w, a[1] + uz * w]; quad(grp('mall-mural', kit.mallMaterial('mural')), [[a[0], y0 + 1.9, a[1]], [c2[0], y0 + 1.9, c2[1]], [c2[0], y0 + 6.4, c2[1]], [a[0], y0 + 6.4, a[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [nx, 0, nz]); }
        continue;
      }
      const upperM = kit.material(pi, seed, gable ? 'blind' : 'upper'), groundM = kit.material(pi, seed, front ? 'ground' : 'rear');
      const rep = TW;                                                       // metres per texture repeat
      quad(grp(`g${pi}|${seed}|${front ? 'g' : 'r'}`, groundM), [[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], yu, q[1]], [p[0], yu, p[1]]], [[0, 0], [L / rep, 0], [L / rep, GF / GF], [0, 1]], [nx, 0, nz]);
      quad(grp(`u${pi}|${seed}|${gable ? 'b' : 'u'}`, upperM), [[p[0], yu, p[1]], [q[0], yu, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], [[0, 0], [L / rep, 0], [L / rep, (top - yu) / TH], [0, (top - yu) / TH]], [nx, 0, nz]);
      quad(grp('plinth', stone), [[p[0], lo - 0.6, p[1]], [q[0], lo - 0.6, q[1]], [q[0], y0, q[1]], [p[0], y0, p[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [nx, 0, nz]);
      if (long && lv >= 3) {                                                // 3D balconies where the painted tile has a balcony door
        const nb = Math.floor(L / BAY);
        // tile row r counts from the top of the canvas, floor f from the bottom of the wall (v starts at yu), so r = TF - 1 - f % TF; the balcony door is painted at bay-relative x = 1.9..3.0 m (centre 2.41)
        for (let k = 0; k < nb; k++) for (let f = 0; f < lv - 1; f++) if (cellType(seed, k % TB, TF - 1 - (f % TF)) === 'balc') {
          const s = k * BAY + 2.41; balc.push([0, yu + f * FL + 0.02, 0, Math.atan2(nx, nz), 0, 0, 0, 0, p[0] + ux * s + nx * 0.03, p[1] + uz * s + nz * 0.03]);
        }
      }
    }
    // stepped cornice + parapet (mitred around the footprint)
    const off = (i, d) => { const a = nrm[(i + N - 1) % N], c = nrm[i], mx = a[0] + c[0], mz = a[1] + c[1], k = 1 + a[0] * c[0] + a[1] * c[1]; return [ring[i][0] + (mx / k) * d, ring[i][1] + (mz / k) * d]; };
    const cm = grp('cornice', corniceM);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, a0 = off(i, 0), b0 = off(j, 0), a1 = off(i, 0.32), b1 = off(j, 0.32), n = [nrm[i][0], 0, nrm[i][1]];
      const Q = (A, B, ya, yb, nn) => quad(cm, [[A[0], ya, A[1]], [B[0], ya, B[1]], [B[0], yb, B[1]], [A[0], yb, A[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], nn);
      Q(a1, b1, top - 0.5, top + 0.2, n);                                                                        // cornice face
      quad(cm, [[a0[0], top - 0.5, a0[1]], [b0[0], top - 0.5, b0[1]], [b1[0], top - 0.5, b1[1]], [a1[0], top - 0.5, a1[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0]);   // underside
      quad(cm, [[a1[0], top + 0.2, a1[1]], [b1[0], top + 0.2, b1[1]], [b0[0], top + 0.2, b0[1]], [a0[0], top + 0.2, a0[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);      // top
      const a2 = off(i, 0.05), b2 = off(j, 0.05); Q(a2, b2, top + 0.2, top + 0.75, n);                           // parapet
    }
    const tri = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []), rg = grp('roof', roofM), o = rg.pos.length / 3;
    for (const p of ring) { rg.pos.push(p[0], top + 0.2, p[1]); rg.nrm.push(0, 1, 0); rg.uv.push(0, 0); } for (const t of tri) rg.idx.push(o + t[0], o + t[2], o + t[1]);
    // roof plant: stair/lift head + a vent box
    const cx = ring.reduce((s, p) => s + p[0], 0) / N, cz = ring.reduce((s, p) => s + p[1], 0) / N, [, , Lm, ux, uz] = nrm.reduce((a, c) => (c[2] > a[2] ? c : a), nrm[0]), pm = grp('plant', plantM), hh = 2.6 + hash(seed, 5) * 1.2, w = 4, d = 3;
    const bx = (hx, hz, yb, yt, c0, c1) => { const P = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([sx, sz]) => [cx + ux * (sx + c0) - uz * (sz + c1), cz + uz * (sx + c0) + ux * (sz + c1)]); for (let i = 0; i < 4; i++) { const A = P[i], B = P[(i + 1) % 4], dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz) || 1; quad(pm, [[A[0], yb, A[1]], [B[0], yb, B[1]], [B[0], yt, B[1]], [A[0], yt, A[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [dz / l, 0, -dx / l]); } quad(pm, P.map(p => [p[0], yt, p[1]]), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]); };
    void Lm; bx(w / 2, d / 2, top + 0.2, top + 0.2 + hh, 0, 0); if (nrm.length > 3) bx(0.9, 0.9, top + 0.2, top + 1.8, 6, 2);
  }

  const meshes = []; let tris = 0;
  for (const g of groups.values()) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); geo.setIndex(g.idx);
    const mesh = new THREE.Mesh(geo, g.m); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); meshes.push(mesh); tris += g.idx.length / 3;
  }
  // balconies: slab + solid parapet + side wings, instanced
  if (balc.length) {
    const slab = new THREE.BoxGeometry(2.7, 0.16, 1.15).translate(0, 0, 0.575), rail = mergeGeometries([new THREE.BoxGeometry(2.7, 0.95, 0.07).translate(0, 0.55, 1.12), new THREE.BoxGeometry(0.07, 0.95, 1.1).translate(-1.32, 0.55, 0.57), new THREE.BoxGeometry(0.07, 0.95, 1.1).translate(1.32, 0.55, 0.57)]);
    const sm = new THREE.InstancedMesh(slab, flatMat(0xb9b2a4), balc.length), rm = new THREE.InstancedMesh(rail, flatMat(0x57544f, 0.7), balc.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    balc.forEach((v, i) => { q.setFromAxisAngle(up, v[3]); m4.compose(new THREE.Vector3(v[8], v[1], v[9]), q, one); sm.setMatrixAt(i, m4); rm.setMatrixAt(i, m4); });
    sm.castShadow = rm.castShadow = true; sm.receiveShadow = rm.receiveShadow = true; root.add(sm, rm); tris += balc.length * 36;
  }
  return { tris, balconies: balc.length, meshes: meshes.length };
}
