// lat/lon <-> local metres (same projection as tools/config.mjs). x east, z south.
export const CENTER = { lat: 40.17765, lon: 44.51270 };
const MLAT = 110946, MLON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
export const project = (lat, lon) => [(lon - CENTER.lon) * MLON, -(lat - CENTER.lat) * MLAT];
export const unproject = (x, z) => [CENTER.lat - z / MLAT, CENTER.lon + x / MLON];
