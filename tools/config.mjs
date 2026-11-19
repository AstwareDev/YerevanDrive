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
