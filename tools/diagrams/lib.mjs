// Tiny UML drawing kit: emits SVG strings (no browser, no external tools). tools/diagrams/build.mjs turns them into PNGs with sharp.
// Layout is explicit (you give coordinates), so diagrams stay readable and diffable.
const FONT = "'Segoe UI', 'DejaVu Sans', Arial, sans-serif";
const MONO = "Consolas, 'DejaVu Sans Mono', 'Courier New', monospace";
export const COL = {
  ink: '#1f2a44', line: '#44527a', soft: '#8a96b5', bg: '#ffffff',
  core: '#e6eefc', world: '#e3f5ea', plug: '#fff1d6', asset: '#f1e6fa', ext: '#ececec', note: '#fffbd0', tool: '#e0f3f7', warn: '#fde4e1',
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const tw = (s, size = 12, mono = false) => String(s).length * size * (mono ? 0.6 : 0.56);

export class Canvas {
  constructor(w, h, title = '') { this.w = w; this.h = h; this.parts = []; this.title = title; }
  add(s) { this.parts.push(s); return this; }
  svg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">` +
      `<defs>` +
      `<marker id="open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="${COL.line}" stroke-width="1.5"/></marker>` +
      `<marker id="filled" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${COL.line}"/></marker>` +
      `<marker id="tri" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 z" fill="#fff" stroke="${COL.line}" stroke-width="1.4"/></marker>` +
      `<marker id="diamond" viewBox="0 0 14 10" refX="13" refY="5" markerWidth="14" markerHeight="10" orient="auto-start-reverse"><path d="M1 5 L7 1 L13 5 L7 9 z" fill="${COL.line}"/></marker>` +
      `<marker id="odiamond" viewBox="0 0 14 10" refX="13" refY="5" markerWidth="14" markerHeight="10" orient="auto-start-reverse"><path d="M1 5 L7 1 L13 5 L7 9 z" fill="#fff" stroke="${COL.line}" stroke-width="1.3"/></marker>` +
      `</defs><rect width="100%" height="100%" fill="${COL.bg}"/>` +
      (this.title ? `<text x="24" y="30" font-family="${FONT}" font-size="20" font-weight="700" fill="${COL.ink}">${esc(this.title)}</text>` : '') +
      this.parts.join('') + `</svg>`;
  }

  text(x, y, s, { size = 12, bold = false, anchor = 'start', fill = COL.ink, italic = false, mono = false } = {}) {
    return this.add(`<text x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}" ${bold ? 'font-weight="700"' : ''} ${italic ? 'font-style="italic"' : ''} text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`);
  }
  /** label with a white halo so it stays readable on top of lines */
  label(x, y, s, o = {}) {
    const size = o.size ?? 11, w = tw(s, size) + 8;
    const ax = o.anchor === 'start' ? x - 4 : o.anchor === 'end' ? x - w + 4 : x - w / 2;
    this.add(`<rect x="${ax}" y="${y - size - 1}" width="${w}" height="${size + 6}" rx="3" fill="#fff" fill-opacity="0.92"/>`);
    return this.text(x, y, s, { size, fill: o.fill ?? COL.ink, anchor: o.anchor ?? 'middle', italic: o.italic, bold: o.bold });
  }

  /** dashed UML package / grouping frame with a title tab */
  pkg(x, y, w, h, title, fill = '#f7f9fd') {
    const tabW = tw(title, 13) + 22;
    this.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${COL.soft}" stroke-dasharray="6 4" stroke-width="1.3"/>`);
    this.add(`<rect x="${x + 14}" y="${y - 12}" width="${tabW}" height="24" rx="5" fill="#fff" stroke="${COL.soft}" stroke-width="1.3"/>`);
    return this.text(x + 25, y + 4, title, { size: 13, bold: true });
  }

  /** component / generic box. lines = body text lines (monospace optional). stereo = «stereotype» */
  box(x, y, w, h, { title, stereo, lines = [], fill = COL.core, stroke = COL.line, mono = false, round = 8, titleSize = 13, lineSize = 11.5, align = 'middle', dashed = false } = {}) {
    this.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${round}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="6 4"' : ''}/>`);
    let ty = y + 8;
    const cx = align === 'middle' ? x + w / 2 : x + 12;
    if (stereo) { this.text(cx, ty + 11, `«${stereo}»`, { size: 10.5, anchor: align, fill: COL.soft, italic: true }); ty += 14; }
    if (title) { this.text(cx, ty + 14, title, { size: titleSize, bold: true, anchor: align }); ty += titleSize + 7; }
    for (const l of lines) { this.text(cx, ty + 13, l, { size: lineSize, anchor: align, mono, fill: '#2b3656' }); ty += lineSize + 5; }
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
  }
  /** height a box needs for the given content */
  static boxH({ title, stereo, lines = [] }, titleSize = 13, lineSize = 11.5) { return 16 + (stereo ? 14 : 0) + (title ? titleSize + 7 : 0) + lines.length * (lineSize + 5) + 4; }

  /** UML class: name compartment (+ stereotype), attributes, operations. Returns the rect. */
  cls(x, y, w, { name, stereo, attrs = [], ops = [], fill = COL.core, abstract = false }) {
    const L = 15, head = 14 + (stereo ? 14 : 0) + 12, a = Math.max(attrs.length, 0) * L + 10, o = Math.max(ops.length, 0) * L + 10;
    const h = head + (attrs.length ? a : 6) + (ops.length ? o : 6);
    this.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${COL.line}" stroke-width="1.5"/>`);
    let ty = y + 6;
    if (stereo) { this.text(x + w / 2, ty + 11, `«${stereo}»`, { size: 10.5, anchor: 'middle', fill: COL.soft, italic: true }); ty += 14; }
    this.text(x + w / 2, ty + 14, name, { size: 13.5, bold: true, anchor: 'middle', italic: abstract });
    let sy = y + head;
    this.add(`<line x1="${x}" y1="${sy}" x2="${x + w}" y2="${sy}" stroke="${COL.line}" stroke-width="1.2"/>`);
    attrs.forEach((s, i) => this.text(x + 8, sy + 16 + i * L, s, { size: 11, mono: true }));
    sy += attrs.length ? a : 6;
    this.add(`<line x1="${x}" y1="${sy}" x2="${x + w}" y2="${sy}" stroke="${COL.line}" stroke-width="1.2"/>`);
    ops.forEach((s, i) => this.text(x + 8, sy + 16 + i * L, s, { size: 11, mono: true }));
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
  }

  note(x, y, w, lines, { size = 11 } = {}) {
    const h = lines.length * (size + 4) + 14, f = 12;
    this.add(`<path d="M${x} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h} H${x} Z" fill="${COL.note}" stroke="#b5a96a" stroke-width="1.2"/><path d="M${x + w - f} ${y} V${y + f} H${x + w}" fill="none" stroke="#b5a96a" stroke-width="1.2"/>`);
    lines.forEach((l, i) => this.text(x + 9, y + 18 + i * (size + 4), l, { size }));
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
  }

  /** artifact / data file: folded-corner rectangle */
  file(x, y, w, h, { title, lines = [], fill = COL.asset }) {
    const f = 12;
    this.add(`<path d="M${x} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h} H${x} Z" fill="${fill}" stroke="${COL.line}" stroke-width="1.4"/><path d="M${x + w - f} ${y} V${y + f} H${x + w}" fill="none" stroke="${COL.line}" stroke-width="1.2"/>`);
    let ty = y + 8;
    if (title) { this.text(x + w / 2, ty + 12, title, { size: 12.5, bold: true, anchor: 'middle' }); ty += 19; }
    for (const l of lines) { this.text(x + w / 2, ty + 11, l, { size: 11, anchor: 'middle', fill: '#2b3656' }); ty += 15; }
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
  }

  /** polyline arrow. pts = [[x,y],...]. head: 'open' | 'filled' | 'tri' | 'diamond' | 'odiamond' | null. tail: same set (marker at the start) */
  arrow(pts, { head = 'open', tail = null, dashed = false, label, at = 0.5, dx = 0, dy = -6, color = COL.line, width = 1.5, lsize = 11, anchor = 'middle' } = {}) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    this.add(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${dashed ? 'stroke-dasharray="6 4"' : ''} ${head ? `marker-end="url(#${head})"` : ''} ${tail ? `marker-start="url(#${tail})"` : ''} stroke-linejoin="round"/>`);
    if (label) {
      // point at fraction `at` of the total length
      let total = 0; const seg = [];
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
      let want = total * at, i = 0; while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
      const t = seg[i] ? want / seg[i] : 0, px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, py = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      this.label(px + dx, py + dy, label, { size: lsize, anchor });
    }
    return this;
  }

  initial(x, y) { return this.add(`<circle cx="${x}" cy="${y}" r="8" fill="${COL.ink}"/>`); }
  final(x, y) { return this.add(`<circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="${COL.ink}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="5.5" fill="${COL.ink}"/>`); }
}

/** UML sequence diagram.
 *  parts: [{ id, label, stereo? }]   steps:
 *   { m: [from, to, text], dashed?: true }      message (dashed = return)
 *   { self: [id, text] }                          call to self
 *   { note: [fromId, toId, 'text' | ['l1','l2']] }
 *   { open: 'par'|'loop'|'alt'|'opt', label, from, to }   ... { close: true }
 *   { gap: px }
 */
export function sequence(c, { x0, y0, gap, parts, steps, lineH = 34, boxW = 150, endPad = 28 }) {
  const X = {}; parts.forEach((p, i) => { X[p.id] = x0 + i * gap; });
  const hh = 42;
  let y = y0 + hh + 30;
  const frags = [], msgs = [], stack = [];
  for (const s of steps) {
    if (s.gap) { y += s.gap; continue; }
    if (s.open) { stack.push({ ...s, y0: y - 14, depth: stack.length }); y += 30; continue; }
    if (s.close) { const f = stack.pop(); frags.push({ ...f, y1: y - 8 }); y += 14; continue; }
    if (s.note) {
      const [a, b, t] = s.note, lines = Array.isArray(t) ? t : [t], wv = Math.max(...lines.map(l => tw(l, 11))) + 24;
      const cx = (X[a] + X[b]) / 2, w = Math.max(wv, Math.abs(X[b] - X[a]) + 40), h = lines.length * 15 + 12;
      msgs.push({ kind: 'note', x: cx - w / 2, y, w, h, lines }); y += h + 14; continue;
    }
    if (s.self) { const [id, t] = s.self; msgs.push({ kind: 'self', x: X[id], y, t }); y += lineH + 16; continue; }
    const [a, b, t] = s.m; msgs.push({ kind: 'msg', a: X[a], b: X[b], y, t, dashed: !!s.dashed }); y += lineH;
  }
  const yEnd = y + endPad;
  // fragments (behind everything)
  for (const f of frags.sort((a, b) => a.depth - b.depth)) {
    const xa = Math.min(X[f.from], X[f.to]) - 60 + f.depth * 14, xb = Math.max(X[f.from], X[f.to]) + 60 - f.depth * 14;
    c.add(`<rect x="${xa}" y="${f.y0}" width="${xb - xa}" height="${f.y1 - f.y0}" fill="#f6f8ff" fill-opacity="0.65" stroke="${COL.soft}" stroke-width="1.2"/>`);
    const tabW = tw(f.open, 11) + 18;
    c.add(`<path d="M${xa} ${f.y0} h${tabW} v14 l-8 8 h-${tabW - 8} z" fill="#fff" stroke="${COL.soft}" stroke-width="1.2"/>`);
    c.text(xa + 8, f.y0 + 15, f.open, { size: 11, bold: true });
    if (f.label) c.text(xa + tabW + 8, f.y0 + 15, `[${f.label}]`, { size: 11, italic: true, fill: '#51608a' });
  }
  // lifelines + headers
  for (const p of parts) {
    const x = X[p.id];
    c.add(`<line x1="${x}" y1="${y0 + hh}" x2="${x}" y2="${yEnd}" stroke="${COL.soft}" stroke-dasharray="5 4" stroke-width="1.2"/>`);
    const w = Math.max(boxW, tw(p.label, 13) + 24);
    c.add(`<rect x="${x - w / 2}" y="${y0}" width="${w}" height="${hh}" rx="6" fill="${p.fill ?? COL.core}" stroke="${COL.line}" stroke-width="1.5"/>`);
    if (p.stereo) { c.text(x, y0 + 15, `«${p.stereo}»`, { size: 10, anchor: 'middle', fill: COL.soft, italic: true }); c.text(x, y0 + 32, p.label, { size: 13, bold: true, anchor: 'middle' }); }
    else c.text(x, y0 + 26, p.label, { size: 13, bold: true, anchor: 'middle' });
  }
  for (const m of msgs) {
    if (m.kind === 'note') {
      c.add(`<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${COL.note}" stroke="#b5a96a" stroke-width="1.2"/>`);
      m.lines.forEach((l, i) => c.text(m.x + m.w / 2, m.y + 16 + i * 15, l, { size: 11, anchor: 'middle' }));
    } else if (m.kind === 'self') {
      c.arrow([[m.x, m.y], [m.x + 34, m.y], [m.x + 34, m.y + 20], [m.x + 2, m.y + 20]], { head: 'filled' });
      c.text(m.x + 42, m.y + 14, m.t, { size: 11.5 });
    } else {
      const dir = Math.sign(m.b - m.a) || 1, pad = 2;
      c.arrow([[m.a + dir * pad, m.y], [m.b - dir * pad, m.y]], { head: m.dashed ? 'open' : 'filled', dashed: m.dashed });
      const mid = (m.a + m.b) / 2;
      c.text(mid, m.y - 6, m.t, { size: 11.5, anchor: 'middle', fill: m.dashed ? '#51608a' : COL.ink, italic: m.dashed });
    }
  }
  return yEnd;
}
