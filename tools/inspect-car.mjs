// Usage: node tools/inspect-car.mjs <car.glb> [maxDepth=6]  — node tree with per-subtree triangle counts + world bounds, materials, textures.
// Meant for untrusted car downloads (reads only, never executes anything from the file).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const file = process.argv[2], maxDepth = +(process.argv[3] ?? 6);
if (!file) { console.error('usage: node tools/inspect-car.mjs <car.glb> [maxDepth]'); process.exit(1); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file), root = doc.getRoot();
console.log(file, (fs.statSync(file).size / 1e6).toFixed(1) + ' MB', 'extensions', root.listExtensionsUsed().map(e => e.extensionName).join(','));
const tri = m => { let t = 0; for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; return t; };
const sub = n => { let t = n.getMesh() ? tri(n.getMesh()) : 0; for (const c of n.listChildren()) t += sub(c); return t; };
const f = v => v.map(x => +x.toFixed(2)).join(',');
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const sb = getBounds(scene); console.log('scene bounds min', f(sb.min), 'max', f(sb.max), 'size', f(sb.max.map((v, i) => v - sb.min[i])), 'totalTris', Math.round(root.listMeshes().reduce((a, m) => a + tri(m), 0)), 'nodes', root.listNodes().length, 'skins', root.listSkins().length, 'anims', root.listAnimations().length);
function walk(n, d) {
  if (d > maxDepth) return;
  let b = ''; try { const bb = getBounds(n); if (isFinite(bb.min[0])) b = ` min(${f(bb.min)}) max(${f(bb.max)})`; } catch { /* empty */ }
  const m = n.getMesh();
  console.log('  '.repeat(d) + `${n.getName()}${m ? ' [mesh ' + m.listPrimitives().map(p => p.getMaterial()?.getName()).join('|') + ']' : ''} tris=${Math.round(sub(n))}${n.getSkin() ? ' SKIN' : ''} T(${f(n.getTranslation())}) S(${f(n.getScale())}) R(${f(n.getRotation())})${b}`);
  for (const c of n.listChildren()) walk(c, d + 1);
}
for (const n of scene.listChildren()) walk(n, 0);
console.log('\nMATERIALS');
for (const m of root.listMaterials()) console.log(' ', m.getName(), m.getAlphaMode(), 'base', f(m.getBaseColorFactor()), 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), 'emis', f(m.getEmissiveFactor()), 'ds', m.getDoubleSided(), 'tex[base,mr,n,emis,occ]', [m.getBaseColorTexture(), m.getMetallicRoughnessTexture(), m.getNormalTexture(), m.getEmissiveTexture(), m.getOcclusionTexture()].map(t => t ? root.listTextures().indexOf(t) : '-').join(','), 'ext', m.listExtensions().map(e => e.extensionName).join(','));
console.log('\nTEXTURES');
root.listTextures().forEach((t, i) => console.log(' ', i, t.getName(), t.getMimeType(), t.getSize()?.join('x'), ((t.getImage()?.byteLength ?? 0) / 1e3).toFixed(0) + ' kB'));
