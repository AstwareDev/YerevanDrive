// SH-60B Seahawk (Sketchfab) -> public/heli/seahawk.glb.   node tools/build-heli.mjs [path/to/source.glb]
// Result: metres, nose +z, left +x, y = 0 under the wheels, origin x/z = the main rotor mast.
//   node "body"          fuselage + tail + landing gear
//   node "rotor_pivot"   at the main rotor hub (spin it around y) -> child "rotor" (blades + hub, offset so the pivot sits on the mast)
// The source mesh is chopped into arbitrary 3333-triangle chunks, so the rotor is separated per TRIANGLE (above the cabin roof, in front of the tail boom).
import fs from 'node:fs';
import { makeIO, bake, subPrim, finish } from './lib/glbbake.mjs';

const src = process.argv[2] ?? 'data/heli/source.glb', out = 'public/heli/seahawk.glb';
const io = await makeIO();
const doc = await io.read(src);
const root = doc.getRoot(), scene = root.listScenes()[0];
const parts = bake(doc, (x, y, z) => [x, y, z]);       // world space, source units
const ROT_Y = 403, ROT_Z = -520;
const srcRotor = (x, y, z) => (y >= ROT_Y && z > ROT_Z) || (y >= 385 && y < 475 && Math.hypot(x, z - 286) > 250 && (Math.abs(x) > 130 || z > -400));                        // rotor = triangles above the cabin roof and in front of the tail boom
let zmin = 1e9, zmax = -1e9, ymin = 1e9;
const hubPts = [];
for (const { prim } of parts) {
  const a = prim.getAttribute('POSITION'), v = [0, 0, 0];
  for (let i = 0; i < a.getCount(); i++) {
    a.getElement(i, v);
    if (!srcRotor(v[0], v[1], v[2])) { zmin = Math.min(zmin, v[2]); zmax = Math.max(zmax, v[2]); ymin = Math.min(ymin, v[1]); }
    else if (Math.hypot(v[0], v[2] - 290) < 45 && v[1] > 425) hubPts.push([...v]);
  }
}
const hx = hubPts.reduce((s, p) => s + p[0], 0) / hubPts.length, hz = hubPts.reduce((s, p) => s + p[2], 0) / hubPts.length;
let hy = 0; for (const p of hubPts) hy = Math.max(hy, p[1]); hy -= 20;
const S = 15.26 / (zmax - zmin);       // SH-60B fuselage length with the blades folded: 15.26 m
console.log({ zmin, zmax, ymin, hub: [hx, hy, hz].map(v => +v.toFixed(1)), scale: S, hubPts: hubPts.length });
const X = (x, y, z) => [(x - hx) * S, (y - ymin) * S, (z - hz) * S];
for (const { prim } of parts) { const a = prim.getAttribute('POSITION'), v = [0, 0, 0], A = new Float32Array(a.getCount() * 3); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); A.set(X(v[0], v[1], v[2]), i * 3); } a.setArray(A); }
const hub = [0, (hy - ymin) * S, 0], ry = (ROT_Y - ymin) * S, rz = (ROT_Z - hz) * S;
for (const n of root.listNodes()) { n.getParentNode()?.removeChild(n); try { scene.removeChild(n); } catch { /* not a root child */ } }
const bodyMesh = doc.createMesh('body'), rotorMesh = doc.createMesh('rotor');
const cen = (pos, a, b, c) => { const v = [0, 0, 0], w = [0, 0, 0], u = [0, 0, 0]; pos.getElement(a, v); pos.getElement(b, w); pos.getElement(c, u); return [(v[1] + w[1] + u[1]) / 3, (v[2] + w[2] + u[2]) / 3]; };
const rotorTri = pos => (a, b, c) => { const v = [0, 0, 0], w = [0, 0, 0], u = [0, 0, 0]; pos.getElement(a, v); pos.getElement(b, w); pos.getElement(c, u); const x = (v[0] + w[0] + u[0]) / 3 / S + hx, y = (v[1] + w[1] + u[1]) / 3 / S + ymin, z = (v[2] + w[2] + u[2]) / 3 / S + hz; return srcRotor(x, y, z); };
let nb = 0, nr = 0;
for (const { prim } of parts) {
  const pos = prim.getAttribute('POSITION'), f = rotorTri(pos);
  const rp = subPrim(doc, prim, f), bp = subPrim(doc, prim, (a, b, c) => !f(a, b, c));
  if (bp) { bodyMesh.addPrimitive(bp); nb += bp.getIndices().getCount() / 3; }
  if (rp) { rotorMesh.addPrimitive(rp); nr += rp.getIndices().getCount() / 3; }
}
console.log('triangles body', nb, 'rotor', nr);
for (const prim of rotorMesh.listPrimitives()) { const a = prim.getAttribute('POSITION'), v = [0, 0, 0], A = new Float32Array(a.getCount() * 3); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); A.set([v[0] - hub[0], v[1] - hub[1], v[2] - hub[2]], i * 3); } a.setArray(A); }
{ let rmax=0,mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],v=[0,0,0]; for (const p of rotorMesh.listPrimitives()) { const a=p.getAttribute('POSITION'); for(let i=0;i<a.getCount();i++){a.getElement(i,v);rmax=Math.max(rmax,Math.hypot(v[0],v[2]));} } for (const p of bodyMesh.listPrimitives()) { const a=p.getAttribute('POSITION'); for(let i=0;i<a.getCount();i++){a.getElement(i,v);for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],v[k]);mx[k]=Math.max(mx[k],v[k]);}} } console.log('rotor radius (m)',+rmax.toFixed(2),'body min',mn.map(x=>+x.toFixed(2)),'max',mx.map(x=>+x.toFixed(2)),'hub',hub.map(x=>+x.toFixed(2))); }
{ const g={},v=[0,0,0]; for (const p of bodyMesh.listPrimitives()) { const a=p.getAttribute('POSITION'); for(let i=0;i<a.getCount();i++){a.getElement(i,v); if(v[1]<0.25){const k=(Math.round(v[0]*2)/2)+','+(Math.round(v[2]*2)/2); g[k]=(g[k]||0)+1;}} } console.log('lowest points (x,z):',JSON.stringify(g)); }
const nBody = doc.createNode('body').setMesh(bodyMesh);
const pivot = doc.createNode('rotor_pivot').setTranslation(hub), nRotor = doc.createNode('rotor').setMesh(rotorMesh);
pivot.addChild(nRotor); scene.addChild(nBody); scene.addChild(pivot);
for (const m of root.listMaterials()) { console.log('material', m.getName(), 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), 'color', m.getBaseColorFactor().map(v => +v.toFixed(2)), 'tex', !!m.getBaseColorTexture(), 'alpha', m.getAlphaMode()); m.setDoubleSided(true); }
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_materials_specular') e.dispose();
fs.mkdirSync('public/heli', { recursive: true });
await finish(doc, io, out, { texMax: 1024, posBits: 14 });
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
