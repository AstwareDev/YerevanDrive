// Shared helpers for street-furniture families (atlas tiles, plate geometry, cell-culled families, shared materials).
import * as THREE from 'three';
import { GeoBuilder, CellFamily, instanced, composeInto, lin, track } from './util.js';
import { quality } from '../quality.js';

export const GY = 0.06; // sidewalk height above terrain
export const C = { dark: lin('#1a1d24'), grey: lin('#3a3e46'), light: lin('#8a8f98'), wood: lin('#6a4326'), wood2: lin('#7a5230'), green: lin('#1c3a2a'), red: lin('#a3141a'), white: lin('#d8d8d0'), steel: lin('#6a6e76'), orange: lin('#e8620c'), concrete: lin('#8d8a84'), black: lin('#0e0f12') };

/** atlas tiles: per-instance `aTile` offset, uniform tile size; vertex attr `aBack` > 0.5 means uv already absolute. */
export function tileMaterial(mat, tx, ty) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTS = { value: new THREE.Vector2(tx, ty) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aTile; attribute float aBack; uniform vec2 uTS;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec2 tuv = aBack > 0.5 ? uv : uv * uTS + aTile;
        #ifdef USE_MAP
          vMapUv = tuv;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = tuv;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'tile' + tx + '_' + ty;
  return mat;
}
export function addTileAttr(geo, n, tiles, back = null) {
  const a = new Float32Array(n * 2); tiles.forEach((t, i) => { a[i * 2] = t[0]; a[i * 2 + 1] = t[1]; });
  const at = new THREE.InstancedBufferAttribute(a, 2); at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aTile', at); geo.userData.tileData = a;
  const pc = geo.attributes.position.count, b = new Float32Array(pc); if (back) back.forEach(i => { b[i] = 1; }); geo.setAttribute('aBack', new THREE.BufferAttribute(b, 1));
  return geo;
}
export const tilePos = (i, cols, rows) => [(i % cols) / cols, 1 - (Math.floor(i / cols) + 1) / rows];
/** two-sided plate geometry (front uses atlas tile, back uses a fixed absolute uv) */
export function plateGeo(w, h, backUV, z = 0.012) {
  const g = new THREE.BufferGeometry(); const hw = w / 2, hh = h / 2;
  const pos = [-hw, -hh, z, hw, -hh, z, hw, hh, z, -hw, hh, z, hw, -hh, -z, -hw, -hh, -z, -hw, hh, -z, hw, hh, -z];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, backUV[0], backUV[1], backUV[0], backUV[1], backUV[0], backUV[1], backUV[0], backUV[1]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]); return g;
}
export const tileEx = mesh => ({ mesh, attr: mesh.geometry.getAttribute('aTile'), data: mesh.geometry.userData.tileData, size: 2 });

export function makeMats() {
  return {
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
}

/** per-frame owner of every furniture family */
export class Furn {
  constructor(scene, H, mats) { this.group = new THREE.Group(); this.group.name = 'streetFurniture'; scene.add(this.group); this.H = H; this.mats = mats; this.fams = []; this.updates = []; this.shared = {}; this.api = {}; }
  /** instanced mesh registered with the group + stats */
  mesh(geo, mat, n, withColor = false) { const m = instanced(geo, mat, n, withColor); this.group.add(track(m)); return m; }
  /** cell-culled family: matrices -> meshes. keepFrac thins deterministically (quality.propScale) */
  fam(meshes, m, dist, { extras = [], colors = null, radius = 1.5, mid = 1, keepFrac = 1, name = '', minMove = 2.5, levels = null } = {}) {
    const n = m.length / 16, cm = new Map(); if (colors) for (const mesh of meshes) if (mesh.instanceColor) cm.set(mesh, colors);
    const keep = keepFrac >= 1 ? null : i => ((Math.imul(i, 2654435761) >>> 8) & 0xffff) / 65536 < keepFrac;
    const f = new CellFamily({ n, m, levels: levels ?? [{ dist, meshes }], itemColors: cm, extras, radius, mid, keep, scale: quality.lodScale, minMove, name });
    f.update(true); this.fams.push(f); return f;
  }
  update(dt, cam, time) { for (const u of this.updates) u(dt, cam, time); for (const f of this.fams) f.update(); }
}
export { GeoBuilder, composeInto, lin, quality, instanced, track };
