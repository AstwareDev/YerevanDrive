import fs from 'node:fs';
import sharp from 'sharp';
import { project } from '../tools/config.mjs';
const osm = JSON.parse(fs.readFileSync('data/osm.json','utf8'));
const RANK={trunk:8,trunk_link:6,primary:7,primary_link:5,secondary:6,secondary_link:4,tertiary:5,tertiary_link:3,residential:4,unclassified:4,living_street:3};
const R=1000;
const ways = osm.elements.filter(e=>e.type==='way'&&e.tags&&RANK[e.tags.highway]>=4&&e.geometry&&!(e.tags.tunnel==='yes'||e.tags.area==='yes'||e.tags.covered==='yes'));
const segs=[];const nadj=new Map();const npos=new Map();
for(const w of ways){const P=w.geometry.map(g=>project(g.lat,g.lon));for(let i=0;i+1<w.nodes.length;i++){const s={u:w.nodes[i],v:w.nodes[i+1],pts:[P[i],P[i+1]],w,used:false};segs.push(s);for(const n of [s.u,s.v]){if(!nadj.has(n))nadj.set(n,[]);nadj.get(n).push(s);}npos.set(w.nodes[i],P[i]);npos.set(w.nodes[i+1],P[i+1]);}}
let E=[];
const isJ=n=>nadj.get(n).length!==2;
for(const [n,l] of nadj){if(!isJ(n))continue;for(const s0 of l){if(s0.used)continue;let cur=n,s=s0;const pts=[npos.get(n)];const ids=[];while(true){s.used=true;const nxt=s.u===cur?s.v:s.u;pts.push(npos.get(nxt));ids.push(s);cur=nxt;if(isJ(cur))break;const ns=nadj.get(cur).find(x=>x!==s);if(ns.used)break;s=ns;}E.push({a:n,b:cur,pts,segs:ids});}}
console.log('raw edges',E.length);
E=E.filter(e=>e.a!==e.b&&e.pts.every(p=>Math.abs(p[0])<R&&Math.abs(p[1])<R));
let changed=true;
while(changed){changed=false;const d=new Map();for(const e of E){d.set(e.a,(d.get(e.a)||0)+1);d.set(e.b,(d.get(e.b)||0)+1);}const E2=E.filter(e=>d.get(e.a)>1&&d.get(e.b)>1);if(E2.length!==E.length){changed=true;E=E2;}}
const ids=[...new Set(E.flatMap(e=>[e.a,e.b]))];const idx=new Map(ids.map((n,i)=>[n,i]));
console.log('nodes',ids.length,'edges',E.length);
const len=p=>{let s=0;for(let i=1;i<p.length;i++)s+=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);return s};
E.forEach(e=>{e.len=len(e.pts);e.ia=idx.get(e.a);e.ib=idx.get(e.b)});
const adj=ids.map(()=>[]);E.forEach((e,i)=>{adj[e.ia].push({e:i,to:e.ib});adj[e.ib].push({e:i,to:e.ia});});
let count=0,visited=0;const MAXL=3000,MINL=1500;
function dij(s){const d=new Array(ids.length).fill(1e9);d[s]=0;const q=[s];const done=new Set();while(q.length){q.sort((a,b)=>d[b]-d[a]);const u=q.pop();if(done.has(u))continue;done.add(u);for(const a of adj[u]){const nd=d[u]+E[a.e].len;if(nd<d[a.to]){d[a.to]=nd;q.push(a.to);}}}return d;}
const t0=Date.now();
for(let s=0;s<ids.length;s++){const d=dij(s);const onp=new Uint8Array(ids.length);onp[s]=1;
 const rec=(u,L,depth,ule)=>{visited++;if(visited>3e7)return;for(const a of adj[u]){if(a.e===ule)continue;const nl=L+E[a.e].len;if(a.to===s){if(nl>=MINL&&nl<=MAXL&&depth>=2)count++;continue;}if(a.to<s||onp[a.to])continue;if(nl+d[a.to]>MAXL)continue;onp[a.to]=1;rec(a.to,nl,depth+1,a.e);onp[a.to]=0;}};
 rec(s,0,0,-1);}
console.log('cycles(x2)',count,'visited',visited,Date.now()-t0,'ms');
const S=0.5,RR=1100,W=2*RR*S;let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#111"/>`;
E.forEach(e=>{svg+=`<polyline fill="none" stroke="#5af" stroke-width="2" points="${e.pts.map(q=>((q[0]+RR)*S).toFixed(1)+','+((q[1]+RR)*S).toFixed(1)).join(' ')}"/>`});
ids.forEach((n)=>{const p=npos.get(n);svg+=`<circle cx="${(p[0]+RR)*S}" cy="${(p[1]+RR)*S}" r="3" fill="#fff"/>`});
svg+='</svg>';await sharp(Buffer.from(svg)).png().toFile('.scratch/comps.png');
