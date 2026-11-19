// Drift-circuit plug-in: dresses two circuits on the real street network (data from public/map/circuits.json, built by tools/build-circuits.mjs).
// Contract: default export async (ctx) => ({ update(dt, camera, time) }), ctx = { THREE, scene, renderer, camera, M, T, meta, H, lampHeads, tod }.
// Everything is instanced / merged, bucketed into ~128 m cells, culled by distance + frustum and scaled by `quality` (propScale, detailRadius, lodScale).
import * as THREE from 'three';
import { quality } from './quality.js';
import { Track, InstBatch, MergedBatch, GeoBuilder, View, lin } from './circuits/util.js';
import { tyreGeometry, tyreStackProxy, armcoGeometry, barrierGeometry, coneGeometry } from './circuits/geometry.js';
import * as TX from './circuits/textures.js';
import { dressTrack, paintStart } from './circuits/dress.js';
import { dressStructures } from './circuits/structures.js';
import { makeDebug } from './circuits/debug.js';

export default async function circuits(ctx) {
  const { scene, renderer, camera, H, tod } = ctx;
  const t0 = performance.now();
  const data = await (await fetch('/map/circuits.json')).json();
  const aniso = Math.min(quality.anisotropy, renderer.capabilities.getMaxAnisotropy());
  const lod = quality.lodScale, R = quality.detailRadius;

  // ------------------------------------------------------------ textures + materials
  const tyreTex = TX.tyreTexture(aniso), rumbleTex = TX.rumbleTexture(aniso), barrier = TX.barrierTexture(aniso), banners = TX.bannerAtlas(aniso);
  const allCorners = []; const signBase = {};
  data.forEach(c => { signBase[c.id] = allCorners.length; for (const co of c.corners) allCorners.push(co); });
  const signs = TX.signAtlas(aniso, allCorners), paintTex = TX.paintAtlas(aniso), skidTex = TX.skidTexture(aniso), oilTex = TX.oilTexture(aniso), standTex = TX.standTexture(aniso), glowTex = TX.glowTexture();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const decalOffset = (f = -2) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
  const mats = {
    tyre: std({ map: tyreTex, roughness: 0.95, metalness: 0.0 }),
    armco: std({ vertexColors: true, roughness: 0.4, metalness: 0.75, side: THREE.DoubleSide }),
    barrier: std({ map: barrier.map, emissiveMap: barrier.emissive, emissive: new THREE.Color(0, 0, 0), roughness: 0.88, metalness: 0.0 }),
    cone: std({ vertexColors: true, roughness: 0.55, metalness: 0.0 }),
    solid: std({ vertexColors: true, roughness: 0.72, metalness: 0.2 }),
    lamps: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true }),
    banner: std({ map: banners.map, emissiveMap: banners.map, emissive: new THREE.Color(0.1, 0.1, 0.1), roughness: 0.6, metalness: 0.0, side: THREE.FrontSide }),
    signs: std({ map: signs.map, emissiveMap: signs.map, emissive: new THREE.Color(0.1, 0.1, 0.1), roughness: 0.4, metalness: 0.1 }),
    stand: std({ map: standTex, roughness: 0.85, metalness: 0.0 }),
    rumble: std({ map: rumbleTex, roughness: 0.7, metalness: 0.0, ...decalOffset(-3) }),
    skid: new THREE.MeshStandardMaterial({ map: skidTex, transparent: true, opacity: 0.85, depthWrite: false, roughness: 0.6, metalness: 0.0, ...decalOffset(-2) }),
    oil: new THREE.MeshStandardMaterial({ map: oilTex, transparent: true, opacity: 0.9, depthWrite: false, roughness: 0.15, metalness: 0.2, ...decalOffset(-2) }),
    paint: std({ map: paintTex, transparent: true, alphaTest: 0.02, roughness: 0.75, metalness: 0.0, depthWrite: false, ...decalOffset(-4) }),
    pool: new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1.0, 0.78, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.0, ...decalOffset(-5) }),
  };
  mats.paint.vertexColors = true; mats.rumble.vertexColors = true; mats.skid.vertexColors = true; mats.oil.vertexColors = true; mats.stand.vertexColors = true;
  data.forEach(c => { mats['gantry_' + c.id] = std({ map: TX.gantryTexture(aniso, c.kind === 'fast' ? 'NORTHERN AVENUE RUN' : 'REPUBLIC LOOP', c.kind === 'fast' ? 'ՀՅՈՒՍԻՍԱՅԻՆ ՊՈՂՈՏԱՅԻ ՎԱԶՔ  ·  START / FINISH' : 'ՀԱՆՐԱՊԵՏՈՒԹՅԱՆ ՕՂԱԿ  ·  START / FINISH'), emissive: new THREE.Color(0.1, 0.1, 0.1), roughness: 0.5, metalness: 0.1 }); mats['gantry_' + c.id].emissiveMap = mats['gantry_' + c.id].map; });

  // ------------------------------------------------------------ batches
  const tyreLv = [{ geometry: tyreGeometry(0), dist: 18 * lod }, { geometry: tyreGeometry(1), dist: 45 * lod }, { geometry: tyreGeometry(2), dist: 100 * lod }, { geometry: tyreStackProxy(), dist: Math.min(R, 320 * lod), far: true }];
  const batches = {
    tyre: new InstBatch('circuit-tyres', tyreLv, mats.tyre, { color: true }),
    armco: new InstBatch('circuit-armco', [{ geometry: armcoGeometry(), dist: R * 0.9 }], mats.armco),
    barrier: new InstBatch('circuit-barriers', [{ geometry: barrierGeometry(), dist: R * 0.9 }], mats.barrier),
    cone: new InstBatch('circuit-cones', [{ geometry: coneGeometry(), dist: R * 0.7 }], mats.cone),
  };
  const gb = { solid: new GeoBuilder(), lamps: new GeoBuilder(), banner: new GeoBuilder(), signs: new GeoBuilder(), stand: new GeoBuilder(), rumble: new GeoBuilder(), skid: new GeoBuilder(), oil: new GeoBuilder(), paint: new GeoBuilder(), pool: new GeoBuilder(), gantry: {} };
  data.forEach(c => { gb.gantry[c.id] = new GeoBuilder(); });
  const kit = { quality, H, batches, gb, atlas: { banner: banners, sign: signs }, walls: {}, stats: {}, signTile: (id, n) => 4 + signBase[id] + (n - 1) };

  const tracks = data.map(c => new Track(c, H)), byId = {}; tracks.forEach(t => { byId[t.id] = t; });
  const tBuild = performance.now();
  for (const tr of tracks) { dressTrack(kit, tr); paintStart(kit, tr); dressStructures(kit, tr); }
  const tBuilt = performance.now();

  // finalize
  const group = new THREE.Group(); group.name = 'circuits'; scene.add(group);
  const castShadow = quality.shadows;
  const finalizeInst = (b, shadowLevels = 1) => { b.finalize(group); b.meshes.forEach((m, i) => { m.castShadow = castShadow && i < shadowLevels; }); };
  finalizeInst(batches.tyre, 1); finalizeInst(batches.armco, 1); finalizeInst(batches.barrier, 1); finalizeInst(batches.cone, 0);
  const merged = {};
  const mk = (name, builder, mat, radius, opts = {}) => { if (builder.count) { merged[name] = new MergedBatch('circuit-' + name, builder, mat, { radius, ...opts }, group); } };
  mk('solid', gb.solid, mats.solid, R * 1.7, { castShadow });
  mk('lamps', gb.lamps, mats.lamps, R * 2.4);
  mk('banner', gb.banner, mats.banner, R * 1.2);
  mk('signs', gb.signs, mats.signs, R * 1.0);
  mk('stand', gb.stand, mats.stand, R * 1.5, { castShadow });
  mk('rumble', gb.rumble, mats.rumble, R * 0.9, { renderOrder: 1 });
  mk('skid', gb.skid, mats.skid, R * 0.75, { renderOrder: 2 });
  mk('oil', gb.oil, mats.oil, R * 0.55, { renderOrder: 2 });
  mk('paint', gb.paint, mats.paint, R * 0.85, { renderOrder: 3 });
  mk('pool', gb.pool, mats.pool, R * 2.4, { renderOrder: 4 });
  data.forEach(c => mk('gantry_' + c.id, gb.gantry[c.id], mats['gantry_' + c.id], R * 2.0));

  const view = new View();
  const debug = makeDebug(scene, tracks);
  const tFinal = performance.now();

  // ------------------------------------------------------------ teleport / framing helpers for screenshots
  const f = {};
  const setCam = (px, py, pz, tx, ty, tz) => { if (window.__yerevan?.setCam) window.__yerevan.setCam(px, py, pz, tx, ty, tz); else { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); } };
  /** goto(id, t, h, opts): t in [0,1) = fraction of the lap (t > 1 = metres); h = camera height above ground; opts { back, look, lat, ty, yaw } */
  function goto(id, t = 0, h = 6, opts = {}) {
    const tr = byId[id] ?? tracks[Number(id) || 0]; if (!tr) return null;
    const i = t <= 1 ? t * tr.n : t / tr.ds; tr.at(i, 0, f);
    const back = opts.back ?? 14, look = opts.look ?? 30, lat = opts.lat ?? 0, ty = opts.ty ?? 1.2;
    const cx = f.cx + f.rx * lat - f.tx * back, cz = f.cz + f.rz * lat - f.tz * back, tl = opts.tlat ?? 0, tx = f.cx + f.tx * look + f.rx * tl, tz = f.cz + f.tz * look + f.rz * tl;
    setCam(cx, H(cx, cz) + h, cz, tx, H(tx, tz) + ty, tz);
    return { index: Math.round(f.i), x: f.cx, z: f.cz };
  }
  /** corner(id, n, distance, height, side): frame corner n from `distance` m away (side: -1 left of the outside, +1 right, 0 = from the entry) */
  function corner(id, n = 1, dist = 24, h = 3, opts = {}) {
    const tr = byId[id] ?? tracks[0], co = tr.c.corners[n - 1]; if (!co) return null;
    const outside = co.dir === 'R' ? -1 : 1, i = co.apex; tr.at(i, 0, f);
    const lat = outside * (f.hw + dist), cx = f.cx + f.rx * lat, cz = f.cz + f.rz * lat;
    setCam(cx, H(cx, cz) + h, cz, f.cx, H(f.cx, f.cz) + (opts.ty ?? 1), f.cz);
    return co;
  }
  /** air(id, t, height): bird's-eye shot over a point of the lap */
  function air(id, t = 0, h = 140, opts = {}) {
    const tr = byId[id] ?? tracks[0], i = t <= 1 ? t * tr.n : t / tr.ds; tr.at(i, 0, f);
    const back = opts.back ?? 60, cx = f.cx - f.tx * back, cz = f.cz - f.tz * back;
    setCam(cx, H(f.cx, f.cz) + h, cz, f.cx + f.tx * (opts.look ?? 20), H(f.cx, f.cz), f.cz + f.tz * (opts.look ?? 20));
    return { x: f.cx, z: f.cz };
  }
  /** front(id, x, z, dist, h): look at any point of a circuit from the track side. useful with data.corners[...] / walls */
  const info = () => {
    let draw = 0, tris = 0;
    for (const b of Object.values(batches)) { b.meshes.forEach(m => { if (m.visible && m.count) draw++; }); tris += b.tris; }
    for (const m of Object.values(merged)) { if (m.mesh.visible) draw++; tris += m.visible; }
    const inst = {}; for (const [k, b] of Object.entries(batches)) inst[k] = { total: b.n, visible: b.visible, tris: Math.round(b.tris) };
    const mrg = {}; for (const [k, m] of Object.entries(merged)) mrg[k] = { totalTris: m.totalTris, visibleTris: Math.round(m.visible) };
    return { drawCalls: draw, trianglesVisible: Math.round(tris), inst, merged: mrg, stats: kit.stats, build: { ms: Math.round(tFinal - t0), dress: Math.round(tBuilt - tBuild), quality: quality.level } };
  };
  window.__circuits = { list: data, tracks: byId, goto, corner, air, info, kit, batches, merged, debug: on => { debug.visible = on === undefined ? !debug.visible : !!on; return debug.visible; }, view };
  console.log(`[circuits] ready in ${Math.round(tFinal - t0)} ms (dress ${Math.round(tBuilt - tBuild)} ms)`, data.map(c => `${c.name} ${c.length} m`).join(' | '), kit.stats);

  // ------------------------------------------------------------ per-frame
  const first = { done: false };
  return {
    update(dt, cam, time) {
      cam = cam ?? camera; view.update(cam);
      const night = tod ? tod.night : 1;
      mats.lamps.color.setScalar(0.1 + 0.9 * night);
      const em = 0.08 + 0.34 * night; mats.banner.emissive.setScalar(em); mats.signs.emissive.setScalar(0.1 + 0.25 * night);
      data.forEach(c => mats['gantry_' + c.id].emissive.setScalar(0.1 + 0.45 * night));
      mats.barrier.emissive.setScalar(0.1 + 0.5 * night);
      mats.pool.opacity = 0.55 * night; if (merged.pool) merged.pool.mesh.visible = merged.pool.mesh.visible && night > 0.03;
      const force = !first.done; first.done = true;
      batches.tyre.update(view, R, force); batches.armco.update(view, R, force); batches.barrier.update(view, R, force); batches.cone.update(view, R * 0.7, force);
      for (const m of Object.values(merged)) m.update(view, undefined, force);
          },
  };
}
