// Usage: node tools/build-tree.mjs <in tree_animate.glb> <out public/props/trees.glb>
// Turns the downloaded 3-tree sketchfab model (18.7k tris, morph-target sway, 9 PNG maps, spec/gloss materials) into a game asset:
//  - 3 variants x 2 LODs (near / mid) as one primitive each, single atlas material (leaf | branch | bark swatch), WebP texture
//  - sway morphs dropped (wind is done in the vertex shader), normals re-baked to a soft spherical crown shading, AO baked into COLOR_0
//  - cards thinned per LOD (kept cards enlarged), bark simplified with meshopt, whole file meshopt-compressed.
import fs from 'fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const [inPath, outPath] = process.argv.slice(2);
const SCALE = 0.2; // sketchfab units -> metres (tallest tree 75 -> 15 m)
const LODS = [
  { leaf: 0.55, leafK: 1.45, branch: 0.5, branchK: 1.2, bark: 330 },
  { leaf: 0.16, leafK: 2.2, branch: 0, branchK: 1, bark: 70, shade: 0.82, jitter: 0.3 },
];
const LEAF_BOOST = 1.1;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(inPath), root = src.getRoot();
const rng = (() => { let s = 12345; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; })();

// ---- read prims into plain arrays
const prims = {};
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  const name = p.getMaterial().getName();
  prims[name] = {
    pos: Float32Array.from(p.getAttribute('POSITION').getArray()), nor: Float32Array.from(p.getAttribute('NORMAL').getArray()),
    uv: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), idx: Uint32Array.from(p.getIndices().getArray()),
  };
}
// ---- trunk bases -> 3 trees (cluster the bark verts at the ground on x)
const bark = prims.Bark, bx = [];
for (let i = 0; i < bark.pos.length / 3; i++) if (bark.pos[i * 3 + 1] < 4) bx.push([bark.pos[i * 3], bark.pos[i * 3 + 2]]);
bx.sort((a, b) => a[0] - b[0]);
const gaps = []; for (let i = 1; i < bx.length; i++) gaps.push([bx[i][0] - bx[i - 1][0], i]); gaps.sort((a, b) => b[0] - a[0]);
const cut = gaps.slice(0, 2).map(g => g[1]).sort((a, b) => a - b), groups = [bx.slice(0, cut[0]), bx.slice(cut[0], cut[1]), bx.slice(cut[1])];
const bases = groups.map(g => [g.reduce((s, v) => s + v[0], 0) / g.length, g.reduce((s, v) => s + v[1], 0) / g.length]);
console.log('tree bases', bases.map(b => b.map(v => +v.toFixed(1))));
const treeOf = x => { let bi = 0, bd = 1e9; bases.forEach((b, i) => { const d = Math.abs(x - b[0]); if (d < bd) { bd = d; bi = i; } }); return bi; };

// ---- connected components of triangles (welded by position)
function components(pr) {
  const key = i => `${Math.round(pr.pos[i * 3] * 50)},${Math.round(pr.pos[i * 3 + 1] * 50)},${Math.round(pr.pos[i * 3 + 2] * 50)}`;
  const nv = pr.pos.length / 3, par = new Int32Array(nv).map((_, i) => i), find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const seen = new Map();
  for (let i = 0; i < nv; i++) { const k = key(i), j = seen.get(k); if (j === undefined) seen.set(k, i); else par[find(i)] = find(j); }
  for (let t = 0; t < pr.idx.length; t += 3) { par[find(pr.idx[t])] = find(pr.idx[t + 1]); par[find(pr.idx[t + 1])] = find(pr.idx[t + 2]); }
  const comps = new Map();
  for (let t = 0; t < pr.idx.length; t += 3) { const r = find(pr.idx[t]); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); }
  return [...comps.values()];
}
const cards = { Leaf: components(prims.Leaf), Branch: components(prims.Branch) };
for (const k in cards) { const sz = cards[k].map(c => c.length).sort((a, b) => a - b); console.log(k, 'components', sz.length, 'tris/card min/med/max', sz[0], sz[sz.length >> 1], sz[sz.length - 1]); }

// ---- per tree geometry
const centroidOf = (pr, tris) => { const c = [0, 0, 0]; for (const t of tris) for (let k = 0; k < 3; k++) { const v = pr.idx[t + k]; c[0] += pr.pos[v * 3]; c[1] += pr.pos[v * 3 + 1]; c[2] += pr.pos[v * 3 + 2]; } return c.map(v => v / (tris.length * 3)); };
const trees = bases.map((b, ti) => {
  let y0 = 1e9; for (let i = 0; i < bark.pos.length / 3; i++) if (treeOf(bark.pos[i * 3]) === ti) y0 = Math.min(y0, bark.pos[i * 3 + 1]);
  const T = (x, y, z) => [(x - b[0]) * SCALE, (y - y0) * SCALE, (z - b[1]) * SCALE];
  const barkTris = []; for (let t = 0; t < bark.idx.length; t += 3) if (treeOf(bark.pos[bark.idx[t] * 3]) === ti) barkTris.push(t);
  const mine = {}; let H = 0, R = 0, ymin = 1e9;
  for (const k in cards) mine[k] = cards[k].filter(c => treeOf(centroidOf(prims[k], c)[0]) === ti);
  for (const c of mine.Leaf) for (const t of c) for (let k = 0; k < 3; k++) { const v = prims.Leaf.idx[t + k], p = T(...prims.Leaf.pos.subarray(v * 3, v * 3 + 3)); H = Math.max(H, p[1]); R = Math.max(R, Math.hypot(p[0], p[2])); ymin = Math.min(ymin, p[1]); }
  console.log(`tree ${ti}: leaf cards ${mine.Leaf.length} branch cards ${mine.Branch.length} bark tris ${barkTris.length} H ${H.toFixed(2)} Rmax ${R.toFixed(2)} crownBase ${ymin.toFixed(2)}`);
  return { ti, T, barkTris, mine, H, R, ymin };
});

// ---- bark mean colour + atlas (leaf 512 | branch 256 | bark swatch 64)
const barkStats = await sharp(root.listTextures()[0].getImage()).stats();
const bk = barkStats.channels.slice(0, 3).map(c => Math.min(255, Math.round((c.mean * 0.5 + 100) * 1.1))); // lighter, greyer birch-ish bark
const tex = i => root.listTextures()[i].getImage();
const lift = i => i.modulate({ brightness: 1.8, saturation: 1.15 }); // source leaves are very dark olive
const leafImg = await lift(sharp(tex(3)).resize(512, 512, { kernel: 'lanczos3' })).ensureAlpha().raw().toBuffer();
const brImg = await lift(sharp(tex(7)).resize(256, 256, { kernel: 'lanczos3' })).ensureAlpha().raw().toBuffer();
// fill RGB of (semi-)transparent texels with the mean opaque colour so filter fringes stay green instead of magenta
const fixFringe = d => { let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } r /= n; g /= n; b /= n; for (let i = 0; i < d.length; i += 4) { const k = Math.min(1, d[i + 3] / 255 * 1.5); d[i] = d[i] * k + r * (1 - k); d[i + 1] = d[i + 1] * k + g * (1 - k); d[i + 2] = d[i + 2] * k + b * (1 - k); } };
fixFringe(leafImg); fixFringe(brImg);
const bkBuf = Buffer.alloc(64 * 64 * 4); for (let i = 0; i < 64 * 64; i++) { bkBuf[i * 4] = bk[0]; bkBuf[i * 4 + 1] = bk[1]; bkBuf[i * 4 + 2] = bk[2]; bkBuf[i * 4 + 3] = 255; }
const atlas = await sharp({ create: { width: 1024, height: 512, channels: 4, background: { r: bk[0], g: bk[1], b: bk[2], alpha: 0 } } })
  .composite([
    { input: leafImg, raw: { width: 512, height: 512, channels: 4 }, left: 0, top: 0 },
    { input: brImg, raw: { width: 256, height: 256, channels: 4 }, left: 512, top: 0 },
    { input: bkBuf, raw: { width: 64, height: 64, channels: 4 }, left: 768, top: 0 }])
  .webp({ quality: 80, alphaQuality: 92, effort: 6 }).toBuffer();
console.log('atlas webp', atlas.length, 'bytes; bark mean', bk);
const cl = v => Math.min(0.995, Math.max(0.005, v));
const uvLeaf = (u, v) => [cl(u) * 0.5, cl(v)];
const uvBr = (u, v) => [0.5 + cl(u) * 0.25, cl(v) * 0.5];
const uvBark = [0.75 + 0.0156, 0.0625];

// ---- build the output document
const out = new Document(); out.createExtension(EXTTextureWebP).setRequired(true); out.createExtension(EXTMeshoptCompression).setRequired(true);
const buf = out.createBuffer();
const mat = out.createMaterial('tree').setDoubleSided(true).setAlphaMode('MASK').setAlphaCutoff(0.4).setRoughnessFactor(0.85).setMetallicFactor(0)
  .setBaseColorTexture(out.createTexture('atlas').setImage(new Uint8Array(atlas)).setMimeType('image/webp'));
const scene = out.createScene('trees'); const meta = { variants: [] };
const totalTris = [0, 0];
for (const tr of trees) {
  const { T, H, R } = tr, cy = H * 0.62, vmeta = { H: +H.toFixed(3), R: +R.toFixed(3), crownBase: +tr.ymin.toFixed(3), lods: [] };
  LODS.forEach((L, li) => {
    const pos = [], nor = [], uv = [], col = [], idx = []; let nv = 0;
    const push = (p, n, u, c) => { pos.push(...p); nor.push(...n); uv.push(...u); col.push(...c); return nv++; };
    // soft shading normal + baked AO for cards
    const cardShade = p => {
      const dx = p[0], dy = (p[1] - cy) * 0.8, dz = p[2], l = Math.hypot(dx, dy, dz) || 1, n = [dx / l * 0.8, dy / l * 0.8 + 0.4, dz / l * 0.8], nl = Math.hypot(...n);
      const rr = Math.min(1, Math.hypot(dx, dz) / R), ao = 0.5 + 0.5 * Math.sqrt(rr) * (0.6 + 0.4 * Math.min(1, p[1] / H));
      return [[n[0] / nl, n[1] / nl, n[2] / nl], ao];
    };
    for (const kind of ['Leaf', 'Branch']) {
      const keep = kind === 'Leaf' ? L.leaf : L.branch, K = kind === 'Leaf' ? L.leafK : L.branchK, pr = prims[kind], uvf = kind === 'Leaf' ? uvLeaf : uvBr;
      if (keep <= 0) continue;
      // stratified thinning: order by crown angle/height then take every k-th so the density stays even
      const list = tr.mine[kind].map(c => ({ c, cen: centroidOf(pr, c) })).sort((a, b) => (Math.atan2(a.cen[2], a.cen[0]) + a.cen[1] * 0.173) - (Math.atan2(b.cen[2], b.cen[0]) + b.cen[1] * 0.173));
      let acc = rng();
      for (const { c, cen } of list) {
        acc += keep; if (acc < 1) continue; acc -= 1;
        const cc = T(...cen), jt = (L.shade ?? 1) * (1 - (L.jitter ?? 0.2) / 2 + rng() * (L.jitter ?? 0.2)), vmap = new Map();
        for (const t of c) for (let k = 0; k < 3; k++) {
          const v = pr.idx[t + k]; let id = vmap.get(v);
          if (id === undefined) {
            const q = T(...pr.pos.subarray(v * 3, v * 3 + 3)), p = [cc[0] + (q[0] - cc[0]) * K, cc[1] + (q[1] - cc[1]) * K, cc[2] + (q[2] - cc[2]) * K];
            const [n, ao] = cardShade(p), s = Math.min(1.1, ao * jt) * (kind === 'Leaf' ? LEAF_BOOST : 1);
            id = push(p, n, uvf(pr.uv[v * 2], pr.uv[v * 2 + 1]), [s, s, s]); vmap.set(v, id);
          }
          idx.push(id);
        }
      }
    }
    // bark: weld by position, simplify to the target
    {
      const vmap = new Map(), lp = [], ln = [], li2 = [];
      const loc = v => { let i = vmap.get(v); if (i === undefined) { i = lp.length / 3; vmap.set(v, i); lp.push(...T(...bark.pos.subarray(v * 3, v * 3 + 3))); ln.push(...bark.nor.subarray(v * 3, v * 3 + 3)); } return i; };
      for (const t of tr.barkTris) for (let k = 0; k < 3; k++) li2.push(loc(bark.idx[t + k]));
      const wk = new Map(), remap = new Int32Array(lp.length / 3), wp = [], wn = [];
      for (let i = 0; i < lp.length / 3; i++) {
        const key = `${Math.round(lp[i * 3] * 400)},${Math.round(lp[i * 3 + 1] * 400)},${Math.round(lp[i * 3 + 2] * 400)}`; let j = wk.get(key);
        if (j === undefined) { j = wp.length / 3; wk.set(key, j); wp.push(lp[i * 3], lp[i * 3 + 1], lp[i * 3 + 2]); wn.push(ln[i * 3], ln[i * 3 + 1], ln[i * 3 + 2]); } remap[i] = j;
      }
      const wi = Uint32Array.from(li2, i => remap[i]);
      const [si] = MeshoptSimplifier.simplify(wi, Float32Array.from(wp), 3, Math.min(wi.length, L.bark * 3), 0.05, ['LockBorder']);
      const used = new Map();
      for (const v of si) {
        let id = used.get(v);
        if (id === undefined) { const sh = 0.85 + 0.15 * Math.min(1, wp[v * 3 + 1] / 3); id = push([wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]], [wn[v * 3], wn[v * 3 + 1], wn[v * 3 + 2]], uvBark, [sh, sh, sh]); used.set(v, id); }
        idx.push(id);
      }
    }
    const acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    const prim = out.createPrimitive().setMaterial(mat).setIndices(acc('SCALAR', new Uint32Array(idx)))
      .setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(nor)))
      .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv))).setAttribute('COLOR_0', acc('VEC3', new Float32Array(col)));
    const mesh = out.createMesh(`v${tr.ti}_lod${li}`).addPrimitive(prim); scene.addChild(out.createNode(mesh.getName()).setMesh(mesh));
    vmeta.lods.push({ tris: idx.length / 3, verts: nv }); totalTris[li] += idx.length / 3;
    console.log(`  v${tr.ti} lod${li}: ${idx.length / 3} tris, ${nv} verts`);
  });
  meta.variants.push(vmeta);
}
// no quantize(): the game reads the geometry directly (no node transforms / normalised attributes) -> plain float streams, meshopt vertex codec only
await out.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
out.getRoot().listExtensionsRequired().find(e => e.extensionName === 'EXT_meshopt_compression').setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.registerExtensions([EXTTextureWebP, EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(outPath, out);
fs.writeFileSync(outPath.replace(/\.glb$/, '.json'), JSON.stringify(meta));
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes; avg tris/lod', totalTris.map(t => Math.round(t / 3)));
