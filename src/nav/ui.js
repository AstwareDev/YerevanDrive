// DOM + CSS for the map overlay, the driving minimap and the turn-by-turn card.
const CSS = `
#nv-open{position:fixed;right:14px;top:14px;z-index:6;padding:8px 13px;border-radius:10px;background:rgba(14,14,14,.72);border:1px solid rgba(255,255,255,.12);color:#ededed;font:600 13px system-ui,Segoe UI,sans-serif;cursor:pointer;backdrop-filter:blur(8px);user-select:none;display:flex;gap:8px;align-items:center}
#nv-open:hover{background:rgba(40,40,40,.9)}#nv-open kbd,.nv-kbd{padding:0 6px;border-radius:4px;background:rgba(255,255,255,.16);font:inherit;font-size:11px}
#nv-map{position:fixed;inset:0;z-index:30;display:none;background:#0f0f0f;color:#ececec;font:14px/1.35 system-ui,-apple-system,Segoe UI,sans-serif}
#nv-map.on{display:flex}
#nv-map *{box-sizing:border-box}
.nv-side{width:392px;max-width:46vw;display:flex;flex-direction:column;background:rgba(17,17,17,.97);border-right:1px solid rgba(255,255,255,.08);z-index:2;box-shadow:6px 0 30px rgba(0,0,0,.45)}
.nv-search{display:flex;gap:6px;padding:14px 14px 8px}
.nv-search input{flex:1;min-width:0;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#1e1e1e;color:#fff;font:500 15px system-ui,sans-serif;outline:none}
.nv-search input:focus{border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.14)}
.nv-btn{border:0;border-radius:10px;padding:9px 13px;background:#272727;color:#ececec;font:600 13px system-ui,sans-serif;cursor:pointer}
.nv-btn:hover{background:#393939}.nv-btn.pri{background:#fff;color:#000}.nv-btn.pri:hover{background:#d9d9d9}.nv-btn.go{background:#fff;color:#000}.nv-btn.go:hover{background:#d9d9d9}.nv-btn[disabled]{opacity:.4;pointer-events:none}
.nv-chips{display:flex;gap:6px;flex-wrap:wrap;padding:2px 14px 10px}
.nv-chips span{padding:5px 11px;border-radius:99px;background:#222222;border:1px solid rgba(255,255,255,.08);font-size:12px;font-weight:600;cursor:pointer;color:#c6c6c6}
.nv-chips span:hover{background:#353535;color:#fff}
.nv-list{flex:1;overflow:auto;padding:0 8px 8px}
.nv-h{padding:10px 8px 4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8a8a}
.nv-row{display:flex;gap:11px;align-items:center;padding:9px 10px;border-radius:10px;cursor:pointer}
.nv-row:hover,.nv-row.sel{background:#262626}
.nv-ico{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#2f2f2f;font-size:15px}
.nv-row .t{font-weight:600;color:#f6f6f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nv-row .s{font-size:12px;color:#9b9b9b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nv-row .d{margin-left:auto;font-size:12px;color:#9b9b9b;flex:none;padding-left:6px}
.nv-empty{padding:18px 12px;color:#9b9b9b;font-size:13px}
.nv-card{border-top:1px solid rgba(255,255,255,.08);padding:14px;background:#161616;display:none}
.nv-card.on{display:block}
.nv-card h3{margin:0 0 2px;font-size:18px;color:#fff}.nv-card .sub{color:#a1a1a1;font-size:13px;margin-bottom:10px}
.nv-card .acts{display:flex;gap:7px;flex-wrap:wrap}
.nv-card .info{margin-top:10px;font-size:13px;color:#b7b7b7}
.nv-foot{padding:8px 14px 12px;font-size:11.5px;color:#868686;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.nv-foot label{display:flex;gap:6px;align-items:center;cursor:pointer}
.nv-main{flex:1;position:relative;min-width:0}
.nv-main canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab;touch-action:none}
.nv-main canvas.drag{cursor:grabbing}
.nv-ctl{position:absolute;right:14px;top:14px;display:flex;flex-direction:column;gap:8px}
.nv-ctl .nv-btn{background:rgba(20,20,20,.9);width:42px;height:42px;padding:0;font-size:20px;border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(6px)}
.nv-ctl .nv-btn:hover{background:#363636}
.nv-layer{position:absolute;left:14px;bottom:14px;display:flex;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:rgba(20,20,20,.9)}
.nv-layer span{padding:8px 14px;font-weight:600;font-size:12.5px;cursor:pointer;color:#b3b3b3}.nv-layer span.on{background:#fff;color:#000}
.nv-toast{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);padding:9px 16px;border-radius:99px;background:rgba(14,14,14,.92);border:1px solid rgba(255,255,255,.14);font-weight:600;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none}
.nv-toast.on{opacity:1}
.nv-scale{position:absolute;right:70px;bottom:16px;font-size:11px;color:#e5e5e5;text-shadow:0 1px 4px #000;text-align:right}
.nv-scale i{display:block;height:5px;border:2px solid #e5e5e5;border-top:0;margin-top:3px}
/* ---- driving HUD (top-right) */
#nv-hud{position:fixed;right:18px;top:16px;z-index:6;display:none;width:244px;pointer-events:none;font:600 13px system-ui,Segoe UI,sans-serif;color:#f3f3f3;text-shadow:0 1px 6px rgba(0,0,0,.65)}
#nv-hud.on{display:block}
#nv-turn{display:none;margin-bottom:10px;padding:10px 12px;border-radius:16px;background:rgba(16,16,16,.82);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(8px);box-shadow:0 8px 28px rgba(0,0,0,.4)}
#nv-turn.on{display:block}
#nv-turn .row{display:flex;gap:12px;align-items:center}
#nv-turn svg{width:54px;height:54px;flex:none;background:#262626;border-radius:12px;padding:3px}
#nv-turn .dist{font-size:30px;font-weight:800;line-height:1;letter-spacing:-.01em}
#nv-turn .txt{font-size:13px;color:#dedede;margin-top:3px;font-weight:600;line-height:1.25}
#nv-turn .meta{margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12);display:flex;justify-content:space-between;font-size:12px;color:#bcbcbc}
#nv-turn .meta b{color:#fff;font-size:14px}
#nv-turn .bar{height:4px;border-radius:2px;background:rgba(255,255,255,.14);margin-top:7px;overflow:hidden}#nv-turn .bar i{display:block;height:100%;background:#fff;width:0}
#nv-mini{position:relative;width:244px;height:244px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.85);box-shadow:0 8px 30px rgba(0,0,0,.55);background:#141414;pointer-events:auto;cursor:pointer}
#nv-mini canvas{width:100%;height:100%;display:block}
#nv-mini .n{position:absolute;left:50%;top:6px;transform:translateX(-50%);font-size:11px;font-weight:800;color:#fff;text-shadow:0 0 4px #000}
#nv-street{margin-top:9px;text-align:center;padding:5px 12px;border-radius:99px;background:rgba(16,16,16,.78);border:1px solid rgba(255,255,255,.1);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#nv-tag{position:fixed;left:0;top:0;z-index:5;display:none;pointer-events:none;transform:translate(-50%,-100%);padding:6px 12px;border-radius:12px;background:rgba(16,16,16,.86);border:1px solid rgba(255,255,255,.2);color:#fff;font:600 13px system-ui,sans-serif;white-space:nowrap;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.5)}
#nv-tag small{display:block;font-weight:500;color:#b2b2b2;font-size:11.5px}
`;

/** manoeuvre icon as inline SVG (48x48) */
export function maneuverIcon(type, exit = 1) {
  const A = { left: -90, 'slight-left': -45, 'sharp-left': -135, right: 90, 'slight-right': 45, 'sharp-right': 135, continue: 0, straight: 0 };
  const st = 'fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
  let body = '';
  if (type === 'continue' || type === 'straight') body = `<path ${st} d="M24 43 L24 20"/><path fill="#fff" d="M24 6 L33 21 L15 21Z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
  else if (type in A) {
    const a = A[type] * Math.PI / 180, L = 17, ex = 24 + L * Math.sin(a), ez = 24 - L * Math.cos(a), dx = Math.sin(a), dz = -Math.cos(a);
    body = `<path ${st} d="M24 43 L24 24 L${ex.toFixed(1)} ${ez.toFixed(1)}"/><path fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M${(ex + dx * 8).toFixed(1)} ${(ez + dz * 8).toFixed(1)} L${(ex - dz * 8.5).toFixed(1)} ${(ez + dx * 8.5).toFixed(1)} L${(ex + dz * 8.5).toFixed(1)} ${(ez - dx * 8.5).toFixed(1)}Z"/>`;
  } else if (type === 'uturn') body = `<path ${st} d="M32 43 V19 a8 8 0 0 0 -16 0 V30"/><path fill="#fff" d="M16 38 L9 29 L23 29Z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
  else if (type === 'roundabout') body = `<circle cx="24" cy="29" r="9" ${st} stroke-width="4"/><path ${st} d="M24 20 V10"/><path fill="#fff" d="M24 3 L31 12 L17 12Z"/><text x="24" y="33" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="system-ui">${exit}</text>`;
  else if (type === 'arrive') body = `<path ${st} d="M15 43 V8"/><path fill="#fff" d="M17 9 H37 L31 17 L37 25 H17Z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 48 48">${body}</svg>`;
}

export function catIcon(kind, cat = '') {
  if (kind === 'street') return '🛣';
  if (kind === 'address') return '🏠';
  if (kind === 'online') return '🌐';
  if (cat === 'metro' || cat === 'station') return '🚇';
  if (/park|garden|playground/.test(cat)) return '🌳';
  if (/hotel|hostel|guest/.test(cat)) return '🛏';
  if (/cafe|restaurant|fast_food|bar|pub|bakery/.test(cat)) return '🍴';
  if (/^shop|mall|supermarket/.test(cat)) return '🛍';
  if (/museum|gallery|theatre|cinema|library|attraction|monument|memorial/.test(cat)) return '🏛';
  if (/place_of_worship|church/.test(cat)) return '⛪';
  if (/school|university|college|kindergarten/.test(cat)) return '🎓';
  if (/hospital|clinic|pharmacy/.test(cat)) return '➕';
  if (/stadium|sports/.test(cat)) return '🏟';
  if (/fuel/.test(cat)) return '⛽';
  if (/government|townhall|diplomatic|police/.test(cat)) return '🏛';
  return '📍';
}

export function buildDOM() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div id="nv-open" title="Map & navigation (F)"><span>🗺</span> Map <kbd>F</kbd></div>
  <div id="nv-map">
    <div class="nv-side">
      <div class="nv-search"><input id="nv-q" type="text" placeholder="Search an address, street or place…" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="nv-btn" id="nv-close" title="Close (Esc)">✕</button></div>
      <div class="nv-chips" id="nv-chips"></div>
      <div class="nv-list" id="nv-list"></div>
      <div class="nv-card" id="nv-card"></div>
      <div class="nv-foot"><label><input type="checkbox" id="nv-voice" checked> Voice guidance</label><span>Click the map to drop a pin · <span class="nv-kbd">Esc</span> close · <span class="nv-kbd">X</span> cancel route</span></div>
    </div>
    <div class="nv-main">
      <canvas id="nv-cv"></canvas>
      <div class="nv-ctl"><button class="nv-btn" id="nv-zin" title="Zoom in">+</button><button class="nv-btn" id="nv-zout" title="Zoom out">−</button><button class="nv-btn" id="nv-loc" title="Centre on the car">◎</button></div>
      <div class="nv-layer"><span id="nv-l-map" class="on">Map</span><span id="nv-l-sat">Satellite</span></div>
      <div class="nv-scale" id="nv-scale"></div>
      <div class="nv-toast" id="nv-toast"></div>
    </div>
  </div>
  <div id="nv-hud">
    <div id="nv-turn"><div class="row"><div id="nv-ico"></div><div><div class="dist" id="nv-dist"></div><div class="txt" id="nv-txt"></div></div></div>
      <div class="meta"><span><b id="nv-rem"></b> left</span><span><b id="nv-eta"></b></span><span id="nv-via"></span></div><div class="bar"><i id="nv-bar"></i></div></div>
    <div id="nv-mini"><canvas id="nv-mc"></canvas><div class="n">N</div></div>
    <div id="nv-street">—</div>
  </div>
  <div id="nv-tag"></div>`;
  document.body.append(...wrap.children);
  const $ = id => document.getElementById(id);
  return { open: $('nv-open'), map: $('nv-map'), q: $('nv-q'), close: $('nv-close'), chips: $('nv-chips'), list: $('nv-list'), card: $('nv-card'), voice: $('nv-voice'), cv: $('nv-cv'), zin: $('nv-zin'), zout: $('nv-zout'), loc: $('nv-loc'),
    lMap: $('nv-l-map'), lSat: $('nv-l-sat'), scale: $('nv-scale'), toast: $('nv-toast'),
    hud: $('nv-hud'), turn: $('nv-turn'), ico: $('nv-ico'), dist: $('nv-dist'), txt: $('nv-txt'), rem: $('nv-rem'), eta: $('nv-eta'), via: $('nv-via'), bar: $('nv-bar'), mini: $('nv-mini'), mc: $('nv-mc'), street: $('nv-street'), tag: $('nv-tag') };
}
