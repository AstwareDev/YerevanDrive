// Edge dressing along a circuit: tyre walls, W-beam guardrails, jersey barriers (incl. closed junction mouths), cones, tyre markers,
// rumble kerbs, skid marks, oil stains, painted grid / start line / pit lane. Everything is added to shared cell-bucketed batches.
import { mkRng, lin, clamp, mod } from './util.js';

const WHITE = lin('#e6e6e1'), BLACK = lin('#1b1b1d'), RED = lin('#c3161c'), BLUE = lin('#1d4fb3'), YELLOW = lin('#e9b500'), GREY = lin('#6c6f75');
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** draped ribbon between lateral offsets lat0..lat1 (+ = right of travel) over index range [i0, i0+len]; uv rect [u0,v0,u1,v1], v scales with arc length / vLen */
export function ribbon(gb, tr, i0, len, lat0, lat1, yoff, uv, { vLen = 1, step = 1, tint, latFn = null, widthFn = null } = {}) {
  const f = {}, n = Math.max(1, Math.ceil(len / step));
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const i = i0 + (k / n) * len; tr.at(i, 0, f);
    const o0 = latFn ? latFn(k / n, i) : lat0, o1 = widthFn ? o0 + widthFn(k / n, i) : lat1, rx = f.rx, rz = f.rz;
    const ax = f.cx + rx * o0, az = f.cz + rz * o0, bx = f.cx + rx * o1, bz = f.cz + rz * o1;
    const v = uv[1] + (uv[3] - uv[1]) * ((k / n) * len / vLen);
    const A = gb.vert(ax, tr.H(ax, az) + yoff, az, 0, 1, 0, uv[0], v, tint), B = gb.vert(bx, tr.H(bx, bz) + yoff, bz, 0, 1, 0, uv[2], v, tint);
    if (prev) { // winding: seen from above (+y), forward = (tx,tz), right = (-tz,tx): A is the left-hand (lat0) edge when lat0 < lat1
      gb.tri(prev[0], prev[1], B); gb.tri(prev[0], B, A);
    }
    prev = [A, B];
  }
}

export function dressTrack(kit, tr) {
  const { quality, batches: B, gb: G, tex } = kit, c = tr.c, n = tr.n, ds = tr.ds, ps = quality.propScale, H = tr.H;
  const rng = mkRng(hashStr(tr.id)), f = {}, f2 = {};
  const lowQ = quality.level === 'low', highQ = quality.level === 'high' || quality.level === 'ultra';
  const sideSign = s => (s === 'R' ? 1 : -1);
  const outsideOf = co => (co.dir === 'R' ? -1 : 1);                 // +1 right of travel, -1 left
  const cover = [new Uint8Array(n), new Uint8Array(n)];              // [left, right]; 0 free, 1 tyres, 2 rail, 3 jersey, 4 mouth
  const cv = sg => cover[sg > 0 ? 1 : 0];
  const mark = (arr, i0, len, val, overwrite = false) => { for (let q = 0; q <= len; q++) { const i = mod(Math.round(i0 + q), n); if (overwrite || arr[i] === 0) arr[i] = val; } };
  const stats = { tyres: 0, rails: 0, barriers: 0, cones: 0 };
  kit.walls[tr.id] = [];
  const GROUND = 0.09;

  // ------------------------------------------------------------ tyre walls on the outside of corners
  const walls = [];
  for (const co of c.corners) {
    if (co.severity < 2 || (lowQ && co.severity < 3)) continue;
    const sg = outsideOf(co), sev = co.severity;
    const pre = sev >= 4 ? 18 : sev === 3 ? 10 : 6, post = sev >= 4 ? 38 : sev === 3 ? 26 : 14;
    const i0 = co.entry - pre / ds, len = (pre + co.len + post) / ds;
    walls.push({ co, sg, i0, len, rows: sev >= 3 ? (lowQ ? 2 : 3) : 2, cols: sev >= 3 && !lowQ ? 2 : 1, style: sev >= 4 ? 'rw' : 'bw' });
    mark(cv(sg), i0, len, 1);
  }
  kit.walls[tr.id] = walls; kit.stats[tr.id] = stats;
  const tyreSpacing = lowQ ? 0.95 : 0.66, TINT = 1.5;
  for (const w of walls) {
    const nSteps = Math.floor(w.len * ds / tyreSpacing);
    for (let k = 0; k <= nSteps; k++) {
      const i = w.i0 + k * tyreSpacing / ds; tr.at(i, 0, f);
      const room = tr.clear(i, w.sg), cols = room >= 3.4 ? w.cols : 1;
      for (let col = 0; col < cols; col++) for (let layer = 0; layer < w.rows; layer++) {
        const stag = (layer & 1) ? tyreSpacing * 0.5 : 0, ii = i + stag / ds; tr.at(ii, 0, f);
        const lat = w.sg * (f.hw + 0.5 + col * 0.62 + (rng() - 0.5) * 0.03), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat;
        const parity = (k + layer + col) & 1;
        const base = w.style === 'rw' ? (parity ? RED : WHITE) : (parity ? WHITE : BLACK), tint = rng() < 0.12 ? BLACK : base;
        const dirt = 0.78 + rng() * 0.22;
        const lodMask = col > 0 ? 0b0011 : layer > 0 ? 0b0111 : 0b1111;   // bits = LOD levels: inner columns / upper layers only at close range; level 3 = one stack proxy per column of tyres
        B.tyre.add(x, H(x, z) + GROUND + layer * 0.255, z, rng() * 6.283, 1 + (rng() - 0.5) * 0.06, 1, 1 + (rng() - 0.5) * 0.06, [tint[0] * dirt * TINT, tint[1] * dirt * TINT, tint[2] * dirt * TINT], lodMask, w.rows);
        stats.tyres++;
      }
    }
  }

  // ------------------------------------------------------------ junction mouths: close them with jersey barriers along the edge line
  const mouthSpans = [[], []];
  for (const m of c.junctions) {
    const sg = sideSign(m.side), half = m.width / 2 + 3.2, i0 = m.index - half / ds, len = 2 * half / ds;
    if (cv(sg)[mod(m.index, n)] === 1) continue;
    const spans = mouthSpans[sg > 0 ? 1 : 0], last = spans[spans.length - 1];
    if (last && i0 <= last[0] + last[1] + 2) { last[1] = Math.max(last[1], i0 + len - last[0]); } else spans.push([i0, len]);
  }
  for (let sd = 0; sd < 2; sd++) for (const [i0, len] of mouthSpans[sd]) {
    const sg = sd ? 1 : -1; mark(cover[sd], i0, len, 4);
    if (lowQ && rng() < 0.4) continue;
    // free (unblocked) portion only
    for (let s = 0; s < len * ds - 1.5; s += 3) {
      const i = i0 + (s + 1.5) / ds; if (cover[sd][mod(Math.round(i), n)] === 1) continue; tr.at(i, 0, f);
      const lat = sg * (f.hw + 0.85), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat;
      B.barrier.add(x, H(x, z) + GROUND, z, f.yaw, 1, 1, 1); stats.barriers++;
    }
  }

  // ------------------------------------------------------------ free stretches: W-beam guardrail or jersey barriers along the edges
  for (let sd = 0; sd < 2; sd++) {
    const sg = sd ? 1 : -1, arr = cover[sd]; let i = 0;
    // start at a covered index so runs do not wrap
    let start = arr.findIndex(v => v !== 0); if (start < 0) start = 0;
    for (let q = 0; q < n;) {
      const idx = mod(start + q, n);
      if (arr[idx] !== 0) { q++; continue; }
      let r = q; while (r < n && arr[mod(start + r, n)] === 0) r++;
      const len = r - q, lenM = len * ds;
      if (lenM >= 18) {
        const keep = rng() < Math.min(1, 0.25 + ps * 0.8) ;
        const margin = 4 / ds, a0 = start + q + margin, a1 = start + r - margin;
        if (keep && a1 - a0 > 6) {
          const useRail = rng() < 0.62, nearCorner = false;
          if (useRail) {
            for (let s = 0; s + 4 <= (a1 - a0) * ds; s += 4) {
              const ii = a0 + (s + 2) / ds; tr.at(ii, 0, f); if (tr.clear(ii, sg) < 1.4) continue;
              const lat = sg * (f.hw + 0.62), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat;
              B.armco.add(x, H(x, z) + GROUND, z, f.yaw + (sg > 0 ? 0 : Math.PI)); stats.rails++;
            }
            mark(arr, a0, a1 - a0, 2);
          } else {
            for (let s = 0; s + 3 <= (a1 - a0) * ds; s += 3) {
              const ii = a0 + (s + 1.5) / ds; tr.at(ii, 0, f); if (tr.clear(ii, sg) < 1.4) continue;
              const lat = sg * (f.hw + 0.8), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat;
              B.barrier.add(x, H(x, z) + GROUND, z, f.yaw, 1, 1, 1); stats.barriers++;
            }
            mark(arr, a0, a1 - a0, 3);
          }
        }
      }
      q = r;
    }
  }

  // ------------------------------------------------------------ rumble kerbs on the inside of corners (red/white), + exit kerb on hairpins
  for (const co of c.corners) {
    if (co.angle < 18 || co.minR > 160) continue;
    const inside = -outsideOf(co), i0 = co.entry - 5 / ds, len = (co.len + 10) / ds;
    const wk = co.severity >= 4 ? 1.15 : 0.95;
    ribbon(G.rumble, tr, i0, len, 0, 0, 0.155, [0, 0, 1, 1], {
      vLen: 1.6, step: 1,
      latFn: (t, i) => { tr.at(i, 0, f2); return inside > 0 ? f2.hw - wk + 0.12 : -f2.hw - 0.12; },
      widthFn: () => wk,
    });
    if (co.severity >= 4 && !lowQ) { // outside exit kerb for hairpins (short)
      ribbon(G.rumble, tr, co.entry + co.len * 0.55 / 1, (co.len * 0.45 + 12) / ds, 0, 0, 0.155, [0, 0, 1, 1], { vLen: 1.6, step: 1, latFn: (t, i) => { tr.at(i, 0, f2); return -inside > 0 ? f2.hw - 1.0 + 0.12 : -f2.hw - 0.12; }, widthFn: () => 1.0 });
    }
    // cones along the apex (clipping points) + tyre markers
    if (co.severity >= 3 && ps > 0.3) {
      const nC = co.severity >= 4 ? 5 : 3;
      for (let k = 0; k < nC; k++) {
        const ii = co.apex + (k - (nC - 1) / 2) * 4.5 / ds; tr.at(ii, 0, f); const lat = inside * (f.hw - 1.7), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat;
        B.cone.add(x, H(x, z) + 0.1, z, rng() * 6.28); stats.cones++;
      }
      if (ps > 0.6) for (const off of [-9, 9]) { // standing tyre pairs flanking the apex
        tr.at(co.apex + off / ds, 0, f); const lat = inside * (f.hw - 1.0), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat, y = H(x, z) + 0.1;
        B.tyre.add(x, y, z, rng() * 6, 1, 1, 1, RED); B.tyre.add(x, y + 0.255, z, rng() * 6, 1, 1, 1, WHITE); stats.tyres += 2;
      }
    }
    // entry cones across the braking zone (single file along the outside)
    if (co.severity >= 4 && ps > 0.3) for (let k = 0; k < 4; k++) { tr.at(co.entry - (22 + k * 5) / ds, 0, f); const lat = -inside * (f.hw - 0.9), x = f.cx + f.rx * lat, z = f.cz + f.rz * lat; B.cone.add(x, H(x, z) + 0.1, z, rng() * 6.28); stats.cones++; }

    // ---------------------------------------------------------- skid marks: a drift trail through the corner and out onto the exit
    if (co.severity >= 3) {
      const i0s = co.entry - 8 / ds, lenS = (co.len + 8 + (co.severity >= 4 ? 26 : 18)) / ds;
      for (const off of [-0.8, 0.8]) {
        ribbon(G.skid, tr, i0s, lenS, 0, 0, 0.135, [0, 0, 1, 1], {
          vLen: 14, step: 1.5,
          latFn: (t, i) => { tr.at(i, 0, f2); const hw = f2.hw; const a = Math.sin(clamp(t * 1.0, 0, 1) * Math.PI); const trail = (-inside) * hw * 0.28 * (1 - Math.min(1, t * 2.2)) + inside * hw * 0.42 * Math.min(1, t * 2.2) - (inside * hw * 0.62) * Math.max(0, t - 0.55) * 2.0; return trail + off - 0.15; },
          widthFn: () => 0.32,
        });
      }
    }
  }

  // ------------------------------------------------------------ braking marks on long straights ahead of hard corners + burnout marks at the grid
  for (const co of c.corners) {
    if (co.severity < 4) continue;
    for (const off of [-1.2, 1.2]) ribbon(G.skid, tr, co.entry - 34 / ds, 30 / ds, 0, 0, 0.134, [0, 0.2, 1, 0.7], { vLen: 18, step: 2, latFn: (t, i) => { tr.at(i, 0, f2); return -outsideOf(co) * f2.hw * 0.2 + off + t * 0.5; }, widthFn: () => 0.28 });
  }
  {
    // burnout streaks just behind the line on the grid
    for (const off of [-2.4, 2.1]) ribbon(G.skid, tr, -16 / ds, 12 / ds, 0, 0, 0.134, [0, 0, 1, 1], { vLen: 12, step: 1.5, latFn: () => off - 0.5, widthFn: () => 0.4 });
  }

  // ------------------------------------------------------------ oil stains (alpha quads with a glossy-dark look)
  {
    const oilN = Math.round((lowQ ? 10 : 26) + c.length / 120);
    const spots = [];
    for (const co of c.corners) if (co.severity >= 3) { spots.push([co.apex, 0.0]); spots.push([co.apex + 10, 0.3]); }
    for (const sp of c.spawns) spots.push([sp.index, 0.2]);
    for (let k = 0; k < oilN; k++) spots.push([rng() * n, (rng() - 0.5) * 0.7]);
    for (const [i, l] of spots) {
      tr.at(i, 0, f); const lat = l * f.hw * 0.7 + (rng() - 0.5) * 2, s = 1.4 + rng() * 2.2, rot = rng() * 6.28, q = Math.floor(rng() * 4), qu = (q % 2) / 2, qv = Math.floor(q / 2) / 2;
      const cx = f.cx + f.rx * lat, cz = f.cz + f.rz * lat, cy = H(cx, cz) + 0.138, co = Math.cos(rot), si = Math.sin(rot);
      const P = (a, b) => [cx + (a * co - b * si) * s, cy, cz + (a * si + b * co) * s];
      G.oil.quad(P(-1, 1), P(1, 1), P(1, -1), P(-1, -1), [qu, qv, qu + 0.5, qv + 0.5], [1, 1, 1], [0, 1, 0]);
    }
  }
}

/** painted start line, grid slots and pit lane markings (merged into the paint batch) */
export function paintStart(kit, tr) {
  const { gb: G, atlas } = kit, c = tr.c, f = {}, H = tr.H, ds = tr.ds;
  const T = i => [(i % 2) / 2, 1 - (Math.floor(i / 2) + 1) / 2, (i % 2) / 2 + 0.5, 1 - Math.floor(i / 2) / 2]; // quadrant uv rect
  // chequered start line across the whole carriageway
  { const t = T(0); tr.at(0, 0, f); const W = f.w - 0.6, L = W / 4;
    const uv = [t[0], t[3] - 0.125, t[2], t[3]]; // top 64 px of the quadrant (4 rows of 16-px squares)
    ribbon(G.paint, tr, -L / 2 / ds, L / ds, -W / 2, W / 2, 0.15, uv, { vLen: L, step: 1 }); }
  // 8 grid slots
  const t1 = T(1);
  for (const sp of c.spawns) {
    tr.at(sp.index, 0, f); const col = sp.slot & 1, lat = (col ? 1 : -1) * Math.min(2.3, f.hw * 0.3);
    const cx = f.cx + f.rx * lat, cz = f.cz + f.rz * lat, y = H(cx, cz) + 0.15, sx = 1.45, sz = 2.9, ux = f.rx, uz = f.rz, fx = f.tx, fz = f.tz;
    const P = (a, b) => [cx + ux * a + fx * b, y, cz + uz * a + fz * b];
    G.paint.quad(P(-sx, -sz), P(sx, -sz), P(sx, sz), P(-sx, sz), [t1[0], t1[1], t1[2], t1[3]], [1, 1, 1], [0, 1, 0]);
  }
  // pit lane lines (solid white edge line + yellow speed-limit line) along the paddock
  const pit = c.pit, t3 = T(3), sg = pit.side === 'R' ? 1 : -1;
  const white = [t3[0] + 0.5 * (110 / 256), t3[1] + 0.2, t3[0] + 0.5 * (146 / 256), t3[1] + 0.8];
  const len = (pit.length + 40) / ds, i0 = pit.index - len / 2;
  tr.at(pit.index, 0, f);
  ribbon(G.paint, tr, i0, len, 0, 0, 0.15, white, { vLen: 100, step: 2, latFn: (t, i) => { tr.at(i, 0, f); return sg * (f.hw + 1.2) - 0.08; }, widthFn: () => 0.18 });
  const yl = [t3[0] + 0.5 * (22 / 256), t3[1] + 0.2, t3[0] + 0.5 * (32 / 256), t3[1] + 0.8];
  ribbon(G.paint, tr, i0, len, 0, 0, 0.15, yl, { vLen: 100, step: 2, latFn: (t, i) => { tr.at(i, 0, f); return sg * (f.hw + 3.0) - 0.07; }, widthFn: () => 0.15 });
  // arrows
  const t2 = T(2);
  for (let k = 0; k < 3; k++) { const ii = pit.index - 24 / ds + k * 24 / ds; tr.at(ii, 0, f); const lat = sg * (f.hw + 2.1), cx = f.cx + f.rx * lat, cz = f.cz + f.rz * lat, y = H(cx, cz) + 0.15, ux = f.rx, uz = f.rz, fx = f.tx, fz = f.tz; const P = (a, b) => [cx + ux * a + fx * b, y, cz + uz * a + fz * b]; G.paint.quad(P(-0.5, -1.2), P(0.5, -1.2), P(0.5, 1.2), P(-0.5, 1.2), [t2[0], t2[1], t2[2], t2[3]], [1, 1, 1], [0, 1, 0]); }
}
