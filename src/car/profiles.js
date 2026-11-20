// Garage cars: display data + per-car physics / rig parameters (consumed by src/car/vehicle.js applyProfile and src/car.js).
// Body frame: x = car's left, y up, z forward, origin = centre of mass. Model frame (the GLB): y = 0 on the ground, z = middle of the wheelbase, so the model
// is placed at (0, -hCOM, -zCOM) and axle.z(body) = axle.z(model) - zCOM. The GLB wheel layout comes from public/car/<id>.json (tools/build-car-pack.mjs).
// box / cabin = static collision boxes (half extents hx,hy,hz + centre offset oy,oz); head = headlight spot position.
export const DEFAULT_CAR = 'bmw_m2';

// shared defaults: wheel / engine inertia, suspension travel, tyre curve peaks
export const PHYS_DEFAULTS = { Iw: 1.5, Ie: 0.22, dFree: 0.22, dRest: 0.12, kxPk: 0.14, syPkF: 0.15, syPkR: 0.17, rev: 3.6, eta: 0.92, fd: 0 };

const GEARS = [4.11, 2.32, 1.61, 1.23, 1.0, 0.85];

export const CAR_PROFILES = {
  bmw_m2: {
    name: 'BMW G87 M2', sub: 'Widebody · 3.0 L twin-turbo I6 · RWD', file: '/car/bmw_m2.glb', camDist: 1,
    phys: {
      mass: 1650, hCOM: 0.505, zCOM: 0.10, inertia: { x: 2500, y: 3100, z: 750 },
      R: 0.34, hpY: -0.045,
      axleF: { x: 0.86, z: 1.444 }, axleR: { x: 0.875, z: -1.305 },
      kF: 41500, kR: 39500, cbF: 3200, crF: 5200, cbR: 3000, crR: 4800, arbF: 23000, arbR: 15000,
      muF: 1.18, muR: 1.04,
      idle: 950, redline: 7200,
      ratios: GEARS, final: 3.46,
      torque: [[0, 0], [900, 200], [1500, 330], [2000, 410], [3000, 540], [4500, 550], [5500, 550], [6300, 505], [7000, 445], [7600, 380]],
      cdA: 0.78, clA: 0.16,
      brakeF: 2700, brakeR: 1500, handbrake: 4800,
      box: { hx: 0.98, hy: 0.42, hz: 2.18, oy: 0.1, oz: -0.1 }, cabin: { hx: 0.8, hy: 0.28, hz: 1.05, oy: 0.62, oz: -0.25 },
      head: [0.62, 0.22, 2.0],
    },
  },
  // mid-engine hybrid hypercar (RWD like the real one): 903 hp, ~900 Nm with the e-motor filling the low end
  mclaren_p1: {
    name: 'McLaren P1', sub: 'Mid-engine · 3.8 L V8 hybrid · RWD', file: '/car/mclaren_p1.glb', camDist: 1,
    phys: {
      mass: 1500, hCOM: 0.45, zCOM: -0.198, inertia: { x: 1500, y: 1780, z: 600 },
      R: 0.3225,
      axleF: { x: 0.795, z: 1.436 }, axleR: { x: 0.771, z: -1.04 },
      kF: 36000, kR: 48000, cbF: 2800, crF: 4600, cbR: 3300, crR: 5400, arbF: 20000, arbR: 14000,
      muF: 1.28, muR: 1.12,
      idle: 1000, redline: 8300,
      ratios: GEARS, final: 3.6,
      torque: [[0, 0], [900, 330], [1500, 560], [2500, 700], [4000, 710], [6000, 690], [7000, 640], [7800, 570], [8300, 510], [9000, 400]],
      cdA: 0.72, clA: 0.3,
      brakeF: 3000, brakeR: 1750, handbrake: 4500,
      box: { hx: 0.92, hy: 0.30, hz: 2.1, oy: -0.03, oz: 0.40 }, cabin: { hx: 0.72, hy: 0.20, hz: 0.85, oy: 0.46, oz: 0.2 },
      head: [0.6, 0.1, 2.15],
    },
  },
  // 2022 Countach LPI 800-4: naturally aspirated V12 + e-motor, AWD with a strong rear bias (we send 15 % to the front)
  countach: {
    name: 'Lamborghini Countach', sub: 'LPI 800-4 · 6.5 L V12 hybrid · AWD', file: '/car/countach.glb', camDist: 1,
    phys: {
      mass: 1600, hCOM: 0.47, zCOM: -0.185, inertia: { x: 1750, y: 2260, z: 690 },
      R: 0.3386,
      axleF: { x: 0.813, z: 1.504 }, axleR: { x: 0.791, z: -1.134 },
      kF: 39000, kR: 46000, cbF: 3000, crF: 4900, cbR: 3300, crR: 5300, arbF: 21000, arbR: 14500,
      muF: 1.22, muR: 1.08, fd: 0.15,
      idle: 900, redline: 8500,
      ratios: GEARS, final: 3.55,
      torque: [[0, 0], [900, 150], [2000, 340], [3500, 520], [5000, 640], [6750, 720], [7800, 700], [8500, 620], [9000, 500]],
      cdA: 0.7, clA: 0.12,
      brakeF: 2900, brakeR: 1650, handbrake: 4700,
      box: { hx: 0.97, hy: 0.31, hz: 2.25, oy: -0.04, oz: 0.285 }, cabin: { hx: 0.75, hy: 0.20, hz: 0.95, oy: 0.46, oz: 0.25 },
      head: [0.62, 0.12, 2.5],
    },
  },
};
export const CAR_IDS = Object.keys(CAR_PROFILES);
