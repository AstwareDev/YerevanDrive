// Road / sidewalk polygon operations (Clipper). All coordinates are local metres [x, z]; clipper works on integer centimetres.
import ClipperLib from 'clipper-lib';

const S = 100;
const JT = ClipperLib.JoinType, ET = ClipperLib.EndType, PT = ClipperLib.PolyType, CT = ClipperLib.ClipType, FT = ClipperLib.PolyFillType;
const toPath = pts => pts.map(p => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));
const fromPath = path => path.map(q => [q.X / S, q.Y / S]);

function offsetOpen(groups) {                 // groups: Map(hw -> lines[]) -> Paths
  const out = new ClipperLib.Paths();
  for (const [hw, lines] of groups) { const co = new ClipperLib.ClipperOffset(2, 0.15 * S); for (const l of lines) co.AddPath(toPath(l), JT.jtRound, ET.etOpenRound); const sol = new ClipperLib.Paths(); co.Execute(sol, hw * S); for (const p of sol) out.push(p); }
  return out;
}
function boolean(type, a, b) { const c = new ClipperLib.Clipper(); c.AddPaths(a, PT.ptSubject, true); if (b) c.AddPaths(b, PT.ptClip, true); const sol = new ClipperLib.Paths(); c.Execute(type, sol, FT.pftNonZero, FT.pftNonZero); return sol; }
const union = a => boolean(CT.ctUnion, a);
function offsetClosed(paths, delta) { const co = new ClipperLib.ClipperOffset(2, 0.15 * S); co.AddPaths(paths, JT.jtRound, ET.etClosedPolygon); const sol = new ClipperLib.Paths(); co.Execute(sol, delta * S); return sol; }

function treePolys(tree) {
  const out = [];
  const walk = node => { for (const c of node.Childs()) { if (!c.IsHole()) { out.push({ outer: fromPath(c.Contour()), holes: c.Childs().map(h => fromPath(h.Contour())) }); for (const h of c.Childs()) walk(h); } } };
  walk(tree); return out;
}
/** Paths -> [{outer, holes}] (whole set) */
export function polysOf(paths) { const c = new ClipperLib.Clipper(); c.AddPaths(paths, PT.ptSubject, true); const tree = new ClipperLib.PolyTree(); c.Execute(CT.ctUnion, tree, FT.pftNonZero, FT.pftNonZero); return treePolys(tree); }
/** clip Paths to an axis-aligned rectangle [x0, z0, x1, z1] -> [{outer, holes}] */
export function clipToRect(paths, [x0, z0, x1, z1]) {
  const c = new ClipperLib.Clipper(); c.AddPaths(paths, PT.ptSubject, true);
  c.AddPath(toPath([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]), PT.ptClip, true);
  const tree = new ClipperLib.PolyTree(); c.Execute(CT.ctIntersection, tree, FT.pftNonZero, FT.pftNonZero); return treePolys(tree);
}

/**
 * roads: [{ line: [[x,z],..], hw, main, sw }]  (main = gets sidewalks)   buildings: [[x,z],..][]
 * Returns { road: Paths (rounded junction corners), sidewalk: Paths (ring around main roads, minus road and buildings) }
 */
export function pavement({ roads, buildings, closeR = 2.5 }) {
  const key = v => Math.round(v * 4) / 4;
  const all = new Map(), main = new Map();
  for (const r of roads) { const k = key(r.hw); (all.get(k) ?? all.set(k, []).get(k)).push(r.line); }
  for (const r of roads) if (r.main) { const k = key(r.hw + r.sw); (main.get(k) ?? main.set(k, []).get(k)).push(r.line); }
  const roadAll = offsetClosed(offsetClosed(union(offsetOpen(all)), closeR), -closeR);       // closing: rounds concave junction corners
  const outer = union(offsetOpen(main));
  const bld = union(buildings.filter(b => b.length >= 3).map(toPath));
  let sidewalk = boolean(CT.ctDifference, outer, roadAll);
  sidewalk = boolean(CT.ctDifference, sidewalk, bld);
  // drop slivers narrower than ~0.4 m (offset(-0.2) then back)
  sidewalk = offsetClosed(offsetClosed(sidewalk, -0.2), 0.2);
  return { road: roadAll, sidewalk };
}
