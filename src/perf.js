// Adaptive quality governor. Goals, in order: keep the frame rate playable on unknown hardware, spend as little *visible* quality as possible
// doing it, and give the quality back when there is headroom again.
//
// Differences to the first version (which was one-way in practice):
//   * it asks WHAT is slow. `cpuMs` (JS time spent submitting the frame) close to the frame time = CPU / draw-call bound (old Xeons, laptops):
//     lowering the resolution would change nothing there, so those machines get cheaper shadows / LOD first. Otherwise it is GPU bound and the
//     render resolution goes first (in small steps), then the expensive effects.
//   * hitches caused by streaming (teleport, first load) are ignored: they used to push quality down for good.
//   * it climbs back up (probing, with exponential back-off after a failed probe). The old "fast" test (< 15.5 ms) can never be true on a 60 Hz
//     display, so on every non-144 Hz monitor one slow second meant a permanently degraded game - the likely reason Ultra looked poor.
//   * the level it settled on is remembered per preset, so the next start does not have to re-learn it (and does not show the first-minute drop).
// Everything it changes is listed in `status` (shown next to the fps counter) so the player can see that quality was reduced and why.
const KEY = q => 'yd.gov2.' + q;      // v2: v1 remembered up to 8 steps forever; a bad session (e.g. a stutter) then degraded every later start

export function createGovernor({ renderer, composer, quality, bloom, fxPass, moon, probe = null, getBasePR, busy = () => false }) {
  const params = new URLSearchParams(location.search);
  // opt-in only: ?gov=1 or Settings > Auto quality. Fixed quality is the default - the player chose it.
  let optIn = params.get('gov') === '1'; try { if (params.get('gov') === null) optIn = localStorage.getItem('yd.gov') === '1'; } catch { /* ignore */ }
  const enabled = optIn;
  const baseLod = quality.lodScale, baseShadowEvery = quality.shadowEvery, baseShadow = quality.shadows;
  let basePR = getBasePR();
  const setPR = k => { const pr = Math.max(0.5, basePR * k); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); };

  // each step is independent and idempotent; `kind` says what it relieves
  const S = {
    res85: { kind: 'gpu', label: 'res 85%', on: s => { s.pr = Math.min(s.pr, 0.85); } },
    res72: { kind: 'gpu', label: 'res 72%', on: s => { s.pr = Math.min(s.pr, 0.72); s.lod = Math.min(s.lod, 0.9); } },
    res60: { kind: 'gpu', label: 'res 60%', on: s => { s.pr = Math.min(s.pr, 0.6); s.lod = Math.min(s.lod, 0.75); } },
    noRT:  { kind: 'both', label: 'no ray tracing', on: s => { s.degrade = Math.max(s.degrade, 1); } },
    noAO:  { kind: 'gpu', label: 'no AO', on: s => { s.degrade = Math.max(s.degrade, 2); } },
    shd2:  { kind: 'cpu', label: 'shadows every 2nd frame', on: s => { s.shadowEvery = Math.max(s.shadowEvery, 2); } },
    shd3:  { kind: 'cpu', label: 'shadows every 3rd frame', on: s => { s.shadowEvery = Math.max(s.shadowEvery, 3); } },
    lod85: { kind: 'cpu', label: 'shorter draw distance', on: s => { s.lod = Math.min(s.lod, 0.85); } },
    lod70: { kind: 'cpu', label: 'short draw distance', on: s => { s.lod = Math.min(s.lod, 0.7); } },
    noBloom: { kind: 'gpu', label: 'no bloom', on: s => { s.bloom = false; } },
    noSSR: { kind: 'gpu', label: 'no reflections', on: s => { s.degrade = Math.max(s.degrade, 3); } },
    noShadow: { kind: 'both', label: 'no shadows', on: s => { s.shadow = false; } },
    probe2: { kind: 'cpu', label: 'slower reflection probe', on: s => { s.probe = Math.max(s.probe, 1); } },
    noProbe: { kind: 'cpu', label: 'static reflections', on: s => { s.probe = 2; } },
  };
  const GPU_ORDER = ['res85', 'noRT', 'res72', 'noAO', 'probe2', 'shd2', 'noBloom', 'res60', 'noSSR', 'noProbe', 'noShadow', 'lod70'];
  const CPU_ORDER = ['probe2', 'shd2', 'lod85', 'noRT', 'noProbe', 'shd3', 'noShadow', 'lod70', 'noBloom', 'res85', 'res72', 'noAO', 'res60', 'noSSR'];
  let applied = [];
  // restore what the last sessions needed, but only the first few steps and only if recent: a one-off stutter must not stick forever
  try { const sv = JSON.parse(localStorage.getItem(KEY(quality.level)) ?? 'null'); if (sv && Array.isArray(sv.v) && Date.now() - sv.t < 3 * 864e5) applied = sv.v.filter(n => S[n]).slice(0, 3); } catch { /* ignore */ }
  const probeBase = probe ? { pace: probe.pace, minInterval: probe.minInterval, moveDist: probe.moveDist } : null;

  function recompute() {
    const s = { pr: 1, lod: baseLod, degrade: 0, shadowEvery: baseShadowEvery, bloom: quality.bloom, shadow: baseShadow, probe: 0 };
    for (const n of applied) S[n].on(s);
    s.lod = Math.min(s.lod, baseLod);
    return s;
  }
  let curPR = 1;
  function apply() {
    const s = recompute();
    if (Math.abs(s.pr - curPR) > 1e-3) { curPR = s.pr; setPR(s.pr); }
    quality.lodScale = s.lod; quality.shadowEvery = s.shadowEvery;
    if (fxPass) fxPass.degrade = s.degrade;
    if (!s.bloom && !bloomForced) { bloomForced = true; bloom.enabled = false; } else if (s.bloom && bloomForced) { bloomForced = false; bloom.enabled = quality.bloom; }
    if (moon.castShadow !== s.shadow) moon.castShadow = s.shadow;
    if (probe) { probe.enabled = s.probe < 2; if (s.probe === 1) Object.assign(probe, { pace: 4, minInterval: 8, moveDist: 80 }); else Object.assign(probe, probeBase); }
    status.text = applied.length ? applied.map(n => S[n].label).join(' · ') : '';
    try { localStorage.setItem(KEY(quality.level), JSON.stringify({ v: applied, t: Date.now() })); } catch { /* ignore */ }
  }
  // the bloom toggle in the menu / B key is the player's choice: the governor only forces it off while its step is active, then restores the preset value
  let bloomForced = false;
  const status = { text: '' };

  let ema = 16.7, cpu = 8, slow = 0, fast = 0, t = 0, upAfter = 20, lastUp = -1e9, calm = 0, lastStep = -1e9;
  const pick = () => {
    const cpuBound = cpu > ema * 0.8;
    const order = cpuBound ? CPU_ORDER : GPU_ORDER;
    return order.find(n => !applied.includes(n) && usable(n));
  };
  // steps that would change nothing on this preset are skipped
  const usable = n => !((n === 'noRT' || n === 'noAO' || n === 'noSSR') && !fxPass) && !((n === 'probe2' || n === 'noProbe') && !probe) && !(n === 'noBloom' && !quality.bloom) && !((n === 'shd2' || n === 'shd3' || n === 'noShadow') && !baseShadow);

  if (!enabled) applied = [];
  if (applied.length) apply();       // restore what was learned last session (before the first frame)
  return {
    get level() { return applied.length; },
    get status() { return status.text; },
    get enabled() { return enabled; },
    /** the render scale base changed (window resized, budget): re-apply on top of it */
    rebase(pr) { if (Math.abs(pr - basePR) < 1e-3) return; basePR = pr; curPR = -1; apply(); },
    /** frame submit time in ms (JS time between the start of the frame and the end of composer.render) */
    update(dt, cpuMs) {
      if (!enabled) return;
      t += dt; if (t < 5) return;                                          // ignore load / shader-compile hitches
      if (busy()) { slow = 0; fast = 0; return; }                          // streaming burst (teleport, first load): not the renderer's fault
      const ms = dt * 1000; ema += (ms - ema) * 0.05; cpu += (cpuMs - cpu) * 0.05;
      if (ema > 21) { slow += dt; fast = 0; calm = 0; } else if (ema < 18.2) { fast += dt; slow = 0; } else { slow = 0; fast = 0; }
      if (slow > 3 && t - lastStep > 8) {
        const n = pick();
        if (n) { applied.push(n); apply(); lastStep = t; if (t - lastUp < 30) upAfter = Math.min(upAfter * 2, 240); }       // the last probe up failed: wait longer before the next one
        slow = 0; ema = 16.7;
      } else if (fast > upAfter && applied.length && t - lastStep > 8) {
        applied.pop(); apply(); lastUp = t; lastStep = t; fast = 0; ema = 18;            // probe: give one step of quality back
      }
    },
  };
}
