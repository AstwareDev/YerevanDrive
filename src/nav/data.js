// Road graph + routing for the in-game GPS (data from tools/build-nav.mjs -> public/map/nav.json).
//   Nav.snap(x, z)             nearest drivable road point
//   Nav.route(from, to)        edge-based A* (turn penalties, one-ways, no U-turns except at the start) -> polyline + manoeuvres
//   Nav.streetAt(x, z)         name of the street under a point (reverse geocode)
// Local frame: x east, z south (north = -z). Headings are atan2(dx, dz) like the car (0 = +z = south).
const SPEED = [28, 20, 15, 13, 11, 9, 8, 5, 4.5, 3];                // m/s by class: motorway trunk primary secondary tertiary unclassified residential living_street service pedestrian
export const CLASS_NAMES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living street', 'service road', 'pedestrian'];
const CELL = 64;

export class Nav {
  constructor(j) {
    this.j = j; this.names = j.names; this.region = j.region;
    const N = this.N = j.nodes.length / 2;
    this.X = new Float32Array(N); this.Z = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.X[i] = j.nodes[i * 2] / 10; this.Z[i] = j.nodes[i * 2 + 1] / 10; }
    const ways = this.ways = j.ways;                                  // [cls, name, oneway, flags, maxspeed, ...nodes]
    // ---- segments + directed edges ------------------------------------------------------------------
    const segA = [], segB = [], segW = [], segF = [], segR = [];
    const eFrom = [], eTo = [], eCost = [], eLen = [], eSeg = [];
    const edgeCost = (w, len) => {
      const [cls, , , flags, ms] = ways[w]; let v = SPEED[cls]; if (ms > 0) v = Math.min(v * 1.4, ms / 3.6 * 0.75); if (flags & 8) v *= 0.8;
      let pen = 1; if (flags & 4) pen = 4; else if (cls === 8) pen = 1.8; else if (cls === 7) pen = 1.3;
      return len / v * pen;
    };
    const R = this.region, m = 45;
    const inside = i => this.X[i] > R.x0 + m && this.X[i] < R.x1 - m && this.Z[i] > R.z0 + m && this.Z[i] < R.z1 - m;     // the car cannot leave the drivable region
    ways.forEach((w, wi) => {
      if (w[3] & 2) return;                                            // render-only (pedestrian, private, ...)
      for (let k = 5; k < w.length - 1; k++) {
        const a = w[k], b = w[k + 1]; if (!inside(a) || !inside(b)) continue; const len = Math.hypot(this.X[b] - this.X[a], this.Z[b] - this.Z[a]); if (len < 0.01) continue;
        const s = segA.length; segA.push(a); segB.push(b); segW.push(wi);
        const c = edgeCost(wi, len); let f = -1, r = -1;
        if (w[2] >= 0) { f = eFrom.length; eFrom.push(a); eTo.push(b); eCost.push(c); eLen.push(len); eSeg.push(s); }
        if (w[2] <= 0) { r = eFrom.length; eFrom.push(b); eTo.push(a); eCost.push(c); eLen.push(len); eSeg.push(s); }
        segF.push(f); segR.push(r);
      }
    });
    this.segA = Int32Array.from(segA); this.segB = Int32Array.from(segB); this.segW = Int32Array.from(segW); this.segF = Int32Array.from(segF); this.segR = Int32Array.from(segR);
    this.eFrom = Int32Array.from(eFrom); this.eTo = Int32Array.from(eTo); this.eCost = Float32Array.from(eCost); this.eLen = Float32Array.from(eLen); this.eSeg = Int32Array.from(eSeg);
    const E = this.E = eFrom.length;
    // CSR adjacency: outgoing edges per node
    const cnt = new Int32Array(N + 1); for (let e = 0; e < E; e++) cnt[eFrom[e] + 1]++;
    for (let i = 0; i < N; i++) cnt[i + 1] += cnt[i];
    this.adjStart = cnt; this.adj = new Int32Array(E); const fill = cnt.slice(0, N); for (let e = 0; e < E; e++) this.adj[fill[eFrom[e]]++] = e;
    // ---- spatial grid over segments -----------------------------------------------------------------
    this.grid = new Map();
    for (let s = 0; s < segA.length; s++) {
      const a = segA[s], b = segB[s]; const x0 = Math.min(this.X[a], this.X[b]), x1 = Math.max(this.X[a], this.X[b]), z0 = Math.min(this.Z[a], this.Z[b]), z1 = Math.max(this.Z[a], this.Z[b]);
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let k = Math.floor(z0 / CELL); k <= Math.floor(z1 / CELL); k++) { const key = i * 8192 + k; let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); c.push(s); }
    }
    // roundabout membership per edge
    this.isRound = e => (ways[this.segW[this.eSeg[e]]][3] & 1) !== 0;
  }
  name(i) { const n = this.names[i]; return n ? (n[1] || n[0]) : ''; }
  wayName(wi) { return this.name(this.ways[wi][1]); }

  /** nearest drivable segment point within maxD metres (any direction). Returns null when nothing is near. */
  snap(x, z, maxD = 120) {
    let best = null, bd = maxD * maxD;
    const r = Math.ceil(maxD / CELL);
    for (let i = Math.floor(x / CELL) - r; i <= Math.floor(x / CELL) + r; i++) for (let k = Math.floor(z / CELL) - r; k <= Math.floor(z / CELL) + r; k++) {
      const c = this.grid.get(i * 8192 + k); if (!c) continue;
      for (const s of c) {
        const a = this.segA[s], b = this.segB[s], ax = this.X[a], az = this.Z[a], dx = this.X[b] - ax, dz = this.Z[b] - az, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = (x - px) ** 2 + (z - pz) ** 2;
        if (d < bd) { bd = d; best = { seg: s, t, x: px, z: pz, dist: Math.sqrt(d) }; }
      }
    }
    if (best) { const s = best.seg; best.way = this.segW[s]; best.name = this.wayName(best.way); best.cls = this.ways[best.way][0]; best.heading = Math.atan2(this.X[this.segB[s]] - this.X[this.segA[s]], this.Z[this.segB[s]] - this.Z[this.segA[s]]); best.oneway = this.ways[best.way][2]; if (best.oneway < 0) best.heading += Math.PI; }
    return best;
  }
  /** street name near a point ('' if none within maxD) */
  streetAt(x, z, maxD = 60) {
    let best = null, bd = maxD * maxD;
    const r = Math.ceil(maxD / CELL);
    for (let i = Math.floor(x / CELL) - r; i <= Math.floor(x / CELL) + r; i++) for (let k = Math.floor(z / CELL) - r; k <= Math.floor(z / CELL) + r; k++) {
      const c = this.grid.get(i * 8192 + k); if (!c) continue;
      for (const s of c) {
        const w = this.ways[this.segW[s]]; if (w[1] < 0) continue;
        const a = this.segA[s], b = this.segB[s], ax = this.X[a], az = this.Z[a], dx = this.X[b] - ax, dz = this.Z[b] - az, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
        if (d < bd) { bd = d; best = w[1]; }
      }
    }
    return best === null ? '' : this.name(best);
  }

  // ---------------------------------------------------------------------------------------------- routing
  /** from {x,z,heading}, to {x,z} -> route or null. */
  route(from, to) {
    const s0 = this.snap(from.x, from.z, 160), s1 = this.snap(to.x, to.z, 400); if (!s0 || !s1) return null;
    const { eFrom, eTo, eCost, eLen, eSeg, adjStart, adj, X, Z } = this;
    const E = this.E, g = new Float32Array(E).fill(1e9), prev = new Int32Array(E).fill(-1), closed = new Uint8Array(E);
    const tx = s1.x, tz = s1.z, VMAX = 28;
    const hFn = e => Math.hypot(X[eTo[e]] - tx, Z[eTo[e]] - tz) / VMAX;
    // binary heap of [f, edge]
    const hf = [], he = [];
    const push = (f, e) => { let i = hf.length; hf.push(f); he.push(e); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; he[i] = he[p]; i = p; } hf[i] = f; he[i] = e; };
    const pop = () => { const f0 = hf[0], e0 = he[0]; const f = hf.pop(), e = he.pop(); const n = hf.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= f) break; hf[i] = hf[c]; he[i] = he[c]; i = c; } hf[i] = f; he[i] = e; } return [f0, e0]; };
    // start states: being at the END of a directed edge of the start segment, after driving its remainder
    const hx = Math.sin(from.heading ?? 0), hz = Math.cos(from.heading ?? 0);
    const dirOf = e => { const dx = X[eTo[e]] - X[eFrom[e]], dz = Z[eTo[e]] - Z[eFrom[e]], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const startEdges = [];
    for (const [e, frac] of [[this.segF[s0.seg], 1 - s0.t], [this.segR[s0.seg], s0.t]]) {
      if (e < 0) continue; const d = dirOf(e); const along = d[0] * hx + d[1] * hz;
      const pen = from.heading === undefined ? 0 : along < -0.2 ? 14 : 0;           // wrong-way start = U-turn needed
      const c = frac * eCost[e] + pen; g[e] = c; prev[e] = -2; startEdges.push(e); push(c + hFn(e), e);
    }
    if (!startEdges.length) return null;
    // target edges: arriving on either directed edge of the destination segment
    const tF = this.segF[s1.seg], tR = this.segR[s1.seg];
    const targetFrac = new Map(); if (tF >= 0) targetFrac.set(tF, s1.t); if (tR >= 0) targetFrac.set(tR, 1 - s1.t);
    let best = 1e18, bestPrev = -1, bestEdge = -1, bestSame = false;
    // the start segment is also the target segment (drive straight to it)
    for (const e of startEdges) { const f = targetFrac.get(e); if (f !== undefined) { const startFrac = e === this.segF[s0.seg] ? s0.t : 1 - s0.t; if (f > startFrac) { const c = (f - startFrac) * eCost[e]; if (c < best) { best = c; bestEdge = e; bestPrev = -2; bestSame = true; } } } }
    const turnPen = (e1, e2) => {
      const a = dirOf(e1), b = dirOf(e2), dot = a[0] * b[0] + a[1] * b[1], cr = a[0] * b[1] - a[1] * b[0]; const ang = Math.abs(Math.atan2(cr, dot));
      if (eTo[e1] === eFrom[e2] && eFrom[e1] === eTo[e2]) return 40;                // U-turn
      let p = ang < 0.5 ? 0 : ang < 1.75 ? 3 : 8; if (cr < 0 && ang > 0.5) p += 2;     // drive on the right: turning left crosses traffic
      return p;
    };
    let iters = 0;
    while (hf.length) {
      const [f, e] = pop(); if (f >= best) break; if (closed[e]) continue; closed[e] = 1; if (++iters > 400000) break;
      const n = eTo[e], ge = g[e];
      for (let k = adjStart[n]; k < adjStart[n + 1]; k++) {
        const e2 = adj[k]; if (eTo[e2] === eFrom[e] && eFrom[e2] === eTo[e] && adjStart[n + 1] - adjStart[n] > 1) continue;    // no U-turn unless dead end
        const tp = turnPen(e, e2);
        const tf = targetFrac.get(e2); if (tf !== undefined) { const c = ge + tp + tf * eCost[e2]; if (c < best) { best = c; bestPrev = e; bestEdge = e2; bestSame = false; } }
        const c = ge + tp + eCost[e2]; if (c < g[e2]) { g[e2] = c; prev[e2] = e; push(c + hFn(e2), e2); }
      }
    }
    if (bestEdge < 0) return null;
    // ---- rebuild edge list
    const edges = []; if (!bestSame) { edges.push(bestEdge); let e = bestPrev; while (e >= 0) { edges.push(e); e = prev[e]; } edges.reverse(); } else edges.push(bestEdge);
    // ---- polyline: start snap -> end of each edge -> destination snap (cut inside the target edge)
    const pts = [s0.x, s0.z]; const ptEdge = [edges[0]];
    for (let i = 0; i < edges.length; i++) { const e = edges[i]; if (i === edges.length - 1) break; pts.push(X[eTo[e]], Z[eTo[e]]); ptEdge.push(edges[i + 1]); }
    pts.push(s1.x, s1.z); ptEdge.push(edges[edges.length - 1]);
    // when the start is on the target edge and we drive straight: pts = [start, dest]
    const np = pts.length / 2, cum = new Float32Array(np);
    for (let i = 1; i < np; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const route = { pts: Float32Array.from(pts), cum, edges, ptEdge, len: cum[np - 1], time: best, dest: { x: s1.x, z: s1.z, name: s1.name }, start: { x: s0.x, z: s0.z } };
    route.maneuvers = this.maneuvers(route);
    return route;
  }

  // ---------------------------------------------------------------------------------------------- manoeuvres
  maneuvers(route) {
    const { pts, cum, edges } = route; const np = pts.length / 2, out = [];
    const nm = e => this.wayName(this.segW[this.eSeg[e]]);
    const pointAt = s => { s = Math.max(0, Math.min(cum[np - 1], s)); let i = 1; while (i < np - 1 && cum[i] < s) i++; const k = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [pts[i * 2 - 2] + (pts[i * 2] - pts[i * 2 - 2]) * k, pts[i * 2 - 1] + (pts[i * 2 + 1] - pts[i * 2 - 1]) * k]; };
    // point i of the polyline sits at the END of edge (i-1) == start of edge i (route.ptEdge[i] = the edge that starts there)
    for (let i = 1; i < np - 1; i++) {
      const eIn = edges[i - 1], eOut = edges[i]; if (eOut === undefined) break; const n = this.eTo[eIn];
      let choices = 0; for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) if (this.eTo[this.adj[k]] !== this.eFrom[eIn]) choices++;
      const wayChanged = this.segW[this.eSeg[eIn]] !== this.segW[this.eSeg[eOut]]; const s = cum[i];
      const ringIn = this.isRound(eIn), ringOut = this.isRound(eOut);
      if (ringIn) continue;
      const nameIn = nm(eIn), nameOut = nm(eOut);
      if (ringOut) {
        // count exits until the route leaves the ring
        let exits = 0, j = i; for (; j < edges.length; j++) { const e = edges[j]; if (!this.isRound(e)) break; const nn = this.eTo[e]; let off = 0; for (let k = this.adjStart[nn]; k < this.adjStart[nn + 1]; k++) if (!this.isRound(this.adj[k])) off++; if (off && j + 1 < edges.length && !this.isRound(edges[j + 1])) { exits++; break; } if (off) exits++; }
        out.push({ s, i, type: 'roundabout', exit: Math.max(1, exits), name: j + 1 < edges.length ? nm(edges[j + 1]) : nameOut });
        continue;
      }
      if (choices < 2 && !wayChanged) continue;
      const a = pointAt(s - 22), b = pointAt(s), c = pointAt(s + 22);
      const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = c[0] - b[0], d2z = c[1] - b[1];
      const ang = Math.atan2(d1x * d2z - d1z * d2x, d1x * d2x + d1z * d2z) * 57.2958;       // + = right (x east, z south)
      const aa = Math.abs(ang); let type = null;
      if (choices >= 2 || wayChanged) { if (aa > 168) type = 'uturn'; else if (aa > 125) type = ang > 0 ? 'sharp-right' : 'sharp-left'; else if (aa > 55) type = ang > 0 ? 'right' : 'left'; else if (aa > 25) type = ang > 0 ? 'slight-right' : 'slight-left'; }
      if (!type && nameIn !== nameOut && nameOut) type = 'continue';
      if (!type) continue;
      out.push({ s, i, type, name: nameOut, from: nameIn, angle: ang });
    }
    // merge: a 'continue' onto a different name right after another manoeuvre is noise; drop manoeuvres < 12 m apart (keep the last one)
    const merged = []; for (const m of out) { const p = merged[merged.length - 1]; if (p && m.s - p.s < 12 && (p.type === 'continue' || m.type !== 'continue')) merged[merged.length - 1] = m; else if (!(p && m.s - p.s < 12 && m.type === 'continue')) merged.push(m); }
    merged.push({ s: cum[np - 1], i: np - 1, type: 'arrive', name: route.dest.name });
    return merged;
  }
}

export const maneuverText = m => {
  const on = m.name ? ` onto ${m.name}` : '';
  switch (m.type) {
    case 'left': return 'Turn left' + on; case 'right': return 'Turn right' + on;
    case 'slight-left': return 'Bear left' + on; case 'slight-right': return 'Bear right' + on;
    case 'sharp-left': return 'Sharp left' + on; case 'sharp-right': return 'Sharp right' + on;
    case 'uturn': return 'Make a U-turn';
    case 'continue': return m.name ? `Continue on ${m.name}` : 'Continue';
    case 'roundabout': return `At the roundabout take exit ${m.exit}` + on;
    case 'arrive': return m.name ? `Arrive at ${m.name}` : 'Arrive at your destination';
  }
  return '';
};
export const fmtDist = m => m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
export const fmtTime = s => s < 90 ? '1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
