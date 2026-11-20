// Keyboard -> analogue car controls (pedal ramps, speed-aware steering ramps). Returns an object whose handlers main/car.js can hook.
//   W/Up throttle · S/Down brake / reverse · A/D or Left/Right steer · Space handbrake · Shift clutch-kick · E/Q gear up/down (manual)
//   M manual/auto · G steering assist · V ABS · C camera · R respawn · L headlights · P paint · F2 audio mute
const PREVENT = new Set(['Tab', 'F2', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
export function createInput(on = {}) {
  const down = new Set();
  const typing = e => !!e.target?.closest?.('input,textarea,[contenteditable]');
  const kd = e => {
    if (typing(e)) return;
    if (e.repeat) { if (PREVENT.has(e.code)) e.preventDefault(); return; }
    if (PREVENT.has(e.code)) e.preventDefault();
    down.add(e.code); on.key?.(e.code, e);
  };
  const ku = e => { down.delete(e.code); };
  addEventListener('keydown', kd); addEventListener('keyup', ku, true); addEventListener('blur', () => down.clear());
  const any = (...c) => c.some(k => down.has(k));
  let steer = 0;
  return {
    down,
    /** advance the smoothed controls and write them into vehicle.input */
    update(dt, v, active, locked = false) {
      const i = v.input;
      if (!active) { i.throttle = i.brake = i.handbrake = 0; i.steer *= 0.9; return; }
      if (locked) { const rolling = v.t.speed > 2.5; i.throttle = 0; i.brake = rolling ? 0.45 : 0; i.handbrake = rolling ? 0 : 1; i.steer *= 0.9; steer = 0; return; }      // a UI (the map) is open: the car brakes to a stop and stays parked (brake at standstill would select reverse)
      const thT = any('KeyW', 'ArrowUp') ? 1 : 0, brT = any('KeyS', 'ArrowDown') ? 1 : 0, hb = down.has('Space') ? 1 : 0;
      const stT = (any('KeyA', 'ArrowLeft') ? 1 : 0) - (any('KeyD', 'ArrowRight') ? 1 : 0);   // + = left
      const ramp = (cur, tgt, up, dn) => cur + Math.max(-dn * dt, Math.min(up * dt, tgt - cur));
      i.throttle = ramp(i.throttle, thT, 6.0, 10);
      i.brake = ramp(i.brake, brT, 7.0, 12);
      i.handbrake = ramp(i.handbrake, hb, 14, 8);
      // steering: slow to build, fast to centre, very fast to reverse (counter-steer)
      const sp = v.t.speed;
      let rate = stT === 0 ? 5.5 : Math.sign(stT) !== Math.sign(steer) && steer !== 0 ? 9 : 4.8 - 1.4 * Math.min(sp / 40, 1);
      steer += Math.max(-rate * dt, Math.min(rate * dt, stT - steer));
      i.steer = steer;
    },
    reset() { steer = 0; },
  };
}
