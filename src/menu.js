// Front-end: nickname screen -> main menu (Play / Garage / Settings) -> in-game roles (driver / spectator, Tab switches, Esc = menu).
// Plug-in contract: default export async (ctx) => ({ update }). The menu owns the camera while it is open (main.js mode 'custom' -> drive.camUpdate).
// ?menu=0 disables everything (old behaviour: spawn straight into the car).
const CSS = `
body.yd-menu #hud,body.yd-menu #mp,body.yd-menu #nv-open,body.yd-menu #nv-hud,body.yd-menu .attr,body.yd-menu #drv{display:none!important}
body.yd-spec #hud,body.yd-play #hud{display:none!important}
#yd{position:fixed;inset:0;z-index:40;pointer-events:none;color:#fff;font:500 14px/1.4 system-ui,'Segoe UI',sans-serif;user-select:none}
#yd *{box-sizing:border-box}
#yd .scrim{position:absolute;inset:0;opacity:0;transition:opacity .5s;background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.55) 34%,rgba(0,0,0,0) 62%)}
#yd.right .scrim{background:linear-gradient(270deg,rgba(0,0,0,.92) 0%,rgba(0,0,0,.8) 30%,rgba(0,0,0,.35) 48%,rgba(0,0,0,0) 66%)}
#yd.solid .scrim{background:rgba(0,0,0,.9)}
#yd.on .scrim{opacity:1}
#yd .scr{position:absolute;inset:0;display:none;padding:44px 56px}
#yd .scr.on{display:block;animation:ydin .45s ease both}
@keyframes ydin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
#yd .brand{font-size:11px;letter-spacing:.3em;text-transform:uppercase;opacity:.55}
#yd h1{margin:6px 0 0;font:800 clamp(40px,6.5vw,88px)/.92 system-ui,sans-serif;letter-spacing:-.04em;text-transform:uppercase}
#yd h1 span{display:block;color:transparent;-webkit-text-stroke:1.5px #fff}
#yd h2{margin:0 0 4px;font:800 38px/1 system-ui,sans-serif;letter-spacing:-.02em;text-transform:uppercase}
#yd .sub{font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.55;margin-bottom:26px}
#yd .btn,#yd .item,#yd .seg span,#yd .sw,#yd .card{pointer-events:auto;cursor:pointer}
#yd .nick{position:absolute;left:56px;right:56px;top:50%;transform:translateY(-50%);max-width:640px}
#yd .nick input{width:100%;margin-top:34px;padding:10px 0;background:none;border:0;border-bottom:2px solid rgba(255,255,255,.4);color:#fff;font:700 44px/1.1 system-ui,sans-serif;letter-spacing:-.02em;outline:none;pointer-events:auto;user-select:text}
#yd .nick input:focus{border-color:#fff}
#yd .nick .hint{margin-top:12px;font-size:12px;opacity:.55;min-height:18px}
#yd .nick .hint.err{opacity:1}
#yd .btn{display:inline-flex;align-items:center;gap:10px;margin-top:26px;padding:13px 26px;background:#fff;color:#000;font:800 13px system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;border:0}
#yd .btn:hover{background:#d9d9d9}#yd .btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35)}#yd .btn.ghost:hover{background:rgba(255,255,255,.12)}
#yd .btn kbd{font:inherit;opacity:.6}
#yd .menu{position:absolute;left:56px;top:50%;transform:translateY(-46%)}
#yd .item{display:flex;align-items:center;gap:16px;padding:6px 0;font:800 clamp(30px,4.4vw,56px)/1.05 system-ui,sans-serif;letter-spacing:-.02em;text-transform:uppercase;color:rgba(255,255,255,.38);transition:color .15s,transform .15s}
#yd .item i{display:block;width:0;height:4px;background:#fff;transition:width .18s}
#yd .item:hover,#yd .item.sel{color:#fff;transform:translateX(6px)}#yd .item:hover i,#yd .item.sel i{width:34px}
#yd .item small{font:600 11px system-ui,sans-serif;letter-spacing:.2em;opacity:.6;margin-left:4px;align-self:flex-start;margin-top:10px}
#yd .foot{position:absolute;left:56px;bottom:40px;display:flex;align-items:center;gap:14px;font-size:12px;letter-spacing:.08em}
#yd .foot b{font-weight:800;font-size:15px;letter-spacing:.04em}
#yd .dot{width:12px;height:12px;border-radius:50%;border:1.5px solid #fff;display:inline-block}
#yd .keys{position:absolute;right:56px;bottom:40px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.55;text-align:right}
#yd .keys kbd{padding:1px 7px;margin:0 3px;border-radius:4px;background:rgba(255,255,255,.16);font:inherit}
#yd .panel{position:absolute;top:44px;bottom:44px;width:min(420px,92vw);display:flex;flex-direction:column}
#yd .panel.l{left:56px}#yd .panel.r{right:56px}
#yd .scroll{flex:1;overflow:auto;padding-right:4px;pointer-events:auto}
#yd .scroll::-webkit-scrollbar{width:4px}#yd .scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3)}
#yd .lbl{margin:22px 0 10px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.55}
#yd .grid{display:grid;grid-template-columns:repeat(4,52px);gap:12px}
#yd .sw{aspect-ratio:1;border-radius:50%;border:2px solid rgba(255,255,255,.25);transition:transform .15s,border-color .15s;position:relative}
#yd .sw:hover{transform:scale(1.08)}#yd .sw.on{border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.22)}
#yd .pname{margin-top:12px;font:700 15px system-ui,sans-serif;letter-spacing:.04em}
#yd .cards{display:grid;gap:8px}
#yd .card{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35)}
#yd .card.on{border-color:#fff;background:rgba(255,255,255,.1)}#yd .card.lock{opacity:.35;cursor:default}
#yd .card small{display:block;margin-top:3px;font-size:11px;letter-spacing:.06em;opacity:.55}
#yd .card b{font:800 15px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}#yd .card span{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.6}
#yd .row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.12)}
#yd .row>label{font:700 13px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase}
#yd .row small{display:block;margin-top:2px;font:500 11px system-ui,sans-serif;letter-spacing:.02em;opacity:.5;text-transform:none}
#yd .seg{display:flex;border:1px solid rgba(255,255,255,.3);flex:none}
#yd .seg span{padding:7px 13px;font:700 11px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.65)}
#yd .seg span:hover{background:rgba(255,255,255,.12)}#yd .seg span.on{background:#fff;color:#000}
#yd .row input{width:170px;padding:7px 10px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.3);color:#fff;font:600 14px system-ui,sans-serif;outline:none;pointer-events:auto;user-select:text}
#yd .row input:focus{border-color:#fff}
#yd .drag{position:absolute;inset:0;pointer-events:none;cursor:grab}#yd .drag.on{pointer-events:auto}#yd .drag.dn{cursor:grabbing}
#yd .panel,#yd .menu,#yd .nick,#yd .foot,#yd .keys{z-index:2}
#spec{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:6;display:none;pointer-events:none;text-align:center;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.7);font:600 12px/1.4 system-ui,sans-serif}
body.yd-spec #spec{display:block}
#spec .pill{display:inline-block;padding:8px 20px;border-radius:99px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(8px);letter-spacing:.2em;text-transform:uppercase;font-size:12px}
#spec .pill b{font-weight:800}
#spec .tip{margin-top:8px;font-size:11px;letter-spacing:.08em;opacity:.7}
#spec kbd{padding:0 6px;border-radius:4px;background:rgba(255,255,255,.2);font:inherit}
`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex6 = h => '#' + h.toString(16).padStart(6, '0');
const LS = { get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

export default async function ({ THREE, camera, drive }) {
  if (new URLSearchParams(location.search).get('menu') === '0') return {};
  drive.menuOn = true; drive.wanted = false; drive.startMode = 'custom';
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'yd';
  root.innerHTML = `
    <div class="scrim"></div>
    <div class="drag" id="yd-drag"></div>
    <div class="scr" id="s-nick"><div class="nick"><div class="brand">Welcome to</div><h1>Yerevan<span>Drift</span></h1>
      <input id="nick-in" type="text" maxlength="16" placeholder="Your nickname" autocomplete="off" spellcheck="false">
      <div class="hint" id="nick-hint">This is how other drivers will see you online · 2–16 characters</div>
      <div class="btn" id="nick-go">Continue <kbd>↵</kbd></div></div></div>
    <div class="scr" id="s-main">
      <div class="brand">Republic Square · Yerevan</div><h1>Yerevan<span>Drift</span></h1>
      <div class="menu" id="mainmenu"></div>
      <div class="foot"><span class="dot" id="m-dot"></span><b id="m-nick"></b><span id="m-online" style="opacity:.55"></span></div>
      <div class="keys"><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> select <kbd>Esc</kbd> back</div></div>
    <div class="scr" id="s-play"><div class="brand">Play</div><div class="menu" id="playmenu"></div>
      <div class="keys"><kbd>Tab</kbd> switch driver / spectator any time · <kbd>Esc</kbd> back</div></div>
    <div class="scr" id="s-garage"><div class="panel r"><h2>Garage</h2><div class="sub">Your ride</div>
      <div class="scroll"><div class="lbl" style="margin-top:0">Vehicle</div><div class="cards" id="g-cars"></div>
        <div class="lbl">Paint</div><div class="grid" id="g-paint"></div><div class="pname" id="g-pname"></div>
        <div class="lbl">Headlights</div><div class="seg" id="g-lights" style="display:inline-flex"><span data-v="1">On</span><span data-v="0">Off</span></div></div>
      <div><div class="btn" id="g-back">← Back</div></div></div>
      <div class="keys" style="left:56px;right:auto;text-align:left">Drag to rotate · scroll to zoom</div></div>
    <div class="scr" id="s-settings"><div class="panel l"><h2>Settings</h2><div class="sub">Preferences are saved on this device</div>
      <div class="scroll" id="set-rows"></div><div><div class="btn" id="set-back">← Back</div></div></div></div>`;
  document.body.appendChild(root);
  const spec = document.createElement('div'); spec.id = 'spec'; document.body.appendChild(spec);
  const $ = id => root.querySelector('#' + id);

  // ------------------------------------------------------------------ settings (only values the user touched are stored, so the defaults stay whatever the game ships with)
  const SET = { bloom: LS.get('yd.bloom'), tod: LS.get('yd.tod'), wet: LS.get('yd.wet'), sound: LS.get('yd.sound'), q: LS.get('yd.q'), tex: LS.get('yd.tex'), fps: LS.get('yd.fps') };
  const Y = () => window.__yerevan;
  function applySettings() {
    const y = Y(); if (!y) return;
    if (SET.bloom !== null) y.bloom.enabled = SET.bloom === '1';
    if (SET.tod !== null) y.setTod(+SET.tod);
    if (SET.wet !== null) y.wetness.value = +SET.wet;
    if (SET.sound !== null) drive.car?.audio?.mute(SET.sound === '0');
    y.showFps?.(SET.fps !== '0');
  }
  function setSetting(k, v) { SET[k] = String(v); LS.set('yd.' + k, String(v)); applySettings(); }

  // ------------------------------------------------------------------ state
  let state = 'nick', session = null;          // session: 'driver' | 'spec' | null
  let prev = 'main', mainSel = 0, playSel = 0;
  let nickname = (LS.get('mp.name', '') || '').trim();
  const nameOk = n => /^[\p{L}\p{N} _.\-]{2,16}$/u.test(n);
  const screens = { nick: $('s-nick'), main: $('s-main'), play: $('s-play'), garage: $('s-garage'), settings: $('s-settings') };
  const cars = () => drive.car;

  function show(s) {
    state = s;
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('on', k === s);
    const menuOpen = s in screens;
    root.classList.toggle('on', menuOpen); root.classList.toggle('solid', s === 'nick'); root.classList.toggle('right', s === 'garage');
    $('yd-drag').classList.toggle('on', s === 'garage');
    document.body.classList.toggle('yd-menu', menuOpen);
    document.body.classList.toggle('yd-play', s === 'play-driver');
    document.body.classList.toggle('yd-spec', s === 'spec');
    if (menuOpen) { drive.uiLock = true; enterCustomCam(); } else drive.uiLock = false;
    if (s === 'main') renderMain(); if (s === 'play') renderPlay(); if (s === 'garage') renderGarage(); if (s === 'settings') renderSettings();
    if (s === 'nick') setTimeout(() => $('nick-in').focus(), 50);
  }

  // ------------------------------------------------------------------ camera for menu / garage
  const cs = { az: 0.6, dist: 12, h: 3.6, side: 2.6, tdist: 12, th: 3.6, tside: 2.6, drag: 0, tgt: new THREE.Vector3(), look: new THREE.Vector3(), right: new THREE.Vector3(), seeded: false };
  function enterCustomCam() { drive.setMode?.('custom'); }
  drive.camUpdate = (dt, cam) => {
    const v = cars()?.vehicle; if (v) cs.tgt.set(v.pos.x, v.pos.y + 0.7, v.pos.z);
    const garage = state === 'garage';
    cs.tdist = garage ? 6.4 * cs.zoom : 11; cs.th = garage ? 1.7 : 3.4; cs.tside = garage ? 1.9 : -3.0;     // garage panel is on the right -> car sits left of centre; main menu is left -> car right
    if (!garage) cs.az += dt * 0.11; else if (!cs.dragging) cs.az += dt * 0.05;
    const k = 1 - Math.exp(-dt * 4); cs.dist += (cs.tdist - cs.dist) * k; cs.h += (cs.th - cs.h) * k; cs.side += (cs.tside - cs.side) * k;
    const s = Math.sin(cs.az), c = Math.cos(cs.az);
    cs.right.set(c, 0, -s);
    cam.position.set(cs.tgt.x + s * cs.dist, cs.tgt.y + cs.h, cs.tgt.z + c * cs.dist);
    cs.look.copy(cs.tgt).addScaledVector(cs.right, cs.side); cam.lookAt(cs.look);
    drive.focus.copy(cs.tgt);
  };
  cs.zoom = 1;
  { // drag / wheel in the garage
    const d = $('yd-drag'); let lx = 0;
    d.addEventListener('pointerdown', e => { cs.dragging = true; lx = e.clientX; d.classList.add('dn'); d.setPointerCapture(e.pointerId); });
    d.addEventListener('pointermove', e => { if (!cs.dragging) return; cs.az -= (e.clientX - lx) * 0.008; lx = e.clientX; });
    const up = () => { cs.dragging = false; d.classList.remove('dn'); };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    d.addEventListener('wheel', e => { e.preventDefault(); cs.zoom = Math.max(0.55, Math.min(1.6, cs.zoom * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: false });
  }

  // ------------------------------------------------------------------ main / play menus
  function items(el, list, selKey, onSel) {
    el.innerHTML = list.map((it, i) => `<div class="item" data-i="${i}"><i></i>${it.label}${it.tag ? `<small>${it.tag}</small>` : ''}</div>`).join('');
    const nodes = [...el.children];
    nodes.forEach((n, i) => { n.onmouseenter = () => { onSel(i); mark(); }; n.onclick = () => list[i].go(); });
    const mark = () => nodes.forEach((n, i) => n.classList.toggle('sel', i === (selKey === 'main' ? mainSel : playSel)));
    mark(); return mark;
  }
  let mainList = [], playList = [], markMain = () => { }, markPlay = () => { };
  function renderMain() {
    mainList = [];
    if (session) mainList.push({ label: 'Resume', tag: session === 'spec' ? 'Spectator' : 'Driver', go: () => startPlay(session) });
    mainList.push({ label: 'Play', go: () => show('play') }, { label: 'Garage', go: () => { prev = 'main'; show('garage'); } }, { label: 'Settings', go: () => { prev = 'main'; show('settings'); } });
    mainSel = Math.min(mainSel, mainList.length - 1);
    markMain = items($('mainmenu'), mainList, 'main', i => { mainSel = i; });
    $('m-nick').textContent = nickname;
    const hex = cars()?.paints?.[cars().paint()]?.hex ?? 0xffffff; $('m-dot').style.background = hex6(hex);
    const n = drive.mp?.count; $('m-online').textContent = n === undefined ? '' : `· ${n + 1} online`;
  }
  function renderPlay() {
    playList = [{ label: 'Driver', tag: 'Drive & drift', go: () => startPlay('driver') }, { label: 'Spectator', tag: 'Watch others', go: () => startPlay('spec') }, { label: 'Back', go: () => show('main') }];
    playSel = 0; markPlay = items($('playmenu'), playList, 'play', i => { playSel = i; });
  }

  // ------------------------------------------------------------------ roles
  const sp = { follow: -1, pos: new THREE.Vector3(), look: new THREE.Vector3(), fw: new THREE.Vector3() };
  function startPlay(role) {
    session = role; $('nick-in').blur(); cars()?.audio?.resume?.();
    if (role === 'driver') {
      show('play-driver'); cars()?.setVisible(true); drive.mp?.setSpectating(false); drive.camUpdate = menuCam; drive.setMode('drive'); drive.uiLock = false;
      cars()?.hud?.toast?.('DRIVER  ·  TAB spectator  ·  ESC menu', 2.2);
    } else {
      show('spec'); cars()?.setVisible(false); drive.mp?.setSpectating(true);
      const v = cars()?.vehicle; if (v) { camera.position.set(v.pos.x + 22, v.pos.y + 20, v.pos.z + 34); camera.lookAt(v.pos.x, v.pos.y + 2, v.pos.z); }
      sp.follow = -1; drive.camUpdate = specCam; drive.setMode('fly'); drive.uiLock = false; renderSpec();
    }
  }
  const menuCam = drive.camUpdate;
  function toggleRole() {
    if (!(state === 'play-driver' || state === 'spec')) return;
    startPlay(state === 'spec' ? 'driver' : 'spec');
  }
  drive.toggleRole = toggleRole;
  function openMenu() { drive.camUpdate = menuCam; cs.az = Math.atan2(camera.position.x - (cars()?.vehicle.pos.x ?? 0), camera.position.z - (cars()?.vehicle.pos.z ?? 0)); cs.dist = Math.min(30, camera.position.distanceTo(cs.tgt) || 12); mainSel = 0; show('main'); }

  // spectator follow camera (cycle with [ and ] ; V = free camera)
  function specCam(dt, cam) {
    const list = drive.players ?? []; const p = sp.follow >= 0 ? list[sp.follow % Math.max(1, list.length)] : null;
    if (sp.follow >= 0 && !p) { sp.follow = -1; drive.setMode('fly'); renderSpec(); return; }
    if (!p) return;
    sp.fw.set(Math.sin(p.heading), 0, Math.cos(p.heading));
    const want = new THREE.Vector3(p.x - sp.fw.x * 9, p.y + 3.6, p.z - sp.fw.z * 9);
    sp.pos.lerp(want, 1 - Math.exp(-dt * 5)); if (sp.pos.distanceTo(want) > 40) sp.pos.copy(want);
    cam.position.copy(sp.pos); sp.look.set(p.x + sp.fw.x * 8, p.y + 1.3, p.z + sp.fw.z * 8); cam.lookAt(sp.look);
    drive.focus.set(p.x, p.y, p.z);
  }
  function cycleFollow(dir) {
    const list = drive.players ?? []; if (!list.length) { renderSpec('No other players online'); return; }
    const wasFree = sp.follow < 0; sp.follow = wasFree ? (dir > 0 ? 0 : list.length - 1) : (sp.follow + dir + list.length) % list.length;
    if (wasFree) { sp.pos.copy(camera.position); drive.setMode('custom'); } renderSpec();
  }
  function renderSpec(msg) {
    const list = drive.players ?? []; const p = sp.follow >= 0 ? list[sp.follow] : null;
    spec.innerHTML = `<div class="pill">Spectating · <b>${p ? esc(p.name) : 'free camera'}</b></div>
      <div class="tip">${msg ? esc(msg) + ' · ' : ''}<kbd>[</kbd> <kbd>]</kbd> follow player &nbsp; <kbd>V</kbd> free camera &nbsp; <kbd>WASD</kbd> fly &nbsp; <kbd>Tab</kbd> become driver &nbsp; <kbd>Esc</kbd> menu</div>`;
  }

  // ------------------------------------------------------------------ garage
  function renderGarage() {
    const c = cars(); if (!c) return;
    $('g-cars').innerHTML = c.cars.map(k => `<div class="card${k.id === c.carId() ? ' on' : ''}" data-id="${k.id}"><div><b>${esc(k.name)}</b><small>${esc(k.sub)}</small></div><span>${k.id === c.carId() ? 'Selected' : 'Select'}</span></div>`).join('');
    [...$('g-cars').children].forEach(n => n.onclick = async () => { if (n.dataset.id === c.carId()) return; n.querySelector('span').textContent = 'Loading…'; await c.setCar(n.dataset.id); LS.set('yd.car', c.carId()); renderGarage(); });
    const cur = c.paint();
    $('g-paint').innerHTML = c.paints.map((p, i) => `<div class="sw${i === cur ? ' on' : ''}" data-i="${i}" title="${esc(p.name)}" style="background:${hex6(p.hex === 0x07080b ? 0x15161a : p.hex)}"></div>`).join('');
    $('g-pname').textContent = c.paints[cur].name;
    [...$('g-paint').children].forEach(n => n.onclick = () => { const i = +n.dataset.i; c.setPaint(i); LS.set('yd.paint', String(i)); renderGarage(); });
    const lit = c.lights() ? '1' : '0'; [...$('g-lights').children].forEach(n => { n.classList.toggle('on', n.dataset.v === lit); n.onclick = () => { c.setLights(n.dataset.v === '1'); renderGarage(); }; });
  }
  $('g-back').onclick = () => show(prev);

  // ------------------------------------------------------------------ settings
  function renderSettings() {
    const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<span data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</span>`).join('')}</div>`;
    const qNow = SET.q ?? 'auto';
    $('set-rows').innerHTML = `
      <div class="row"><label>Nickname<small>Shown above your car</small></label><input id="st-nick" maxlength="16" value="${esc(nickname)}" spellcheck="false" autocomplete="off"></div>
      <div class="row"><label>Graphics<small>Reloads the game · now: ${esc(quality())}${Y()?.quality.capped ? ' (lowered after a crash: pick a level to lift it)' : ''}</small></label>${seg('st-q', [['auto', 'Auto'], ['low', 'Low'], ['med', 'Med'], ['high', 'High'], ['ultra', 'Ultra']], qNow)}</div>
      <div class="row"><label>Textures<small>Reloads the game · independent of Graphics</small></label>${seg('st-tex', [['auto', 'Auto'], [512, '512'], [1024, '1K'], [2048, '2K']], SET.tex ?? 'auto')}</div>
      <div class="row"><label>Auto quality<small>Lowers quality while playing when fps drops (can cause a stutter when it switches). Reloads the game.</small></label>${seg('st-gov', [[0, 'Off'], [1, 'On']], LS.get('yd.gov', '0'))}</div>
      <div class="row"><label>FPS counter</label>${seg('st-fps', [[1, 'On'], [0, 'Off']], SET.fps ?? 1)}</div>
      <div class="row"><label>Bloom</label>${seg('st-bloom', [[1, 'On'], [0, 'Off']], SET.bloom ?? (Y()?.bloom.enabled ? 1 : 0))}</div>
      <div class="row"><label>Time of day</label>${seg('st-tod', [[0, 'Night'], [0.5, 'Dusk'], [1, 'Day']], SET.tod ?? 0)}</div>
      <div class="row"><label>Wet roads</label>${seg('st-wet', [[1, 'Wet'], [0, 'Dry']], SET.wet ?? (Y()?.wetness.value > 0.5 ? 1 : 0))}</div>
      <div class="row"><label>Sound</label>${seg('st-sound', [[1, 'On'], [0, 'Off']], SET.sound ?? 1)}</div>`;
    const bind = (id, fn) => [...$(id).children].forEach(n => n.onclick = () => { fn(n.dataset.v); renderSettings(); });
    bind('st-fps', v => setSetting('fps', v));
    bind('st-gov', v => { LS.set('yd.gov', v); location.reload(); });
    bind('st-tex', v => { if (v === 'auto') { try { localStorage.removeItem('yd.tex'); } catch { /* */ } } else LS.set('yd.tex', v); const u = new URL(location.href); u.searchParams.delete('tex'); location.href = u.toString(); });
    bind('st-bloom', v => setSetting('bloom', v)); bind('st-tod', v => setSetting('tod', v)); bind('st-wet', v => setSetting('wet', v)); bind('st-sound', v => setSetting('sound', v));
    bind('st-q', v => { try { localStorage.removeItem('yd.cap'); } catch { /* */ } if (v === 'auto') { try { localStorage.removeItem('yd.q'); } catch { /* */ } } else LS.set('yd.q', v); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); });
    const inp = $('st-nick'); const commit = () => { const n = inp.value.trim(); if (nameOk(n)) { nickname = n; drive.mp?.setName(n); } else inp.value = nickname; };
    inp.onchange = commit; inp.onblur = commit;
  }
  const quality = () => Y()?.quality.level ?? '';
  $('set-back').onclick = () => { $('st-nick')?.blur(); show(prev); };

  // ------------------------------------------------------------------ nickname screen
  function submitNick() {
    const n = $('nick-in').value.trim(), h = $('nick-hint');
    if (!nameOk(n)) { h.textContent = 'Use 2–16 letters, numbers, spaces, _ . -'; h.classList.add('err'); return; }
    h.classList.remove('err'); nickname = n; drive.mp?.setName(n); LS.set('mp.name', n); mainSel = 0; show('main');
  }
  $('nick-go').onclick = submitNick;
  $('nick-in').value = nickname;
  // ------------------------------------------------------------------ keys (capture phase: while a menu screen is open nothing else sees the keyboard)
  addEventListener('keydown', e => {
    const menuOpen = state in screens;
    if (!menuOpen) {
      if (e.code === 'Tab' && (state === 'play-driver' || state === 'spec')) e.preventDefault();
      if (drive.uiLock) return;                                                   // the map overlay is open: it handles Esc itself
      if (e.code === 'Escape' && (state === 'play-driver' || state === 'spec')) { e.preventDefault(); e.stopImmediatePropagation(); openMenu(); return; }
      if (state === 'spec' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'BracketRight') { cycleFollow(1); e.stopImmediatePropagation(); }
        else if (e.code === 'BracketLeft') { cycleFollow(-1); e.stopImmediatePropagation(); }
        else if (e.code === 'KeyV' && sp.follow >= 0) { sp.follow = -1; drive.setMode('fly'); renderSpec(); e.stopImmediatePropagation(); }
      }
      return;
    }
    e.stopImmediatePropagation();
    const inField = e.target?.closest?.('input');
    if (state === 'nick') { if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); submitNick(); } return; }
    if (inField) { if (e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); inField.blur(); } return; }
    if (e.code === 'Tab') { e.preventDefault(); return; }
    if (state === 'main' || state === 'play') {
      const list = state === 'main' ? mainList : playList, dir = e.code === 'ArrowDown' || e.code === 'KeyS' ? 1 : e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 0;
      if (dir) { e.preventDefault(); if (state === 'main') { mainSel = (mainSel + dir + list.length) % list.length; markMain(); } else { playSel = (playSel + dir + list.length) % list.length; markPlay(); } }
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); list[state === 'main' ? mainSel : playSel].go(); }
      else if (e.code === 'Escape') { if (state === 'play') show('main'); else if (session) startPlay(session); }
    } else if (e.code === 'Escape' || e.code === 'Backspace') show(prev);
  }, true);
  addEventListener('pointerdown', () => cars()?.audio?.resume?.());

  // ------------------------------------------------------------------ boot
  { const c = cars(); const p = parseInt(LS.get('yd.paint', ''), 10); if (c && Number.isFinite(p)) c.setPaint(p); }
  queueMicrotask(applySettings); setTimeout(applySettings, 500);
  let t = 0;
  show('nick');         // always greet with the nickname screen (pre-filled when known)
  const IDLE = { dt: 0.016, rpm: 0, throttle: 0, boost: 0, speed: 0, slipF: 0, slipR: 0, hard: 0, limiter: false, scrape: 0, gear: 0 };
  return { update(dt) { if (state !== 'play-driver') cars()?.audio?.update({ ...IDLE, dt }); if ((t -= dt) > 0) return; t = 0.5; if (state === 'main') { const n = drive.mp?.count; $('m-online').textContent = n === undefined ? '' : `· ${n + 1} online`; } if (state === 'spec') renderSpec(); } };
}
