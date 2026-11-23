// Drivable drift car plug-in (garage cars: BMW G87 M2 widebody, McLaren P1, Lamborghini Countach LPI 800-4; see src/car/profiles.js). default export async (ctx) => ({ update(dt, camera, time) })
// Wires together: Rapier world + static colliders (src/car/colliders.js), vehicle dynamics (src/car/vehicle.js), model rig, input, chase camera,
// skid marks / smoke / sparks (src/car/fx.js), procedural audio (src/car/audio.js) and the drift HUD / scoring (src/car/hud.js).
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { quality } from './quality.js';
import { fetchJSON } from './net.js';
import { createGround } from './car/ground.js';
import { createColliders } from './car/colliders.js';
import { Vehicle, CAR, applyProfile } from './car/vehicle.js';
import { CAR_PROFILES, CAR_IDS, DEFAULT_CAR } from './car/profiles.js';
import { createInput } from './car/input.js';
import { createCarCamera, CAM_NAMES } from './car/camera.js';
import { createSkids, createSmoke, createSparks } from './car/fx.js';
import { createAudio } from './car/audio.js';
import { createHud } from './car/hud.js';
import { prepareMaterials, cloneLamp, setLamp, lampLevels } from './car/lamps.js';

const DT = 1 / 120;
const PAINTS = [['Black Sapphire', 0x07080b, 0.55], ['Toronto Red', 0xb0121c, 0.5], ['Zandvoort Blue', 0x0a3f9e, 0.5], ['Frozen Brooklyn Grey', 0x7b7f86, 0.35], ['Isle of Man Green', 0x0c6a52, 0.5], ['Sao Paulo Yellow', 0xf0c400, 0.4], ['Fire Orange', 0xe05a10, 0.5], ['Alpine White', 0xe9ebee, 0.3]];

export default async function car(ctx) {
  const { THREE, scene, renderer, camera, H, tod, meta } = ctx;
  const drive = ctx.drive;
  const t0 = performance.now();
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT;
  const ground = await createGround(H);
  const circuitsData = await fetchJSON('/map/circuits.json').catch(() => []);      // used for a road spawn point; barriers only when the circuits are on
  const circuitsOn = new URLSearchParams(location.search).get('circuits') === '1';
  const colliders = await createColliders({ RAPIER, world, ground, meta, circuits: circuitsOn ? circuitsData : [] });
  const qs = new URLSearchParams(location.search), LSget = k => { try { return localStorage.getItem(k); } catch { return null; } };
  let carId = [qs.get('car'), LSget('yd.car')].find(c => CAR_PROFILES[c]) ?? DEFAULT_CAR;
  applyProfile(carId);
  const vehicle = new Vehicle({ RAPIER, world, ground });

  // ------------------------------------------------------------------ model + rig
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const root = new THREE.Group(); root.name = 'player-car'; scene.add(root);
  const paintMat = new THREE.MeshPhysicalMaterial({ color: 0x0a3f9e, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4 });      // one paint material shared by every garage car
  // every garage GLB is loaded once and prepared once (paint swap, glass, lights); the local car mounts the scene itself, remote players get clones of it
  const entries = new Map();
  function loadEntry(id) {
    if (!entries.has(id)) entries.set(id, loader.loadAsync(CAR_PROFILES[id].file).then(gltf => {
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.name !== 'Underbody' && o.name !== 'Interior'; o.receiveShadow = true; o.frustumCulled = true;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m, i) => {
          if (/^paint$/i.test(m.name || '')) { if (Array.isArray(o.material)) o.material[i] = paintMat; else o.material = paintMat; return; }
          if ('envMapIntensity' in m) m.envMapIntensity = Math.max(m.envMapIntensity, 1.0);
        });
        if (quality.level === 'low' && /Interior|SeatBelt|Engine|Underbody/i.test(o.name + (o.parent?.name ?? ''))) o.visible = false;
      });
      const lightMats = prepareMaterials(gltf.scene);                       // lamps (head / tail split), glass, interior emissive clean-up
      return { scene: gltf.scene, lightMats };
    }));
    return entries.get(id);
  }
  const rig = { FL: {}, FR: {}, RL: {}, RR: {} };
  let model = null, lightMats = [];
  function mountModel(entry) {
    if (model) root.remove(model);
    model = entry.scene; lightMats = entry.lightMats;
    model.position.set(0, -CAR.hCOM, -CAR.zCOM); root.add(model);
    for (const k of ['FL', 'FR', 'RL', 'RR']) rig[k] = { steer: model.getObjectByName('steer_' + k), spin: model.getObjectByName('spin_' + k) };
  }
  mountModel(await loadEntry(carId));
  let paintIdx = 2;
  function applyPaint(i) { paintIdx = (i + PAINTS.length) % PAINTS.length; const [, c, m] = PAINTS[paintIdx]; paintMat.color.setHex(c).convertSRGBToLinear(); paintMat.metalness = m; }
  applyPaint(paintIdx);

  // headlights (spot lights, ground-reflection and facade lighting at night)
  const heads = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.SpotLight(0xfff1dc, 0, 95, 0.42, 0.75, 1.7); sp.userData.side = s; root.add(sp, sp.target); heads.push(sp);
  }
  const placeHeads = () => { for (const sp of heads) { const [hx, hy, hz] = CAR.head, s = sp.userData.side; sp.position.set(hx * s, hy, hz); sp.target.position.set(hx * s, hy - 0.62, 40); } };
  placeHeads();
  let lightsOn = true;

  // ------------------------------------------------------------------ systems
  const skids = createSkids({ scene, ground }), smoke = createSmoke({ scene, ground }), sparks = createSparks({ scene });
  const audio = createAudio(), hud = createHud(), cam = createCarCamera(camera);
  const input = createInput({
    pad: (name, ok) => hud.toast(ok ? 'GAMEPAD CONNECTED' : 'GAMEPAD DISCONNECTED', 1.6),
    uiOpen: () => !!drive.uiLock,
    key(code) {
      audio.resume();
      if (code === 'Tab') { if (drive.toggleRole) drive.toggleRole(); else drive.set(!drive.active); return; }
      if (!drive.active) return;
      switch (code) {
        case 'KeyC': cam.cycle(); hud.toast(CAM_NAMES[cam.mode], 0.8); break;
        case 'KeyR': respawn(); break;
        case 'KeyJ': { const pl = places[placeIdx = (placeIdx + 1) % places.length]; respawn({ x: pl.x, z: pl.z, y: null, heading: pl.heading }); hud.toast(pl.name, 1.6); break; }
        case 'KeyM': vehicle.auto = !vehicle.auto; hud.toast(vehicle.auto ? 'AUTOMATIC' : 'MANUAL', 0.9); break;
        case 'KeyG': vehicle.steerAssist = vehicle.steerAssist > 0 ? 0 : 0.95; vehicle.tcs = vehicle.steerAssist > 0; hud.toast(vehicle.steerAssist ? 'ASSISTS ON  (counter-steer + launch control)' : 'ASSISTS OFF', 1.1); break;
        case 'KeyV': vehicle.abs = !vehicle.abs; hud.toast(vehicle.abs ? 'ABS ON' : 'ABS OFF', 0.9); break;
        case 'KeyL': lightsOn = !lightsOn; break;
        case 'KeyP': applyPaint(paintIdx + 1); hud.toast(PAINTS[paintIdx][0], 1.2); break;
        case 'F2': hud.toast(audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON', 0.9); break;
        case 'ShiftLeft': case 'ShiftRight': vehicle.input.kick = true; break;
        case 'KeyE': vehicle.input.shiftUp = true; break;
        case 'KeyQ': vehicle.input.shiftDown = true; break;
      }
    },
  });
  addEventListener('pointerdown', () => audio.resume());

  // ------------------------------------------------------------------ spawn / respawn
  // free roam: start on a real street next to Republic Square (the point of the old loop that is closest to the square)
  let spawn = { x: 0, z: 40, heading: Math.PI };
  { const c0 = circuitsData[0]; if (c0) { const p = c0.points; let bi = 0, bd = 1e9; for (let i = 0; i < p.length / 3 - 8; i += 3) { const d = Math.hypot(p[i * 3], p[i * 3 + 2]); if (d < bd) { bd = d; bi = i; } } spawn = { x: p[bi * 3], y: p[bi * 3 + 1], z: p[bi * 3 + 2], heading: Math.atan2(p[(bi + 6) * 3] - p[bi * 3], p[(bi + 6) * 3 + 2] - p[bi * 3 + 2]) }; } }
  if (circuitsOn && circuitsData[0]?.spawns?.[0]) spawn = circuitsData[0].spawns[0];
  { const o = Math.random() * 16; spawn = { ...spawn, x: spawn.x - Math.sin(spawn.heading) * o, z: spawn.z - Math.cos(spawn.heading) * o }; }      // multiplayer: stagger the start so tabs don't spawn on top of each other
  const places = [{ name: 'Republic Square', x: spawn.x, z: spawn.z, heading: spawn.heading }, ...(meta.places ?? [])]; let placeIdx = 0;
  let safe = { x: spawn.x, z: spawn.z, y: spawn.y ?? null, heading: spawn.heading }, safeT = 0;
  function respawn(to = safe) { drive.prefetch?.(to.x, to.z); vehicle.reset(to.x, to.z, to.heading, to.y); colliders.prime(to.x, to.z); input.reset(); cam.reset(); skidsClear(); hud.resetScore(); }
  const skidsClear = () => { smoke.clear(); };
  vehicle.reset(spawn.x, spawn.z, spawn.heading, spawn.y);
  colliders.prime(spawn.x, spawn.z);
  const settle = () => { for (let i = 0; i < 90; i++) { vehicle.input.handbrake = 0; vehicle.step(DT); } vehicle.prevPos.copy(vehicle.pos); vehicle.prevQuat.copy(vehicle.quat); };      // settle the suspension
  settle();
  drive.wanted = true;

  // ------------------------------------------------------------------ per-frame
  const rp = new THREE.Vector3(), rq = new THREE.Quaternion(), tmpV = new THREE.Vector3();
  let acc = 0, collT = 0, wallT = 0, wallDist = 9, lastSpark = 0, crashed = false, totalTime = 0;
  const wallRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  function pollWalls() {
    const p = vehicle.pos, f = vehicle.fwd; let best = 9;
    const lx = f.z, lz = -f.x, l = Math.hypot(lx, lz) || 1;      // car's left (horizontal)
    for (const s of [-1, 1]) {
      wallRay.origin = { x: p.x, y: p.y, z: p.z }; wallRay.dir = { x: lx / l * s, y: 0, z: lz / l * s };
      const hit = world.castRay(wallRay, 4, true, undefined, undefined, undefined, vehicle.body);
      if (hit) best = Math.min(best, hit.timeOfImpact - 1.0);
    }
    wallDist = best;
  }
  const camRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const occlude = (a, b) => {                       // fraction (0..1) of the way from a to b where the first static collider is hit
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz); if (L < 0.01) return 1;
    camRay.origin = { x: a.x, y: a.y, z: a.z }; camRay.dir = { x: dx / L, y: dy / L, z: dz / L };
    const hit = world.castRay(camRay, L, true, undefined, undefined, undefined, vehicle.body); return hit ? hit.timeOfImpact / L : 1;
  };
  const smokeEnv = { camera, vel: vehicle.vel, light: null }, tyreHeat = [0, 0, 0, 0];
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hudState = { beta: 0, kmh: 0, speed: 0, grounded: 4, vLong: 0, slipR: 0, wallDist: 9, crashed: false, gear: 1, rpm: 0, assist: 1, abs: true, auto: true, handbrake: 0, cam: 'CHASE' };

  function update(dt, camera_, time) {
    const active = drive.active;
    input.pollPad();
    hud.show(active);
    if (active) {
      input.update(dt, vehicle, true, !!drive.uiLock);
      acc += Math.min(dt, 0.05); let n = 0;
      while (acc >= DT && n++ < 8) { vehicle.step(DT); acc -= DT; }
      if (n >= 8) acc = 0;
    }
    vehicle.transform(Math.min(1, acc / DT), rp, rq);
    root.position.copy(rp); root.quaternion.copy(rq);
    const day = tod.day, night = tod.night;
    // wheels
    for (const w of vehicle.wheels) {
      const r = rig[w.key]; if (!r.steer) continue;
      r.steer.position.y = CAR.hCOM + CAR.hpY - w.d; r.steer.rotation.y = w.steer; r.spin.rotation.x = w.spin % (Math.PI * 2);
    }
    for (const sp of heads) sp.intensity = lightsOn ? 520 * night : 0;
    { const [lh, lt] = lampLevels(night, lightsOn, vehicle.input.brake > 0.1); for (const m of lightMats) setLamp(m, lh, lt); }
    smokeEnv.light = tod.light;
    if (!active) { skids.update(); smoke.update(dt, rp, day, smokeEnv); sparks.update(dt, ground); return; }

    totalTime += dt;
    // world colliders around the car
    collT -= dt; if (collT <= 0) { colliders.update(vehicle.pos.x, vehicle.pos.z); collT = 0.25; }
    wallT -= dt; if (wallT <= 0) { pollWalls(); wallT = 0.1; }
    // safe respawn point: last time we were upright, grounded and on a road, refreshed every few seconds
    safeT += dt; if (safeT > 3 && vehicle.grounded >= 3 && vehicle.up.y > 0.9 && ground.surface(vehicle.pos.x, vehicle.pos.z) === 1 && vehicle.t.speed > 2) { safe = { x: vehicle.pos.x, z: vehicle.pos.z, y: null, heading: Math.atan2(vehicle.fwd.x, vehicle.fwd.z) }; safeT = 0; }
    if (vehicle.flipT > 3 || !ground.inBounds(vehicle.pos.x, vehicle.pos.z) || vehicle.pos.y < -50) { hud.toast(vehicle.flipT > 3 ? 'RESET' : 'OUT OF BOUNDS', 1.2); respawn(); }

    // impacts
    crashed = false;
    if (vehicle.impact > 1.0) (window.__impacts ??= []).push([+totalTime.toFixed(2), +vehicle.impact.toFixed(1), +vehicle.t.kmh.toFixed(0), +vehicle.pos.x.toFixed(0), +vehicle.pos.z.toFixed(0)]);
    if (vehicle.impact > 2.2) { audio.impact(vehicle.impact); cam.impact(vehicle.impact); sparks.burst(vehicle.pos.x, vehicle.pos.y, vehicle.pos.z, vehicle.vel.x, 0, vehicle.vel.z, Math.min(24, Math.round(vehicle.impact * 2.2))); if (vehicle.impact > 5) crashed = true; }
    if (input.pad.connected) input.rumble(Math.min(1, vehicle.impact / 8), 0);
    vehicle.impact = 0;
    if (vehicle.scrape > 2e4) { lastSpark -= dt; if (lastSpark <= 0) { sparks.burst(vehicle.pos.x, ground.y(vehicle.pos.x, vehicle.pos.z) + 0.1, vehicle.pos.z, vehicle.vel.x, 0, vehicle.vel.z, 3); lastSpark = 0.05; } }

    // tyre effects
    const sp = vehicle.t.speed; let slipF = 0, slipR = 0, hard = 0, nc = 0, slipRum = 0;
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i]; if (!w.contact) { skids.feed(i, 0, 0, 0, 0); continue; }
      // slide / wheelspin intensity 0..1: sideways scrub at speed OR a spinning tyre (burnouts smoke and mark even from a standstill)
      // physics: frictional power dumped into the tread = |tyre force| x sliding speed. Normal acceleration / cornering stays well under ~20 kW per tyre; a real slide or burnout is 40-100 kW.
      const fric = Math.hypot(w.fx, w.fy) * w.slipV, slideSpd = sm(1.8, 6, w.slipV);
      const inten = sm(14e3, 45e3, fric) * slideSpd * sm(0.5, 1.1, w.slip);                                  // skid marks: any real scrub
      const burn = sm(40e3, 90e3, fric) * slideSpd * sm(0.7, 1.4, w.slip);                                    // smoke: needs more, and the rubber has to heat up first
      const th = tyreHeat[i] += (burn - tyreHeat[i]) * (1 - Math.exp(-dt * (burn > tyreHeat[i] ? 2.4 : 1.6)));
      skids.feed(i, w.pcx, w.pcz, inten, w.surf); if (inten > slipRum) slipRum = inten;
      const spinning = Math.abs(w.slipX) > 0.35 && sp < 12;
      smoke.emit(i, dt, w.pcx, w.pcy, w.pcz, vehicle.vel.x, vehicle.vel.z, th * th * (w.surf === 0 ? 0.5 : 1), spinning);
      if (w.front) slipF = Math.max(slipF, w.slip); else slipR = Math.max(slipR, w.slip);
      hard += (w.surf === 1 || w.surf === 2 || w.surf === 3) ? 1 : 0; nc++;
    }
    hard = nc ? hard / nc : 0;
    if (input.pad.connected && (slipRum > 0.05 || vehicle.limiter)) input.rumble(0, Math.min(1, slipRum * 0.6 + (vehicle.limiter ? 0.25 : 0)));
    skids.update(); smoke.update(dt, rp, day, smokeEnv); sparks.update(dt, ground);
    sparks.setScale(renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)));

    // audio + hud
    audio.update({ dt, rpm: vehicle.rpm * 7200 / CAR.redline, throttle: vehicle.input.throttle, boost: vehicle.boost, speed: sp, slipF, slipR, hard, limiter: vehicle.limiter, scrape: vehicle.scrape, gear: vehicle.gear });
    Object.assign(hudState, { beta: vehicle.t.beta, kmh: vehicle.t.kmh, speed: sp, grounded: vehicle.grounded, vLong: vehicle.t.vLong, slipR, wallDist, crashed, gear: vehicle.gear, rpm: vehicle.rpm * 7200 / CAR.redline, assist: vehicle.steerAssist, abs: vehicle.abs, auto: vehicle.auto, handbrake: vehicle.input.handbrake, cam: CAM_NAMES[cam.mode] });
    hud.update(dt, hudState);

    // camera + shared focus (shadow frustum, lamp lights, streaming)
    cam.update(dt, rp, rq, vehicle.vel, sp, vehicle.t.beta, ground, occlude);
    drive.focus.copy(rp);
    camera.updateMatrixWorld();
  }

  console.log(`[car] ready in ${(performance.now() - t0).toFixed(0)} ms, spawn`, spawn);
  // ------------------------------------------------------------------ multiplayer hooks (src/mp.js): net state of the local car + clones of the model for remote players
  const wheelAvg = front => { let a = 0, n = 0; for (const w of vehicle.wheels) if (!!w.front === front) { a += w.omega; n++; } return n ? a / n : 0; };
  function makeRemote(pi = 0, ci = DEFAULT_CAR) {
    const g = new THREE.Group(); g.name = 'remote-car'; scene.add(g);
    const pm = paintMat.clone(), lms = new Map(), spin = { FL: 0, FR: 0, RL: 0, RR: 0 }; let rg = {}, mdl = null, cur = null, dead = false;
    async function setCar(id) {
      if (!CAR_PROFILES[id] || id === cur) return; cur = id;
      const e = await loadEntry(id); if (dead || cur !== id) return;
      if (mdl) g.remove(mdl); lms.clear();
      mdl = e.scene.clone(true); const ph = CAR_PROFILES[id].phys; mdl.position.set(0, -ph.hCOM, -ph.zCOM);
      mdl.traverse(o => {
        if (!o.isMesh) return;
        const swap = m => { if (m === paintMat) return pm; if (e.lightMats.includes(m)) { let c = lms.get(m); if (!c) lms.set(m, c = cloneLamp(m)); return c; } return m; };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      });
      rg = {}; for (const k of ['FL', 'FR', 'RL', 'RR']) rg[k] = { steer: mdl.getObjectByName('steer_' + k), spin: mdl.getObjectByName('spin_' + k) };
      g.add(mdl);
    }
    setCar(ci);
    const api = {
      root: g, setCar,
      setPaint(i) { const [, c, m] = PAINTS[((i % PAINTS.length) + PAINTS.length) % PAINTS.length]; pm.color.setHex(c).convertSRGBToLinear(); pm.metalness = m; },
      /** st: { steer, wf, wr (wheel rad/s), brake } */
      update(dt, st) {
        for (const k of ['FL', 'FR', 'RL', 'RR']) { const r = rg[k]; if (!r?.spin) continue; spin[k] = (spin[k] + (k[0] === 'F' ? st.wf : st.wr) * dt) % (Math.PI * 2); r.spin.rotation.x = spin[k]; if (k[0] === 'F' && r.steer) r.steer.rotation.y = st.steer; }
        const [lh, lt] = lampLevels(tod.night, true, !!st.brake); for (const m of lms.values()) setLamp(m, lh, lt);
      },
      dispose() { dead = true; scene.remove(g); pm.dispose(); for (const m of lms.values()) m.dispose(); },
    };
    api.setPaint(pi); return api;
  }
  // garage: switch the local car (loads the GLB on first use, swaps physics profile + model, respawns on the spot)
  let switching = false;
  async function setCar(id) {
    if (!CAR_PROFILES[id] || switching) return false; if (id === carId) return true;
    switching = true;
    try {
      const entry = await loadEntry(id), p = vehicle.pos, heading = Math.atan2(vehicle.fwd.x, vehicle.fwd.z), x = p.x, z = p.z;
      carId = id; applyProfile(id); vehicle.setProfile(id); mountModel(entry); placeHeads();
      vehicle.reset(x, z, heading, null); colliders.prime(x, z); input.reset(); cam.reset(); skidsClear(); hud.resetScore(); settle();
      try { localStorage.setItem('yd.car', id); } catch { /* private mode */ }
    } finally { switching = false; }
    return true;
  }
  drive.pad = input.pad;       // gamepad state for the map (stick pans, triggers zoom)
  drive.car = {
    vehicle, ground, hud, makeRemote, setCar, carId: () => carId, cars: CAR_IDS.map(id => ({ id, name: CAR_PROFILES[id].name, sub: CAR_PROFILES[id].sub })), carName: id => CAR_PROFILES[id]?.name ?? '', paint: () => paintIdx, setPaint: applyPaint, paints: PAINTS.map(([name, hex]) => ({ name, hex })), setVisible: v => { root.visible = v; }, setLights: v => { lightsOn = v; }, audio, paintHex: PAINTS.map(p => p[1]), lights: () => lightsOn,
    teleport: (x, z, heading) => respawn({ x, z, y: null, heading }),
    /** local car net state: [x,y,z, qx,qy,qz,qw, vx,vy,vz, steer, wheelF, wheelR, brake] */
    netState: () => { const p = vehicle.pos, q = vehicle.quat, v = vehicle.vel; return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, (vehicle.wheels[0].steer + vehicle.wheels[1].steer) / 2, wheelAvg(true), wheelAvg(false), vehicle.input.brake > 0.1 ? 1 : 0]; },
  };       // public API for the map / navigator (src/nav.js)
  window.__car = { vehicle, world, ground, colliders, respawn, applyPaint, audio, cam, hud, RAPIER, root, rig, skids, smoke, sparks, input };
  return { update };
}
