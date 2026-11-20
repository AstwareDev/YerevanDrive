// Usage: node tools/inspect-glb.mjs <path.glb>   — report meshes/tris/materials/textures/anims/bounds
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
console.log('extensionsUsed', root.listExtensionsUsed().map(e => e.extensionName));
let totTri = 0;
for (const m of root.listMeshes()) {
  for (const p of m.listPrimitives()) {
    const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
    const tri = idx ? idx.getCount() / 3 : pos.getCount() / 3; totTri += tri;
    console.log('mesh', m.getName(), 'verts', pos.getCount(), 'tris', tri, 'attrs', p.listSemantics().join(','), 'mat', p.getMaterial()?.getName(), 'targets', p.listTargets().length);
  }
}
console.log('total tris', totTri);
for (const m of root.listMaterials()) console.log('material', m.getName(), 'alphaMode', m.getAlphaMode(), 'doubleSided', m.getDoubleSided(), 'base', m.getBaseColorFactor(), 'tex', !!m.getBaseColorTexture(), 'normal', !!m.getNormalTexture(), 'mr', !!m.getMetallicRoughnessTexture());
for (const t of root.listTextures()) console.log('texture', t.getName(), t.getMimeType(), t.getSize(), t.getImage()?.byteLength);
for (const a of root.listAnimations()) console.log('anim', a.getName(), 'channels', a.listChannels().length, 'paths', [...new Set(a.listChannels().map(c => c.getTargetPath()))]);
console.log('skins', root.listSkins().length, 'nodes', root.listNodes().length);
const scene = root.getDefaultScene() || root.listScenes()[0];
console.log('bounds', JSON.stringify(getBounds(scene)));
console.log('nodes:', root.listNodes().slice(0, 30).map(n => n.getName() + (n.getMesh() ? '[M]' : '') + (n.getSkin() ? '[S]' : '')).join(', '));
for (const n of root.listNodes()) console.log('node', n.getName(), 'T', n.getTranslation().map(v=>+v.toFixed(2)), 'R', n.getRotation().map(v=>+v.toFixed(3)), 'S', n.getScale().map(v=>+v.toFixed(3)), 'mesh', n.getMesh()?.getName());
for (const m of root.listMaterials()) {
  const sg = m.getExtension('KHR_materials_pbrSpecularGlossiness');
  console.log(m.getName(), 'SG', sg ? { diffuse: sg.getDiffuseFactor(), dtex: sg.getDiffuseTexture() && root.listTextures().indexOf(sg.getDiffuseTexture()), stex: sg.getSpecularGlossinessTexture() && root.listTextures().indexOf(sg.getSpecularGlossinessTexture()) } : null, 'normalTex', root.listTextures().indexOf(m.getNormalTexture()), 'occ', root.listTextures().indexOf(m.getOcclusionTexture()), 'emis', root.listTextures().indexOf(m.getEmissiveTexture()), 'cutoff', m.getAlphaCutoff());
}
for (const a of root.listAnimations()) for (const s of a.listSamplers()) console.log('sampler in', s.getInput().getCount(), 'time', s.getInput().getMin([0]), s.getInput().getMax([0]), 'out', s.getOutput().getCount());
