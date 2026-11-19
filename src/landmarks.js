// Hand-modelled landmarks around Republic Square (procedural geometry, merged per material).
// Contract: export default async function (ctx) -> { update(dt, camera, time) }
//   footprints come from public/map/lm/footprints.json  (tools/build-landmarks.mjs); generic OSM boxes are suppressed via data/landmark-skip.json
import { Mesher, pip } from './landmarks/kit.js';
import { makeLandmarkMaterials } from './landmarks/mats.js';
import { buildEnsemble } from './landmarks/ensemble.js';
import { buildOpera } from './landmarks/opera.js';
import { buildCathedral } from './landmarks/cathedral.js';
import { buildNorthern } from './landmarks/northern.js';
import { buildFountain } from './landmarks/fountain.js';

export default async function (ctx) {
  const { THREE, scene, renderer, T, H } = ctx;
  const t0 = performance.now();
  const fp = await (await fetch('/map/lm/footprints.json')).json();
  const mats = makeLandmarkMaterials(renderer, T);
  const root = new THREE.Group(); root.name = 'landmarks'; scene.add(root);
  const upd = [];

  // neighbouring outlines (used to hide party walls)
  const others = fp.others.map(o => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of o.r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return { ...o, bb: [x0, z0, x1, z1] }; });
  const hidden = (p, selfId) => { let h = 0; for (const o of others) { if (o.id === selfId) continue; const b = o.bb; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue; if (pip(p, o.r)) h = Math.max(h, o.h); } return h; };

  const m = new Mesher((x, z) => H(x, z));
  buildEnsemble(m, fp, hidden);
  buildNorthern(m, fp, hidden);
  buildOpera(m);
  buildCathedral(m, fp);
  const fountain = buildFountain({ m, root, H, renderer, camera: ctx.camera, mats });
  upd.push(fountain.update);

  const meshes = m.toThree(THREE, mats);
  let tris = 0; for (const me of meshes) { root.add(me); tris += me.userData.tris; me.updateMatrix(); }
  console.log(`landmarks: ${(tris / 1e3).toFixed(0)}k tris, ${meshes.length} meshes, ${(performance.now() - t0).toFixed(0)} ms`);
  window.__landmarks = { root, mats, tris };
  return { update(dt, camera, time) { for (const u of upd) u(dt, camera, time); } };
}
