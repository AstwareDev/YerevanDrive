// Drift-car vehicle dynamics. Rapier owns the rigid body (mass, inertia, collisions with buildings / barriers / props);
// everything that makes it feel like a car is ours: 4 raycast-style suspension corners over the analytic ground, weight transfer,
// a combined-slip tyre model (friction ellipse with Pacejka-shaped falloff + relaxation length), RWD drivetrain with torque curve,
// gearbox, clutch kick, handbrake, locked-ish differential, drag and a belly / roof "scrape" spring so the car can never sink into the ground.
// Frame: x = car's left (when facing +z), y up, z forward. Body origin = centre of mass.
import * as THREE from 'three';

import { CAR_PROFILES, DEFAULT_CAR, PHYS_DEFAULTS } from './profiles.js';
/** the active car's parameters (mutated in place by applyProfile so every module keeps one live reference) */
export const CAR = {};
export function applyProfile(id) {
  const p = CAR_PROFILES[id] ?? CAR_PROFILES[DEFAULT_CAR];
  for (const k of Object.keys(CAR)) delete CAR[k];
  Object.assign(CAR, PHYS_DEFAULTS, p.phys);
  if (CAR.hpY === undefined) CAR.hpY = CAR.R - CAR.hCOM + CAR.dRest;       // wheel centre sits at y = R when the suspension is at its rest height
  return p;
}
applyProfile(DEFAULT_CAR);
const MF_C = 1.45, MF_B = Math.tan(Math.PI / (2 * MF_C));
const sat = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x, a, b) => { const t = sat((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function torqueAt(rpm) { const c = CAR.torque; if (rpm <= 0) return 0; for (let i = 1; i < c.length; i++) if (rpm <= c[i][0]) { const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t; } return c[c.length - 1][1]; }

const _q = new THREE.Quaternion(), _pos = new THREE.Vector3(), _vel = new THREE.Vector3(), _ang = new THREE.Vector3();
const _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _lf = new THREE.Vector3();
const _rel = new THREE.Vector3(), _hp = new THREE.Vector3(), _vh = new THREE.Vector3(), _nG = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3();
const _pc = new THREE.Vector3(), _vc = new THREE.Vector3(), _ft = new THREE.Vector3(), _fs = new THREE.Vector3(), _ap = new THREE.Vector3(), _t = new THREE.Vector3(), _F = new THREE.Vector3(), _T = new THREE.Vector3();
const _bp = new THREE.Vector3(), _bv = new THREE.Vector3();
const tireOut = { fx: 0, fy: 0, s: 0 };

function tire(w, fz, mu, kappa, sigma) {
  const nx = kappa / w.kxPk, ny = sigma / w.syPk, s = Math.hypot(nx, ny);
  if (s < 1e-5) { tireOut.fx = tireOut.fy = tireOut.s = 0; return tireOut; }
  const f = Math.sin(MF_C * Math.atan(MF_B * s));
  const load = sat(1 - 0.14 * (fz / 4000 - 1), 0.7, 1.15);          // load sensitivity: heavily loaded tyres give less grip per newton
  const F = mu * w.mu * load * fz * f;
  tireOut.fx = F * nx / s; tireOut.fy = -F * ny / s; tireOut.s = s; return tireOut;
}

export class Vehicle {
  constructor({ RAPIER, world, ground }) {
    this.RAPIER = RAPIER; this.world = world; this.ground = ground;
    const bd = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0).setAngularDamping(0.05);
    this.body = world.createRigidBody(bd); this.cols = [];
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, kick: false, shiftUp: false, shiftDown: false };
    this.gear = 1; this.auto = true; this.rpm = CAR.idle; this.shiftT = 0; this.kickT = 0; this.boost = 0; this.limiter = false;
    this.steerWheel = 0; this.steerAssist = 0.95; this.abs = true; this.tcs = true;
    this.t = { speed: 0, kmh: 0, vLong: 0, vLat: 0, beta: 0, yawRate: 0, gLat: 0, gLong: 0 };
    this.impact = 0; this.flipT = 0; this.airT = 0; this.scrape = 0;
    this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion(); this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.fwd = new THREE.Vector3(0, 0, 1);
    this.lastAccel = new THREE.Vector3(); this._lastV = new THREE.Vector3();
    this.build();
  }

  /** (re)creates everything that depends on the active CAR profile: collision boxes, mass properties, the four wheel corners and the belly / roof scrape points */
  build() {
    const { RAPIER, world, body } = this;
    for (const c of this.cols) world.removeCollider(c, false);
    const bx = CAR.box, cb = CAR.cabin;
    this.cols = [
      world.createCollider(RAPIER.ColliderDesc.cuboid(bx.hx, bx.hy, bx.hz).setTranslation(0, bx.oy, bx.oz).setDensity(0).setFriction(0.25).setRestitution(0.12), body),
      world.createCollider(RAPIER.ColliderDesc.cuboid(cb.hx, cb.hy, cb.hz).setTranslation(0, cb.oy, cb.oz).setDensity(0).setFriction(0.2).setRestitution(0.1), body),   // cabin
    ];
    body.setAdditionalMassProperties(CAR.mass, { x: 0, y: 0, z: 0 }, CAR.inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    const mk = (key, left, front) => {
      const a = front ? CAR.axleF : CAR.axleR, x = (left ? 1 : -1) * a.x;
      return { key, front, left, x, z: a.z, hp: new THREE.Vector3(x, CAR.hpY, a.z - CAR.zCOM),
        k: front ? CAR.kF : CAR.kR, cb: front ? CAR.cbF : CAR.cbR, cr: front ? CAR.crF : CAR.crR,
        mu: front ? CAR.muF : CAR.muR, kxPk: CAR.kxPk, syPk: front ? CAR.syPkF : CAR.syPkR,
        omega: 0, d: CAR.dRest, c: 0, steer: 0, spin: 0, contact: false, fz: 0, sy: 0, slip: 0, slipX: 0, slipY: 0, surf: 1, pcx: 0, pcy: 0, pcz: 0, vx: 0, vy: 0, fx: 0, fy: 0 };
    };
    this.wheels = [mk('FL', true, true), mk('FR', false, true), mk('RL', true, false), mk('RR', false, false)];
    const bz0 = bx.oz - bx.hz + 0.23, bz1 = bx.oz + bx.hz - 0.13, belly = bx.oy - bx.hy + 0.02, roofY = cb.oy + cb.hy - 0.08, bw = bx.hx - 0.08;
    this.bumpPts = [[bw, belly, bz1], [-bw, belly, bz1], [bw, belly, bz0], [-bw, belly, bz0], [0, belly + 0.08, bx.oz + bx.hz + 0.07], [0, belly + 0.08, bx.oz - bx.hz - 0.07],
      [cb.hx, roofY, cb.oz + cb.hz * 0.65], [-cb.hx, roofY, cb.oz + cb.hz * 0.65], [cb.hx, roofY, cb.oz - cb.hz * 0.8], [-cb.hx, roofY, cb.oz - cb.hz * 0.8]].map(p => new THREE.Vector3(...p));
  }

  /** switch to another garage car (profile id from src/car/profiles.js): rebuilds the rig; the caller respawns the car afterwards */
  setProfile(id) { applyProfile(id); this.build(); this.rpm = CAR.idle; this.gear = 1; }

  reset(x, z, heading, y = null) {
    const g = this.ground.y(x, z), b = this.body;
    b.setTranslation({ x, y: (y ?? g) + CAR.hCOM + 0.05, z }, true);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading); b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) { w.omega = 0; w.d = CAR.dRest; w.sy = 0; w.steer = 0; w.spin = 0; }
    this.gear = 1; this.rpm = CAR.idle; this.steerWheel = 0; this.shiftT = 0; this.kickT = 0; this.flipT = 0;
    this.prevPos.set(x, g + CAR.hCOM, z); this.pos.copy(this.prevPos); this.prevQuat.copy(_q); this.quat.copy(_q);
  }

  /** maximum steering angle (rad) of the steering wheel input as a function of speed */
  maxSteer(speed) { return (42 - 17 * smooth(speed, 3, 34)) * Math.PI / 180; }

  step(dt) {
    const { body, ground, input, wheels: W } = this, R = CAR.R, G = 9.81;
    const tr = body.translation(), rq = body.rotation(), lv = body.linvel(), av = body.angvel();
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    _pos.set(tr.x, tr.y, tr.z); _q.set(rq.x, rq.y, rq.z, rq.w); _vel.set(lv.x, lv.y, lv.z); _ang.set(av.x, av.y, av.z);
    _up.set(0, 1, 0).applyQuaternion(_q); _fw.set(0, 0, 1).applyQuaternion(_q); _lf.set(1, 0, 0).applyQuaternion(_q);
    const fwdH = Math.hypot(_fw.x, _fw.z) || 1, hx = _fw.x / fwdH, hz = _fw.z / fwdH;
    const vLong = _vel.x * hx + _vel.z * hz, vLat = _vel.x * hz - _vel.z * hx;    // horizontal components along / across the heading (lat + = left)
    const speed = Math.hypot(_vel.x, _vel.z);

    // ---------------------------------------------------------------- pedals / direction logic
    const rl0 = this.wheels[2], rr0 = this.wheels[3];
    let thr, brk;
    if (this.gear === -1) { if (input.throttle > 0.05 && vLong > -1.0) this.gear = 1; }
    else if (input.brake > 0.05 && input.throttle < 0.05 && vLong < 1.0) { this.gear = -1; }
    if (this.gear === -1) { thr = input.brake; brk = input.throttle; }
    else { thr = input.throttle; brk = vLong > 0.5 ? input.brake : 0; }
    if (this.tcs && thr > 0.05 && this.gear >= 1 && vLong < 11) {          // launch traction control (below ~40 km/h): keeps the rear wheels near peak slip
      const kr = Math.max(rl0.omega, rr0.omega) * R / Math.max(vLong, 2.0) - 1;
      const inSlide = smooth(Math.abs(Math.atan2(vLat, Math.max(vLong, 0.1))), 0.12, 0.35);       // launch control must not strangle a slide / donut that has dropped below 40 km/h
      thr *= 1 - (1 - sat(1 - (kr - 0.22) * 2.8, 0.18, 1)) * (1 - inSlide);
    }
    if (this.steerAssist > 0 && thr > 0.05 && this.gear >= 1 && speed > 6) {   // drift assist: fade the power as the slide angle / rear wheelspin run away, so a held throttle sustains the drift instead of spinning the car
      const bAbs = Math.abs(Math.atan2(vLat, Math.max(vLong, 0.1)));
      const kr2 = (Math.max(rl0.omega, rr0.omega) * R - speed) / Math.max(speed, 6);
      thr *= Math.max(0.35, 1 - 0.45 * smooth(bAbs, 0.95, 1.35) - 0.25 * smooth(kr2, 1.2, 3.0));
    }
    this.boost += ((thr > 0.3 && this.rpm > 2400 ? thr : thr * 0.35) - this.boost) * Math.min(1, dt / 0.4);

    // ---------------------------------------------------------------- drivetrain
    const hold = input.throttle < 0.02 && input.brake < 0.02 && input.handbrake < 0.1 && Math.abs(vLong) < 1.4 && this.gear >= -1;   // parking hold: the car does not roll away on slopes
    const rl = W[2], rr = W[3];
    const ratio = this.gear === -1 ? -CAR.rev : this.gear >= 1 ? CAR.ratios[this.gear - 1] : 0, gr = ratio * CAR.final;
    const rpmW = Math.abs((rl.omega + rr.omega) * 0.5 * gr) * 30 / Math.PI;
    const rpmCar = speed / R * Math.abs(gr) * 30 / Math.PI;     // what the rpm would be without wheelspin (used for shift decisions)
    if (this.shiftT > 0) this.shiftT -= dt;
    if (this.kickT > 0) this.kickT -= dt;
    // gearbox (thresholds scale with the redline; they were tuned for 7200 rpm)
    const kRL = CAR.redline / 7200, top = CAR.ratios.length;
    if (this.gear >= 1) {
      if (this.auto) {
        if (this.shiftT <= 0 && !input.handbrake) {
          if (this.gear < top && rpmW > (this.kickT > 0 ? 7000 : 6500) * kRL && rpmCar > 4300 * kRL && thr > 0.2) { this.gear++; this.shiftT = 0.16; }
          else if (this.gear > 1 && rpmCar < (thr > 0.85 ? 2500 : 2100) * kRL) { this.gear--; this.shiftT = 0.12; }
        }
      }
      if (input.shiftUp && this.gear < top && this.shiftT <= 0) { this.gear++; this.shiftT = 0.16; }
      if (input.shiftDown && this.gear > 1 && this.shiftT <= 0) { this.gear--; this.shiftT = 0.12; }
    }
    input.shiftUp = input.shiftDown = false;
    if (input.kick && thr > 0.3 && this.gear >= 1) { this.kickT = 0.32; this.kickFlag = true; } input.kick = false;
    const clutchIn = input.handbrake > 0.4 || this.shiftT > 0 || this.gear === 0;
    let engineTq = 0, wheelTq = 0, IwR = CAR.Iw;
    if (clutchIn) {
      const target = CAR.idle + thr * (6400 * kRL - CAR.idle); this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
    } else {
      const launch = CAR.idle + 2700 * thr, rpmE = Math.max(CAR.idle, rpmW, launch * sat(1 - rpmW / 3600, 0, 1));
      this.rpm += (rpmE - this.rpm) * Math.min(1, dt * 40);
      if (this.limiter) { if (this.rpm < CAR.redline - 250) this.limiter = false; } else if (this.rpm >= CAR.redline) this.limiter = true;
      const full = torqueAt(this.rpm) * (0.8 + 0.2 * this.boost) * thr, drag = (1 - thr) * (45 + 0.022 * this.rpm);
      const kickMul = this.kickT > 0 ? 1 + 0.55 * (this.kickT / 0.32) : 1;
      engineTq = (this.limiter ? 0 : full * kickMul) - drag * smooth(rpmW, 800, 2200);
      wheelTq = engineTq * gr * CAR.eta;
      IwR = CAR.Iw + 0.5 * CAR.Ie * gr * gr * smooth(rpmW, 1400, 3200);
    }

    // ---------------------------------------------------------------- steering
    const maxA = this.maxSteer(speed);
    const beta = vLong > 0.8 ? Math.atan2(vLat, vLong) : 0;
    // while sliding, the player's lock is an offset around the counter-steer angle (it trims the slide), not an absolute wheel angle: a full flick the other way
    // must not add to the counter-steer and slam the wheels to 60 degrees (that spun the car on every direction change)
    let target = input.steer * maxA * (1 - 0.45 * smooth(Math.abs(beta), 0.2, 0.7) * this.steerAssist);
    if (this.steerAssist > 0 && vLong > 1.5 && speed > 3) {
      // auto counter-steer: point the front wheels along their own direction of travel (front axle velocity includes the yaw-rate term),
      // fading in with speed. The player's steering input is added on top, so it steers the slide instead of fighting it.
      const vyF = vLat + _ang.y * (CAR.axleF.z - CAR.zCOM);
      target += sat(Math.atan2(vyF, vLong), -0.9, 0.9) * this.steerAssist * smooth(speed, 3, 8);
    }
    const lim = (62 - 14 * smooth(Math.abs(beta), 0.3, 0.8) * this.steerAssist) * Math.PI / 180;
    target = sat(target, -lim, lim);
    const slew = 6.5 * dt; this.steerWheel += sat(target - this.steerWheel, -slew, slew);
    {
      const L = CAR.axleF.z - CAR.axleR.z, tw = CAR.axleF.x * 2, dlt = this.steerWheel, tn = Math.tan(Math.abs(dlt));
      let inner = dlt, outer = dlt;
      if (tn > 1e-3) { const Rc = L / tn; inner = Math.atan(L / Math.max(0.2, Rc - tw / 2)) * Math.sign(dlt); outer = Math.atan(L / (Rc + tw / 2)) * Math.sign(dlt); }
      inner = sat(inner, -64 * Math.PI / 180, 64 * Math.PI / 180);
      if (dlt >= 0) { W[0].steer = inner; W[1].steer = outer; } else { W[0].steer = outer; W[1].steer = inner; }
    }

    // ---------------------------------------------------------------- suspension pass
    _F.set(0, 0, 0); _T.set(0, 0, 0);
    let grounded = 0;
    for (const w of W) {
      _rel.copy(w.hp).applyQuaternion(_q); _hp.copy(_rel).add(_pos);
      _vh.copy(_ang).cross(_rel).add(_vel);
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      _f.set(0, 0, 0).addScaledVector(_fw, cs).addScaledVector(_lf, sn);
      ground.normal(_hp.x, _hp.z, _nG);
      _f.addScaledVector(_nG, -_f.dot(_nG)).normalize(); _l.crossVectors(_nG, _f);
      let gc = -1e9; for (let k = -1; k <= 1; k++) { const s = k * 0.2, gy = ground.y(_hp.x + _f.x * s, _hp.z + _f.z * s) - (R - Math.sqrt(R * R - s * s)); if (gy > gc) gc = gy; }
      const d = (_hp.y - gc) / Math.max(_up.y, 0.35) - R;
      w.surf = ground.surface(_hp.x, _hp.z); w.muS = ground.mu(_hp.x, _hp.z);
      const c = CAR.dFree - d;
      w.fx = w.fy = 0;
      if (c > 0) {
        w.contact = true; w.d = Math.max(d, -0.02); w.c = c; grounded++;
        const vcomp = -_vh.dot(_up);
        let fs = w.k * c + (d < 0.03 ? 350000 * (0.03 - d) : 0);
        fs += (vcomp > 0 ? w.cb : w.cr) * vcomp;
        w.fz = Math.max(0, fs);
      } else { w.contact = false; w.d += (CAR.dFree - w.d) * Math.min(1, dt * 14); w.c = 0; w.fz = 0; }
      w._hx = _hp.x; w._hy = _hp.y; w._hz = _hp.z; w._relx = _rel.x; w._rely = _rel.y; w._relz = _rel.z;
      w._fx = _f.x; w._fy = _f.y; w._fz = _f.z; w._lx = _l.x; w._ly = _l.y; w._lz = _l.z; w._nx = _nG.x; w._ny = _nG.y; w._nz = _nG.z;
    }
    // anti-roll bars (couple left / right compression)
    for (const [a, b, k] of [[W[0], W[1], CAR.arbF], [W[2], W[3], CAR.arbR]]) { const f = k * (a.c - b.c); if (a.contact) a.fz = Math.max(0, a.fz + f); if (b.contact) b.fz = Math.max(0, b.fz - f); }

    // ---------------------------------------------------------------- tyre pass
    let wheelSpinKick = 0;
    for (const w of W) {
      _rel.set(w._relx, w._rely, w._relz); _hp.set(w._hx, w._hy, w._hz); _f.set(w._fx, w._fy, w._fz); _l.set(w._lx, w._ly, w._lz); _nG.set(w._nx, w._ny, w._nz);
      const rear = !w.front, Iw = rear ? IwR : CAR.Iw + (IwR - CAR.Iw) * CAR.fd;
      let drive = wheelTq * 0.5 * (rear ? 1 - CAR.fd : CAR.fd);
      let bT = brk * (w.front ? CAR.brakeF : CAR.brakeR) * (w.front ? 1 : 1);
      if (rear) bT += input.handbrake * CAR.handbrake * (0.18 + 0.82 * smooth(speed, 6, 22));      // the handbrake only really locks the rears at speed
      if (hold) bT = Math.max(bT, 1700);
      if (!w.contact) {
        // airborne: free-spinning wheel
        let om = w.omega + (drive / Iw) * dt; const bd = bT / Iw * dt; om = Math.abs(om) <= bd ? 0 : om - Math.sign(om) * bd; w.omega = om * (1 - 0.02 * dt * 60 * 0.05);
        w.slip = 0; w.fx = w.fy = 0; w.vx = w.vy = 0; continue;
      }
      // contact patch kinematics
      _pc.copy(_hp).addScaledVector(_up, -(w.d + R) / Math.max(_up.y, 0.35) * 1.0).sub(_pos);
      _vc.copy(_ang).cross(_pc).add(_vel);
      const vx = _vc.dot(_f), vy = _vc.dot(_l), vd = Math.max(Math.abs(vx), 1.5);
      const kappa = sat((w.omega * R - vx) / vd, -5, 5), sigma = sat(vy / vd, -6, 6);
      w.sy += (sigma - w.sy) * Math.min(1, Math.max(Math.abs(vx), Math.abs(vy), 1.0) * dt / 0.22);
      const mu = w.muS * (1 + 0.45 * (1 - smooth(speed, 3, 17)));      // planted at low speed, progressively looser as speed rises
      // ABS (front only; rear is left to lock for handbrake turns)
      if (this.abs && w.front && brk > 0.05 && kappa < -0.12) bT *= sat(1 + (kappa + 0.12) * 7, 0.15, 1);
      const t0 = tire(w, w.fz, mu, kappa, w.sy); let fx = t0.fx, fy = t0.fy; const s0 = t0.s;
      const dOm = 2, kap1 = sat(((w.omega + dOm) * R - vx) / vd, -5, 5), t1 = tire(w, w.fz, mu, kap1, w.sy); const Kp = Math.max(0, (t1.fx - fx) / dOm);
      fx -= 0.012 * w.fz * Math.tanh(vx * 2);
      const fyMax = 300 * Math.abs(vy) / dt; if (Math.abs(fy) > fyMax) fy = Math.sign(fy) * fyMax;
      // wheel angular velocity: semi-implicit w.r.t. the (positive) tyre slope so it stays stable at 120 Hz; the force handed to the chassis is the
      // end-of-step force (fx + K * d(omega)) so the wheel does not act as a numerical brake while the car accelerates
      let om = w.omega + dt * (drive - R * fx) / Iw / (1 + dt * R * Kp / Iw);
      const bd = bT / Iw * dt; if (bd > 0) { if (Math.abs(om) <= bd) om = 0; else om -= Math.sign(om) * bd; }
      fx += Kp * (om - w.omega);
      w.omega = om;
      w.slip = s0; w.slipV = Math.hypot(vx - w.omega * R, vy); w.slipX = kappa; w.slipY = w.sy; w.vx = vx; w.vy = vy; w.fx = fx; w.fy = fy;
      // forces on the chassis
      _ft.set(0, 0, 0).addScaledVector(_f, fx).addScaledVector(_l, fy);
      _ap.copy(_pc).addScaledVector(_nG, 0.15 + (w.d + R) * 0.0); w.pcx = _pos.x + _pc.x; w.pcy = _pos.y + _pc.y; w.pcz = _pos.z + _pc.z;
      _F.add(_ft); _T.add(_t.copy(_ap).cross(_ft));
    }
    // rear differential (strongly locked): shares speed between the two driven wheels, limited by the lock torque
    {
      const dw = rl.omega - rr.omega, maxT = 1900 / (CAR.Iw) * dt, tr2 = sat(dw * 0.5 * 0.42, -maxT, maxT); rl.omega -= tr2; rr.omega += tr2;
    }
    // suspension forces on the chassis
    for (const w of W) {
      if (!w.contact || w.fz <= 0) continue;
      _rel.set(w._relx, w._rely, w._relz); _fs.copy(_up).multiplyScalar(w.fz);
      _F.add(_fs); _T.add(_t.copy(_rel).cross(_fs));
    }
    // drift-assist stability torque (scaled by the assist level): once a slide has developed, damp yaw that would deepen it past the target angle.
    // The target slide angle grows when the player steers into the slide and shrinks when they steer out of it.
    this.assistTq = 0;
    if (this.steerAssist > 0 && speed > 5 && grounded >= 2 && vLong > 0.5) {
      const sg = Math.sign(beta), bAbs = Math.abs(beta), into = -sg * input.steer;
      const bDes = sat(0.46 + 0.14 * into, 0.3, 0.62), act = smooth(bAbs, 0.1, 0.3), growth = -sg * _ang.y;
      const tq = this.steerAssist * act * (14000 * Math.max(0, bAbs - bDes) + 2600 * Math.max(0, growth));
      this.assistTq = sg * tq; _T.y += sg * tq;
    }
    // yaw-rate limiter: a drift flick the other way used to whip the car round at 3+ rad/s (a full pirouette). Past a speed-dependent ceiling the excess yaw is damped.
    if (this.steerAssist > 0 && speed > 6 && grounded >= 2) {
      const yl = 1.35 + 5.5 / Math.max(speed, 6), ey = Math.abs(_ang.y) - yl;
      if (ey > 0) _T.y -= Math.sign(_ang.y) * this.steerAssist * CAR.inertia.y * 7 * ey;
    }
    // velocity-steering assist: steering input directly bends the car's direction of TRAVEL (a lateral pull perpendicular to the velocity), strongest while
    // sliding when the front tyres are saturated and the wheels alone cannot change where the car is going. Scaled by the assist level.
    this.pullAy = 0;
    if (this.steerAssist > 0 && speed > 4 && grounded >= 2 && Math.abs(input.steer) > 0.01) {
      const slide = smooth(Math.abs(beta), 0.08, 0.5), ay = input.steer * (4.5 + 7.5 * slide) * this.steerAssist * smooth(speed, 4, 12);
      this.pullAy = ay; _F.x += (_vel.z / speed) * ay * CAR.mass; _F.z += (-_vel.x / speed) * ay * CAR.mass;
    }
    // aero
    { const v = _vel.length(); _F.addScaledVector(_vel, -0.5 * 1.2 * CAR.cdA * v); _F.addScaledVector(_up, -0.5 * 1.2 * CAR.clA * v * v); }
    // belly / roof scrape springs (keep the body above ground)
    this.scrape = 0;
    for (const p of this.bumpPts) {
      _bp.copy(p).applyQuaternion(_q); const wy = _pos.y + _bp.y, wx = _pos.x + _bp.x, wz = _pos.z + _bp.z, gy = ground.y(wx, wz);
      const pen = gy + 0.02 - wy; if (pen <= 0) continue;
      _bv.copy(_ang).cross(_bp).add(_vel); const vn = _bv.y;
      let fn = Math.max(0, 260000 * pen - 6500 * vn); fn = Math.min(fn, 90000); this.scrape = Math.max(this.scrape, fn * Math.hypot(_bv.x, _bv.z));
      _fs.set(-_bv.x, 0, -_bv.z); const sl = _fs.length(); if (sl > 1e-3) _fs.multiplyScalar(Math.min(0.5 * fn, 600 * sl) / sl);
      _fs.y += fn; _F.add(_fs); _T.add(_t.copy(_bp).cross(_fs));
    }

    // ---------------------------------------------------------------- integrate with Rapier
    const m = CAR.mass;
    const ex = _vel.x + _F.x / m * dt, ey = _vel.y + (_F.y / m - G) * dt, ez = _vel.z + _F.z / m * dt;
    body.applyImpulse({ x: _F.x * dt, y: _F.y * dt, z: _F.z * dt }, true);
    body.applyTorqueImpulse({ x: _T.x * dt, y: _T.y * dt, z: _T.z * dt }, true);
    this.world.step();
    const p2 = body.translation(), q2 = body.rotation(), v2 = body.linvel();
    const dvx = v2.x - ex, dvy = v2.y - ey, dvz = v2.z - ez, dv = Math.hypot(dvx, dvy, dvz);
    if (dv > this.impact) this.impact = dv;
    this.pos.set(p2.x, p2.y, p2.z); this.quat.set(q2.x, q2.y, q2.z, q2.w); this.vel.set(v2.x, v2.y, v2.z);
    this.up.set(0, 1, 0).applyQuaternion(this.quat); this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.grounded = grounded; this.airT = grounded === 0 ? this.airT + dt : 0;
    this.flipT = this.up.y < 0.25 ? this.flipT + dt : 0;
    // telemetry
    const t = this.t; t.speed = speed; t.kmh = speed * 3.6; t.vLong = vLong; t.vLat = vLat; t.beta = beta; t.yawRate = av.y;
    t.gLat = (vLat - (this._lastLat ?? vLat)) / dt / G * -1; this._lastLat = vLat;   // rough, only used for HUD / camera
    t.gear = this.gear; t.rpm = this.rpm; t.wheelRpm = rpmW;
    for (const w of W) w.spin += w.omega * dt;
  }

  /** interpolated render transform */
  transform(alpha, outPos, outQuat) { outPos.lerpVectors(this.prevPos, this.pos, alpha); outQuat.slerpQuaternions(this.prevQuat, this.quat, alpha); }
}
