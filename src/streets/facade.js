// Procedural facade system for Orbeli Brothers St and Komitas Ave (data: public/map/orbeli.json, survey: .scratch/streets-reference.md).
//
// Why not textures: the previous kit painted one canvas set per building (albedo + bump + emissive), so VRAM and draw calls grew with
// every block and the windows were flat paint. Here every wall is ONE quad and a single shader builds the facade analytically:
//   * window / door / shopfront openings are real RECESSES, ray-traced per pixel against the reveal box (exact parallax, correct
//     reveal normals for lighting, no extra geometry), with PVC frames, mullions, transoms, stone surrounds and sills;
//   * behind the glass, INTERIOR MAPPING: each window looks into a room box (walls / floor / ceiling, curtains), lit or dark per room,
//     glowing at night; the glass itself is glossy so the live reflection probe / env map reflects the street in it;
//   * walls: tuff ashlar with per-block tint variation and mortar relief, or tuff-tile cladding on panel towers, rain streaks, floor bands;
//   * shader LOD: past ~0.3 m per pixel the recess / room tracing is skipped and the facade collapses to its average colours + lit-window glow.
// All blocks of both streets render through ~8 draw calls (walls, plinth, trim, roofs, balconies, AC units, signs); balcony / AC
// placement on the CPU uses the same integer hash as the shader, so 3D balconies always sit on the painted balcony doors.
import * as THREE from 'three';

// ------------------------------------------------------------------ shared integer hash (identical in JS and GLSL)
const hh = x => { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; };
export const h3 = (a, b, c) => hh((Math.imul(a | 0, 73856093) ^ Math.imul((b | 0) + 1000, 19349663) ^ Math.imul((c | 0) + 1000, 83492791)) >>> 0) / 4294967296;
const HASH_GLSL = /* glsl */`
uint fhh(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float h3(float a, float b, float c) { return float(fhh((uint(int(a)) * 73856093u) ^ (uint(int(b) + 1000) * 19349663u) ^ (uint(int(c) + 1000) * 83492791u))) / 4294967296.0; }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = h3(i.x, i.y, 7.0), b = h3(i.x + 1.0, i.y, 7.0), c = h3(i.x, i.y + 1.0, 7.0), d = h3(i.x + 1.0, i.y + 1.0, 7.0); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
`;
export const STYLE = { stalin: 0, tower: 1, slab: 2, school: 3, glass: 4, ribbon: 5, market: 6, mall: 7 };
export const FLAG = { front: 1, blind: 2, pilasters: 4, arches: 8, topArch: 16, loggias: 32, band: 64, podium: 128 };
/** per-style grid: floor height, bay width, window w/h, sill height, recess depth */
export const GRID = {
  0: { fl: 3.3, bay: 3.4 }, 1: { fl: 2.9, bay: 3.0 }, 2: { fl: 2.9, bay: 3.2 }, 3: { fl: 3.6, bay: 3.2 },
  4: { fl: 3.5, bay: 1.6 }, 5: { fl: 3.5, bay: 3.0 }, 6: { fl: 4.4, bay: 4.2 }, 7: { fl: 4.5, bay: 6.0 },
};
/** cell type above the ground floor -- MUST match cellKind() in the shader. 0 window, 1 balcony door, 2 glazed loggia */
export function cellKind(style, seed, bx, row) {
  if (style !== 0 && style !== 1) return 0;
  const h = h3(seed, bx, row);
  if (style === 1) return h < 0.07 ? 1 : h < 0.36 ? 2 : 0;      // panel towers: mostly stacked glazed / open loggias
  return h < 0.24 ? 1 : h < 0.31 ? 2 : 0;
}

const WALL_VERT_HEAD = /* glsl */`
attribute vec4 aFac; attribute vec4 aSty; attribute vec4 aGrid; attribute vec4 aBand;
varying vec4 vFac; varying vec4 vSty; varying vec4 vGrid; varying vec4 vBand; varying vec2 vF; varying vec3 vFW; varying vec3 vFN;
`;
const WALL_FRAG_HEAD = /* glsl */`
varying vec4 vFac; varying vec4 vSty; varying vec4 vGrid; varying vec4 vBand; varying vec2 vF; varying vec3 vFW; varying vec3 vFN;
uniform float uNight, uDay;
${HASH_GLSL}
int cellKind(int style, float seed, float bx, float row) {
  if (style != 0 && style != 1) return 0;
  float h = h3(seed, bx, row);
  if (style == 1) return h < 0.07 ? 1 : (h < 0.36 ? 2 : 0);
  return h < 0.24 ? 1 : (h < 0.31 ? 2 : 0);
}
// ray (entry e on the wall plane, direction v in facade space: x along, y up, z out of the wall) against an opening [r.xy, r.zw] of depth D.
// returns surface id (0 back/glass, 1 left, 2 right, 3 bottom/sill, 4 top/soffit), hit point and depth fraction
int recess(vec2 e, vec3 v, vec4 r, float D, out vec3 hp) {
  float tb = D / max(-v.z, 1e-4);
  float tx = v.x > 0.0 ? (r.z - e.x) / v.x : (r.x - e.x) / min(v.x, -1e-6);
  float ty = v.y > 0.0 ? (r.w - e.y) / v.y : (r.y - e.y) / min(v.y, -1e-6);
  float t = min(tb, min(tx, ty)); hp = vec3(e + v.xy * t, v.z * t);
  if (t == tb) return 0; if (t == tx) return v.x > 0.0 ? 2 : 1; return v.y > 0.0 ? 4 : 3;
}
// interior mapping: room box behind the glass (width w, height h, depth R), p = point on the glass in room coords (0..w, 0..h)
vec3 room(vec2 p, vec3 v, float w, float h, float R, float seed, float lit, out float wallK) {
  vec3 iv = 1.0 / max(abs(v), vec3(1e-4));
  float tx = (v.x > 0.0 ? w - p.x : p.x) * iv.x, ty = (v.y > 0.0 ? h - p.y : p.y) * iv.y, tz = R * iv.z;
  float t = min(tx, min(ty, tz)); vec3 q = vec3(p + v.xy * t, -abs(v.z) * t);
  float hw = h3(seed, 11.0, 3.0), hf = h3(seed, 12.0, 5.0);
  vec3 wallC = mix(vec3(0.72, 0.66, 0.55), vec3(0.62, 0.70, 0.66), hw) * (0.8 + 0.3 * h3(seed, 13.0, 1.0));
  vec3 c; wallK = 1.0;
  if (t == tz) { c = wallC * 0.9; float pic = step(abs(q.x - w * 0.5), 0.35) * step(abs(q.y - h * 0.62), 0.25); c = mix(c, vec3(0.35, 0.25, 0.2), pic * step(0.5, hf)); }
  else if (t == ty) { if (v.y > 0.0) { c = vec3(0.86, 0.85, 0.82); wallK = 0.7; } else { c = mix(vec3(0.32, 0.22, 0.15), vec3(0.45, 0.42, 0.38), hf); wallK = 0.5; } }
  else c = wallC * 0.8;
  float dpt = -q.z / R;
  c *= mix(1.0, 0.55, dpt);                                                        // falls off towards the back of the room
  // furniture silhouette near the back wall (sofa / cupboard block)
  if (t == tz && q.y < h * 0.35 && abs(q.x - w * (0.3 + 0.4 * hw)) < w * 0.22) c *= 0.45;
  return c;
}
`;

// ---------------------------------------------------------------------------- the facade fragment program
const WALL_FRAG_MAIN = /* glsl */`
  int style = int(vSty.x + 0.5); float flH = vSty.y, bay = vSty.z, gH = vSty.w;
  float nb = vGrid.x, wallTop = vGrid.y; int flags = int(vGrid.z + 0.5); float seed = vFac.w; int gfType = int(vBand.w + 0.5);
  vec3 pal = vFac.rgb, band = vBand.rgb;
  vec3 Nw = normalize(vFN), Tw = vec3(-Nw.z, 0.0, Nw.x);
  vec3 Vw = normalize(vFW - cameraPosition);
  vec3 v = vec3(dot(Vw, Tw), Vw.y, dot(Vw, Nw));                                   // view ray in facade space (z out of the wall)
  vec2 f = vF;
  float pix = max(fwidth(f.x), fwidth(f.y));                                      // metres per pixel (shader LOD)
  float lod = smoothstep(0.12, 0.32, pix);
  float bfade = 1.0 - smoothstep(0.05, 0.16, pix), tfade = 1.0 - smoothstep(0.04, 0.12, pix), rfade = 1.0 - smoothstep(0.03, 0.09, pix);   // detail fades: ashlar block / panel tile / room interior
  bool ground = f.y < gH;
  float bx = floor(f.x / bay), lx = f.x - bx * bay;
  float row = ground ? -1.0 : floor((f.y - gH) / flH), ly = ground ? f.y : f.y - gH - row * flH;
  bool inGrid = bx >= 0.0 && bx < nb && f.y < wallTop - 0.6;
  bool blind = (flags & 2) != 0;
  // ---------------------------------------------------------------- wall material
  vec3 albedo = pal; float rough = 0.88; vec3 nW = Nw; vec3 emis = vec3(0.0);
  if (style == 1 || style == 2) {                                                  // tuff-tile cladding on precast panels: 0.25 m tiles, 3 x floor panels
    vec2 tu = f / vec2(0.25, 0.25), ti = floor(tu), tf = fract(tu);
    float tv = h3(ti.x, ti.y, seed); albedo *= mix(0.99, 0.88 + 0.22 * tv, tfade);
    float joint = 1.0 - step(0.06, tf.x) * step(0.06, tf.y);
    vec2 pu = vec2(f.x / bay, (f.y - gH) / flH), pf = abs(fract(pu) - 0.5);
    float pj = step(0.485, max(pf.x * bay / 3.0, pf.y));
    albedo *= mix(1.0, 0.78, max(joint * (1.0 - lod) * 0.6, pj * 0.9));
  } else if (style == 4) {                                                         // curtain wall handled in the opening code
    albedo = vec3(0.55, 0.57, 0.58);
  } else {                                                                         // tuff ashlar: ~0.62 x 0.31 m blocks, staggered courses
    vec2 au = vec2(f.x / 0.62, f.y / 0.31); float course = floor(au.y); au.x += mod(course, 2.0) * 0.5;
    vec2 ai = floor(au), af = fract(au);
    float bv = h3(ai.x, ai.y, seed + 3.0), dark = step(0.93, h3(ai.x, ai.y, seed + 9.0));
    albedo *= mix(0.96, (0.86 + 0.24 * bv) * mix(1.0, 0.72, dark), bfade);
    vec2 m = min(af, 1.0 - af) * vec2(0.62, 0.31);
    float mortar = 1.0 - smoothstep(0.004, 0.012, min(m.x, m.y));
    albedo = mix(albedo, albedo * 1.12 + 0.02, mortar * (1.0 - lod) * 0.7);
    if (lod < 1.0) { vec2 g = vec2(af.x < 0.5 ? -1.0 : 1.0, af.y < 0.5 ? -1.0 : 1.0) * (1.0 - smoothstep(0.0, 0.05, vec2(m.x, m.y))); nW = normalize(Nw + (Tw * g.x + vec3(0.0, g.y, 0.0)) * 0.25 * (1.0 - lod)); }
    if ((flags & 4) != 0 && !ground) { float pl = abs(lx - bay * 0.0); if (lx < 0.32 || lx > bay - 0.32) { albedo *= 1.08; nW = normalize(Nw + Tw * (lx < 0.32 ? -0.15 : 0.15)); } }   // engaged pilasters
  }
  // dirt: rain streaks under every window column, darker plinth zone, weathering noise
  float streak = (inGrid && !ground && style != 4) ? smoothstep(0.65, 0.0, abs(lx - bay * 0.5) - 0.45) * (0.5 + 0.5 * vn2(vec2(f.x * 3.0, f.y * 0.15))) : 0.0;
  albedo *= 1.0 - 0.12 * streak - 0.08 * vn2(f * 0.35) - 0.18 * (1.0 - smoothstep(0.0, 1.6, f.y));
  // floor / colour bands
  if ((flags & 64) != 0 && !ground && ly < 0.38) albedo = band * (0.92 + 0.1 * vn2(f * 2.0));
  if (style == 3 && f.y > wallTop - 1.0) albedo = band;                           // school: cream fascia under the roof
  if (style == 4 && f.y > wallTop - 2.0 * flH) albedo = band;                    // Mergelyan crown band
  // ---------------------------------------------------------------- openings
  vec4 r = vec4(0.0); float D = 0.26; int kind = -1;                             // kind: 0 window 1 balcony door 2 loggia 3 shopfront 4 door 5 curtain wall 6 ribbon
  if (inGrid) {
    if (ground) {
      if (style == 4) { r = vec4(0.1, 0.25, bay - 0.1, gH - 0.35); kind = 5; D = 0.12; }
      else if (gfType == 2 || style == 7 || ((flags & 128) != 0)) { r = vec4(0.12, 0.35, bay - 0.12, gH - 1.05); kind = 3; D = 0.16; }
      else if (gfType == 1 && h3(seed, bx, 300.0) < 0.4) { r = vec4(0.25, 0.35, bay - 0.25, gH - 1.05); kind = 3; D = 0.16; }
      else if (h3(seed, bx, 301.0) < 0.18) { r = vec4(bay * 0.5 - 0.65, 0.0, bay * 0.5 + 0.65, 2.45); kind = 4; D = 0.35; }
      else { float ww = 1.2; r = vec4(bay * 0.5 - ww * 0.5, 1.15, bay * 0.5 + ww * 0.5, min(gH - 0.55, 2.9)); kind = 0; }
    } else if (blind) {
      if (abs(bx - floor(nb * 0.5)) < 0.5) { r = vec4(bay * 0.5 - 0.45, flH * 0.42, bay * 0.5 + 0.45, flH * 0.42 + 1.05); kind = 0; }   // stair window only
    } else if (style == 4) { r = vec4(0.05, 0.0, bay - 0.05, flH - 0.9); kind = 5; D = 0.08; }
    else if (style == 5) { r = vec4(0.0, 0.95, bay, flH - 0.45); kind = 6; D = 0.12; }
    else if (style == 2 && (flags & 1) != 0) { r = vec4(0.25, 0.0, bay - 0.25, flH - 0.35); kind = 1; D = 1.3; }    // slab: deep continuous balconies (3D parapets in front)
    else {
      int ck = cellKind(style, seed, bx, row);
      if ((flags & 32) != 0 && mod(bx, 6.0) < 1.0) ck = 2;                          // stack of open loggias (Orbeli 10)
      float ww = style == 1 ? 1.45 : style == 6 ? 2.2 : 1.36, wh = style == 1 ? 1.5 : style == 6 ? 2.9 : 1.86, sh = style == 1 ? 0.85 : 0.9;
      if (ck == 1) { r = vec4(bay * 0.5 - 1.15, 0.0, bay * 0.5 + 0.25, flH - 0.5); kind = 1; D = 0.3; }          // balcony door + window
      else if (ck == 2) { r = vec4(0.18, 0.05, bay - 0.18, flH - 0.35); kind = 2; D = 1.1; }
      else { r = vec4(bay * 0.5 - ww * 0.5, sh, bay * 0.5 + ww * 0.5, sh + wh); kind = 0; }
    }
  }
  bool inside = kind >= 0 && lx > r.x && lx < r.z && ly > r.y && ly < r.w;
  float lit = step(h3(seed, bx, row + 50.0), (ground ? 0.55 : 0.32)) * uNight;
  vec3 litC = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.92, 1.0), step(0.7, h3(seed, bx, row + 51.0)));
  if (kind >= 0 && !inside && lod < 0.99) {
    // stone surround + projecting sill + lintel shadow (Stalin / school / market)
    if (kind == 0 && (style == 0 || style == 3 || style == 6)) {
      float sw = 0.14; bool ring = lx > r.x - sw && lx < r.z + sw && ly > r.y - 0.1 && ly < r.w + sw;
      if (ring) { albedo = mix(albedo, pal * 1.25 + 0.06, 0.8); rough = 0.8; }
      if (ly < r.y && ly > r.y - 0.1 && lx > r.x - 0.24 && lx < r.z + 0.24) { albedo = pal * 1.35 + 0.08; nW = normalize(Nw + vec3(0.0, 0.8, 0.0)); }
      if (ly < r.y - 0.1 && ly > r.y - 0.24 && lx > r.x - 0.24 && lx < r.z + 0.24) albedo *= 0.55;            // sill drop shadow
      if (ly > r.w + sw && ly < r.w + sw + 0.12 && lx > r.x - sw && lx < r.z + sw) albedo *= 0.75;
    }
  }
  float isGlass = 0.0;
  if (inside && lod < 0.99) {
    vec3 hp; int sid = recess(vec2(lx, ly), v, r, D, hp);
    float dk = clamp(-hp.z / D, 0.0, 1.0);
    if (sid != 0) {                                                                 // reveal surfaces: correct normals, darker with depth
      vec3 revealC = (style == 1 || style == 2) ? pal * 0.95 : pal * 1.15 + 0.04;
      if (kind == 2 || kind == 1 && style == 2) revealC = vec3(0.86, 0.82, 0.74);
      albedo = revealC * (1.0 - 0.45 * dk); rough = 0.85;
      nW = sid == 1 ? Tw : sid == 2 ? -Tw : sid == 3 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
      if (sid == 4) albedo *= 0.6;
    } else {
      vec2 g = hp.xy - r.xy, gs = r.zw - r.xy;                                       // point on the glass / back plane
      if (kind == 2 && style != 2 || kind == 1 && style == 2) {                      // open loggia / deep balcony: back wall with window + door
        albedo = vec3(0.84, 0.79, 0.7) * (1.0 - 0.3 * dk); rough = 0.9; nW = Nw;
        vec4 r2 = vec4(gs.x * 0.12, 0.0, gs.x * 0.55, gs.y - 0.25), r3 = vec4(gs.x * 0.62, gs.y * 0.33, gs.x * 0.92, gs.y - 0.3);
        if ((g.x > r2.x && g.x < r2.z && g.y < r2.w) || (g.x > r3.x && g.x < r3.z && g.y > r3.y && g.y < r3.w)) { albedo = vec3(0.12, 0.14, 0.16); rough = 0.08; isGlass = 1.0; emis = litC * lit * 0.9; }
        if (h3(seed, bx, row + 60.0) < 0.35 && g.y > gs.y * 0.62 && g.y < gs.y * 0.66) albedo = vec3(0.9, 0.9, 0.95);   // washing line
      } else {
        // frames: PVC (white) or old wood (brown); mullion + transom; shopfronts get a grid
        float fw = kind == 3 ? 0.07 : 0.065;
        bool wood = h3(seed, bx, row + 70.0) < 0.12;
        vec3 frameC = wood ? vec3(0.32, 0.2, 0.12) : vec3(0.86, 0.86, 0.84);
        float fr = 0.0;
        fr = max(fr, 1.0 - step(fw, min(min(g.x, gs.x - g.x), min(g.y, gs.y - g.y))));
        if (kind == 0 || kind == 1) { fr = max(fr, 1.0 - step(fw * 0.5, abs(g.x - gs.x * (kind == 1 ? 0.62 : 0.5)))); if (kind == 0) fr = max(fr, 1.0 - step(fw * 0.5, abs(g.y - gs.y * 0.72))); }
        if (kind == 3) { fr = max(fr, 1.0 - step(fw * 0.5, abs(mod(g.x, gs.x / max(1.0, floor(gs.x / 1.4))) - 0.0))); fr = max(fr, 1.0 - step(fw * 0.5, abs(g.y - (gs.y - 0.5)))); }
        if (kind == 5) { fr = max(fr, 1.0 - step(0.04, abs(g.y - gs.y * 0.5))); }
        if (kind == 6) { fr = max(fr, 1.0 - step(0.04, abs(mod(g.x, 1.5) - 0.75) - 0.71)); }
        if (fr > 0.5) { albedo = kind == 5 ? vec3(0.5, 0.52, 0.53) : frameC; rough = 0.45; nW = Nw; }
        else {
          isGlass = 1.0;
          float wroom = kind == 3 ? gs.x : gs.x, R = kind == 3 ? 6.0 : 3.6;
          float wallK = 1.0; float rs = seed * 31.0 + bx * 7.0 + row * 13.0;
          vec3 rcAvg = mix(vec3(0.72, 0.66, 0.55), vec3(0.62, 0.70, 0.66), h3(rs, 11.0, 3.0)) * (0.8 + 0.3 * h3(rs, 13.0, 1.0)) * 0.62;      // average colour of the room (what far windows show)
          vec3 rc = rcAvg;
          if (rfade > 0.0) rc = mix(rcAvg, room(g, normalize(vec3(v.xy, v.z)), wroom, kind == 3 ? gs.y + 0.6 : flH - 0.4, R, rs, lit, wallK), rfade);
          float curtain = 0.0;
          if (kind == 0 || kind == 1) { float hc = h3(seed, bx, row + 80.0); if (hc < 0.55) { float cw = gs.x * (0.18 + 0.2 * hc); curtain = step(g.x, cw) + step(gs.x - cw, g.x); } if (hc > 0.8) curtain = max(curtain, 0.55); }
          vec3 curtainC = mix(vec3(0.85, 0.8, 0.68), vec3(0.6, 0.45, 0.4), h3(seed, bx, row + 81.0));
          vec3 inside_ = mix(rc, curtainC, clamp(curtain, 0.0, 1.0));
          if (kind == 3) {                                                          // shop: brighter, mostly lit at night, goods silhouettes
            inside_ = mix(inside_, vec3(0.9, 0.9, 0.85), 0.25); lit = step(h3(seed, bx, 310.0), 0.8) * uNight;
          }
          if (kind == 5) inside_ = mix(vec3(0.18, 0.32, 0.22), inside_, 0.25);       // tinted green curtain wall (Mergelyan)
          albedo = inside_ * 0.06; rough = 0.04; nW = Nw;                         // flat glass (no mortar relief: glossy + bumpy = fireflies)                                     // glass: dark + glossy (env / probe reflections), room shows through emission
          float dayView = uDay * 0.32;
          emis = inside_ * (dayView + lit * (kind == 3 ? 2.4 : 1.6)) * (lit > 0.0 ? litC : vec3(1.0));
        }
      }
    }
  } else if (inside) {                                                              // LOD: average glass colour + lit glow
    albedo = vec3(0.07, 0.08, 0.09); rough = 0.1; isGlass = 1.0; nW = Nw; emis = litC * lit * (kind == 3 ? 1.6 : 1.0) * 0.75;
  }
  // far LOD: blend the whole cell towards its average so distant facades do not alias
  if (lod > 0.0 && kind >= 0) {
    float frac = clamp((r.z - r.x) * (r.w - r.y) / (bay * (ground ? gH : flH)), 0.0, 1.0);
    vec3 avg = mix(albedo, mix(pal, vec3(0.08), frac * 0.8), lod * 0.85);
    albedo = avg; emis = mix(emis, litC * lit * frac * 0.9, lod * step(0.5, frac + 0.4));
  }
  // shop fascia + sign band
  if (ground && kind == 3 && ly > gH - 1.0 && ly < gH - 0.25) {
    vec3 sc = vec3(h3(seed, bx, 320.0), h3(seed, bx, 321.0), h3(seed, bx, 322.0)); sc = mix(vec3(0.9), sc * sc * 1.2, step(0.3, h3(seed, bx, 323.0)));
    albedo = sc; rough = 0.35; nW = Nw; emis = sc * uNight * 1.4 * step(0.25, h3(seed, bx, 324.0));
  }
  diffuseColor.rgb = albedo;
  float fRough = rough; vec3 fNW = nW; vec3 fEmis = emis;
#if FACDBG == 1
  diffuseColor.rgb = vec3(0.0); fEmis = emis;
#elif FACDBG == 2
  diffuseColor.rgb = vec3(0.0); fEmis = albedo;
#elif FACDBG == 3
  diffuseColor.rgb = vec3(0.0); fEmis = nW * 0.5 + 0.5;
#elif FACDBG == 4
  diffuseColor.rgb = vec3(0.0); fEmis = vec3(lod, pix * 4.0, float(kind) / 6.0);
#endif
`;

function makeWallMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 1.0 });
  const dbg = +(new URLSearchParams(location.search).get('facdbg') || 0);     // debug views: 1 emission, 2 albedo, 3 normal, 4 lod / px size / opening kind
  m.defines = { FACDBG: dbg };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight; sh.uniforms.uDay = shared.uDay;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WALL_VERT_HEAD)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFac = aFac; vSty = aSty; vGrid = aGrid; vBand = aBand; vF = uv;
        vFW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WALL_FRAG_HEAD)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + WALL_FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = fRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize((viewMatrix * vec4(fNW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += fEmis;');
  };
  m.customProgramCacheKey = () => 'streets-facade-v1';
  return m;
}

// sheet-metal hipped roofs (standing seams along the slope, a few red-painted sheets) and flat bitumen roofs
function makeRoofMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN; attribute float aSeed; varying float vRS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRN = normalize(mat3(modelMatrix) * normal); vRS = aSeed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN; varying float vRS;\n' + HASH_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float flatR = step(0.97, vRN.y); vec2 dir = normalize(vRN.xz + 1e-4); vec2 acr = vec2(-dir.y, dir.x);
        float sAc = dot(vRW.xz, acr) / 0.55, sAl = dot(vRW.xz, dir);
        float seam = 1.0 - smoothstep(0.0, 0.06, abs(fract(sAc) - 0.5) - 0.44);
        float sheet = floor(sAc), sheetRow = floor(sAl / 2.4);
        vec3 metal = mix(vec3(0.62, 0.62, 0.6), vec3(0.5, 0.52, 0.53), h3(sheet, sheetRow, vRS));
        if (h3(sheet, floor(sAl / 6.0), vRS + 5.0) < 0.12 + 0.3 * step(0.7, h3(vRS, 1.0, 2.0))) metal = vec3(0.52, 0.2, 0.15);   // red-painted patches
        metal *= 1.0 - 0.25 * vn2(vRW.xz * 0.4);
        vec3 bit = vec3(0.16, 0.16, 0.17) * (0.85 + 0.3 * vn2(vRW.xz * 0.7));
        diffuseColor.rgb = mix(metal * (1.0 - 0.25 * seam), bit, flatR);
        float fRM = mix(0.55, 0.0, flatR), fRR = mix(0.5 - 0.2 * seam, 0.9, flatR);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = fRR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = fRM;');
  };
  m.customProgramCacheKey = () => 'streets-roof-v1';
  return m;
}

// --------------------------------------------------------------------------------------------- geometry
class Acc {   // growable attribute accumulator for one material
  constructor(extra = []) { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.extra = Object.fromEntries(extra.map(([k, n]) => [k, { n, a: [] }])); }
  quad(p, uvs, n, ex = {}) {
    const o = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(p[i][0], p[i][1], p[i][2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(uvs[i][0], uvs[i][1]); for (const k in this.extra) this.extra[k].a.push(...ex[k]); }
    this.idx.push(o, o + 2, o + 1, o, o + 3, o + 2);                      // p0 p1 p2 p3 = bottom-left, bottom-right, top-right, top-left seen from outside
  }
  tri(p, n, ex = {}) { const o = this.pos.length / 3; for (let i = 0; i < 3; i++) { this.pos.push(...p[i]); this.nrm.push(...n); this.uv.push(0, 0); for (const k in this.extra) this.extra[k].a.push(...ex[k]); } this.idx.push(o, o + 1, o + 2); }
  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const k in this.extra) g.setAttribute(k, new THREE.Float32BufferAttribute(this.extra[k].a, this.extra[k].n));
    g.setIndex(this.pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1)); g.computeBoundingSphere(); return g;
  }
}
const srgb = c => { const col = new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); return [col.r, col.g, col.b]; };

/**
 * Builds every block into `root`, chunked in 256 m cells (frustum culling + distance LOD for the small detail meshes).
 * blocks: orbeli.json v2 records { id, lv, ring, front, street, style, pal, roof, gf, band?, flags... }
 */
export function buildStreetBlocks({ blocks, H, root, shared, quality }) {
  const wallMat = makeWallMaterial(shared), roofMat = makeRoofMaterial();
  const std = (hex, rough = 0.9, metal = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
  const plinthMat = std(0x55524f, 0.95), trimMat = std(0xffffff, 0.85); trimMat.vertexColors = true; trimMat.side = THREE.DoubleSide; roofMat.side = THREE.DoubleSide;
  const CELL = 256, cells = new Map();
  const cellOf = (x, z) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; let c = cells.get(k); if (!c) cells.set(k, c = { walls: new Acc([['aFac', 4], ['aSty', 4], ['aGrid', 4], ['aBand', 4]]), plinth: new Acc(), trim: new Acc([['color', 3]]), roof: new Acc([['aSeed', 1]]), balc: [], ac: [], signs: [], slats: [], x: 0, z: 0, n: 0 }); return c; };
  let nWin = 0;
  for (const b of blocks) {
    const ring = b.ring, N = ring.length; if (N < 3) continue;
    const style = STYLE[b.style] ?? 0, G = GRID[style], seed = b.id % 9973;
    const flags0 = (b.pilasters ? FLAG.pilasters : 0) | (b.arches ? FLAG.arches : 0) | (b.topArch ? FLAG.topArch : 0) | (b.loggias ? FLAG.loggias : 0) | (b.band && style !== 3 && style !== 4 ? FLAG.band : 0) | (b.podium ? FLAG.podium : 0);
    const pal = srgb(b.pal ?? [150, 120, 110]), band = srgb(b.band ?? b.slats ?? [232, 220, 196]);
    const gfType = b.gf === 'shops' ? 2 : b.gf === 'mixed' ? 1 : 0;
    let lo = 1e9, hi = -1e9; const cx = ring.reduce((s, p) => s + p[0], 0) / N, cz = ring.reduce((s, p) => s + p[1], 0) / N;
    for (let i = 0; i < N; i++) { const p = ring[i], q = ring[(i + 1) % N]; for (const t of [0, 0.5]) { const y = H(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t); lo = Math.min(lo, y); hi = Math.max(hi, y); } }
    const C = cellOf(cx, cz); C.x += cx; C.z += cz; C.n++;
    const gH = style === 7 ? 4.8 : style === 4 ? 4.2 : gfType === 2 ? 4.3 : gfType === 1 ? 3.9 : style === 1 ? 3.1 : 3.5;
    const y0 = hi + 0.3, floors = Math.max(1, b.lv), top = y0 + gH + Math.max(0, floors - 1) * G.fl, wallH = top - y0;
    const nrm = ring.map((p, i) => { const q = ring[(i + 1) % N], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; return [dz / L, -dx / L, L, dx / L, dz / L]; });
    for (let i = 0; i < N; i++) {
      const p = ring[i], q = ring[(i + 1) % N], [nx, nz, L, ux, uz] = nrm[i], front = b.front?.[i] === 1;
      const blind = !front && L < 13 && style !== 4 && style !== 7;
      const nbays = Math.max(0, Math.floor((L - 0.9) / G.bay)), margin = (L - nbays * G.bay) / 2;
      const flags = flags0 | (front ? FLAG.front : 0) | (blind ? FLAG.blind : 0);
      const ex = { aFac: [...pal, seed], aSty: [style, G.fl, G.bay, gH], aGrid: [nbays, wallH, flags, 0], aBand: [...band, front ? gfType : Math.min(gfType, 1) * 0] };
      C.walls.quad([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], [[-margin, 0], [L - margin, 0], [L - margin, wallH], [-margin, wallH]], [nx, 0, nz], ex);
      C.plinth.quad([[p[0], lo - 0.8, p[1]], [q[0], lo - 0.8, q[1]], [q[0], y0, q[1]], [p[0], y0, p[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [nx, 0, nz]);
      nWin += nbays * floors;
      // ---- 3D details on the CPU, from the same hash as the shader
      const ry = Math.atan2(nx, nz);
      const at = (s, y, out = 0) => [p[0] + ux * (s + margin) + nx * out, y, p[1] + uz * (s + margin) + nz * out];
      if (style === 0 || style === 1) {
        if (!blind) for (let k = 0; k < nbays; k++) for (let f = 0; f < floors - 1; f++) {
          let ck = cellKind(style, seed, k, f); if (b.loggias && k % 6 === 0) ck = 2;
          const y = y0 + gH + f * G.fl;
          if (ck === 1) { const kindB = h3(seed, k, f + 200); C.balc.push({ pos: at(k * G.bay + G.bay * 0.5 - 0.45, y), ry, type: kindB < 0.5 ? 0 : kindB < 0.82 ? 1 : 2, tint: h3(seed, k, f + 201) }); }
          else if (ck === 0 && h3(seed, k, f + 500) < (b.street === 'o' ? 0.16 : 0.1)) C.ac.push({ pos: at(k * G.bay + G.bay * 0.5 + 1.05, y + 0.55, 0.22), ry });
        }
      }
      if (style === 2 && front) for (let f = 0; f < floors - 1; f++) C.slats.push({ a: at(-margin + 0.3, y0 + gH + f * G.fl), b: at(L - margin - 0.3, y0 + gH + f * G.fl), ry, n: [nx, nz] });
      // lightbox signs over Komitas shopfronts
      if (front && gfType > 0) for (let k = 0; k < nbays; k++) {
        const shop = gfType === 2 || h3(seed, k, 300) < 0.4; if (!shop || h3(seed, k, 330) > 0.4) continue;
        C.signs.push({ pos: at(k * G.bay + G.bay * 0.5, y0 + gH - 0.62, 0.18), ry, w: Math.min(G.bay - 0.6, 1.6 + h3(seed, k, 331) * 1.4), col: [h3(seed, k, 320), h3(seed, k, 321), h3(seed, k, 322)] });
      }
    }
    // ---- cornice + parapet (mitred), roof
    const off = (i, d) => { const a = nrm[(i + N - 1) % N], c = nrm[i], mx = a[0] + c[0], mz = a[1] + c[1], k = 1 + a[0] * c[0] + a[1] * c[1]; return [ring[i][0] + (mx / Math.max(k, 0.25)) * d, ring[i][1] + (mz / Math.max(k, 0.25)) * d]; };
    const trimC = style === 1 || style === 2 ? pal.map(v => v * 0.9) : pal.map(v => Math.min(1, v * 1.3 + 0.05));
    const hipped = b.roof === 'hipped' && style !== 1 && N <= 6, corn = style === 0 || style === 6 ? 0.42 : 0.18;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, a0 = off(i, 0), b0 = off(j, 0), a1 = off(i, corn), b1 = off(j, corn), n = [nrm[i][0], 0, nrm[i][1]];
      const Q = (A, B, ya, yb, nn) => C.trim.quad([[A[0], ya, A[1]], [B[0], ya, B[1]], [B[0], yb, B[1]], [A[0], yb, A[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], nn, { color: trimC });
      Q(a1, b1, top - 0.55, top + 0.15, n);
      C.trim.quad([[a0[0], top - 0.55, a0[1]], [b0[0], top - 0.55, b0[1]], [b1[0], top - 0.55, b1[1]], [a1[0], top - 0.55, a1[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0], { color: trimC.map(v => v * 0.6) });
      C.trim.quad([[a1[0], top + 0.15, a1[1]], [b1[0], top + 0.15, b1[1]], [b0[0], top + 0.15, b0[1]], [a0[0], top + 0.15, a0[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0], { color: trimC });
      if (!hipped) { const a2 = off(i, 0.02), b2 = off(j, 0.02); Q(a2, b2, top + 0.15, top + 0.85, n); }
      // ground-floor string course (Stalin blocks): a projecting band between the shops and the flats
      if (style === 0 && b.front?.[i]) { const a3 = off(i, 0.12), b3 = off(j, 0.12); Q(a3, b3, y0 + gH - 0.18, y0 + gH + 0.02, n); }
    }
    if (hipped) {
      // truncated hip: every eave edge slopes up to an inset ring (nearly a ridge on slender blocks), flat cap on top
      let minW = 1e9; for (let i = 0; i < N; i++) { let mx = 0; const [nx, nz] = nrm[i]; for (const p of ring) mx = Math.max(mx, -((p[0] - ring[i][0]) * nx + (p[1] - ring[i][1]) * nz)); minW = Math.min(minW, mx); }
      const ins = Math.max(1, minW * 0.46), rise = ins * 0.55, yE = top + 0.15;
      const inner = ring.map((_, i) => off(i, -ins)), eave = ring.map((_, i) => off(i, 0.45));
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N, A = eave[i], B = eave[j], Ci = inner[j], Di = inner[i];
        const e1 = [B[0] - A[0], 0, B[1] - A[1]], e2 = [Di[0] - A[0], rise + 0.1, Di[1] - A[1]]; let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...nn) || 1; nn = nn.map(v => v / l); if (nn[1] < 0) nn = nn.map(v => -v);
        C.roof.quad([[A[0], yE - 0.1, A[1]], [B[0], yE - 0.1, B[1]], [Ci[0], yE + rise, Ci[1]], [Di[0], yE + rise, Di[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], nn, { aSeed: [seed] });
      }
      const tri = THREE.ShapeUtils.triangulateShape(inner.map(p => new THREE.Vector2(p[0], p[1])), []);
      for (const t of tri) C.roof.tri([t[0], t[2], t[1]].map(k => [inner[k][0], yE + rise, inner[k][1]]), [0, 1, 0], { aSeed: [seed] });
    } else {
      const tri = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []);
      for (const t of tri) C.roof.tri([t[0], t[2], t[1]].map(k => [ring[k][0], top + 0.15, ring[k][1]]), [0, 1, 0], { aSeed: [seed] });
      // roof plant / stair heads and antenna frames on flat roofs
      const [, , , ux, uz] = nrm.reduce((a, c) => (c[2] > a[2] ? c : a), nrm[0]);
      const box = (hx, hz, yb, yt, c0, c1, col) => { const P = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([sx, sz]) => [cx + ux * (sx + c0) - uz * (sz + c1), cz + uz * (sx + c0) + ux * (sz + c1)]); for (let k = 0; k < 4; k++) { const A = P[k], B = P[(k + 1) % 4], dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz) || 1; C.trim.quad([[A[0], yb, A[1]], [B[0], yb, B[1]], [B[0], yt, B[1]], [A[0], yt, A[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [dz / l, 0, -dx / l], { color: col }); } C.trim.quad(P.map(p => [p[0], yt, p[1]]), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0], { color: col }); };
      if (style !== 7) { box(2.2, 1.6, top + 0.15, top + 2.8 + h3(seed, 1, 1) * 0.8, 0, 0, trimC.map(v => v * 0.85)); if (N > 3) box(0.8, 0.8, top + 0.15, top + 1.6, 5, 1.5, [0.45, 0.45, 0.45]); }
    }
  }
  // ------------------------------------------------------------------ meshes per cell
  const balcGeo = makeBalconyGeometries(), acGeo = new THREE.BoxGeometry(0.85, 0.55, 0.32), signGeo = new THREE.BoxGeometry(1, 0.62, 0.2);
  const balcMats = [std(0x2a2b2d, 0.6, 0.6), std(0xe8e4dc, 0.4), std(0x6a6c6e, 0.55, 0.5)], slabMat = std(0xbfb7a8, 0.9), acMat = std(0xd8d8d4, 0.5, 0.2);
  const signMat = new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0 });
  signMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif'); };   // each lightbox glows in its own colour
  const slatMat = std(0x5a4636, 0.8); const glazeMat = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.06, metalness: 0.2, emissive: 0x000000 });
  const lod = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v3 = new THREE.Vector3();
  let tris = 0, draws = 0, balconies = 0;
  for (const C of cells.values()) {
    const grp = new THREE.Group(); root.add(grp); const center = new THREE.Vector3(C.x / C.n, 0, C.z / C.n);
    const add = (geo, mat, cast = true) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; grp.add(m); tris += geo.index.count / 3; draws++; return m; };
    add(C.walls.geometry(), wallMat); add(C.plinth.geometry(), plinthMat); add(C.trim.geometry(), trimMat); add(C.roof.geometry(), roofMat);
    const detail = new THREE.Group(); grp.add(detail);                                // balconies / AC / signs: hidden beyond ~420 m
    if (C.balc.length) {
      const counts = [0, 0, 0]; for (const bc of C.balc) counts[bc.type]++;
      const slabs = new THREE.InstancedMesh(balcGeo.slab, slabMat, C.balc.length); slabs.castShadow = slabs.receiveShadow = true;
      const kinds = [0, 1, 2].map(t => counts[t] ? new THREE.InstancedMesh(balcGeo.kinds[t], balcMats[t], counts[t]) : null);
      const glz = counts[1] ? new THREE.InstancedMesh(balcGeo.glaze, glazeMat, counts[1]) : null; const ki = [0, 0, 0];
      C.balc.forEach((bc, i) => { q.setFromAxisAngle(up, bc.ry); m4.compose(v3.set(...bc.pos), q, one); slabs.setMatrixAt(i, m4); kinds[bc.type].setMatrixAt(ki[bc.type], m4); if (bc.type === 1) glz.setMatrixAt(ki[1], m4); ki[bc.type]++; });
      for (const k of [...kinds, glz]) if (k) { k.castShadow = true; k.receiveShadow = true; detail.add(k); draws++; }
      detail.add(slabs); draws++; balconies += C.balc.length; tris += C.balc.length * 60;
    }
    if (C.ac.length) { const ac = new THREE.InstancedMesh(acGeo, acMat, C.ac.length); C.ac.forEach((a, i) => { q.setFromAxisAngle(up, a.ry); m4.compose(v3.set(...a.pos), q, one); ac.setMatrixAt(i, m4); }); ac.castShadow = true; detail.add(ac); draws++; }
    if (C.signs.length) {
      const sg = new THREE.InstancedMesh(signGeo, signMat, C.signs.length), col = new THREE.Color();
      C.signs.forEach((s, i) => { q.setFromAxisAngle(up, s.ry); m4.compose(v3.set(...s.pos), q, new THREE.Vector3(s.w, 1, 1)); sg.setMatrixAt(i, m4); col.setRGB(0.25 + s.col[0] * 0.75, 0.25 + s.col[1] * 0.75, 0.25 + s.col[2] * 0.75); sg.setColorAt(i, col); });
      detail.add(sg); draws++;
    }
    if (C.slats.length) {   // continuous slatted balcony parapets (Orbeli 8): one long box per floor
      const sl = new Acc(); for (const s of C.slats) { const [nx, nz] = s.n, o = 1.25, h0 = 0.0, h1 = 1.05; const A = [s.a[0] + nx * o, s.a[2] + nz * o], B = [s.b[0] + nx * o, s.b[2] + nz * o];
        sl.quad([[A[0], s.a[1] + h0, A[1]], [B[0], s.b[1] + h0, B[1]], [B[0], s.b[1] + h1, B[1]], [A[0], s.a[1] + h1, A[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [nx, 0, nz]);
        sl.quad([[s.a[0], s.a[1] - 0.18, s.a[2]], [s.b[0], s.b[1] - 0.18, s.b[2]], [B[0], s.b[1] - 0.18, B[1]], [A[0], s.a[1] - 0.18, A[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0]); }
      const g = sl.geometry(); const m = new THREE.Mesh(g, slatMat); m.castShadow = true; detail.add(m); draws++;
      slatMat.side = THREE.DoubleSide;
    }
    lod.push({ center, detail });
  }
  return {
    stats: { blocks: blocks.length, windows: nWin, tris: Math.round(tris), draws, balconies, cells: cells.size },
    signMat,
    /** per frame: distance LOD of the small detail meshes */
    update(camPos, night) {
      signMat.emissiveIntensity = 1.6 * night;
      const r2 = 420 * 420; for (const l of lod) { const dx = l.center.x - camPos.x, dz = l.center.z - camPos.z; l.detail.visible = dx * dx + dz * dz < r2; }
    },
  };
}

function makeBalconyGeometries() {
  const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const merge = list => { const pos = [], nrm = [], idx = []; for (const g of list) { const o = pos.length / 3, gi = g.toNonIndexed ? g : g; const p = g.attributes.position.array, n = g.attributes.normal.array; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nrm.push(n[i]); } for (const k of g.index.array) idx.push(o + k); } const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); out.setIndex(idx); return out; };
  const W = 2.6, Dd = 1.1;
  const slab = B(W + 0.1, 0.16, Dd + 0.05, 0, -0.04, Dd / 2);
  // 0: open iron balustrade (top rail, bottom rail, 12 balusters, side rails)
  const iron = [B(W, 0.05, 0.05, 0, 1.0, Dd), B(W, 0.04, 0.04, 0, 0.12, Dd), B(0.04, 0.95, Dd, -W / 2, 0.55, Dd / 2), B(0.04, 0.95, Dd, W / 2, 0.55, Dd / 2)];
  for (let i = 0; i <= 12; i++) iron.push(B(0.022, 0.9, 0.022, -W / 2 + W * i / 12, 0.55, Dd));
  // 1: glazed-in enclosure (solid parapet + frame + roof), glass separately
  const glazedFrame = [B(W, 1.0, 0.06, 0, 0.5, Dd), B(0.06, 1.0, Dd, -W / 2, 0.5, Dd / 2), B(0.06, 1.0, Dd, W / 2, 0.5, Dd / 2), B(W + 0.12, 0.08, Dd + 0.1, 0, 2.62, Dd / 2), B(W, 0.06, 0.06, 0, 2.55, Dd), B(0.05, 1.55, 0.05, -W / 2, 1.8, Dd), B(0.05, 1.55, 0.05, W / 2, 1.8, Dd), B(0.05, 1.55, 0.05, 0, 1.8, Dd)];
  const glaze = merge([B(W - 0.05, 1.5, 0.02, 0, 1.78, Dd - 0.02), B(0.02, 1.5, Dd - 0.05, -W / 2 + 0.02, 1.78, Dd / 2), B(0.02, 1.5, Dd - 0.05, W / 2 - 0.02, 1.78, Dd / 2)]);
  // 2: welded metal cage (grid of bars up to the slab above)
  const cage = [B(W, 0.05, 0.05, 0, 1.0, Dd), B(W, 0.05, 0.05, 0, 2.6, Dd), B(0.05, 2.6, 0.05, -W / 2, 1.3, Dd), B(0.05, 2.6, 0.05, W / 2, 1.3, Dd), B(W, 0.9, 0.03, 0, 0.5, Dd)];
  for (let i = 1; i < 9; i++) cage.push(B(0.02, 1.6, 0.02, -W / 2 + W * i / 9, 1.8, Dd));
  for (let i = 1; i < 4; i++) cage.push(B(W, 0.02, 0.02, 0, 1.0 + 0.4 * i, Dd));
  return { slab, kinds: [merge(iron), merge(glazedFrame), merge(cage)], glaze };
}
