
// ------------------------------------------------------------------ smoothing: fillets at corners -> 1 m resample -> gaussian
const pathPolyline = path => {   // oriented path -> raw vertices {x,z,w,j,rb}
  const V = [];
  path.forEach((a, pi) => {
    const e = E[a.e], pts = a.rev ? e.pts.slice().reverse() : e.pts, ch = a.rev ? e.chain.slice().reverse() : e.chain, n = ch.length;
    const wAt = k => (ch[Math.max(0, k - 1)].wd + ch[Math.min(n - 1, k)].wd) / 2;
    const rbAt = k => !!(ch[Math.max(0, k - 1)].rb || ch[Math.min(n - 1, k)].rb);
    for (let k = pi > 0 ? 1 : 0; k < pts.length; k++) {
      if (pi === path.length - 1 && k === pts.length - 1) break; // last vertex == first vertex of path
      V.push({ x: pts[k][0], z: pts[k][1], w: wAt(k), j: k === 0, rb: rbAt(k), edge: pi });
    }
  });
  return V;
};
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
    const r = b.j ? clamp(0.9 * b.w + 6, 11, 24) : 160;
    const t = Math.min(r * Math.tan(th / 2), 0.48 * l1, 0.48 * l2), re = t / Math.tan(th / 2);
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
  const V = pathPolyline(path), F = filletLoop(V), { pts } = resampleLoop(F, 1);
  const xs = gaussLoop(pts, 2.2, p => p.x), zs = gaussLoop(pts, 2.2, p => p.z), ws = gaussLoop(pts, 8, p => p.w);
  pts.forEach((p, i) => { p.x = xs[i]; p.z = zs[i]; p.w = ws[i]; });
  let len = 0; for (let i = 0; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[(i + 1) % pts.length].x, pts[i].z - pts[(i + 1) % pts.length].z);
  return { pts, L: len, raw: V };
}

// ------------------------------------------------------------------ analysis (heading, curvature, corners, elevation)
function analyse(sm) {
  const P = sm.pts, n = P.length, ds = sm.L / n;
  const hd = new Array(n);
  for (let i = 0; i < n; i++) { const a = P[(i + n - 2) % n], b = P[(i + 2) % n]; hd[i] = Math.atan2(b.x - a.x, b.z - a.z); }
  // signed curvature, + = right turn. forward f=(sin h, cos h); heading north h=pi, turning right (east) => h decreases => d<0 => kap>0
  const kap = new Array(n), K = 5;
  for (let i = 0; i < n; i++) {
    const a = hd[(i - K + n) % n], b = hd[(i + K) % n]; let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    kap[i] = -d / (2 * K * ds);
  }
  const kS = gaussLoop(kap, 3);
  const TH = 1 / 150, inCorner = kS.map(k => Math.abs(k) > TH), run = [];
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
    if (angle < 14) continue;
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
  const sweepers = corners.filter(c => c.minR >= 60 && c.angle >= 18).length;
  const mediums = corners.filter(c => c.minR >= 25 && c.minR < 60 && c.angle >= 25).length;
  return { hd, kap: kS, corners, y, yS, gain, maxG, range: ymax - ymin, straights, longest, straightFrac: straightLen2 / sm.L, minR, tightN, selfProx: near / Math.ceil(n / 4), meanDist, cx, cz, rbLen, avgW, minW, square, hairpins, sweepers, mediums, n, ds };
}

// ------------------------------------------------------------------ scoring + selection
const wrongLen = p => p.reduce((s, a) => s + (E[a.e].flow && (E[a.e].flow > 0) === a.rev ? E[a.e].len : 0), 0);
const orient = path => { // travel direction that follows one-way streets best
  const rv = path.slice().reverse().map(a => ({ e: a.e, rev: !a.rev }));
  return wrongLen(rv) < wrongLen(path) ? rv : path;
};
const gauss = (x, mu, sg) => Math.exp(-((x - mu) ** 2) / (2 * sg * sg));
function scoreTech(m, L, wrong) {
  return 6 * gauss(L, 1900, 450) + Math.min(m.rbLen, 320) / 70 + 3 * gauss(m.meanDist, 260, 220) +
    0.55 * Math.min(m.corners.length, 16) + 0.9 * Math.min(m.hairpins, 2) + 0.5 * Math.min(m.mediums, 4) + 0.5 * Math.min(m.sweepers, 4) +
    0.6 * Math.min(m.longest / 150, 2) - 1.3 * Math.max(0, m.square - 5) - 12 * m.selfProx - 3 * wrong - 0.8 * m.tightN +
    2 * gauss(m.range, 14, 10) - 40 * Math.max(0, m.maxG - 0.09) + Math.min(m.avgW, 14) / 6;
}
function scoreFast(m, L, wrong) {
  return 6 * gauss(L, 2700, 380) + Math.min(m.longest, 700) / 110 + 4 * m.straightFrac + 0.55 * Math.min(m.sweepers, 6) + 0.4 * Math.min(m.mediums, 4) +
    Math.min(m.avgW, 16) / 3 + 0.7 * Math.min(m.corners.length, 10) - 1.6 * Math.max(0, m.square - 4) - 12 * m.selfProx - 3 * wrong - 0.8 * m.tightN +
    2 * gauss(m.range, 22, 14) - 40 * Math.max(0, m.maxG - 0.09) + 2 * clamp(-m.cz / 300, -0.5, 1) + 0.5 * Math.min(m.hairpins, 1) - 0.3 * Math.min(m.rbLen / 80, 3);
}
const t1 = Date.now();
const evald = [];
for (const c of cands) {
  const path = orient(c.path), sm = smoothLoop(path), m = analyse(sm);
  if (m.minW < 5.9 || m.maxG > 0.1 || m.selfProx > 0.12 || m.tightN > 3) continue;
  const wrong = wrongLen(path) / c.f.L;
  evald.push({ path, sm, m, L: sm.L, wrong, edges: new Set(path.map(a => a.e)), tech: scoreTech(m, sm.L, wrong), fast: scoreFast(m, sm.L, wrong) });
}
console.log('evaluated', evald.length, 'in', Date.now() - t1, 'ms');
const sharedFrac = (a, b) => { let s = 0, t = 0; for (const e of a.edges) { t += E[e].len; if (b.edges.has(e)) s += E[e].len; } return s / t; };
const byTech = evald.slice().sort((a, b) => b.tech - a.tech), byFast = evald.slice().sort((a, b) => b.fast - a.fast);
const describe = (c, tag) => `${tag} L=${c.L.toFixed(0)} corners=${c.m.corners.length} sq=${c.m.square} hp=${c.m.hairpins} sw=${c.m.sweepers} med=${c.m.mediums} longest=${c.m.longest.toFixed(0)} straight%=${(c.m.straightFrac * 100).toFixed(0)} avgW=${c.m.avgW.toFixed(1)} minW=${c.m.minW.toFixed(1)} rb=${c.m.rbLen.toFixed(0)} range=${c.m.range.toFixed(0)} maxG=${(c.m.maxG * 100).toFixed(1)}% c=(${c.m.cx.toFixed(0)},${c.m.cz.toFixed(0)}) wrong=${(c.wrong * 100).toFixed(0)}% tech=${c.tech.toFixed(1)} fast=${c.fast.toFixed(1)}`;
console.log('--- top technical'); byTech.slice(0, 6).forEach((c, i) => console.log(describe(c, 'T' + i)));
console.log('--- top fast'); byFast.slice(0, 6).forEach((c, i) => console.log(describe(c, 'F' + i)));
