// "Garage / warehouse" (Sketchfab) -> public/garage/warehouse.glb.   node tools/build-garage.mjs [path/to/source.glb]
// Result: metres, y = 0 on the floor, origin x/z = the empty showroom spot in the middle of the hall. Everything stays one mesh per material
// (Demirler = steel, Duvarlar = walls, Odunlar = wood, Tavan = roof, Zemin = floor, ipler = cables).
import fs from 'node:fs';
import { makeIO, bake, finish } from './lib/glbbake.mjs';

const src = process.argv[2] ?? 'data/garage/source.glb', out = 'public/garage/warehouse.glb';
const S = 1 / 42;                               // the model is ~1550 units wide: 7 m wall height -> 42 units per metre (cars are 4.5 m = ~190 units)
const CX = -266, CZ = -170, FLOOR = 12;         // showroom spot (source units): between the two lamp rows, in front of the clutter, floor top at y = 12
const io = await makeIO();
const doc = await io.read(src);
const root = doc.getRoot();
bake(doc, (x, y, z) => [(x - CX) * S, (y - FLOOR) * S, (z - CZ) * S]);
for (const m of root.listMaterials()) {
  console.log('material', m.getName(), 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), 'normal', !!m.getNormalTexture(), 'orm', !!m.getMetallicRoughnessTexture(), 'color', m.getBaseColorFactor().map(v => +v.toFixed(2)));
  m.setDoubleSided(true);
}
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const v = [0, 0, 0];
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } } }
console.log('bounds (m)', mn.map(x => +x.toFixed(2)), mx.map(x => +x.toFixed(2)));
fs.mkdirSync('public/garage', { recursive: true });
await finish(doc, io, out, { texMax: 1024, posBits: 14 });
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
