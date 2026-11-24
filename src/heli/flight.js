// Helicopter flight model (pure maths: three.js vectors only, no DOM / Rapier) so tools/sim-heli.mjs can fly it headless.
// Own rigid body at 120 Hz: thrust along the rotor-disc normal (collective x rotor rpm^2, ground effect, translational lift, density falls with altitude),
// body-axis quadratic drag, main-rotor torque reaction, three spring-damper wheels with friction and hard points (nose, tail, fin, rotor tips) against the ground.
// Body frame like the cars: x = left, y = up, z = forward (nose).  Euler YXZ: pitch + = nose down, roll + = banked right, yaw + = turning left.
//   assist ON  = attitude command (cyclic sets a pitch / bank angle) + vertical-speed hold on the collective + coordinated turns + auto-flare
//   assist OFF = raw rate command on the cyclic, collective lever that stays where you leave it
export const SPECS = { name: 'Sikorsky SH-60B Seahawk', sub: 'Twin-turboshaft · Naval utility helicopter', mass: 6800, vmax: 80, climb: 9, rotorD: 15.6 };
export const G = 9.81, RHO = 1.2;
export const COM = { y: 1.9, z: 0.1 };                                        // centre of mass in model space (model origin = mast axis at wheel level)
export const HUB_Y = 3.38, ROTOR_R = 7.8;
const INERTIA = { x: 52000, y: 48000, z: 13000 };                             // pitch / yaw / roll (kg m^2), used for ground-contact torques only
export const GEAR = [[1.2, 0, 0.95, 1], [-1.2, 0, 0.95, 1], [0, 0, -3.6, 0]]; // wheel contact points (model space) [x, y, z, rolls-along-heading]
export const HARD = [[0, 0.9, 4.3], [0, 1.4, -9.4], [0, 4.7, -10.2], [0, 1.0, -6.0]];     // nose, tail cone, fin tip, boom
export const RING = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * (ROTOR_R - 0.3), HUB_Y, Math.sin(i * Math.PI / 4) * (ROTOR_R - 0.3)]);

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const approach = (cur, tgt, up, dn, dt) => cur + Math.max(-dn * dt, Math.min(up * dt, tgt - cur));

/** env: { ground(x, z) -> terrain height, groundAt(x, z, y, tall) -> terrain or roof height under a probe point, locked() -> UI open, crash(reason) } */
export function createFlight(THREE, env) {
  const S = {
    p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
    rpm: 1, col: 0.52, engine: true, assist: true, spawned: false, crashT: 0, onGround: false, vs: 0, agl: 0, gs: 0, impactCool: 0, mass: SPECS.mass,
  };
  const cmd = { p: 0, r: 0, y: 0, lift: 0 };                                  // smoothed pilot inputs
  const q = S.q, P = new THREE.Vector3(), V = new THREE.Vector3(), F = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), lft = new THREE.Vector3();
  const qi = new THREE.Quaternion(), dq = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ'), rW = new THREE.Vector3(), rB = new THREE.Vector3(), vB = new THREE.Vector3(), fB = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), hit = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);

  function place(x, y, z, heading) {            // y = wheel level
    S.p.set(x, y + COM.y, z); S.v.set(0, 0, 0); S.w.set(0, 0, 0); q.setFromAxisAngle(Y, heading);
    S.rpm = 1; S.col = 0.52; S.engine = true; S.crashT = 0; S.spawned = true; S.impactCool = 1; cmd.p = cmd.r = cmd.y = cmd.lift = 0;
    refresh();
  }
  function refresh() { up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, 1).applyQuaternion(q); lft.set(1, 0, 0).applyQuaternion(q); eul.setFromQuaternion(q, 'YXZ'); }

  function step(dt) {
    q.normalize(); refresh();
    qi.copy(q).invert(); vB.copy(S.v).applyQuaternion(qi);
    const groundH = env.ground(S.p.x, S.p.z), agl = S.p.y - COM.y - groundH; S.agl = agl; S.vs = S.v.y;
    const hs = Math.hypot(S.v.x, S.v.z); S.gs = hs;
    const dead = S.crashT > 0;

    // ---- rotor rpm
    if (S.engine && !dead) S.rpm = approach(S.rpm, 1, 0.2, 1, dt);
    else { S.rpm = Math.max(0, S.rpm - 0.045 * dt); if (!dead && S.v.y < -3 && agl > 6) S.rpm = Math.min(0.85, S.rpm + (0.62 + 0.02 * -S.v.y - S.rpm) * 0.5 * dt); }   // windmilling in a descent: crude autorotation
    const rpm2 = S.rpm * S.rpm;

    // ---- collective
    const dens = Math.exp(-Math.max(0, S.p.y) / 8500), ge = 0.16 * Math.exp(-Math.max(0, agl) / 5.5), tl = 0.14 * sm(4, 16, hs);
    const TG = 1.95 * dens * rpm2 * (1 + ge + tl);                              // thrust / weight at full collective
    if (S.assist) {
      let vt = cmd.lift > 0 ? cmd.lift * SPECS.climb : cmd.lift * 6.2; if (vt < 0) vt = Math.max(vt, -(1.0 + 0.5 * Math.max(0, agl)));     // flare: the nearer the ground, the slower the allowed sink
      const grounded = S.onGround && cmd.lift <= 0.02;
      const want = grounded ? -1.2 : clamp(1.7 * (vt - S.v.y), -6, 7);          // vertical acceleration command
      const need = (G + want) / Math.max(0.55, up.y);                            // thrust acceleration needed along the disc normal
      S.col = approach(S.col, clamp(need / (G * Math.max(0.05, TG)), 0, 1), 1.6, 2.4, dt);
    } else S.col = clamp(S.col + (cmd.lift * 0.42) * dt, 0, 1);
    const thrust = S.mass * G * TG * S.col * (dead ? 0 : 1);

    // ---- attitude: angular acceleration (body axes: x pitch, y yaw, z roll)
    const auth = clamp(rpm2, 0, 1.05); let ax = 0, ay = 0, az = 0;
    if (S.assist) {
      const slow = 1 - sm(0.82, 1.08, Math.max(0, vB.z) / SPECS.vmax);
      const pT = cmd.p * 0.34 * (cmd.p > 0 ? slow : 1), rT = cmd.r * 0.5;
      ax = 15 * (pT - eul.x) - 5.4 * S.w.x; az = 15 * (rT - eul.z) - 5.4 * S.w.z;
      const hv = hs * sm(6, 22, hs), turn = G * Math.tan(clamp(eul.z, -0.8, 0.8)) / Math.max(12, hv);       // coordinated turn: bank to the right -> yaw right
      ay = 4.6 * (cmd.y * 0.95 - turn * sm(0.12, 0.5, Math.abs(eul.z) * 3) * (hv > 3 ? 1 : 0) - S.w.y);
    } else {
      ax = 4.4 * cmd.p - 1.7 * S.w.x; az = 5.6 * cmd.r - 1.7 * S.w.z; ay = 4.2 * cmd.y - 1.6 * S.w.y - 0.55 * (S.col - 0.5) * rpm2 * 4;
    }
    ax *= auth; ay *= auth; az *= auth;
    ay -= 0.03 * vB.x * Math.min(1, hs / 12);                                    // weathercock: the tail pushes the nose into the wind
    if (dead) { ax = ay = az = 0; }

    // ---- forces (world)
    F.set(0, -S.mass * G, 0).addScaledVector(up, thrust);
    fB.set(-0.5 * RHO * 9 * Math.abs(vB.x) * vB.x, -0.5 * RHO * 16 * Math.abs(vB.y) * vB.y, -0.5 * RHO * 5.2 * Math.abs(vB.z) * vB.z).applyQuaternion(q); F.add(fB);
    let tx = 0, ty = 0, tz = 0;                                                  // contact torque (body frame)
    S.onGround = false;
    const nPts = 3 + HARD.length + RING.length;
    for (let i = 0; i < nPts; i++) {
      const wheel = i < 3, hard = i >= 3 && i < 3 + HARD.length, pt = wheel ? GEAR[i] : hard ? HARD[i - 3] : RING[i - 3 - HARD.length];
      rB.set(pt[0], pt[1] - COM.y, pt[2] - COM.z); rW.copy(rB).applyQuaternion(q);
      P.copy(S.p).add(rW);
      // cheap early-out: nothing can touch while the whole helicopter is well above the ground
      if (agl > 14 && !(wheel || hard)) continue;
      V.copy(S.w).cross(rB).applyQuaternion(q).add(S.v);                          // velocity of the point (w is in the body frame)
      const gy = env.groundAt(P.x, P.z, P.y, wheel || (hard && i - 3 < 4)), pen = gy - P.y;
      if (pen <= (wheel ? 0.02 : 0)) continue;
      if (wheel) {
        S.onGround = true;
        const k = 175000, c = 34000, fn = Math.max(0, k * pen - c * Math.min(0, V.y) + (V.y > 0 ? -c * 0.4 * V.y : 0));
        if (V.y < -4.4 && S.impactCool <= 0 && !dead) env.crash('Hard landing');
        tmp.copy(fwd).setY(0); if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, 1); tmp.normalize(); tmp2.set(tmp.z, 0, -tmp.x);       // wheel forward / sideways (horizontal)
        const vf = V.x * tmp.x + V.z * tmp.z, vl = V.x * tmp2.x + V.z * tmp2.z, roll = pt[3] ? (cmd.lift < 0.05 && S.col < 0.45 ? 0.2 : 0.04) : 0.05;
        const ffw = -clamp(vf / 0.6, -1, 1) * roll * fn, fl = -clamp(vl / 0.35, -1, 1) * 0.85 * fn;
        hit.set(0, fn, 0).addScaledVector(tmp, ffw).addScaledVector(tmp2, fl);
        F.add(hit); tmp.copy(rW).cross(hit).applyQuaternion(qi); tx += tmp.x; ty += tmp.y; tz += tmp.z;
      } else {                                                                     // nose / tail / fin / rotor tip in the ground
        if (!dead && S.impactCool <= 0 && (!hard || V.length() > 3.2 || pen > 0.5 || i - 3 === 2)) env.crash(hard ? 'Crashed into the ground' : 'Rotor strike');
        else { F.y += 120000 * pen; F.x -= V.x * 3000; F.z -= V.z * 3000; }
      }
    }
    // ---- integrate
    S.v.addScaledVector(F, dt / S.mass);
    ax += tx / INERTIA.x; ay += ty / INERTIA.y; az += tz / INERTIA.z;
    S.w.x += ax * dt; S.w.y += ay * dt; S.w.z += az * dt;
    S.w.x = clamp(S.w.x, -3, 3); S.w.y = clamp(S.w.y, -3, 3); S.w.z = clamp(S.w.z, -3.5, 3.5);
    const ang = S.w.length() * dt; if (ang > 1e-7) { tmp.copy(S.w).normalize(); dq.setFromAxisAngle(tmp, ang); q.multiply(dq); }
    S.p.addScaledVector(S.v, dt);
    if (S.p.y > 4500) { S.p.y = 4500; S.v.y = Math.min(0, S.v.y); }
    S.impactCool = Math.max(0, S.impactCool - dt);
    // settled on the wheels with nothing commanded: stop the creep entirely
    if (S.onGround && !env.locked() && S.col < 0.5 && hs < 0.25 && cmd.lift <= 0) { S.v.x *= 0.9; S.v.z *= 0.9; S.w.y *= 0.9; }
  }
  return { S, cmd, step, place, refresh, up, fwd, lft, eul, vB };
}
