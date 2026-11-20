// Easy multiplayer: every browser tab is a player and everybody sees everybody's car (ghost cars: no collisions between players).
//   Transport = serverless WebRTC (Trystero, public Nostr relays used only for the handshake) + BroadcastChannel for tabs of the same browser.
//   No backend, so it works on a static host (Netlify). Everyone lands in room "public"; ?room=name makes a private one, ?mp=0 turns it off.
// Each tab sends its car state at 15 Hz; remote cars are rendered ~130 ms in the past and interpolated.
import { joinRoom } from 'trystero';

const APP_ID = 'yerevan-drift-map-v1';
const SEND_HZ = 15, DELAY = 130, TIMEOUT = 5000, MAX_REMOTE = 24;
const CSS = `
#mp{position:fixed;left:22px;top:122px;z-index:6;font:600 12px/1.35 system-ui,Segoe UI,sans-serif;color:#e8ecff;text-shadow:0 1px 6px rgba(0,0,0,.7);min-width:190px;max-width:260px;pointer-events:none}
#mp .hd{display:flex;gap:8px;align-items:center;font-size:11px;letter-spacing:.1em;opacity:.8;margin-bottom:4px}
#mp .hd i{width:8px;height:8px;border-radius:50%;background:#ffb347;display:inline-block}#mp .hd i.ok{background:#35e08a}
#mp .row{display:flex;gap:8px;align-items:center;padding:3px 8px;border-radius:8px;background:rgba(10,14,24,.55);margin-bottom:3px}
#mp .row b{width:10px;height:10px;border-radius:50%;border:1.5px solid #fff;flex:none}
#mp .row span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mp .row em{font-style:normal;opacity:.65;font-size:11px}
#mp .me{pointer-events:auto;cursor:pointer}#mp .me:hover{background:rgba(40,60,110,.7)}
.mp-tag{position:fixed;left:0;top:0;z-index:5;pointer-events:none;transform:translate(-50%,-100%);padding:2px 9px;border-radius:99px;background:rgba(10,14,24,.72);border:1px solid rgba(255,255,255,.25);color:#fff;font:600 12px system-ui,sans-serif;white-space:nowrap;display:none}
.mp-tag small{opacity:.7;margin-left:6px;font-weight:500}
`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
const fmt = d => d < 950 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km';

export default async function ({ THREE, drive }) {
  const qs = new URLSearchParams(location.search);
  if (qs.get('mp') === '0') return {};
  const roomName = (qs.get('room') || 'public').slice(0, 32);
  const myId = Math.random().toString(36).slice(2, 10);
  let myName = (localStorage.getItem('mp.name') || '').slice(0, 16) || `Driver-${Math.floor(1000 + Math.random() * 9000)}`;

  // ------------------------------------------------------------------ UI
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.id = 'mp'; document.body.appendChild(panel);
  const players = new Map();                    // id -> { id, name, paint, snaps:[{t,a}], car, tag, seen, x, z, heading, lastSeq }
  drive.players = [];
  let linked = false, relayOk = false;

  // ------------------------------------------------------------------ transport
  let seq = 0, tr = null, bc = null;
  function handle(m) {
    if (!m || m.i === myId || !Array.isArray(m.a)) return;
    const now = performance.now(); let p = players.get(m.i);
    if (!p) { if (players.size >= MAX_REMOTE) return; p = { id: m.i, name: 'Driver', paint: 0, snaps: [], car: null, tag: null, seen: now, x: 0, z: 0, heading: 0, lastSeq: -1 }; players.set(m.i, p); linked = true; }
    if (m.s <= p.lastSeq && m.s > p.lastSeq - 1000) return;         // duplicate (arrived through both transports) or stale
    p.lastSeq = m.s; p.seen = now; if (m.n) p.name = String(m.n).slice(0, 16);
    if (m.p !== undefined && m.p !== p.paint) { p.paint = m.p; p.car?.setPaint(p.paint); }
    p.snaps.push({ t: now, a: m.a }); if (p.snaps.length > 24) p.snaps.shift();
  }
  if (qs.get('bc') !== '0') try { bc = new BroadcastChannel('yerevan-mp-' + roomName); bc.onmessage = e => handle(e.data); } catch { /* no BroadcastChannel */ }
  try {
    const room = joinRoom({ appId: APP_ID, identity: 'none' }, 'yd-' + roomName);
    tr = room.makeAction('s');
    tr.onMessage(data => handle(data));
    room.onPeerJoin(() => { relayOk = true; });
    room.onError?.(e => console.warn('[mp] room error', e));
    addEventListener('pagehide', () => { try { room.leave(); } catch { /* */ } });
  } catch (e) { console.warn('[mp] WebRTC transport unavailable, same-browser tabs only', e); }
  const send = msg => { try { bc?.postMessage(msg); } catch { /* */ } try { tr?.send(msg)?.catch?.(() => { }); } catch { /* */ } };

  // ------------------------------------------------------------------ per frame
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v3 = new THREE.Vector3(), fw = new THREE.Vector3();
  let sendT = 0, panelT = 0;
  const tagFor = p => { if (!p.tag) { p.tag = document.createElement('div'); p.tag.className = 'mp-tag'; document.body.appendChild(p.tag); } return p.tag; };
  function dropPlayer(p) { p.car?.dispose(); p.tag?.remove(); players.delete(p.id); }
  const col = hex => '#' + hex.toString(16).padStart(6, '0');

  function renderPanel() {
    const hex = drive.car?.paintHex ?? [], me = drive.car ? col(hex[drive.car.paint()] ?? 0x888888) : '#888';
    let h = `<div class="hd"><i class="${linked || relayOk ? 'ok' : ''}"></i>ONLINE · ${players.size + 1} · ROOM ${esc(roomName)}</div><div class="row me" title="Click to rename"><b style="background:${me}"></b><span>${esc(myName)} (you)</span></div>`;
    const cp = drive.car?.vehicle?.pos;
    for (const p of [...players.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10)) {
      h += `<div class="row"><b style="background:${col(hex[p.paint] ?? 0x888888)}"></b><span>${esc(p.name)}</span><em>${cp ? fmt(Math.hypot(p.x - cp.x, p.z - cp.z)) : ''}</em></div>`;
    }
    if (!players.size) h += `<div class="row" style="opacity:.7"><span>${relayOk || linked ? 'Waiting for other drivers…' : 'Looking for other drivers… (open the site in another tab)'}</span></div>`;
    panel.innerHTML = h;
  }
  panel.addEventListener('click', e => { if (!e.target.closest('.me')) return; const n = prompt('Your driver name', myName); if (n && n.trim()) { myName = n.trim().slice(0, 16); localStorage.setItem('mp.name', myName); renderPanel(); } });

  const sendState = () => { const dc = drive.car; if (!dc) return; const a = dc.netState().map((v, k) => k >= 3 && k <= 6 ? r4(v) : r2(v)); send({ i: myId, s: ++seq, a, n: myName, p: dc.paint() }); };
  // a hidden tab stops rendering (and driving) but keeps its parked car visible to the others
  let lastFrame = performance.now();
  setInterval(() => { if (performance.now() - lastFrame > 1200) sendState(); }, 1000);

  function update(dt, cam) {
    const dc = drive.car; if (!dc) return; const now = performance.now(); lastFrame = now;
    // ---- send our state
    sendT -= dt; if (sendT <= 0) { sendT = 1 / SEND_HZ; sendState(); }
    // ---- remote cars
    const rt = now - DELAY, list = [];
    for (const p of [...players.values()]) {
      if (now - p.seen > TIMEOUT) { dropPlayer(p); continue; }
      const sn = p.snaps; if (!sn.length) continue;
      if (!p.car) p.car = dc.makeRemote(p.paint);
      let i = sn.length - 1; while (i > 0 && sn[i].t > rt) i--;
      const A = sn[i].a, B = sn[i + 1]?.a; let k = 0, x, y, z;
      if (B) {
        const span = sn[i + 1].t - sn[i].t; k = span > 0 ? Math.min(1, Math.max(0, (rt - sn[i].t) / span)) : 1; if (Math.hypot(B[0] - A[0], B[2] - A[2]) > 25) k = 1;   // teleport / respawn: no sliding across the map
        x = A[0] + (B[0] - A[0]) * k; y = A[1] + (B[1] - A[1]) * k; z = A[2] + (B[2] - A[2]) * k; q1.set(A[3], A[4], A[5], A[6]); q2.set(B[3], B[4], B[5], B[6]); q1.slerp(q2, k);
      } else { const e = Math.min(0.35, Math.max(0, (rt - sn[i].t) / 1000)); x = A[0] + A[7] * e; y = A[1] + A[8] * e; z = A[2] + A[9] * e; q1.set(A[3], A[4], A[5], A[6]); }
      const car = p.car; car.root.position.set(x, y, z); car.root.quaternion.copy(q1);
      const L = sn[sn.length - 1].a; car.update(dt, { steer: L[10], wf: L[11], wr: L[12], brake: L[13] > 0.5 });
      fw.set(0, 0, 1).applyQuaternion(q1); p.x = x; p.z = z; p.heading = Math.atan2(fw.x, fw.z);
      // name tag
      const tag = tagFor(p); v3.set(x, y + 1.9, z).project(cam);
      const dist = Math.hypot(x - cam.position.x, z - cam.position.z);
      if (v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1 && dist < 600) {
        tag.style.display = 'block'; tag.style.left = ((v3.x * 0.5 + 0.5) * innerWidth).toFixed(0) + 'px'; tag.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight).toFixed(0) + 'px';
        const html = `${esc(p.name)}<small>${fmt(dist)}</small>`; if (tag.dataset.h !== html) { tag.dataset.h = html; tag.innerHTML = html; }
      } else tag.style.display = 'none';
      list.push({ id: p.id, name: p.name, x, z, heading: p.heading, color: col(dc.paintHex[p.paint] ?? 0x888888) });
    }
    drive.players = list;
    panelT -= dt; if (panelT <= 0) { panelT = 0.5; renderPanel(); }
  }
  window.__mp = { players, myId, get name() { return myName; }, send, handle };
  renderPanel();
  return { update };
}
