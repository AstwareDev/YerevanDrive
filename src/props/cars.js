// Parked cars: 14 detailed real-world models x 4 LODs (8k / 1.5k / 250 tris / box), instanced per model, culled per 128 m cell.
import * as THREE from 'three';
import { instanced, composeInto, CellFamily, track, canvas, canvasTex } from './util.js';
import { buildCarModel } from './carmodels.js';
import { SPECS, MODELS } from './carspecs.js';
import { makeCarMaterial, carU } from './carmat.js';
import { quality } from '../quality.js';

const litAttr = (geo, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(0.14), 1); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aLit', a); return a; };

function farBox() {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(1), m = new Float32Array(n);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aMat', new THREE.BufferAttribute(m, 1));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return g;
}
function shadowTexture() {
  const [c, ctx] = canvas(64, 128); ctx.clearRect(0, 0, 64, 128); ctx.save(); ctx.scale(1, 2);
  const rg = ctx.createRadialGradient(32, 32, 4, 32, 32, 32); rg.addColorStop(0, 'rgba(0,0,0,0.8)'); rg.addColorStop(0.6, 'rgba(0,0,0,0.5)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, 64, 64); ctx.restore();
  return canvasTex(c, { aniso: 1, mip: false });
}

export function modelDims(name) { const S = SPECS[name]; return { L: S.L, W: S.W, H: S.top.reduce((m, p) => Math.max(m, p[1]), 0) }; }

export function buildCars({ scene, H, data, tod }) {
  const group = new THREE.Group(); group.name = 'parkedCars'; scene.add(group);
  const cars = data.cars, N = cars.length / 7, pal = data.palette, tmpC = new THREE.Color(), cd = quality.carDetail;
  const matP = makeCarMaterial({ physical: true, noise: true }), matS = makeCarMaterial({ physical: false, noise: true }), matL = makeCarMaterial({ physical: false, noise: false, envMapIntensity: 1 });
  const farMat = matL;
  const keepFrac = quality.propScale; // 0.35 / 0.7 / 1: thin parked cars deterministically
  const keep = i => ((Math.imul(i, 2654435761) >>> 8) & 0xffff) / 65536 < keepFrac;
  // LOD distances (m); scaled again by quality.lodScale inside CellFamily
  const D = cd >= 2 ? [25, 80, 200] : cd === 1 ? [16, 70, 180] : [0, 60, 150], FAR = 440;
  const byV = MODELS.map(() => []);
  for (let i = 0; i < N; i++) { const v = cars[i * 7 + 3]; (byV[v] ?? byV[0]).push(i); }
  const colour = (i, jit) => { const ci = cars[i * 7 + 4], base = ci === 100 ? [0.93, 0.68, 0.04] : pal[ci]; const j = 0.94 + jit * 0.12; tmpC.setRGB(base[0] * j, base[1] * j, base[2] * j, THREE.SRGBColorSpace); return [tmpC.r, tmpC.g, tmpC.b]; };
  const families = [], lazy = [];
  const farGeo = farBox(), farM = new Float32Array(N * 16), farC = new Float32Array(N * 3), shM = new Float32Array(N * 16);
  const shadowGeo = new THREE.PlaneGeometry(2.3, 5.2).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, opacity: 0.85 });
  const keepAll = new Uint8Array(N); for (let i = 0; i < N; i++) keepAll[i] = keep(i) ? 1 : 0;
  MODELS.forEach((name, vi) => {
    const idxs = byV[vi].filter(i => keepAll[i]); const n = idxs.length; if (!n) return;
    const S = SPECS[name], Hh = modelDims(name).H;
    const m = new Float32Array(n * 16), bc = new Float32Array(n * 3), lit = new Float32Array(n).fill(0.14);
    idxs.forEach((src, k) => {
      const x = cars[src * 7], z = cars[src * 7 + 1], yaw = cars[src * 7 + 2], jit = cars[src * 7 + 6], lights = cars[src * 7 + 5];
      const fx = Math.sin(yaw), fz = Math.cos(yaw), y0 = H(x, z), a = H(x + fx * S.wb * 0.5, z + fz * S.wb * 0.5), b = H(x - fx * S.wb * 0.5, z - fz * S.wb * 0.5), pitch = -Math.atan2(a - b, S.wb);
      const y = Math.max(y0, (a + b) / 2) + 0.118;
      composeInto(m, k, x, y, z, yaw, 1, 1, 1, pitch);
      bc.set(colour(src, jit), k * 3); lit[k] = name === 'taxi' ? 0.5 : lights === 1 ? 2.6 : lights === 2 ? 1.7 : 0.14;
      composeInto(farM, src, x, y, z, yaw, S.W, Hh, S.L, pitch); farC.set(colour(src, jit), src * 3);
      composeInto(shM, src, x, y - 0.1, z, yaw, S.W / 1.9, 1, S.L / 4.4, pitch);
    });
    // geometry per LOD is generated lazily on first update that needs it (LOD0 only when the preset asks for it)
    const levels = [], mk = (lod, mat, dist, cast) => {
      const geo = buildCarModel(S, lod), mesh = instanced(geo, mat, n, true), attr = litAttr(geo, n); mesh.castShadow = cast && quality.shadows; mesh.receiveShadow = lod < 2; group.add(track(mesh));
      levels.push({ dist, meshes: [mesh] }); return { mesh, attr };
    };
    const parts = [];
    if (cd >= 1) parts.push(mk(0, matP, D[0], true)); parts.push(mk(1, matS, D[1], true), mk(2, matL, D[2], false));
    const colMap = new Map(parts.map(p => [p.mesh, bc]));
    const fam = new CellFamily({ n, m, levels, itemColors: colMap, extras: parts.map(p => ({ mesh: p.mesh, attr: p.attr, data: lit, size: 1 })), radius: Math.max(S.L, 3) * 0.6, mid: 0.8, scale: quality.lodScale, minMove: 1.5, name });
    families.push(fam);
  });
  // far boxes (one draw call for every model) + contact shadows
  const imFar = instanced(farGeo, farMat, N, true); group.add(track(imFar));
  const farLit = litAttr(farGeo, N); farGeo.setAttribute('aLit', farLit);
  const imSh = instanced(shadowGeo, shadowMat, N, false); imSh.renderOrder = 3; group.add(track(imSh));
  families.push(new CellFamily({ n: N, m: farM, levels: [{ dist: D[2], meshes: [] }, { dist: FAR, meshes: [imFar] }], itemColors: new Map([[imFar, farC]]), radius: 3, mid: 0.8, scale: quality.lodScale, keep: i => keepAll[i] === 1, minMove: 4, name: 'far' }));
  families.push(new CellFamily({ n: N, m: shM, levels: [{ dist: Math.max(D[1], 120), meshes: [imSh] }], radius: 3, mid: 0, scale: quality.lodScale, keep: i => keepAll[i] === 1, minMove: 4, name: 'shadow' }));
  families.forEach(f => f.update(true));
  return {
    update() { carU.uNight.value = tod.night; for (const f of families) f.update(); },
    families, stats() { return families.map(f => ({ name: f.name, counts: f.counts })); },
  };
}

/** debug: every model at the given LOD, side by side at (x0, z0), nose towards -z. returns a remove() fn */
export function showroom(scene, H, x0, z0, lod = 0, yaw = 0, only = null) {
  const g = new THREE.Group(); scene.add(g); const mats = [makeCarMaterial({ physical: true }), makeCarMaterial({}), makeCarMaterial({ noise: false })];
  const cols = ['#e8e8e8', '#16181c', '#8a1018', '#c0c4cc', '#1c3a6e', '#d6b020', '#2e5a3a'];
  MODELS.forEach((name, i) => {
    if (only && name !== only) return;
    const geo = buildCarModel(SPECS[name], lod); litAttr(geo, 1); const im = new THREE.InstancedMesh(geo, mats[lod], 1); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    const c = new THREE.Color(name === 'taxi' ? '#d9a800' : cols[i % cols.length]); im.setColorAt(0, c);
    const col = only ? 2 : i % 5, row = only ? 0 : Math.floor(i / 5), x = x0 + (col - 2) * (3.4 + Math.abs(Math.sin(yaw)) * 2.7), z = z0 + row * (7.5 + Math.abs(Math.cos(yaw)) * 0); const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, H(x, z) + 0.125, z); im.setMatrixAt(0, m); im.frustumCulled = false; im.receiveShadow = true; im.castShadow = true; g.add(im);
  });
  return () => { scene.remove(g); g.traverse(o => o.geometry?.dispose()); };
}

/** triangle count of every model at every LOD (debug / budget check) */
export function carTriCounts() { const out = {}; for (const name of MODELS) out[name] = [0, 1, 2].map(l => { const g = buildCarModel(SPECS[name], l); const t = g.userData.tris; g.dispose(); return t; }); return out; }
