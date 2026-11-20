// Shared constants + projection. Local frame: x = east, y = up, z = south (three.js right-handed, -z is north).
export const CENTER = { lat: 40.17765, lon: 44.51270 }; // Republic Square
export const HALF = 1000;            // map half-size in metres (2 km x 2 km)
export const FETCH_MARGIN = 60;      // extra data around the map so edges look complete
const M_PER_DEG_LAT = 110946;        // ~ at 40.18N
const M_PER_DEG_LON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);

export function project(lat, lon) {
  return [(lon - CENTER.lon) * M_PER_DEG_LON, -(lat - CENTER.lat) * M_PER_DEG_LAT]; // [x, z]
}
export function bbox(extra = 0) {
  const h = HALF + extra;
  return {
    south: CENTER.lat - h / M_PER_DEG_LAT, north: CENTER.lat + h / M_PER_DEG_LAT,
    west: CENTER.lon - h / M_PER_DEG_LON, east: CENTER.lon + h / M_PER_DEG_LON,
  };
}

// ---- extended city (free-drive area: Republic Square + Baghramyan Ave, Barekamutyun, Orbeli Bros, Komitas Ave to the north / north-west)
// L0 (full detail) rectangle in local metres, aligned to the 256 m tile grid. x east, z south (north = -z).
export const REGION = { x0: -2560, x1: 1024, z0: -3584, z1: 1024 };
// "near-field" texture window: aerial / contact-AO / road-field textures are all mapped over this square (side 2*half, centre cx,cz)
export const NEAR = { cx: -768, cz: -1280, half: 2304 };
export const FINE_R = 3800;          // half-size of the fine 5 m height grid (square, centred on the Square)
export const inRegion = (x, z, m = 0) => x >= REGION.x0 - m && x <= REGION.x1 + m && z >= REGION.z0 - m && z <= REGION.z1 + m;
