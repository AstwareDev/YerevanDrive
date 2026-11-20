// Headless physics harness for the drift car (flat road): node tools/sim-car.mjs [scenario]
// Used to tune src/car/vehicle.js without a browser. Prints a time series of speed / gear / body slip angle / yaw rate / steering.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Vehicle, CAR, applyProfile } from '../src/car/vehicle.js';
// car under test: CAR=<bmw_m2|mclaren_p1|countach> node tools/sim-car.mjs <scenario>   (profiles in src/car/profiles.js)
applyProfile(process.env.CAR ?? 'bmw_m2'); console.log('car', process.env.CAR ?? 'bmw_m2', 'mass', CAR.mass);

await RAPIER.init();
const DT = 1 / 120;
const ground = { y: () => 0, terrain: () => 0, normal: (x, z, o) => o.set(0, 1, 0), surface: () => 1, mu: () => 1, inBounds: () => true };

function make() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT;
  const v = new Vehicle({ RAPIER, world, ground }); v.reset(0, 0, 0);
  for (let i = 0; i < 120; i++) v.step(DT);
  return v;
}
const ramp = (cur, tgt, up, dn) => cur + Math.max(-dn * DT, Math.min(up * DT, tgt - cur));
function run(name, script, T = 12, every = 0.25, opts = {}) {
  const v = make(); Object.assign(v, opts);
  let steer = 0, t = 0; const rows = [];
  const keys = { thr: 0, brk: 0, left: 0, hb: 0 };
  let thr = 0, hb = 0;
  for (let i = 0; t < T; i++, t = i * DT) {
    script(t, keys, v);
    thr = ramp(thr, keys.thr, 6, 10); hb = ramp(hb, keys.hb, 14, 8);
    const sp = v.t.speed, rate = keys.left === 0 ? 5.5 : Math.sign(keys.left) !== Math.sign(steer) && steer !== 0 ? 9 : 4.8 - 1.4 * Math.min(sp / 40, 1);
    steer += Math.max(-rate * DT, Math.min(rate * DT, keys.left - steer));
    v.input.throttle = thr; v.input.brake = keys.brk; v.input.handbrake = hb; v.input.steer = steer;
    if (keys.kick) { v.input.kick = true; keys.kick = false; }
    v.step(DT);
    if (i % Math.round(every / DT) === 0) rows.push([t.toFixed(2), (v.t.kmh).toFixed(0), v.gear, Math.round(v.rpm), (v.t.beta * 57.3).toFixed(0), v.t.yawRate.toFixed(2), (v.steerWheel * 57.3).toFixed(0), v.wheels[2].slip.toFixed(1), v.wheels[0].slip.toFixed(1), v.wheels[2].slipV.toFixed(1)].join('\t'));
  }
  console.log(`\n== ${name}   t\tkmh\tgear\trpm\tbeta\tyaw\tsteer\tsR\tsF\tslipV`); console.log(rows.join('\n'));
  return v;
}

const which = process.argv[2] ?? 'all';
const accel = (t, k) => { k.thr = 1; };
if (which === 'all' || which === 'accel') {
  const v = make(); let t100 = null; const k = { thr: 1 }; let thr = 0;
  for (let i = 0; i < 20 * 120; i++) { thr = ramp(thr, 1, 6, 10); v.input.throttle = thr; v.step(DT); if (!t100 && v.t.kmh >= 100) t100 = i * DT; }
  console.log('\n== accel: 0-100 km/h', t100?.toFixed(2), 's, 20 s speed', v.t.kmh.toFixed(0), 'km/h (gear', v.gear + ')');
}
if (which === 'all' || which === 'kick') run('kick drift: 90 km/h, left + clutch-kick, then throttle held', (t, k) => { k.thr = 1; k.left = (t > 7 && t < 7.5) ? 1 : 0; if (t > 7 && !k._k) { k._k = true; k.kick = true; } }, 14);
if (which === 'all' || which === 'hb') run('handbrake drift: 80 km/h, left + handbrake tap, then throttle held', (t, k) => { k.thr = t < 6 || t > 7.2 ? 1 : 0.3; k.left = (t > 6 && t < 6.6) ? 1 : 0; k.hb = (t > 6.2 && t < 6.7) ? 1 : 0; }, 14);
if (which === 'all' || which === 'hold') run('held drift: kick + keep A held while counter-steering by assist', (t, k) => { k.thr = 1; k.left = t > 7 ? (t < 7.5 ? 1 : 0.0) : 0; if (t > 7 && !k._k) { k._k = true; k.kick = true; } if (t > 9) k.left = 0.35; }, 16, 0.5, process.env.A ? { steerAssist: +process.env.A } : {});
if (which === 'all' || which === 'noassist') run('NO assist: kick drift', (t, k) => { k.thr = 1; k.left = (t > 7 && t < 7.5) ? 1 : 0; if (t > 7 && !k._k) { k._k = true; k.kick = true; } }, 14, 0.25, { steerAssist: 0, tcs: false });
if (which === 'all' || which === 'corner') run('grip corner: 60 km/h, steer left held', (t, k) => { k.thr = t < 4 ? 1 : 0.35; k.left = t > 5 ? 0.5 : 0; }, 12);
if (which === 'all' || which === 'circle') run('drift circle: kick at 85 km/h then A held fully, throttle held', (t, k) => { k.thr = 1; k.left = t > 6.5 ? 1 : 0; if (t > 6.5 && !k._k) { k._k = true; k.kick = true; } }, 16, 0.5);
if (which === 'all' || which === 'circle2') run('drift circle (handbrake init): A held fully, throttle held', (t, k) => { k.thr = 1; k.left = t > 6.0 ? 1 : 0; k.hb = (t > 6.2 && t < 6.6) ? 1 : 0; }, 16, 0.5);
if (which === 'all' || which === 'lowhb') run('low-speed handbrake: ~30 km/h, left + handbrake, throttle off', (t, k) => { k.thr = t < 1.6 ? 1 : 0; k.left = t > 2 ? 1 : 0; k.hb = t > 2 ? 1 : 0; }, 6, 0.25);
