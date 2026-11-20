// headless router check: node tools/test-nav.mjs
import fs from 'fs';
import { Nav, maneuverText, fmtDist, fmtTime } from '../src/nav/data.js';
const nav = new Nav(JSON.parse(fs.readFileSync('public/map/nav.json')));
console.log('nodes', nav.N, 'edges', nav.E);
const pl = JSON.parse(fs.readFileSync('public/map/meta.json')).places;
const from = { x: 12.4, z: -11.1, heading: 0 };
for (const p of pl) {
  const t0 = performance.now(); const r = nav.route(from, p); const dt = performance.now() - t0;
  console.log(`\n== Republic Sq -> ${p.name}: ${r ? fmtDist(r.len) + ' ' + fmtTime(r.time) : 'NO ROUTE'} (${dt.toFixed(0)} ms)`);
  if (r) for (const m of r.maneuvers) console.log('  ', fmtDist(m.s).padStart(7), maneuverText(m));
}
const r = nav.route({ x: -454, z: -3179, heading: 2 }, { x: 12, z: -11 }); console.log('\nreverse', r && fmtDist(r.len), r && r.maneuvers.length);
console.log('streetAt square', nav.streetAt(12.4, -11.1), '|', nav.streetAt(-454, -3179));
