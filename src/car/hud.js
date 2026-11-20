// Driving HUD (speed / gear / rpm / drift telemetry) + drift scoring (angle x speed x combo, wall-proximity and transition bonuses).
const CSS = `
#drv{position:fixed;inset:0;pointer-events:none;font:600 13px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#e8ecff;text-shadow:0 1px 6px rgba(0,0,0,.7);z-index:5}
#drv .gauge{position:absolute;right:26px;bottom:22px;text-align:right}
#drv .kmh{font-size:64px;font-weight:800;letter-spacing:-.02em;line-height:1;color:#fff}
#drv .kmh small{font-size:15px;font-weight:600;opacity:.7;margin-left:6px}
#drv .gear{display:inline-block;min-width:34px;text-align:center;margin-right:10px;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.14);font-size:24px;font-weight:800}
#drv .rpmbar{margin-top:8px;display:flex;gap:2px;justify-content:flex-end}
#drv .rpmbar i{display:block;width:9px;height:14px;border-radius:2px;background:rgba(255,255,255,.14)}
#drv .rpmbar i.on{background:rgba(255,255,255,.6)}#drv .rpmbar i.on.hi{background:rgba(255,255,255,.85)}#drv .rpmbar i.on.red{background:#fff;box-shadow:0 0 8px rgba(255,255,255,.8)}
#drv .flags{margin-top:8px;display:flex;gap:6px;justify-content:flex-end}
#drv .flags b{padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.1);opacity:.4;font-size:11px;letter-spacing:.08em}
#drv .flags b.on{opacity:1;background:#fff;color:#000}
#drv .score{position:absolute;left:50%;top:22px;transform:translateX(-50%);text-align:center;min-width:300px}
#drv .score .pts{font-size:46px;font-weight:800;line-height:1;transition:transform .08s}
#drv .score .mult{font-size:18px;color:#fff;opacity:.7}
#drv .score .ang{font-size:13px;opacity:.85;margin-top:2px}
#drv .score .msg{height:18px;margin-top:4px;font-size:15px;color:#fff;letter-spacing:.1em}
#drv .score.idle .pts,#drv .score.idle .mult,#drv .score.idle .ang{opacity:.25}
#drv .total{position:absolute;left:22px;top:20px;text-align:left;opacity:.9}
#drv .total div{font-size:12px;opacity:.7}#drv .total b{font-size:22px}
#drv .help{position:absolute;left:22px;bottom:18px;opacity:.65;font-size:11px;line-height:1.6;max-width:430px}
#drv .help kbd{padding:0 5px;border-radius:4px;background:rgba(255,255,255,.18);font:inherit}
#drv .toast{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font-size:34px;font-weight:800;letter-spacing:.12em;opacity:0;transition:opacity .35s}
#drv .toast.on{opacity:1}
`;
const SEG = 24;

export function createHud() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'drv';
  root.innerHTML = `
    <div class="total"><div>TOTAL</div><b id="d_total">0</b> <div style="margin-top:6px">BEST CHAIN</div><b id="d_best">0</b></div>
    <div class="score idle" id="d_score"><div class="pts" id="d_pts">0</div><div class="mult" id="d_mult">x1</div><div class="ang" id="d_ang">&nbsp;</div><div class="msg" id="d_msg">&nbsp;</div></div>
    <div class="gauge"><div><span class="gear" id="d_gear">N</span><span class="kmh" id="d_kmh">0</span><small>km/h</small></div>
      <div class="rpmbar" id="d_rpm">${'<i></i>'.repeat(SEG)}</div>
      <div class="flags"><b id="f_asst">ASSIST</b><b id="f_abs">ABS</b><b id="f_auto">AUTO</b><b id="f_hb">E-BRAKE</b><b id="f_cam">CHASE</b></div></div>
    <div class="help"><kbd>W</kbd><kbd>S</kbd> gas / brake·reverse &nbsp; <kbd>A</kbd><kbd>D</kbd> steer &nbsp; <kbd>Space</kbd> handbrake &nbsp; <kbd>Shift</kbd> clutch-kick<br>
      <kbd>E</kbd><kbd>Q</kbd> gear (manual) &nbsp; <kbd>M</kbd> auto/manual &nbsp; <kbd>G</kbd> assist &nbsp; <kbd>C</kbd> camera &nbsp; <kbd>R</kbd> respawn &nbsp; <kbd>P</kbd> paint &nbsp; <kbd>F</kbd> map / search / GPS &nbsp; <kbd>X</kbd> cancel route &nbsp; <kbd>J</kbd> quick teleport &nbsp; <kbd>L</kbd> lights &nbsp; <kbd>F2</kbd> sound &nbsp; <kbd>Tab</kbd> free camera<br><span style="opacity:.8">Gamepad: left stick steer · <kbd>RT</kbd>/<kbd>LT</kbd> gas/brake · <kbd>A</kbd> handbrake · <kbd>X</kbd> clutch-kick · <kbd>LB</kbd>/<kbd>RB</kbd> gears · <kbd>Y</kbd> camera · <kbd>B</kbd> respawn · <kbd>Start</kbd> map</span></div>
    <div class="toast" id="d_toast"></div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);
  const el = { total: $('d_total'), best: $('d_best'), score: $('d_score'), pts: $('d_pts'), mult: $('d_mult'), ang: $('d_ang'), msg: $('d_msg'), gear: $('d_gear'), kmh: $('d_kmh'), rpm: [...$('d_rpm').children], asst: $('f_asst'), abs: $('f_abs'), auto: $('f_auto'), hb: $('f_hb'), cam: $('f_cam'), toast: $('d_toast') };
  let toastT = 0, msgT = 0;

  // ---------------------------------------------------------------- drift score
  const sc = { total: 0, best: 0, chain: 0, chainT: 0, mult: 1, lost: 0, active: false, lastSign: 0, signT: 9, wallT: 0, bank: 0 };
  function msg(t, d = 1.4) { el.msg.textContent = t; msgT = d; }
  return {
    root, score: sc,
    show(v) { root.style.display = v ? '' : 'none'; },
    toast(t, d = 1.2) { el.toast.textContent = t; el.toast.classList.add('on'); toastT = d; },
    /** s: telemetry from the vehicle + extras { wallDist, crashed, onGround } */
    update(dt, s) {
      const deg = Math.abs(s.beta) * 57.2958, kmh = s.kmh;
      const drifting = s.speed > 7 && deg > 11 && deg < 115 && s.grounded >= 2 && s.vLong > 0 && (s.slipR > 0.95 || deg > 18);
      if (s.crashed) { if (sc.chain > 0) msg('CRASH  -' + Math.round(sc.chain), 1.6); sc.chain = 0; sc.chainT = 0; sc.mult = 1; sc.active = false; sc.lost = 0; }
      if (drifting) {
        sc.active = true; sc.lost = 0; sc.chainT += dt; sc.mult = Math.min(8, 1 + Math.floor(sc.chainT / 2.2));
        const sign = Math.sign(s.beta); if (sc.lastSign !== 0 && sign !== sc.lastSign && sc.signT < 1.6) { sc.chain += 150 * sc.mult; msg('TRANSITION  +' + 150 * sc.mult); } if (sign !== sc.lastSign) sc.signT = 0; sc.lastSign = sign;
        const near = s.wallDist < 1.7; if (near) sc.wallT += dt; else sc.wallT = Math.max(0, sc.wallT - dt * 2);
        const wall = sc.wallT > 0.25 ? 1.6 : 1;
        if (wall > 1) msg('NEAR WALL  x1.6', 0.3);
        sc.chain += kmh * 0.5 * (Math.min(70, deg) / 30) * sc.mult * wall * dt * 1.2;
      } else if (sc.active) {
        sc.lost += dt; if (sc.lost > 1.0) { const b = Math.round(sc.chain); if (b > 0) { sc.total += b; if (b > sc.best) sc.best = b; msg('BANKED  +' + b, 2.2); } sc.chain = 0; sc.chainT = 0; sc.mult = 1; sc.active = false; sc.lastSign = 0; }
      }
      sc.signT += dt;
      // ---- DOM
      el.total.textContent = Math.round(sc.total).toLocaleString(); el.best.textContent = Math.round(sc.best).toLocaleString();
      el.score.classList.toggle('idle', !sc.active && sc.chain < 1);
      el.pts.textContent = Math.round(sc.chain).toLocaleString(); el.mult.textContent = 'x' + sc.mult;
      el.ang.textContent = drifting || sc.active ? `${deg.toFixed(0)}°  ${kmh.toFixed(0)} km/h` : ' ';
      if (msgT > 0 && (msgT -= dt) <= 0) el.msg.innerHTML = '&nbsp;';
      if (toastT > 0 && (toastT -= dt) <= 0) el.toast.classList.remove('on');
      el.kmh.textContent = Math.round(kmh);
      el.gear.textContent = s.gear === -1 ? 'R' : s.gear === 0 ? 'N' : s.gear;
      const f = Math.min(1, s.rpm / 7600), on = Math.round(f * SEG);
      el.rpm.forEach((e, i) => { const lit = i < on; e.className = lit ? 'on' + (i > SEG * 0.8 ? ' red' : i > SEG * 0.62 ? ' hi' : '') : ''; });
      el.asst.classList.toggle('on', s.assist > 0); el.abs.classList.toggle('on', s.abs); el.auto.classList.toggle('on', s.auto); el.auto.textContent = s.auto ? 'AUTO' : 'MANUAL'; el.hb.classList.toggle('on', s.handbrake > 0.3); el.cam.textContent = s.cam; el.cam.classList.add('on');
    },
    resetScore() { sc.chain = 0; sc.chainT = 0; sc.mult = 1; sc.active = false; sc.lost = 0; },
  };
}
