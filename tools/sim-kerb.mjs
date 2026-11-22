// Headless check of the "hit a kerb and fly" bug: drives the car straight at a 26 cm pavement edge at several speeds and reports how high it is thrown.
//   node tools/sim-kerb.mjs            (CAR=<id> for another car)    sharp = raster step as it was, smooth = the blended ground in src/car/ground.js
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle, CAR, applyProfile } from '../src/car/vehicle.js';
import { smoothedOffset } from '../src/car/ground.js';
applyProfile(process.env.CAR ?? 'bmw_m2');
await RAPIER.init();
const DT = 1 / 120, EDGE = 60, STEP = 26;           // kerb edge at z = 60 m, 26 cm (the baked sidewalk offset)
const raster = (x, z) => (z >= EDGE ? STEP : 10);    // cm above terrain, nearest-cell like the old cellAt()
const modes = {
  sharp: { y: (x, z) => raster(x, z) * 0.01 },
  smooth: { y: (x, z) => smoothedOffset(raster, x, z) * 0.01 },
};
for (const [name, g] of Object.entries(modes)) {
  const ground = { ...g, terrain: () => 0, normal: (x, z, o) => o.set(0, 1, 0), surface: () => 1, mu: () => 1, inBounds: () => true };
  for (const kmh of [30, 60, 90, 120]) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT;
    const v = new Vehicle({ RAPIER, world, ground }); v.reset(0, 0, 0); for (let i = 0; i < 120; i++) v.step(DT);
    let maxAir = 0, maxVy = 0, t = 0; const target = kmh / 3.6;
    for (let i = 0; i < 12 * 120; i++, t = i * DT) {
      v.input.throttle = v.t.speed < target ? 1 : 0.15; v.input.brake = 0; v.input.steer = 0; v.step(DT);
      if (v.pos.z > EDGE - 3) { const gy = ground.y(v.pos.x, v.pos.z); maxAir = Math.max(maxAir, v.pos.y - gy - 0.55); maxVy = Math.max(maxVy, v.vel?.y ?? 0); }
      if (v.pos.z > EDGE + 25) break;
    }
    console.log(`${name.padEnd(6)} ${String(kmh).padStart(3)} km/h  max height above ride height ${maxAir.toFixed(2)} m   speed at edge ~${(v.t.kmh).toFixed(0)} km/h`);
  }
}
