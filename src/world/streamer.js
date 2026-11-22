// Quadtree tile streamer ("Distant Horizons"-style). Level L tiles are 256*2^L metres; L0 = full detail, L4 = coarse terrain to +-16 km.
// Rule: a node is replaced by its children only when ALL children are loaded (no holes, no popping), and coarser parents stay until then.
//
// Start-up / teleport behaviour (what makes a jump across the map look instant):
//   * coarse levels (>= pinLevel) are PINNED: loaded once in the background, never evicted. Any place on the map therefore already has terrain and
//     simplified buildings under it, and finer tiles fade in on top ("keepCover" shows the nearest loaded ancestor while children stream).
//   * level 3-4 tiles come from ONE packed file (tools/pack-tiles.mjs, tiles/pack34.bin) instead of 128 small requests.
//   * prefetch(x, z): a hint ("the player is about to go there", e.g. a place was selected on the map) queues the tiles around that point early.
//   * a position jump > 120 m starts a burst: more parallel downloads and a bigger per-frame attach budget for a few seconds.
//   * attaching a parsed tile is time-sliced per mesh (a tile = ~20 meshes copied into the shared batches), so no frame eats a whole tile.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { TileBatches } from './batches.js';
import { fetchJSON, fetchBuffer } from '../net.js';

// meshopt decoding off the main thread (tile parsing used to cost several ms of main-thread time per tile)
try { MeshoptDecoder.useWorkers?.(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))); } catch { /* single-threaded fallback */ }
const BATCH = new URLSearchParams(location.search).get('batch') !== '0';     // ?batch=0: one Mesh per tile material (old path, for A/B)

const K = 1.05;                // a node of size S is refined into children when the camera is closer than S*K*lodScale
const key = (L, i, j) => `${L}_${i}_${j}`;
const BURST_MS = 5000, JUMP = 120;

export class Streamer {
  constructor({ scene, materials, manifest, quality, onMesh }) {
    this.scene = scene; this.M = materials; this.quality = quality; this.onMesh = onMesh;
    this.size0 = manifest.size0; this.nodes = new Map(); this.roots = [];
    this.loader = new GLTFLoader(); this.loader.setMeshoptDecoder(MeshoptDecoder);
    for (const [Ls, list] of Object.entries(manifest.levels)) {
      const L = +Ls, S = this.size0 * 2 ** L;
      for (const [i, j, minY, maxY] of list) this.nodes.set(key(L, i, j), { L, i, j, S, minY, maxY, x0: i * S, z0: j * S, state: 'idle', group: null, last: 0, kids: null, parent: null, shown: false });
    }
    for (const n of this.nodes.values()) {
      const p = this.nodes.get(key(n.L + 1, n.i >> 1, n.j >> 1)); if (p) n.parent = p; else this.roots.push(n);
      if (n.L > 0) { const ks = []; for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) { const c = this.nodes.get(key(n.L - 1, n.i * 2 + di, n.j * 2 + dj)); if (c) ks.push(c); } n.kids = ks.length === 4 ? ks : null; }
    }
    // resident coarse levels: lowest tiers keep only the horizon (L>=3), everything else keeps L>=2 too (+7 MB, 64 tiles)
    this.pinLevel = quality.level === 'low' ? 3 : 2;
    this.queue = []; this.pinQueue = []; this.active = 0; this.activePin = 0; this.pending = []; this.cur = null; this.frame = 0; this.stat = { loaded: 0, shown: 0, tris: 0 };
    this.lastPos = new THREE.Vector3(1e9, 0, 1e9); this.desired = new Set(); this.base = import.meta.env?.BASE_URL ?? '/';
    this.hints = [];                       // { p: Vector3, nodes: Set, until }
    this.burstUntil = 0; this.framePos = null;
    this.batches = BATCH ? new TileBatches(scene, quality.level) : null;
    this.cores = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));
    this.pack = fetchJSON(`${this.base}tiles/pack34.json`).then(async j => ({ idx: j.index, min: j.minLevel, buf: await fetchBuffer(`${this.base}tiles/pack34.bin`) })).catch(() => null);
  }
  get maxActive() { return performance.now() < this.burstUntil ? Math.min(6, this.cores) : 3; }
  /** true while tiles are streaming in a burst (start-up / teleport): the quality governor must not read these frames as "the renderer is slow" */
  get busy() { return performance.now() < this.burstUntil || this.pending.length > 0 || !!this.cur || this.queue.length > 4; }
  burst(ms = BURST_MS) { this.burstUntil = Math.max(this.burstUntil, performance.now() + ms); }
  dist(n, p) { const dx = Math.max(n.x0 - p.x, 0, p.x - (n.x0 + n.S)), dz = Math.max(n.z0 - p.z, 0, p.z - (n.z0 + n.S)); return Math.hypot(dx, dz, Math.max(0, Math.abs(p.y - (n.minY + n.maxY) / 2) - (n.maxY - n.minY) / 2) * 0.5); }
  loaded(n) { return n.state === 'loaded'; }

  select(n, p, out) {
    const lod = this.quality.lodScale ?? 1;
    if (n.L > 0 && n.kids && this.dist(n, p) < n.S * K * lod) { for (const c of n.kids) this.select(c, p, out); } else out.push(n);
  }
  /** nodes to display for node n's region (see header comment) */
  resolve(n, want, shown) {
    if (want.has(n)) { if (this.loaded(n)) { shown.push(n); return true; } return this.keepCover(n, shown); }
    if (!n.kids) return false;
    const mark = shown.length; let complete = true;
    for (const c of n.kids) { if (!this.resolveChild(c, want, shown)) complete = false; }
    if (!complete && this.loaded(n)) { shown.length = mark; shown.push(n); return true; }
    return complete;
  }
  resolveChild(c, want, shown) { return this.resolve(c, want, shown); }
  /** n wanted but not loaded: keep showing whatever covers it now (nearest displayed ancestor or displayed descendants) */
  keepCover(n, shown) {
    for (let a = n.parent; a; a = a.parent) if (this.loaded(a)) { if (!shown.includes(a)) shown.push(a); return false; }
    const walk = m => { if (m.shown && this.loaded(m)) { shown.push(m); return; } if (m.kids) m.kids.forEach(walk); };
    walk(n); return false;
  }
  /** nodes (and their coarser ancestors) around a point, as the camera would want them there */
  around(p) {
    const want = []; for (const r of this.roots) this.select(r, p, want);
    const need = new Set(want); for (const n of want) for (let a = n.parent, k = 0; a && k < 6; a = a.parent, k++) need.add(a);
    return need;
  }
  /** hint: the player will probably be at (x, z) soon. Starts loading the tiles there now, keeps them for 20 s */
  prefetch(x, z, y = 120) {
    const p = new THREE.Vector3(x, y, z);
    this.hints = this.hints.filter(h => h.until > performance.now() && h.p.distanceToSquared(p) > 40 * 40);
    this.hints.push({ p, nodes: this.around(p), until: performance.now() + 20000 });
    if (this.hints.length > 3) this.hints.shift();
    this.lastPos.set(1e9, 0, 1e9);        // rebuild the queue next frame
  }

  update(pos, force = false) {
    this.frame++; this.flushPending(performance.now() < this.burstUntil ? 9 : 3);
    if (this.framePos && this.framePos.distanceToSquared(pos) > JUMP * JUMP) { this.burst(); this.lastPos.set(1e9, 0, 1e9); }      // teleport / map jump
    (this.framePos ??= new THREE.Vector3()).copy(pos);
    // smoothed travel direction -> a look-ahead point, so the load queue favours tiles in the direction of travel (never culls the rear)
    if (this.prev) { const k = 0.08; this.vel.x += (pos.x - this.prev.x - this.vel.x) * k; this.vel.z += (pos.z - this.prev.z - this.vel.z) * k; } else { this.prev = new THREE.Vector3(); this.vel = { x: 0, z: 0 }; }
    this.prev.copy(pos);
    if (!force && pos.distanceToSquared(this.lastPos) < 25 && this.frame % 30 !== 0) return;
    this.lastPos.copy(pos);
    const want = []; for (const r of this.roots) this.select(r, pos, want);
    const wset = new Set(want), shown = [];
    for (const r of this.roots) { const mark = shown.length; const ok = this.resolve(r, wset, shown); if (!ok && !this.loaded(r) && shown.length === mark) { /* nothing yet */ } }
    const show = new Set(shown);
    // dedupe: a shown node must not overlap a shown ancestor
    for (const n of [...show]) for (let a = n.parent; a; a = a.parent) if (show.has(a)) { show.delete(n); break; }
    let tris = 0;
    for (const n of this.nodes.values()) { const v = show.has(n); if (n.group && n.shown !== v) this.setShown(n, v); n.shown = v && !!n.group; if (v) { n.last = performance.now(); tris += n.tris ?? 0; } }
    this.stat.shown = show.size; this.stat.tris = tris;
    // load queue: wanted nodes nearest-first (to the camera, its look-ahead point, or a prefetch hint), then their coarser ancestors as cover
    const need = new Set(want); for (const n of want) for (let a = n.parent, k = 0; a && k < 6; a = a.parent, k++) need.add(a);
    const nowT = performance.now(); this.hints = this.hints.filter(h => h.until > nowT);
    for (const h of this.hints) for (const n of h.nodes) need.add(n);
    const ahead = this._ahead ??= new THREE.Vector3(); ahead.set(pos.x + this.vel.x * 90, pos.y, pos.z + this.vel.z * 90);   // ~1.5 s of travel at 60 fps
    const pri = n => { let d = Math.min(this.dist(n, pos), this.dist(n, ahead) + 40); for (const h of this.hints) d = Math.min(d, this.dist(n, h.p) + 120); return d; };
    this.queue = [...need].filter(n => n.state === 'idle').map(n => [pri(n), n]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
    // pinned coarse levels: background queue, nearest first, only fed while the wanted queue is empty
    this.pinQueue = []; for (const n of this.nodes.values()) if (n.L >= this.pinLevel && n.state === 'idle' && !need.has(n)) this.pinQueue.push(n);
    if (this.pinQueue.length) { const p0 = pos; this.pinQueue.sort((a, b) => this.dist(a, p0) - this.dist(b, p0)); }
    this.desired = need; this.pump(); this.evict(pos);
  }
  fetchTile(n) {
    if (n.L >= 3) return this.pack.then(pk => {
      const e = pk?.idx[key(n.L, n.i, n.j)];
      return e ? this.loader.parseAsync(pk.buf.slice(e[0], e[0] + e[1]), `${this.base}tiles/`) : this.loader.loadAsync(`${this.base}tiles/${n.L}/${n.i}_${n.j}.glb`);
    });
    return this.loader.loadAsync(`${this.base}tiles/${n.L}/${n.i}_${n.j}.glb`);
  }
  start(n, pin) {
    n.state = 'loading'; this.active++; if (pin) this.activePin++;
    this.fetchTile(n).then(g => { this.pending.push([n, g]); }).catch(e => { n.state = 'failed'; console.warn('tile failed', n.L, n.i, n.j, e?.message); }).finally(() => { this.active--; if (pin) this.activePin--; });
  }
  pump() {
    while (this.active < this.maxActive && this.queue.length) { const n = this.queue.shift(); if (n.state === 'idle') this.start(n, false); }
    // background: one pinned coarse tile at a time, and only when the wanted queue is empty and the main slots are mostly free
    while (!this.queue.length && this.activePin < 1 && this.active < 2 && this.pinQueue.length) { const n = this.pinQueue.shift(); if (n.state === 'idle') this.start(n, true); }
  }

  /** attach parsed tiles, time-sliced: at most `budget` ms per frame (always at least one mesh of progress) */
  flushPending(budget = 3) {
    const t0 = performance.now();
    for (;;) {
      if (!this.cur) { const item = this.pending.shift(); if (!item) return; this.cur = this.beginAttach(item); }
      if (this.stepAttach(this.cur, t0, budget)) this.cur = null; else return;
      if (performance.now() - t0 > budget) return;
    }
  }
  beginAttach([n, g]) {
    const grp = new THREE.Group(); grp.name = `tile_${n.L}_${n.i}_${n.j}`; let tris = 0;
    const meshes = []; g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const mname = o.material.name, m = this.M[mname]; if (m) { o.material.dispose(); o.material = m; } else console.warn('no material', mname);
      o.matrixAutoUpdate = false; o.updateMatrix(); tris += (o.geometry.index?.count ?? 0) / 3;
      o.userData.mname = mname; this.onMesh?.(o, mname, n.L); meshes.push(o);
    });
    return { n, g, grp, meshes, tris, i: 0, batch: this.batches ? [] : null };
  }
  /** returns true when the tile is completely attached */
  stepAttach(c, t0, budget) {
    const { n, meshes } = c;
    if (this.batches) {
      // geometry is copied into the shared per-material batches; only L0 roofs stay as (never rendered) meshes for plug-ins that raycast them
      while (c.i < meshes.length) {
        const o = meshes[c.i++];
        if (!o.visible) { o.geometry.dispose(); }
        else {
          let ok = true;
          try { c.batch.push(this.batches.add(o.material, o.geometry, o.matrixWorld, { castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder, name: o.userData.mname })); }
          catch (e) { console.warn('batch failed, keeping mesh', o.material.name, e.message); o.userData.keep = true; ok = false; }
          if (ok && !(n.L === 0 && o.material === this.M.roof)) { o.removeFromParent(); o.geometry.dispose(); }
        }
        if (performance.now() - t0 > budget) return false;
      }
      for (const o of meshes) if (o.parent && !o.userData.keep) o.visible = false;     // roof proxies: in the scene graph, never drawn
    }
    const { g, grp } = c; n.batch = c.batch;
    while (g.scene.children.length) grp.add(g.scene.children[0]);
    grp.updateMatrixWorld(true); grp.updateMatrixWorld = () => {};        // static tile: skip the per-frame scene-graph walk over its children
    grp.visible = false; n.group = grp; n.tris = c.tris; n.state = 'loaded'; n.last = performance.now(); this.scene.add(grp);
    this.lastPos.set(1e9, 0, 1e9);   // re-evaluate next frame so the new tile can be shown immediately
    this.stat.loaded++;
    return true;
  }
  setShown(n, v) {
    if (n.batch) { for (const h of n.batch) this.batches.setVisible(h, v); n.group.visible = v && n.group.children.some(o => o.userData.keep); }
    else n.group.visible = v;
  }
  evict(pos) {
    const cap = this.quality.level === 'low' ? 110 : this.quality.level === 'med' ? 180 : this.quality.level === 'ultra' ? 360 : 280;
    const loaded = []; for (const n of this.nodes.values()) if (n.state === 'loaded' && n.L < this.pinLevel) loaded.push(n);       // pinned coarse tiles never count and are never evicted
    if (loaded.length <= cap) return;
    const now = performance.now();
    loaded.filter(n => !this.desired.has(n) && !n.shown && now - n.last > 4000).sort((a, b) => a.last - b.last).slice(0, loaded.length - cap).forEach(n => {
      if (n.batch) { for (const h of n.batch) this.batches.release(h); n.batch = null; }
      n.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.scene.remove(n.group); n.group = null; n.state = 'idle'; n.shown = false; this.stat.loaded--;
    });
  }
  /** resolve when what the first view needs is loaded: everything within ~500 m plus the whole horizon (small); finer far tiles keep streaming
   *  behind the loading screen's back (they used to be awaited too: 100-230 tiles / 20-50 MB before the game could start) */
  async preload(pos, onProgress, timeoutMs = 25000) {
    const t0 = performance.now(); this.burst(timeoutMs);
    const must = n => n.L >= 3 || this.dist(n, pos) < 500;
    for (;;) {
      this.update(pos, true); while (this.pending.length || this.cur) this.flushPending(1e9); this.update(pos, true);
      const want = []; for (const r of this.roots) this.select(r, pos, want);
      const req = want.filter(must), ok = req.filter(n => this.loaded(n)).length;
      onProgress?.(ok / Math.max(1, req.length));
      if (ok === req.length || performance.now() - t0 > timeoutMs) { this.burstUntil = performance.now() + 2500; return; }
      await new Promise(r => setTimeout(r, 40));
    }
  }
}
