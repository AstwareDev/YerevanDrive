
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
    for (let d = -60; d <= 120; d += 4) { const j = mod(i + d, n); if (Math.abs(kap[j]) > 1 / 500 || P[j].rb) { ok = false; break; } if (d >= -30 && d <= 90) { cl[0] = Math.min(cl[0], clr[0][j]); cl[1] = Math.min(cl[1], clr[1][j]); } }
    if (!ok) continue;
    let jp = 0; for (const j of junctionIdx) { const d = mod(j - i + 60, n) - 60; if (d > -40 && d < 70) jp++; }
    const side = cl[1] >= cl[0] ? 'R' : 'L', room = Math.max(cl[0], cl[1]);
    const score = Math.min(room, 22) * 1.0 - jp * 6 + Math.min(P[i].w, 16) * 0.3;
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
  // pit lane: parallel to the finish straight on the side with most room
  const side = best.side, sg = side === 'R' ? 1 : -1, f0 = frame(0), rn0 = [-f0[1], f0[0]];
  const pitOff = pts[0].w / 2 + 3.2, pitIdx = mod(-10, n);
  const pitC = pts[pitIdx];
  const pit = { x: r2(pitC.x + rn0[0] * sg * pitOff), y: r2(H(pitC.x + rn0[0] * sg * pitOff, pitC.z + rn0[1] * sg * pitOff) + 0.12), z: r2(pitC.z + rn0[1] * sg * pitOff), heading: r2(hdr[pitIdx]), side, index: pitIdx, length: 96, offset: r2(pitOff), room: best.room };
  // grid: 8 slots, 2 columns staggered, behind the line
  const spawns = [], hw0 = pts[0].w / 2, lat = Math.min(2.3, hw0 * 0.3);
  for (let k = 0; k < 8; k++) {
    const row = k >> 1, col = k & 1, back = 7 + row * 8 + (col ? 4 : 0), i = mod(-Math.round(back / ds), n), f = frame(i), r = [-f[1], f[0]], l = (col ? 1 : -1) * lat;
    spawns.push({ slot: k, index: i, x: r2(pts[i].x + r[0] * l), y: r2(H(pts[i].x + r[0] * l, pts[i].z + r[1] * l) + 0.2), z: r2(pts[i].z + r[1] * l), heading: r2(hdr[i]) });
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
    pit, spawns,
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
