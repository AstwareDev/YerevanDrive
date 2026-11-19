import fs from 'node:fs';
import { project } from '../tools/config.mjs';
const osm = JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const ok = new Set(['trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','living_street']);
const ways = osm.elements.filter(e=>e.type==='way'&&e.tags&&ok.has(e.tags.highway)&&e.geometry&&!(e.tags.tunnel==='yes'||e.tags.area==='yes'));
console.log(ways.length);
const by={};
for(const w of ways){const k=(w.tags.name||'-')+'|'+w.tags.highway+(w.tags.junction?'|'+w.tags.junction:'')+(w.tags.oneway?'|ow':'');by[k]=(by[k]||0)+1;}
const rows=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,60);console.log(rows.map(r=>r.join(' ')).join('\n'));
const rb=ways.filter(w=>w.tags.junction==='roundabout'||w.tags.junction==='circular');
for(const w of rb){const p=w.geometry.map(g=>project(g.lat,g.lon));const c=p.reduce((s,q)=>[s[0]+q[0]/p.length,s[1]+q[1]/p.length],[0,0]);console.log('RB',w.id,w.tags.name,w.tags.highway,p.length,c.map(v=>v.toFixed(0)),w.nodes[0]===w.nodes.at(-1))}
