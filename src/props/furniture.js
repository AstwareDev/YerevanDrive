// Street furniture, part 1: traffic signals (GPU-animated lamps), road signs, street-name plates, bus shelters, kiosks, cafe terraces, flags,
// rooftop signs, blade signs, awnings. Part 2 (benches, bins, bollards, racks, planters, columns, drains, cones, poles, wires) lives in street.js.
// Every family is instanced and culled per 128 m cell (Furn.fam -> CellFamily).
import * as THREE from 'three';
import { GeoBuilder, composeInto, lin, mul } from './util.js';
import { signAtlas, namePlateAtlas, adAtlas, brandAtlas, bladeAtlas, flagTexture, awningTexture } from './textures.js';
import { Furn, makeMats, GY, C, tileMaterial, addTileAttr, tilePos, plateGeo, tileEx, quality } from './fhelp.js';
import { buildStreet } from './street.js';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const arrOf = (flat, stride) => { const n = (flat?.length ?? 0) / stride; return { n, at: (i, k) => flat[i * stride + k] }; };

// roof height lookup (raycast the map's roof meshes) for rooftop signs
function makeRoofCaster(scene, M) {
  const roofs = []; scene.updateMatrixWorld(true); scene.traverse(o => { if (o.isMesh && o.material === M.roof) { o.userData.bb = new THREE.Box3().setFromObject(o); roofs.push(o); } });
  const rc = new THREE.Raycaster(), o = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0);
  return (x, z) => {
    o.set(x, 600, z); rc.set(o, d); rc.far = 1200;
    const cands = roofs.filter(r => { const b = r.userData.bb; return x >= b.min.x - 1 && x <= b.max.x + 1 && z >= b.min.z - 1 && z <= b.max.z + 1; });
    if (!cands.length) return null; const hits = rc.intersectObjects(cands, false); return hits.length ? hits[0].point.y : null;
  };
}

// ------------------------------------------------------------------ traffic signal geometry (local: pole at origin, mast along +x, vehicle heads face +-z, pedestrian head faces +-x)
const ON = [[6, 0.25, 0.12], [6, 2.8, 0.2], [0.35, 5.0, 1.8], [6, 0.25, 0.12], [0.35, 5.0, 1.8]];
function signalGeo(len, big) {
  const body = new GeoBuilder(), lamps = new GeoBuilder(), kinds = [];
  const lampDisc = (c, n, r, kind) => {
    const s0 = lamps.n, up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(up, n)), w = cross(n, u), col = ON[kind], ctr = lamps.v(c, n, [0, 0], col), ring = [];
    for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; ring.push(lamps.v([c[0] + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * r, c[1] + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * r, c[2] + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * r], n, [0, 0], col)); }
    for (let k = 0; k < 12; k++) lamps.tri(ctr, ring[(k + 1) % 12], ring[k]);
    for (let v = s0; v < lamps.n; v++) kinds[v] = kind;
  };
  const head = (c, face, nLamp, ped) => { // face: 'z' (vehicle) or 'x' (pedestrian)
    const along = face === 'z' ? [0, 0, 1] : [1, 0, 0], bw = 0.17, bh = nLamp * (ped ? 0.17 : 0.3) / 2 + 0.07, bd = ped ? 0.1 : 0.14, sb = new GeoBuilder();
    if (face === 'z') sb.box(0, 0, 0, bw, bh, bd, C.dark); else sb.box(0, 0, 0, bd, bh, bw, C.dark);
    body.addGeo(sb, new THREE.Matrix4().setPosition(c[0], c[1], c[2]));
    for (const side of [1, -1]) {
      const n = [along[0] * side, 0, along[2] * side];
      for (let k = 0; k < nLamp; k++) {
        const y = (nLamp === 3 ? [0.3, 0, -0.3][k] : [0.13, -0.13][k]) * (ped ? 0.85 : 1); const p = [c[0] + n[0] * (bd + 0.006), c[1] + y, c[2] + n[2] * (bd + 0.006)];
        // face lamps: red/amber/green for vehicles, ped red/green
        const kind = nLamp === 3 ? k : 3 + k; lampDisc(p, n, ped ? 0.065 : 0.1, kind);
        // visor hood above each lamp
        const vb = new GeoBuilder(); if (face === 'z') vb.box(0, y + 0.1, side * (bd + 0.05), ped ? 0.08 : 0.13, 0.012, 0.05, C.dark); else vb.box(side * (bd + 0.05), y + 0.1, 0, 0.05, 0.012, 0.08, C.dark);
        body.addGeo(vb, new THREE.Matrix4().setPosition(c[0], c[1], c[2]));
      }
    }
  };
  body.tube([0, -0.05, 0], [0, 6.0, 0], 0.11, 0.07, 10, C.grey, C.grey, true);
  body.tube([0, 5.92, 0], [len, 6.07, 0], 0.06, 0.04, 8, C.grey, C.grey, true);
  body.tube([0, 5.35, 0], [len * 0.4, 5.97, 0], 0.035, 0.035, 6, C.grey);
  head([len - 0.3, 5.45, 0], 'z', 3, false);
  if (big && len > 5) head([len * 0.55, 5.5, 0], 'z', 3, false);
  head([0.28, 3.1, 0], 'z', 3, false);
  head([0.2, 2.2, 0], 'x', 2, true);
  body.box(0.2, 1.3, 0.13, 0.05, 0.1, 0.02, lin('#d8d8d0')); // push-button box
  const lg = lamps.build(); lg.setAttribute('aKind', new THREE.BufferAttribute(Float32Array.from(kinds), 1));
  return { body: body.build(), lamps: lg };
}
function lampMaterial(uClock, uNight) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  m.onBeforeCompile = sh => {
    sh.uniforms.uClock = uClock; sh.uniforms.uNightK = uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aKind; attribute float aGrp; uniform float uClock; uniform float uNightK;')
      .replace('#include <color_vertex>', `
        vColor = vec4(color, 1.0);
        { float T = 28.0, GT = 11.0, AT = 3.0; float tt = mod(uClock + aGrp * 14.0, T); float st = tt < GT ? 0.0 : (tt < GT + AT ? 1.0 : 2.0); float on = 0.0;
          if (aKind < 0.5) on = step(1.5, st); else if (aKind < 1.5) on = step(0.5, st) * step(st, 1.5); else if (aKind < 2.5) on = step(st, 0.5);
          else if (aKind < 3.5) on = 1.0 - step(1.5, st);
          else { on = step(1.5, st) * step(GT + AT + 3.0, tt); if (tt > T - 4.0 && fract(uClock) < 0.5) on = 0.0; }
          vColor.rgb *= mix(0.03, 1.0, on) * mix(0.35, 1.0, uNightK); }`);
  };
  m.customProgramCacheKey = () => 'signalLamps';
  return m;
}

export function buildFurniture(ctx) {
  const { scene, H, data, M, tod } = ctx;
  const mats = makeMats(), F = new Furn(scene, H, mats), { metal, glow } = mats, ps = quality.propScale;
  const uClock = { value: 0 }, uNight = { value: 1 };
  F.updates.push((dt, cam, time) => { uClock.value = time; uNight.value = tod?.night ?? 1; });

  // ================================================================== traffic signals
  {
    const S = arrOf(data.signals, 7);
    if (S.n) {
      const bins = [[3.2, 0], [5.4, 0], [7.6, 1]], vars = bins.map(([len, big]) => ({ len, big, items: [] }));
      for (let i = 0; i < S.n; i++) { const len = Math.max(2.5, Math.abs(S.at(i, 4))); const k = len < 4.3 ? 0 : len < 6.5 ? 1 : 2; vars[k].items.push(i); }
      const lampMat = lampMaterial(uClock, uNight);
      for (const v of vars) {
        const n = v.items.length; if (!n) continue; const g = signalGeo(v.len, v.big), m = new Float32Array(n * 16), grp = new Float32Array(n);
        v.items.forEach((i, k) => {
          const x = S.at(i, 0), z = S.at(i, 1), tx = S.at(i, 2), tz = S.at(i, 3), mast = S.at(i, 4), sgn = Math.sign(mast) || 1, nx = -tz, nz = tx, mx = nx * sgn, mz = nz * sgn;
          composeInto(m, k, x, H(x, z) + GY, z, Math.atan2(-mz, mx), 1, 1, 1); grp[k] = S.at(i, 5);
        });
        const bm = F.mesh(g.body, metal, n), lm = F.mesh(g.lamps, lampMat, n), ga = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); ga.setUsage(THREE.DynamicDrawUsage); g.lamps.setAttribute('aGrp', ga);
        F.fam([bm, lm], m, 260, { extras: [{ mesh: lm, attr: ga, data: grp, size: 1 }], radius: 5, mid: 3.5, name: 'signals' + v.len });
      }
    }
  }

  // ================================================================== road signs + street name plates (pole + plate)
  {
    const S = arrOf(data.signs, 4);
    if (S.n) {
      const atlas = (F.shared.sign ??= signAtlas()), pg = plateGeo(0.6, 0.6, [0.875, 0.125]), tiles = []; for (let i = 0; i < S.n; i++) tiles.push(tilePos(S.at(i, 3), 4, 4));
      addTileAttr(pg, S.n, tiles, [4, 5, 6, 7]);
      const mat = tileMaterial(new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: new THREE.Color(0.55, 0.55, 0.55), roughness: 0.45, metalness: 0.1, alphaTest: 0.5, side: THREE.DoubleSide }), 0.25, 0.25);
      const pole = new GeoBuilder(); pole.tube([0, 0, 0], [0, 2.7, 0], 0.04, 0.035, 8, C.steel, C.steel, true); pole.box(0, 2.28, 0, 0.012, 0.04, 0.05, C.steel); pole.box(0, 2.42, 0, 0.012, 0.04, 0.05, C.steel);
      const plates = F.mesh(pg, mat, S.n), poles = F.mesh(pole.build(), metal, S.n), dp = new Float32Array(S.n * 16), dq = new Float32Array(S.n * 16);
      for (let i = 0; i < S.n; i++) { const x = S.at(i, 0), z = S.at(i, 1), yaw = S.at(i, 2), y = H(x, z) + GY; composeInto(dp, i, x, y + 2.35, z, yaw); composeInto(dq, i, x, y, z, yaw); }
      F.fam([plates], dp, 170, { extras: [tileEx(plates)], radius: 1.6, mid: 2.3, name: 'signs' }); F.fam([poles], dq, 170, { radius: 1.6, mid: 1.3, name: 'signPoles' });
    }
    const N = arrOf(data.names, 4);
    if (N.n) {
      const atlas = namePlateAtlas(data.nameList), pg = plateGeo(1.1, 0.28, [0.5, 0.0625]), tiles = []; for (let i = 0; i < N.n; i++) tiles.push([(N.at(i, 3) % 2) / 2, 1 - (Math.floor(N.at(i, 3) / 2) + 1) / 8]);
      addTileAttr(pg, N.n, tiles, [4, 5, 6, 7]);
      const mat = tileMaterial(new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: new THREE.Color(0.45, 0.45, 0.5), roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }), 0.5, 0.125);
      const pole = new GeoBuilder(); pole.tube([0, 0, 0], [0, 3.0, 0], 0.035, 0.03, 8, C.steel, C.steel, true);
      const plates = F.mesh(pg, mat, N.n), poles = F.mesh(pole.build(), metal, N.n), dp = new Float32Array(N.n * 16), dq = new Float32Array(N.n * 16);
      for (let i = 0; i < N.n; i++) { const x = N.at(i, 0), z = N.at(i, 1), yaw = N.at(i, 2), y = H(x, z) + GY; composeInto(dp, i, x, y + 2.85, z, yaw); composeInto(dq, i, x, y, z, 0); }
      F.fam([plates], dp, 150, { extras: [tileEx(plates)], radius: 1.4, mid: 2.8, name: 'names' }); F.fam([poles], dq, 150, { radius: 1.4, mid: 1.5, name: 'namePoles' });
    }
  }

  // ================================================================== bus shelters (frame, glass, light strip, ad box) + timetable
  {
    const B = arrOf(data.busstops, 4);
    if (B.n) {
      const frame = new GeoBuilder();
      frame.box(0, 2.45, 0, 1.75, 0.045, 0.8, C.dark); frame.box(0, 2.5, 0, 1.78, 0.03, 0.83, C.grey);
      for (const sx of [-1.7, 1.7]) for (const sz of [-0.75, 0.75]) frame.tube([sx, 0, sz], [sx, 2.45, sz], 0.04, 0.04, 8, C.grey, C.grey, true);
      for (const sy of [0.04, 2.38]) for (const sz of [-0.75, 0.75]) frame.box(0, sy, sz, 1.7, 0.025, 0.02, C.grey);
      // slatted bench + armrest
      for (let k = 0; k < 3; k++) frame.box(0, 0.46, -0.52 - k * 0.11, 0.9, 0.012, 0.045, C.wood);
      frame.box(0, 0.78, -0.76, 0.9, 0.12, 0.012, C.wood); for (const sx of [-0.8, 0.8]) { frame.box(sx, 0.22, -0.62, 0.03, 0.22, 0.16, C.dark); frame.box(sx, 0.62, -0.7, 0.03, 0.02, 0.1, C.dark); }
      frame.box(0, 0.06, 0, 1.85, 0.06, 0.85, lin('#2d2f35'));
      frame.box(2.35, 0.9, 0, 0.58, 0.9, 0.07, C.dark); frame.box(2.35, 1.85, 0, 0.62, 0.04, 0.09, C.grey); // ad box
      frame.box(-0.95, 1.05, -0.77, 0.34, 0.3, 0.012, lin('#e8e8e0')); // timetable board
      frame.box(1.45, 1.25, -0.77, 0.12, 0.1, 0.01, lin('#0a4ea8')); // stop plate
      const frameM = F.mesh(frame.build(), metal, B.n);
      const gl = new GeoBuilder(), glc = lin('#16222e'); gl.box(0, 1.25, -0.8, 1.68, 1.0, 0.012, glc); gl.box(-1.7, 1.25, 0, 0.012, 1.0, 0.72, glc); gl.box(1.7, 1.25, 0, 0.012, 1.0, 0.72, glc);
      const glassM = F.mesh(gl.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.45, envMapIntensity: 1.5, depthWrite: false }), B.n);
      const strip = new GeoBuilder(); strip.box(0, 2.38, 0.2, 1.5, 0.018, 0.04, [3.6, 3.2, 2.4]); strip.box(0, 2.38, -0.4, 1.5, 0.018, 0.04, [3.6, 3.2, 2.4]); strip.box(-0.95, 1.05, -0.755, 0.3, 0.26, 0.004, [1.4, 1.4, 1.3]);
      const stripM = F.mesh(strip.build(), glow, B.n);
      const ad = (F.shared.ad ??= adAtlas()), pg = plateGeo(1.0, 1.55, [0, 0], 0.075), tiles = []; for (let i = 0; i < B.n; i++) tiles.push(tilePos(B.at(i, 3) % 6, 3, 2));
      addTileAttr(pg, B.n, tiles, [4, 5, 6, 7]); const uvA = pg.attributes.uv; for (let i = 4; i < 8; i++) uvA.setXY(i, [0, 1, 1, 0][i - 4], [0, 0, 1, 1][i - 4]);
      const bk = pg.attributes.aBack; for (let i = 0; i < 8; i++) bk.setX(i, 0); uvA.setXY(4, 1, 0); uvA.setXY(5, 0, 0); uvA.setXY(6, 0, 1); uvA.setXY(7, 1, 1);
      const adM = F.mesh(pg, tileMaterial(new THREE.MeshBasicMaterial({ map: ad, color: new THREE.Color(1.9, 1.9, 1.9), toneMapped: false, side: THREE.DoubleSide }), 1 / 3, 1 / 2), B.n);
      const df = new Float32Array(B.n * 16), da = new Float32Array(B.n * 16);
      for (let i = 0; i < B.n; i++) { const x = B.at(i, 0), z = B.at(i, 1), yaw = B.at(i, 2), y = H(x, z) + GY; composeInto(df, i, x, y, z, yaw); const c = Math.cos(yaw), s = Math.sin(yaw); composeInto(da, i, x + 2.35 * c, y + 1.15, z - 2.35 * s, yaw); }
      F.fam([frameM, glassM, stripM], df, 350, { radius: 4, mid: 1.3, name: 'busstops' }); F.fam([adM], da, 350, { extras: [tileEx(adM)], radius: 1.3, mid: 0.8, name: 'busAds' });
    }
  }

  // ================================================================== kiosks (OSM): sheet-metal booth with a glowing counter window, sign band, awning
  {
    const K = arrOf(data.kiosks, 6);
    if (K.n) {
      // unit box local: x = depth (front faces +x), z = long side; instance scale (dd, 1, w) applies to the whole geometry, so keep details thin
      const body = new GeoBuilder(); body.box(0.5, 1.3, 0, 0.5, 1.3, 0.5, [1, 1, 1]); body.box(0.5, 2.68, 0, 0.56, 0.05, 0.56, [0.3, 0.3, 0.33]);
      body.box(1.0, 0.45, 0, 0.006, 0.45, 0.46, [0.5, 0.5, 0.55]); // lower panel recess
      body.box(0.5, 0.06, 0, 0.52, 0.06, 0.52, [0.18, 0.18, 0.2]);
      const bm = F.mesh(body.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }), K.n, true);
      const win = new GeoBuilder(); win.box(1.0, 1.55, 0, 0.012, 0.28, 0.36, [2.8, 2.2, 1.4]); win.box(1.0, 2.35, 0, 0.012, 0.1, 0.4, [0.5, 1.6, 2.4]);
      const wm = F.mesh(win.build(), glow, K.n);
      const cols = ['#c9d1d6', '#3c6e9e', '#b5472f', '#4e8a5b', '#d6b24a'], d = new Float32Array(K.n * 16), cc = new Float32Array(K.n * 3), c = new THREE.Color();
      for (let i = 0; i < K.n; i++) { const x = K.at(i, 0), z = K.at(i, 1), yaw = K.at(i, 2), w = K.at(i, 3), dd = K.at(i, 4), y = H(x, z) + GY; composeInto(d, i, x - Math.cos(yaw) * dd * 0.5, y, z + Math.sin(yaw) * dd * 0.5, yaw, dd, 1, w); c.set(cols[K.at(i, 5)]); cc.set([c.r, c.g, c.b], i * 3); }
      F.fam([bm, wm], d, 220, { colors: cc, radius: 4, mid: 1.4, name: 'kiosks' });
    }
  }

  // ================================================================== cafe terraces (tables, chairs, umbrellas, candles)
  {
    const Tb = arrOf(data.tables, 4);
    if (Tb.n) {
      const base = new GeoBuilder(), wood = lin('#4a3220'), metalC = lin('#2a2c32');
      base.tube([0, 0.72, 0], [0, 0.755, 0], 0.4, 0.4, 16, wood, wood, true); base.tube([0, 0, 0], [0, 0.72, 0], 0.028, 0.028, 6, metalC); base.tube([0, 0, 0], [0, 0.03, 0], 0.22, 0.22, 10, metalC, metalC, true);
      base.tube([0.5, 0.03, 0.5], [0.5, 2.3, 0.5], 0.014, 0.012, 6, metalC);
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + 0.4, cs = Math.cos(a), sn = Math.sin(a), ch = new GeoBuilder();
        ch.box(0, 0.45, 0, 0.2, 0.015, 0.2, wood); ch.box(0, 0.7, 0.19, 0.2, 0.17, 0.012, wood); for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) ch.box(lx, 0.22, lz, 0.012, 0.22, 0.012, metalC);
        base.addGeo(ch, new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(cs * 0.68, 0, sn * 0.68));
      }
      const baseM = F.mesh(base.build(), metal, Tb.n);
      const umbG = new THREE.ConeGeometry(1.3, 0.38, 12, 1, true).translate(0.5, 2.3, 0.5), umbM = F.mesh(umbG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide, emissive: new THREE.Color(0.07, 0.07, 0.07) }), Tb.n, true);
      const candle = new GeoBuilder(); candle.box(0, 0.79, 0, 0.03, 0.03, 0.03, [5, 2.8, 1.0]); const candleM = F.mesh(candle.build(), glow, Tb.n);
      const pal = ['#b4252d', '#1f6a45', '#1d4f94', '#d37a1e', '#e8e4d8', '#6a1f3a'], d = new Float32Array(Tb.n * 16), uc = new Float32Array(Tb.n * 3), cc = new THREE.Color();
      for (let i = 0; i < Tb.n; i++) { const x = Tb.at(i, 0), z = Tb.at(i, 1); composeInto(d, i, x, H(x, z) + GY, z, Tb.at(i, 2)); cc.set(pal[Tb.at(i, 3) % 6]); uc.set([cc.r, cc.g, cc.b], i * 3); }
      F.fam([baseM, umbM, candleM], d, 150, { colors: uc, radius: 1.8, mid: 1.2, keepFrac: Math.max(ps, 0.6), name: 'tables' });
    }
  }

  // ================================================================== flags (tricolour, waving)
  {
    const Fl = arrOf(data.flags, 4);
    if (Fl.n) {
      const pole = new GeoBuilder(); pole.tube([0, 0, 0], [0, 8.6, 0], 0.07, 0.04, 8, C.light, C.light, true); pole.tube([0, 8.6, 0], [0, 8.78, 0], 0.07, 0.012, 8, [1, 0.8, 0.3], [1, 0.8, 0.3], true); pole.tube([0, 0, 0], [0, 0.25, 0], 0.13, 0.1, 8, C.grey, C.grey, true);
      const pm = F.mesh(pole.build(), metal, Fl.n), dp = new Float32Array(Fl.n * 16);
      const fg = new THREE.PlaneGeometry(2.4, 1.6, 14, 4).translate(1.2, 0, 0), ftex = flagTexture();
      const fm = new THREE.MeshStandardMaterial({ map: ftex, emissiveMap: ftex, emissive: new THREE.Color(0.42, 0.42, 0.42), roughness: 0.8, side: THREE.DoubleSide });
      const uT = { value: 0 }; fm.onBeforeCompile = sh => {
        sh.uniforms.uTime = uT;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
          { float ph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.5; float k = clamp(position.x / 2.4, 0.0, 1.0);
            transformed.z += sin(position.x * 3.2 - uTime * 4.2 + ph) * 0.2 * k + sin(position.x * 7.0 - uTime * 6.1 + ph) * 0.04 * k;
            transformed.y += sin(position.x * 2.0 - uTime * 3.0 + ph) * 0.05 * k - k * k * 0.06; }`);
      }; fm.customProgramCacheKey = () => 'flag';
      const fi = F.mesh(fg, fm, Fl.n), df = new Float32Array(Fl.n * 16);
      for (let i = 0; i < Fl.n; i++) { const x = Fl.at(i, 0), z = Fl.at(i, 1), y = H(x, z) + GY, big = Fl.at(i, 3) ? 1.25 : 1; composeInto(dp, i, x, y, z, 0); composeInto(df, i, x, y + 7.25 + (big - 1) * 0.4, z, 0.55 + (i % 3) * 0.1, big, big, big); }
      F.fam([pm], dp, 380, { radius: 2, mid: 4, name: 'flagPoles' }); F.fam([fi], df, 300, { radius: 3, mid: 0, name: 'flags' });
      F.updates.push((dt, cam, time) => { uT.value = time; });
    }
  }

  // ================================================================== rooftop signs, blade signs, awnings
  {
    const brand = brandAtlas();
    const R = arrOf(data.rooftop, 7);
    if (R.n) {
      const roofAt = makeRoofCaster(scene, M), ok = [];
      for (let i = 0; i < R.n; i++) { const x = R.at(i, 0), z = R.at(i, 1), y = roofAt(x, z); if (y != null && y - H(x, z) > 6 && y - H(x, z) < 120) ok.push([i, y]); }
      const n = ok.length;
      if (n) {
        const bg = new THREE.BoxGeometry(1, 1, 0.28).translate(0, 0.5, 0), legG = new THREE.BoxGeometry(0.05, 1.4, 0.1).translate(0, -0.7, 0);
        const pg = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0.15), tiles = ok.map(([i]) => tilePos(R.at(i, 5) % 12, 2, 6)); addTileAttr(pg, n, tiles);
        const bm = F.mesh(bg, new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.5, metalness: 0.7 }), n), pm = F.mesh(pg, tileMaterial(new THREE.MeshBasicMaterial({ map: brand, color: new THREE.Color(2.3, 2.3, 2.3), toneMapped: false }), 0.5, 1 / 6), n);
        const lm1 = F.mesh(legG.clone().translate(-0.38, 0, 0), bm.material, n), lm2 = F.mesh(legG.clone().translate(0.38, 0, 0), bm.material, n);
        const d = new Float32Array(n * 16), dl = new Float32Array(n * 16);
        ok.forEach(([i, y], k) => { const x = R.at(i, 0), z = R.at(i, 1), yaw = R.at(i, 2), w = R.at(i, 3), h = Math.max(0.9, w * 0.25); composeInto(d, k, x, y + 1.3, z, yaw, w, h, 1); composeInto(dl, k, x, y + 1.3, z, yaw, w, 1, 1); });
        F.fam([bm, pm], d, 900, { extras: [tileEx(pm)], radius: 12, mid: 1, name: 'rooftop' }); F.fam([lm1, lm2], dl, 500, { radius: 12, mid: 0, name: 'rooftopLegs' });
      }
    }
    const Bl = arrOf(data.blades, 5);
    if (Bl.n) {
      const geo = new THREE.BoxGeometry(0.14, 1.5, 0.7).translate(0, 0, 0.45), tiles = []; for (let i = 0; i < Bl.n; i++) tiles.push(tilePos(Bl.at(i, 4) % 16, 4, 4));
      addTileAttr(geo, Bl.n, tiles);
      const m = F.mesh(geo, tileMaterial(new THREE.MeshBasicMaterial({ map: bladeAtlas(), color: new THREE.Color(1.8, 1.8, 1.8), toneMapped: false }), 0.25, 0.25), Bl.n), d = new Float32Array(Bl.n * 16);
      for (let i = 0; i < Bl.n; i++) { const x = Bl.at(i, 0), z = Bl.at(i, 1), y = H(x, z) + Bl.at(i, 3); composeInto(d, i, x, y, z, Bl.at(i, 2)); }
      F.fam([m], d, 260, { extras: [tileEx(m)], radius: 1.4, mid: 0, keepFrac: Math.max(ps, 0.5), name: 'blades' });
    }
    const A = arrOf(data.awnings, 5);
    if (A.n) {
      const g = new GeoBuilder(), ac = [1, 1, 1];
      g.fquad([-0.5, 0.0, 1.0], [0.5, 0.0, 1.0], [0.5, 0.42, 0.0], [-0.5, 0.42, 0.0], ac, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      g.fquad([-0.5, -0.2, 1.0], [0.5, -0.2, 1.0], [0.5, 0.0, 1.0], [-0.5, 0.0, 1.0], ac, [[0, 0], [1, 0], [1, 0.2], [0, 0.2]]);
      for (const s of [-1, 1]) { const a = g.v([0.5 * s, 0, 1], [s, 0, 0], [0, 0], ac), b = g.v([0.5 * s, 0.42, 0], [s, 0, 0], [0, 0], ac), c = g.v([0.5 * s, -0.2, 1], [s, 0, 0], [0, 0], ac); if (s > 0) g.tri(a, b, c); else g.tri(a, c, b); }
      const tex = awningTexture(), m = F.mesh(g.build(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide, vertexColors: true, emissive: new THREE.Color(0.05, 0.04, 0.03), emissiveMap: tex }), A.n, true);
      const pal = ['#b4252d', '#1f6a45', '#1d4f94', '#d37a1e', '#6a1f3a', '#e8e4d8', '#2a7f86', '#7b4a9e'], d = new Float32Array(A.n * 16), cc = new Float32Array(A.n * 3), c = new THREE.Color();
      for (let i = 0; i < A.n; i++) { const x = A.at(i, 0), z = A.at(i, 1), len = A.at(i, 3), y = H(x, z) + 3.0; composeInto(d, i, x, y, z, A.at(i, 2), len, 1, 1.0); c.set(pal[A.at(i, 4) % 8]); cc.set([c.r, c.g, c.b], i * 3); }
      F.fam([m], d, 230, { colors: cc, radius: 5, mid: 0, keepFrac: Math.max(ps, 0.5), name: 'awnings' });
    }
  }

  buildStreet(F, ctx, { arrOf });
  return { update: (dt, cam, time) => F.update(dt, cam, time), stats: () => F.fams.map(f => ({ name: f.name, counts: f.counts })), F, api: F.api };
}
