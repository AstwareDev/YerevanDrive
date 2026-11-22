// Street-life plug-in: vegetation, parked cars, signs/signals/street furniture, billboards.
// Placement data comes from public/map/props.json (tools/build-props.mjs). Auto-loaded by main.js.
import { buildVegetation } from './props/trees.js';
import { buildCars, showroom, carTriCounts } from './props/cars.js';
import { buildFurniture } from './props/furniture.js';
import { view, statsOf } from './props/util.js';

import { fetchJSON } from './net.js';

export default async function (ctx) {
  const { THREE, scene, H, camera } = ctx;
  const data = await fetchJSON('/map/props.json');
  const parts = [];
  const guard = async (name, fn) => { try { const t0 = performance.now(); const p = await fn(); if (p) parts.push(p); console.log(`[props] ${name} ready in ${(performance.now() - t0).toFixed(0)} ms`); } catch (e) { console.error(`[props] ${name} failed`, e); } };
  await guard('vegetation', () => buildVegetation({ ...ctx, data }));
  // parked cars are off by default so the roads are clear for the player car; add ?cars=1 to bring them back
  if (new URLSearchParams(location.search).get('cars') === '1') await guard('cars', () => buildCars({ ...ctx, data }));
  // road signs, traffic lights, street-name plates, stop poles and rooftop / blade signs are off by default (?signs=1 restores them)
  if (new URLSearchParams(location.search).get('signs') !== '1') for (const k of ['signs', 'signals', 'names', 'stoppoles', 'rooftop', 'blades']) data[k] = [];
  await guard('furniture', () => buildFurniture({ ...ctx, data }));
  // debug helper: window.__props.view(kind, index, distance, height, stride, targetHeight) frames a prop from the front
  const viewFn = (k, i, dist = 8, h = 2.2, st = 4, ty = 1.2, side = 0) => { const d = data[k], x = d[i * st], z = d[i * st + 1], yaw = d[i * st + 2] + side, g = H(x, z); window.__yerevan?.setCam(x + Math.sin(yaw) * dist, g + h, z + Math.cos(yaw) * dist, x, g + ty, z); return [x, z, yaw]; };
  let removeShow = null;
  const api = {
    parts, data, H, view: viewFn, stats: statsOf,
    showroom(x = 0, z = 60, lod = 0, yaw = 0, only = null) { removeShow?.(); removeShow = showroom(scene, H, x, z, lod, yaw, only); return !!removeShow; },
    carTris: carTriCounts,
    clearShowroom() { removeShow?.(); removeShow = null; },
    /** average ms per forced full cell re-cull (camera jumps 9 m + turns each iteration) */
    bench(n = 40) { const c = camera.clone(); const t0 = performance.now(); for (let i = 0; i < n; i++) { c.position.x += 9; c.rotation.y += 0.03; c.updateMatrixWorld(true); c.updateProjectionMatrix(); view.set(c); for (const q of parts) q.update?.(0.016, c, i); } return +((performance.now() - t0) / n).toFixed(2); },
  };
  for (const pt of parts) if (pt.api) Object.assign(api, pt.api);
  window.__props = api;
  // dev shortcut: ?show=<model|all>&lod=0&day=1&cam=px,py,pz,tx,ty,tz  (cars showroom at (0,10))
  const qs = new URLSearchParams(location.search);
  if (qs.has('show')) { const t = setInterval(() => { if (!window.__yerevan) return; clearInterval(t); const o = qs.get('show'); api.showroom(0, 10, +(qs.get('lod') ?? 0), +(qs.get('yaw') ?? 0), o === 'all' ? null : o); if (qs.has('day')) window.__yerevan.setTod(+qs.get('day')); const c = (qs.get('cam') ?? '3.6,1.0,13.2,0,0.6,10').split(',').map(Number); window.__yerevan.setCam(...c); document.getElementById('loading').style.display = 'none'; }, 200); }
  return { update(dt, cam, time) { view.set(cam ?? camera); for (const p of parts) p.update?.(dt, cam ?? camera, time); } };
}
