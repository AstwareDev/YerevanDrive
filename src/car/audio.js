// Procedural car audio (no sample files): inline-6 engine from three pre-synthesised periodic loops cross-faded by rpm and pitched with playbackRate,
// turbo whistle + blow-off, exhaust pops / backfire, rev limiter, tyre squeal (asphalt) / scrub (grass), wind, road rumble, impacts and body scrapes.
export function createAudio() {
  let ctx = null, ready = false, muted = false, master, comp;
  const nodes = {};
  let lastThr = 0, lastGear = 1, popCool = 0, boostPrev = 0;

  function noiseBuffer(sec, seed = 1) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); let s = seed;
    for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    return b;
  }
  /** one second of periodic engine waveform. F = firing frequency (Hz, multiple of 3), bright = harmonic roll-off exponent, formants shape the exhaust note */
  function engineLoop(F, rolloff, drive, seed) {
    const sr = ctx.sampleRate, n = sr, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const H = [];
    for (let k = 1; k <= 56; k++) {
      const f = k * F; if (f > sr * 0.45) break;
      const formant = 1 + 2.2 * Math.exp(-Math.pow((f - 190) / 140, 2)) + 1.4 * Math.exp(-Math.pow((f - 520) / 260, 2)) + 0.8 * Math.exp(-Math.pow((f - 1250) / 500, 2));
      H.push({ f, a: formant / Math.pow(k, rolloff), ph: rnd() * 6.283 });
    }
    // engine-order content (1/3 of the firing frequency = crank rotation): cylinder to cylinder irregularity -> that "alive" roughness
    for (let o = 1; o <= 9; o++) if (o % 3) H.push({ f: o * F / 3, a: 0.16 / Math.pow(o, 0.7) * (0.6 + rnd() * 0.8), ph: rnd() * 6.283 });
    for (let i = 0; i < n; i++) {
      const t = i / sr; let v = 0;
      for (const h of H) v += h.a * Math.sin(6.2831853 * h.f * t + h.ph);
      d[i] = Math.tanh(v * drive);
    }
    // normalise
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i])); for (let i = 0; i < n; i++) d[i] /= mx;
    return b;
  }
  const loopSrc = (buf, loop = true) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; };
  const gainNode = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = gainNode(0.85); comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ctx.destination);
    // ---- engine
    const eng = gainNode(0.55); const engLP = filt('lowpass', 3000, 0.6); eng.connect(engLP); engLP.connect(master);
    nodes.engLP = engLP; nodes.eng = eng;
    nodes.layers = [[90, 1.15, 2.6, 11, 2000], [210, 1.0, 3.4, 23, 4200], [345, 0.9, 4.2, 37, 6900]].map(([F, ro, dr, seed, ref]) => {
      const g = gainNode(0), s = loopSrc(engineLoop(F, ro, dr, seed)); s.connect(g); g.connect(eng); s.start(); return { g, s, ref };
    });
    // intake / mechanical noise
    const inSrc = loopSrc(noiseBuffer(2, 5)), inBP = filt('bandpass', 700, 0.8), inG = gainNode(0); inSrc.connect(inBP); inBP.connect(inG); inG.connect(master); inSrc.start(); nodes.inBP = inBP; nodes.inG = inG;
    // ---- turbo whistle
    const tw = ctx.createOscillator(); tw.type = 'sine'; tw.frequency.value = 2000; const twG = gainNode(0); tw.connect(twG); twG.connect(master); tw.start(); nodes.tw = tw; nodes.twG = twG;
    const tw2 = ctx.createOscillator(); tw2.type = 'triangle'; tw2.frequency.value = 3000; tw2.connect(twG); tw2.start(); nodes.tw2 = tw2;
    // ---- tyres
    const mkSqueal = (f0, q, seed) => { const s = loopSrc(noiseBuffer(1.5, seed)), bp = filt('bandpass', f0, q), g = gainNode(0); s.connect(bp); bp.connect(g); g.connect(master); s.start(); return { bp, g }; };
    nodes.sqF = mkSqueal(1050, 7, 91); nodes.sqR = mkSqueal(800, 6, 93);
    const sc = loopSrc(noiseBuffer(1.5, 97)), scLP = filt('lowpass', 480, 0.7), scG = gainNode(0); sc.connect(scLP); scLP.connect(scG); scG.connect(master); sc.start(); nodes.scG = scG; nodes.scLP = scLP;
    // ---- wind + road
    const wSrc = loopSrc(noiseBuffer(2, 101)), wBP = filt('bandpass', 500, 0.5), wG = gainNode(0); wSrc.connect(wBP); wBP.connect(wG); wG.connect(master); wSrc.start(); nodes.wBP = wBP; nodes.wG = wG;
    const rSrc = loopSrc(noiseBuffer(2, 103)), rLP = filt('lowpass', 220, 0.7), rG = gainNode(0); rSrc.connect(rLP); rLP.connect(rG); rG.connect(master); rSrc.start(); nodes.rG = rG;
    // ---- scrape
    const sS = loopSrc(noiseBuffer(1.2, 107)), sHP = filt('highpass', 1200, 0.7), sG = gainNode(0); sS.connect(sHP); sHP.connect(sG); sG.connect(master); sS.start(); nodes.sG = sG;
    nodes.shot = noiseBuffer(0.6, 211);
    // ---- recorded-style engine layers (AI-generated SFX, loop-crossfaded in public/audio): add the real texture; the synthesized layers above keep the pitch exact
    const sg = gainNode(0.9); sg.connect(master); nodes.sampleBus = sg;
    nodes.samples = [['eng_idle', 1000, 650, 2300], ['eng_3k', 3000, 1700, 4300], ['eng_5k', 5000, 3500, 6300], ['eng_7k', 6800, 5400, 7700]].map(([name, center, lo, hi]) => ({ name, center, lo, hi, g: gainNode(0), src: null }));
    for (const L of nodes.samples) {
      fetch(`/audio/${L.name}.wav`).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { const s2 = loopSrc(buf); s2.connect(L.g); L.g.connect(sg); s2.start(0, Math.random() * buf.duration * 0.9); L.src = s2; nodes.samplesReady = nodes.samples.every(q => q.src); }).catch(e => console.warn('[audio] sample failed', L.name, e));
    }
    fetch('/audio/eng_overrun.wav').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { nodes.overrun = buf; }).catch(() => {});
    ready = true;
  }
  function shot({ f = 400, q = 1, type = 'bandpass', gain = 0.5, dur = 0.15, thump = 0 }) {
    const now = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = nodes.shot; s.playbackRate.value = 0.7 + Math.random() * 0.7;
    const bp = filt(type, f, q), g = gainNode(0); s.connect(bp); bp.connect(g); g.connect(master);
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.0008, now + dur); s.start(now, Math.random() * 0.3, dur + 0.05);
    if (thump) { const o = ctx.createOscillator(); o.type = 'sine'; const og = gainNode(0); o.frequency.setValueAtTime(thump, now); o.frequency.exponentialRampToValueAtTime(thump * 0.45, now + dur); og.gain.setValueAtTime(gain * 0.9, now); og.gain.exponentialRampToValueAtTime(0.0008, now + dur); o.connect(og); og.connect(master); o.start(now); o.stop(now + dur + 0.05); }
  }
  const set = (p, v, tc = 0.05) => p.setTargetAtTime(v, ctx.currentTime, tc);

  return {
    /** must be called from a user gesture (keydown / click) */
    resume() { init(); if (ctx.state !== 'running') ctx.resume(); },
    get running() { return ready && ctx.state === 'running'; },
    mute(m) { muted = m; if (ready) set(master.gain, m ? 0 : 0.85, 0.05); },
    toggleMute() { this.mute(!muted); return muted; },
    impact(mag) { if (!ready || muted) return; const k = Math.min(1, mag / 12); shot({ f: 160 + 300 * (1 - k), q: 0.8, gain: 0.25 + 0.7 * k, dur: 0.22 + 0.3 * k, thump: 70 + 40 * (1 - k) }); shot({ type: 'highpass', f: 2200, q: 0.7, gain: 0.12 * k, dur: 0.3 }); },
    pop(strength = 1) { if (!ready || muted) return; shot({ f: 300 + Math.random() * 400, q: 0.9, gain: 0.35 * strength, dur: 0.07 + Math.random() * 0.05, thump: 95 }); shot({ type: 'highpass', f: 2500, q: 0.6, gain: 0.16 * strength, dur: 0.05 }); },
    /** s: { rpm, throttle, boost, speed, slipF, slipR, hard, limiter, scrape, gear, brake, dt } */
    update(s) {
      if (!ready || ctx.state !== 'running') return;
      const dt = s.dt, rpm = s.rpm, thr = s.throttle;
      // engine layers
      const L = nodes.layers, r = rpm;
      const gLow = r < 2600 ? 1 : Math.max(0, 1 - (r - 2600) / 1700), gMid = r < 2600 ? Math.max(0, (r - 1400) / 1200) : r < 4300 ? 1 : Math.max(0, 1 - (r - 4300) / 2200), gHigh = Math.max(0, Math.min(1, (r - 4400) / 2200));
      const load = 0.28 + 0.72 * thr;
      const haveS = !!nodes.samplesReady, pScale = haveS ? 0.42 : 1;
      if (haveS) {
        for (const L of nodes.samples) {
          // trapezoid window over rpm with wide overlaps between neighbouring layers
          const w = Math.max(0, Math.min(1, (r - L.lo) / Math.max(1, L.center - L.lo), (L.hi - r) / Math.max(1, L.hi - L.center)));
          set(L.g.gain, Math.pow(w, 0.8) * (0.3 + 0.7 * thr) * (s.limiter ? (Math.floor(performance.now() / 55) % 2 ? 0.2 : 1) : 1), 0.04);
          set(L.src.playbackRate, Math.max(0.5, Math.min(1.8, r / L.center)), 0.03);
        }
      }
      const lim = s.limiter ? (Math.floor(performance.now() / 55) % 2 ? 0.15 : 1) : 1;
      [gLow, gMid, gHigh].forEach((g, i) => { set(L[i].g.gain, g * load * lim * pScale, 0.03); set(L[i].s.playbackRate, Math.max(0.2, r / L[i].ref), 0.025); });
      set(nodes.engLP.frequency, 900 + 7500 * thr * thr + r * 0.45, 0.06);
      set(nodes.eng.gain, 0.5 + 0.1 * thr, 0.05);
      set(nodes.inG.gain, 0.03 + 0.09 * thr * (r / 7000), 0.06); set(nodes.inBP.frequency, 500 + r * 0.25, 0.08);
      // turbo
      const b = s.boost, whistle = 1500 + 5200 * b * Math.min(1, r / 6500);
      set(nodes.tw.frequency, whistle, 0.05); set(nodes.tw2.frequency, whistle * 1.5, 0.05); set(nodes.twG.gain, 0.012 * b * b * (0.5 + thr), 0.06);
      if (boostPrev > 0.65 && thr < 0.25 && lastThr > 0.6) shot({ type: 'highpass', f: 2800, q: 0.7, gain: 0.3 * boostPrev, dur: 0.38 });
      boostPrev = b;
      // pops: lifting off the throttle at high rpm / upshift under load
      popCool -= dt;
      if (popCool <= 0 && rpm > 3800 && ((lastThr > 0.7 && thr < 0.15) || (s.gear > lastGear && thr > 0.5))) { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) setTimeout(() => this.pop(0.6 + Math.random() * 0.6), i * (60 + Math.random() * 90)); popCool = 0.25; }
      if (nodes.overrun && popCool <= 0 && rpm > 4200 && lastThr > 0.65 && thr < 0.12 && (nodes.overrunCool ?? 0) < performance.now()) {
        const o = ctx.createBufferSource(), og = gainNode(0), now = ctx.currentTime, d = 1.5 + Math.random() * 0.8; o.buffer = nodes.overrun; o.playbackRate.value = 0.9 + 0.25 * Math.min(1, rpm / 7000);
        o.connect(og); og.connect(master); og.gain.setValueAtTime(0.0001, now); og.gain.exponentialRampToValueAtTime(0.55, now + 0.03); og.gain.exponentialRampToValueAtTime(0.001, now + d); o.start(now, Math.random() * 2.5, d + 0.1);
        nodes.overrunCool = performance.now() + 1800;
      }
      lastThr += (thr - lastThr) * Math.min(1, dt * 14); lastGear = s.gear;
      if (thr < 0.1 && rpm > 5200 && Math.random() < dt * 5 && popCool <= 0) { this.pop(0.5); popCool = 0.08; }
      // tyres
      const sq = x => Math.max(0, Math.min(1, (x - 0.95) / 1.3));
      const f1 = sq(s.slipF) * s.hard, r1 = sq(s.slipR) * s.hard;
      set(nodes.sqF.g.gain, f1 * 0.26, 0.05); set(nodes.sqR.g.gain, r1 * 0.3, 0.05);
      set(nodes.sqF.bp.frequency, 780 + 1100 * Math.min(1, s.speed / 40) + 200 * f1, 0.06); set(nodes.sqR.bp.frequency, 620 + 900 * Math.min(1, s.speed / 40) + 260 * r1, 0.06);
      set(nodes.scG.gain, Math.max(sq(s.slipF), sq(s.slipR)) * (1 - s.hard) * 0.28, 0.06);
      // wind / road
      const v = s.speed; set(nodes.wG.gain, Math.min(0.5, (v / 55) * (v / 55) * 0.45), 0.1); set(nodes.wBP.frequency, 350 + v * 14, 0.1);
      set(nodes.rG.gain, Math.min(0.28, v / 70 * 0.28) * (0.6 + 0.4 * s.hard), 0.1);
      set(nodes.sG.gain, Math.min(0.5, s.scrape / 4e5), 0.04);
    },
  };
}
