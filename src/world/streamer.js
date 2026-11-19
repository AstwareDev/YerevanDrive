// Quadtree tile streamer ("Distant Horizons"-style). Level L tiles are 256*2^L metres; L0 = full detail, L4 = coarse terrain to +-16 km.
// Rule: a node is replaced by its children only when ALL children are loaded (no holes, no popping), and coarser parents stay until then.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const K = 1.05;                // a node of size S is refined into children when the camera is closer than S*K*lodScale
const key = (L, i, j) => `${L}_${i}_${j}`;

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
    this.queue = []; this.active = 0; this.maxActive = 3; this.pending = []; this.frame = 0; this.stat = { loaded: 0, shown: 0, tris: 0 };
    this.lastPos = new THREE.Vector3(1e9, 0, 1e9); this.desired = new Set(); this.base = import.meta.env?.BASE_URL ?? '/';
  }
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

  update(pos, force = false) {
    this.frame++; this.flushPending();
    if (!force && pos.distanceToSquared(this.lastPos) < 25 && this.frame % 30 !== 0) return;
    this.lastPos.copy(pos);
    const want = []; for (const r of this.roots) this.select(r, pos, want);
    const wset = new Set(want), shown = [];
    for (const r of this.roots) { const mark = shown.length; const ok = this.resolve(r, wset, shown); if (!ok && !this.loaded(r) && shown.length === mark) { /* nothing yet */ } }
    const show = new Set(shown);
    // dedupe: a shown node must not overlap a shown ancestor
    for (const n of [...show]) for (let a = n.parent; a; a = a.parent) if (show.has(a)) { show.delete(n); break; }
    let tris = 0;
    for (const n of this.nodes.values()) { const v = show.has(n); if (n.group && n.shown !== v) n.group.visible = v; n.shown = v && !!n.group; if (v) { n.last = performance.now(); tris += n.tris ?? 0; } }
    this.stat.shown = show.size; this.stat.tris = tris;
    // load queue: wanted nodes nearest-first, then their coarser ancestors as cover
    const need = new Set(want); for (const n of want) for (let a = n.parent, k = 0; a && k < 6; a = a.parent, k++) need.add(a);
    this.queue = [...need].filter(n => n.state === 'idle').sort((a, b) => this.dist(a, pos) - this.dist(b, pos));
    this.desired = need; this.pump(); this.evict(pos);
  }
  pump() {
    while (this.active < this.maxActive && this.queue.length) {
      const n = this.queue.shift(); if (n.state !== 'idle') continue;
      n.state = 'loading'; this.active++;
      this.loader.loadAsync(`${this.base}tiles/${n.L}/${n.i}_${n.j}.glb`).then(g => { this.pending.push([n, g]); }).catch(e => { n.state = 'failed'; console.warn('tile failed', n.L, n.i, n.j, e?.message); }).finally(() => { this.active--; });
    }
  }
  /** attach at most one parsed tile per frame (avoids long frames) */
  flushPending() {
    const item = this.pending.shift(); if (!item) return; const [n, g] = item;
    const grp = new THREE.Group(); grp.name = `tile_${n.L}_${n.i}_${n.j}`; let tris = 0;
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const mname = o.material.name, m = this.M[mname]; if (m) { o.material.dispose(); o.material = m; } else console.warn('no material', mname);
      o.matrixAutoUpdate = false; o.updateMatrix(); tris += (o.geometry.index?.count ?? 0) / 3;
      this.onMesh?.(o, mname, n.L);
    });
    while (g.scene.children.length) grp.add(g.scene.children[0]);
    grp.visible = false; n.group = grp; n.tris = tris; n.state = 'loaded'; n.last = performance.now(); this.scene.add(grp);
    this.lastPos.set(1e9, 0, 1e9);   // re-evaluate next frame so the new tile can be shown immediately
    this.stat.loaded++;
  }
  evict(pos) {
    const cap = this.quality.level === 'low' ? 110 : this.quality.level === 'med' ? 180 : 280, loaded = [...this.nodes.values()].filter(n => n.state === 'loaded');
    if (loaded.length <= cap) return;
    const now = performance.now();
    loaded.filter(n => !this.desired.has(n) && !n.shown && now - n.last > 4000).sort((a, b) => a.last - b.last).slice(0, loaded.length - cap).forEach(n => {
      n.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.scene.remove(n.group); n.group = null; n.state = 'idle'; n.shown = false; this.stat.loaded--;
    });
  }
  /** resolve when every wanted node around `pos` is loaded (or timeout) */
  async preload(pos, onProgress, timeoutMs = 25000) {
    const t0 = performance.now();
    for (;;) {
      this.update(pos, true); while (this.pending.length) this.flushPending(); this.update(pos, true);
      const want = []; for (const r of this.roots) this.select(r, pos, want);
      const total = want.length + 0, ok = want.filter(n => this.loaded(n)).length;
      onProgress?.(ok / Math.max(1, total));
      if (ok === total || performance.now() - t0 > timeoutMs) return;
      await new Promise(r => setTimeout(r, 60));
    }
  }
}
