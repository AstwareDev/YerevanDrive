import fs from 'node:fs';
import { project } from '../tools/config.mjs';
const osm = JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const RANK={trunk:8,trunk_link:6,primary:7,primary_link:5,secondary:6,secondary_link:4,tertiary:5,tertiary_link:3,residential:4,unclassified:4,living_street:3};
const ways = osm.elements.filter(e=>e.type==='way'&&e.tags&&RANK[e.tags.highway]>=4&&e.geometry&&!(e.tags.tunnel==='yes'||e.tags.area==='yes'||e.tags.covered==='yes'));
const deg=new Map();
for(const w of ways){w.nodes.forEach((n,i)=>{deg.set(n,(deg.get(n)||0)+((i===0||i===w.nodes.length-1)?1:2))});}
const junc=new Set([...deg].filter(([n,d])=>d!==2).map(x=>x[0]));
console.log('nodes',deg.size,'junctions',junc.size);
let ch=0;
for(const w of ways){let c=0;for(let i=1;i<w.nodes.length;i++){if(junc.has(w.nodes[i]))c++;}ch+=c;}
console.log('edges approx',ch);
