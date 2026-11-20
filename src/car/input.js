// Keyboard -> analogue car controls (pedal ramps, speed-aware steering ramps). Returns an object whose handlers main/car.js can hook.
//   W/Up throttle · S/Down brake / reverse · A/D or Left/Right steer · Space handbrake · Shift clutch-kick · E/Q gear up/down (manual)
//   M manual/auto · G steering assist · V ABS · C camera · R respawn · L headlights · P paint · F2 audio mute
// Gamepad / joystick (Gamepad API, any browser): left stick steer, RT gas, LT brake/reverse, A handbrake, X clutch-kick, LB/RB gears, Y camera, B respawn (closes the map),
//   D-pad up/down/left/right = M / G / L / P, Start = map, Back = free camera, L3 = cancel route, R3 = quick teleport. Non-standard sticks: X axis steers, Y axis gas/brake, buttons 0-3 = handbrake / kick / camera / respawn.
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

  // ---------------------------------------------------------------- gamepad
  const pad = { connected: false, name: '', lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, brake: 0, throttle: 0, steer: 0, handbrake: 0, used: 0 };
  const prevBtn = [];
  const BTN = { 1: 'KeyR', 2: 'ShiftLeft', 3: 'KeyC', 4: 'KeyQ', 5: 'KeyE', 8: 'Tab', 9: 'KeyF', 10: 'KeyX', 11: 'KeyJ', 12: 'KeyM', 13: 'KeyG', 14: 'KeyL', 15: 'KeyP' };
  const fire = code => { const o = { code, key: code, bubbles: true }; window.dispatchEvent(new KeyboardEvent('keydown', o)); window.dispatchEvent(new KeyboardEvent('keyup', o)); };
  const dz = (v, d = 0.13) => { const a = Math.abs(v); return a < d ? 0 : Math.sign(v) * (a - d) / (1 - d); };
  const trig = b => (b ? (b.value ?? (b.pressed ? 1 : 0)) : 0);
  addEventListener('gamepadconnected', e => { on.pad?.(e.gamepad.id, true); });
  addEventListener('gamepaddisconnected', () => { pad.connected = false; on.pad?.('', false); });
  function pollPad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : []; let g = null;
    for (const c of list) if (c && c.connected && c.axes.length >= 2) { g = c; break; }
    if (!g) { pad.connected = false; pad.throttle = pad.brake = pad.steer = pad.handbrake = 0; return; }
    if (!pad.connected) { pad.connected = true; pad.name = g.id; }
    const std = g.mapping === 'standard', b = g.buttons, bt = i => !!(b[i] && b[i].pressed);
    let lx, ly, thr, brk, hb;
    if (std) {
      lx = dz(g.axes[0]); ly = dz(g.axes[1]); pad.rx = dz(g.axes[2] ?? 0); pad.ry = dz(g.axes[3] ?? 0);
      pad.lt = trig(b[6]); pad.rt = trig(b[7]);
      thr = pad.rt; brk = pad.lt; hb = bt(0) ? 1 : 0;
    } else {                                                           // generic joystick / wheel: X steers, pushing the stick forward = gas, pulling back = brake
      lx = dz(g.axes[0], 0.08); ly = dz(g.axes[1], 0.08); pad.rx = dz(g.axes[2] ?? 0); pad.ry = dz(g.axes[3] ?? 0);
      thr = Math.max(0, -ly) + trig(b[7]); brk = Math.max(0, ly) + trig(b[6]); hb = bt(0) ? 1 : 0; pad.lt = brk; pad.rt = thr;
    }
    pad.lx = lx; pad.ly = ly;
    // steering curve: a little expo for fine control around the centre
    pad.steer = -Math.sign(lx) * Math.pow(Math.abs(lx), 1.25);          // + = left (same sign convention as the keyboard)
    pad.throttle = Math.min(1, thr); pad.brake = Math.min(1, brk); pad.handbrake = hb;
    const anyIn = Math.abs(lx) > 0.05 || thr > 0.05 || brk > 0.05 || hb;
    pad.used = anyIn ? 1 : pad.used * 0.995;
    // edge-triggered buttons -> synthetic key presses, so every keyboard feature (and the map / navigator) works from the pad
    for (let k = 0; k < b.length; k++) {
      const now = bt(k), was = prevBtn[k] || false; prevBtn[k] = now;
      if (!now || was) continue;
      if (!std) { const gen = ['', 'ShiftLeft', 'KeyC', 'KeyR', 'KeyQ', 'KeyE', '', '', 'Tab', 'KeyF'][k]; if (gen) fire(gen); continue; }
      let code = BTN[k]; if (!code) continue;
      if (k === 1 && on.uiOpen?.()) code = 'Escape';
      fire(code);
    }
  }
  function rumble(strong, weak) {
    const g = pad.connected && navigator.getGamepads ? [...navigator.getGamepads()].find(c => c && c.connected) : null; const a = g?.vibrationActuator; if (!a) return;
    const now = performance.now(); if (now - (rumble.t || 0) < 70) return; rumble.t = now;
    try { a.playEffect('dual-rumble', { startDelay: 0, duration: 90, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch { /* unsupported */ }
  }
  return {
    down, pad, rumble, pollPad,
    /** advance the smoothed controls and write them into vehicle.input */
    update(dt, v, active, locked = false) {
      pollPad();
      const i = v.input;
      if (!active) { i.throttle = i.brake = i.handbrake = 0; i.steer *= 0.9; return; }
      if (locked) { const rolling = v.t.speed > 2.5; i.throttle = 0; i.brake = rolling ? 0.45 : 0; i.handbrake = rolling ? 0 : 1; i.steer *= 0.9; steer = 0; return; }      // a UI (the map) is open: the car brakes to a stop and stays parked (brake at standstill would select reverse)
      const kbSteer = (any('KeyA', 'ArrowLeft') ? 1 : 0) - (any('KeyD', 'ArrowRight') ? 1 : 0);   // + = left
      const thT = Math.max(any('KeyW', 'ArrowUp') ? 1 : 0, pad.throttle), brT = Math.max(any('KeyS', 'ArrowDown') ? 1 : 0, pad.brake), hb = Math.max(down.has('Space') ? 1 : 0, pad.handbrake);
      const stT = kbSteer !== 0 ? kbSteer : pad.steer;
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
