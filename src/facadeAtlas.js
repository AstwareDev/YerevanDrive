// City-wide facade atlases (8x8 cells, one window per cell): albedo / emissive / ORM. Drawn as vectors in 512-space and rasterised at the Textures
// setting (512 / 1024 / 2048 albedo; emissive + ORM capped at 1024), so windows stay crisp up close. Every window gets a real interior: sky-reflecting glass,
// curtains / blinds / lace / plants, an inset shadow, frame colours, drip stains, air-conditioners, plaster patches and a floor-slab shadow line.
const CURT = [[236, 228, 208], [214, 196, 160], [188, 150, 140], [150, 168, 140], [168, 178, 196], [242, 240, 236], [200, 120, 96], [120, 110, 100], [226, 206, 170]];
const FRAMES = [[238, 234, 226], [238, 234, 226], [238, 234, 226], [120, 84, 58], [58, 60, 66], [196, 190, 178]];
const WARM = ['#ffc77a', '#ffb865', '#ffd9a0', '#ffe2b8'], COOL = ['#bcd6ff', '#9ec2ff', '#dfeaff'], TV = ['#6ea0ff', '#a07bff'];
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const pathWin = (g, { x, y, w, h, arch }) => { g.beginPath(); if (arch) { g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); } else g.rect(x, y, w, h); g.closePath(); };

/** glass + interior of one window (albedo, ORM and emissive). W = {x,y,w,h,arch}; r(k) = per-cell random */
function paintWindow(ga, ge, go, W, r, o = {}) {
  const { x, y, w, h } = W;
  ga.save(); pathWin(ga, W); ga.clip();
  const gr = ga.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, o.top ?? 'rgb(104,124,152)'); gr.addColorStop(0.38, 'rgb(48,60,82)'); gr.addColorStop(1, 'rgb(14,20,30)');
  ga.fillStyle = gr; ga.fillRect(x, y, w, h);
  const kind = r(40), soft = [];           // soft = rects whose ORM must be rough (fabric, not glass)
  if (kind < 0.26) { ga.fillStyle = 'rgba(150,128,104,0.18)'; ga.fillRect(x + w * 0.1, y + h * 0.42, w * 0.8, h * 0.58); }                    // dark room, glimpse of a back wall
  else if (kind < 0.56) {                                                                                                                  // curtains
    const c = CURT[Math.floor(r(41) * CURT.length)], full = r(42) < 0.3, cw = full ? w : w * (0.3 + r(43) * 0.16), hang = h * (0.82 + r(45) * 0.18);
    const panel = (px, pw) => { ga.fillStyle = rgb(c); ga.fillRect(px, y, pw, hang); for (let i = 0; i * 2.6 < pw; i++) { ga.fillStyle = i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.12)'; ga.fillRect(px + i * 2.6, y, 1.3, hang); } soft.push([px, y, pw, hang]); };
    panel(x, cw); if (!full) panel(x + w - cw, cw);
    ga.fillStyle = 'rgba(0,0,0,0.3)'; ga.fillRect(x, y, w, 2.2);                                                                           // pelmet shadow
  } else if (kind < 0.76) {                                                                                                                // blind / slats
    const f = 0.3 + 0.7 * r(44), bc = [[214, 208, 196], [188, 184, 174], [226, 222, 214], [150, 140, 126]][Math.floor(r(46) * 4)];
    ga.fillStyle = rgb(bc); ga.fillRect(x, y, w, h * f); for (let yy = y; yy < y + h * f; yy += 2.2) { ga.fillStyle = 'rgba(0,0,0,0.2)'; ga.fillRect(x, yy, w, 0.8); }
    ga.fillStyle = 'rgba(0,0,0,0.35)'; ga.fillRect(x, y + h * f - 1.4, w, 1.4); soft.push([x, y, w, h * f]);
  } else if (kind < 0.88) { ga.fillStyle = 'rgba(236,232,224,0.55)'; ga.fillRect(x, y, w, h); for (let i = 0; i < 40; i++) { ga.fillStyle = 'rgba(255,255,255,0.35)'; ga.fillRect(x + r(60 + i) * w, y + r(100 + i) * h, 1, 1); } soft.push([x, y, w, h]); }   // lace
  else { ga.fillStyle = 'rgb(46,84,44)'; ga.beginPath(); ga.ellipse(x + w * 0.3, y + h * 0.86, w * 0.22, h * 0.16, 0, 0, 6.3); ga.fill(); ga.fillStyle = 'rgb(210,170,110)'; ga.fillRect(x + w * 0.58, y + h * 0.42, w * 0.22, h * 0.16); }      // plant + lamp shade
  ga.fillStyle = 'rgba(255,255,255,0.13)'; ga.beginPath(); ga.moveTo(x, y + h * 0.58); ga.lineTo(x + w * 0.72, y); ga.lineTo(x + w, y); ga.lineTo(x + w, y + h * 0.16); ga.lineTo(x + w * 0.3, y + h); ga.lineTo(x, y + h); ga.fill();   // sky glint
  let s = ga.createLinearGradient(0, y, 0, y + 5); s.addColorStop(0, 'rgba(0,0,0,0.55)'); s.addColorStop(1, 'rgba(0,0,0,0)'); ga.fillStyle = s; ga.fillRect(x, y, w, 5);                                  // reveal shadow
  s = ga.createLinearGradient(x, 0, x + 3, 0); s.addColorStop(0, 'rgba(0,0,0,0.42)'); s.addColorStop(1, 'rgba(0,0,0,0)'); ga.fillStyle = s; ga.fillRect(x, y, 3, h);
  ga.restore();
  go.fillStyle = 'rgb(255,32,150)'; go.save(); pathWin(go, W); go.fill(); go.restore();
  go.fillStyle = 'rgb(255,150,0)'; for (const [a, b, c, d] of soft) go.fillRect(a, b, c, d);
  if (r(5) < (o.lit ?? 0.3)) {                                                                                                             // lit at night
    const pc = r(6), col = pc < 0.72 ? WARM[Math.floor(r(7) * 4)] : pc < 0.92 ? COOL[Math.floor(r(8) * 3)] : TV[Math.floor(r(9) * 2)];
    ge.save(); pathWin(ge, W); ge.clip(); ge.fillStyle = col; ge.globalAlpha = 0.55 + r(10) * 0.45; ge.fillRect(x, y, w, h);
    if (r(11) < 0.45) { ge.globalAlpha = 0.6; ge.fillStyle = '#000'; ge.fillRect(x, y, w, h * (0.2 + r(12) * 0.4)); } ge.restore();
  }
}

function frameBars(ga, W, r, col, mull = true) {
  const { x, y, w, h, arch } = W;
  ga.fillStyle = rgb(col); const t = 1.8;
  if (mull) ga.fillRect(x + w / 2 - t / 2, y + (arch ? 5 : 0), t, h - (arch ? 5 : 0));
  ga.fillRect(x, y + h * 0.36, w, t);
  ga.fillStyle = 'rgba(0,0,0,0.22)'; ga.fillRect(x + w / 2 + t / 2, y + (arch ? 5 : 0), 0.8, h - (arch ? 5 : 0)); ga.fillRect(x, y + h * 0.36 + t, w, 0.8);
}

/** things attached to the wall around a window: drip stain, air-conditioner, dish, plaster patch */
function extras(ga, x0, y0, W, r) {
  const { x, y, w, h } = W;
  const dg = ga.createLinearGradient(0, y + h + 4, 0, y + h + 15); dg.addColorStop(0, 'rgba(46,36,26,0.30)'); dg.addColorStop(1, 'rgba(46,36,26,0)'); ga.fillStyle = dg;
  for (let i = 0; i < 3; i++) ga.fillRect(x + w * (0.1 + i * 0.3) + r(70 + i) * 4, y + h + 4, 2.5 + r(73 + i) * 3, 10 + r(76 + i) * 4);
  if (r(50) < 0.15 && x + w + 12 < x0 + 63) { const ax = x + w + 3, ay = y + h * 0.5; ga.fillStyle = 'rgb(214,214,210)'; ga.fillRect(ax, ay, 9, 6); ga.fillStyle = 'rgb(120,124,126)'; ga.fillRect(ax + 1, ay + 1.6, 7, 2.6); ga.fillStyle = 'rgba(0,0,0,0.3)'; ga.fillRect(ax, ay + 6, 9, 1); ga.fillStyle = 'rgba(60,50,40,0.25)'; ga.fillRect(ax + 3, ay + 7, 2, 8); }
  if (r(51) < 0.06) { ga.fillStyle = 'rgb(196,198,196)'; ga.beginPath(); ga.ellipse(x - 6, y + 5, 4, 3, -0.5, 0, 6.3); ga.fill(); ga.fillStyle = 'rgb(80,80,84)'; ga.fillRect(x - 6.5, y + 5, 1, 4); }
  if (r(52) < 0.14) { ga.fillStyle = `rgba(${r(53) < 0.5 ? '255,250,238' : '60,50,40'},${0.07 + r(54) * 0.08})`; ga.fillRect(x0 + 2 + r(55) * 8, y0 + 4 + r(56) * 20, 16 + r(57) * 26, 14 + r(58) * 22); }
  const sh = ga.createLinearGradient(0, y0, 0, y0 + 5); sh.addColorStop(0, 'rgba(0,0,0,0.13)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); ga.fillStyle = sh; ga.fillRect(x0, y0, 64, 5);   // floor-slab shadow
}

export function makeFacadeAtlases({ tex, canvas, paint, fbm, rnd, quality }) {
  const FS = quality.texSize >= 2048 ? 2048 : quality.texSize >= 1024 ? 1024 : 512, FE = Math.min(FS, 1024), C = 64, out = {};
  const grain = paint(256, 256, (u, v, x, y) => { const g = 128 + (rnd(x, y, 31) - 0.5) * 70; return [g, g, g]; });
  const atlas = (seed, baseFn, drawCell, repeat, key, orm0 = 'rgb(255,215,0)') => {
    const alb = canvas(FS, FS), em = canvas(FE, FE), orm = canvas(FE, FE), ga = alb.getContext('2d'), ge = em.getContext('2d'), go = orm.getContext('2d');
    ga.imageSmoothingQuality = 'high'; ga.drawImage(paint(512, 512, baseFn), 0, 0, FS, FS);
    if (FS > 512) { ga.save(); ga.globalCompositeOperation = 'overlay'; ga.globalAlpha = 0.45; ga.imageSmoothingEnabled = false; const n = FS / 256; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ga.drawImage(grain, i * 256, j * 256); ga.restore(); }
    go.fillStyle = orm0; go.fillRect(0, 0, FE, FE); ge.fillStyle = '#000'; ge.fillRect(0, 0, FE, FE);
    ga.save(); ga.scale(FS / 512, FS / 512); ge.save(); ge.scale(FE / 512, FE / 512); go.save(); go.scale(FE / 512, FE / 512);
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) drawCell({ ga, ge, go, x0: cx * C, y0: cy * C, cx, cy, r: k => rnd(cx, cy, seed + k) });
    ga.restore(); ge.restore(); go.restore();
    const A = tex(alb, { repeat, aniso: 16 }), E = tex(em, { repeat, aniso: 8 }), O = tex(orm, { srgb: false, repeat, aniso: 8 });
    out[key + 'Albedo'] = A; out[key + 'Emissive'] = E; out[key + 'ORM'] = O;
  };

  // panel blocks (Soviet-era apartments): paired window with transom, balcony slabs, plaster weathering
  atlas(0, (u, v, x, y) => { const n = fbm(u, v, 8, 4, 91), streak = fbm(u * 6, v * 0.8, 8, 3, 7); const g = 205 + n * 40 - streak * 38 + (rnd(x, y, 4) - 0.5) * 12; return [g, g * 0.995, g * 0.97]; },
    ({ ga, ge, go, x0, y0, cx, cy, r }) => {
      const W = { x: x0 + 15, y: y0 + 11, w: 34, h: 40 }, fc = FRAMES[Math.floor(r(80) * FRAMES.length)];
      extras(ga, x0, y0, W, r);
      ga.fillStyle = 'rgba(0,0,0,0.16)'; ga.fillRect(W.x - 4, W.y - 4, W.w + 8, W.h + 8);                                                     // ambient occlusion halo
      ga.fillStyle = rgb(fc); ga.fillRect(W.x - 2.5, W.y - 2.5, W.w + 5, W.h + 5);
      paintWindow(ga, ge, go, W, r); frameBars(ga, W, r, fc);
      ga.fillStyle = 'rgb(176,172,164)'; ga.fillRect(W.x - 5, W.y + W.h + 3, W.w + 10, 3.5); ga.fillStyle = 'rgba(255,255,255,0.4)'; ga.fillRect(W.x - 5, W.y + W.h + 3, W.w + 10, 1);
      if (r(31) < 0.28) {                                                                                                                    // balcony: slab, iron balusters, a plant
        ga.fillStyle = 'rgb(150,146,140)'; ga.fillRect(x0 + 6, y0 + 56, 52, 5); ga.fillStyle = 'rgb(92,90,88)'; ga.fillRect(x0 + 6, y0 + 61, 52, 2);
        ga.fillStyle = 'rgba(30,30,32,0.85)'; for (let i = 0; i < 24; i++) ga.fillRect(x0 + 7 + i * 2.1, y0 + 45, 0.9, 11); ga.fillRect(x0 + 6, y0 + 44, 52, 1.6);
        if (r(32) < 0.5) { ga.fillStyle = 'rgb(54,96,50)'; ga.beginPath(); ga.ellipse(x0 + 14 + r(33) * 30, y0 + 52, 5, 4, 0, 0, 6.3); ga.fill(); }
      }
    }, [1 / 28, 1 / 25.6], 'facade');

  // classical tuff: ashlar courses, pilasters, arched/rect windows with surrounds + keystones, belt course
  atlas(300, (u, v, x, y) => { const course = (y % 8) < 1 ? -22 : 0; const n = fbm(u, v, 8, 4, 33), st = fbm(u * 5, v * 0.7, 8, 3, 9); const g = 214 + n * 30 - st * 40 + course + (rnd(x, y, 6) - 0.5) * 14; return [g, g * 0.985, g * 0.96]; },
    ({ ga, ge, go, x0, y0, r }) => {
      ga.fillStyle = 'rgba(255,250,240,0.55)'; ga.fillRect(x0, y0, 7, 64); ga.fillRect(x0 + 57, y0, 7, 64);
      ga.fillStyle = 'rgba(0,0,0,0.18)'; ga.fillRect(x0 + 7, y0, 1.5, 64); ga.fillRect(x0 + 55.5, y0, 1.5, 64);
      const arch = r(1) < 0.55, W = { x: x0 + 19, y: y0 + 12, w: 26, h: 38, arch };
      extras(ga, x0, y0, { ...W, x: W.x - 1 }, r);
      ga.fillStyle = 'rgba(0,0,0,0.16)'; pathWin(ga, { ...W, x: W.x - 6, y: W.y - 6, w: W.w + 12, h: W.h + 10 }); ga.fill();
      ga.fillStyle = 'rgb(246,240,228)'; pathWin(ga, { ...W, x: W.x - 4, y: W.y - 4, w: W.w + 8, h: W.h + 8 }); ga.fill();                      // stone surround
      paintWindow(ga, ge, go, W, r, { top: 'rgb(98,118,146)' }); frameBars(ga, W, r, [232, 226, 214]);
      if (arch) { ga.fillStyle = 'rgb(222,214,198)'; ga.fillRect(W.x + W.w / 2 - 3, W.y - 8, 6, 7); ga.fillStyle = 'rgba(0,0,0,0.2)'; ga.fillRect(W.x + W.w / 2 - 3, W.y - 1.5, 6, 1.5); }
      ga.fillStyle = 'rgb(205,198,185)'; ga.fillRect(W.x - 6, W.y + W.h + 3, W.w + 12, 4); ga.fillStyle = 'rgba(0,0,0,0.25)'; ga.fillRect(W.x - 6, W.y + W.h + 7, W.w + 12, 1.5);
      ga.fillStyle = 'rgba(0,0,0,0.22)'; ga.fillRect(x0, y0 + 62, 64, 2); ga.fillStyle = 'rgba(255,255,255,0.35)'; ga.fillRect(x0, y0 + 60, 64, 2);
      if (r(2) < 0.22) { ga.fillStyle = 'rgb(40,38,40)'; ga.fillRect(W.x - 4, W.y + W.h - 6, W.w + 8, 2); for (let i = 0; i < 7; i++) ga.fillRect(W.x - 3 + i * 4.2, W.y + W.h - 13, 1, 8); }
    }, [1 / 32, 1 / 30.4], 'tuff');

  // modern curtain wall: tinted panes with blinds, mullions, spandrels, lit office floors
  atlas(400, (u, v, x, y) => { const g = 120 + fbm(u, v, 6, 3, 5) * 26; return [g * 0.8, g * 0.92, g * 1.1]; },
    ({ ga, ge, go, x0, y0, cy, r }) => {
      ga.fillStyle = 'rgb(70,86,112)'; ga.fillRect(x0, y0, 64, 64);
      const W = { x: x0 + 2, y: y0 + 2, w: 60, h: 46 }, rowLit = rnd(0, cy, 411) < 0.33;
      paintWindow(ga, ge, go, W, r, { top: 'rgb(120,148,182)', lit: 0 });
      ga.fillStyle = 'rgba(120,160,200,0.18)'; ga.fillRect(W.x, W.y, W.w, W.h);                                                              // glass tint
      ga.fillStyle = 'rgb(176,182,190)'; ga.fillRect(x0 + 62, y0, 2, 64); ga.fillRect(x0, y0, 2, 64); ga.fillRect(x0, y0 + 48, 64, 16);
      ga.fillStyle = 'rgba(0,0,0,0.25)'; ga.fillRect(x0, y0 + 48, 64, 1.4); ga.fillStyle = 'rgba(255,255,255,0.25)'; ga.fillRect(x0 + 2, y0 + 2, 1, 46);
      if (rowLit && r(3) < 0.8) { ge.fillStyle = r(4) < 0.8 ? '#cfe2ff' : '#ffe2b8'; ge.globalAlpha = 0.45 + r(5) * 0.5; ge.fillRect(W.x, W.y, W.w, W.h); ge.globalAlpha = 1; }
    }, [1 / 24, 1 / 28.8], 'modern', 'rgb(255,215,0)');

  // small houses: plaster, painted shutters, tiled sill, flower box
  atlas(500, (u, v, x, y) => { const n = fbm(u, v, 10, 4, 71), st = fbm(u * 4, v, 8, 3, 2); const g = 200 + n * 36 - st * 48 + (rnd(x, y, 3) - 0.5) * 16; return [g, g * 0.98, g * 0.94]; },
    ({ ga, ge, go, x0, y0, r }) => {
      const W = { x: x0 + 22, y: y0 + 16, w: 20, h: 28 }, shut = ['#5b7b4a', '#7a4a3a', '#3f5f86', '#8a8a8a', '#a07a3a'][Math.floor(r(1) * 5)];
      extras(ga, x0, y0, W, r);
      ga.fillStyle = 'rgba(0,0,0,0.16)'; ga.fillRect(W.x - 5, W.y - 5, W.w + 10, W.h + 10);
      ga.fillStyle = 'rgb(236,230,218)'; ga.fillRect(W.x - 3, W.y - 3, W.w + 6, W.h + 6);
      paintWindow(ga, ge, go, W, r); frameBars(ga, W, r, [226, 220, 208]);
      if (r(2) < 0.6) { ga.fillStyle = shut; ga.fillRect(W.x - 9, W.y - 2, 8, W.h + 4); ga.fillRect(W.x + W.w + 1, W.y - 2, 8, W.h + 4); ga.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < 9; i++) { ga.fillRect(W.x - 9, W.y - 1 + i * 3.4, 8, 0.7); ga.fillRect(W.x + W.w + 1, W.y - 1 + i * 3.4, 8, 0.7); } }
      ga.fillStyle = 'rgb(160,156,148)'; ga.fillRect(W.x - 5, W.y + W.h + 3, W.w + 10, 3);
      if (r(3) < 0.3) { ga.fillStyle = 'rgb(110,70,48)'; ga.fillRect(W.x - 3, W.y + W.h + 6, W.w + 6, 4); ga.fillStyle = r(4) < 0.5 ? 'rgb(190,60,70)' : 'rgb(230,200,70)'; for (let i = 0; i < 6; i++) ga.fillRect(W.x - 2 + i * 4, W.y + W.h + 4, 3, 3); }
    }, [1 / 25.6, 1 / 24], 'house');
  return out;
}
