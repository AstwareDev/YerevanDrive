// Vegetation: every tree is the tree_animate.glb model (3 birch-like variants x near / mid LOD, one atlas material, see tools/build-tree.mjs)
// plus a crossed-quad far impostor; shrubs / hedges and flower beds are procedural. Everything is instanced and culled per 128 m cell (CellFamily).
// Wind: vertex-shader sway (onBeforeCompile) driven by one time uniform; the model's morph-target animation is not used.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GeoBuilder, CellFamily, instanced, composeInto, mkRng, lin, mul, mix, clamp, canvas, canvasTex, track } from './util.js';
import { leafTexture, flowerTexture } from './textures.js';
import { quality } from '../quality.js';

export const uTime = { value: 0 };
const uWarm = { value: new THREE.Vector3(0.085, 0.052, 0.02) };

// ------------------------------------------------------------------ materials
// NaN guard: the stock chunk normalises vNormal; a zero-length interpolated normal would give NaN -> bloom smears it over the frame.
const NOFLIP = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '').replace('normalize( vNormal )', 'normalize( vNormal + vec3( 0.0, 1.0e-4, 0.0 ) )');
function patchFoliage(mat, { flutter = 1, warm = 1, sway = true, swayK = 0.00085 } = {}) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime; sh.uniforms.uWarm = uWarm; sh.uniforms.uFlutter = { value: flutter }; sh.uniforms.uWarmK = { value: warm };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uFlutter;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway ? `{
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          float hgt = clamp(transformed.y, 0.0, 24.0);   // model-space metres (instance scale is applied after): bounded so the sway can never fling a vertex
          float w = hgt * hgt * ${swayK.toFixed(5)};
          float ph = ip.x * 0.31 + ip.z * 0.27;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + ip.x * 0.011 + ip.z * 0.008);
          transformed.x += (sin(uTime * 1.25 + ph) + 0.4 * sin(uTime * 2.9 + ph * 1.7)) * w * gust;
          transformed.z += (cos(uTime * 1.05 + ph * 1.3) + 0.4 * sin(uTime * 2.3 + ph)) * w * 0.7 * gust;
          transformed += normal * 0.06 * uFlutter * sin(uTime * 5.5 + dot(position, vec3(2.3, 3.1, 1.7)) + ph) * clamp(hgt * 0.15, 0.0, 1.0);
        }` : ''}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uWarm; uniform float uWarmK;')
      .replace('#include <normal_fragment_begin>', NOFLIP)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uWarm * uWarmK;');
  };
  mat.customProgramCacheKey = () => 'foliage' + flutter + '_' + warm + '_' + sway + '_' + swayK;
  return mat;
}
function makeMats() {
  const leaf = (tex, extra = {}) => patchFoliage(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true, ...extra }));
  return { leaf: [null, leaf(leafTexture('heart', 8, [96, 126])), leaf(leafTexture('oval', 12, [84, 110])), null, leaf(leafTexture('conifer', 23, [138, 162])), null] }; // shrub / hedge leaf sets (trees use the glb atlas)
}

// ------------------------------------------------------------------ crown / geometry construction
const norm3 = v => { const l = Math.hypot(...v); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hnoise = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
const BARK_UV = [0.025, 0.025];
const CARD_UV = [[0.07, 0.07], [1, 0.07], [1, 1], [0.07, 1]]; // keep clear of the bark swatch (u,v < 0.055)
/** lumpy ellipsoid (icosphere) added to the builder; sampled from the bark swatch so it takes the vertex colour only */
function lump(b, c, r, col, rng, detail = 1, jitter = 0.16, colVar = 0.25) {
  const ico = new THREE.IcosahedronGeometry(1, detail), pa = ico.attributes.position, tmp = new Map();
  const disp = (x, y, z) => { const k = x.toFixed(3) + y.toFixed(3) + z.toFixed(3); let v = tmp.get(k); if (v == null) { v = 1 + (hnoise(x, y, z) - 0.5) * 2 * jitter; tmp.set(k, v); } return v; };
  const base = b.n;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), d = disp(x, y, z);
    const shade = 0.75 + 0.25 * clamp(y * 0.5 + 0.5, 0, 1) + (hnoise(x * 3, y * 3, z * 3) - 0.5) * colVar;
    b.v([c[0] + x * r[0] * d, c[1] + y * r[1] * d, c[2] + z * r[2] * d], norm3([x, y * 0.8 + 0.2, z]), BARK_UV, mul(col, shade));
  }
  for (let i = 0; i < pa.count; i += 3) b.tri(base + i, base + i + 1, base + i + 2);
  ico.dispose();
}
/** leaf cards on/around lobes */
function cards(b, lobes, n, size, rng, o = {}) {
  const centre = o.centre ?? [0, lobes.reduce((s, l) => s + l.c[1], 0) / lobes.length, 0];
  const vol = lobes.map(l => l.r[0] * l.r[1] * l.r[2]), tv = vol.reduce((a, c) => a + c, 0);
  const base = o.col ?? [1, 1, 1], H = o.H ?? 10;
  for (let i = 0; i < n; i++) {
    let u = rng() * tv, li = 0; while (li < lobes.length - 1 && u > vol[li]) { u -= vol[li]; li++; }
    const L = lobes[li];
    let d; do { d = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]; } while (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1 || d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 0.05);
    d = norm3(d); const rho = 0.55 + 0.45 * Math.sqrt(rng());
    if (o.skyBias && d[1] < 0 && rng() < 0.4) d[1] = -d[1] * 0.5;
    const p = [L.c[0] + d[0] * L.r[0] * rho, L.c[1] + d[1] * L.r[1] * rho, L.c[2] + d[2] * L.r[2] * rho];
    const nO = norm3([p[0] - L.c[0], (p[1] - L.c[1]) * 1.2, p[2] - L.c[2]]), nG = norm3([p[0] - centre[0], (p[1] - centre[1]) * 1.1, p[2] - centre[2]]);
    const nrm = norm3([nO[0] * 0.6 + nG[0] * 0.4, nO[1] * 0.6 + nG[1] * 0.4 + 0.15, nO[2] * 0.6 + nG[2] * 0.4]);
    let f = norm3([nrm[0] + (rng() - 0.5) * 0.9, nrm[1] + (rng() - 0.5) * 0.9, nrm[2] + (rng() - 0.5) * 0.9]);
    if (o.upright) f = norm3([f[0], f[1] * 0.2, f[2]]);
    const t = norm3(cross3(f, Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), bt = cross3(f, t);
    const ph = rng() * Math.PI * 2, cp = Math.cos(ph), sp = Math.sin(ph); const t2 = [t[0] * cp + bt[0] * sp, t[1] * cp + bt[1] * sp, t[2] * cp + bt[2] * sp], b2 = [-t[0] * sp + bt[0] * cp, -t[1] * sp + bt[1] * cp, -t[2] * sp + bt[2] * cp];
    const s = size * (0.8 + rng() * 0.5) * (o.sx ?? 1), hs = s / 2;
    const ao = 0.42 + 0.58 * rho * rho, sky = 0.8 + 0.35 * clamp(p[1] / H, 0, 1.1), jit = 0.9 + rng() * 0.2;
    const col = mul(base, ao * sky * jit);
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [p[0] + (t2[0] * a + b2[0] * c) * hs, p[1] + (t2[1] * a + b2[1] * c) * hs, p[2] + (t2[2] * a + b2[2] * c) * hs]);
    const nn = norm3([nG[0] * 0.8, nG[1] * 0.8 + 0.35, nG[2] * 0.8]); // spherical shading normal
    const ids = q.map((pp, k) => b.v(pp, nn, CARD_UV[k], col));
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}
const CORE = lin('#4a9040'), CORE2 = lin('#52a047'), CORECONIF = lin('#2a7050');

// ------------------------------------------------------------------ far impostor: one tile (crown + trunk), 3 crossed quads
function impostorTexture() {
  const W = 128, Hh = 256, [c, ctx] = canvas(W, Hh), rng = mkRng(404);
  const cx = W / 2, crownTop = 8, crownBot = Hh * 0.7, cyy = (crownTop + crownBot) / 2, rx = W * 0.47, ry = (crownBot - crownTop) / 2;
  ctx.fillStyle = '#d8d4c8'; ctx.fillRect(cx - 2.5, crownBot - 40, 5, Hh - crownBot + 40); // pale birch trunk
  for (let k = 0; k < 1100; k++) {
    const a = rng() * 6.283, rr = Math.pow(rng(), 0.85), shape = 1 - 0.35 * Math.pow((rr * Math.sin(a)) , 2) * 0, px = cx + Math.cos(a) * rx * rr * shape, py = cyy + Math.sin(a) * ry * rr;
    const light = 17 + (1 - (py - crownTop) / (crownBot - crownTop)) * 20 + rng() * 9, s = 2.2 + rng() * 3.6;
    ctx.fillStyle = `hsl(${72 + rng() * 28},${30 + rng() * 14}%,${light}%)`; ctx.beginPath(); ctx.ellipse(px, py, s, s * 0.8, rng() * 3, 0, 7); ctx.fill();
  }
  const t = canvasTex(c, { aniso: 4 }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function impostorGeo() {
  const g = new THREE.BufferGeometry(), pos = [], nor = [], uv = [], idx = []; let n = 0;
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
    for (const [x, y, u, v] of [[-0.5, 0, 0, 0], [0.5, 0, 1, 0], [0.5, 1, 1, 1], [-0.5, 1, 0, 1]]) { pos.push(x * c, y, x * s); const nn = norm3([x * 0.9 * c, 0.5 + y * 0.6, x * 0.9 * s]); nor.push(nn[0], nn[1], nn[2]); uv.push(u, v); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const col = new Float32Array((pos.length / 3) * 3); for (let i = 0; i < pos.length / 3; i++) { const sh = 0.7 + 0.3 * pos[i * 3 + 1]; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = sh; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}

// ------------------------------------------------------------------ tree model (public/props/trees.glb, built by tools/build-tree.mjs from tree_animate.glb)
// 3 birch-like variants x 2 LODs (near ~2k tris / mid ~0.5k tris), one atlas material.
async function loadTreeModel(mat) {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const [gltf, meta] = await Promise.all([loader.loadAsync('/props/trees.glb'), fetch('/props/trees.json').then(r => r.json())]);
  const vars = meta.variants.map(v => ({ H: v.H, R: v.R, lod: [null, null] }));
  gltf.scene.traverse(o => {
    if (!o.isMesh) return; const m = /^v(\d+)_lod(\d+)$/.exec(o.name); if (!m) return;
    if (!mat.map) { mat.map = o.material.map; mat.map.anisotropy = quality.anisotropy; mat.needsUpdate = true; }
    vars[+m[1]].lod[+m[2]] = o.geometry;
  });
  return vars;
}

// ------------------------------------------------------------------ bushes
function buildBush(kind) {
  const rng = mkRng(900 + kind);
  const lobes = kind === 1 ? [{ c: [0, 0.5, 0], r: [0.62, 0.55, 0.95] }] : kind === 2 ? [{ c: [0, 0.9, 0], r: [0.55, 0.9, 0.55] }] : [{ c: [0, 0.5, 0], r: [0.9, 0.55, 0.9] }, { c: [0.45, 0.38, 0.3], r: [0.5, 0.38, 0.5] }];
  const near = new GeoBuilder(), far = new GeoBuilder();
  for (const L of lobes) lump(near, L.c, [L.r[0] * 0.85, L.r[1] * 0.85, L.r[2] * 0.85], kind === 2 ? CORECONIF : CORE2, rng, 1, 0.12, 0.3);
  cards(near, lobes, kind === 1 ? 14 : 18, 0.95, rng, { H: 1.2, centre: [0, 0.5, 0] });
  for (const L of lobes) lump(far, L.c, L.r, kind === 2 ? lin('#12361f') : lin('#2d5a28'), rng, 0, 0.12, 0.4);
  return { near: near.build(), far: far.build() };
}

// ------------------------------------------------------------------ build
export async function buildVegetation({ scene, H, data }) {
  const mats = makeMats(), td = quality.treeDetail, ps = quality.propScale;
  const group = new THREE.Group(); group.name = 'vegetation'; scene.add(group);
  const families = [];
  const mk = (geo, mat, n, colArr, map) => { const im = instanced(geo, mat, n, !!colArr); if (colArr) map.set(im, colArr); group.add(track(im)); return im; };
  // ---- trees: every placed tree is one of the 3 model variants, scaled to its data height / crown radius
  const treeMat = patchFoliage(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true }), { flutter: 1, warm: 1, sway: true, swayK: 0.0013 });
  const vars = await loadTreeModel(treeMat), NV = vars.length;
  const tr = data.trees, N = tr.length / 7, byVar = vars.map(() => []);
  const keepTree = i => { const rad = tr[i * 7 + 3]; if (rad >= 3.2) return true; return ((Math.imul(i, 2654435761) >>> 8) & 0xffff) / 65536 < Math.max(ps, 0.45); };
  for (let i = 0; i < N; i++) if (keepTree(i)) byVar[Math.min(NV - 1, Math.floor(((tr[i * 7 + 6] * 37.7) % 1) * NV))].push(i);
  const D0 = td >= 2 ? 62 : td === 1 ? 38 : 0, D1 = td >= 2 ? 165 : td === 1 ? 130 : 95, DF = td >= 2 ? 1300 : td === 1 ? 950 : 650;
  const impM = new Float32Array(N * 16), impC = new Float32Array(N * 3), keepSet = new Uint8Array(N);
  vars.forEach((V, vi) => {
    const idxs = byVar[vi], n = idxs.length; if (!n) return;
    const m = new Float32Array(n * 16), lc = new Float32Array(n * 3), Rc = V.R * 0.62;
    idxs.forEach((src, k) => {
      const x = tr[src * 7], z = tr[src * 7 + 1], rad = tr[src * 7 + 3], h = tr[src * 7 + 4], rot = tr[src * 7 + 5], t = tr[src * 7 + 6];
      const sy = clamp(h / V.H, 0.45, 1.6), sxz = clamp(rad / Rc, sy * 0.5, sy * 1.5), y = H(x, z) + 0.02;
      composeInto(m, k, x, y, z, rot, sxz, sy, sxz);
      let c; if (t > 0.9) c = [1.2, 1.1, 0.62]; else if (t > 0.82) c = [1.05, 1.08, 0.72]; else if (t < 0.12) c = [0.72, 0.86, 0.76]; else { const vv = 0.84 + t * 0.28; c = [vv * 0.98, vv, vv * 0.92]; }
      lc.set(c, k * 3); impC.set(c, src * 3); keepSet[src] = 1;
      composeInto(impM, src, x, y, z, rot, V.R * 1.7 * sxz, V.H * sy, V.R * 1.7 * sxz);
    });
    const cm = new Map(), levels = [];
    if (D0 > 0) levels.push({ dist: D0, meshes: [mk(V.lod[0], treeMat, n, lc, cm)] });
    levels.push({ dist: D1, meshes: [mk(V.lod[1], treeMat, n, lc, cm)] });
    families.push(new CellFamily({ n, m, levels, itemColors: cm, radius: V.R * 1.3, mid: V.H * 0.55, scale: quality.lodScale, minMove: 2, name: 'tree' + vi }));
  });
  // crossed-quad impostors for every tree beyond the mid level
  {
    const geo = impostorGeo();
    const mat = patchFoliage(new THREE.MeshStandardMaterial({ map: impostorTexture(), vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), { flutter: 0, warm: 0.8, sway: false });
    mat.customProgramCacheKey = () => 'impostor';
    const cm = new Map(), im = mk(geo, mat, N, impC, cm);
    families.push(new CellFamily({ n: N, m: impM, levels: [{ dist: D1, meshes: [] }, { dist: DF, meshes: [im] }], itemColors: cm, radius: 11, mid: 6, scale: quality.lodScale, keep: i => keepSet[i] === 1, minMove: 6, name: 'impostors' }));
  }
  // ---- bushes / hedges
  {
    const bu = data.bushes, nb = bu.length / 6, kinds = [[], [], []];
    for (let i = 0; i < nb; i++) { const k = bu[i * 6 + 2]; if (k === 1 || ((Math.imul(i, 2246822519) >>> 8) & 0xffff) / 65536 < Math.max(ps, 0.5)) kinds[k].push(i); }
    const BN = td >= 2 ? 48 : td === 1 ? 32 : 22, BF = td >= 2 ? 300 : td === 1 ? 240 : 150;
    kinds.forEach((idxs, kind) => {
      const n = idxs.length; if (!n) return; const g = buildBush(kind), m = new Float32Array(n * 16), lc = new Float32Array(n * 3);
      idxs.forEach((src, k) => {
        const x = bu[src * 6], z = bu[src * 6 + 1], r = bu[src * 6 + 3], rot = bu[src * 6 + 4], t = bu[src * 6 + 5];
        const s = kind === 1 ? 1 : r; composeInto(m, k, x, H(x, z) + 0.02, z, rot, kind === 1 ? 1.1 : s, kind === 1 ? 0.9 + t * 0.5 : s * (0.9 + t * 0.3), kind === 1 ? 1.15 : s);
        const v = 0.8 + t * 0.4; lc.set([v, v * (1 + (t - 0.5) * 0.15), v * 0.9], k * 3);
      });
      const lm = mats.leaf[kind === 2 ? 4 : kind === 1 ? 1 : 2], cm = new Map();
      families.push(new CellFamily({ n, m, levels: [{ dist: BN, meshes: [mk(g.near, lm, n, lc, cm)] }, { dist: BF, meshes: [mk(g.far, lm, n, lc, cm)] }], itemColors: cm, radius: 1.6, mid: 0.6, scale: quality.lodScale, minMove: 2, name: 'bush' + kind }));
    });
  }
  // ---- flower beds (domes with blossom texture), culled by the cell frustum
  {
    const fl = data.flowers, nf = fl.length / 6; const base = flowerTexture();
    for (let pal = 0; pal < 4; pal++) {
      const idxs = []; for (let i = 0; i < nf; i++) if (fl[i * 6 + 5] === pal) idxs.push(i); if (!idxs.length) continue;
      const t = base.clone(); t.repeat.set(0.5, 0.5); t.offset.set((pal % 2) * 0.5, 0.5 - Math.floor(pal / 2) * 0.5); t.needsUpdate = true;
      const geo = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2); const pa = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < pa.count; i++) uv.setXY(i, pa.getX(i) * 1.2 + 0.5, pa.getZ(i) * 1.2 + 0.5);
      const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(0.32, 0.3, 0.3), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const im = instanced(geo, mat, idxs.length), d = new Float32Array(idxs.length * 16); group.add(track(im));
      idxs.forEach((src, k) => { const x = fl[src * 6], z = fl[src * 6 + 1], rx = Math.max(0.8, fl[src * 6 + 2]), rz = Math.max(0.8, fl[src * 6 + 3]), rot = fl[src * 6 + 4]; composeInto(d, k, x, H(x, z) + 0.04, z, -rot, rx * 0.92, 0.28 + Math.min(rx, rz) * 0.05, rz * 0.92); });
      families.push(new CellFamily({ n: idxs.length, m: d, levels: [{ dist: 420, meshes: [im] }], radius: 10, mid: 0.5, scale: quality.lodScale, minMove: 4, name: 'flowers' + pal }));
    }
  }
  families.forEach(f => f.update(true));
  return {
    update(dt, camera, time) { uTime.value = time; for (const f of families) f.update(); },
    families, stats() { return families.map(f => ({ name: f.name, counts: f.counts, cells: f.cells.length })); },
  };
}
