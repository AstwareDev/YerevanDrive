import fs from 'node:fs';
import sharp from 'sharp';
import { project } from '../tools/config.mjs';
const osm = JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const RANK={trunk:8,trunk_link:6,primary:7,primary_link:5,secondary:6,secondary_link:4,tertiary:5,tertiary_link:3,residential:4,unclassified:4,living_street:3};
const ways = osm.elements.filter(e=>e.type==='way'&&e.tags&&RANK[e.tags.highway]&&e.geometry&&!(e.tags.tunnel==='yes'||e.tags.area==='yes'||e.tags.covered==='yes'));
const deg=new Map();for(const w of ways)for(const n of w.nodes)deg.set(n,(deg.get(n)||0)+1);
const S=0.5,R=1100,W=2*R*S;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#111"/>`;
const tx=x=>(x+R)*S, tz=z=>(z+R)*S;
const col={8:'#f55',7:'#f95',6:'#fd5',5:'#9d5',4:'#6cf',3:'#888'};
for(const w of ways){const p=w.geometry.map(g=>project(g.lat,g.lon));svg+=`<polyline fill="none" stroke="${col[RANK[w.tags.highway]]}" stroke-width="${RANK[w.tags.highway]>5?3:1.5}" points="${p.map(q=>tx(q[0]).toFixed(1)+','+tz(q[1]).toFixed(1)).join(' ')}"/>`;}
for(let g=-1000;g<=1000;g+=250){svg+=`<line x1="${tx(g)}" y1="0" x2="${tx(g)}" y2="${W}" stroke="#333"/><line y1="${tz(g)}" x1="0" y2="${tz(g)}" x2="${W}" stroke="#333"/><text x="${tx(g)+2}" y="10" fill="#888" font-size="10">${g}</text><text y="${tz(g)-2}" x="2" fill="#888" font-size="10">${g}</text>`;}
svg+='</svg>';
await sharp(Buffer.from(svg)).png().toFile('.scratch/graph.png');
