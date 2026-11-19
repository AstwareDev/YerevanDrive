import fs from 'node:fs';import {project} from '../tools/config.mjs';
const osm=JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const w=osm.elements.filter(e=>e.type==='way'&&e.tags&&e.tags.name==='Մեսրոպ Մաշտոցի պողոտա'&&e.geometry);
for(const x of w){const p=x.geometry.map(g=>project(g.lat,g.lon));console.log(x.id,x.tags.highway,x.tags.oneway,x.tags.tunnel,x.tags.bridge,x.tags.layer,x.nodes.length,p[0].map(v=>v|0),p.at(-1).map(v=>v|0));}
