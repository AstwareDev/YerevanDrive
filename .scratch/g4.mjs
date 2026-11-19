import fs from 'node:fs';
import { project } from '../tools/config.mjs';
const osm = JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const w=osm.elements.filter(e=>e.type==='way'&&e.tags&&e.tags.name==='Տիգրան Մեծի պողոտա'&&e.geometry);
for(const x of w){const p=x.geometry.map(g=>project(g.lat,g.lon));console.log(x.id,x.tags.highway,x.tags.oneway,x.tags.bridge,x.tags.layer,x.nodes.length,p[0].map(v=>v|0),p.at(-1).map(v=>v|0),x.nodes[0],x.nodes.at(-1));}
// node sharing check
const cnt=new Map();for(const e of osm.elements)if(e.type==='way'&&e.tags&&e.tags.highway&&e.nodes)for(const n of e.nodes)cnt.set(n,(cnt.get(n)||0)+1);
let sh=0;for(const [n,c] of cnt)if(c>1)sh++;console.log('shared nodes',sh,'of',cnt.size);
