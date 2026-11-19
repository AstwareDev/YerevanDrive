// Builds the runtime PBR texture library (public/tex) from CC0 ambientCG archives extracted in data/tex_raw/<AssetId>/.
//   node tools/build-textures.mjs            -> all sets + road decal mask + road field + manifest
//   node tools/build-textures.mjs asphalt_fine plaza_tuff   -> only the named sets (manifest is merged)
//   node tools/build-textures.mjs --no-field -> skip the road field raster
// Per set and size (512 / 1024 / 2048, never larger than the source): albedo_<s>.webp (sRGB), normal_<s>.webp (OpenGL +Y),
// orm_<s>.webp (R=AO, G=roughness, B=metalness). Decal sets keep opacity in the normal map's blue channel (z is rebuilt in the shader).
// Sources: https://ambientcg.com  (all assets CC0 1.0 Universal).  Extracted archives are only ever read as images.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { project } from './config.mjs';

const RAW = 'data/tex_raw', OUT = 'public/tex';
const SIZES = [512, 1024, 2048];
const Q = { albedo: 84, normal: 88, orm: 82 };

// name -> { id, scale (metres covered by one tile), max (largest size we ship), use, kind }
const SETS = {
  // ---- asphalt
  asphalt_fine:    { id: 'Asphalt025C', scale: 2.0, max: 2048, use: 'asphalt (fine dark aggregate, close-up detail)' },
  asphalt_road:    { id: 'Road012B', scale: 7.5, max: 2048, use: 'asphalt (large-scale mottling, cracks and wear; blended over asphalt_fine)' },
  asphalt_cracked: { id: 'Asphalt026C', scale: 3.0, max: 1024, use: 'asphalt (heavily cracked variant)' },
  asphalt_patch:   { id: 'Asphalt019', scale: 3.0, max: 1024, use: 'asphalt (patched / peeled variant)' },
  roof_bitumen:    { id: 'Asphalt032', scale: 2.0, max: 1024, use: 'flat roofs (bitumen / gravel)' },
  // ---- paving
  sidewalk_slab:   { id: 'PavingStones006', scale: 1.6, max: 1024, use: 'sidewalks (grey concrete slabs)' },
  plaza_tuff:      { id: 'Tiles143', scale: 2.0, max: 1024, use: 'Republic Square plaza (beige/pink limestone slabs)' },
  sett_basalt:     { id: 'PavingStones049', scale: 1.5, max: 1024, use: 'granite / basalt sett pavers' },
  cobble:          { id: 'PavingStones142', scale: 1.5, max: 1024, use: 'cobblestone' },
  // ---- concrete / render
  concrete_dark:   { id: 'Concrete030', scale: 2.0, max: 1024, use: 'walls, barriers, curbs' },
  concrete_light:  { id: 'Concrete034', scale: 1.1, max: 1024, use: 'light concrete / smooth render' },
  plaster_a:       { id: 'Plaster003', scale: 2.0, max: 1024, use: 'wall render (clean, rough)' },
  plaster_b:       { id: 'Plaster006', scale: 2.0, max: 1024, use: 'wall render (weathered, patchy)' },
  // ---- masonry
  tuff_block_a:    { id: 'Bricks109A', scale: 2.4, max: 1024, use: 'Yerevan tuff / limestone block masonry (orange)' },
  tuff_block_b:    { id: 'Bricks112A', scale: 2.4, max: 1024, use: 'Yerevan tuff / limestone block masonry (large golden blocks)' },
  brick_old:       { id: 'Bricks097', scale: 1.5, max: 1024, use: 'old red brick' },
  brick_red:       { id: 'Bricks051', scale: 1.25, max: 1024, use: 'modern red brick' },
  // ---- roofs
  roof_clay:       { id: 'RoofingTiles012A', scale: 2.9, max: 1024, use: 'hipped clay-tile roofs' },
  // ---- nature
  grass_short:     { id: 'Grass005', scale: 1.4, max: 1024, use: 'lawns (short, bright)' },
  grass_mixed:     { id: 'Grass004', scale: 1.4, max: 1024, use: 'lawns (varied, darker)' },
  grass_dry:       { id: 'Ground037', scale: 2.1, max: 1024, use: 'dry grass / patchy earth' },
  terrain_earth:   { id: 'Ground103', scale: 2.0, max: 1024, use: 'generic terrain' },
  dirt:            { id: 'Ground109', scale: 2.8, max: 1024, use: 'dirt' },
  gravel:          { id: 'Gravel043', scale: 1.6, max: 1024, use: 'fine gravel' },
  sand:            { id: 'Ground091', scale: 2.0, max: 1024, use: 'sand / dust' },
  // ---- metal / wood
  metal_dark:      { id: 'Metal046B', scale: 1.0, max: 1024, use: 'painted dark metal (fences, rails)' },
  metal_rust:      { id: 'Metal053C', scale: 1.0, max: 1024, use: 'rusty metal' },
  wood:            { id: 'Wood066', scale: 0.4, max: 1024, use: 'dark wood' },
  // ---- decals (opacity stored in normal.b)
  decal_manhole:   { id: 'ManholeCover011', scale: 1.0, max: 1024, kind: 'decal', use: 'square manhole / drain cover decal (one per cell, placed in shader)' },
  decal_patch:     { id: 'AsphaltDamage001', scale: 1.6, max: 1024, kind: 'decal', use: 'asphalt repair patch decal' },
};

const find = (dir, re) => { const f = fs.readdirSync(dir).find(n => re.test(n)); return f ? path.join(dir, f) : null; };
const mb = b => (b / 1e6).toFixed(2) + ' MB';

async function resized(file, size, { channels = 3 } = {}) {
  let s = sharp(file).removeAlpha().resize(size, size, { kernel: 'lanczos3', fit: 'fill' });
  if (channels === 1) s = s.toColourspace('b-w');
  return s;
}

async function buildSet(name, d) {
  const dir = path.join(RAW, d.id);
  if (!fs.existsSync(dir)) throw new Error('missing raw dir ' + dir);
  const col = find(dir, /_Color\.jpg$/i), nrm = find(dir, /_NormalGL\.jpg$/i), rgh = find(dir, /_Roughness\.jpg$/i);
  const ao = find(dir, /_AmbientOcclusion\.jpg$/i), met = find(dir, /_Metalness\.jpg$/i), opa = find(dir, /_Opacity\.jpg$/i);
  if (!col || !nrm || !rgh) throw new Error(`${d.id}: missing Color/NormalGL/Roughness`);
  const srcW = (await sharp(col).metadata()).width;
  const sizes = SIZES.filter(s => s <= Math.min(d.max, srcW));
  const out = path.join(OUT, name); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  let bytes = 0;
  for (const s of sizes) {
    const wr = async (file, img, opt) => { const b = await img.webp({ effort: 5, ...opt }).toBuffer(); fs.writeFileSync(path.join(out, file), b); bytes += b.length; };
    await wr(`albedo_${s}.webp`, await resized(col, s), { quality: Q.albedo, smartSubsample: true });
    if (d.kind === 'decal' && opa) {
      // normal.rg = tangent normal xy, normal.b = opacity
      const n = await (await resized(nrm, s)).raw().toBuffer({ resolveWithObject: true });
      const o = await (await resized(opa, s, { channels: 1 })).raw().toBuffer();
      const buf = Buffer.from(n.data); for (let i = 0, p = 0; i < buf.length; i += 3, p++) buf[i + 2] = o[p];
      await wr(`normal_${s}.webp`, sharp(buf, { raw: { width: s, height: s, channels: 3 } }), { quality: 92, smartSubsample: true });
    } else await wr(`normal_${s}.webp`, await resized(nrm, s), { quality: Q.normal, smartSubsample: true });
    // ORM
    const r = await (await resized(rgh, s, { channels: 1 })).extractChannel(0).raw().toBuffer();
    const a = ao ? await (await resized(ao, s, { channels: 1 })).extractChannel(0).raw().toBuffer() : null;
    const m = met ? await (await resized(met, s, { channels: 1 })).extractChannel(0).raw().toBuffer() : null;
    const orm = Buffer.alloc(s * s * 3);
    for (let i = 0; i < s * s; i++) { orm[i * 3] = a ? a[i] : 255; orm[i * 3 + 1] = r[i]; orm[i * 3 + 2] = m ? m[i] : 0; }
    await wr(`orm_${s}.webp`, sharp(orm, { raw: { width: s, height: s, channels: 3 } }), { quality: Q.orm });
  }
  // mean albedo in LINEAR light (the shaders divide by it to get a unit-mean detail ratio)
  const px = await sharp(col).removeAlpha().resize(96, 96, { kernel: 'lanczos3' }).raw().toBuffer(), lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const sum = [0, 0, 0]; for (let i = 0; i < px.length; i += 3) for (let k = 0; k < 3; k++) sum[k] += lin(px[i + k]);
  const avg = sum.map(v => +(v / (px.length / 3)).toFixed(4));
  console.log(name.padEnd(16), d.id.padEnd(18), sizes.join('/').padEnd(14), mb(bytes), 'avg', avg.join(','));
  return { id: d.id, source: 'ambientCG', license: 'CC0-1.0', kind: d.kind ?? 'pbr', scale: d.scale, sizes, avg, use: d.use };
}

// ------------------------------------------------------------------ procedural, seamless road-decal mask (R rubber streaks, G cracks, B stains/patches)
function rnd2(ix, iy, seed) { let h = Math.imul(ix * 374761393 + iy * 668265263 + seed * 1442695041, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const wx = v => ((v % px) + px) % px, wy = v => ((v % py) + py) % py;
  const a = rnd2(wx(xi), wy(yi), seed), b = rnd2(wx(xi + 1), wy(yi), seed), c = rnd2(wx(xi), wy(yi + 1), seed), d = rnd2(wx(xi + 1), wy(yi + 1), seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function fbm(u, v, px, py, oct, seed) { let s = 0, a = 0.5, t = 0, X = px, Y = py; for (let o = 0; o < oct; o++) { s += a * vnoise(u * X, v * Y, X, Y, seed + o * 31); t += a; a *= 0.5; X *= 2; Y *= 2; } return s / t; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// worley F2-F1 on a periodic grid; returns [edgeDist, edgeId]
function worleyEdge(u, v, P, seed) {
  const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id1 = 0, id2 = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, wx = ((cx % P) + P) % P, wy = ((cy % P) + P) % P;
    const fx = cx + 0.15 + 0.7 * rnd2(wx, wy, seed), fy = cy + 0.15 + 0.7 * rnd2(wx, wy, seed + 7);
    const d = Math.hypot(fx - x, fy - y), id = wy * P + wx;
    if (d < d1) { d2 = d1; id2 = id1; d1 = d; id1 = id; } else if (d < d2) { d2 = d; id2 = id; }
  }
  return [d2 - d1, id1 < id2 ? id1 * 7919 + id2 : id2 * 7919 + id1];
}
async function buildRoadMask() {
  const S = 1024, buf = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // R: rubber streaks - fine across (u), long along (v). Dense bands (wheel polish) modulated by a slow field.
    const st = fbm(u, v, 160, 3, 3, 11) * 0.65 + fbm(u, v, 40, 2, 2, 17) * 0.35;
    const band = sstep(0.38, 0.7, fbm(u, v, 3, 2, 2, 5));
    const rub = sstep(0.5, 0.78, st) * band;
    // G: cracks - warped voronoi edges, randomly present
    const wu = u + (fbm(u, v, 9, 9, 4, 21) - 0.5) * 0.09, wv = v + (fbm(u, v, 9, 9, 4, 22) - 0.5) * 0.09;
    const [e1, id1] = worleyEdge(wu, wv, 5, 3), [e2, id2] = worleyEdge(wu, wv, 13, 9);
    const alive1 = rnd2(id1 & 0xffff, id1 >>> 16, 4) > 0.58 ? 1 : 0, alive2 = rnd2(id2 & 0xffff, id2 >>> 16, 5) > 0.82 ? 1 : 0;
    const cr = Math.max(alive1 * (1 - sstep(0.0, 0.018 + 0.016 * fbm(u, v, 20, 20, 2, 6), e1)), alive2 * (1 - sstep(0.0, 0.02, e2)) * 0.7);
    // B: oil stains / dark patches / dirt blotches
    const bl = fbm(u, v, 5, 5, 5, 41), stain = sstep(0.56, 0.72, bl) * (0.55 + 0.45 * fbm(u, v, 24, 24, 3, 43));
    const i = (y * S + x) * 3; buf[i] = Math.round(rub * 255); buf[i + 1] = Math.round(cr * 255); buf[i + 2] = Math.round(stain * 255);
  }
  const out = path.join(OUT, 'road_decals'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  let bytes = 0;
  for (const s of [512, 1024]) { const b = await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).resize(s, s, { kernel: 'lanczos3' }).webp({ quality: 90, effort: 5 }).toBuffer(); fs.writeFileSync(path.join(out, `mask_${s}.webp`), b); bytes += b.length; }
  console.log('road_decals'.padEnd(16), 'procedural'.padEnd(18), '512/1024'.padEnd(14), mb(bytes));
  return { id: 'procedural', source: 'generated by tools/build-textures.mjs', license: 'CC0-1.0', kind: 'mask', scale: 6, sizes: [512, 1024], avg: [0, 0, 0], use: 'RGB mask: R tyre-rubber streaks, G cracks, B oil/dirt stains. Tile 6 m, rotate by road direction.' };
}

// ------------------------------------------------------------------ road field: world-space raster of road direction / lateral position, baked from data/osm.json
// RGBA8 PNG over [-EXT, EXT]^2 (north-up like the aerial: u = (x+EXT)/2EXT, v = 1-(z+EXT)/2EXT):
//   R,G = cos(2a), sin(2a) of the road direction (0.5 = 0)   B = lateral position across the carriageway (0.5 = centre line)   A = half width / 16 m
const EXT = 1100, FN = 2048;
async function buildRoadField() {
  const osm = JSON.parse(fs.readFileSync('data/osm.json', 'utf8'));
  const ROAD = { trunk: [14, 8], trunk_link: [7, 6], primary: [13, 7], primary_link: [7, 5], secondary: [10, 6], secondary_link: [6, 4], tertiary: [8, 5], tertiary_link: [5.5, 3], residential: [6.5, 4], unclassified: [6, 4], living_street: [5, 3], service: [3.8, 2], track: [3, 1] };
  const num = v => { if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const px = EXT * 2 / FN;
  const best = new Float32Array(FN * FN).fill(1e9), data = new Uint8Array(FN * FN * 4);
  const ways = osm.elements.filter(e => e.type === 'way' && e.geometry && e.tags?.highway && ROAD[e.tags.highway]);
  let n = 0;
  for (const w of ways) {
    const [cw, rank] = ROAD[w.tags.highway], t = w.tags;
    const lanes = num(t.lanes), oneway = t.oneway === 'yes' || t.oneway === '1';
    let wid = num(t.width) ?? (lanes ? lanes * 3.2 + (oneway ? 0.6 : 1.2) : cw); wid = Math.max(3, Math.min(30, wid));
    const hw = wid / 2, P = w.geometry.map(g => project(g.lat, g.lon));
    for (let k = 1; k < P.length; k++) {
      const [ax, az] = P[k - 1], [bx, bz] = P[k], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 1e-6) continue;
      const L = Math.sqrt(L2), tx = dx / L, tz = dz / L, ang2 = 2 * Math.atan2(tz, tx);
      const r = hw + 1.6, i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r + EXT) / px)), i1 = Math.min(FN - 1, Math.floor((Math.max(ax, bx) + r + EXT) / px));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r + EXT) / px)), j1 = Math.min(FN - 1, Math.floor((Math.max(az, bz) + r + EXT) / px));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const X = (i + 0.5) * px - EXT, Z = (j + 0.5) * px - EXT;   // row 0 = north (z = -EXT), like the aerial photo
        const s = Math.max(0, Math.min(1, ((X - ax) * dx + (Z - az) * dz) / L2)), cx = ax + dx * s, cz = az + dz * s, d = Math.hypot(X - cx, Z - cz);
        if (d > hw + 1.2) continue;
        const score = d / hw - rank * 0.05; if (score >= best[j * FN + i]) continue;
        best[j * FN + i] = score;
        const side = (X - ax) * tz - (Z - az) * tx > 0 ? 1 : -1;   // +1 = right-hand side in x/z
        const tt = Math.max(0, Math.min(1, 0.5 + side * d / (2 * hw)));
        const o = (j * FN + i) * 4;
        data[o] = Math.round((Math.cos(ang2) * 0.5 + 0.5) * 255); data[o + 1] = Math.round((Math.sin(ang2) * 0.5 + 0.5) * 255); data[o + 2] = Math.round(tt * 255); data[o + 3] = Math.max(1, Math.min(255, Math.round(hw / 16 * 255)));
        n++;
      }
    }
  }
  const b = await sharp(Buffer.from(data.buffer), { raw: { width: FN, height: FN, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(OUT, 'roadfield.png'), b);
  console.log('roadfield.png'.padEnd(16), `${ways.length} ways, ${n} px writes`, mb(b.length));
}

// ------------------------------------------------------------------ main
const args = process.argv.slice(2), want = args.filter(a => !a.startsWith('--'));
fs.mkdirSync(OUT, { recursive: true });
const manPath = path.join(OUT, 'manifest.json');
const manifest = want.length && fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { version: 1, sizes: SIZES, license: 'All PBR sets: CC0 1.0 (ambientCG.com). Procedural masks: generated here.', sets: {} };
for (const [name, d] of Object.entries(SETS)) {
  if (want.length && !want.includes(name)) continue;
  try { manifest.sets[name] = await buildSet(name, d); } catch (e) { console.warn('SKIP', name, e.message); }
}
if (!want.length || want.includes('road_decals')) manifest.sets.road_decals = await buildRoadMask();
if (!args.includes('--no-field') && (!want.length || want.includes('roadfield'))) { await buildRoadField(); manifest.roadfield = { file: 'roadfield.png', extent: EXT, size: FN, note: 'RG=cos/sin(2*dir) B=lateral 0..1 A=halfwidth/16m' }; }
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 1));
let total = 0; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : (total += fs.statSync(path.join(d, f.name)).size); }; walk(OUT);
console.log('public/tex total', mb(total));
