// Drivable drift car plug-in (BMW G87 M2 widebody). default export async (ctx) => ({ update(dt, camera, time) })
// Wires together: Rapier world + static colliders (src/car/colliders.js), vehicle dynamics (src/car/vehicle.js), model rig, input, chase camera,
// skid marks / smoke / sparks (src/car/fx.js), procedural audio (src/car/audio.js) and the drift HUD / scoring (src/car/hud.js).
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { quality } from './quality.js';
import { createGround } from './car/ground.js';
import { createColliders } from './car/colliders.js';
import { Vehicle, CAR } from './car/vehicle.js';
import { createInput } from './car/input.js';
import { createCarCamera, CAM_NAMES } from './car/camera.js';
import { createSkids, createSmoke, createSparks } from './car/fx.js';
import { createAudio } from './car/audio.js';
import { createHud } from './car/hud.js';

const DT = 1 / 120;
const PAINTS = [['Black Sapphire', 0x07080b, 0.55], ['Toronto Red', 0xb0121c, 0.5], ['Zandvoort Blue', 0x0a3f9e, 0.5], ['Frozen Brooklyn Grey', 0x7b7f86, 0.35], ['Isle of Man Green', 0x0c6a52, 0.5], ['Sao Paulo Yellow', 0xf0c400, 0.4], ['Fire Orange', 0xe05a10, 0.5], ['Alpine White', 0xe9ebee, 0.3]];

export default async function car(ctx) {
  const { THREE, scene, renderer, camera, H, tod, meta } = ctx;
  const drive = ctx.drive;
  const t0 = performance.now();
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT;
  const ground = await createGround(H);
  const circuitsData = await (await fetch('/map/circuits.json')).json().catch(() => []);      // used for a road spawn point; barriers only when the circuits are on
  const circuitsOn = new URLSearchParams(location.search).get('circuits') === '1';
  const colliders = await createColliders({ RAPIER, world, ground, meta, circuits: circuitsOn ? circuitsData : [] });
  const vehicle = new Vehicle({ RAPIER, world, ground });

  // ------------------------------------------------------------------ model + rig
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync('/car/bmw_m2.glb');
  const root = new THREE.Group(); root.name = 'player-car';
  const model = gltf.scene; model.position.set(0, -CAR.hCOM, -CAR.zCOM); root.add(model); scene.add(root);
  const rig = {}; for (const k of ['FL', 'FR', 'RL', 'RR']) rig[k] = { steer: model.getObjectByName('steer_' + k), spin: model.getObjectByName('spin_' + k) };
  const paintMats = []; const lightMats = [];
  let paintMat = null;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach((m, i) => {
      const n = m.name || '';
      if (/^paint$/i.test(n)) {
        if (!paintMat) paintMat = new THREE.MeshPhysicalMaterial({ color: 0x0a3f9e, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4 });
        if (Array.isArray(o.material)) o.material[i] = paintMat; else o.material = paintMat;
      }
      if (/Light/i.test(n) && m.emissiveMap) lightMats.push(m);
      if (/glass|Window/i.test(n)) { m.transparent = true; m.depthWrite = false; m.opacity = Math.min(m.opacity, 0.35); m.roughness = 0.05; m.envMapIntensity = 1.5; }
      if ('envMapIntensity' in m && !/^paint$/i.test(n)) m.envMapIntensity = Math.max(m.envMapIntensity, 1.0);
      m.needsUpdate = true;
    });
    if (quality.level === 'low' && /Interior|SeatBelt|Engine/i.test(o.name + (o.parent?.name ?? ''))) o.visible = false;
  });
  let paintIdx = 2;
  function applyPaint(i) { paintIdx = (i + PAINTS.length) % PAINTS.length; const [, c, m] = PAINTS[paintIdx]; paintMat?.color.setHex(c).convertSRGBToLinear(); if (paintMat) paintMat.metalness = m; }
  applyPaint(paintIdx);

  // headlights (spot lights, ground-reflection and facade lighting at night)
  const heads = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.SpotLight(0xfff1dc, 0, 95, 0.42, 0.75, 1.7); sp.position.set(0.62 * s, 0.22, 2.0); sp.target.position.set(0.62 * s, -0.4, 40); root.add(sp, sp.target); heads.push(sp);
  }
  let lightsOn = true;

  // ------------------------------------------------------------------ systems
  const skids = createSkids({ scene, ground }), smoke = createSmoke({ scene }), sparks = createSparks({ scene });
  const audio = createAudio(), hud = createHud(), cam = createCarCamera(camera);
  const input = createInput({
    key(code) {
      audio.resume();
      if (code === 'Tab') { drive.set(!drive.active); return; }
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
  const places = [{ name: 'Republic Square', x: spawn.x, z: spawn.z, heading: spawn.heading }, ...(meta.places ?? [])]; let placeIdx = 0;
  let safe = { x: spawn.x, z: spawn.z, y: spawn.y ?? null, heading: spawn.heading }, safeT = 0;
  function respawn(to = safe) { vehicle.reset(to.x, to.z, to.heading, to.y); colliders.prime(to.x, to.z); input.reset(); cam.reset(); skidsClear(); hud.resetScore(); }
  const skidsClear = () => { smoke.clear(); };
  vehicle.reset(spawn.x, spawn.z, spawn.heading, spawn.y);
  colliders.prime(spawn.x, spawn.z);
  for (let i = 0; i < 90; i++) { vehicle.input.handbrake = 0; vehicle.step(DT); }      // settle the suspension
  vehicle.prevPos.copy(vehicle.pos); vehicle.prevQuat.copy(vehicle.quat);
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
  const hudState = { beta: 0, kmh: 0, speed: 0, grounded: 4, vLong: 0, slipR: 0, wallDist: 9, crashed: false, gear: 1, rpm: 0, assist: 1, abs: true, auto: true, handbrake: 0, cam: 'CHASE' };

  function update(dt, camera_, time) {
    const active = drive.active;
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
    for (const m of lightMats) m.emissiveIntensity = 1.0 * (0.25 + 0.75 * night) + (vehicle.input.brake > 0.1 ? 1.5 : 0);
    if (!active) { skids.update(); smoke.update(dt, rp, day); sparks.update(dt, ground); return; }

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
    vehicle.impact = 0;
    if (vehicle.scrape > 2e4) { lastSpark -= dt; if (lastSpark <= 0) { sparks.burst(vehicle.pos.x, ground.y(vehicle.pos.x, vehicle.pos.z) + 0.1, vehicle.pos.z, vehicle.vel.x, 0, vehicle.vel.z, 3); lastSpark = 0.05; } }

    // tyre effects
    const sp = vehicle.t.speed; let slipF = 0, slipR = 0, hard = 0, nc = 0;
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i]; if (!w.contact) { skids.feed(i, 0, 0, 0, 0); continue; }
      const fast = Math.min(1, Math.max(0, (sp - 8) / 12)), inten = Math.min(1, Math.max(0, (w.slipV - 2.2) / 5.5)) * Math.min(1, Math.max(0, (w.slip - 0.9) / 0.6)) * fast * fast * (3 - 2 * fast);   // smoke / marks only at speed
      skids.feed(i, w.pcx, w.pcz, inten, w.surf);
      const spinning = Math.abs(w.slipX) > 0.35;
      smoke.emit(i, dt, w.pcx, w.pcy, w.pcz, vehicle.vel.x, vehicle.vel.z, inten * (w.surf === 0 ? 0.5 : 1) * (0.45 + 0.55 * Math.min(1, (sp + Math.abs(w.omega) * 0.34) / 14)), spinning);
      if (w.front) slipF = Math.max(slipF, w.slip); else slipR = Math.max(slipR, w.slip);
      hard += (w.surf === 1 || w.surf === 2 || w.surf === 3) ? 1 : 0; nc++;
    }
    hard = nc ? hard / nc : 0;
    skids.update(); smoke.update(dt, rp, day); sparks.update(dt, ground);
    smoke.setScale(renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)));
    sparks.setScale(renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)));

    // audio + hud
    audio.update({ dt, rpm: vehicle.rpm, throttle: vehicle.input.throttle, boost: vehicle.boost, speed: sp, slipF, slipR, hard, limiter: vehicle.limiter, scrape: vehicle.scrape, gear: vehicle.gear });
    Object.assign(hudState, { beta: vehicle.t.beta, kmh: vehicle.t.kmh, speed: sp, grounded: vehicle.grounded, vLong: vehicle.t.vLong, slipR, wallDist, crashed, gear: vehicle.gear, rpm: vehicle.rpm, assist: vehicle.steerAssist, abs: vehicle.abs, auto: vehicle.auto, handbrake: vehicle.input.handbrake, cam: CAM_NAMES[cam.mode] });
    hud.update(dt, hudState);

    // camera + shared focus (shadow frustum, lamp lights, streaming)
    cam.update(dt, rp, rq, vehicle.vel, sp, vehicle.t.beta, ground, occlude);
    drive.focus.copy(rp);
    camera.updateMatrixWorld();
  }

  console.log(`[car] ready in ${(performance.now() - t0).toFixed(0)} ms, spawn`, spawn);
  drive.car = { vehicle, ground, hud, teleport: (x, z, heading) => respawn({ x, z, y: null, heading }) };       // public API for the map / navigator (src/nav.js)
  window.__car = { vehicle, world, ground, colliders, respawn, applyPaint, audio, cam, hud, RAPIER, root, rig, skids, smoke, sparks, input };
  return { update };
}
