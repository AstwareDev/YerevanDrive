// Headless flight tests for the helicopter model (src/heli/flight.js):  node tools/sim-heli.mjs
// Flat ground at y = 0. Each scenario prints the numbers that matter; a PASS / FAIL line summarises the expectation.
import * as THREE from 'three';
import { createFlight, SPECS, COM } from '../src/heli/flight.js';

let crashed = null;
const env = { ground: () => 0, groundAt: () => 0, locked: () => false, crash: r => { crashed ??= r; } };
const DT = 1 / 120;
const heading = f => Math.atan2(f.fwd.x, f.fwd.z) * 180 / Math.PI;
const ramp = (cur, tgt, up, dn, dt) => cur + Math.max(-dn * dt, Math.min(up * dt, tgt - cur));
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fails++; };

function fly(f, secs, input = {}, probe) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT, I = typeof input === 'function' ? input(t, f) : input;
    f.cmd.p = ramp(f.cmd.p, I.p ?? 0, 5, 9, DT); f.cmd.r = ramp(f.cmd.r, I.r ?? 0, 5, 9, DT); f.cmd.y = ramp(f.cmd.y, I.y ?? 0, 6, 9, DT); f.cmd.lift = ramp(f.cmd.lift, I.lift ?? 0, 4.5, 8, DT);
    f.step(DT); probe?.(t, f);
  }
}
const fresh = (y = 60, assist = true) => { crashed = null; const f = createFlight(THREE, env); f.place(0, y, 0, 0); f.S.assist = assist; f.S.impactCool = 0; return f; };
const deg = r => r * 180 / Math.PI;

{ // 1. hover hold
  const f = fresh(); fly(f, 20);
  check('hover holds position (assist)', Math.abs(f.S.p.y - COM_Y(f) - 60) < 1.5 && f.S.v.length() < 0.3 && !crashed, `alt drift ${(f.S.p.y - COM_Y(f) - 60).toFixed(2)} m, speed ${f.S.v.length().toFixed(2)} m/s, col ${(f.S.col * 100).toFixed(0)}%`);
}
function COM_Y() { return COM.y; }
{ // 2. climb
  const f = fresh(); let vmax = 0; fly(f, 6, { lift: 1 }, (t, g) => { vmax = Math.max(vmax, g.S.v.y); });
  fly(f, 4); const y1 = f.S.p.y; fly(f, 8);
  check('climbs at the commanded rate and holds the new altitude', vmax > 7.5 && vmax < 10.5 && Math.abs(f.S.p.y - y1) < 3 && Math.abs(f.S.v.y) < 0.4, `max climb ${vmax.toFixed(1)} m/s, then drift ${(f.S.p.y - y1).toFixed(2)} m over 8 s`);
}
{ // 3. forward flight
  const f = fresh(); let top = 0, pitch = 0; fly(f, 40, { p: 1 }, (t, g) => { top = Math.max(top, Math.hypot(g.S.v.x, g.S.v.z)); pitch = Math.max(pitch, deg(g.eul.x)); });
  check('full cyclic reaches a sensible top speed, altitude held', top > 55 && top < 95 && Math.abs(f.S.p.y - 1.9 - 60) < 6, `top ${(top * 3.6).toFixed(0)} km/h (${top.toFixed(1)} m/s), max nose-down ${pitch.toFixed(1)}°, alt ${(f.S.p.y - 1.9).toFixed(1)} m (vmax spec ${SPECS.vmax})`);
}
{ // 4. right bank at speed -> right turn (heading decreases), 5. left pedal in hover -> heading increases
  const f = fresh(); fly(f, 15, { p: 0.6 }); const h0 = heading(f); fly(f, 8, { p: 0.6, r: 0.6 }); const h1 = heading(f);
  let d = ((h1 - h0 + 540) % 360) - 180;
  check('bank right at speed turns right', d < -25, `heading change ${d.toFixed(0)}° in 8 s, speed ${(f.S.gs * 3.6).toFixed(0)} km/h, bank ${deg(f.eul.z).toFixed(0)}°`);
  const g = fresh(); fly(g, 3); const a0 = heading(g); fly(g, 3, { y: 1 }); d = ((heading(g) - a0 + 540) % 360) - 180;
  check('left pedal yaws left', d > 40 && d < 200, `heading change ${d.toFixed(0)}° in 3 s`);
}
{ // 6. landing: hold descend from 60 m
  const f = fresh(); let touch = null, crashAt = null; fly(f, 40, { lift: -1 }, (t, g) => { if (touch === null && g.S.onGround) touch = { t, vs: g.S.v.y }; });
  const before = crashed; fly(f, 10);
  check('descend input lands softly without crashing', touch && !before && !crashed && f.S.onGround && f.S.v.length() < 0.2, `touchdown after ${touch?.t.toFixed(1)} s at ${touch?.vs.toFixed(2)} m/s, then speed ${f.S.v.length().toFixed(3)} m/s, crash: ${before ?? crashed ?? 'none'}`);
  check('rests level on its wheels', Math.abs(deg(f.eul.x)) < 6 && Math.abs(deg(f.eul.z)) < 4, `pitch ${deg(f.eul.x).toFixed(1)}°, roll ${deg(f.eul.z).toFixed(1)}°, wheel height ${(f.S.p.y - 1.9).toFixed(3)} m`);
}
{ // 7. raw mode: collective lever at hover trim holds roughly, cyclic neutral does not run away instantly
  const f = fresh(60, false); fly(f, 6);
  check('manual mode: no instant divergence', Math.abs(f.S.p.y - 1.9 - 60) < 25 && Math.abs(deg(f.eul.x)) < 30 && !crashed, `alt ${(f.S.p.y - 1.9).toFixed(1)} m, pitch ${deg(f.eul.x).toFixed(1)}°, roll ${deg(f.eul.z).toFixed(1)}°, col ${(f.S.col * 100).toFixed(0)}%`);
}
{ // 8. engine failure: crashes eventually (nobody flares in this test)
  const f = fresh(100); f.S.engine = false; let hit = null; fly(f, 40, {}, (t, g) => { if (hit === null && crashed) hit = t; });
  check('engine off: descends and ends in a crash or a rough landing', f.S.p.y < 20, `alt ${(f.S.p.y - 1.9).toFixed(1)} m after 40 s, vs ${f.S.v.y.toFixed(1)}, crash: ${crashed ?? 'none'}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
