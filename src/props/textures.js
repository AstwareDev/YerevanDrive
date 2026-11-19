// Procedural canvas textures for the props plug-in (leaves, signs, ads, flags, awnings, flowers).
import * as THREE from 'three';
import { canvas, canvasTex, mkRng } from './util.js';

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = '"Segoe UI","Noto Sans Armenian","Sylfaen","Arial",sans-serif';

// ---------------------------------------------------------------- leaves
function leafPath(ctx, kind, s) {
  ctx.beginPath();
  if (kind === 'lobed') { // palmate (plane / maple) leaf
    const N = 40; for (let i = 0; i <= N; i++) { const th = i / N * Math.PI * 2, c = Math.pow(Math.abs(Math.cos(th * 2.5)), 0.8), r = s * (0.38 + 0.62 * c); const x = Math.sin(th) * r, y = -Math.cos(th) * r * 0.95; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  } else if (kind === 'heart') { // linden / mulberry
    ctx.moveTo(0, s * 0.95); ctx.bezierCurveTo(s * 0.9, s * 0.45, s * 0.75, -s * 0.5, 0, -s); ctx.bezierCurveTo(-s * 0.75, -s * 0.5, -s * 0.9, s * 0.45, 0, s * 0.95);
  } else { // pointed oval
    ctx.moveTo(0, s); ctx.quadraticCurveTo(s * 0.62, s * 0.2, 0, -s); ctx.quadraticCurveTo(-s * 0.62, s * 0.2, 0, s);
  }
  ctx.closePath();
}
/** transparent RGBA cluster-of-leaves texture. kind: 'lobed' | 'heart' | 'oval' | 'conifer' */
export function leafTexture(kind, seed = 1, hue = [92, 118]) {
  const S = 512, [c, ctx] = canvas(S, S), rng = mkRng(seed);
  ctx.clearRect(0, 0, S, S);
  const inside = (x, y) => { const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.hypot(dx, dy); return r < 0.93 - rng() * 0.22; };
  if (kind === 'conifer') {
    // feathery twigs radiating from the centre, dense needles
    for (let layer = 0; layer < 3; layer++) {
      const n = 26 - layer * 6;
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2, len = S * (0.18 + rng() * 0.3), r0 = rng() * 40;
        const x0 = S / 2 + Math.cos(ang) * r0, y0 = S / 2 + Math.sin(ang) * r0, x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
        ctx.strokeStyle = hsl(hue[0] + rng() * 10, 32 + rng() * 14, 14 + layer * 8 + rng() * 8); ctx.lineWidth = 3.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        const m = Math.floor(len / 5);
        for (let k = 1; k < m; k++) { const t = k / m, bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t, nl = (1 - t * 0.6) * (14 + rng() * 12); for (const sd of [-1, 1]) { const a2 = ang + sd * (1.1 + rng() * 0.35); ctx.lineWidth = 2.2; ctx.strokeStyle = hsl(hue[0] + rng() * 14, 34 + rng() * 14, 18 + layer * 9 + rng() * 10); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a2) * nl, by + Math.sin(a2) * nl); ctx.stroke(); } }
      }
    }
  } else {
    const size = kind === 'lobed' ? [26, 46] : kind === 'heart' ? [22, 38] : [16, 30];
    for (let layer = 0; layer < 4; layer++) {
      const count = [150, 150, 130, 90][layer];
      for (let i = 0; i < count; i++) {
        let x, y, tries = 0; do { x = rng() * S; y = rng() * S; tries++; } while (!inside(x, y) && tries < 20); if (tries >= 20) continue;
        const s = size[0] + rng() * (size[1] - size[0]), rot = rng() * Math.PI * 2;
        const light = [17, 25, 33, 42][layer] + rng() * 9, h = hue[0] + rng() * (hue[1] - hue[0]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        const g = ctx.createLinearGradient(0, s, 0, -s); g.addColorStop(0, hsl(h - 4, 42, light * 0.75)); g.addColorStop(1, hsl(h + 6, 52, light * 1.15));
        ctx.fillStyle = g; leafPath(ctx, kind, s); ctx.fill();
        ctx.strokeStyle = hsl(h, 30, light * 0.55, 0.9); ctx.lineWidth = 1.1; ctx.stroke();
        if (layer > 0) { ctx.strokeStyle = hsl(h + 8, 40, Math.min(60, light * 1.6), 0.55); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, s * 0.9); ctx.lineTo(0, -s * 0.6); ctx.stroke(); }
        ctx.restore();
      }
    }
  }
  ctx.fillStyle = '#bdb6a8'; ctx.fillRect(0, S - 30, 30, 30); // opaque bark swatch in the bottom-left corner (uv 0..0.055): trunks / cores sample it so one material draws leaves + wood
  const t = canvasTex(c, { aniso: 4 }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// ---------------------------------------------------------------- road sign atlas (4x4 tiles of 256)
export function signAtlas() {
  const T = 256, [c, ctx] = canvas(T * 4, T * 4); ctx.clearRect(0, 0, T * 4, T * 4);
  const tile = (i, fn) => { ctx.save(); ctx.translate((i % 4) * T, Math.floor(i / 4) * T); ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip(); fn(); ctx.restore(); };
  const RED = '#d4141c', BLUE = '#0a4ea8', W = '#f4f4f0', YEL = '#f2c40f';
  const text = (s, x, y, px, col = '#111', w = 'bold') => { ctx.fillStyle = col; ctx.font = `${w} ${px}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); };
  const poly = (pts, fill, stroke, lw) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); } };
  const circle = (x, y, r, fill, stroke, lw) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
  const rrect = (x, y, w, h, r, fill, stroke, lw) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
  const arrow = (x, y, len, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - len / 2, y - 14); ctx.lineTo(x + len / 6, y - 14); ctx.lineTo(x + len / 6, y - 40); ctx.lineTo(x + len / 2, y); ctx.lineTo(x + len / 6, y + 40); ctx.lineTo(x + len / 6, y + 14); ctx.lineTo(x - len / 2, y + 14); ctx.closePath(); ctx.fill(); };
  tile(0, () => { const r = 118, cx = 128, cy = 128, p = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } poly(p, RED, W, 10); text('STOP', 128, 130, 62, W); });
  tile(1, () => { poly([[16, 28], [240, 28], [128, 232]], W, RED, 0); poly([[16, 28], [240, 28], [128, 232]], null, RED, 26); poly([[44, 44], [212, 44], [128, 196]], W, null, 0); });
  tile(2, () => { rrect(8, 8, 240, 240, 22, BLUE, W, 6); arrow(128, 128, 150, W); });
  tile(3, () => { rrect(8, 8, 240, 240, 22, BLUE, W, 6); text('P', 128, 134, 190, W); });
  const speed = n => () => { circle(128, 128, 118, W, RED, 22); text(String(n), 128, 134, n >= 100 ? 70 : 100, '#111'); };
  tile(4, speed(40)); tile(5, speed(60));
  tile(6, () => { rrect(8, 8, 240, 240, 22, BLUE, W, 6); poly([[128, 30], [222, 200], [34, 200]], W, '#111', 8); circle(128, 112, 12, '#111'); ctx.strokeStyle = '#111'; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(128, 126); ctx.lineTo(120, 160); ctx.lineTo(104, 186); ctx.moveTo(122, 150); ctx.lineTo(146, 164); ctx.lineTo(152, 184); ctx.moveTo(126, 134); ctx.lineTo(148, 142); ctx.stroke(); ctx.fillStyle = '#111'; for (let k = 0; k < 4; k++) ctx.fillRect(66 + k * 32, 188, 18, 8); });
  tile(7, () => { circle(128, 128, 118, RED, W, 8); rrect(48, 108, 160, 40, 4, W); });
  tile(8, () => { circle(128, 128, 118, BLUE, RED, 22); ctx.strokeStyle = RED; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(52, 204); ctx.lineTo(204, 52); ctx.stroke(); });
  tile(9, () => { poly([[128, 6], [250, 128], [128, 250], [6, 128]], W, '#222', 6); poly([[128, 34], [222, 128], [128, 222], [34, 128]], YEL, null, 0); });
  tile(10, speed(30));
  tile(11, () => { circle(128, 128, 118, BLUE, W, 8); ctx.strokeStyle = W; ctx.lineWidth = 16; ctx.lineCap = 'round'; for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 - Math.PI / 2; ctx.beginPath(); ctx.arc(128, 128, 56, a, a + 1.5); ctx.stroke(); } });
  tile(12, () => { rrect(8, 8, 240, 240, 22, BLUE, W, 6); text('BUS', 128, 90, 80, W); rrect(60, 130, 136, 80, 12, W); circle(92, 206, 14, '#111'); circle(164, 206, 14, '#111'); });
  tile(13, () => { rrect(8, 8, 240, 240, 22, W, '#333', 6); text('40', 128, 108, 110, '#111'); text('km/h', 128, 200, 52, '#111', '600'); });
  tile(14, () => { rrect(8, 8, 240, 240, 22, YEL, '#222', 8); poly([[128, 40], [212, 190], [44, 190]], null, '#111', 14); text('!', 128, 138, 90, '#111'); });
  tile(15, () => { ctx.fillStyle = '#7d8086'; ctx.fillRect(0, 0, T, T); });
  return canvasTex(c, { aniso: 8 });
}
export function namePlateAtlas(names) {
  const TW = 512, TH = 128, [c, ctx] = canvas(TW * 2, TH * 8);
  for (let i = 0; i < 16; i++) {
    const x = (i % 2) * TW, y = Math.floor(i / 2) * TH, n = (names[i] ?? '').replace(/\b(street|avenue)\b/i, m => /str/i.test(m) ? 'St' : 'Ave').toUpperCase();
    ctx.fillStyle = '#0b3f8c'; ctx.beginPath(); ctx.roundRect(x + 3, y + 3, TW - 6, TH - 6, 12); ctx.fill(); ctx.strokeStyle = '#eef'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#f6f6f2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; let px = 54; ctx.font = `bold ${px}px ${FONT}`; while (ctx.measureText(n).width > TW - 40 && px > 20) { px -= 2; ctx.font = `bold ${px}px ${FONT}`; } ctx.fillText(n, x + TW / 2, y + TH / 2 + 4);
  }
  return canvasTex(c, { aniso: 8 });
}

// ---------------------------------------------------------------- ad / brand / shop atlases (emissive)
function glowText(ctx, s, x, y, px, col, glow = 18) {
  ctx.font = `bold ${px}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = col; ctx.shadowBlur = glow; ctx.fillStyle = col; ctx.fillText(s, x, y); ctx.fillText(s, x, y); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.85; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
}
export function adAtlas() { // 3x2 tiles of 256x384 (bus-stop light boxes)
  const TW = 256, TH = 384, [c, ctx] = canvas(TW * 3, TH * 2), rng = mkRng(11);
  const sets = [['#ff2d8f', '#5a1fd0', 'NEW', 'COLLECTION'], ['#27d3ff', '#0a2a8a', 'JAZZ', 'LIVE · FRI'], ['#ffb02e', '#c2260c', 'FRESH', 'COFFEE'], ['#6dff8a', '#0b6b5b', 'TECH', 'WEEK 2026'], ['#ff5a3c', '#7a0f2a', 'SUMMER', 'SALE -50%'], ['#fff3c0', '#2d5be3', 'ԵՐԵՎԱՆ', 'YEREVAN']];
  sets.forEach(([a, b, t1, t2], i) => {
    const x = (i % 3) * TW, y = Math.floor(i / 3) * TH; const g = ctx.createLinearGradient(x, y, x + TW, y + TH); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(x, y, TW, TH);
    ctx.globalAlpha = 0.25; for (let k = 0; k < 7; k++) { ctx.fillStyle = k % 2 ? '#fff' : '#000'; ctx.beginPath(); ctx.arc(x + rng() * TW, y + rng() * TH, 30 + rng() * 90, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, TW, TH); ctx.clip(); ctx.translate(x, y); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 54px ${FONT}`; ctx.shadowColor = '#000'; ctx.shadowBlur = 12; ctx.fillText(t1, TW / 2, TH * 0.4); ctx.font = `700 28px ${FONT}`; ctx.fillText(t2, TW / 2, TH * 0.4 + 52); ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(x + 8, y + 8, TW - 16, TH - 16);
  });
  return canvasTex(c, { aniso: 8 });
}
export function brandAtlas() { // 2 cols x 6 rows of 512x128 neon rooftop / wall signs
  const TW = 512, TH = 128, [c, ctx] = canvas(TW * 2, TH * 6);
  const items = [['YEREVAN', '#ff3fa6'], ['ՀԱՅԱՍՏԱՆ', '#27d3ff'], ['HOTEL', '#ffb02e'], ['BANK', '#6dff8a'], ['ԴԵՂԱՏՈՒՆ ✚', '#5dff7a'], ['CINEMA', '#ff5a3c'], ['ԿԱՖԵ · CAFÉ', '#ffd34a'], ['ARARAT', '#ff3a3a'], ['SUPERMARKET', '#4aa0ff'], ['BAR & GRILL', '#ff3fa6'], ['ELECTRONICS', '#27d3ff'], ['ԼԱՀՄԱՋՈ', '#ffb02e']];
  items.forEach(([t, col], i) => {
    const x = (i % 2) * TW, y = Math.floor(i / 2) * TH; ctx.fillStyle = '#0a0812'; ctx.fillRect(x, y, TW, TH);
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.strokeRect(x + 7, y + 7, TW - 14, TH - 14); ctx.shadowBlur = 0;
    let px = 76; ctx.font = `bold ${px}px ${FONT}`; while (ctx.measureText(t).width > TW - 60 && px > 24) { px -= 3; ctx.font = `bold ${px}px ${FONT}`; }
    glowText(ctx, t, x + TW / 2, y + TH / 2 + 3, px, col, 22);
  });
  return canvasTex(c, { aniso: 8 });
}
export function bladeAtlas() { // 4x4 tiles of 256x512 (portrait projecting shop signs)
  const TW = 256, TH = 512, [c, ctx] = canvas(TW * 4, TH * 4), rng = mkRng(5);
  const items = ['CAFE', 'BAR', 'ԴԵՂԱՏՈՒՆ', 'HOTEL', 'SUSHI', 'PIZZA', 'BOOKS', 'MARKET', 'ՀԱՑ', 'FLOWERS', 'SHOES', 'LOUNGE', 'NAILS', 'COFFEE', 'WINE', 'KEBAB'];
  const cols = ['#ff3fa6', '#27d3ff', '#5dff7a', '#ffb02e', '#ff5a3c', '#b36bff', '#fff0b0', '#ff8a2a'];
  items.forEach((t, i) => {
    const x = (i % 4) * TW, y = Math.floor(i / 4) * TH, col = cols[(i * 3 + 1) % cols.length];
    const g = ctx.createLinearGradient(x, y, x, y + TH); g.addColorStop(0, '#15101f'); g.addColorStop(1, '#0a0812'); ctx.fillStyle = g; ctx.fillRect(x, y, TW, TH);
    ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.strokeRect(x + 10, y + 10, TW - 20, TH - 20); ctx.shadowBlur = 0;
    ctx.save(); ctx.translate(x + TW / 2, y + TH / 2); ctx.rotate(-Math.PI / 2); let px = 130; ctx.font = `bold ${px}px ${FONT}`; while (ctx.measureText(t).width > TH - 90 && px > 26) { px -= 4; ctx.font = `bold ${px}px ${FONT}`; } glowText(ctx, t, 0, 4, px, col, 26); ctx.restore();
  });
  return canvasTex(c, { aniso: 8 });
}

// ---------------------------------------------------------------- flag, awning, flower bed
export function flagTexture() {
  const [c, ctx] = canvas(192, 128); const cols = ['#d90012', '#0033a0', '#f2a800']; cols.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, i * 128 / 3, 192, 128 / 3 + 1); });
  return canvasTex(c, { aniso: 4 });
}
export function awningTexture() {
  const [c, ctx] = canvas(256, 64); for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#2a2a2a' : '#ffffff'; ctx.fillRect(i * 32, 0, 32, 64); }
  const g = ctx.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 64);
  return canvasTex(c, { aniso: 4 });
}
export function flowerTexture() { // 2x2 palettes, each 128px of dense blossoms over foliage
  const S = 128, [c, ctx] = canvas(S * 2, S * 2), rng = mkRng(21);
  const pals = [['#e8264a', '#ff7b9c', '#ffd84a'], ['#ffe14a', '#ff9a1f', '#ff5a2a'], ['#f4f0ff', '#c59bff', '#ff7ad9'], ['#ff4fa0', '#ffffff', '#b32cff']];
  pals.forEach((pal, i) => {
    const x0 = (i % 2) * S, y0 = Math.floor(i / 2) * S; ctx.fillStyle = '#1d3a14'; ctx.fillRect(x0, y0, S, S);
    for (let k = 0; k < 90; k++) { ctx.fillStyle = `hsl(${100 + rng() * 30},45%,${14 + rng() * 14}%)`; ctx.beginPath(); ctx.arc(x0 + rng() * S, y0 + rng() * S, 6 + rng() * 8, 0, 7); ctx.fill(); }
    for (let k = 0; k < 220; k++) { ctx.fillStyle = pal[Math.floor(rng() * pal.length)]; ctx.beginPath(); ctx.arc(x0 + rng() * S, y0 + rng() * S, 2.2 + rng() * 3, 0, 7); ctx.fill(); }
  });
  return canvasTex(c, { aniso: 4 });
}

// ---------------------------------------------------------------- licence plates (Armenian style: white, blue EU-like strip with AM, "12 AB 345")
export function plateAtlas() { // 2 cols x 8 rows of 512x128 -> 1024x1024
  const TW = 512, TH = 128, [c, ctx] = canvas(TW * 2, TH * 8), rng = mkRng(77);
  const letters = 'ABCDEFGHKLMNOPRSTUVXYZ';
  for (let i = 0; i < 16; i++) {
    const x = (i % 2) * TW, y = Math.floor(i / 2) * TH;
    const txt = String(Math.floor(rng() * 99)).padStart(2, '0') + ' ' + letters[Math.floor(rng() * letters.length)] + letters[Math.floor(rng() * letters.length)] + ' ' + String(Math.floor(rng() * 999)).padStart(3, '0');
    ctx.fillStyle = '#cfcfc8'; ctx.fillRect(x, y, TW, TH);
    ctx.fillStyle = '#f2f2ec'; ctx.beginPath(); ctx.roundRect(x + 5, y + 6, TW - 10, TH - 12, 10); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#1b3f9a'; ctx.beginPath(); ctx.roundRect(x + 5, y + 6, 62, TH - 12, [10, 0, 0, 10]); ctx.fill();
    ctx.fillStyle = '#ffd400'; for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; ctx.beginPath(); ctx.arc(x + 36 + Math.cos(a) * 15, y + 40 + Math.sin(a) * 15, 2.2, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('AM', x + 36, y + 96);
    ctx.fillStyle = '#0c0c0c'; ctx.font = 'bold 84px "Arial Narrow","Arial",sans-serif'; ctx.fillText(txt, x + 66 + (TW - 76) / 2, y + TH / 2 + 4);
  }
  const t = canvasTex(c, { aniso: 8 }); return t;
}
