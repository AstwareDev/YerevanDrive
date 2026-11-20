// Drift-circuit designer. Reads data/osm.json (+ terrain), builds the drivable road graph, enumerates closed loops of
// 1.5-3.0 km, scores them (curvature variety, length, width, elevation, roundabout use ...), picks two contrasting
// circuits, smooths their centrelines (fillets + Catmull-Rom/gaussian, 1 m spacing) and writes public/map/circuits.json.
// Run from the project root:   node tools/build-circuits.mjs            (add --debug to also write .scratch/circuits-debug.png)
// Local frame: x east, y up (0 = Republic Square ground), z south.  heading = atan2(dx, dz)  =>  forward = (sin h, cos h) in (x, z).
// Right-hand normal of forward f=(fx,fz) is (-fz, fx);  signed turn > 0 means a right turn.
import fs from 'node:fs';
import { project, HALF } from './config.mjs';
import { H, mkRng } from './terrain.mjs';

const DEBUG = process.argv.includes('--debug');
const osm = JSON.parse(fs.readFileSync('data/osm.json', 'utf8'));
const num = v => { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = v => +v.toFixed(2);

// ------------------------------------------------------------------ road graph
const ROAD = { // same table as tools/build-map.mjs
  trunk: { w: 14, rank: 8 }, trunk_link: { w: 7, rank: 6 }, primary: { w: 13, rank: 7 }, primary_link: { w: 7, rank: 5 },
  secondary: { w: 10, rank: 6 }, secondary_link: { w: 6, rank: 4 }, tertiary: { w: 8, rank: 5 }, tertiary_link: { w: 5.5, rank: 3 },
  residential: { w: 6.5, rank: 4 }, unclassified: { w: 6, rank: 4 }, living_street: { w: 5, rank: 3 }, service: { w: 3.8, rank: 2 }, track: { w: 3, rank: 1 },
};
const roadWidth = t => { const c = ROAD[t.highway], lanes = num(t.lanes), oneway = t.oneway === 'yes' || t.oneway === '1'; return clamp(num(t.width) ?? (lanes ? lanes * 3.2 + (oneway ? 0.6 : 1.2) : c.w), 3, 30); };
const BOUND = HALF - 10;
const ways = osm.elements.filter(e => e.type === 'way' && e.tags && ROAD[e.tags.highway] && ROAD[e.tags.highway].rank >= 4 && !e.tags.highway.endsWith('_link') && e.geometry &&
  !(e.tags.tunnel === 'yes' || e.tags.area === 'yes' || e.tags.covered === 'yes' || e.tags.bridge === 'yes' && false));
const segs = [], nadj = new Map(), npos = new Map();
for (const w of ways) {
  const P = w.geometry.map(g => project(g.lat, g.lon)), wd = roadWidth(w.tags), ow = w.tags.oneway === 'yes' || w.tags.oneway === '1';
  const rb = w.tags.junction === 'roundabout' || w.tags.junction === 'circular';
  for (let i = 0; i + 1 < w.nodes.length; i++) {
    const s = { u: w.nodes[i], v: w.nodes[i + 1], pts: [P[i], P[i + 1]], wd, ow, rb, name: w.tags.name || '', hw: w.tags.highway, used: false };
    segs.push(s);
    for (const n of [s.u, s.v]) { if (!nadj.has(n)) nadj.set(n, []); nadj.get(n).push(s); }
    npos.set(w.nodes[i], P[i]); npos.set(w.nodes[i + 1], P[i + 1]);
  }
}
let E = [];
const isJ = n => nadj.get(n).length !== 2;
for (const [n, l] of nadj) {
  if (!isJ(n)) continue;
  for (const s0 of l) {
    if (s0.used) continue;
    let cur = n, s = s0; const pts = [npos.get(n)], chain = [], dirs = [], nids = [n];
    for (;;) {
      s.used = true; const fwd = s.u === cur, nxt = fwd ? s.v : s.u;
      pts.push(npos.get(nxt)); nids.push(nxt); chain.push(s); dirs.push(fwd); cur = nxt;
      if (isJ(cur)) break;
      const ns = nadj.get(cur).find(x => x !== s); if (!ns || ns.used) break; s = ns;
    }
    E.push({ a: n, b: cur, pts, chain, dirs, nids });
  }
}
const E_ALL = E.slice();
E = E.filter(e => e.a !== e.b && e.pts.every(p => Math.abs(p[0]) < BOUND && Math.abs(p[1]) < BOUND));
for (let changed = true; changed;) { // prune dead ends
  changed = false; const d = new Map();
  for (const e of E) { d.set(e.a, (d.get(e.a) || 0) + 1); d.set(e.b, (d.get(e.b) || 0) + 1); }
  const E2 = E.filter(e => d.get(e.a) > 1 && d.get(e.b) > 1); if (E2.length !== E.length) { changed = true; E = E2; }
}
const E_PRUNED = E_ALL.filter(e => !E.includes(e));
const nodeIds = [...new Set(E.flatMap(e => [e.a, e.b]))], nodeIdx = new Map(nodeIds.map((n, i) => [n, i]));
const polyLen = p => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; };
const unit2 = (a, b) => { const l = dist(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
function dirAtStart(pts, d = 14) { let s = 0; for (let i = 1; i < pts.length; i++) { s += dist(pts[i - 1], pts[i]); if (s >= d || i === pts.length - 1) return unit2(pts[0], pts[i]); } }
function dirAtEnd(pts, d = 14) { let s = 0; for (let i = pts.length - 1; i > 0; i--) { s += dist(pts[i], pts[i - 1]); if (s >= d || i === 1) return unit2(pts[i - 1], pts[pts.length - 1]); } }
E.forEach((e, i) => {
  e.id = i; e.ia = nodeIdx.get(e.a); e.ib = nodeIdx.get(e.b); e.len = polyLen(e.pts);
  e.dS = dirAtStart(e.pts); e.dE = dirAtEnd(e.pts);
  e.name = e.chain[0].name; e.rbLen = e.chain.reduce((s, c, k) => s + (c.rb ? dist(c.pts[0], c.pts[1]) : 0), 0);
  e.minW = Math.min(...e.chain.map(c => c.wd)); e.avgW = e.chain.reduce((s, c) => s + c.wd * dist(c.pts[0], c.pts[1]), 0) / (e.len || 1);
  e.ow = e.chain.every(c => c.ow); e.owFwd = e.chain.every((c, k) => c.ow && c.dirs === undefined ? true : true);
  // one-way consistency of the chain relative to the a->b direction: +1 forward, -1 reverse, 0 two-way/mixed
  const f = e.chain.filter((c, k) => c.ow && e.dirs[k]).length, r = e.chain.filter((c, k) => c.ow && !e.dirs[k]).length;
  // chain segment direction vs way direction: s.u->s.v is the way's own direction, dirs[k] true means we traverse u->v
  e.flow = f && !r ? 1 : r && !f ? -1 : 0;
  e.curv = 0; // sum of abs heading change along the edge (rad)
  for (let k = 1; k + 1 < e.pts.length; k++) { const a = unit2(e.pts[k - 1], e.pts[k]), b = unit2(e.pts[k], e.pts[k + 1]); e.curv += Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])); }
  e.ha = H(e.pts[0][0], e.pts[0][1]); e.hb = H(e.pts.at(-1)[0], e.pts.at(-1)[1]);
  let mg = 0; for (let k = 1; k < e.pts.length; k++) { const l = dist(e.pts[k - 1], e.pts[k]); if (l > 12) mg = Math.max(mg, Math.abs(H(e.pts[k][0], e.pts[k][1]) - H(e.pts[k - 1][0], e.pts[k - 1][1])) / l); }
  e.maxGrade = mg;
});
const adj = nodeIds.map(() => []);
for (const e of E) { adj[e.ia].push({ e: e.id, to: e.ib, rev: false }); adj[e.ib].push({ e: e.id, to: e.ia, rev: true }); }
const nodePos = nodeIds.map(n => npos.get(n));
console.log(`graph: ${nodeIds.length} junctions, ${E.length} edges, ${(E.reduce((s, e) => s + e.len, 0) / 1000).toFixed(1)} km`);

if (process.env.GRAPHONLY) {
  const sharp = (await import('sharp')).default, S = 0.5, RR = 1100, W = 2 * RR * S; let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + W + '"><rect width="100%" height="100%" fill="#111"/>';
  const ln = (e, c) => '<polyline fill="none" stroke="' + c + '" stroke-width="2" points="' + e.pts.map(q => ((q[0] + RR) * S).toFixed(1) + ',' + ((q[1] + RR) * S).toFixed(1)).join(' ') + '"/>';
  E_PRUNED.forEach(e => svg += ln(e, '#f44')); E.forEach(e => svg += ln(e, '#6cf'));
  svg += '</svg>'; await sharp(Buffer.from(svg)).png().toFile('.scratch/graph-kept.png'); process.exit(0);
}
// ------------------------------------------------------------------ loop enumeration
const MINL = 1500, MAXL = 3000;
const entryDir = (a) => a.rev ? E[a.e].dE.map(v => -v) : E[a.e].dS;       // direction of travel when entering the edge
const exitDir = (a) => a.rev ? E[a.e].dS.map(v => -v) : E[a.e].dE;        // direction of travel when leaving the edge
const turnAng = (d1, d2) => Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]); // + = right
function dijkstra(s) {
  const d = new Array(nodeIds.length).fill(1e9); d[s] = 0; const q = [s], done = new Set();
  while (q.length) { q.sort((a, b) => d[b] - d[a]); const u = q.pop(); if (done.has(u)) continue; done.add(u); for (const a of adj[u]) { const nd = d[u] + E[a.e].len; if (nd < d[a.to]) { d[a.to] = nd; q.push(a.to); } } }
  return d;
}
const cands = [];            // { path: [{e,rev}], pre: {...} }
const BUDGET = +(process.env.BUDGET || 1000000), rng = mkRng(77);
const TURN_MAX = 150 * Math.PI / 180;
let visited = 0, nCycles = 0;
function preFeatures(path) {
  let L = 0, n90 = 0, n45 = 0, sumT = 0, rb = 0, wsum = 0, minW = 99, up = 0, maxG = 0, wrong = 0, curv = 0, longest = 0, hx = 0, hz = 0;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[i], e = E[a.e], b = path[(i + 1) % n];
    L += e.len; rb += e.rbLen; wsum += e.avgW * e.len; minW = Math.min(minW, e.minW); maxG = Math.max(maxG, e.maxGrade); curv += e.curv;
    const t = Math.abs(turnAng(exitDir(a), entryDir(b)));
    if (t > 0.96) n90++; else if (t > 0.5) n45++; sumT += t;
    if (e.flow && (e.flow > 0) === a.rev) wrong += e.len;
    const p = a.rev ? e.pts.at(-1) : e.pts[0]; hx += p[0]; hz += p[1];
  }
  return { L, n90, n45, sumT, rb, avgW: wsum / L, minW, maxG, wrong: wrong / L, curv, cx: hx / n, cz: hz / n };
}
function enumerate() {
  for (let s = 0; s < nodeIds.length; s++) {
    const d = dijkstra(s), onp = new Uint8Array(nodeIds.length); onp[s] = 1;
    const path = []; let spent = 0;
    const order = adj.map(l => l.map((a, i) => [rng(), a]).sort((p, q) => p[0] - q[0]).map(p => p[1]));
    const rec = (u, L, last) => {
      visited++; if (++spent > BUDGET) return;
      for (const a of order[u]) {
        const e = E[a.e]; if (last && a.e === last.e) continue;
        if (last && Math.abs(turnAng(exitDir(last), entryDir(a))) > TURN_MAX) continue;
        const nl = L + e.len;
        if (a.to === s) {
          if (nl >= MINL && nl <= MAXL && path.length >= 2) {
            if (Math.abs(turnAng(exitDir(a), entryDir(path[0]))) > TURN_MAX) continue;
            const full = path.concat([a]); nCycles++;
            if (full[0].e < full.at(-1).e || true) { // each loop is found in both directions; keep the one starting with lower edge id
              if (full[0].e > full.at(-1).e) continue;
              const f = preFeatures(full);
              if (f.minW < 5.9 || f.n90 > 9 || f.maxG > 0.11) continue;
              cands.push({ path: full.map(p => ({ e: p.e, rev: p.rev })), f });
            }
          }
          continue;
        }
        if (a.to < s || onp[a.to] || nl + d[a.to] > MAXL) continue;
        onp[a.to] = 1; path.push(a); rec(a.to, nl, a); path.pop(); onp[a.to] = 0;
      }
    };
    rec(s, 0, null);
  }
}
const CACHE = `.scratch/cands-${BUDGET}.json`, t0 = Date.now();
if (process.env.CACHE && fs.existsSync(CACHE)) { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); cands.push(...c); console.log('candidates from cache', cands.length); }
else { enumerate(); console.log(`enumerated ${nCycles} cycles (${cands.length} pass filters) in ${Date.now() - t0} ms`); if (process.env.CACHE) fs.writeFileSync(CACHE, JSON.stringify(cands)); }

// ------------------------------------------------------------------ smoothing: fillets at corners -> 1 m resample -> gaussian
const pathPolyline = path => {   // oriented path -> raw vertices {x,z,w,j,rb}
  const V = [];
  path.forEach((a, pi) => {
    const e = E[a.e], pts = a.rev ? e.pts.slice().reverse() : e.pts, nids = a.rev ? e.nids.slice().reverse() : e.nids, ch = a.rev ? e.chain.slice().reverse() : e.chain, n = ch.length;
    const wAt = k => (ch[Math.max(0, k - 1)].wd + ch[Math.min(n - 1, k)].wd) / 2;
    const rbAt = k => !!(ch[Math.max(0, k - 1)].rb || ch[Math.min(n - 1, k)].rb);
    for (let k = pi > 0 ? 1 : 0; k < pts.length; k++) {
      if (pi === path.length - 1 && k === pts.length - 1) break; // last vertex == first vertex of path
      V.push({ x: pts[k][0], z: pts[k][1], w: wAt(k), j: k === 0, rb: rbAt(k), edge: pi, nid: nids[k] });
    }
  });
  return V;
};
// Douglas-Peucker on the closed loop (keeps corners, drops tiny bends so fillets get long edges to work with)
function rdpLoop(V, eps = 1.2) {
  const n = V.length; if (n < 8) return V;
  let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = Math.hypot(V[i].x - V[0].x, V[i].z - V[0].z); if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  const rec = (a, b) => { // indices a..b (a<b) on the open polyline V[a..b]
    let md = 0, mi = -1; const ax = V[a].x, az = V[a].z, bx = V[b % n].x, bz = V[b % n].z, dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const p = V[i % n], d = Math.abs((p.x - ax) * dz - (p.z - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi % n] = 1; rec(a, mi); rec(mi, b); }
  };
  rec(0, far); rec(far, n);
  return V.filter((_, i) => keep[i] || V[i].j && false);
}
// collapse short edges (chamfers, refuge islands) into a single corner at the intersection of the neighbouring edges, so fillets get room
function mergeShort(V0, minLen = 14, maxShift = 22) {
  let V = V0.map(v => ({ ...v })), changed = true, guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (let i = 0; i < V.length && V.length > 6; i++) {
      const n = V.length, a = V[i], b = V[(i + 1) % n], l = Math.hypot(b.x - a.x, b.z - a.z); if (l >= minLen) continue;
      const p = V[(i - 1 + n) % n], q = V[(i + 2) % n];
      const d1 = [a.x - p.x, a.z - p.z], d2 = [q.x - b.x, q.z - b.z], den = d1[0] * d2[1] - d1[1] * d2[0];
      const m1 = Math.hypot(...d1), m2 = Math.hypot(...d2); if (m1 < 1e-6 || m2 < 1e-6 || Math.abs(den) / (m1 * m2) < 0.34) continue;   // nearly parallel: keep
      const s = ((b.x - p.x) * d2[1] - (b.z - p.z) * d2[0]) / den, X = [p.x + d1[0] * s, p.z + d1[1] * s];
      if (Math.hypot(X[0] - a.x, X[1] - a.z) > maxShift || Math.hypot(X[0] - b.x, X[1] - b.z) > maxShift || s <= 0) continue;
      const keep = a.j ? a : b.j ? b : a, nv = { ...keep, x: X[0], z: X[1], w: Math.max(a.w, b.w), j: a.j || b.j, rb: a.rb && b.rb };
      V.splice(i, 2, nv); if (i + 1 < V.length + 1 && (i + 1) >= V.length) V.splice(0, 1); changed = true; break;
    }
  }
  return V;
}
function filletLoop(V) {
  const n = V.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = V[(i + n - 1) % n], b = V[i], c = V[(i + 1) % n];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const d1 = [(b.x - a.x) / l1, (b.z - a.z) / l1], d2 = [(c.x - b.x) / l2, (c.z - b.z) / l2];
    const dot = clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1), cr = d1[0] * d2[1] - d1[1] * d2[0], th = Math.acos(dot);
    const base = { w: b.w, rb: b.rb, j: b.j, edge: b.edge };
    if (th < 0.03) { out.push({ x: b.x, z: b.z, ...base }); continue; }
    const r = b.j ? clamp(0.9 * b.w + 8, 13, 28) : 160;
    const D = b.j ? b.w * 0.5 + 8 : b.w * 0.35 + 1.4;                       // max allowed cut of the corner (stay on the road)
    const t = Math.min(r * Math.tan(th / 2), 0.48 * l1, 0.48 * l2, D / Math.max(1e-3, Math.tan(th / 4))), re = t / Math.tan(th / 2);
    const T1 = [b.x - d1[0] * t, b.z - d1[1] * t], T2 = [b.x + d2[0] * t, b.z + d2[1] * t];
    const rn = [-d1[1], d1[0]], s = cr > 0 ? 1 : -1, C = [T1[0] + rn[0] * re * s, T1[1] + rn[1] * re * s];
    const v0 = [T1[0] - C[0], T1[1] - C[1]];
    const rot = (v, ang) => [v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang)];
    const e1 = rot(v0, th), e2 = rot(v0, -th), end = [T2[0] - C[0], T2[1] - C[1]];
    const sg = Math.hypot(e1[0] - end[0], e1[1] - end[1]) < Math.hypot(e2[0] - end[0], e2[1] - end[1]) ? 1 : -1;
    const m = Math.max(2, Math.ceil(re * th / 0.8));
    for (let k = 0; k <= m; k++) { const v = rot(v0, sg * th * k / m); out.push({ x: C[0] + v[0], z: C[1] + v[1], ...base, j: false }); }
  }
  return out;
}
function resampleLoop(P, step = 1) {
  const n = P.length, cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(P[(i + 1) % n].x - P[i].x, P[(i + 1) % n].z - P[i].z));
  const L = cum[n], N = Math.max(8, Math.round(L / step)), ds = L / N, out = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds; while (cum[k + 1] < s) k++;
    const a = P[k], b = P[(k + 1) % n], f = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
    out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, w: a.w + (b.w - a.w) * f, rb: f < 0.5 ? a.rb : b.rb, edge: a.edge });
  }
  return { pts: out, L, ds };
}
function gaussLoop(vals, sigma, getter = v => v) {
  const n = vals.length, R = Math.ceil(sigma * 3), k = []; let tot = 0;
  for (let i = -R; i <= R; i++) { const w = Math.exp(-i * i / (2 * sigma * sigma)); k.push(w); tot += w; }
  const out = new Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -R; j <= R; j++) s += k[j + R] * getter(vals[(i + j + n * 4) % n]); out[i] = s / tot; }
  return out;
}
function smoothLoop(path) {
  const V = pathPolyline(path), F = filletLoop(mergeShort(rdpLoop(V))), { pts } = resampleLoop(F, 1);
  const xs = gaussLoop(pts, 2.2, p => p.x), zs = gaussLoop(pts, 2.2, p => p.z), ws = gaussLoop(pts, 8, p => p.w);
  pts.forEach((p, i) => { p.x = xs[i]; p.z = zs[i]; p.w = ws[i]; });
  let len = 0; for (let i = 0; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[(i + 1) % pts.length].x, pts[i].z - pts[(i + 1) % pts.length].z);
  return { pts, L: len, raw: V };
}

// ------------------------------------------------------------------ analysis (heading, curvature, corners, elevation)
function analyse(sm) {
  const P = sm.pts, n = P.length, ds = sm.L / n;
  // max distance of the smoothed line from the real centreline, relative to the road half-width
  let dev = 0, devRel = 0; { const R = sm.raw, m = R.length; for (let i = 0; i < n; i += 3) { let bd = 1e9; for (let k = 0; k < m; k++) { const a = R[k], b = R[(k + 1) % m], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, u = clamp(((P[i].x - a.x) * dx + (P[i].z - a.z) * dz) / l2, 0, 1), d = Math.hypot(P[i].x - a.x - dx * u, P[i].z - a.z - dz * u); if (d < bd) bd = d; } dev = Math.max(dev, bd); devRel = Math.max(devRel, bd / (P[i].w / 2 + 3)); } }
  const hd = new Array(n);
  for (let i = 0; i < n; i++) { const a = P[(i + n - 2) % n], b = P[(i + 2) % n]; hd[i] = Math.atan2(b.x - a.x, b.z - a.z); }
  // signed curvature, + = right turn. forward f=(sin h, cos h); heading north h=pi, turning right (east) => h decreases => d<0 => kap>0
  const kap = new Array(n), K = 5;
  for (let i = 0; i < n; i++) {
    const a = hd[(i - K + n) % n], b = hd[(i + K) % n]; let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    kap[i] = -d / (2 * K * ds);
  }
  const kS = gaussLoop(kap, 3);
  const TH = 1 / 320, inCorner = kS.map(k => Math.abs(k) > TH), run = [];
  let first = inCorner.findIndex(v => !v); if (first < 0) first = 0;
  let start = -1;
  for (let q = 0; q < n; q++) {
    const i = (first + q) % n;
    if (inCorner[i]) { if (start < 0) start = i; } else if (start >= 0) { run.push([start, (i - 1 + n) % n]); start = -1; }
  }
  if (start >= 0) run.push([start, (first - 1 + n) % n]);
  const merged = [];
  for (const r of run) {
    const last = merged.at(-1), gap = last ? (r[0] - last[1] + n) % n * ds : 1e9;
    if (last && gap < 18 && Math.sign(kS[last[1]]) === Math.sign(kS[r[0]])) last[1] = r[1]; else merged.push([r[0], r[1]]);
  }
  const corners = [];
  for (const [i0, i1] of merged) {
    const len = ((i1 - i0 + n) % n + 1);
    let turn = 0, maxK = 0, apex = i0;
    for (let q = 0; q < len; q++) { const i = (i0 + q) % n; turn += kS[i] * ds; if (Math.abs(kS[i]) > maxK) { maxK = Math.abs(kS[i]); apex = i; } }
    const angle = Math.abs(turn) * 180 / Math.PI;
    if (angle < 10) continue;
    corners.push({ i0, i1, apex, angle, dir: turn > 0 ? 'R' : 'L', minR: 1 / maxK, meanR: len * ds / Math.abs(turn), len: len * ds });
  }
  const y = P.map(p => H(p.x, p.z)), yS = gaussLoop(y, 10);
  let gain = 0, maxG = 0, ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < n; i++) { const d = yS[(i + 1) % n] - yS[i]; if (d > 0) gain += d; maxG = Math.max(maxG, Math.abs(d / ds)); ymin = Math.min(ymin, yS[i]); ymax = Math.max(ymax, yS[i]); }
  // straights: |kappa| < 1/700, gaps up to 18 m tolerated
  const st = kS.map(k => Math.abs(k) < 1 / 700);
  let st0 = st.findIndex(v => !v); if (st0 < 0) st0 = 0;
  let straights = [], cs = -1, gapRun = 0;
  for (let q = 0; q < n; q++) {
    const i = (st0 + q) % n;
    if (st[i]) { if (cs < 0) cs = i; gapRun = 0; } else if (cs >= 0) { gapRun++; if (gapRun > 18) { const e = (i - gapRun + n) % n; straights.push([cs, e, ((e - cs + n) % n + 1) * ds]); cs = -1; gapRun = 0; } }
  }
  if (cs >= 0) { const e = (st0 - 1 + n) % n; straights.push([cs, e, ((e - cs + n) % n + 1) * ds]); }
  straights = straights.filter(s => s[2] > 60);
  const straightLen2 = straights.reduce((s, r) => s + r[2], 0), longest = straights.reduce((m, r) => Math.max(m, r[2]), 0);
  let minR = 1e9, tightN = 0; for (const c of corners) { minR = Math.min(minR, c.minR); if (c.minR < 9) tightN++; }
  // self proximity (loop running next to another far-along part of itself, e.g. both carriageways of an avenue)
  let near = 0; const cell = new Map();
  for (let i = 0; i < n; i += 4) { const key = Math.floor(P[i].x / 40) + ',' + Math.floor(P[i].z / 40); (cell.get(key) ?? cell.set(key, []).get(key)).push(i); }
  for (let i = 0; i < n; i += 4) {
    const cx = Math.floor(P[i].x / 40), cz = Math.floor(P[i].z / 40); let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dz = -1; dz <= 1 && !hit; dz++) for (const j of cell.get((cx + dx) + ',' + (cz + dz)) ?? []) {
      const sd = Math.min(Math.abs(i - j), n - Math.abs(i - j)) * ds; if (sd < 150) continue;
      if (Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z) < 30) { hit = true; break; }
    }
    if (hit) near++;
  }
  const dists = P.filter((_, i) => i % 20 === 0).map(p => Math.hypot(p.x, p.z)), meanDist = dists.reduce((a, b) => a + b, 0) / dists.length;
  const cz = P.reduce((s, p) => s + p.z, 0) / n, cx = P.reduce((s, p) => s + p.x, 0) / n;
  let rbLen = 0; for (const p of P) if (p.rb) rbLen += ds;
  const avgW = P.reduce((s, p) => s + p.w, 0) / n, minW = Math.min(...P.map(p => p.w));
  const square = corners.filter(c => c.angle > 65 && c.angle < 125 && c.minR < 30).length;
  const hairpins = corners.filter(c => c.angle >= 125 && c.minR < 40).length;
  const sweepers = corners.filter(c => c.minR >= 60 && c.angle >= 12).length;
  const mediums = corners.filter(c => c.minR >= 25 && c.minR < 60 && c.angle >= 25).length;
  return { dev, devRel, hd, kap: kS, corners, y, yS, gain, maxG, range: ymax - ymin, straights, longest, straightFrac: straightLen2 / sm.L, minR, tightN, selfProx: near / Math.ceil(n / 4), meanDist, cx, cz, rbLen, avgW, minW, square, hairpins, sweepers, mediums, n, ds };
}

// ------------------------------------------------------------------ scoring + selection
const wrongLen = p => p.reduce((s, a) => s + (E[a.e].flow && (E[a.e].flow > 0) === a.rev ? E[a.e].len : 0), 0);
const orient = path => { // travel direction that follows one-way streets best
  const rv = path.slice().reverse().map(a => ({ e: a.e, rev: !a.rev }));
  return wrongLen(rv) < wrongLen(path) ? rv : path;
};
const gauss = (x, mu, sg) => Math.exp(-((x - mu) ** 2) / (2 * sg * sg));
function scoreTech(m, L, wrong) {
  return 6 * gauss(L, 1900, 450) + Math.min(m.rbLen, 260) / 80 + 5 * gauss(m.meanDist, 180, 170) +
    0.8 * Math.min(m.corners.length, 14) + 0.9 * Math.min(m.hairpins, 2) + 0.5 * Math.min(m.mediums, 4) + 0.5 * Math.min(m.sweepers, 4) +
    0.6 * Math.min(m.longest / 150, 2) - 1.3 * Math.max(0, m.square - 5) - 12 * m.selfProx - 3 * wrong - 0.8 * m.tightN +
    2 * gauss(m.range, 14, 10) - 40 * Math.max(0, m.maxG - 0.09) + Math.min(m.avgW, 14) / 6;
}
function scoreFast(m, L, wrong) {
  return 6 * gauss(L, 2700, 380) + Math.min(m.longest, 700) / 110 + 4 * m.straightFrac + 0.55 * Math.min(m.sweepers, 6) + 0.4 * Math.min(m.mediums, 4) +
    Math.min(m.avgW, 16) / 3 + 0.7 * Math.min(m.corners.length, 10) - 1.6 * Math.max(0, m.square - 4) - 12 * m.selfProx - 3 * wrong - 0.8 * m.tightN +
    2 * gauss(m.range, 22, 14) - 40 * Math.max(0, m.maxG - 0.09) + 2 * clamp(-m.cz / 300, -0.5, 1) + 0.5 * Math.min(m.hairpins, 1) - 0.3 * Math.min(m.rbLen / 80, 3);
}
const t1 = Date.now();
const preTech = f => -Math.abs(f.L - 1900) / 220 + Math.min(f.rb, 320) / 80 - 1.2 * Math.max(0, f.n90 - 5) - 3 * f.wrong - Math.hypot(f.cx, f.cz) / 250 + f.avgW / 8;
const preFast = f => -Math.abs(f.L - 2700) / 250 - 1.0 * Math.max(0, f.n90 - 4) + f.avgW / 3 - 3 * f.wrong - f.curv * 0.5 + 1.5 * clamp(-f.cz / 300, -0.5, 1);
const pick = new Set([...cands].sort((a, b) => preTech(b.f) - preTech(a.f)).slice(0, +(process.env.TOPN || 1500)).concat([...cands].sort((a, b) => preFast(b.f) - preFast(a.f)).slice(0, +(process.env.TOPN || 1500))));
const evald = [];
for (const c of pick) {
  const path = orient(c.path), sm = smoothLoop(path), m = analyse(sm);
  if (m.minW < 5.9 || m.maxG > 0.1 || m.selfProx > 0.12 || m.tightN > 3 || m.devRel > 1.25) continue;
  const wrong = wrongLen(path) / c.f.L;
  evald.push({ path, sm, m, L: sm.L, wrong, edges: new Set(path.map(a => a.e)), tech: scoreTech(m, sm.L, wrong), fast: scoreFast(m, sm.L, wrong) });
}
console.log('evaluated', evald.length, 'in', Date.now() - t1, 'ms');
const sharedFrac = (a, b) => { let s = 0, t = 0; for (const e of a.edges) { t += E[e].len; if (b.edges.has(e)) s += E[e].len; } return s / t; };
const byTech = evald.slice().sort((a, b) => b.tech - a.tech), byFast = evald.slice().sort((a, b) => b.fast - a.fast);
const describe = (c, tag) => `${tag} L=${c.L.toFixed(0)} corners=${c.m.corners.length} sq=${c.m.square} hp=${c.m.hairpins} sw=${c.m.sweepers} med=${c.m.mediums} longest=${c.m.longest.toFixed(0)} straight%=${(c.m.straightFrac * 100).toFixed(0)} avgW=${c.m.avgW.toFixed(1)} minW=${c.m.minW.toFixed(1)} rb=${c.m.rbLen.toFixed(0)} range=${c.m.range.toFixed(0)} maxG=${(c.m.maxG * 100).toFixed(1)}% c=(${c.m.cx.toFixed(0)},${c.m.cz.toFixed(0)}) wrong=${(c.wrong * 100).toFixed(0)}% tech=${c.tech.toFixed(1)} fast=${c.fast.toFixed(1)}`;
console.log('--- top technical'); byTech.slice(0, 6).forEach((c, i) => console.log(describe(c, 'T' + i)));
console.log('--- top fast'); byFast.slice(0, 6).forEach((c, i) => console.log(describe(c, 'F' + i)));

// ------------------------------------------------------------------ debug candidate image
import sharp from 'sharp';
async function drawCands(list, file) {
  const S = 0.45, RR = 1100, W = Math.round(2 * RR * S), cols = ['#ff5555', '#55ff55', '#55aaff', '#ffff55', '#ff55ff', '#55ffff'];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + W + '"><rect width="100%" height="100%" fill="#111"/>';
  for (const e of E) svg += '<polyline fill="none" stroke="#444" stroke-width="2" points="' + e.pts.map(q => ((q[0] + RR) * S).toFixed(1) + ',' + ((q[1] + RR) * S).toFixed(1)).join(' ') + '"/>';
  list.forEach((c, i) => {
    svg += '<polyline fill="none" stroke="' + cols[i % 6] + '" stroke-width="' + (3.5 - i * 0.2) + '" opacity="0.85" points="' + c.sm.pts.filter((_, k) => k % 6 === 0).map(q => ((q.x + RR) * S).toFixed(1) + ',' + ((q.z + RR) * S).toFixed(1)).join(' ') + '"/>';
    svg += '<text x="' + ((c.sm.pts[0].x + RR) * S) + '" y="' + ((c.sm.pts[0].z + RR) * S) + '" fill="#fff" font-size="14">' + i + '</text>';
  });
  svg += '</svg>'; await sharp(Buffer.from(svg)).png().toFile(file);
}
async function drawGrid(list, file, sc = 0.42) {
  const cell = 520, cols = 3, rows = Math.ceil(list.length / cols), parts = [];
  for (let k = 0; k < list.length; k++) {
    const c = list[k], cx = c.m.cx, cz = c.m.cz; let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cell + '" height="' + cell + '"><rect width="100%" height="100%" fill="#161616" stroke="#555"/>';
    const X = x => ((x - cx) * sc + cell / 2).toFixed(1), Z = z => ((z - cz) * sc + cell / 2).toFixed(1);
    for (const e of E) svg += '<polyline fill="none" stroke="#3a3a3a" stroke-width="1.5" points="' + e.pts.map(q => X(q[0]) + ',' + Z(q[1])).join(' ') + '"/>';
    svg += '<circle cx="' + X(0) + '" cy="' + Z(0) + '" r="5" fill="#f80"/>';
    svg += '<polyline fill="none" stroke="#6cf" stroke-width="3" points="' + c.sm.pts.filter((_, i) => i % 5 === 0).map(q => X(q.x) + ',' + Z(q.z)).join(' ') + '"/>';
    c.m.corners.forEach((co, i) => { const p = c.sm.pts[co.apex]; svg += '<text x="' + X(p.x) + '" y="' + Z(p.z) + '" fill="#ff0" font-size="11">' + (i + 1) + '</text>'; });
    svg += '<text x="6" y="16" fill="#fff" font-size="13">' + k + ' L=' + c.L.toFixed(0) + ' c=' + c.m.corners.length + ' sq=' + c.m.square + ' straight=' + c.m.longest.toFixed(0) + '</text></svg>';
    parts.push({ input: Buffer.from(svg), left: (k % cols) * cell, top: Math.floor(k / cols) * cell });
  }
  await sharp({ create: { width: cell * cols, height: cell * rows, channels: 3, background: '#000' } }).composite(parts).png().toFile(file);
}
if (process.argv.includes('--cands')) { await drawGrid(byTech.slice(0, 9), '.scratch/grid-tech.png'); await drawGrid(byFast.slice(0, 9), '.scratch/grid-fast.png'); }
if (process.argv.includes('--cands')) { await drawCands(byTech.slice(0, 4), '.scratch/cand-tech.png'); await drawCands(byFast.slice(0, 4), '.scratch/cand-fast.png'); }

// ------------------------------------------------------------------ building raster (clearance / free space beside the road)
const RES = 2, RX = 1150, RN = Math.round(2 * RX / RES);
const bld = new Uint8Array(RN * RN);
{
  const polys = [];
  const asRing = geom => geom.map(g => project(g.lat, g.lon));
  for (const e of osm.elements) {
    const t = e.tags || {};
    if (!(t.building || t['building:part'])) continue;
    if (e.type === 'way' && e.geometry && e.geometry.length > 3) polys.push(asRing(e.geometry));
    else if (e.type === 'relation' && e.members) for (const m of e.members) if (m.type === 'way' && m.role !== 'inner' && m.geometry && m.geometry.length > 3) polys.push(asRing(m.geometry));
  }
  const inside = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  for (const ring of polys) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of ring) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const i0 = Math.max(0, Math.floor((x0 + RX) / RES)), i1 = Math.min(RN - 1, Math.floor((x1 + RX) / RES)), j0 = Math.max(0, Math.floor((z0 + RX) / RES)), j1 = Math.min(RN - 1, Math.floor((z1 + RX) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside([(i + 0.5) * RES - RX, (j + 0.5) * RES - RX], ring)) bld[j * RN + i] = 1;
  }
}
const isBld = (x, z) => { const i = Math.floor((x + RX) / RES), j = Math.floor((z + RX) / RES); return i >= 0 && j >= 0 && i < RN && j < RN && bld[j * RN + i] === 1; };

// ------------------------------------------------------------------ side roads (junction mouths) from every drivable way
const wayNodes = new Map();   // node id -> [{ way, k }]
const driveWays = osm.elements.filter(e => e.type === 'way' && e.tags && ROAD[e.tags.highway] && e.geometry && !(e.tags.tunnel === 'yes' || e.tags.area === 'yes' || e.tags.covered === 'yes'));
for (const w of driveWays) w.nodes.forEach((id, k) => (wayNodes.get(id) ?? wayNodes.set(id, []).get(id)).push({ w, k }));

// ------------------------------------------------------------------ finalise one circuit
const mod = (a, n) => ((a % n) + n) % n;
const headingAt = (hd, i) => hd[mod(i, hd.length)];
function finalise(ch, id, name, nameHy, kind) {
  const P = ch.sm.pts, n = P.length, m = ch.m, ds = ch.L / n, hd = m.hd;
  const fwd = i => [Math.sin(hd[mod(i, n)]), Math.cos(hd[mod(i, n)])];
  // clearance beyond the road edge on each side (m to the first building cell, capped 40)
  const clr = [new Uint8Array(n), new Uint8Array(n)]; // [left, right]
  for (let i = 0; i < n; i++) {
    const f = fwd(i), rn = [-f[1], f[0]], hw = P[i].w / 2;
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? -1 : 1; let d = 0;
      for (; d < 40; d += 1) if (isBld(P[i].x + rn[0] * sg * (hw + d), P[i].z + rn[1] * sg * (hw + d))) break;
      clr[s][i] = d;
    }
  }
  // junction mouths along the loop
  const loopIds = new Set(ch.sm.raw.map(v => v.nid)), rawIdx = new Map(); ch.sm.raw.forEach((v, k) => rawIdx.set(v.nid, k));
  const mouths = [];
  for (const [k, v] of ch.sm.raw.entries()) {
    const prev = ch.sm.raw[mod(k - 1, ch.sm.raw.length)].nid, next = ch.sm.raw[mod(k + 1, ch.sm.raw.length)].nid;
    for (const { w, k: wk } of wayNodes.get(v.nid) ?? []) for (const dir of [-1, 1]) {
      const nb = w.nodes[wk + dir]; if (nb == null || nb === prev || nb === next || (loopIds.has(nb) && Math.abs(rawIdx.get(nb) - k) <= 1)) continue;
      const g = w.geometry[wk + dir], q = project(g.lat, g.lon), dx = q[0] - v.x, dz = q[1] - v.z, l = Math.hypot(dx, dz); if (l < 1) continue;
      // nearest loop sample to the node
      let bi = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = (P[i].x - v.x) ** 2 + (P[i].z - v.z) ** 2; if (d < bd) { bd = d; bi = i; } }
      const f = fwd(bi), cr = f[0] * dz - f[1] * dx; // + : side road leaves to the right
      const dot = (f[0] * dx + f[1] * dz) / l;
      if (Math.abs(dot) > 0.94) continue;               // continues along the loop direction (not a side road)
      mouths.push({ index: bi, x: r2(v.x), z: r2(v.z), side: cr > 0 ? 'R' : 'L', dx: r2(dx / l), dz: r2(dz / l), width: r2(roadWidth(w.tags)), cls: w.tags.highway });
    }
  }
  const uniq = []; for (const mo of mouths) if (!uniq.some(u => Math.abs(u.index - mo.index) < 6 && u.side === mo.side && Math.abs(u.dx - mo.dx) + Math.abs(u.dz - mo.dz) < 0.3)) uniq.push(mo);
  // start / finish: a straight with room on one side, away from junction mouths, long straight behind for the grid
  const kap = m.kap, junctionIdx = uniq.map(u => u.index);
  const nearJ = (i, a, b) => junctionIdx.some(j => { const d = mod(j - i, n); return d >= mod(a, n) || d <= b; });
  let best = null;
  for (let i = 0; i < n; i += 3) {
    let ok = true, minK = 0, cl = [99, 99];
    for (let d = -40; d <= 75; d += 4) { const j = mod(i + d, n); if (Math.abs(kap[j]) > 1 / 300 || P[j].rb) { ok = false; break; } if (d >= -10 && d <= 70) { cl[0] = Math.min(cl[0], clr[0][j]); cl[1] = Math.min(cl[1], clr[1][j]); } }
    if (!ok) continue;
    let jp = 0; for (const j of junctionIdx) { const d = mod(j - i + 60, n) - 60; if (d > -40 && d < 70) jp++; }
    const side = cl[1] >= cl[0] ? 'R' : 'L', room = Math.max(cl[0], cl[1]);
    const score = Math.min(room, 20) * 1.5 - jp * 3 + Math.min(P[i].w, 16) * 0.3 - (kind === 'technical' ? Math.hypot(P[i].x, P[i].z) / 14 : 0);
    if (!best || score > best.score) best = { i, score, side, room };
  }
  if (!best) best = { i: 0, score: 0, side: 'R', room: 0 };
  const sf = best.i;
  // rotate all per-point arrays so index 0 = start/finish line
  const sh = a => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = a[(i + sf) % n]; return out; };
  const pts = sh(P), hdr = sh(hd), kr = sh(kap), clrL = sh(Array.from(clr[0])), clrR = sh(Array.from(clr[1]));
  const idx = i => mod(i - sf, n);
  const ptY = pts.map(p => H(p.x, p.z) + 0.12);
  // corners (renumbered from the start line)
  const hasRb = (c) => { let k = 0, t = 0; for (let q = 0; q < Math.ceil(c.len); q++) { t++; if (P[(c.i0 + q) % n].rb) k++; } return k / Math.max(1, t) > 0.5; };
  const sev = c => (c.minR < 14 || c.angle > 140) ? 5 : c.minR < 26 ? 4 : c.minR < 55 ? 3 : c.minR < 110 ? 2 : 1;
  const KIND = ['', 'sweeper', 'fast', 'medium', 'tight', 'hairpin'];
  let corners = m.corners.map(c => ({ i0: idx(c.i0), len: Math.round(c.len), apex: idx(c.apex), dir: c.dir, angle: Math.round(c.angle), minR: r2(c.minR), meanR: r2(c.meanR), severity: sev(c), rb: hasRb(c) }));
  corners.sort((a, b) => a.i0 - b.i0);
  corners = corners.map((c, k) => ({ n: k + 1, entry: c.i0, exit: (c.i0 + Math.max(1, c.len)) % n, apex: c.apex, dir: c.dir, angle: c.angle, minR: c.minR, severity: c.severity, kind: c.rb ? 'roundabout' : KIND[c.severity], len: c.len }));
  const straights = m.straights.map(s => ({ i0: idx(s[0]), i1: idx(s[1]), length: Math.round(s[2]) })).sort((a, b) => a.i0 - b.i0);
  const inCorner = new Uint8Array(n); for (const c of corners) if (c.severity >= 2) for (let q = -10; q <= c.len + 10; q++) inCorner[mod(c.entry + q, n)] = 1;
  // checkpoints ~every 190 m, snapped to calm stretches away from junctions
  const jIdx2 = uniq.map(u => idx(u.index)); const cps = [];
  const nCp = Math.max(6, Math.round(ch.L / 190)), spacing = ch.L / nCp;
  for (let k = 1; k < nCp; k++) {
    const target = Math.round(k * spacing / ds); let bi = target, bs = 1e9;
    for (let d = -45; d <= 45; d++) { const j = mod(target + d, n); const jd = jIdx2.length ? Math.min(...jIdx2.map(q => Math.min(mod(q - j, n), mod(j - q, n)))) : 99; const sc = Math.abs(kr[j]) * 3000 + (inCorner[j] ? 40 : 0) + Math.abs(d) * 0.08 + (jd < 12 ? 25 : 0) + (pts[j].rb ? 30 : 0); if (sc < bs) { bs = sc; bi = j; } }
    cps.push(bi);
  }
  const frame = i => { const f = [Math.sin(hdr[mod(i, n)]), Math.cos(hdr[mod(i, n)])]; return f; };
  const mk = (i, extra = {}) => ({ index: i, x: r2(pts[i].x), y: r2(ptY[i]), z: r2(pts[i].z), heading: r2(hdr[i]), ...extra });
  // paddock (pit lane + boxes + timing tower) and spectator stands: straights with free space beside the road, near the Square for the technical loop
  const rbN = pts.map(p => !!p.rb), jPen = i => { let c = 0; for (const j of jIdx2) { const d = mod(j - i + 30, n) - 30; if (d > -6 && d < 64) c++; } return c; };
  const sites = [];
  for (let i = 0; i < n; i += 4) {
    let ok = true, cl = [99, 99];
    for (let d = 0; d <= 70; d += 5) { const j = mod(i + d, n); if (Math.abs(kr[j]) > 1 / 250 || rbN[j]) { ok = false; break; } cl[0] = Math.min(cl[0], clrL[j]); cl[1] = Math.min(cl[1], clrR[j]); }
    if (!ok) continue;
    const mid = mod(i + 35, n), side = cl[1] >= cl[0] ? 'R' : 'L', room = Math.max(cl[0], cl[1]);
    const dsf = Math.min(mid, n - mid) * ds, dsq = Math.hypot(pts[mid].x, pts[mid].z);
    sites.push({ i, mid, side, room, dsf, dsq, jp: jPen(i), w: pts[mid].w });
  }
  const pickSite = (scoreFn, avoid = []) => { let b = null; for (const s of sites) { if (avoid.some(a => Math.min(mod(a - s.mid, n), mod(s.mid - a, n)) * ds < 120)) continue; const sc = scoreFn(s); if (!b || sc > b.sc) b = { ...s, sc }; } return b; };
  const pitSite = pickSite(s => Math.min(s.room, 24) * 1.5 - s.jp * 3 - (kind === 'technical' ? s.dsq / 14 : s.dsf / 40)) ?? { mid: mod(-35, n), i: mod(-35, n), side: best.side, room: best.room };
  // stands: may follow gentle curves / the Square's oval; they sit on the outside of the bend
  const sites2 = [];
  for (let i = 0; i < n; i += 4) {
    let ok = true, ks = 0, cl = [99, 99];
    for (let d = 0; d <= 48; d += 4) { const j = mod(i + d, n); if (Math.abs(kr[j]) > 1 / 40) { ok = false; break; } ks += kr[j]; cl[0] = Math.min(cl[0], clrL[j]); cl[1] = Math.min(cl[1], clrR[j]); }
    if (!ok) continue;
    const outside = ks > 0.02 ? 'L' : ks < -0.02 ? 'R' : (cl[1] >= cl[0] ? 'R' : 'L'), room = outside === 'R' ? cl[1] : cl[0], mid = mod(i + 24, n);
    sites2.push({ i, mid, side: outside, room, dsf: Math.min(mid, n - mid) * ds, dsq: Math.hypot(pts[mid].x, pts[mid].z), jp: jPen(i) });
  }
  const pickSite2 = (scoreFn, avoid) => { let b = null; for (const s of sites2) { if (s.room < 10 || avoid.some(a => Math.min(mod(a - s.mid, n), mod(s.mid - a, n)) * ds < 140)) continue; const sc = scoreFn(s); if (!b || sc > b.sc) b = { ...s, sc }; } return b; };
  const standA = pickSite2(s => Math.min(s.room, 30) * 1.2 - s.jp * 3 - (kind === 'technical' ? s.dsq / 12 : Math.abs(s.dsf - 500) / 60), [pitSite.mid, 0]);
  const standB = pickSite2(s => Math.min(s.room, 30) * 1.2 - s.jp * 3 - (kind === 'technical' ? s.dsq / 12 : Math.abs(s.dsf - 1400) / 60), [pitSite.mid, 0, standA?.mid ?? 0]);
  const sideOf = (s) => (s.side === 'R' ? 1 : -1);
  const offPt = (i, sg, off) => { const f = frame(i), r = [-f[1], f[0]], x = pts[i].x + r[0] * sg * off, z = pts[i].z + r[1] * sg * off; return [x, z]; };
  const pitIdx = pitSite.mid, pitSg = sideOf(pitSite), pitOff = pts[pitIdx].w / 2 + 3.4;
  const [pxx, pzz] = offPt(pitIdx, pitSg, pitOff);
  const pit = { x: r2(pxx), y: r2(H(pxx, pzz) + 0.12), z: r2(pzz), heading: r2(hdr[pitIdx]), side: pitSite.side, index: pitIdx, length: 64, offset: r2(pitOff), room: pitSite.room, entry: mod(pitIdx - 40, n), exit: mod(pitIdx + 40, n) };
  const stands = [standA, standB].filter(Boolean).map(s => ({ index: s.mid, side: s.side, length: 48, room: s.room }));
  // grid: 8 slots, 2 columns staggered, behind the line
  const spawns = [], hw0 = pts[0].w / 2, lat = Math.min(2.3, hw0 * 0.3);
  for (let k = 0; k < 8; k++) {
    const row = k >> 1, col = k & 1, back = 7 + row * 8 + (col ? 4 : 0), i = mod(-Math.round(back / ds), n), f = frame(i), r = [-f[1], f[0]], l = (col ? 1 : -1) * lat;
    spawns.push({ slot: k, index: i, x: r2(pts[i].x + r[0] * l), y: r2(H(pts[i].x + r[0] * l, pts[i].z + r[1] * l) + 0.2), z: r2(pts[i].z + r[1] * l), heading: r2(hdr[i]) });
  }
  // keep-out discs for other generators (props, parked cars, trees): areas occupied by the pit complex / stands / start gantry
  const keepout = [{ kind: 'pit', x: pit.x, z: pit.z, r: 46 }, { kind: 'gantry', x: r2(pts[0].x), z: r2(pts[0].z), r: 12 }];
  for (const s of stands) { const [sx, sz] = offPt(s.index, s.side === 'R' ? 1 : -1, pts[s.index].w / 2 + 9); keepout.push({ kind: 'stands', x: r2(sx), z: r2(sz), r: 34 }); }
  // collider polylines for physics: tyre walls (outside of corners), junction-mouth jersey barriers, guardrails on free edge runs.
  // Same placement rules as src/circuits/dress.js (the visual density of rails/jersey varies with quality; colliders are the full set).
  const barriers = [];
  {
    const cov = [new Uint8Array(n), new Uint8Array(n)];
    const edgeLine = (i0, len, sg, off) => { const out = [], m = Math.max(1, Math.ceil(len * ds / 2)); for (let k = 0; k <= m; k++) { const i = mod(Math.round(i0 + len * k / m), n), f = frame(i), x = pts[i].x - f[1] * sg * (pts[i].w / 2 + off), z = pts[i].z + f[0] * sg * (pts[i].w / 2 + off); out.push([r2(x), r2(H(x, z) + 0.09), r2(z)]); } return out; };
    const markC = (a, i0, len, v) => { for (let q = 0; q <= len; q++) { const i = mod(Math.round(i0 + q), n); if (!a[i]) a[i] = v; } };
    for (const co of corners) {
      if (co.severity < 2) continue;
      const sg = co.dir === 'R' ? -1 : 1, sev = co.severity, pre = sev >= 4 ? 18 : sev === 3 ? 10 : 6, post = sev >= 4 ? 38 : sev === 3 ? 26 : 14, cols = sev >= 3 ? 2 : 1, rows = sev >= 3 ? 3 : 2;
      const i0 = co.entry - pre / ds, len = (pre + co.len + post) / ds;
      barriers.push({ kind: 'tyres', corner: co.n, side: sg > 0 ? 'R' : 'L', h: r2(rows * 0.255), w: r2(cols * 0.64), pts: edgeLine(i0, len, sg, 0.5 + (cols - 1) * 0.31) });
      markC(cov[sg > 0 ? 1 : 0], i0, len, 1);
    }
    const spans = [[], []];
    for (const m of uniq) { const sd = m.side === 'R' ? 1 : 0, mi = idx(m.index), half = m.width / 2 + 3.2, i0 = mi - half / ds, len = 2 * half / ds, a = spans[sd], l = a[a.length - 1]; if (cov[sd][mi] === 1) continue; if (l && i0 <= l[0] + l[1] + 2) l[1] = Math.max(l[1], i0 + len - l[0]); else a.push([i0, len]); }
    for (let sd = 0; sd < 2; sd++) for (const [i0, len] of spans[sd]) { barriers.push({ kind: 'jersey', side: sd ? 'R' : 'L', h: 0.8, w: 0.6, pts: edgeLine(i0, len, sd ? 1 : -1, 0.85) }); markC(cov[sd], i0, len, 4); }
    for (let sd = 0; sd < 2; sd++) {
      const arr = cov[sd]; let start = arr.findIndex(v => v !== 0); if (start < 0) continue;
      for (let q = 0; q < n;) {
        if (arr[mod(start + q, n)] !== 0) { q++; continue; }
        let r = q; while (r < n && arr[mod(start + r, n)] === 0) r++;
        if ((r - q) * ds >= 18) { const a0 = start + q + 4 / ds, a1 = start + r - 4 / ds; if (a1 - a0 > 6) barriers.push({ kind: 'guardrail', side: sd ? 'R' : 'L', h: 0.9, w: 0.2, pts: edgeLine(a0, a1 - a0, sd ? 1 : -1, 0.62) }); }
        q = r;
      }
    }
  }
  const outPts = []; for (let i = 0; i < n; i++) outPts.push(r2(pts[i].x), r2(ptY[i]), r2(pts[i].z));
  const rbRanges = []; { let s = -1; for (let i = 0; i < n; i++) { if (pts[i].rb && s < 0) s = i; if ((!pts[i].rb || i === n - 1) && s >= 0) { if (i - s > 12) rbRanges.push([s, i - 1]); s = -1; } } }
  return {
    id, name, nameHy, kind, length: Math.round(ch.L), closed: true, spacing: r2(ds),
    width: r2(pts.reduce((s, p) => s + p.w, 0) / n), widths: pts.map(p => +p.w.toFixed(1)),
    points: outPts, curvature: kr.map(k => +k.toFixed(4)),
    startFinish: mk(0, { width: r2(pts[0].w) }),
    checkpoints: cps.map((i, k) => mk(i, { n: k + 1, width: r2(pts[i].w) })),
    corners: corners.map(c => ({ ...c, ...(() => { const p = pts[c.apex]; return { x: r2(p.x), y: r2(ptY[c.apex]), z: r2(p.z) }; })() })),
    apexes: corners.map(c => c.apex), straights, roundabouts: rbRanges,
    junctions: uniq.map(u => ({ ...u, index: idx(u.index) })).sort((a, b) => a.index - b.index),
    pit, stands, spawns, keepout, barriers,
    start: { x: r2(pts[0].x), y: r2(ptY[0] + 0.15), z: r2(pts[0].z), heading: r2(hdr[0]) },
    clearance: { left: clrL, right: clrR },
    stats: { corners: corners.length, hairpins: m.hairpins, longestStraight: Math.round(m.longest), straightPct: Math.round(m.straightFrac * 100), elevationRange: r2(m.range), maxGradePct: r2(m.maxG * 100), minR: r2(m.minR), avgWidth: r2(m.avgW), gain: Math.round(m.gain), pitSideRoom: best.room },
    bounds: { minX: r2(Math.min(...pts.map(p => p.x))), maxX: r2(Math.max(...pts.map(p => p.x))), minZ: r2(Math.min(...pts.map(p => p.z))), maxZ: r2(Math.max(...pts.map(p => p.z))) },
  };
}

// ------------------------------------------------------------------ choose + write
const A = byTech[0], B = byFast.find(c => c !== A && sharedFrac(c, A) < 0.15 && sharedFrac(A, c) < 0.15) ?? byFast[1];
console.log(describe(A, 'CHOSEN republic')); console.log(describe(B, 'CHOSEN northern'));
const circuits = [
  finalise(A, 'republic-loop', 'Republic Loop', 'Հանրապետության օղակ', 'technical'),
  finalise(B, 'northern-avenue-run', 'Northern Avenue Run', 'Հյուսիսային պողոտայի վազք', 'fast'),
];
fs.mkdirSync('public/map', { recursive: true });
fs.writeFileSync('public/map/circuits.json', JSON.stringify(circuits));
for (const c of circuits) console.log(c.id, 'length', c.length, 'corners', c.corners.length, JSON.stringify(c.stats), 'junction mouths', c.junctions.length, 'pit', JSON.stringify(c.pit));
console.log('wrote public/map/circuits.json', (fs.statSync('public/map/circuits.json').size / 1024).toFixed(0), 'KB');

if (DEBUG) {
  const S = 0.9, cell = 1000, parts = [];
  for (let k = 0; k < circuits.length; k++) {
    const c = circuits[k], b = c.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const X = x => ((x - cx) * S + cell / 2).toFixed(1), Z = z => ((z - cz) * S + cell / 2).toFixed(1);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cell + '" height="' + cell + '"><rect width="100%" height="100%" fill="#141414"/>';
    for (let i = 0; i < RN; i += 1) { /* building raster is drawn below */ }
    // buildings (coarse)
    for (let j = 0; j < RN; j += 2) for (let i = 0; i < RN; i += 2) if (bld[j * RN + i]) { const x = (i + 0.5) * RES - RX, z = (j + 0.5) * RES - RX; const sx = (x - cx) * S + cell / 2, sz = (z - cz) * S + cell / 2; if (sx > -4 && sx < cell + 4 && sz > -4 && sz < cell + 4) svg += '<rect x="' + sx.toFixed(0) + '" y="' + sz.toFixed(0) + '" width="4" height="4" fill="#2a2a2a"/>'; }
    for (const e of E) svg += '<polyline fill="none" stroke="#333" stroke-width="1" points="' + e.pts.map(q => X(q[0]) + ',' + Z(q[1])).join(' ') + '"/>';
    const pl = []; for (let i = 0; i < c.points.length / 3; i += 3) pl.push(X(c.points[i * 3]) + ',' + Z(c.points[i * 3 + 2]));
    svg += '<polyline fill="none" stroke="#6cf" stroke-width="3" points="' + pl.join(' ') + '"/>';
    for (const co of c.corners) svg += '<circle cx="' + X(co.x) + '" cy="' + Z(co.z) + '" r="' + (3 + co.severity) + '" fill="' + ['', '#4f4', '#af4', '#ff4', '#fa4', '#f44'][co.severity] + '"/><text x="' + (+X(co.x) + 6) + '" y="' + (+Z(co.z) - 6) + '" fill="#fff" font-size="12">' + co.n + (co.dir) + '</text>';
    for (const cp of c.checkpoints) svg += '<rect x="' + (+X(cp.x) - 3) + '" y="' + (+Z(cp.z) - 3) + '" width="6" height="6" fill="#0ff"/>';
    for (const jn of c.junctions) svg += '<line x1="' + X(jn.x) + '" y1="' + Z(jn.z) + '" x2="' + X(jn.x + jn.dx * 25) + '" y2="' + Z(jn.z + jn.dz * 25) + '" stroke="#f0f" stroke-width="2"/>';
    svg += '<rect x="' + (+X(c.startFinish.x) - 5) + '" y="' + (+Z(c.startFinish.z) - 5) + '" width="10" height="10" fill="#fff"/><circle cx="' + X(c.pit.x) + '" cy="' + Z(c.pit.z) + '" r="6" fill="#f80"/>';
    svg += '<text x="8" y="20" fill="#fff" font-size="16">' + c.name + ' ' + c.length + ' m</text></svg>';
    parts.push({ input: Buffer.from(svg), left: k * cell, top: 0 });
  }
  await sharp({ create: { width: cell * circuits.length, height: cell, channels: 3, background: '#000' } }).composite(parts).png().toFile('.scratch/circuits-debug.png');
}
