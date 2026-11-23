// Drift quality metrics (headless, flat road): node tools/sim-drift.mjs [verbose]
// Scenarios: donut (full lock held), kick-hold (kick + steer in then ease off), transition (left drift -> right drift), handbrake entry.
// Per scenario prints speed retained, mean / std of body slip angle in the steady window and the number of yaw-rate sign flips (wobble).
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle, CAR, applyProfile } from '../src/car/vehicle.js';
applyProfile(process.env.CAR ?? 'bmw_m2');
await RAPIER.init();
const DT = 1 / 120;
const ground = { y: () => 0, terrain: () => 0, normal: (x, z, o) => o.set(0, 1, 0), surface: () => 1, mu: () => 1, inBounds: () => true };
const ramp = (cur, tgt, up, dn) => cur + Math.max(-dn * DT, Math.min(up * DT, tgt - cur));
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function run(name, script, T, win) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT;
  const v = new Vehicle({ RAPIER, world, ground }); v.reset(0, 0, 0); for (let i = 0; i < 120; i++) v.step(DT);
  let steer = 0, thr = 0, hb = 0; const k = { thr: 0, left: 0, hb: 0 }; const rows = [];
  let hs = [0, 0, 0, 0], straightMax = 0, slideSum = 0, slideN = 0, n = 0, sb = 0, sb2 = 0, flips = 0, lastY = 0, v0 = null, v1 = 0, ssum = 0, minSp = 1e9;
  for (let i = 0; i * DT < T; i++) {
    const t = i * DT; script(t, k, v);
    thr = ramp(thr, k.thr, 6, 10); hb = ramp(hb, k.hb, 14, 8);
    const sp = v.t.speed, rate = k.left === 0 ? 5.5 : Math.sign(k.left) !== Math.sign(steer) && steer !== 0 ? 9 : 4.8 - 1.4 * Math.min(sp / 40, 1);
    steer += Math.max(-rate * DT, Math.min(rate * DT, k.left - steer));
    v.input.throttle = thr; v.input.handbrake = hb; v.input.steer = steer; v.input.brake = 0;
    if (k.kick) { v.input.kick = true; k.kick = false; }
    v.step(DT);
    let hm = 0; for (let w = 0; w < 4; w++) { const W = v.wheels[w]; const burn = W.contact ? sm(40e3, 90e3, Math.hypot(W.fx, W.fy) * W.slipV) * sm(1.8, 6, W.slipV) * sm(0.7, 1.4, W.slip) : 0; hs[w] += (burn - hs[w]) * (1 - Math.exp(-DT * (burn > hs[w] ? 2.4 : 1.6))); hm = Math.max(hm, hs[w]); }
    if (t < 6) { straightMax = Math.max(straightMax, hm); if (process.env.DBG && hm > 0.05 && i % 12 === 0) console.log("t", t.toFixed(2), "kmh", v.t.kmh.toFixed(0), "heat", hm.toFixed(2)); }
    if (t >= win[0] && t <= win[1]) { slideSum += hm; slideN++; }
    if (t >= win[0] && t <= win[1]) {
      const b = Math.abs(v.t.beta) * 57.3; n++; sb += b; sb2 += b * b; ssum += v.t.kmh; minSp = Math.min(minSp, v.t.kmh);
      const y = v.t.yawRate; if (Math.abs(y) > 0.15 && Math.sign(y) !== Math.sign(lastY) && lastY !== 0) flips++; if (Math.abs(y) > 0.15) lastY = y;
      if (v0 === null) v0 = v.t.kmh; v1 = v.t.kmh;
    }
    if (process.argv[2] === 'verbose' && i % 30 === 0) rows.push([t.toFixed(2), v.t.kmh.toFixed(0), (v.t.beta * 57.3).toFixed(0), v.t.yawRate.toFixed(2), (v.steerWheel * 57.3).toFixed(0), v.wheels[2].slipX.toFixed(1)].join('\t'));
  }
  const mean = sb / n, sd = Math.sqrt(Math.max(0, sb2 / n - mean * mean));
  console.log(`${name.padEnd(12)} speed ${v0?.toFixed(0)}->${v1.toFixed(0)} (min ${minSp.toFixed(0)}, avg ${(ssum / n).toFixed(0)}) km/h   |beta| mean ${mean.toFixed(0)} sd ${sd.toFixed(1)} deg   yaw flips ${flips}   smoke: straight-pull max ${straightMax.toFixed(2)}, slide avg ${(slideSum / slideN).toFixed(2)}`);
  if (rows.length) console.log('t\tkmh\tbeta\tyaw\tsteer\tkappaR\n' + rows.join('\n'));
}
const E = +(process.env.ENTRY ?? 0);           // seconds earlier the slide starts (ENTRY=3 -> ~75 km/h entry instead of ~115)
const kick = k => { if (!k._k) { k._k = true; k.kick = true; } };
const S = fn => (t, k, v) => fn(t + E, k, v);
run('donut', S((t, k) => { k.thr = 1; k.left = t > 6.5 ? 1 : 0; if (t > 6.5) kick(k); }), 18 - E, [10 - E, 18 - E]);
run('kick-hold', S((t, k) => { k.thr = 1; k.left = t > 7 && t < 7.5 ? 1 : t >= 7.5 ? 0.35 : 0; if (t > 7) kick(k); }), 18 - E, [10 - E, 18 - E]);
run('transition', S((t, k) => { k.thr = 1; k.left = t > 6.5 && t < 9.5 ? 1 : t >= 9.5 && t < 13 ? -1 : 0; if (t > 6.5 && t < 7) kick(k); if (t > 9.4 && !k._k2) { k._k2 = true; k.kick = true; } }), 18 - E, [7.5 - E, 18 - E]);
run('handbrake', S((t, k) => { k.thr = 1; k.left = t > 6 && t < 6.6 ? 1 : t >= 6.6 ? 0.5 : 0; k.hb = t > 6.2 && t < 6.7 ? 1 : 0; }), 18 - E, [9 - E, 18 - E]);
