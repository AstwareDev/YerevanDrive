import * as THREE from 'three';

// ---------- tileable value noise ----------
function rnd(ix, iy, seed) { let h = Math.imul(ix * 374761393 + iy * 668265263 + seed * 1442695041, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const s = t => t * t * (3 - 2 * t), sx = s(tx), sy = s(ty);
  const w = v => ((v % p) + p) % p;
  const a = rnd(w(xi), w(yi), seed), b = rnd(w(xi + 1), w(yi), seed), c = rnd(w(xi), w(yi + 1), seed), d = rnd(w(xi + 1), w(yi + 1), seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
export function fbm(x, y, period, octaves, seed = 1) {
  let v = 0, amp = 0.5, tot = 0, p = period;
  for (let o = 0; o < octaves; o++) { v += vnoise(x * p, y * p, p, seed + o * 17) * amp; tot += amp; amp *= 0.5; p *= 2; }
  return v / tot;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat = [1, 1], aniso = 8, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]); t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// fill a canvas per pixel with fn(u,v)->[r,g,b,a] 0..255
function paint(w, h, fn) {
  const c = canvas(w, h), g = c.getContext('2d'), im = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, gg, b, a = 255] = fn(x / w, y / h, x, y); const i = (y * w + x) * 4; im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = a; }
  g.putImageData(im, 0, 0); return c;
}

export function makeTextures(maxAniso) {
  const T = {};
  // ---- asphalt (colour + roughness/bump) 512px, tiles every 6 m
  {
    const col = paint(512, 512, (u, v) => {
      const n = fbm(u, v, 8, 5, 3), fine = rnd(Math.floor(u * 512), Math.floor(v * 512), 9);
      let g = 70 + n * 38 + (fine - 0.5) * 34;
      if (fine > 0.985) g += 55; // light aggregate speckles
      return [g, g * 1.0, g * 1.04];
    });
    T.asphalt = tex(col, { repeat: [1 / 6, 1 / 6], aniso: maxAniso });
    const rough = paint(256, 256, (u, v) => { const n = fbm(u, v, 6, 4, 11); const g = 130 + n * 100; return [g, g, g]; });
    T.asphaltRough = tex(rough, { srgb: false, repeat: [1 / 6, 1 / 6], aniso: maxAniso });
    const bump = paint(256, 256, (u, v, x, y) => { const g = 128 + (rnd(x, y, 5) - 0.5) * 110 + (fbm(u, v, 16, 3, 2) - 0.5) * 80; return [g, g, g]; });
    T.asphaltBump = tex(bump, { srgb: false, repeat: [1 / 6, 1 / 6], aniso: maxAniso });
  }
  // ---- puddle mask (world-space, used by shader patch)
  {
    const c = paint(512, 512, (u, v) => { const g = fbm(u, v, 5, 5, 41) * 255; return [g, g, g]; });
    T.puddle = tex(c, { srgb: false, aniso: 4 });
  }
  // ---- generic ground
  T.terrain = tex(paint(256, 256, (u, v, x, y) => { const g = 50 + fbm(u, v, 8, 4, 21) * 35 + (rnd(x, y, 2) - 0.5) * 14; return [g, g * 0.98, g * 0.95]; }), { repeat: [1 / 8, 1 / 8], aniso: maxAniso });
  T.dirt = tex(paint(256, 256, (u, v, x, y) => { const n = fbm(u, v, 8, 4, 31); return [80 + n * 50 + (rnd(x, y, 3) - 0.5) * 16, 62 + n * 38, 44 + n * 28]; }), { repeat: [1 / 6, 1 / 6], aniso: maxAniso });
  T.grass = tex(paint(256, 256, (u, v, x, y) => { const n = fbm(u, v, 10, 4, 51), s = rnd(x, y, 6); return [26 + n * 22 + s * 14, 54 + n * 44 + s * 24, 22 + n * 16 + s * 8]; }), { repeat: [1 / 4, 1 / 4], aniso: maxAniso });
  // ---- plaza: pink tuff pavers, 1 m modules in a 4 m tile
  T.plaza = tex(paint(512, 512, (u, v, x, y) => {
    const cell = 128, cx = Math.floor(x / cell), cy = Math.floor(y / cell), lx = x % cell, ly = y % cell;
    const tone = 0.85 + rnd(cx, cy, 77) * 0.3, join = lx < 3 || ly < 3;
    const n = fbm(u, v, 12, 3, 8);
    let r = (150 + n * 40) * tone, g = (112 + n * 30) * tone, b = (96 + n * 26) * tone;
    if (join) { r *= 0.5; g *= 0.5; b *= 0.5; }
    return [r, g, b];
  }), { repeat: [1 / 4, 1 / 4], aniso: maxAniso });
  // ---- sidewalk: u across 0..1 (curb edges), v along metres (4 m tile)
  T.sidewalk = tex(paint(256, 256, (u, v, x, y) => {
    const rowH = 64, row = Math.floor(y / rowH), ly = y % rowH;
    const bw = 86, off = (row % 2) * 43, lx = (x + off) % bw;
    const tone = 0.85 + rnd(Math.floor((x + off) / bw), row, 12) * 0.3;
    const join = lx < 2 || ly < 2;
    const n = fbm(u, v, 8, 3, 4);
    let g = (96 + n * 36) * tone; if (join) g *= 0.55;
    // curb strips on both edges
    if (u < 0.045 || u > 0.955) g = 128 + n * 20;
    if (u >= 0.045 && u < 0.065 || u > 0.935 && u <= 0.955) g = 38;
    return [g, g * 0.99, g * 0.97];
  }), { repeat: [1, 1 / 4], aniso: maxAniso });
  // ---- wall / fence / roof
  T.concrete = tex(paint(256, 256, (u, v, x, y) => { const g = 90 + fbm(u, v, 8, 4, 61) * 55 + (rnd(x, y, 8) - 0.5) * 18; return [g, g * 0.97, g * 0.93]; }), { repeat: [1 / 4, 1 / 4], aniso: maxAniso });
  T.roof = tex(paint(256, 256, (u, v, x, y) => { const g = 120 + fbm(u, v, 8, 4, 71) * 90 + (rnd(x, y, 1) - 0.5) * 20; return [g, g, g * 1.04]; }), { repeat: [1 / 8, 1 / 8], aniso: maxAniso });

  // ---- lane markings (alpha). u = across the road, v = metres along (9 m period)
  const markTex = (lines) => {
    const W = 512, Hh = 512, c = canvas(W, Hh), g = c.getContext('2d');
    g.clearRect(0, 0, W, Hh);
    for (const l of lines) {
      g.fillStyle = l.color ?? '#e8e6dc';
      const lw = Math.max(2, Math.round(W * (l.w ?? 0.012)));
      const x = Math.round(l.at * W - lw / 2);
      if (l.dash) { g.fillRect(x, 0, lw, Hh * 0.34); } else g.fillRect(x, 0, lw, Hh);
    }
    return tex(c, { repeat: [1, 1 / 9], aniso: maxAniso });
  };
  T.markA = markTex([{ at: 0.04, w: 0.014 }, { at: 0.96, w: 0.014 }, { at: 0.5, w: 0.012, dash: true }]);
  T.markB = markTex([{ at: 0.025, w: 0.01 }, { at: 0.975, w: 0.01 }, { at: 0.488, w: 0.008 }, { at: 0.512, w: 0.008 }, { at: 0.26, w: 0.008, dash: true }, { at: 0.74, w: 0.008, dash: true }]);
  T.markC = markTex([{ at: 0.03, w: 0.012 }, { at: 0.97, w: 0.012 }, { at: 0.333, w: 0.009, dash: true }, { at: 0.667, w: 0.009, dash: true }]);
  // ---- zebra: stripes parallel to ribbon direction, repeating across (u)
  {
    const c = canvas(128, 16), g = c.getContext('2d'); g.clearRect(0, 0, 128, 16); g.fillStyle = '#ecebe2'; g.fillRect(0, 0, 64, 16);
    T.zebra = tex(c, { repeat: [3, 1], aniso: maxAniso });
  }

  // ---- facade atlas 8 bays x 8 floors (cell 64 px = 3.5 m x 3.2 m). repeat = 1/28 m, 1/25.6 m
  {
    const S = 512, C = 64, alb = canvas(S, S), em = canvas(S, S), orm = canvas(S, S);
    const ga = alb.getContext('2d'), ge = em.getContext('2d'), go = orm.getContext('2d');
    // albedo base: light wall with weathering
    const base = paint(S, S, (u, v, x, y) => { const n = fbm(u, v, 8, 4, 91), streak = fbm(u * 6, v * 0.8, 8, 3, 7); const g = 205 + n * 40 - streak * 38 + (rnd(x, y, 4) - 0.5) * 12; return [g, g, g]; });
    ga.drawImage(base, 0, 0);
    go.fillStyle = 'rgb(255,215,0)'; go.fillRect(0, 0, S, S); // R=ao, G=rough .84, B=metal 0
    ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
    const warm = ['#ffc77a', '#ffb865', '#ffd9a0', '#ffe2b8'], cool = ['#bcd6ff', '#9ec2ff'], tv = ['#6ea0ff', '#a07bff'];
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
      const x0 = cx * C, y0 = cy * C, wx = x0 + 15, wy = y0 + 11, ww = 34, wh = 40;
      // frame
      ga.fillStyle = 'rgb(236,232,224)'; ga.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      // glass
      const gr = ga.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, 'rgb(34,44,64)'); gr.addColorStop(1, 'rgb(14,20,32)');
      ga.fillStyle = gr; ga.fillRect(wx, wy, ww, wh);
      ga.fillStyle = 'rgb(230,226,216)'; ga.fillRect(wx + ww / 2 - 1, wy, 2, wh);               // mullion
      ga.fillRect(wx, wy + wh * 0.35, ww, 2);                                                   // transom
      // sill + occasional balcony slab
      ga.fillStyle = 'rgb(176,172,164)'; ga.fillRect(wx - 5, wy + wh + 3, ww + 10, 4);
      if (rnd(cx, cy, 31) < 0.28) { ga.fillStyle = 'rgb(150,146,140)'; ga.fillRect(x0 + 6, y0 + 56, 52, 5); ga.fillStyle = 'rgb(92,90,88)'; ga.fillRect(x0 + 6, y0 + 61, 52, 2); }
      // ORM: glass is smooth + semi metallic (reflective), frame mid
      go.fillStyle = 'rgb(255,36,150)'; go.fillRect(wx, wy, ww, wh);
      // emissive (lit windows)
      const r = rnd(cx, cy, 55);
      if (r < 0.30) {
        const pickc = rnd(cx, cy, 56), colr = pickc < 0.72 ? warm[Math.floor(rnd(cx, cy, 57) * warm.length)] : pickc < 0.92 ? cool[Math.floor(rnd(cx, cy, 58) * cool.length)] : tv[Math.floor(rnd(cx, cy, 59) * tv.length)];
        const gg = ge.createLinearGradient(0, wy, 0, wy + wh); gg.addColorStop(0, colr); gg.addColorStop(1, colr);
        ge.fillStyle = colr; ge.globalAlpha = 0.55 + rnd(cx, cy, 60) * 0.45; ge.fillRect(wx, wy, ww, wh);
        // curtain or blinds darken part of the window
        if (rnd(cx, cy, 61) < 0.5) { ge.globalAlpha = 0.55; ge.fillStyle = '#000'; ge.fillRect(wx, wy, ww, wh * (0.2 + rnd(cx, cy, 62) * 0.4)); }
        ge.globalAlpha = 1; ge.fillStyle = '#000'; ge.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      }
    }
    T.facadeAlbedo = tex(alb, { repeat: [1 / 28, 1 / 25.6], aniso: maxAniso });
    T.facadeEmissive = tex(em, { repeat: [1 / 28, 1 / 25.6], aniso: maxAniso });
    T.facadeORM = tex(orm, { srgb: false, repeat: [1 / 28, 1 / 25.6], aniso: maxAniso });
  }
  // ---- shop band: 4 bays (14 m) x 3.8 m, glowing shopfronts. u metres, v metres.
  {
    const W = 512, Hh = 128, alb = canvas(W, Hh), em = canvas(W, Hh), ga = alb.getContext('2d'), ge = em.getContext('2d');
    ga.fillStyle = 'rgb(190,186,178)'; ga.fillRect(0, 0, W, Hh); ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh);
    const shopCols = ['#ffd9a0', '#ffc07a', '#ff5fc0', '#4ad8ff', '#fff2d6', '#ffa63d', '#9d7bff', '#b8ff8a'];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 128, open = rnd(i, 0, 5);
      ga.fillStyle = 'rgb(60,58,56)'; ga.fillRect(x0 + 8, 18, 112, 100);                    // surround
      ga.fillStyle = 'rgb(18,22,30)'; ga.fillRect(x0 + 14, 26, 100, 82);                    // glass
      ga.fillStyle = 'rgb(214,210,200)'; ga.fillRect(x0 + 10, 4, 108, 10);                  // sign band
      if (open < 0.82) {
        const c = shopCols[Math.floor(rnd(i, 1, 6) * shopCols.length)];
        ge.fillStyle = c; ge.globalAlpha = 0.9; ge.fillRect(x0 + 14, 26, 100, 82);
        ge.globalAlpha = 0.7; ge.fillStyle = '#000'; ge.fillRect(x0 + 14, 26, 100, 8);       // top shade
        ge.fillRect(x0 + 14, 26, 3, 82); ge.fillRect(x0 + 111, 26, 3, 82);
        ge.globalAlpha = 1; ge.fillStyle = c; ge.fillRect(x0 + 10, 4, 108, 10);              // lit sign band
      }
    }
    T.shopAlbedo = tex(alb, { repeat: [1 / 14, 1 / 3.8], aniso: maxAniso });
    T.shopEmissive = tex(em, { repeat: [1 / 14, 1 / 3.8], aniso: maxAniso });
  }

  // ---- additional facade atlases (8x8 cells of 64 px). metres per cell: tuff 4.0x3.8, modern 3.0x3.6, house 3.2x3.0
  const atlas = (seed, baseFn, drawCell, repeat) => {
    const S = 512, C = 64, alb = canvas(S, S), em = canvas(S, S), orm = canvas(S, S);
    const ga = alb.getContext('2d'), ge = em.getContext('2d'), go = orm.getContext('2d');
    ga.drawImage(paint(S, S, baseFn), 0, 0);
    go.fillStyle = 'rgb(255,215,0)'; go.fillRect(0, 0, S, S);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) drawCell({ ga, ge, go, x0: cx * C, y0: cy * C, cx, cy, r: k => rnd(cx, cy, seed + k) });
    return [tex(alb, { repeat, aniso: maxAniso }), tex(em, { repeat, aniso: maxAniso }), tex(orm, { srgb: false, repeat, aniso: maxAniso })];
  };
  const WARM = ['#ffc77a', '#ffb865', '#ffd9a0', '#ffe2b8'], COOL = ['#bcd6ff', '#9ec2ff', '#dfeaff'];
  // Tuff / classical: ashlar courses, pilasters, arched windows with keystones, belt course
  [T.tuffAlbedo, T.tuffEmissive, T.tuffORM] = atlas(300,
    (u, v, x, y) => { const course = (y % 8) < 1 ? -22 : 0; const n = fbm(u, v, 8, 4, 33), st = fbm(u * 5, v * 0.7, 8, 3, 9); const g = 214 + n * 30 - st * 40 + course + (rnd(x, y, 6) - 0.5) * 14; return [g, g * 0.985, g * 0.96]; },
    ({ ga, ge, go, x0, y0, r }) => {
      // pilasters left/right
      ga.fillStyle = 'rgba(255,250,240,0.55)'; ga.fillRect(x0, y0, 7, 64); ga.fillRect(x0 + 57, y0, 7, 64);
      ga.fillStyle = 'rgba(0,0,0,0.18)'; ga.fillRect(x0 + 7, y0, 1.5, 64); ga.fillRect(x0 + 55.5, y0, 1.5, 64);
      const wx = x0 + 19, wy = y0 + 12, ww = 26, wh = 38;
      const arch = r(1) < 0.55;
      const path = (px, py, w, h) => { ga.beginPath(); if (arch) { ga.moveTo(px, py + h); ga.lineTo(px, py + w / 2); ga.arc(px + w / 2, py + w / 2, w / 2, Math.PI, 0); ga.lineTo(px + w, py + h); } else ga.rect(px, py, w, h); ga.closePath(); };
      ga.fillStyle = 'rgb(246,240,228)'; path(wx - 4, wy - 4, ww + 8, wh + 8); ga.fill();          // stone surround
      const gr = ga.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, 'rgb(36,46,66)'); gr.addColorStop(1, 'rgb(12,18,30)');
      ga.fillStyle = gr; path(wx, wy, ww, wh); ga.fill();
      ga.fillStyle = 'rgb(232,226,214)'; ga.fillRect(wx + ww / 2 - 1, wy + (arch ? 6 : 0), 2, wh - (arch ? 6 : 0)); ga.fillRect(wx, wy + wh * 0.4, ww, 2);
      if (arch) { ga.fillStyle = 'rgb(222,214,198)'; ga.fillRect(wx + ww / 2 - 3, wy - 8, 6, 7); }  // keystone
      ga.fillStyle = 'rgb(205,198,185)'; ga.fillRect(wx - 6, wy + wh + 3, ww + 12, 4);                // sill
      ga.fillStyle = 'rgba(0,0,0,0.22)'; ga.fillRect(x0, y0 + 62, 64, 2);                              // belt-course shadow
      ga.fillStyle = 'rgba(255,255,255,0.35)'; ga.fillRect(x0, y0 + 60, 64, 2);
      if (r(2) < 0.22) { ga.fillStyle = 'rgb(40,38,40)'; ga.fillRect(wx - 4, wy + wh - 6, ww + 8, 2); for (let i = 0; i < 7; i++) ga.fillRect(wx - 3 + i * 4.2, wy + wh - 13, 1, 8); } // iron balcony rail
      go.fillStyle = 'rgb(255,40,140)'; path.call(null, wx, wy, ww, wh); // (ORM region approximated below)
      go.fillRect(wx, wy + (arch ? 12 : 0), ww, wh - (arch ? 12 : 0));
      if (r(5) < 0.3) { const c = r(6) < 0.75 ? WARM[Math.floor(r(7) * 4)] : COOL[Math.floor(r(8) * 3)]; ge.fillStyle = c; ge.globalAlpha = 0.55 + r(9) * 0.45; ge.beginPath(); if (arch) { ge.moveTo(wx, wy + wh); ge.lineTo(wx, wy + ww / 2); ge.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); ge.lineTo(wx + ww, wy + wh); } else ge.rect(wx, wy, ww, wh); ge.closePath(); ge.fill(); if (r(10) < 0.45) { ge.globalAlpha = 0.6; ge.fillStyle = '#000'; ge.fillRect(wx, wy, ww, wh * (0.2 + r(11) * 0.4)); } ge.globalAlpha = 1; ge.fillStyle = '#000'; ge.fillRect(wx + ww / 2 - 1, wy, 2, wh); }
    }, [1 / 32, 1 / 30.4]);
  // Modern curtain wall: tinted glass, mullions, spandrels; lit office floors
  [T.modernAlbedo, T.modernEmissive, T.modernORM] = atlas(400,
    (u, v, x, y) => { const g = 120 + fbm(u, v, 6, 3, 5) * 26; return [g * 0.8, g * 0.92, g * 1.1]; },
    ({ ga, ge, go, x0, y0, cx, cy, r }) => {
      const rowLit = rnd(0, cy, 411) < 0.33;
      ga.fillStyle = 'rgb(70,86,112)'; ga.fillRect(x0, y0, 64, 64);
      const gr = ga.createLinearGradient(0, y0, 0, y0 + 64); gr.addColorStop(0, 'rgb(86,110,140)'); gr.addColorStop(1, 'rgb(44,60,86)'); ga.fillStyle = gr; ga.fillRect(x0 + 2, y0 + 2, 60, 46);
      ga.fillStyle = 'rgb(176,182,190)'; ga.fillRect(x0 + 62, y0, 2, 64); ga.fillRect(x0, y0, 2, 64); ga.fillRect(x0, y0 + 48, 64, 16);   // mullions + spandrel
      ga.fillStyle = 'rgba(255,255,255,0.10)'; ga.fillRect(x0 + 4, y0 + 4, 20, 40);
      go.fillStyle = 'rgb(255,25,215)'; go.fillRect(x0 + 2, y0 + 2, 60, 46);
      if (rowLit && r(3) < 0.8) { ge.fillStyle = r(4) < 0.8 ? '#cfe2ff' : '#ffe2b8'; ge.globalAlpha = 0.45 + r(5) * 0.5; ge.fillRect(x0 + 2, y0 + 2, 60, 46); ge.globalAlpha = 1; }
    }, [1 / 24, 1 / 28.8]);
  // Small house: plaster, small shuttered windows
  [T.houseAlbedo, T.houseEmissive, T.houseORM] = atlas(500,
    (u, v, x, y) => { const n = fbm(u, v, 10, 4, 71), st = fbm(u * 4, v, 8, 3, 2); const g = 200 + n * 36 - st * 48 + (rnd(x, y, 3) - 0.5) * 16; return [g, g * 0.98, g * 0.94]; },
    ({ ga, ge, go, x0, y0, r }) => {
      const wx = x0 + 22, wy = y0 + 16, ww = 20, wh = 28, shut = ['#5b7b4a', '#7a4a3a', '#3f5f86', '#8a8a8a'][Math.floor(r(1) * 4)];
      ga.fillStyle = 'rgb(236,230,218)'; ga.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      ga.fillStyle = 'rgb(20,26,38)'; ga.fillRect(wx, wy, ww, wh); ga.fillStyle = 'rgb(226,220,208)'; ga.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      if (r(2) < 0.6) { ga.fillStyle = shut; ga.fillRect(wx - 9, wy - 2, 8, wh + 4); ga.fillRect(wx + ww + 1, wy - 2, 8, wh + 4); }
      ga.fillStyle = 'rgb(160,156,148)'; ga.fillRect(wx - 5, wy + wh + 3, ww + 10, 3);
      go.fillStyle = 'rgb(255,40,150)'; go.fillRect(wx, wy, ww, wh);
      if (r(4) < 0.38) { ge.fillStyle = WARM[Math.floor(r(5) * 4)]; ge.globalAlpha = 0.6 + r(6) * 0.4; ge.fillRect(wx, wy, ww, wh); if (r(7) < 0.5) { ge.globalAlpha = 0.6; ge.fillStyle = '#000'; ge.fillRect(wx, wy, ww, wh * 0.45); } ge.globalAlpha = 1; ge.fillStyle = '#000'; ge.fillRect(wx + ww / 2 - 1, wy, 2, wh); }
    }, [1 / 25.6, 1 / 24]);

  // ---- soft radial glow (light pools / neon halos)
  {
    const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; T.glow = t;
  }
  return T;
}
