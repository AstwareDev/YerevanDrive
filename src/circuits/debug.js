// Debug overlay for the circuits: coloured centreline (curvature), corner markers with labels, checkpoints, start/finish,
// pit, stands, junction mouths. Toggle with window.__circuits.debug(true|false).
import * as THREE from 'three';
import { canvas } from './util.js';

const SEV = ['', '#4f4', '#af4', '#ff4', '#fa4', '#f44'];
function label(text, color) {
  const c = canvas(256, 64), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 256, 64); g.fillStyle = color; g.font = '700 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(16, 4, 1); s.renderOrder = 1000; return s;
}
const mat = (c, o = {}) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, ...o });

export function makeDebug(scene, tracks) {
  const group = new THREE.Group(); group.name = 'circuitsDebug'; group.visible = false; scene.add(group);
  for (const tr of tracks) {
    const c = tr.c, n = tr.n, H = tr.H;
    // centreline coloured by |curvature|
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), k = new THREE.Color();
    for (let i = 0; i < n; i++) { pos[i * 3] = tr.x[i]; pos[i * 3 + 1] = tr.y[i] + 0.7; pos[i * 3 + 2] = tr.z[i]; const v = Math.min(1, Math.abs(tr.kap[i]) * 40); k.setHSL(0.33 * (1 - v), 1, 0.5); col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true })); line.renderOrder = 999; line.frustumCulled = false; group.add(line);
    // road edges
    const ep = [], f = {};
    for (let i = 0; i < n; i += 3) for (const sg of [-1, 1]) { tr.at(i, 0, f); const x = f.cx + f.rx * sg * f.hw, z = f.cz + f.rz * sg * f.hw; ep.push(x, H(x, z) + 0.5, z); }
    const edges = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)), new THREE.PointsMaterial({ color: 0x66ccff, size: 2, sizeAttenuation: false, depthTest: false })); edges.renderOrder = 998; group.add(edges);
    const seg = (pts, color) => { const l = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), mat(color)); l.renderOrder = 999; l.frustumCulled = false; group.add(l); };
    // corners: vertical pole + label
    for (const co of c.corners) {
      const y = H(co.x, co.z); const hex = SEV[co.severity]; const col2 = new THREE.Color(hex);
      const l = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([co.x, y, co.z, co.x, y + 16, co.z], 3)), mat(col2)); l.renderOrder = 999; group.add(l);
      const s = label(`T${co.n}${co.dir} s${co.severity} R${Math.round(co.minR)}`, hex); s.position.set(co.x, y + 19, co.z); group.add(s);
      // entry / exit ticks
      for (const idx of [co.entry, co.exit]) { tr.at(idx, 0, f); seg([f.cx + f.rx * f.hw, H(f.cx, f.cz) + 1, f.cz + f.rz * f.hw, f.cx - f.rx * f.hw, H(f.cx, f.cz) + 1, f.cz - f.rz * f.hw], col2); }
    }
    // checkpoints + start/finish gates
    const gate = (i, color, h) => { tr.at(i, 0, f); const a = [f.cx + f.rx * f.hw, H(f.cx, f.cz), f.cz + f.rz * f.hw], b = [f.cx - f.rx * f.hw, H(f.cx, f.cz), f.cz - f.rz * f.hw]; seg([...a, a[0], a[1] + h, a[2], ...b, b[0], b[1] + h, b[2], a[0], a[1] + h, a[2], b[0], b[1] + h, b[2]], color); };
    for (const cp of c.checkpoints) { gate(cp.index, 0x00ffff, 6); const s = label('CP' + cp.n, '#0ff'); s.position.set(cp.x, cp.y + 9, cp.z); s.scale.set(8, 2, 1); group.add(s); }
    gate(0, 0xffffff, 9); { const s = label('START / FINISH ' + c.name, '#fff'); s.position.set(c.startFinish.x, c.startFinish.y + 13, c.startFinish.z); group.add(s); }
    for (const sp of c.spawns) seg([sp.x, sp.y, sp.z, sp.x + Math.sin(sp.heading) * 3, sp.y, sp.z + Math.cos(sp.heading) * 3], 0xffff00);
    { const p = c.pit; seg([p.x - 3, p.y + 0.5, p.z, p.x + 3, p.y + 0.5, p.z, p.x, p.y + 0.5, p.z - 3, p.x, p.y + 0.5, p.z + 3, p.x, p.y, p.z, p.x, p.y + 14, p.z], 0xff8800); const s = label('PIT', '#f80'); s.position.set(p.x, p.y + 16, p.z); group.add(s); }
    for (const st of c.stands) { tr.at(st.index, 0, f); const s = label('STANDS', '#f6f'); s.position.set(f.cx, H(f.cx, f.cz) + 14, f.cz); group.add(s); seg([f.cx, H(f.cx, f.cz), f.cz, f.cx, H(f.cx, f.cz) + 12, f.cz], 0xff66ff); }
    const jp = []; for (const j of c.junctions) { const y = H(j.x, j.z) + 0.8; jp.push(j.x, y, j.z, j.x + j.dx * 14, y, j.z + j.dz * 14); } seg(jp, 0xff00ff);
  }
  return group;
}
