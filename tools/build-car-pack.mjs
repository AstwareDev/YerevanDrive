// Game-ready car pipeline for the garage cars:  node tools/build-car-pack.mjs <mclaren_p1|countach> [report]
//   data/car/<id>/source.glb  ->  public/car/<id>.glb  (+ public/car/<id>.json with the measured wheel layout used for the physics profile)
// Same conventions as the BMW (tools/build-car.mjs): metres, car faces +z, left = +x, y = 0 on the ground, origin x = centre line, z = middle of the wheelbase,
//   steer_XX (yaw pivot at the wheel centre; carries the brake caliper) -> spin_XX (tyre + rim + disc, rolls around x), body paint material named "paint",
//   glass materials contain "glass"/"Window", lights are named "Light_*" with an emissive colour. No skin / transmission / clearcoat / specular (cheap shading).
// Everything is baked to world space first (the sources are Sketchfab exports with odd node transforms and merged wheel meshes), classified, simplified
// per part with meshopt, merged per material, then textures -> webp and the geometry is meshopt-compressed.
import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder, quantize, prune, dedup, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const id = process.argv[2], reportOnly = process.argv[3] === 'report';

// ------------------------------------------------------------------ per-car config.  classify(part) -> one of
//   null (drop) | { g:'body'|'int'|'under', r:ratio } | { w:'tyre'|'rim'|'disc'|'caliper' } (wheel parts: assigned to a wheel by wheelOf)
const re = (...a) => new RegExp(...a);
const CARS = {
  mclaren_p1: {
    length: 4.59, texMax: 512,
    classify(p) {
      const n = p.path, m = p.matName;
      if (/\/g_Susp_ALever/.test(n)) return null;                   // suspension arms / hubs hidden behind the wheels
      if (m === 'Tyre') return { w: 'tyre' }; if (m === 'material') return { w: 'rim' };
      if (m === 'Brake_Disk') return { w: 'disc' }; if (m === 'Brake_Caliper') return { w: 'caliper' };
      if (/^INT_|^IN_|^Mirror$/.test(m) && !/Mirror/.test(m) || /^GEO_(DOOR|STEER)|^CINTURE|^DRS_Tag|^Cylinder/.test(n)) return { g: 'int', r: 0.05 };
      if (/^g_Body_SUB12_Mechanicals/.test(n)) return { g: 'under', r: 0.06 };
      if (m === 'Chrome.003') return { g: 'under', r: 0.08 };
      if (/Carpaint/.test(m)) return { g: 'body', r: 0.2 };
      if (/Windows|Glass/.test(m)) return { g: 'body', r: 0.3 };
      if (/Carbon/.test(m)) return { g: 'body', r: 0.25 };
      if (/Plastics/.test(m)) return { g: 'body', r: 0.2 };
      if (/Matte_Black|Details|Mechanicals/.test(m)) return { g: 'body', r: 0.35 };
      return { g: 'body', r: 0.5 };
    },
    matRename(name) { if (/^Carpaint/.test(name)) return 'paint'; if (name === 'Taillights') return 'Light_tail'; if (name === 'Headlights') return 'Light_head'; if (name === 'Windows' || name === 'Windows_alpha') return 'Window_glass'; if (name === 'Clear_Glass') return 'Clear_glass'; return name; },
    wheelMode: 'cluster',
  },
  countach: {
    length: 4.78, texMax: 512,
    classify(p) {
      const n = p.path, m = p.matName;
      if (/CalliperBadge/.test(m)) return null;
      if (/Calliper/.test(m)) return { w: 'caliper' };
      if (/3DWheel (Front|Rear) [LR]/.test(n)) return { w: 'rim' };
      if (/Engine_Geo/.test(n)) return { g: 'under', r: 0.03 };
      if (/Interior_Geo|SeatBelt/.test(n)) return { g: 'int', r: 0.05 };
      if (/WindowInside/.test(n)) return { g: 'int', r: 0.1 };
      if (/Badge_Geo|ManufacturerPlate/.test(n)) return null;
      if (/Carbon1/.test(m)) return { g: 'body', r: 0.15 };
      if (/Coloured/.test(m)) return { g: 'body', r: 0.2 };
      if (/Paint/.test(m)) return { g: 'body', r: 0.3 };
      if (/LightA/.test(m)) return { g: 'body', r: 0.15 };
      return { g: 'body', r: 0.4 };
    },
    matRename(name) { if (/Paint_Material1$/.test(name)) return 'paint'; if (/Window_Material1$/.test(name)) return 'Window_glass'; if (name === 'red_glass') return 'Light_tail'; if (/LightA_Material1$/.test(name)) return 'Light_head'; return name.replace(/^lLamborghini_CountachLPI8004_2022/, ''); },
    wheelMode: 'node', rimRatio: 0.12,
  },
};
const cfg = CARS[id]; if (!cfg) { console.error('usage: node tools/build-car-pack.mjs <' + Object.keys(CARS).join('|') + '> [report]'); process.exit(1); }
const src = `data/car/${id}/source.glb`, out = `public/car/${id}.glb`;

// ------------------------------------------------------------------ 1. extract every primitive in world space
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src), root = doc.getRoot(), scene = root.listScenes()[0];
const parts = [];
function extract(node, path) {
  const p = path + '/' + node.getName(), mesh = node.getMesh();
  if (mesh) {
    const M = node.getWorldMatrix(), det = M[0] * (M[5] * M[10] - M[6] * M[9]) - M[4] * (M[1] * M[10] - M[2] * M[9]) + M[8] * (M[1] * M[6] - M[2] * M[5]);
    const sc = Math.cbrt(Math.abs(det));
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), U = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
      if (!P || prim.getMode() !== 4) continue;
      const n = P.getCount(), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), e = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        P.getElement(i, e); const x = e[0], y = e[1], z = e[2];
        pos[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]; pos[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; pos[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (N) { N.getElement(i, e); const a = e[0], b = e[1], c = e[2]; let nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c; const l = Math.hypot(nx, ny, nz) || 1; nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l; } else nrm[i * 3 + 1] = 1;
        if (U) { U.getElement(i, e); uv[i * 2] = e[0]; uv[i * 2 + 1] = e[1]; }
      }
      const idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      if (det < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      parts.push({ name: node.getName(), path: p, mat: prim.getMaterial(), matName: prim.getMaterial()?.getName() ?? '', pos, nrm, uv, idx, sc });
    }
  }
  for (const c of node.listChildren()) extract(c, p);
}
for (const n of scene.listChildren()) extract(n, '');
const bbox = (list, f = () => true) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const q of list) { if (!f(q)) continue; for (let i = 0; i < q.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = q.pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; } } return { mn, mx }; };
const f2 = v => v.map(x => +x.toFixed(3)).join(',');
parts.forEach(q => { q.cls = cfg.classify(q); });
const byMat = {};
for (const q of parts) { const k = (q.cls ? Object.entries(q.cls).map(e => e.join('=')).join(';') : 'DROP') + ' | ' + q.matName; const b = bbox([q]); (byMat[k] ??= { tris: 0, mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9], n: 0 }); const o = byMat[k]; o.tris += q.idx.length / 3; o.n++; for (let a = 0; a < 3; a++) { o.mn[a] = Math.min(o.mn[a], b.mn[a]); o.mx[a] = Math.max(o.mx[a], b.mx[a]); } }
const srcTris = parts.reduce((a, q) => a + q.idx.length / 3, 0);
if (reportOnly) { for (const [k, o] of Object.entries(byMat)) console.log(String(o.tris).padStart(7), String(o.n).padStart(4), f2(o.mn), '..', f2(o.mx), k.slice(0, 90)); console.log('source tris', srcTris, 'parts', parts.length); process.exit(0); }

// ------------------------------------------------------------------ 2. orientation + scale (target real length) + origin
const kept = parts.filter(q => q.cls);
let bb = bbox(kept, q => !q.cls.w);
const Lraw = bb.mx[2] - bb.mn[2];
const scale = cfg.length / Lraw;
for (const q of parts) for (let i = 0; i < q.pos.length; i++) q.pos[i] *= scale;
bb = bbox(kept, q => !q.cls.w);

// ------------------------------------------------------------------ 3. wheels
const KEYS = ['FL', 'FR', 'RL', 'RR'];
let centres = {};                         // key -> [x,y,z]
if (cfg.wheelMode === 'node') {
  const nodes = {}; (function w(n) { const m = n.getName().match(/^3DWheel (Front|Rear) ([LR])/); if (m) nodes[(m[1] === 'Front' ? 'F' : 'R') + m[2]] = n; n.listChildren().forEach(w); })(scene.listChildren()[0]);
  for (const k of KEYS) { const wm = nodes[k].getWorldMatrix(); centres[k] = [wm[12] * scale, wm[13] * scale, wm[14] * scale]; }
  for (const q of kept) if (q.cls.w) q.wheel = KEYS.find(k => q.path.includes(`3DWheel ${k[0] === 'F' ? 'Front' : 'Rear'} ${k[1]} `) || q.path.endsWith(`3DWheel ${k[0] === 'F' ? 'Front' : 'Rear'} ${k[1]}`));
} else {
  // cluster the tyre triangles into 4 connected components -> wheel centres; then every wheel-material triangle goes to the nearest centre
  const tyres = kept.filter(q => q.cls.w === 'tyre'), comps = [];
  for (const q of tyres) {
    const key = new Map(), vid = new Uint32Array(q.pos.length / 3); let nid = 0;
    for (let i = 0; i < vid.length; i++) { const k = `${Math.round(q.pos[i * 3] * 2e3)},${Math.round(q.pos[i * 3 + 1] * 2e3)},${Math.round(q.pos[i * 3 + 2] * 2e3)}`; let v = key.get(k); if (v === undefined) key.set(k, v = nid++); vid[i] = v; }
    const par = Int32Array.from({ length: nid }, (_, i) => i), find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    for (let i = 0; i < q.idx.length; i += 3) { const a = find(vid[q.idx[i]]), b = find(vid[q.idx[i + 1]]), c = find(vid[q.idx[i + 2]]); par[b] = a; par[c] = a; }
    const acc = new Map(); for (let i = 0; i < vid.length; i++) { const r = find(vid[i]); let o = acc.get(r); if (!o) acc.set(r, o = { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9], n: 0 }); o.n++; for (let a = 0; a < 3; a++) { const v = q.pos[i * 3 + a]; if (v < o.mn[a]) o.mn[a] = v; if (v > o.mx[a]) o.mx[a] = v; } }
    for (const o of acc.values()) if (o.n > 50) comps.push(o);
  }
  if (comps.length !== 4) console.warn('!! expected 4 tyre components, got', comps.length, comps.map(o => f2(o.mn) + '..' + f2(o.mx)));
  const cs = comps.map(o => o.mn.map((v, a) => (v + o.mx[a]) / 2)), zm = cs.reduce((a, c) => a + c[2], 0) / cs.length;
  for (const c of cs) centres[(c[2] > zm ? 'F' : 'R') + (c[0] > 0 ? 'L' : 'R')] = c;
}
// facing: front wheels must be at +z
if (centres.FL[2] < centres.RL[2]) { for (const q of parts) for (let i = 0; i < q.pos.length; i += 3) { q.pos[i] = -q.pos[i]; q.pos[i + 2] = -q.pos[i + 2]; q.nrm[i] = -q.nrm[i]; q.nrm[i + 2] = -q.nrm[i + 2]; } for (const k of KEYS) { centres[k][0] *= -1; centres[k][2] *= -1; } bb = bbox(kept, q => !q.cls.w); console.log('rotated 180 deg to face +z'); }
if (centres.FL[0] < 0) throw new Error('left/right swapped: FL wheel is at x<0 -> add a mirror step');
// split wheel parts per wheel (cluster mode: per triangle)
const wheelParts = Object.fromEntries(KEYS.map(k => [k, []]));
const bodyExtra = [];
function subset(q, tris) { const used = new Map(), np = [], nn = [], nu = [], ni = []; for (const t of tris) for (let c = 0; c < 3; c++) { const v = q.idx[t * 3 + c]; let u = used.get(v); if (u === undefined) { u = np.length / 3; used.set(v, u); np.push(q.pos[v * 3], q.pos[v * 3 + 1], q.pos[v * 3 + 2]); nn.push(q.nrm[v * 3], q.nrm[v * 3 + 1], q.nrm[v * 3 + 2]); nu.push(q.uv[v * 2], q.uv[v * 2 + 1]); } ni.push(u); } return { ...q, pos: Float32Array.from(np), nrm: Float32Array.from(nn), uv: Float32Array.from(nu), idx: Uint32Array.from(ni) }; }
const Rraw = KEYS.map(k => 0).length; // placeholder to keep linter quiet
for (const q of kept.filter(q => q.cls.w)) {
  if (q.wheel) { wheelParts[q.wheel].push(q); continue; }
  const buckets = Object.fromEntries(KEYS.map(k => [k, []])), rest = [];
  for (let t = 0; t < q.idx.length / 3; t++) {
    let cx = 0, cy = 0, cz = 0; for (let c = 0; c < 3; c++) { const v = q.idx[t * 3 + c]; cx += q.pos[v * 3]; cy += q.pos[v * 3 + 1]; cz += q.pos[v * 3 + 2]; } cx /= 3; cy /= 3; cz /= 3;
    let best = null, bd = 1e9; for (const k of KEYS) { const c = centres[k], d = Math.hypot(cy - c[1], cz - c[2]); if (Math.abs(cx - c[0]) < 0.3 && d < bd) { bd = d; best = k; } }
    if (best && bd < 0.5) buckets[best].push(t); else rest.push(t);
  }
  for (const k of KEYS) if (buckets[k].length) wheelParts[k].push(subset(q, buckets[k]));
  if (rest.length) { const r = subset(q, rest); r.cls = { g: 'under', r: 0.3 }; bodyExtra.push(r); }
}
// wheel radius from the tyres, re-scale every wheel so all four have the same radius (the physics model has a single wheel radius) and sit on y = R
const rad = {}; for (const k of KEYS) { const b = bbox(wheelParts[k].filter(q => q.cls.w && q.cls.w !== 'caliper')); rad[k] = (b.mx[1] - b.mn[1]) / 2; }
const R = KEYS.reduce((a, k) => a + rad[k], 0) / 4;
const groundY = Math.min(...KEYS.map(k => centres[k][1] - rad[k]));
const zMid = (centres.FL[2] + centres.RL[2]) / 2, xMid = (bb.mn[0] + bb.mx[0]) / 2;
const place = (q, k) => {                  // wheel part -> local to the wheel centre (scaled to the common radius)
  const s = R / rad[k], c = centres[k]; for (let i = 0; i < q.pos.length; i += 3) { q.pos[i] = (q.pos[i] - c[0]) * s; q.pos[i + 1] = (q.pos[i + 1] - c[1]) * s; q.pos[i + 2] = (q.pos[i + 2] - c[2]) * s; }
};
for (const k of KEYS) { wheelParts[k].forEach(q => place(q, k)); }
const wheelPos = {}; for (const k of KEYS) wheelPos[k] = [centres[k][0] - xMid, R, centres[k][2] - zMid];
// body parts to car frame
const bodyParts = kept.filter(q => !q.cls.w).concat(bodyExtra);
for (const q of bodyParts) for (let i = 0; i < q.pos.length; i += 3) { q.pos[i] -= xMid; q.pos[i + 1] -= groundY; q.pos[i + 2] -= zMid; }

// ------------------------------------------------------------------ 4. weld + simplify each part
function weldSimplify(q, ratio, wheelPart) {
  const n = q.pos.length / 3, map = new Map(), remap = new Uint32Array(n), keep = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(q.pos[i * 3] * 4e3)},${Math.round(q.pos[i * 3 + 1] * 4e3)},${Math.round(q.pos[i * 3 + 2] * 4e3)},${Math.round(q.nrm[i * 3] * 20)},${Math.round(q.nrm[i * 3 + 1] * 20)},${Math.round(q.nrm[i * 3 + 2] * 20)},${Math.round(q.uv[i * 2] * 2e3)},${Math.round(q.uv[i * 2 + 1] * 2e3)}`;
    let v = map.get(k); if (v === undefined) { v = keep.length; map.set(k, v); keep.push(i); } remap[i] = v;
  }
  let idx = new Uint32Array(q.idx.length); for (let i = 0; i < idx.length; i++) idx[i] = remap[q.idx[i]];
  const m = keep.length, pos = new Float32Array(m * 3), att = new Float32Array(m * 5);
  keep.forEach((o, i) => { pos.set(q.pos.subarray(o * 3, o * 3 + 3), i * 3); att[i * 5] = q.nrm[o * 3]; att[i * 5 + 1] = q.nrm[o * 3 + 1]; att[i * 5 + 2] = q.nrm[o * 3 + 2]; att[i * 5 + 3] = q.uv[o * 2]; att[i * 5 + 4] = q.uv[o * 2 + 1]; });
  // drop degenerate triangles
  const ok = []; for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i] !== idx[i + 2] && idx[i + 1] !== idx[i + 2]) ok.push(idx[i], idx[i + 1], idx[i + 2]); idx = Uint32Array.from(ok);
  if (ratio < 1 && idx.length > 90) {
    const target = Math.max(60, Math.floor(idx.length * ratio / 3) * 3);
    const [ni] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, att, 5, [0.6, 0.6, 0.6, 0.8, 0.8], null, target, wheelPart ? 0.01 : 0.04, ['ErrorAbsolute'].slice(0, 0));
    idx = ni;
  }
  // compact
  const re = new Map(), P = [], N = [], U = []; const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; let u = re.get(v); if (u === undefined) { u = P.length / 3; re.set(v, u); P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(att[v * 5], att[v * 5 + 1], att[v * 5 + 2]); U.push(att[v * 5 + 3], att[v * 5 + 4]); } out[i] = u; }
  return { ...q, pos: Float32Array.from(P), nrm: Float32Array.from(N), uv: Float32Array.from(U), idx: out };
}

// ------------------------------------------------------------------ 5. build the output scene
const buffer = root.listBuffers()[0];
for (const n of scene.listChildren()) n.dispose();
// materials: strip heavy extensions, rename, make light / glass materials behave
const matDone = new Set();
function fixMat(m) {
  if (!m || matDone.has(m)) return; matDone.add(m);
  for (const e of ['KHR_materials_transmission', 'KHR_materials_clearcoat', 'KHR_materials_specular', 'KHR_materials_ior', 'KHR_materials_volume']) { const x = m.getExtension(e); if (x) { m.setExtension(e, null); x.dispose(); } }
  const orig = m.getName(), nm = cfg.matRename(orig); m.setName(nm);
  if (/glass|Window/i.test(nm) && m.getAlphaMode() !== 'BLEND') m.setAlphaMode('BLEND');
  if (/glass|Window/i.test(nm) && /^Light/.test(nm) === false) { const c = m.getBaseColorFactor(); m.setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.35)]); }
  if (/^Light_tail/.test(nm)) m.setAlphaMode('OPAQUE');
  if (orig === 'red_glass') { m.setBaseColorFactor([0.35, 0.02, 0.02, 1]); m.setEmissiveFactor([1, 0.08, 0.05]); m.setBaseColorTexture(null); m.setEmissiveTexture(null); m.setMetallicFactor(0.2).setRoughnessFactor(0.3); }
  if (/^Light_head/.test(nm)) { m.setEmissiveFactor([1, 0.92, 0.8]); }
  if (m.getAlphaMode() === 'BLEND' && !/glass|Window/i.test(nm) && m.getBaseColorFactor()[3] >= 0.99) m.setAlphaMode('MASK').setAlphaCutoff(0.4);
  m.setDoubleSided(false);
}
function makePrims(list) {           // merge parts with equal material into one primitive each
  const g = new Map();
  for (const q of list) { if (!g.has(q.mat)) g.set(q.mat, []); g.get(q.mat).push(q); }
  const prims = [];
  for (const [mat, qs] of g) {
    let nv = 0, ni = 0; for (const q of qs) { nv += q.pos.length / 3; ni += q.idx.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni); let vo = 0, io2 = 0;
    for (const q of qs) { P.set(q.pos, vo * 3); N.set(q.nrm, vo * 3); U.set(q.uv, vo * 2); for (let i = 0; i < q.idx.length; i++) I[io2 + i] = q.idx[i] + vo; vo += q.pos.length / 3; io2 += q.idx.length; }
    fixMat(mat);
    prims.push(doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(U).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? I : Uint16Array.from(I)).setBuffer(buffer)));
  }
  return prims;
}
const meshOf = (name, list) => { const prims = makePrims(list); if (!prims.length) return null; const m = doc.createMesh(name); prims.forEach(p => m.addPrimitive(p)); return m; };
const carNode = doc.createNode('car'); scene.addChild(carNode);
const mergeEq = list => {      // parts with the same material + class become one mesh before simplification (fewer fragments, welds across the seams)
  const g = new Map(); for (const q of list) { const k = (q.mat ? root.listMaterials().indexOf(q.mat) : -1) + JSON.stringify(q.cls); if (!g.has(k)) g.set(k, []); g.get(k).push(q); }
  return [...g.values()].map(qs => { if (qs.length === 1) return qs[0]; let nv = 0, ni = 0; for (const q of qs) { nv += q.pos.length / 3; ni += q.idx.length; } const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni); let vo = 0, io2 = 0; for (const q of qs) { P.set(q.pos, vo * 3); N.set(q.nrm, vo * 3); U.set(q.uv, vo * 2); for (let i = 0; i < q.idx.length; i++) I[io2 + i] = q.idx[i] + vo; vo += q.pos.length / 3; io2 += q.idx.length; } return { ...qs[0], pos: P, nrm: N, uv: U, idx: I }; });
};
const simp = (list, getRatio, wheel) => mergeEq(list).map(q => weldSimplify(q, getRatio(q), wheel));
const body = simp(bodyParts.filter(q => q.cls.g === 'body'), q => q.cls.r), under = simp(bodyParts.filter(q => q.cls.g === 'under'), q => q.cls.r), inter = simp(bodyParts.filter(q => q.cls.g === 'int'), q => q.cls.r);
for (const [nm, list] of [['body', body], ['Underbody', under], ['Interior', inter]]) { const m = meshOf(nm, list); if (m) carNode.addChild(doc.createNode(nm).setMesh(m)); }
const WR = { tyre: 0.5, rim: cfg.rimRatio ?? 0.25, disc: 0.5, caliper: 0.4 };
for (const k of KEYS) {
  const steer = doc.createNode('steer_' + k).setTranslation(wheelPos[k]), spin = doc.createNode('spin_' + k); steer.addChild(spin); carNode.addChild(steer);
  const ws = simp(wheelParts[k], q => WR[q.cls.w] ?? 0.5, true);
  const sm = meshOf('spin_' + k, ws.filter(q => q.cls.w !== 'caliper')), cm = meshOf('caliper_' + k, ws.filter(q => q.cls.w === 'caliper'));
  if (sm) spin.setMesh(sm); if (cm) steer.addChild(doc.createNode('caliper_' + k).setMesh(cm));
}
const trisOf = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? 0) / 3; return Math.round(t); };
await doc.transform(
  prune({ keepAttributes: true }), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.texMax, cfg.texMax], quality: 82 }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  quantize({ pattern: /^(POSITION|NORMAL|TANGENT)$/, quantizePosition: 14, quantizeNormal: 10 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
fs.mkdirSync('public/car', { recursive: true });
await io.write(out, doc);
const fb = getBounds(scene), size = fb.max.map((v, i) => v - fb.min[i]);
const info = { id, length: +size[2].toFixed(3), width: +size[0].toFixed(3), height: +size[1].toFixed(3), bounds: { min: fb.min.map(v => +v.toFixed(3)), max: fb.max.map(v => +v.toFixed(3)) }, R: +R.toFixed(4), wheels: Object.fromEntries(KEYS.map(k => [k, wheelPos[k].map(v => +v.toFixed(3))])), wheelbase: +(centres.FL[2] - centres.RL[2]).toFixed(3), trackF: +(2 * wheelPos.FL[0]).toFixed(3), trackR: +(2 * wheelPos.RL[0]).toFixed(3), tris: trisOf(), sourceTris: srcTris, scale: +scale.toFixed(4) };
fs.writeFileSync(`public/car/${id}.json`, JSON.stringify(info, null, 1));
console.log(info, `\n${out}: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
console.log('materials', root.listMaterials().map(m => m.getName() + ':' + m.getAlphaMode()[0]).join(' '));
