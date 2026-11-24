// Flyable helicopter: Sikorsky SH-60B Seahawk (public/heli/seahawk.glb, built by tools/build-heli.mjs).
// Plug-in contract: default export async (ctx) => ({ update }).  Public API: drive.heli (used by src/menu.js and src/garage.js).
//
// Flight model (own rigid body, 120 Hz, no Rapier body): thrust along the rotor-disc normal (collective x rotor rpm^2, ground effect, translational lift,
// density falls with altitude), body-axis quadratic drag, main-rotor torque reaction, three spring-damper wheels with friction, hard points (nose, tail,
// fin, rotor tips) against terrain + roofs, and ray casts against the same Rapier building colliders the car uses (rotor strikes and hard hits crash it).
//   Body frame like the cars: x = left, y = up, z = forward (nose).  Euler YXZ: pitch + = nose down, roll + = banked right, yaw + = turning left.
// Controls (assist ON, default = attitude command + vertical-speed hold + coordinated turns; assist OFF = raw rate command + collective lever):
//   W/S cyclic pitch · A/D cyclic roll · Q/E (or Left/Right) pedals · Space/Up climb · Shift/Down descend · I engine · G assist · L lights · C camera · R respawn
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SPECS, G, COM, HUB_Y, ROTOR_R, createFlight, clamp, approach } from './heli/flight.js';

const DT = 1 / 120;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const LIVERIES = [
  { name: 'Navy Grey', swatch: 0x6c747d, tint: null },
  { name: 'Desert Tan', swatch: 0xc9a46b, tint: 0xc9a46b },
  { name: 'Forest Green', swatch: 0x44713c, tint: 0x44713c },
  { name: 'Arctic White', swatch: 0xe6e9ee, tint: 0xe6e9ee },
  { name: 'Night Black', swatch: 0x1a1b1f, tint: 0x2a2b30, k: 0.7 },
  { name: 'Rescue Orange', swatch: 0xe8641b, tint: 0xe8641b },
  { name: 'Royal Blue', swatch: 0x1f4fb4, tint: 0x2d5fd0 },
];

const CSS = `
#hl{position:fixed;inset:0;pointer-events:none;z-index:5;display:none;font:600 13px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#e8ecff;text-shadow:0 1px 6px rgba(0,0,0,.75)}
#hl.on{display:block}
#hl .hdg{position:absolute;left:50%;top:18px;transform:translateX(-50%);text-align:center}
#hl .hdg b{display:block;font-size:30px;font-weight:800;letter-spacing:.04em;line-height:1}
#hl .hdg span{font-size:11px;letter-spacing:.3em;opacity:.65}
#hl .tape{position:relative;width:300px;height:18px;margin:6px auto 0;overflow:hidden;border-bottom:1px solid rgba(255,255,255,.35);-webkit-mask-image:linear-gradient(90deg,transparent,#000 25%,#000 75%,transparent);mask-image:linear-gradient(90deg,transparent,#000 25%,#000 75%,transparent)}
#hl .tape div{position:absolute;top:0;white-space:nowrap;font-size:11px;letter-spacing:0}
#hl .tape div i{position:absolute;top:0;transform:translateX(-50%);font-style:normal;opacity:.85}
#hl .gauge{position:absolute;right:26px;bottom:22px;text-align:right}
#hl .kmh{font-size:64px;font-weight:800;letter-spacing:-.02em;line-height:1;color:#fff}#hl .kmh small{font-size:15px;font-weight:600;opacity:.7;margin-left:6px}
#hl .row{display:flex;gap:18px;justify-content:flex-end;margin-top:8px;font-size:15px}
#hl .row span{opacity:.6;font-size:11px;letter-spacing:.14em;margin-right:6px}
#hl .left{position:absolute;left:26px;bottom:150px;width:190px}
#hl .bar{margin-top:7px}#hl .bar label{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.14em;opacity:.8}
#hl .bar i{display:block;height:5px;background:rgba(255,255,255,.16);margin-top:3px;position:relative}#hl .bar i b{position:absolute;left:0;top:0;bottom:0;background:#fff}
#hl .flags{margin-top:12px;display:flex;gap:6px;flex-wrap:wrap}
#hl .flags b{padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.1);opacity:.4;font-size:11px;letter-spacing:.08em}#hl .flags b.on{opacity:1;background:#fff;color:#000}#hl .flags b.warn{opacity:1;background:#ff4a3a;color:#fff}
#hl .att{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);width:132px;height:132px;border-radius:50%;border:2px solid rgba(255,255,255,.55);overflow:hidden;background:#000;box-shadow:0 0 0 4px rgba(0,0,0,.35)}
#hl .att .hz{position:absolute;inset:-75%;background:linear-gradient(180deg,#2f6bb0 0,#79aee0 50%,#5a3f22 50%,#2e200f 100%)}
#hl .att .hl{position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;background:#fff}
#hl .att .fix{position:absolute;left:50%;top:50%;width:60px;height:2px;margin:-1px 0 0 -30px;background:#ffd23a}#hl .att .fix:after{content:'';position:absolute;left:28px;top:-3px;width:4px;height:8px;background:#ffd23a}
#hl .help{position:absolute;left:26px;bottom:18px;opacity:.65;font-size:11px;line-height:1.65;max-width:470px}
#hl .help kbd{padding:0 5px;border-radius:4px;background:rgba(255,255,255,.18);font:inherit}
#hl .toast{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);font-size:34px;font-weight:800;letter-spacing:.12em;opacity:0;transition:opacity .35s;text-align:center;white-space:nowrap}#hl .toast.on{opacity:1}
#hl .toast small{display:block;font-size:13px;letter-spacing:.2em;opacity:.7;margin-top:6px;font-weight:600}
`;

export default async function ({ THREE, scene, camera, tod, drive }) {
  const car = () => drive.car;
  if (!car()) return {};
  const { world, RAPIER, colliders, ground, vehicle } = car();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  // ------------------------------------------------------------------ model
  const hg = new THREE.Group(); hg.name = 'heli'; hg.visible = false; scene.add(hg);
  const rig = new THREE.Group(); rig.position.set(0, -COM.y, -COM.z); hg.add(rig);
  let body = null, pivot = null, mats = [], tintMats = [];
  const tail = new THREE.Group(), disc = { main: null, tail: null };
  const nav = { red: null, green: null, white: null, beacon: null };
  let lightsOn = true, showRotor = 1, liveryIdx = 0, customTint = null;
  const ready = loader.loadAsync('/heli/seahawk.glb').then(g => {
    body = g.scene.getObjectByName('body'); pivot = g.scene.getObjectByName('rotor_pivot');
    g.scene.traverse(o => {
      if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.side = THREE.DoubleSide; m.metalness = 0.15; m.roughness = Math.max(0.55, m.roughness); if ('envMapIntensity' in m) m.envMapIntensity = 0.9; if (!mats.includes(m)) mats.push(m); }
    });
    // exterior paint = the two non-cabin textures (the cabin interior keeps its own colours)
    tintMats = mats.filter(m => m.map && m.map.image && Math.max(m.map.image.width ?? 0, m.map.image.height ?? 0) >= 1024 && !/0044/.test(m.name));
    rig.add(g.scene);
    // procedural tail rotor (the source model has none): 4 blades on the left of the fin
    tail.position.set(0.5, 4.3, -10.15); rig.add(tail);
    const bm = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.2 });
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.7, 0.2), bm); b.rotation.x = i * Math.PI / 2; tail.add(b); }
    tail.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 10).rotateZ(Math.PI / 2), bm));
    const dm = new THREE.MeshBasicMaterial({ color: 0xa8b0ba, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    disc.main = new THREE.Mesh(new THREE.CircleGeometry(ROTOR_R, 56).rotateX(-Math.PI / 2), dm); pivot.add(disc.main); disc.main.renderOrder = 4;
    disc.tail = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24).rotateY(Math.PI / 2), dm.clone()); tail.add(disc.tail);
    // navigation lights
    const mk = (c, x, y, z, r = 0.09) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); s.position.set(x, y, z); rig.add(s); return s; };
    nav.red = mk(new THREE.Color(5, 0.2, 0.15), 1.75, 2.1, 0.6); nav.green = mk(new THREE.Color(0.1, 5, 0.6), -1.75, 2.1, 0.6);
    nav.white = mk(new THREE.Color(6, 6, 6), 0, 4.95, -10.3); nav.beacon = mk(new THREE.Color(6, 0.3, 0.2), 0, 0.55, -2.2, 0.12);
    applyLivery();
    console.log('[heli] model ready');
  });

  function applyLivery() {
    const L = customTint !== null ? { tint: customTint, k: 1 } : LIVERIES[liveryIdx];
    for (const m of tintMats) { if (L.tint === null) m.color.setRGB(1, 1, 1); else { m.color.setHex(L.tint).convertSRGBToLinear().multiplyScalar(1.9 * (L.k ?? 1)); } }
  }

  // ------------------------------------------------------------------ flight state (the maths lives in src/heli/flight.js)
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const heliSpawn = { x: 0, z: 0, heading: 0 };
  let active = false, collT = 0, rayT = 0, showOn = false, visible = false;
  const show = { x: 0, y: 0, z: 0, yaw: 0, scale: 1 };
  const P = new THREE.Vector3(), rW = new THREE.Vector3(), rB = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const flight = createFlight(THREE, { ground: (x, z) => ground.y(x, z), groundAt: (x, z, y, tall) => groundAt(x, z, y, tall), locked: () => !!drive.uiLock, crash: r => crash(r) });
  const { S, cmd, up, fwd, eul } = flight, q = S.q;

  function groundAt(x, z, y, tall = true) {
    let h = ground.y(x, z);
    if (tall) {                                             // roofs: nearest solid below the probe point
      ray.origin = { x, y: y + 0.8, z }; ray.dir = { x: 0, y: -1, z: 0 };
      const hit = world.castRay(ray, 14, true, undefined, undefined, undefined, vehicle.body);
      if (hit) h = Math.max(h, y + 0.8 - hit.timeOfImpact);
    }
    return h;
  }
  function spawnPose() {
    const v = vehicle.pos, f = vehicle.fwd; heliSpawn.x = v.x; heliSpawn.z = v.z; heliSpawn.heading = Math.atan2(f.x, f.z);
  }
  function respawn() {
    spawnPose(); const { x, z, heading } = heliSpawn, y = ground.y(x, z) + 62;
    drive.prefetch?.(x, z); colliders.prime(x, z);
    flight.place(x, y, z, heading); cam.reset = true; hg.visible = visible; explosion.visible = false;
  }
  function reset() { S.spawned = false; hg.visible = false; }

  // ------------------------------------------------------------------ input
  const down = new Set();
  addEventListener('keydown', e => {
    if (!active || e.target?.closest?.('input,textarea,[contenteditable]')) return;
    down.add(e.code);
    if (e.repeat || drive.uiLock) return;
    switch (e.code) {
      case 'KeyR': e.stopImmediatePropagation(); respawn(); toast('RESPAWN', 'Hovering above your car'); break;
      case 'KeyC': cam.mode = (cam.mode + 1) % CAMS.length; cam.reset = true; toast(CAMS[cam.mode], '', 0.8); break;
      case 'KeyI': S.engine = !S.engine; toast(S.engine ? 'ENGINE START' : 'ENGINE OFF', '', 1); audio.resume(); break;
      case 'KeyG': S.assist = !S.assist; if (!S.assist) S.col = clamp((G + 0) / (G * 1.95 * S.rpm * S.rpm || 1), 0, 1); toast(S.assist ? 'FLIGHT ASSIST ON' : 'FLIGHT ASSIST OFF', S.assist ? 'Attitude + altitude hold' : 'Raw cyclic / collective', 1.3); break;
      case 'KeyL': lightsOn = !lightsOn; break;
    }
  }, true);
  addEventListener('keyup', e => down.delete(e.code), true);
  addEventListener('blur', () => down.clear());
  const any = (...c) => c.some(k => down.has(k));
  function readInput(dt) {
    const pad = drive.pad, usePad = pad?.connected && (Math.abs(pad.lx) + Math.abs(pad.ly) + Math.abs(pad.rx ?? 0) + Math.abs(pad.ry ?? 0)) > 0.02;
    let p = (any('KeyW') ? 1 : 0) - (any('KeyS') ? 1 : 0), r = (any('KeyD') ? 1 : 0) - (any('KeyA') ? 1 : 0);
    let y = (any('KeyQ', 'ArrowLeft') ? 1 : 0) - (any('KeyE', 'ArrowRight') ? 1 : 0), l = (any('Space', 'ArrowUp') ? 1 : 0) - (any('ShiftLeft', 'ShiftRight', 'ArrowDown') ? 1 : 0);
    if (usePad) { p = p || -(pad.ry ?? 0); r = r || (pad.rx ?? 0); y = y || -pad.lx; l = l || -pad.ly; }
    if (drive.uiLock || !active || S.crashT > 0) { p = r = y = l = 0; }
    cmd.p = approach(cmd.p, p, 5, 9, dt); cmd.r = approach(cmd.r, r, 5, 9, dt); cmd.y = approach(cmd.y, y, 6, 9, dt); cmd.lift = approach(cmd.lift, l, 4.5, 8, dt);
  }

  // ------------------------------------------------------------------ physics
  function crash(reason) {
    if (S.crashT > 0) return; S.crashT = 3.2; S.crashMsg = reason; S.engine = false;
    const sp = window.__car?.sparks; sp?.burst(S.p.x, S.p.y, S.p.z, S.v.x * 0.3, 6, S.v.z * 0.3, 40);
    explosion.position.copy(S.p); explosion.visible = true; explosion.userData.t = 0; hudToast('HELICOPTER DESTROYED', reason, 3);
    audio.boom();
  }
  // probes: [model x, y, z, local direction x, y, z, length, isRotor] - four fuselage rays at cabin height + twelve rotor-disc rays at hub height
  const probes = [[0, 1.8, 0, 0, 0, 1, 5.2, 0], [0, 1.8, 0, 0, 0, -1, 10.8, 0], [0, 1.8, 0, 1, 0, 0, 2.4, 0], [0, 1.8, 0, -1, 0, 0, 2.4, 0]];
  for (let i = 0; i < 12; i++) probes.push([0, HUB_Y, 0, Math.cos(i * Math.PI / 6), 0, Math.sin(i * Math.PI / 6), ROTOR_R, 1]);
  function collide() {
    if (S.crashT > 0 || S.impactCool > 0) return;
    for (const pr of probes) {
      rB.set(pr[0], pr[1] - COM.y, pr[2] - COM.z); rW.copy(rB).applyQuaternion(q); P.copy(S.p).add(rW);
      tmp.set(pr[3], pr[4], pr[5]).applyQuaternion(q);
      ray.origin = { x: P.x, y: P.y, z: P.z }; ray.dir = { x: tmp.x, y: tmp.y, z: tmp.z };
      const h = world.castRayAndGetNormal(ray, pr[6], true, undefined, undefined, undefined, vehicle.body); if (!h) continue;
      const pen = pr[6] - h.timeOfImpact, n = h.normal;
      if (pr[7]) { if (S.rpm > 0.15) { crash('Rotor strike'); return; } continue; }
      const vn = -(S.v.x * n.x + S.v.y * n.y + S.v.z * n.z);
      if (vn > 6.5) { crash('Hit a building at ' + Math.round(vn * 3.6) + ' km/h'); return; }
      if (vn > 0) { S.v.x += n.x * vn * 1.25; S.v.y += n.y * vn * 1.25; S.v.z += n.z * vn * 1.25; S.p.x += n.x * Math.min(pen, 1); S.p.y += n.y * Math.min(pen, 1); S.p.z += n.z * Math.min(pen, 1); if (vn > 1.5) window.__car?.sparks?.burst(P.x + tmp.x * h.timeOfImpact, P.y + tmp.y * h.timeOfImpact, P.z + tmp.z * h.timeOfImpact, 0, 2, 0, 8); }
    }
  }

  // ------------------------------------------------------------------ camera
  const CAMS = ['CHASE', 'FAR', 'COCKPIT'];
  const cam = { mode: 0, yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), reset: true, fov: 62, shake: 0 };
  const camRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  function camUpdate(dt, c) {
    if (!S.spawned) return;
    const hv = Math.hypot(S.v.x, S.v.z), heading = Math.atan2(fwd.x, fwd.z), want = 62 + 14 * sm(10, 70, S.v.length());
    cam.fov += (want - cam.fov) * (1 - Math.exp(-dt * 3)); if (Math.abs(c.fov - cam.fov) > 0.02) { c.fov = cam.fov; c.updateProjectionMatrix(); }
    if (cam.mode === 2) {                                                        // cockpit: right-hand seat, looks out of the nose
      rB.set(-0.45, 2.45 - COM.y, 3.05 - COM.z).applyQuaternion(q); c.position.copy(S.p).add(rB);
      c.up.copy(up); tmp.copy(fwd).multiplyScalar(30).add(c.position); tmp.y -= 0.8; c.lookAt(tmp); c.up.set(0, 1, 0); drive.focus.copy(S.p); return;
    }
    if (cam.reset) { cam.yaw = heading; cam.reset = false; cam.pos.set(S.p.x - Math.sin(heading) * 20, S.p.y + 7, S.p.z - Math.cos(heading) * 20); }
    let d = hv > 6 ? Math.atan2(S.v.x, S.v.z) : heading, df = ((d - heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const target = heading + df * sm(8, 30, hv) * 0.4;
    let dy = ((target - cam.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; cam.yaw += dy * (1 - Math.exp(-dt * 2.6));
    const far = cam.mode === 1 ? 1.9 : 1, dist = (19 + 0.07 * hv) * far, h = (5.5 + 0.03 * hv - Math.max(0, eul.x) * 8) * far;
    tmp.set(S.p.x - Math.sin(cam.yaw) * dist, S.p.y + h, S.p.z - Math.cos(cam.yaw) * dist);
    cam.pos.lerp(tmp, 1 - Math.exp(-dt * 6)); if (cam.pos.distanceTo(tmp) > 40) cam.pos.copy(tmp);
    tmp2.copy(cam.pos);
    const gy = ground.y(tmp2.x, tmp2.z) + 2.5; if (tmp2.y < gy) tmp2.y = gy;
    tmp.copy(tmp2).sub(S.p); const L = tmp.length();                              // keep the camera out of buildings
    if (L > 0.5) { camRay.origin = { x: S.p.x, y: S.p.y + 1.5, z: S.p.z }; camRay.dir = { x: tmp.x / L, y: tmp.y / L, z: tmp.z / L }; const hh = world.castRay(camRay, L, true, undefined, undefined, undefined, vehicle.body); if (hh) tmp2.copy(S.p).addScaledVector(tmp, Math.max(0.15, (hh.timeOfImpact - 0.6) / L)); }
    c.position.copy(tmp2);
    cam.look.set(S.p.x + Math.sin(cam.yaw) * 10, S.p.y + 1.5, S.p.z + Math.cos(cam.yaw) * 10); c.lookAt(cam.look);
    drive.focus.copy(S.p);
  }

  // ------------------------------------------------------------------ HUD
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const hud = document.createElement('div'); hud.id = 'hl';
  hud.innerHTML = `
    <div class="hdg"><span id="h-ang">HEADING</span><b id="h-hdg">000°</b><div class="tape"><div id="h-tape"></div></div></div>
    <div class="left"><div class="bar"><label><span>ROTOR</span><span id="h-rpm">100%</span></label><i><b id="h-rpmb" style="width:100%"></b></i></div>
      <div class="bar"><label><span>COLLECTIVE</span><span id="h-col">52%</span></label><i><b id="h-colb" style="width:52%"></b></i></div>
      <div class="flags"><b id="f-eng">ENGINE</b><b id="f-ass">ASSIST</b><b id="f-lit">LIGHTS</b><b id="f-gnd">GROUND</b><b id="f-cam">CHASE</b></div></div>
    <div class="att"><div class="hz" id="h-hz"><div class="hl"></div></div><div class="fix"></div></div>
    <div class="gauge"><div><span class="kmh" id="h-kmh">0</span><small>km/h</small></div>
      <div class="row"><div><span>ALT</span><b id="h-alt">0</b> m</div><div><span>V/S</span><b id="h-vs">0.0</b> m/s</div></div></div>
    <div class="help"><kbd>W</kbd><kbd>S</kbd> cyclic pitch &nbsp; <kbd>A</kbd><kbd>D</kbd> bank &nbsp; <kbd>Q</kbd><kbd>E</kbd> yaw &nbsp; <kbd>Space</kbd> climb &nbsp; <kbd>Shift</kbd> descend<br>
      <kbd>I</kbd> engine &nbsp; <kbd>G</kbd> flight assist &nbsp; <kbd>L</kbd> lights &nbsp; <kbd>C</kbd> camera &nbsp; <kbd>R</kbd> respawn &nbsp; <kbd>F</kbd> map &nbsp; <kbd>Tab</kbd> spectator &nbsp; <kbd>Esc</kbd> menu<br>
      <span style="opacity:.8">Gamepad: left stick yaw / climb · right stick cyclic · <kbd>Y</kbd> camera · <kbd>B</kbd> respawn</span></div>
    <div class="toast" id="h-toast"></div>`;
  document.body.appendChild(hud);
  const $ = id => hud.querySelector('#' + id);
  const el = { hdg: $('h-hdg'), kmh: $('h-kmh'), alt: $('h-alt'), vs: $('h-vs'), rpm: $('h-rpm'), rpmb: $('h-rpmb'), col: $('h-col'), colb: $('h-colb'), eng: $('f-eng'), ass: $('f-ass'), lit: $('f-lit'), gnd: $('f-gnd'), cam: $('f-cam'), toast: $('h-toast'), hz: $('h-hz'), tape: $('h-tape') };
  el.tape.innerHTML = Array.from({ length: 216 }, (_, i) => { const d = (i % 72) * 5, lab = d % 90 === 0 ? ['N', 'E', 'S', 'W'][d / 90] : d % 30 === 0 ? d : ''; return `<i style="left:${i * 25}px">${lab ? lab : '·'}</i>`; }).join('');
  el.tape.style.width = 216 * 25 + 'px';
  let toastT = 0, hudT = 0;
  function hudToast(t, sub = '', d = 1.4) { el.toast.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); el.toast.classList.add('on'); toastT = d; }
  const toast = hudToast;
  function updateHud(dt) {
    if (toastT > 0 && (toastT -= dt) <= 0) el.toast.classList.remove('on');
    if ((hudT -= dt) > 0) return; hudT = 0.05;
    const brg = (Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI + 360) % 360;
    el.hdg.textContent = String(Math.round(brg) % 360).padStart(3, '0') + '°'; el.tape.style.left = (150 - (brg + 360) / 5 * 25) + 'px';
    el.kmh.textContent = Math.round(S.v.length() * 3.6); el.alt.textContent = Math.max(0, Math.round(S.agl)); el.vs.textContent = (S.vs >= 0 ? '+' : '') + S.vs.toFixed(1);
    el.rpm.textContent = Math.round(S.rpm * 100) + '%'; el.rpmb.style.width = Math.min(100, S.rpm * 100) + '%'; el.col.textContent = Math.round(S.col * 100) + '%'; el.colb.style.width = S.col * 100 + '%';
    el.eng.classList.toggle('on', S.engine); el.eng.classList.toggle('warn', !S.engine); el.ass.classList.toggle('on', S.assist); el.lit.classList.toggle('on', lightsOn); el.gnd.classList.toggle('on', S.onGround); el.cam.textContent = CAMS[cam.mode]; el.cam.classList.add('on');
    const pitch = -eul.x * 180 / Math.PI, roll = eul.z * 180 / Math.PI;            // + pitch = nose up on the display
    el.hz.style.transform = `rotate(${-roll}deg) translateY(${pitch * 2.2}px)`;
  }

  // ------------------------------------------------------------------ audio (procedural: blade slap, turbine whine, rotor wash, wind)
  function createAudio() {
    let ctx = null, ready = false, muted = false; const n = {};
    const init = () => {
      if (ctx) return; try { ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { return; }
      const sr = ctx.sampleRate, out = ctx.createGain(); out.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; out.connect(lp); lp.connect(ctx.destination); n.out = out; n.lp = lp;
      // 1 s loop with 16 blade-slap pulses (4 blades x 4 rev/s at 100 % rpm): playbackRate = rpm
      const slap = ctx.createBuffer(1, sr, sr), d = slap.getChannelData(0); let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1;
      for (let k = 0; k < 16; k++) { const t0 = Math.floor(k / 16 * sr); for (let i = 0; i < sr / 16; i++) { const t = i / sr; d[(t0 + i) % sr] += (Math.sin(2 * Math.PI * 58 * t) * Math.exp(-t / 0.011) * 1.0 + rnd() * Math.exp(-t / 0.0035) * 0.55 + Math.sin(2 * Math.PI * 120 * t) * Math.exp(-t / 0.006) * 0.4) * (0.85 + 0.15 * Math.sin(k * 2.3)); } }
      let mx = 0; for (let i = 0; i < sr; i++) mx = Math.max(mx, Math.abs(d[i])); for (let i = 0; i < sr; i++) d[i] /= mx;
      const noise = ctx.createBuffer(1, sr * 2, sr), nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = rnd();
      const src = b => { const o = ctx.createBufferSource(); o.buffer = b; o.loop = true; return o; };
      n.slap = src(slap); n.slapG = ctx.createGain(); n.slapG.gain.value = 0; const slapLp = ctx.createBiquadFilter(); slapLp.type = 'lowpass'; slapLp.frequency.value = 700; n.slap.connect(slapLp); slapLp.connect(n.slapG); n.slapG.connect(out);
      n.hiss = src(noise); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6; n.hissG = ctx.createGain(); n.hissG.gain.value = 0; n.hiss.connect(bp); bp.connect(n.hissG); n.hissG.connect(out); n.bp = bp;
      n.wind = src(noise); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; n.windG = ctx.createGain(); n.windG.gain.value = 0; n.wind.connect(hp); hp.connect(n.windG); n.windG.connect(out);
      n.t1 = ctx.createOscillator(); n.t1.type = 'sawtooth'; n.t2 = ctx.createOscillator(); n.t2.type = 'triangle'; n.tg = ctx.createGain(); n.tg.gain.value = 0; const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1600; tf.Q.value = 1.4;
      n.t1.connect(tf); n.t2.connect(tf); tf.connect(n.tg); n.tg.connect(out); n.tf = tf;
      for (const o of [n.slap, n.hiss, n.wind, n.t1, n.t2]) o.start(); ready = true;
    };
    return {
      resume() { init(); ctx?.resume?.(); },
      mute(m) { muted = !!m; },
      boom() { if (!ctx || muted) return; const o = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * 1.6, ctx.sampleRate), d = b.getChannelData(0); let s = 3; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * Math.exp(-i / ctx.sampleRate / 0.35); } o.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; const g = ctx.createGain(); g.gain.value = 1.4; o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(); },
      update(on, rpm, col, speed, agl, dt) {
        if (!ready) return; const t = ctx.currentTime, k = 0.08;
        n.out.gain.setTargetAtTime(on && !muted ? 0.9 : 0, t, on ? 0.1 : 0.15);
        const r = clamp(rpm, 0, 1.05), load = 0.35 + 0.65 * col;
        n.slap.playbackRate.setTargetAtTime(Math.max(0.05, r), t, k); n.slapG.gain.setTargetAtTime(r > 0.02 ? (0.55 + 0.55 * load + 0.3 * sm(15, 60, speed)) * Math.min(1, r * 1.6) : 0, t, k);
        n.t1.frequency.setTargetAtTime(150 + 750 * r, t, k); n.t2.frequency.setTargetAtTime(300 + 1500 * r, t, k); n.tf.frequency.setTargetAtTime(500 + 2400 * r, t, k); n.tg.gain.setTargetAtTime(0.025 * r * (0.5 + load), t, k);
        n.hissG.gain.setTargetAtTime(0.16 * r * (0.3 + col) * (0.5 + 0.5 * sm(60, 0, agl)), t, k); n.bp.frequency.setTargetAtTime(500 + 900 * r, t, k);
        n.windG.gain.setTargetAtTime(0.14 * sm(10, 75, speed), t, 0.15);
      },
    };
  }
  const audio = createAudio();
  addEventListener('pointerdown', () => audio.resume());

  // ------------------------------------------------------------------ explosion (cheap: two additive spheres + a short light flash)
  const explosion = new THREE.Group(); explosion.visible = false; scene.add(explosion);
  { const m1 = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.4, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), m2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.35, 0.1), transparent: true, depthWrite: false });
    explosion.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m1), new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), m2)); explosion.userData = { t: 0, m1, m2 }; }

  // ------------------------------------------------------------------ headlight borrowing: the two car spot lights become the searchlight (the light count never changes)
  let borrowed = false;
  function borrowHeads(on) {
    const c = car(); if (!c?.heads) return;
    if (on && !borrowed) { for (const sp of c.heads) hg.add(sp, sp.target); borrowed = true; }
    else if (!on && borrowed) { for (const sp of c.heads) c.root.add(sp, sp.target); c.placeHeads(); borrowed = false; }
  }

  // ------------------------------------------------------------------ per frame
  let acc = 0, spin = 0, spinT = 0, tailSpin = 0, time = 0;
  const poseTmp = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  function update(dt) {
    time += dt;
    if (!body) return;
    hud.classList.toggle('on', active && S.spawned);
    audio.update(active && S.spawned, S.rpm, S.col, S.v.length(), S.agl, dt);
    if (showOn) { hg.visible = true; borrowHeads(false); }
    else { hg.visible = visible && S.spawned && S.crashT < 2.65; }
    // ---- physics
    if (active && S.spawned) {
      readInput(dt);
      acc += Math.min(dt, 0.05); let n = 0;
      while (acc >= DT && n++ < 8) { flight.step(DT); if ((rayT += DT) > 1 / 60) { rayT = 0; collide(); } acc -= DT; }
      if (n >= 8) acc = 0;
      if ((collT -= dt) <= 0) { colliders.update(S.p.x, S.p.z); drive.prefetch?.(S.p.x, S.p.z); collT = 0.25; }
      if (S.crashT > 0 && (S.crashT -= dt) <= 0) { respawn(); hudToast('RESPAWN', 'Hovering above your car', 1.6); }
      if (!ground.inBounds(S.p.x, S.p.z) && Math.abs(S.p.x) > 6000) respawn();
    } else if (!active) { readInput(0); }
    // ---- pose
    if (showOn) { hg.position.set(show.x, show.y + COM.y * show.scale, show.z); hg.quaternion.setFromAxisAngle(Y, show.yaw); hg.scale.setScalar(show.scale); }
    else if (S.spawned) { hg.position.copy(S.p); hg.quaternion.copy(q); hg.scale.setScalar(1); }
    // ---- rotor / lights
    const rpmV = showOn ? [0, 0.14, 1][showRotor] : S.rpm;
    spin = (spin + rpmV * 27 * dt) % (Math.PI * 2); if (pivot) { pivot.rotation.y = spin; pivot.rotation.x = showOn ? 0 : approach(pivot.rotation.x, cmd.p * 0.045 * Math.min(1, S.rpm), 2, 2, dt); pivot.rotation.z = showOn ? 0 : approach(pivot.rotation.z, cmd.r * 0.045 * Math.min(1, S.rpm), 2, 2, dt); }
    tailSpin = (tailSpin + rpmV * 120 * dt) % (Math.PI * 2); tail.rotation.x = tailSpin;
    if (disc.main) { disc.main.material.opacity = 0.1 * sm(0.45, 0.9, rpmV); disc.tail.material.opacity = 0.1 * sm(0.45, 0.9, rpmV); }
    const blink = (time % 1.15) < 0.09, beacon = (time % 0.9) < 0.12;
    if (nav.red) { nav.red.visible = nav.green.visible = lightsOn; nav.white.visible = lightsOn && blink; nav.beacon.visible = lightsOn && beacon; }
    if (active && S.spawned) {
      borrowHeads(true); const c = car(), night = Math.max(tod.night, 0.15);
      c.heads.forEach((sp, i) => { const s = i ? -1 : 1; sp.position.set(0.55 * s, 1.0 - COM.y, 3.7 - COM.z); sp.target.position.set(0.55 * s, -10 - COM.y, 38 - COM.z); sp.intensity = lightsOn ? 900 * night : 0; sp.angle = 0.3; });
    } else if (!showOn) borrowHeads(false);
    // crash explosion
    if (explosion.visible) { const u = explosion.userData; u.t += dt; const k = Math.min(1, u.t / 1.4); explosion.children[0].scale.setScalar(2 + 9 * Math.sqrt(k)); explosion.children[1].scale.setScalar(1.5 + 7 * k); u.m1.opacity = 1 - k; u.m2.opacity = 0.65 * (1 - k * k); if (k >= 1) explosion.visible = false; }
    updateHud(dt);
  }

  // ------------------------------------------------------------------ public API
  drive.heli = {
    specs: SPECS, ready, group: hg, liveries: LIVERIES, pos: S.p, get spawned() { return S.spawned; },
    setActive(v) {
      v = !!v; if (v === active) return; active = v;
      if (v) { audio.resume(); if (!S.spawned) respawn(); hg.visible = true; visible = true; cam.reset = true; hudToast(`${SPECS.name.toUpperCase()}`, 'Assist ON · press G for raw flight', 2.4); }
      else { down.clear(); camera.fov = 62; camera.updateProjectionMatrix(); }
    },
    setVisible(v) { visible = !!v; if (!v) hg.visible = false; }, reset, respawn,
    showcase(on, o) { showOn = !!on; if (o) Object.assign(show, o); if (!on && !visible) hg.visible = false; },
    camUpdate, mute: m => audio.mute(m),
    livery: () => (customTint !== null ? -1 : liveryIdx), customTint: () => customTint,
    setLivery(i) { customTint = null; liveryIdx = clamp(i | 0, 0, LIVERIES.length - 1); applyLivery(); },
    setTint(hex) { customTint = hex; applyLivery(); },
    lights: () => lightsOn, setLights(v) { lightsOn = !!v; },
    showRotor: () => showRotor, setShowRotor(v) { showRotor = clamp(v | 0, 0, 2); },
  };
  try { await Promise.race([ready, new Promise(r => setTimeout(r, 8000))]); } catch (e) { console.error('[heli] model failed', e); }
  return { update };
}
