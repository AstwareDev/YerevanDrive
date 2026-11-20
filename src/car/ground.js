// Ground model for the car: terrain height H(x,z) (5 m grid, bilinear) + a 0.5 m raster of surface offsets baked by tools/build-map.mjs
// (centimetres above terrain: grass 4, plaza 5, lot 9, asphalt 10, sidewalk 26) -> real raised curbs and sidewalks under the wheels.
export const SURF = { GRASS: 0, ASPHALT: 1, PAVEMENT: 2, PLAZA: 3, DIRT: 4 };
// tyre-grip multiplier per surface
export const SURF_MU = [0.52, 1.0, 0.88, 0.82, 0.6];

export async function createGround(H) {
  const info = await (await fetch('/map/surface.json')).json();
  const raw = await new Response((await fetch('/map/surface.bin')).body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  const off = new Uint8Array(raw), W = info.w, Hh = info.h, cell = info.cell, X0 = info.x0, Z0 = info.z0, inv = 1 / cell;     // raster of the drivable region (0.5 m cells)
  const code = v => v >= 26 ? SURF.PAVEMENT : v >= 9 ? SURF.ASPHALT : v === 5 ? SURF.PLAZA : v === 3 ? SURF.DIRT : SURF.GRASS;
  const cellAt = (x, z) => { const i = Math.floor((x - X0) * inv), j = Math.floor((z - Z0) * inv); return (i < 0 || j < 0 || i >= W || j >= Hh) ? 4 : off[j * W + i]; };
  const g = {
    /** surface height (m) under a point */
    y(x, z) { return H(x, z) + cellAt(x, z) * 0.01; },
    /** terrain-only height (no curb offsets) */
    terrain: H,
    surface(x, z) { return code(cellAt(x, z)); },
    mu(x, z) { return SURF_MU[code(cellAt(x, z))]; },
    /** smooth terrain normal (written into out) */
    normal(x, z, out) {
      const e = 0.6, dx = (H(x - e, z) - H(x + e, z)) / (2 * e), dz = (H(x, z - e) - H(x, z + e)) / (2 * e), l = Math.hypot(dx, 1, dz);
      out.set(dx / l, 1 / l, dz / l); return out;
    },
    inBounds(x, z) { return x > X0 + 40 && x < X0 + W * cell - 40 && z > Z0 + 40 && z < Z0 + Hh * cell - 40; },
  };
  return g;
}
