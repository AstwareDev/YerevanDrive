// Automatic quality governor: keeps ~60 fps on unknown hardware (GTX 1660 Super, laptops). Steps down when the smoothed frame time is
// too high, steps back up slowly when there is headroom. Disable with ?gov=0 (the in-app screenshot environment runs on a software GPU).
export function createGovernor({ renderer, composer, quality, bloom, ssrPass, moon, basePixelRatio }) {
  const enabled = new URLSearchParams(location.search).get('gov') !== '0';
  const baseLod = quality.lodScale;
  // each step is cumulative; step 0 = full quality for the chosen preset
  const steps = [
    () => {},
    () => setPR(0.85),
    () => { setPR(0.72); quality.lodScale = baseLod * 0.85; },
    () => { if (ssrPass) ssrPass.enabled = false; },
    () => { moon.castShadow = false; },
    () => { setPR(0.6); quality.lodScale = baseLod * 0.7; bloom.enabled = false; },
  ];
  let level = 0, ema = 16.7, slow = 0, fast = 0, t = 0;
  function setPR(k) { renderer.setPixelRatio(basePixelRatio * k); composer.setPixelRatio(basePixelRatio * k); composer.setSize(innerWidth, innerHeight); }
  function apply(l) {
    // reset to full, then apply cumulative steps up to l
    renderer.setPixelRatio(basePixelRatio); composer.setPixelRatio(basePixelRatio); quality.lodScale = baseLod;
    if (ssrPass) ssrPass.enabled = quality.reflections; moon.castShadow = quality.shadows; bloom.enabled = quality.bloom;
    for (let i = 1; i <= l; i++) steps[i]();
    composer.setSize(innerWidth, innerHeight); level = l;
  }
  return {
    get level() { return level; },
    update(dt) {
      if (!enabled) return; t += dt; if (t < 6) return;                 // ignore load / shader-compile hitches
      ema += (dt * 1000 - ema) * 0.05;
      if (ema > 21) { slow += dt; fast = 0; } else if (ema < 15.5) { fast += dt; slow = 0; } else { slow = fast = 0; }
      if (slow > 2.5 && level < steps.length - 1) { apply(level + 1); slow = 0; ema = 16.7; }
      else if (fast > 12 && level > 0) { apply(level - 1); fast = 0; ema = 16.7; }
    },
  };
}
