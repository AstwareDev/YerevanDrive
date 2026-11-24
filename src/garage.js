// Garage: a dedicated showroom (Sketchfab "warehouse" hall, public/garage/warehouse.glb) the menu's GARAGE button opens.
//   * the hall hangs far outside the map (ORIGIN), so it never touches the city: streaming keeps following the real player (drive.streamPos),
//     the hall is hidden again on exit and the world lighting / environment / shadow window are restored exactly
//   * the vehicle (car model of src/car.js or the Seahawk of src/heli.js) is shown on a turntable; its physics body stays parked in the world
//   * UI: centred vehicle switcher at the bottom (arrows / pills / keys), properties on the left (paint, finish, lights, stage, stats)
// Plug-in contract: default export async (ctx) => ({ update }).  Public API: drive.garage = { open({ onClose }), close(), isOpen, key(e) }.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { quality } from './quality.js';
import { CAR_PROFILES } from './car/profiles.js';

const ORIGIN = { x: 60000, y: 3000, z: 60000 };              // > camera.far from the city: the whole world is frustum-culled while the garage is open
const HALL = { x0: -16.5, x1: 17, z0: -26, z1: 8.2 };       // walkable box of the hall around the stage (camera never leaves it)
const PLATE_Y = 0.14;                                        // turntable top above the floor

const CSS = `
#gar{position:fixed;inset:0;z-index:41;display:none;color:#fff;font:500 14px/1.4 system-ui,'Segoe UI',sans-serif;user-select:none;pointer-events:none}
#gar.on{display:block}
#gar *{box-sizing:border-box}
#gar .scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.6) 22%,rgba(0,0,0,0) 46%),linear-gradient(0deg,rgba(0,0,0,.78) 0%,rgba(0,0,0,0) 30%),linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 14%)}
#gar .drag{position:absolute;inset:0;pointer-events:auto;cursor:grab}#gar .drag.dn{cursor:grabbing}
#gar .top{position:absolute;left:50%;top:22px;transform:translateX(-50%);text-align:center;pointer-events:none}
#gar .top b{display:block;font:800 13px system-ui,sans-serif;letter-spacing:.42em;text-transform:uppercase;opacity:.85;padding-left:.42em}
#gar .top span{display:block;margin-top:3px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:.45}
#gar .panel{position:absolute;left:44px;top:44px;bottom:44px;width:min(372px,92vw);display:flex;flex-direction:column;pointer-events:none}
#gar h2{margin:0;font:800 36px/1 system-ui,sans-serif;letter-spacing:-.02em;text-transform:uppercase}
#gar .sub{margin:5px 0 18px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.55}
#gar .scroll{flex:1;overflow:auto;padding-right:8px;pointer-events:auto}
#gar .scroll::-webkit-scrollbar{width:4px}#gar .scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3)}
#gar .lbl{margin:20px 0 10px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.55;display:flex;justify-content:space-between}
#gar .lbl:first-child{margin-top:0}#gar .lbl em{font-style:normal;opacity:.9;letter-spacing:.08em;text-transform:none;font-weight:700}
#gar .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:11px}
#gar .sw{aspect-ratio:1;border-radius:50%;border:2px solid rgba(255,255,255,.22);cursor:pointer;position:relative;transition:transform .15s,border-color .15s;overflow:hidden}
#gar .sw:hover{transform:scale(1.09)}#gar .sw.on{border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.22)}
#gar .sw.cu{background:conic-gradient(#f33,#fc3,#3f6,#3cf,#63f,#f3c,#f33)}
#gar .sw input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);opacity:0;cursor:pointer;padding:0;border:0}
#gar .seg{display:flex;border:1px solid rgba(255,255,255,.3)}
#gar .seg span{flex:1;text-align:center;padding:8px 6px;font:700 11px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.65);cursor:pointer}
#gar .seg span:hover{background:rgba(255,255,255,.12)}#gar .seg span.on{background:#fff;color:#000}
#gar .stat{display:grid;grid-template-columns:96px 1fr auto;align-items:center;gap:10px;margin:0 0 9px;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
#gar .stat i{display:block;height:4px;background:rgba(255,255,255,.16);position:relative}
#gar .stat i b{position:absolute;left:0;top:0;bottom:0;background:#fff;transition:width .5s cubic-bezier(.2,.8,.2,1)}
#gar .stat span{opacity:.55}#gar .stat u{text-decoration:none;font-weight:700;letter-spacing:.04em;min-width:74px;text-align:right}
#gar .btn{pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:10px;padding:12px 24px;background:#fff;color:#000;font:800 12px system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;border:0}
#gar .btn:hover{background:#d9d9d9}#gar .btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35)}#gar .btn.ghost:hover{background:rgba(255,255,255,.12)}
#gar .foot{padding-top:16px}
#gar .bar{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:12px;width:min(720px,60vw);pointer-events:none}
#gar .nm{display:flex;align-items:center;gap:22px}
#gar .arrow{pointer-events:auto;cursor:pointer;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center;font:300 26px/1 system-ui,sans-serif;transition:background .15s,transform .15s;padding-bottom:3px}
#gar .arrow:hover{background:rgba(255,255,255,.18);transform:scale(1.07)}#gar .arrow:active{transform:scale(.94)}
#gar .ttl{text-align:center;min-width:min(380px,40vw)}
#gar .ttl small{display:block;font-size:11px;letter-spacing:.3em;text-transform:uppercase;opacity:.55}
#gar .ttl h1{margin:4px 0 2px;font:800 clamp(28px,3.4vw,46px)/1 system-ui,sans-serif;letter-spacing:-.025em;text-transform:uppercase;white-space:nowrap}
#gar .ttl p{margin:0;font-size:12px;letter-spacing:.08em;opacity:.6}
#gar .pills{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#gar .pill{pointer-events:auto;cursor:pointer;padding:8px 16px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.4);font:700 11px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.7);transition:background .15s,color .15s,border-color .15s}
#gar .pill:hover{background:rgba(255,255,255,.14);color:#fff}#gar .pill.on{background:#fff;color:#000;border-color:#fff}
#gar .keys{position:absolute;right:44px;bottom:36px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;text-align:right;line-height:1.9;pointer-events:none}
#gar .keys kbd{padding:1px 7px;margin:0 3px;border-radius:4px;background:rgba(255,255,255,.16);font:inherit}
#gar .busy{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:12px;letter-spacing:.3em;text-transform:uppercase;opacity:0;transition:opacity .2s;pointer-events:none}#gar .busy.on{opacity:.8}
@media (max-width:980px){#gar .keys{display:none}#gar .ttl p{display:none}}
`;

const hex6 = h => '#' + h.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = { get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } } };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// lighting presets of the hall (hemisphere + key light through the roof + the ceiling lamps over the stage)
const LIGHTS = {
  studio: { name: 'Studio', key: [0xffffff, 2.6], dir: [-0.38, 0.86, -0.34], hemi: [0xe4ecff, 0x2c2c32, 0.95], env: 1.15, lamps: [0xfff4e6, 0xfff4e6, 0xfff4e6, 0xfff4e6], lamp: 380, exposure: 1.0 },
  warm: { name: 'Warm', key: [0xffd2a0, 2.3], dir: [0.45, 0.62, -0.5], hemi: [0xffe3c4, 0x2e2018, 0.8], env: 0.95, lamps: [0xffb870, 0xffc88c, 0xffb870, 0xffc88c], lamp: 420, exposure: 1.0 },
  neon: { name: 'Neon', key: [0x8aa2ff, 1.5], dir: [-0.5, 0.7, 0.4], hemi: [0x6a58ff, 0x120a22, 0.55], env: 0.85, lamps: [0x3d8bff, 0xff2fa0, 0x3d8bff, 0xff2fa0], lamp: 520, exposure: 1.0 },
};

export default async function ({ THREE, scene, renderer, camera, tod, drive }) {
  const car = () => drive.car, heli = () => drive.heli;
  const root = document.createElement('div'); root.id = 'gar';
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root.innerHTML = `
    <div class="scrim"></div><div class="drag" id="g-drag"></div>
    <div class="top"><b>Garage</b><span id="g-count"></span></div>
    <div class="panel"><h2 id="g-h">Vehicle</h2><div class="sub" id="g-sub">Properties</div><div class="scroll" id="g-props"></div>
      <div class="foot"><div class="btn ghost" id="g-back">← Back</div></div></div>
    <div class="bar"><div class="nm"><div class="arrow" id="g-prev">‹</div><div class="ttl"><small id="g-kind"></small><h1 id="g-name"></h1><p id="g-desc"></p></div><div class="arrow" id="g-next">›</div></div>
      <div class="pills" id="g-pills"></div></div>
    <div class="keys"><kbd>←</kbd><kbd>→</kbd> switch vehicle<br>Drag rotate · wheel zoom<br><kbd>T</kbd> turntable &nbsp; <kbd>Esc</kbd> back</div>
    <div class="busy" id="g-busy">Loading…</div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);

  // ------------------------------------------------------------------ hall (lazy: the GLB is only fetched the first time the garage opens)
  const C = new THREE.Vector3(ORIGIN.x, ORIGIN.y, ORIGIN.z);
  const hall = new THREE.Group(); hall.name = 'garage-hall'; hall.position.copy(C); hall.visible = false; scene.add(hall);
  const stage = new THREE.Group(); stage.name = 'garage-stage'; hall.add(stage);
  {   // turntable
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PLATE_Y, 64), new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.85, roughness: 0.32 }));
    plate.position.y = PLATE_Y / 2; plate.receiveShadow = true; stage.add(plate);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.955, 1.0, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.4), toneMapped: false }));
    ring.position.y = PLATE_Y + 0.004; stage.add(ring);
    stage.userData = { plate, ring };
  }
  const lampMeshes = [];
  const lampPos = [[-4.2, 5.0, -3.4], [4.2, 5.0, -3.4], [-4.2, 5.0, 3.4], [4.2, 5.0, 3.4]];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.9, 2.6), toneMapped: false }));
    m.position.set(...lampPos[i]); m.position.y += 0.2; hall.add(m); lampMeshes.push(m);
  }
  let hallReady = null, studioEnv = null, compiled = false;
  function loadHall() {
    return hallReady ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/garage/warehouse.glb').then(g => {
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = false; o.receiveShadow = true; o.frustumCulled = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.side = THREE.DoubleSide; if ('envMapIntensity' in m) m.envMapIntensity = 0.7; if (m.metalness > 0.9 && !m.metalnessMap) m.metalness = 0.4; }
      });
      g.scene.name = 'garage-warehouse'; hall.add(g.scene);
      console.log('[garage] hall loaded');
    });
  }
  function buildStudioEnv() {
    if (studioEnv) return studioEnv;
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: 0x0c0d11, side: THREE.BackSide })));
    const panel = (w, h, x, y, z, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
    panel(26, 12, 0, 14.5, 0, 0xffffff, 7); panel(6, 14, -22, 6, 0, 0xffffff, 4); panel(6, 14, 22, 6, 0, 0xfff1de, 4);
    panel(24, 3, 0, 4, -27, 0xdfe8ff, 3.5); panel(24, 2.5, 0, 3, 27, 0xffffff, 2.6); panel(40, 40, 0, -14.5, 0, 0x2a2b30, 0.5);
    const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(s, 0.02, 0.1, 100, { size: quality.level === 'ultra' ? 256 : 128 }); pm.dispose();   // same cube size as the main env / live probe: no shader variant change
    s.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    return (studioEnv = rt.texture);
  }

  // ------------------------------------------------------------------ vehicles
  const list = [];
  function buildList() {
    list.length = 0;
    for (const c of car().cars) list.push({ id: c.id, kind: 'car', name: c.name, sub: c.sub, tag: 'Car' });
    if (heli()) list.push({ id: 'seahawk', kind: 'heli', name: heli().specs.name, sub: heli().specs.sub, tag: 'Helicopter' });
  }
  const curIdx = () => Math.max(0, drive.kind === 'heli' && heli() ? list.length - 1 : list.findIndex(v => v.id === car().carId()));

  // ------------------------------------------------------------------ state
  let isOpen = false, onClose = null, busy = false, token = 0, lightId = LS.get('yd.glight', 'studio'), turn = LS.get('yd.turn', '1') !== '0';
  if (!LIGHTS[lightId]) lightId = 'studio';
  const view = { az: 0.55, el: 0.2, dist: 6.4, tAz: 0.55, tEl: 0.2, tDist: 6.4, drag: false, idle: 0, yaw: 0.6, pop: 1 };
  const saved = {};                              // world state restored on exit
  const sp = new THREE.Vector3();                // streaming position while in the hall
  const tgt = new THREE.Vector3(), look = new THREE.Vector3(), right = new THREE.Vector3(), fwdH = new THREE.Vector3(), tmp = new THREE.Vector3();

  const isHeli = () => drive.kind === 'heli';
  function dims() { return isHeli() ? { min: 5.2, max: 13, d: 9.5, plate: 5.4, h: 1.7, scale: 0.62 } : { min: 3.2, max: 10, d: 6.4, plate: 3.7, h: 0.75, scale: 1 }; }

  // ------------------------------------------------------------------ enter / leave the hall
  function applyLight(id) {
    const L = LIGHTS[id], y = tod.light, c = L.key; lightId = id; LS.set('yd.glight', id);
    y.key.color.setHex(c[0]); y.key.intensity = c[1]; y.dir.set(...L.dir).normalize();
    y.hemi.color.setHex(L.hemi[0]); y.hemi.groundColor.setHex(L.hemi[1]); y.hemi.intensity = L.hemi[2];
    scene.environmentIntensity = L.env; renderer.toneMappingExposure = L.exposure;
    lampMeshes.forEach((m, i) => m.material.color.setHex(L.lamps[i]).multiplyScalar(3));
  }
  function enterScene() {
    const y = tod.light, moon = y.key, hemi = y.hemi, Y = window.__yerevan;
    Object.assign(saved, {
      camUpdate: drive.camUpdate, env: scene.environment, envI: scene.environmentIntensity, exposure: renderer.toneMappingExposure,
      moonCol: moon.color.getHex(), moonI: moon.intensity, dir: y.dir.clone(), hemiCol: hemi.color.getHex(), hemiG: hemi.groundColor.getHex(), hemiI: hemi.intensity,
      shadow: { l: moon.shadow.camera.left, r: moon.shadow.camera.right, t: moon.shadow.camera.top, b: moon.shadow.camera.bottom, nb: moon.shadow.normalBias, bias: moon.shadow.bias },
      probe: Y?.probe ? Y.probe.enabled : null, day: tod.day, fov: camera.fov,
    });
    camera.fov = 46; camera.updateProjectionMatrix();
    hall.visible = true;
    scene.environment = buildStudioEnv(); if (Y?.probe) Y.probe.enabled = false;
    const sh = moon.shadow; Object.assign(sh.camera, { left: -18, right: 18, top: 18, bottom: -18 }); sh.camera.updateProjectionMatrix(); sh.normalBias = 0.03; sh.bias = -0.0006;
    applyLight(lightId);
    drive.camUpdate = garageCam; drive.streamPos = sp;
    document.body.classList.add('yd-garage');
  }
  function leaveScene() {
    const y = tod.light, moon = y.key, hemi = y.hemi, Y = window.__yerevan;
    hall.visible = false; drive.streamPos = null; drive.camUpdate = saved.camUpdate;
    scene.environment = saved.env; scene.environmentIntensity = saved.envI; renderer.toneMappingExposure = saved.exposure;
    moon.color.setHex(saved.moonCol); moon.intensity = saved.moonI; y.dir.copy(saved.dir); hemi.color.setHex(saved.hemiCol); hemi.groundColor.setHex(saved.hemiG); hemi.intensity = saved.hemiI;
    const sh = moon.shadow, s = saved.shadow; Object.assign(sh.camera, { left: s.l, right: s.r, top: s.t, bottom: s.b }); sh.camera.updateProjectionMatrix(); sh.normalBias = s.nb; sh.bias = s.bias;
    if (Y?.probe && saved.probe !== null) Y.probe.enabled = saved.probe;
    for (const l of drive.lampLights ?? []) { l.color.setHex(0xffb36b); l.intensity = 0; l.distance = 34; }
    car()?.showcase(false); heli()?.showcase(false); car()?.setVisible(!(drive.kind === 'heli' && heli()?.spawned)); camera.fov = saved.fov; camera.updateProjectionMatrix();
    document.body.classList.remove('yd-garage');
    Y?.setTod(saved.day);                                         // re-applies the world lighting (also the lamp colours / sky) from the saved time of day
  }

  // ------------------------------------------------------------------ camera (menu.js hands the camera over: drive.camUpdate while the garage is open)
  function garageCam(dt, cam) {
    const D = dims();
    if (turn) { view.yaw += dt * 0.32; }
    view.idle += dt;
    const k = 1 - Math.exp(-dt * 7);
    view.az += (view.tAz - view.az) * k; view.el += (view.tEl - view.el) * k; view.dist += (view.tDist - view.dist) * k;
    view.pop = Math.min(1, view.pop + dt * 2.6);
    // vehicle placed on the turntable
    const e = 1 - Math.pow(1 - view.pop, 3), floor = C.y + PLATE_Y;
    const yaw = view.yaw + (1 - e) * 0.9, lift = (1 - e) * 0.0;
    if (isHeli()) heli()?.showcase(true, { x: C.x, y: floor + lift, z: C.z, yaw, scale: D.scale * (0.9 + 0.1 * e) });
    else car()?.showcase(true, { x: C.x, y: floor + lift, z: C.z, yaw, scale: 0.9 + 0.1 * e });
    stage.scale.set(D.plate, 1, D.plate);
    // orbit around the vehicle; the vehicle sits right of the centre (the property panel covers the left)
    tgt.set(C.x, floor + D.h, C.z);
    const cp = Math.cos(view.el), s = Math.sin(view.az), c = Math.cos(view.az);
    cam.position.set(tgt.x + s * cp * view.dist, tgt.y + Math.sin(view.el) * view.dist, tgt.z + c * cp * view.dist);
    cam.position.x = clamp(cam.position.x, C.x + HALL.x0, C.x + HALL.x1); cam.position.z = clamp(cam.position.z, C.z + HALL.z0, C.z + HALL.z1); cam.position.y = Math.max(cam.position.y, floor + 0.35);
    right.set(c, 0, -s);
    const hw = Math.tan(cam.fov * Math.PI / 360) * cam.aspect * tmp.copy(cam.position).distanceTo(tgt);
    const shift = cam.aspect > 1.15 ? 0.14 : 0.03;             // fraction of the view width the vehicle moves right of the centre
    look.copy(tgt).addScaledVector(right, -shift * hw * 2);
    cam.lookAt(look);
    // the main loop centres the shadow window 45 m in front of the focus: aim that point at the stage so the (small, sharp) hall shadow map covers the vehicle
    cam.getWorldDirection(fwdH); fwdH.y = 0; if (fwdH.lengthSq() > 1e-6) fwdH.normalize();
    drive.focus.copy(C).addScaledVector(fwdH, -45);
    const v = isHeli() ? heli()?.pos : car()?.vehicle.pos; if (v) sp.set(v.x, v.y, v.z);
  }
  { // orbit input
    const d = $('g-drag'); let lx = 0, ly = 0;
    d.addEventListener('pointerdown', e => { view.drag = true; lx = e.clientX; ly = e.clientY; d.classList.add('dn'); d.setPointerCapture(e.pointerId); });
    d.addEventListener('pointermove', e => { if (!view.drag) return; view.tAz -= (e.clientX - lx) * 0.0075; view.tEl = clamp(view.tEl + (e.clientY - ly) * 0.0042, 0.02, 1.12); lx = e.clientX; ly = e.clientY; });
    const up = () => { view.drag = false; d.classList.remove('dn'); };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    d.addEventListener('wheel', e => { e.preventDefault(); const D = dims(); view.tDist = clamp(view.tDist * (e.deltaY > 0 ? 1.1 : 0.9), D.min, D.max); }, { passive: false });
  }

  // ------------------------------------------------------------------ UI
  function statRow(label, frac, text) { return `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(clamp(frac, 0.03, 1) * 100)}%"></b></i><u>${text}</u></div>`; }
  function carStats(id) {
    const p = CAR_PROFILES[id]?.phys; if (!p) return '';
    let hp = 0, nm = 0; for (const [rpm, t] of p.torque) { hp = Math.max(hp, t * rpm * Math.PI / 30 / 745.7); nm = Math.max(nm, t); }
    const gear = p.ratios[p.ratios.length - 1] * p.final, vGear = p.redline * Math.PI / 30 * p.R / gear, vDrag = Math.cbrt(2 * hp * 745.7 * 0.85 / (1.2 * p.cdA));
    const top = Math.min(vGear, vDrag) * 3.6, pw = hp / p.mass * 1000;
    return statRow('Power', hp / 1000, Math.round(hp) + ' hp') + statRow('Torque', nm / 900, Math.round(nm) + ' Nm') + statRow('Weight', 1 - (p.mass - 1200) / 900, Math.round(p.mass) + ' kg') +
      statRow('Power / wt', pw / 650, Math.round(pw) + ' hp/t') + statRow('Top speed', top / 400, '≈ ' + Math.round(top / 5) * 5 + ' km/h') + statRow('Redline', p.redline / 9500, p.redline + ' rpm');
  }
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<span data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</span>`).join('')}</div>`;
  function stageSection() {
    return `<div class="lbl">Showroom light</div>${seg('g-light', Object.entries(LIGHTS).map(([k, v]) => [k, v.name]), lightId)}
      <div class="lbl">Turntable</div>${seg('g-turn', [[1, 'Spin'], [0, 'Still']], turn ? 1 : 0)}`;
  }
  function renderProps() {
    const v = list[curIdx()]; if (!v) return; const el = $('g-props');
    if (v.kind === 'car') {
      const c = car(), cur = c.customHex() === null ? c.paint() : -1, name = c.customHex() === null ? c.paints[cur].name : 'Custom ' + hex6(c.customHex()).toUpperCase();
      el.innerHTML = `<div class="lbl">Paint <em>${esc(name)}</em></div>
        <div class="grid" id="g-paint">${c.paints.map((p, i) => `<div class="sw${i === cur ? ' on' : ''}" data-i="${i}" title="${esc(p.name)}" style="background:${hex6(p.hex === 0x07080b ? 0x15161a : p.hex)}"></div>`).join('')}
          <div class="sw cu${cur === -1 ? ' on' : ''}" title="Custom colour"><input type="color" id="g-pick" value="${hex6(c.customHex() ?? c.paints[Math.max(0, c.paint())].hex)}"></div></div>
        <div class="lbl">Finish</div>${seg('g-finish', [['gloss', 'Gloss'], ['metallic', 'Metal'], ['satin', 'Satin'], ['matte', 'Matte']], c.finish())}
        <div class="lbl">Headlights</div>${seg('g-lights', [[1, 'On'], [0, 'Off']], c.lights() ? 1 : 0)}
        ${stageSection()}
        <div class="lbl">Performance</div>${carStats(v.id)}`;
      const sw = el.querySelectorAll('#g-paint .sw:not(.cu)'); sw.forEach(n => n.onclick = () => { c.setPaint(+n.dataset.i); LS.set('yd.paint', n.dataset.i); LS.del('yd.paintHex'); renderProps(); });
      const pick = el.querySelector('#g-pick'); pick.oninput = () => { const h = parseInt(pick.value.slice(1), 16); c.setPaintHex(h); LS.set('yd.paintHex', String(h)); el.querySelector('.lbl em').textContent = 'Custom ' + pick.value.toUpperCase(); el.querySelectorAll('#g-paint .sw').forEach(n => n.classList.toggle('on', n.classList.contains('cu'))); };
      bind('g-finish', val => { c.setFinish(val); LS.set('yd.finish', val); });
      bind('g-lights', val => c.setLights(val === '1'));
    } else {
      const h = heli(), S = h.specs, cur = h.livery();
      el.innerHTML = `<div class="lbl">Livery <em>${esc(cur < 0 ? 'Custom ' + hex6(h.customTint()).toUpperCase() : h.liveries[cur].name)}</em></div>
        <div class="grid" id="g-paint">${h.liveries.map((p, i) => `<div class="sw${i === cur ? ' on' : ''}" data-i="${i}" title="${esc(p.name)}" style="background:${hex6(p.swatch)}"></div>`).join('')}
          <div class="sw cu${cur === -1 ? ' on' : ''}" title="Custom colour"><input type="color" id="g-pick" value="${hex6(h.customTint() ?? 0x8a8f96)}"></div></div>
        <div class="lbl">Cabin &amp; nav lights</div>${seg('g-lights', [[1, 'On'], [0, 'Off']], h.lights() ? 1 : 0)}
        <div class="lbl">Rotor</div>${seg('g-rotor', [[0, 'Stopped'], [1, 'Idle'], [2, 'Flight']], h.showRotor())}
        ${stageSection()}
        <div class="lbl">Specifications</div>
        ${statRow('Top speed', S.vmax * 3.6 / 320, Math.round(S.vmax * 3.6 / 5) * 5 + ' km/h')}${statRow('Climb', S.climb / 14, S.climb + ' m/s')}${statRow('Weight', S.mass / 10000, S.mass.toLocaleString() + ' kg')}
        ${statRow('Rotor Ø', S.rotorD / 20, S.rotorD.toFixed(1) + ' m')}${statRow('Engines', 2 / 3, '2× T700')}${statRow('Crew', 3 / 4, '3 + 5 pax')}`;
      el.querySelectorAll('#g-paint .sw:not(.cu)').forEach(n => n.onclick = () => { h.setLivery(+n.dataset.i); LS.set('yd.heliPaint', n.dataset.i); LS.del('yd.heliHex'); renderProps(); });
      const pick = el.querySelector('#g-pick'); pick.oninput = () => { const x = parseInt(pick.value.slice(1), 16); h.setTint(x); LS.set('yd.heliHex', String(x)); LS.del('yd.heliPaint'); el.querySelector('.lbl em').textContent = 'Custom ' + pick.value.toUpperCase(); el.querySelectorAll('#g-paint .sw').forEach(n => n.classList.toggle('on', n.classList.contains('cu'))); };
      bind('g-lights', val => h.setLights(val === '1'));
      bind('g-rotor', val => h.setShowRotor(+val));
    }
    bind('g-light', val => { applyLight(val); });
    bind('g-turn', val => { turn = val === '1'; LS.set('yd.turn', val); });
  }
  function bind(id, fn) { const e = root.querySelector('#' + id); if (!e) return; [...e.children].forEach(n => n.onclick = () => { fn(n.dataset.v); [...e.children].forEach(m => m.classList.toggle('on', m === n)); }); }
  function renderBar() {
    const i = curIdx(), v = list[i]; if (!v) return;
    $('g-name').textContent = v.name; $('g-desc').textContent = v.sub; $('g-kind').textContent = `${v.tag} · ${i + 1} / ${list.length}`; $('g-count').textContent = `${list.length} vehicles`;
    $('g-h').textContent = v.kind === 'heli' ? 'Helicopter' : 'Car'; $('g-sub').textContent = v.kind === 'heli' ? 'Livery & lights' : 'Paint & performance';
    $('g-pills').innerHTML = list.map((x, k) => `<div class="pill${k === i ? ' on' : ''}" data-i="${k}">${esc(x.kind === 'heli' ? 'SH-60B' : x.name.replace(/^(BMW G87|Lamborghini|McLaren)\s*/, '').trim() || x.name)}</div>`).join('');
    [...$('g-pills').children].forEach(n => n.onclick = () => select(+n.dataset.i));
  }

  async function select(i) {
    const n = list.length; i = (i + n) % n; if (busy || i === curIdx()) return;
    const v = list[i], my = ++token; busy = true; $('g-busy').classList.add('on');
    try {
      if (v.kind === 'heli') { car().showcase(false); car().setVisible(false); await heli().ready; if (my !== token) return; drive.kind = 'heli'; heli().setVisible(true); }
      else { heli()?.showcase(false); heli()?.setVisible(false); heli()?.reset(); car().setVisible(false); const ok = await car().setCar(v.id); if (my !== token) return; drive.kind = 'car'; car().setVisible(true); if (!ok) console.warn('[garage] car switch refused'); }
      LS.set('yd.kind', drive.kind);
      const D = dims(); view.tDist = D.d; view.pop = 0; view.yaw += 0.5;
    } finally { busy = false; $('g-busy').classList.remove('on'); }
    renderBar(); renderProps();
  }
  $('g-prev').onclick = () => select(curIdx() - 1); $('g-next').onclick = () => select(curIdx() + 1);
  $('g-back').onclick = () => close();

  // ------------------------------------------------------------------ open / close
  async function open(o = {}) {
    if (isOpen || !car()) return;
    isOpen = true; onClose = o.onClose ?? null; token++; buildList(); root.classList.add('on'); $('g-busy').classList.add('on');
    renderBar(); renderProps();
    try { await loadHall(); } catch (e) { console.error('[garage] hall failed to load', e); }
    if (isOpen && !compiled) {                                       // compile the hall's (and the Seahawk's) shaders now, behind the Loading label, instead of freezing on the first frame
      compiled = true; const hg = heli()?.group, hv = hg?.visible; hall.visible = true; if (hg) hg.visible = true;
      try { await Promise.race([renderer.compileAsync(hall, camera, scene), new Promise(r => setTimeout(r, 6000))]); if (hg) await Promise.race([renderer.compileAsync(hg, camera, scene), new Promise(r => setTimeout(r, 3000))]); } catch (e) { console.warn('[garage] precompile', e); }
      hall.visible = false; if (hg) hg.visible = hv;
    }
    if (!isOpen) return;
    $('g-busy').classList.remove('on');
    const D = dims(); view.az = view.tAz = 0.55; view.el = view.tEl = 0.2; view.dist = view.tDist = D.d; view.pop = 0;
    enterScene();
    if (isHeli()) { car().setVisible(false); heli().setVisible(true); } else { heli()?.setVisible(false); car().setVisible(true); }
  }
  function close() {
    if (!isOpen) return; isOpen = false; token++; root.classList.remove('on');
    if (hall.visible) leaveScene();
    const cb = onClose; onClose = null; cb?.();
  }
  function key(e) {
    if (!isOpen) return;
    if (e.code === 'Escape' || e.code === 'Backspace' || e.code === 'Enter') { e.preventDefault(); close(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); select(curIdx() - 1); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); select(curIdx() + 1); }
    else if (e.code === 'KeyT') { turn = !turn; LS.set('yd.turn', turn ? '1' : '0'); renderProps(); }
  }

  // ceiling lamps: the pooled street-lamp point lights are re-purposed while the hall is open (main.js re-places them every 0.15 s, we win the same frame)
  const lampV = new THREE.Vector3();
  function update() {
    if (!isOpen || !hall.visible) return;
    const L = LIGHTS[lightId], pool = drive.lampLights ?? [];
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i]; if (i >= lampPos.length) { l.intensity = 0; continue; }
      lampV.set(...lampPos[i]).add(C); l.position.copy(lampV); l.color.setHex(L.lamps[i]); l.intensity = L.lamp; l.distance = 40;
    }
  }

  // restore the saved garage choices once the car + heli plug-ins have applied theirs
  setTimeout(() => {
    const c = car(); if (!c) return;
    if (LS.get('yd.kind') === 'heli' && heli()) drive.kind = 'heli';
    const f = LS.get('yd.finish'); if (f) c.setFinish(f);
    const hx = parseInt(LS.get('yd.paintHex', ''), 10); if (Number.isFinite(hx)) c.setPaintHex(hx);
    const h = heli();
    if (h) { const hh = parseInt(LS.get('yd.heliHex', ''), 10), hp = parseInt(LS.get('yd.heliPaint', ''), 10); if (Number.isFinite(hh)) h.setTint(hh); else if (Number.isFinite(hp)) h.setLivery(hp); }
  }, 400);

  drive.garage = { open, close, key, get isOpen() { return isOpen; } };
  return { update };
}
