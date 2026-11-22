// Map + GPS navigator plug-in.
//   F (or the Map button)  full-screen map: search an address / street / place, see it on the 2D map AND as a light beam in the 3D world,
//                          then Navigate (turn-by-turn), Teleport the car there, or View it in 3D.
//   While driving: heading-up minimap, turn card (arrow, distance, street), route ribbon painted on the road, voice prompts, auto re-route.   X cancels the route.
import { Nav, maneuverText, fmtDist, fmtTime } from './nav/data.js';
import { Search, onlineSearch, catLabel, CHIP_NAMES } from './nav/search.js';
import { MapRenderer } from './nav/mapview.js';
import { buildDOM, maneuverIcon, catIcon } from './nav/ui.js';
import { createWorld3D } from './nav/world3d.js';
import { project } from './nav/geo.js';
import { quality } from './quality.js';

const REGION_PAD = 60;
export default async function ({ THREE, scene, camera, meta, H, drive }) {
  const ui = buildDOM();
  const groundY = (x, z) => (drive.car?.ground ? drive.car.ground.y(x, z) : H(x, z));
  const w3 = createWorld3D({ THREE, scene, groundY });
  let nav = null, search = null, mapper = null, loadErr = null;
  const places = [{ name: 'Republic Square', x: 0, z: 0 }, ...(meta.places ?? [])];

  // ------------------------------------------------------------------ state
  const MINI_HZ = { low: 8, med: 12, high: 15, ultra: 20 }[quality.level] ?? 12;
  let open = false, dirty = true, drawT = 0, miniT = 0, streetT = 0, sat = false;
  const view = { cx: 0, cz: 0, mpp: 2.2 };
  let fly = null;                                     // {t, dur, from:{cx,cz,mpp}, to:{...}}
  let sel = null;                                     // selected place {x,z,title,sub,kind,cat,outside}
  let results = [], hi = -1, listMode = 'home', chipTitle = '';
  let route = null, dest = null, prog = { s: 0, idx: 0, off: 0 }, offT = 0, rerouteAt = -9, arrivedT = 0, spoken = new Set(), miniMpp = 1.2, lastMan = null;
  let recents = []; try { recents = JSON.parse(localStorage.getItem('nv.recent') || '[]'); } catch { /* ignore */ }
  ui.voice.checked = localStorage.getItem('nv.voice') !== '0';
  ui.voice.onchange = () => localStorage.setItem('nv.voice', ui.voice.checked ? '1' : '0');

  const carState = () => { const c = drive.car; if (!c) return null; const v = c.vehicle; return { x: v.pos.x, z: v.pos.z, heading: Math.atan2(v.fwd.x, v.fwd.z), speed: v.t.speed, kmh: v.t.kmh }; };
  const origin = () => { const c = carState(); return c ?? { x: view.cx, z: view.cz, heading: 0, speed: 0 }; };
  const toast = (t, d = 2200) => { ui.toast.textContent = t; ui.toast.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => ui.toast.classList.remove('on'), d); if (drive.active && !open) drive.car?.hud?.toast?.(t, 1.6); };
  const say = (text) => { if (!ui.voice.checked || !('speechSynthesis' in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.05; speechSynthesis.speak(u); } catch { /* no speech */ } };

  // ------------------------------------------------------------------ data
  (async () => {
    try {
      const j = await (await fetch('/map/nav.json')).json();
      nav = new Nav(j); search = new Search(nav); mapper = new MapRenderer(nav); mapper.buildCache(() => { dirty = true; });
      buildChips(); renderList(); dirty = true; console.log(`[nav] ready: ${nav.N} nodes, ${nav.E} edges, ${search.all.length} places`);
    } catch (e) { loadErr = e; console.error('[nav] data failed', e); }
  })();

  // ------------------------------------------------------------------ canvas
  const cvs = ui.cv, ctx2 = cvs.getContext('2d'); let CW = 1, CH = 1, dpr = 1;
  const fit = () => { const r = cvs.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); CW = Math.max(1, r.width); CH = Math.max(1, r.height); const w = Math.round(CW * dpr), h = Math.round(CH * dpr); if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; } dirty = true; };
  new ResizeObserver(fit).observe(cvs);
  const mc = ui.mc, mctx = mc.getContext('2d'); const MINI = 244; { const d = quality.level === 'ultra' || quality.level === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1; mc.width = MINI * d; mc.height = MINI * d; mc.dpr = d; }
  let xf = null;                                      // last draw's world<->screen helpers

  function drawMap() {
    if (!mapper) { ctx2.fillStyle = '#0e1522'; ctx2.fillRect(0, 0, cvs.width, cvs.height); ctx2.fillStyle = '#8d9bbd'; ctx2.font = '16px system-ui'; ctx2.fillText(loadErr ? 'Map data failed to load' : 'Loading map data…', 40, 60); return; }
    const c = carState();
    xf = mapper.draw(ctx2, CW, CH, view, { dpr, satellite: sat, route, routeFrom: route ? prog.idx : 0, car: c, pin: sel, dest: dest, search, players: drive.players, playerLabels: true });
    // scale bar
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; let L = nice[0]; for (const n of nice) if (n / view.mpp <= 130) L = n;
    ui.scale.innerHTML = `${L >= 1000 ? L / 1000 + ' km' : L + ' m'}<i style="width:${(L / view.mpp).toFixed(0)}px;margin-left:auto"></i>`;
  }

  // ------------------------------------------------------------------ open / close
  function setOpen(v) {
    if (v && !nav && !loadErr) toast('Map data is still loading…');
    open = v; ui.map.classList.toggle('on', v); drive.uiLock = v;
    if (v) {
      const c = carState(); const t = sel ?? c ?? { x: 0, z: 0 };
      view.cx = t.x; view.cz = t.z; if (!sel) view.mpp = Math.min(view.mpp, 2.2); fly = null; fit(); renderList(); setTimeout(() => { ui.q.focus(); ui.q.select(); }, 30);
    } else { ui.q.blur(); document.activeElement?.blur?.(); }
    dirty = true;
  }
  const flyTo = (x, z, mpp = view.mpp, dur = 0.55) => { fly = { t: 0, dur, a: { cx: view.cx, cz: view.cz, mpp: view.mpp }, b: { cx: x, cz: z, mpp } }; };
  ui.open.onclick = () => setOpen(true); ui.close.onclick = () => setOpen(false); ui.mini.onclick = () => setOpen(true);
  ui.zin.onclick = () => zoomAt(CW / 2, CH / 2, 0.6); ui.zout.onclick = () => zoomAt(CW / 2, CH / 2, 1 / 0.6);
  ui.loc.onclick = () => { const c = carState(); if (c) flyTo(c.x, c.z, Math.min(view.mpp, 1.6)); };
  ui.lMap.onclick = () => setLayer(false); ui.lSat.onclick = () => setLayer(true);
  function setLayer(s) { sat = s; ui.lMap.classList.toggle('on', !s); ui.lSat.classList.toggle('on', s); if (s) mapper?.loadSat(() => { dirty = true; }); dirty = true; }

  // pan / zoom / pick
  function zoomAt(px, py, f) {
    const before = xf?.toWorld(px, py) ?? [view.cx, view.cz]; view.mpp = Math.max(0.3, Math.min(26, view.mpp * f)); fly = null;
    // keep the world point under the cursor fixed
    view.cx += before[0] - ((px - CW / 2) * view.mpp + view.cx); view.cz += before[1] - ((py - CH / 2) * view.mpp + view.cz); dirty = true;
  }
  let drag = null;
  cvs.addEventListener('pointerdown', e => { cvs.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false }; cvs.classList.add('drag'); fly = null; });
  cvs.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; view.cx = drag.cx - dx * view.mpp; view.cz = drag.cz - dy * view.mpp; dirty = true; });
  cvs.addEventListener('pointerup', e => {
    cvs.classList.remove('drag'); const d = drag; drag = null; if (!d || d.moved || !xf || !search) return;
    const r = cvs.getBoundingClientRect(), [wx, wz] = xf.toWorld(e.clientX - r.left, e.clientY - r.top);
    const p = search.poiAt(wx, wz, 14 * view.mpp);
    if (p) select(p, false); else { const rg = search.reverse(wx, wz); select({ kind: 'pin', x: wx, z: wz, title: rg.title, sub: rg.sub }, false); }
  });
  cvs.addEventListener('dblclick', e => { const r = cvs.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 0.5); });
  cvs.addEventListener('wheel', e => { e.preventDefault(); const r = cvs.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(e.deltaY * 0.0016)); }, { passive: false });

  // ------------------------------------------------------------------ search UI
  const distText = (x, z) => { const o = origin(); return fmtDist(Math.hypot(x - o.x, z - o.z)); };
  function rowHTML(r, i) { return `<div class="nv-row${i === hi ? ' sel' : ''}" data-i="${i}"><div class="nv-ico">${catIcon(r.kind, r.cat)}</div><div style="min-width:0"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.sub || '')}</div></div><div class="d">${r.x !== undefined ? distText(r.x, r.z) : ''}</div></div>`; }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderList() {
    let h = '';
    if (listMode === 'results') {
      h += results.length ? (chipTitle ? `<div class="nv-h">${esc(chipTitle)} near you</div>` : '') + results.map(rowHTML).join('')
        : `<div class="nv-empty">No match in the offline map data.<br>${ui.q.value.trim().length >= 3 ? 'Press <b>Enter</b> to search online (Photon / OpenStreetMap).' : 'Try a street name, a house number (“Abovyan 12”) or a place.'}</div>`;
    } else {
      const home = places.map(p => ({ kind: 'place', title: p.name, sub: 'Quick place', x: p.x, z: p.z, cat: p.name.includes('Metro') ? 'metro' : '' }));
      results = [...home, ...recents.map(r => ({ ...r, sub: (r.sub ? r.sub + ' · ' : '') + 'Recent' }))];
      h += '<div class="nv-h">Quick places</div>' + results.slice(0, home.length).map(rowHTML).join('');
      if (recents.length) h += '<div class="nv-h">Recent</div>' + results.slice(home.length).map((r, k) => rowHTML(r, home.length + k)).join('');
    }
    ui.list.innerHTML = h;
  }
  ui.list.addEventListener('click', e => { const row = e.target.closest('.nv-row'); if (row) select(results[+row.dataset.i], true); });
  ui.list.addEventListener('mousemove', e => { const row = e.target.closest('.nv-row'); if (row && +row.dataset.i !== hi) { hi = +row.dataset.i; ui.list.querySelectorAll('.nv-row').forEach((el, k) => el.classList.toggle('sel', +el.dataset.i === hi)); } });
  function buildChips() { ui.chips.innerHTML = CHIP_NAMES.map((n, i) => `<span data-c="${i}">${n}</span>`).join(''); }
  ui.chips.addEventListener('click', e => { const c = e.target.closest('span'); if (!c || !search) return; const o = origin(); chipTitle = CHIP_NAMES[+c.dataset.c]; results = search.chip(+c.dataset.c, o.x, o.z, 12); listMode = 'results'; hi = -1; ui.q.value = ''; renderList(); });
  let qT = 0, online = null;
  ui.q.addEventListener('input', () => {
    clearTimeout(qT); chipTitle = ''; const q = ui.q.value.trim();
    if (!q) { listMode = 'home'; hi = -1; renderList(); return; }
    qT = setTimeout(() => { if (!search) return; const o = origin(); results = search.query(q, o.x, o.z, 9); listMode = 'results'; hi = results.length ? 0 : -1; renderList(); }, 60);
  });
  ui.q.addEventListener('keydown', async e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!results.length) return; hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; renderList(); ui.list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') {
      clearTimeout(qT); const q = ui.q.value.trim(); if (!search) return;
      if (q && listMode === 'results') { const o = origin(); results = search.query(q, o.x, o.z, 9); }
      if (results[Math.max(0, hi)] && (listMode === 'home' || results.length)) { select(results[Math.max(0, hi)], true); return; }
      if (q.length >= 3) {
        online?.abort(); online = new AbortController(); ui.list.innerHTML = '<div class="nv-empty">Searching online…</div>';
        try { results = await onlineSearch(q, online.signal); listMode = 'results'; hi = results.length ? 0 : -1; renderList(); if (!results.length) toast('Nothing found'); } catch (err) { if (err.name !== 'AbortError') { ui.list.innerHTML = '<div class="nv-empty">Online search failed (offline?).</div>'; } }
      }
    }
  });

  // ------------------------------------------------------------------ selection card
  function select(r, fromList) {
    if (!r) return;
    let { x, z } = r; let outside = false;
    if (r.kind === 'online') { [x, z] = project(r.lat, r.lon); }
    if (nav) { const R = nav.region; outside = x < R.x0 + REGION_PAD || x > R.x1 - REGION_PAD || z < R.z0 + REGION_PAD || z > R.z1 - REGION_PAD; }
    sel = { ...r, x, z, outside };
    if (!outside) drive.prefetch?.(x, z);
    if (fromList && r.kind !== 'pin') { recents = [{ kind: r.kind === 'place' ? 'place' : r.kind, title: r.title, sub: (r.sub || '').replace(/ · Recent$/, '').replace(/^Quick place$/, ''), x, z, cat: r.cat }, ...recents.filter(q => q.title !== r.title)].slice(0, 6); try { localStorage.setItem('nv.recent', JSON.stringify(recents)); } catch { /* ignore */ } }
    w3.pin.set(x, z);
    flyTo(x, z, Math.min(view.mpp, fromList ? 1.4 : view.mpp)); showCard(); dirty = true;
  }
  function showCard() {
    if (!sel) { ui.card.classList.remove('on'); return; }
    const snap = nav?.snap(sel.x, sel.z, 400); const o = origin(), d = Math.hypot(sel.x - o.x, sel.z - o.z);
    ui.card.innerHTML = `<h3>${esc(sel.title)}</h3><div class="sub">${esc(sel.sub || '')}</div>
      <div class="acts"><button class="nv-btn go" data-a="nav" ${sel.outside || !snap ? 'disabled' : ''}>➤ Navigate</button><button class="nv-btn pri" data-a="view">🎥 View in 3D</button><button class="nv-btn" data-a="tp" ${sel.outside || !snap ? 'disabled' : ''}>⚡ Teleport car</button><button class="nv-btn" data-a="clear">Clear</button></div>
      <div class="info">${fmtDist(d)} from the car${snap ? ` · nearest road: ${esc(snap.name || catRoad(snap.cls))} (${Math.round(snap.dist)} m)` : ''}${sel.outside ? '<br><b>Outside the drivable area</b> — you can still look at it in 3D.' : ''}</div>`;
    ui.card.classList.add('on');
  }
  const catRoad = c => ['motorway', 'trunk road', 'main road', 'road', 'road', 'road', 'street', 'living street', 'service road', 'path'][c] ?? 'road';
  ui.card.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !sel) return; ({ nav: () => navigateTo(sel), view: () => show3D(sel), tp: () => teleportTo(sel), clear: clearSelection })[b.dataset.a]?.(); });
  function clearSelection() { sel = null; w3.pin.hide(); showCard(); dirty = true; }

  // ------------------------------------------------------------------ actions
  function navigateTo(t) {
    const c = carState(); if (!nav || !c) return toast('Car not ready');
    const r = nav.route({ x: c.x, z: c.z, heading: c.heading }, t); if (!r) return toast('No route found');
    startRoute(r, t); setOpen(false); if (!drive.active) drive.set(true);
  }
  function startRoute(r, t) {
    route = r; dest = { x: t.x, z: t.z, title: t.title }; prog = { s: 0, idx: 0, off: 0 }; offT = 0; spoken = new Set(); arrivedT = 0; lastMan = null;
    w3.setRoute(r); w3.dest.set(t.x, t.z); w3.pin.hide(); sel = null; showCard();
    toast(`Route: ${fmtDist(r.len)} · ${fmtTime(r.time)}`, 2600); say(`Route started. ${fmtDist(r.len).replace('km', 'kilometres').replace(' m', ' metres')}.`);
  }
  function clearRoute(msg) { route = null; dest = null; w3.setRoute(null); w3.dest.hide(); ui.turn.classList.remove('on'); if (msg) toast(msg); dirty = true; try { speechSynthesis.cancel(); } catch { /* */ } }
  function teleportTo(t) {
    if (!nav || !drive.car) return; const s = nav.snap(t.x, t.z, 400); if (!s) return toast('No road nearby');
    const toward = Math.atan2(t.x - s.x, t.z - s.z); let h = s.heading; if (!s.oneway && Math.cos(h - toward) < 0 && Math.hypot(t.x - s.x, t.z - s.z) > 20) h += Math.PI;
    drive.prefetch?.(s.x, s.z); drive.car.teleport(s.x, s.z, h); setOpen(false); if (!drive.active) drive.set(true); toast(`Teleported to ${t.title}`);
  }
  function show3D(t) { setOpen(false); drive.lookAt?.(t.x, t.z, 240); toast(`${t.title} — press Tab to return to the car`, 3500); }

  // ------------------------------------------------------------------ keyboard
  ui.map.addEventListener('keydown', e => {
    e.stopPropagation(); if (e.key === 'Escape') { if (e.target === ui.q && ui.q.value) { ui.q.value = ''; listMode = 'home'; renderList(); } else setOpen(false); }
    else if (e.code === 'KeyF' && e.target !== ui.q) setOpen(false);
    else if (e.code === 'KeyX' && e.target !== ui.q) { clearRoute('Route cancelled'); showCard(); }
  });
  ui.map.addEventListener('keyup', e => e.stopPropagation());
  addEventListener('keydown', e => {
    if (open) { if (e.code === 'Escape' || e.code === 'KeyF') setOpen(false); else if (e.code === 'KeyX' && !e.target?.closest?.('input,textarea')) { clearRoute('Route cancelled'); showCard(); } return; }      // (events from the search box are stopped at the overlay; these come from the gamepad / body)
    if (e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input,textarea')) return;
    if (e.code === 'KeyF' || e.code === 'Slash') { e.preventDefault(); setOpen(true); }
    else if (e.code === 'KeyX' && route) clearRoute('Route cancelled');
  });

  // ------------------------------------------------------------------ route tracking
  function track(dt, c) {
    const P = route.pts, n = P.length / 2, cum = route.cum;
    const test = i => { const ax = P[i * 2], az = P[i * 2 + 1], dx = P[i * 2 + 2] - ax, dz = P[i * 2 + 3] - az, l2 = dx * dx + dz * dz || 1e-6; const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / l2)); return [t, (c.x - ax - dx * t) ** 2 + (c.z - az - dz * t) ** 2]; };
    let bd = 1e18, bi = prog.idx, bt = 0;
    for (let i = Math.max(0, prog.idx - 2); i <= Math.min(n - 2, prog.idx + 30); i++) { const [t, d] = test(i); if (d < bd) { bd = d; bi = i; bt = t; } }
    if (bd > 60 * 60) for (let i = 0; i < n - 1; i++) { const [t, d] = test(i); if (d < bd) { bd = d; bi = i; bt = t; } }
    prog.idx = bi; prog.off = Math.sqrt(bd); prog.s = cum[bi] + bt * (cum[bi + 1] - cum[bi]);
    const remain = route.len - prog.s, now = performance.now() / 1000;
    // off route -> re-route
    if (prog.off > 30) offT += dt; else offT = Math.max(0, offT - dt * 2);
    if (offT > 1.6 && now - rerouteAt > 3 && c.speed > 1.5) {
      rerouteAt = now; const r = nav.route({ x: c.x, z: c.z, heading: c.heading }, dest);
      if (r) { route = r; prog = { s: 0, idx: 0, off: 0 }; offT = 0; spoken = new Set(); w3.setRoute(r); toast('Recalculating…', 1400); say('Recalculating.'); } else toast('No route from here', 1500);
      return;
    }
    // arrival
    if (remain < 24) { if (!arrivedT) { arrivedT = now; toast(`You have arrived — ${dest.title}`, 4500); say('You have arrived.'); } if (now - arrivedT > 6) clearRoute(); return; }
    // next manoeuvre
    const m = route.maneuvers.find(q => q.s > prog.s + 2) ?? route.maneuvers[route.maneuvers.length - 1], dm = Math.max(0, m.s - prog.s);
    if (m !== lastMan) { lastMan = m; ui.ico.innerHTML = maneuverIcon(m.type, m.exit); }
    ui.dist.textContent = fmtDist(dm); ui.txt.textContent = maneuverText(m);
    ui.rem.textContent = fmtDist(remain); ui.eta.textContent = fmtTime(route.time * remain / route.len + 5); ui.via.textContent = ''; ui.bar.style.width = (100 * prog.s / route.len).toFixed(1) + '%';
    // voice prompts
    const key = (lvl) => route.maneuvers.indexOf(m) * 10 + lvl, txt = maneuverText(m); const low = txt.charAt(0).toLowerCase() + txt.slice(1);
    for (const [lvl, d0, pre] of [[0, 520, 1], [1, 190, 1], [2, 55, 0]]) if (dm < d0 && dm > d0 * 0.45 && !spoken.has(key(lvl))) { for (let l = 0; l <= lvl; l++) spoken.add(key(l)); if (m.type !== 'arrive' || lvl > 0) say(pre ? `In ${Math.round(dm / 50) * 50} metres, ${low}` : txt); break; }
  }

  // ------------------------------------------------------------------ per-frame
  const v3 = new THREE.Vector3();
  function update(dt, cam, time) {
    if (!nav) { ui.open.style.display = open ? 'none' : 'flex'; return; }
    const c = carState(), driving = drive.active;
    w3.pin.update(cam, time); w3.dest.update(cam, time);
    if (route && c) { track(dt, c); w3.updateRibbon(prog.s, dt); }
    ui.open.style.display = open || driving ? 'none' : 'flex';
    ui.hud.classList.toggle('on', driving && !open);
    ui.turn.classList.toggle('on', !!route && driving && !open);
    // minimap
    if (driving && !open && c && (miniT -= dt) <= 0) {
      miniT = 1 / MINI_HZ; const target = 0.6 + c.speed * 0.034; miniMpp += (target - miniMpp) * 0.12; const rot = c.heading - Math.PI;
      mapper.draw(mctx, MINI, MINI, { cx: c.x, cz: c.z, mpp: miniMpp, rot }, { dpr: mc.dpr, anchorY: 0.62, route, routeFrom: route ? prog.idx : 0, car: c, pois: false, dest, search: null, players: drive.players });
      if ((streetT -= 1 / MINI_HZ) <= 0) { streetT = 0.5; ui.street.textContent = nav.streetAt(c.x, c.z, 40) || '—'; }
      ui.mini.firstElementChild.nextElementSibling.style.cssText = `left:${(122 + 106 * Math.sin(rot)).toFixed(1)}px;top:${(122 - 106 * Math.cos(rot)).toFixed(1)}px;transform:translate(-50%,-50%)`;
    }
    // full map
    if (open) {
      const pd = drive.pad;                                    // gamepad: left stick pans, RT zooms in, LT zooms out
      if (pd?.connected && (pd.lx || pd.ly || pd.rt || pd.lt)) { fly = null; view.cx += pd.lx * view.mpp * 520 * dt; view.cz += pd.ly * view.mpp * 520 * dt; view.mpp = Math.max(0.3, Math.min(26, view.mpp * Math.exp((pd.lt - pd.rt) * 1.8 * dt))); dirty = true; }
      if (fly) { fly.t += dt; const k = Math.min(1, fly.t / fly.dur), e = k * k * (3 - 2 * k); view.cx = fly.a.cx + (fly.b.cx - fly.a.cx) * e; view.cz = fly.a.cz + (fly.b.cz - fly.a.cz) * e; view.mpp = fly.a.mpp * Math.pow(fly.b.mpp / fly.a.mpp, e); if (k >= 1) fly = null; dirty = true; }
      if ((drawT -= dt) <= 0) { drawT = 0.3; dirty = true; }
      if (dirty) { dirty = false; drawMap(); }
    }
    // floating label above the destination / selected place
    const tgt = dest ?? sel; const tag = ui.tag;
    if (tgt && !open) {
      v3.set(tgt.x, groundY(tgt.x, tgt.z) + 38, tgt.z).project(cam);
      if (v3.z < 1 && Math.abs(v3.x) < 1.15 && Math.abs(v3.y) < 1.15) {
        tag.style.display = 'block'; tag.style.left = ((v3.x * 0.5 + 0.5) * innerWidth).toFixed(0) + 'px'; tag.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight).toFixed(0) + 'px';
        const o = origin(); const html = `${esc(tgt.title)}<small>${fmtDist(Math.hypot(tgt.x - o.x, tgt.z - o.z))}${dest ? ' · destination' : ''}</small>`; if (tag.dataset.h !== html) { tag.dataset.h = html; tag.innerHTML = html; }
      } else tag.style.display = 'none';
    } else tag.style.display = 'none';
  }

  window.__nav = { get nav() { return nav; }, get mapper() { return mapper; }, get search() { return search; }, get route() { return route; }, get prog() { return prog; }, select, setOpen, navigateTo, teleportTo, show3D, view, clearRoute, w3, ui, get sel() { return sel; }, setLayer };
  return { update };
}
