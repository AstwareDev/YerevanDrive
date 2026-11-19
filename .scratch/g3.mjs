import fs from 'node:fs';
import { project } from '../tools/config.mjs';
const osm = JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const RANK={trunk:8,trunk_link:6,primary:7,primary_link:5,secondary:6,secondary_link:4,tertiary:5,tertiary_link:3,residential:4,unclassified:4,living_street:3};
const R=99999;
const ways = osm.elements.filter(e=>e.type==='way'&&e.tags&&RANK[e.tags.highway]>=4&&e.geometry&&!(e.tags.tunnel==='yes'||e.tags.area==='yes'||e.tags.covered==='yes'));
const deg=new Map();
for(const w of ways){w.nodes.forEach((n,i)=>{deg.set(n,(deg.get(n)||0)+((i===0||i===w.nodes.length-1)?1:2))});}
const junc=n=>deg.get(n)!==2;
const edges=[];
for(const w of ways){const P=w.geometry.map(g=>project(g.lat,g.lon));let st=0;for(let i=1;i<w.nodes.length;i++){if(junc(w.nodes[i])){const pts=P.slice(st,i+1);if(w.nodes[st]!==w.nodes[i]&&pts.length>1)edges.push({a:w.nodes[st],b:w.nodes[i],pts,name:w.tags.name,hw:w.tags.highway});st=i;}}}
// prune
let changed=true;let E=edges;
while(changed){changed=false;const d=new Map();for(const e of E){d.set(e.a,(d.get(e.a)||0)+1);d.set(e.b,(d.get(e.b)||0)+1);}const E2=E.filter(e=>d.get(e.a)>1&&d.get(e.b)>1);if(E2.length!==E.length){changed=true;E=E2;}}
const ids=[...new Set(E.flatMap(e=>[e.a,e.b]))];const idx=new Map(ids.map((n,i)=>[n,i]));
console.log('nodes',ids.length,'edges',E.length);
const len=p=>{let s=0;for(let i=1;i<p.length;i++)s+=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);return s};
E.forEach(e=>{e.len=len(e.pts);e.ia=idx.get(e.a);e.ib=idx.get(e.b)});
const adj=ids.map(()=>[]);E.forEach((e,i)=>{adj[e.ia].push({e:i,to:e.ib,rev:false});adj[e.ib].push({e:i,to:e.ia,rev:true});});
let count=0,visited=0;const MAXL=3000,MINL=1500;
function dij(s){const d=new Array(ids.length).fill(1e9);d[s]=0;const q=[s];const done=new Set();while(q.length){q.sort((a,b)=>d[b]-d[a]);const u=q.pop();if(done.has(u))continue;done.add(u);for(const a of adj[u]){const nd=d[u]+E[a.e].len;if(nd<d[a.to]){d[a.to]=nd;q.push(a.to);}}}return d;}
const t0=Date.now();
for(let s=0;s<ids.length;s++){const d=dij(s);const onp=new Uint8Array(ids.length);onp[s]=1;
 const rec=(u,L,depth,ule)=>{visited++;if(visited>5e6)return;for(const a of adj[u]){if(a.e===ule)continue;const nl=L+E[a.e].len;if(a.to===s){if(nl>=MINL&&nl<=MAXL&&depth>=2)count++;continue;}if(a.to<s||onp[a.to])continue;if(nl+d[a.to]>MAXL)continue;onp[a.to]=1;rec(a.to,nl,depth+1,a.e);onp[a.to]=0;}};
 rec(s,0,0,-1);}
console.log('cycles(x2)',count,'visited',visited,Date.now()-t0,'ms');
// components
const comp=new Array(ids.length).fill(-1);let nc=0;for(let i=0;i<ids.length;i++){if(comp[i]>=0)continue;const st=[i];comp[i]=nc;while(st.length){const u=st.pop();for(const a of adj[u])if(comp[a.to]<0){comp[a.to]=nc;st.push(a.to)}}nc++}
console.log('components',nc,[...Array(nc).keys()].map(c=>comp.filter(x=>x===c).length));
const dd=ids.map((_,i)=>adj[i].length);const h={};dd.forEach(d=>h[d]=(h[d]||0)+1);console.log('deg hist',h);
import sharp from 'sharp';
const S=0.5,RR=1100,W=2*RR*S;let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#111"/>`;
const cols=['#f55','#5f5','#59f','#ff5','#f5f','#5ff','#fa5'];
E.forEach(e=>{svg+=`<polyline fill="none" stroke="${cols[comp[e.ia]%7]}" stroke-width="2" points="${e.pts.map(q=>((q[0]+RR)*S).toFixed(1)+','+((q[1]+RR)*S).toFixed(1)).join(' ')}"/>`});
ids.forEach((n,i)=>{const e=E.find(e=>e.ia===i||e.ib===i);const p=e.ia===i?e.pts[0]:e.pts.at(-1);svg+=`<circle cx="${(p[0]+RR)*S}" cy="${(p[1]+RR)*S}" r="3" fill="#fff"/>`});
svg+='</svg>';await sharp(Buffer.from(svg)).png().toFile('.scratch/comps.png');
console.log('--- edges near x~90');
for(const e of E){const m=e.pts[Math.floor(e.pts.length/2)];if(Math.abs(m[0]-90)<30&&m[1]>150&&m[1]<520)console.log(e.name,e.hw,e.pts[0].map(v=>v|0),e.pts.at(-1).map(v=>v|0),e.len|0,comp[e.ia]);}
