// Drift camera: chase cam that swings towards the direction of travel (so you see the slide), speed FOV, impact shake, hood + cockpit views.
import * as THREE from 'three';
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
const smooth = (x, a, b) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const CAM_NAMES = ['CHASE', 'FAR', 'HOOD', 'COCKPIT'];

export function createCarCamera(camera) {
  let mode = 0, yaw = 0, init = false, shake = 0, t = 0, fov = 62, dist = 6.4, hgt = 1.9;
  const tgt = new THREE.Vector3(), p = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  const prevPos = new THREE.Vector3();
  return {
    get mode() { return mode; }, set mode(m) { mode = m % CAM_NAMES.length; init = false; },
    cycle() { this.mode = mode + 1; },
    impact(a) { shake = Math.min(1.2, shake + a * 0.08); },
    reset() { init = false; },
    update(dt, pos, quat, vel, speed, slipAngle, ground, occlude) {
      t += dt; shake *= Math.exp(-dt * 4);
      const fwd = tmp.set(0, 0, 1).applyQuaternion(quat), carYaw = Math.atan2(fwd.x, fwd.z);
      const velYaw = speed > 4 ? Math.atan2(vel.x, vel.z) : carYaw;
      if (!init) { yaw = carYaw; init = true; }
      const wantFov = (mode === 0 || mode === 1 ? 62 : 74) + 16 * smooth(speed, 12, 62);
      fov += (wantFov - fov) * (1 - Math.exp(-dt * 3)); if (Math.abs(camera.fov - fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix(); }
      if (mode <= 1) {
        const k = mode === 0 ? 1 : 1.5, back = (6.3 + 0.012 * speed) * k, up = (1.75 + 0.008 * speed) * k;
        const follow = smooth(speed, 3, 14) * 0.78;                       // how far the camera yaw leans towards the velocity direction
        const target = lerpAngle(carYaw, velYaw, follow);
        yaw = lerpAngle(yaw, target, 1 - Math.exp(-dt * (speed > 4 ? 3.2 : 2.0)));
        tgt.copy(pos).y += 0.55;
        p.set(tgt.x - Math.sin(yaw) * back, tgt.y + up, tgt.z - Math.cos(yaw) * back);
        const gy = ground.y(p.x, p.z) + 0.55; if (p.y < gy) p.y = gy;
        if (occlude) { const f = occlude(tgt, p); if (f < 1) p.lerpVectors(tgt, p, Math.max(0.12, f - 0.06)); }       // never let the camera sit inside a wall
        look.set(tgt.x + Math.sin(yaw) * 5.0, tgt.y + 0.35, tgt.z + Math.cos(yaw) * 5.0);
        // light low-pass so curb hits and bumps do not jerk the view
        camera.position.copy(p); camera.lookAt(look);
      } else {
        const off = mode === 2 ? tmp.set(0, 0.88, 0.62) : tmp.set(0.36, 0.70, 0.18);   // relative to the COM (hood centre / driver seat)
        off.applyQuaternion(quat); p.copy(pos).add(off);
        const dir = look.set(0, 0, 1).applyQuaternion(quat); dir.y = Math.max(-0.2, Math.min(0.2, dir.y));
        // look a little into the corner / slide
        const lead = Math.max(-0.5, Math.min(0.5, slipAngle * 0.5));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), lead); dir.applyQuaternion(q);
        camera.position.copy(p); camera.lookAt(p.x + dir.x * 10, p.y + dir.y * 10, p.z + dir.z * 10);
      }
      if (shake > 0.01) {
        const s = shake * 0.12; camera.position.x += Math.sin(t * 61) * s; camera.position.y += Math.sin(t * 73 + 1.3) * s; camera.position.z += Math.cos(t * 57) * s;
        camera.rotateZ(Math.sin(t * 47) * shake * 0.02);
      }
    },
  };
}
