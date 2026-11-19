// Canvas-generated textures for the drift-circuit dressing (no external assets, no real trademarks).
import * as THREE from 'three';
import { canvas, canvasTexture, mkRng, noiseFill } from './util.js';

const FONT = '"Segoe UI", "Noto Sans Armenian", "Sylfaen", Arial, sans-serif';

/** tyre: u = around, v = profile (0..1). Sidewall 0-0.37, tread 0.37-0.63 (grooves), sidewall 0.63-1. Grey rubber, tinted per instance. */
export function tyreTexture(aniso) {
  const w = 128, h = 128, c = canvas(w, h), g = c.getContext('2d'), rng = mkRng(11);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
  noiseFill(g, w, h, 40, rng);
  // sidewall ribs + lettering band
  g.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 6; i++) { g.fillRect(0, 6 + i * 3, w, 1); g.fillRect(0, h - 6 - i * 3, w, 1); }
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(8, 24, 38, 5); g.fillRect(70, 24, 26, 5); g.fillRect(14, h - 28, 30, 5);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(100, 36, 5, 0, 6.3); g.fill();
  // tread: blocks with grooves
  const y0 = Math.round(h * 0.37), y1 = Math.round(h * 0.63);
  g.fillStyle = '#6a6a6a'; g.fillRect(0, y0, w, y1 - y0);
  g.fillStyle = '#2a2a2a'; for (let x = 0; x < w; x += 8) { g.fillRect(x, y0 + 1, 2.5, y1 - y0 - 2); }
  g.fillRect(0, (y0 + y1) / 2 - 1, w, 2.5);
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let x = 4; x < w; x += 8) g.fillRect(x, y0 + 2, 1, y1 - y0 - 4);
  return canvasTexture(c, { aniso, repeat: [1, 1] });
}

/** red/white kerb stripes: v = along track, period 1 (one red + one white block). u across with a dark rubbed edge. */
export function rumbleTexture(aniso) {
  const w = 64, h = 128, c = canvas(w, h), g = c.getContext('2d'), rng = mkRng(5);
  g.fillStyle = '#c4161c'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#e9e9e4'; g.fillRect(0, h / 2, w, h / 2);
  noiseFill(g, w, h, 34, rng);
  const grad = g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, 'rgba(0,0,0,0.0)'); grad.addColorStop(0.85, 'rgba(0,0,0,0.0)'); grad.addColorStop(1, 'rgba(30,25,20,0.35)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(40,30,20,0.18)'; for (let i = 0; i < 40; i++) g.fillRect(rng() * w, rng() * h, 2 + rng() * 6, 1 + rng() * 2);
  return canvasTexture(c, { aniso, repeat: [1, 1] });
}

/** jersey barrier: u along (repeat per 3 m), v 0 (base) -> 1 (top). Concrete + red/white reflective band + reflector tiles. returns { map, emissive } */
export function barrierTexture(aniso) {
  const w = 256, h = 128, c = canvas(w, h), g = c.getContext('2d'), rng = mkRng(21), e = canvas(w, h), ge = e.getContext('2d');
  g.fillStyle = '#9b9b95'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 44, rng);
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(40,35,30,' + (0.05 + rng() * 0.1) + ')'; g.fillRect(rng() * w, rng() * h, 10 + rng() * 40, 2 + rng() * 5); }
  g.fillStyle = 'rgba(30,26,22,0.3)'; g.fillRect(0, 0, w, 10);      // dirty base
  ge.fillStyle = '#000'; ge.fillRect(0, 0, w, h);
  // hazard band near the top (v 0.62-0.86 => canvas y 18-48 because canvas y grows downwards, v up)
  const by0 = Math.round(h * (1 - 0.88)), by1 = Math.round(h * (1 - 0.58));
  g.save(); g.beginPath(); g.rect(0, by0, w, by1 - by0); g.clip();
  for (let i = -8; i < 16; i++) { g.fillStyle = i % 2 ? '#d41920' : '#efefea'; g.beginPath(); const x = i * 24; g.moveTo(x, by1); g.lineTo(x + 24, by1); g.lineTo(x + 24 + 24, by0); g.lineTo(x + 24, by0); g.closePath(); g.fill(); }
  g.restore();
  ge.save(); ge.beginPath(); ge.rect(0, by0, w, by1 - by0); ge.clip();
  for (let i = -8; i < 16; i++) { ge.fillStyle = i % 2 ? '#702020' : '#7a7a7a'; ge.beginPath(); const x = i * 24; ge.moveTo(x, by1); ge.lineTo(x + 24, by1); ge.lineTo(x + 48, by0); ge.lineTo(x + 24, by0); ge.closePath(); ge.fill(); }
  ge.restore();
  g.fillStyle = '#ffb000'; g.fillRect(100, by1 + 8, 56, 10); ge.fillStyle = '#9a7000'; ge.fillRect(100, by1 + 8, 56, 10);
  g.fillStyle = '#111'; g.fillRect(0, by0 - 1, w, 2); g.fillRect(0, by1, w, 2);
  return { map: canvasTexture(c, { aniso }), emissive: canvasTexture(e, { aniso }) };
}

/** sponsor / banner atlas: 2 columns x 8 rows of 512x128 panels. returns { map, cols, rows, count, names } */
const SPONSORS = [
  ['ARARAT OIL', '#0b3d91', '#ffd100', 'circle'], ['ԵՐԵՎԱՆ ԴՐԻՖԹ', '#111111', '#ff3b1f', 'chev'], ['KOMITAS TYRES', '#d4171e', '#ffffff', 'stripe'], ['ՍԵՎԱՆ ՋԵՐՄ', '#0e8f6e', '#ffffff', 'wave'],
  ['NAIRI MOTORS', '#ffffff', '#c1121f', 'circle'], ['0-100  ARMENIA', '#ff7a00', '#101010', 'chev'], ['LUSINE LUBE', '#5b1b8f', '#ffe14d', 'stripe'], ['ԿԱՍԿԱԴ ԿՈԼԱ', '#c1121f', '#ffffff', 'wave'],
  ['TUFF GRIP', '#101010', '#f2f2f2', 'stripe'], ['APRICOT RACING', '#ff9e1b', '#1b1b1b', 'circle'], ['DUDUK AUDIO', '#2b2b2b', '#58d3ff', 'wave'], ['ՎԱՐԴԱՆ ԱՐԳԵԼԱԿՆԵՐ', '#1c6dd0', '#ffffff', 'chev'],
  ['SASSOUN FUEL', '#e8e8e0', '#0a5b3a', 'circle'], ['ARMENIA DRIFT SERIES', '#0033a0', '#d90012', 'stripe'], ['ՀԱՆՐԱՊԵՏՈՒԹՅԱՆ ՀՐԱՊԱՐԱԿ', '#f2a900', '#0033a0', 'chev'], ['MASIS PARTS', '#00a19a', '#ffffff', 'wave'],
];
export function bannerAtlas(aniso) {
  const cols = 2, rows = 8, tw = 512, th = 128, c = canvas(cols * tw, rows * th), g = c.getContext('2d'), rng = mkRng(3);
  SPONSORS.forEach(([text, bg, fg, deco], i) => {
    const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, tw, th); g.clip();
    g.fillStyle = bg; g.fillRect(0, 0, tw, th);
    g.fillStyle = fg; g.globalAlpha = 0.9;
    if (deco === 'circle') { g.beginPath(); g.arc(70, th / 2, 40, 0, 6.3); g.fill(); g.globalAlpha = 1; g.fillStyle = bg; g.beginPath(); g.arc(70, th / 2, 24, 0, 6.3); g.fill(); g.fillStyle = fg; g.beginPath(); g.arc(70, th / 2, 11, 0, 6.3); g.fill(); }
    else if (deco === 'chev') { for (let k = 0; k < 3; k++) { g.beginPath(); const o = 20 + k * 22; g.moveTo(o, 20); g.lineTo(o + 22, th / 2); g.lineTo(o, th - 20); g.lineTo(o + 10, th - 20); g.lineTo(o + 32, th / 2); g.lineTo(o + 10, 20); g.closePath(); g.fill(); } }
    else if (deco === 'stripe') { g.fillRect(0, 10, tw, 8); g.fillRect(0, th - 18, tw, 8); }
    else { g.lineWidth = 8; g.strokeStyle = fg; g.beginPath(); for (let k = 0; k <= 60; k++) { const px = k * 9; const py = th - 18 + Math.sin(k * 0.6) * 6; if (k) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
    let fs = 64; g.font = `800 ${fs}px ${FONT}`; const maxW = tw - 160; while (g.measureText(text).width > maxW && fs > 20) { fs -= 3; g.font = `800 ${fs}px ${FONT}`; }
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 4; g.fillText(text, deco === 'stripe' ? tw / 2 : tw / 2 + 40, th / 2 + 2);
    g.restore();
  });
  noiseFill(g, cols * tw, rows * th, 14, rng);
  return { map: canvasTexture(c, { aniso, wrap: false }), cols, rows, count: SPONSORS.length, names: SPONSORS.map(s => s[0]) };
}

/** Start/finish gantry banner (1024x128): checker ends, big title in two scripts */
export function gantryTexture(aniso, title, subtitle) {
  const w = 1024, h = 160, c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#0d0d10'; g.fillRect(0, 0, w, h);
  const sq = 20;
  for (let y = 0; y < h; y += sq) for (let x = 0; x < 150; x += sq) { g.fillStyle = ((x / sq + y / sq) & 1) ? '#f4f4f0' : '#111'; g.fillRect(x, y, sq, sq); g.fillRect(w - 150 + x, y, sq, sq); g.fillStyle = (((x / sq + y / sq) & 1)) ? '#111' : '#f4f4f0'; g.fillRect(w - 150 + x, y, sq, sq); }
  g.fillStyle = '#ffd100'; g.fillRect(150, 0, w - 300, 8); g.fillRect(150, h - 8, w - 300, 8);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
  g.font = `900 78px ${FONT}`; g.fillText(title, w / 2, h * 0.40);
  g.fillStyle = '#ffd100'; g.font = `700 40px ${FONT}`; g.fillText(subtitle, w / 2, h * 0.79);
  return canvasTexture(c, { aniso, wrap: false });
}

/** chequered flag / road paint atlas for decals (256x256 each quadrant): [0] checker line, [1] grid slot, [2] arrow, [3] solid line segment */
export function paintAtlas(aniso) {
  const s = 256, c = canvas(s * 2, s * 2), g = c.getContext('2d'), rng = mkRng(8);
  g.clearRect(0, 0, s * 2, s * 2);
  // [0] checker line: 2 rows x 16 squares (u across the road, v along)
  { const sq = s / 16; for (let r = 0; r < 4; r++) for (let k = 0; k < 16; k++) { g.fillStyle = ((r + k) & 1) ? '#f5f5f0' : '#151515'; g.fillRect(k * sq, r * sq, sq + 0.5, sq + 0.5); } g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 4 * sq, s, 2); }
  // [1] grid slot: white U-shape bracket + number box
  { const ox = s, oy = 0; g.strokeStyle = '#f2f2ee'; g.lineWidth = 12; g.lineJoin = 'miter'; g.beginPath(); g.moveTo(ox + 38, oy + 40); g.lineTo(ox + 38, oy + 216); g.lineTo(ox + 218, oy + 216); g.lineTo(ox + 218, oy + 40); g.stroke(); g.fillStyle = '#f2f2ee'; g.fillRect(ox + 38, oy + 36, 36, 12); g.fillRect(ox + 182, oy + 36, 36, 12); }
  // [2] arrow
  { const ox = 0, oy = s; g.fillStyle = '#f2f2ee'; g.beginPath(); g.moveTo(ox + 128, oy + 20); g.lineTo(ox + 200, oy + 120); g.lineTo(ox + 154, oy + 120); g.lineTo(ox + 154, oy + 236); g.lineTo(ox + 102, oy + 236); g.lineTo(ox + 102, oy + 120); g.lineTo(ox + 56, oy + 120); g.closePath(); g.fill(); }
  // [3] solid line
  { const ox = s, oy = s; g.fillStyle = '#f2f2ee'; g.fillRect(ox + 100, oy, 56, s); g.fillStyle = '#e8b800'; g.fillRect(ox + 20, oy, 14, s); }
  // wear
  const im = g.getImageData(0, 0, s * 2, s * 2), d = im.data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { const n = (rng() - 0.5) * 50; d[i] += n; d[i + 1] += n; d[i + 2] += n; d[i + 3] = Math.max(0, d[i + 3] - rng() * 60); } g.putImageData(im, 0, 0);
  return canvasTexture(c, { aniso, wrap: false });
}

/** dark skid tracks: u across (0..1) -> alpha profile, v along: breaks + wobble. */
export function skidTexture(aniso) {
  const w = 64, h = 256, c = canvas(w, h), g = c.getContext('2d'), rng = mkRng(31);
  const im = g.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) {
    const along = 0.55 + 0.45 * Math.sin(y * 0.09 + Math.sin(y * 0.021) * 3) * Math.sin(y * 0.031 + 1.2); // streaky strength
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, edge = Math.sin(u * Math.PI), prof = Math.pow(edge, 0.7);
      const grain = 0.65 + 0.35 * rng();
      let a = prof * along * grain; if (rng() < 0.04) a *= 0.2;
      const i = (y * w + x) * 4; d[i] = 14; d[i + 1] = 12; d[i + 2] = 12; d[i + 3] = Math.max(0, Math.min(255, a * 190));
    }
  }
  g.putImageData(im, 0, 0);
  return canvasTexture(c, { aniso });
}

/** oil stain atlas: 2x2 blobs, alpha only (dark, slightly glossy look is done by the material) */
export function oilTexture(aniso) {
  const s = 128, c = canvas(s * 2, s * 2), g = c.getContext('2d'), rng = mkRng(41);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * s, oy = Math.floor(q / 2) * s;
    for (let k = 0; k < 14; k++) { const a = rng() * 6.28, r = rng() * s * 0.22, x = ox + s / 2 + Math.cos(a) * r, y = oy + s / 2 + Math.sin(a) * r, rr = s * (0.1 + rng() * 0.2); const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(10,8,6,0.55)'); gr.addColorStop(0.7, 'rgba(10,8,6,0.25)'); gr.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  }
  return canvasTexture(c, { aniso, wrap: false });
}

export function glowTexture() {
  const s = 128, c = canvas(s, s), g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s); return canvasTexture(c, { wrap: false });
}

/** braking boards + corner signs: 8x8 tiles of 128 px. tile 0..2: 150/100/50 boards; 3.. : corner number signs (number + direction chevron) */
export function signAtlas(aniso, corners) {
  const cols = 8, rows = 8, t = 128, c = canvas(cols * t, rows * t), g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const board = (i, label) => {
    const x = (i % cols) * t, y = Math.floor(i / cols) * t; g.save(); g.translate(x, y);
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, t, t); g.fillStyle = '#d41920'; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(-10 + k * 40, 0); g.lineTo(10 + k * 40, 0); g.lineTo(-30 + k * 40, 14); g.lineTo(-50 + k * 40, 14); g.fill(); }
    g.fillRect(0, 14, 8, t - 14); g.fillRect(t - 8, 14, 8, t - 14); g.fillRect(8, t - 8, t - 16, 8);
    g.fillStyle = '#101010'; g.font = `900 ${label.length > 2 ? 54 : 70}px ${FONT}`; g.fillText(label, t / 2, t / 2 + 8); g.restore();
  };
  board(0, '150'); board(1, '100'); board(2, '50'); board(3, 'S/F');
  corners.forEach((co, k) => {
    const i = 4 + k; if (i >= cols * rows) return; const x = (i % cols) * t, y = Math.floor(i / cols) * t; g.save(); g.translate(x, y);
    const col = ['', '#2e9e4f', '#8fbf2a', '#f2c200', '#f08a00', '#d41920'][co.severity];
    g.fillStyle = '#16181c'; g.fillRect(0, 0, t, t); g.fillStyle = col; g.fillRect(6, 6, t - 12, t - 12); g.fillStyle = '#111'; g.fillRect(10, 10, t - 20, t - 20); g.fillStyle = col; g.fillRect(10, 10, t - 20, 28);
    g.fillStyle = '#111'; g.font = `800 24px ${FONT}`; g.fillText('T' + co.n, t / 2, 25);
    g.fillStyle = '#f4f4f0'; g.font = `900 ${co.n > 9 ? 56 : 66}px ${FONT}`; g.fillText(String(co.n), t / 2, 78);
    g.fillStyle = col; g.beginPath(); const dir = co.dir === 'L' ? -1 : 1; g.moveTo(t / 2 + 34 * dir, 106); g.lineTo(t / 2 + 8 * dir, 94); g.lineTo(t / 2 + 8 * dir, 118); g.closePath(); g.fill(); g.fillRect(t / 2 - 34 * dir - (dir > 0 ? 0 : 0) - 8 * dir, 103, 38 * dir, 6);
    g.restore();
  });
  return { map: canvasTexture(c, { aniso, wrap: false }), cols, rows, tile: i => [(i % cols) / cols, 1 - (Math.floor(i / cols) + 1) / rows, 1 / cols, 1 / rows] };
}

/** spectator stand seating: tiers of coloured seats with scattered people */
export function standTexture(aniso) {
  const w = 256, h = 128, c = canvas(w, h), g = c.getContext('2d'), rng = mkRng(61);
  g.fillStyle = '#4a4e57'; g.fillRect(0, 0, w, h);
  const cols = ['#d4171e', '#f2f2ee', '#0033a0', '#f2a900', '#222831', '#2e9e4f', '#ff7a00'];
  for (let r = 0; r < 8; r++) { g.fillStyle = r % 2 ? '#3d4048' : '#575b64'; g.fillRect(0, r * 16, w, 15); for (let k = 0; k < 28; k++) { if (rng() < 0.18) continue; const x = k * 9.2 + 2, col = cols[Math.floor(rng() * cols.length)]; g.fillStyle = '#d8b090'; g.beginPath(); g.arc(x + 4, r * 16 + 4, 2.6, 0, 6.3); g.fill(); g.fillStyle = col; g.fillRect(x, r * 16 + 7, 8, 8); } }
  return canvasTexture(c, { aniso });
}
