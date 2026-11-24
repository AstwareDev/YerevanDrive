import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildOrnateLamps } from './landmarks/ornate_lamp.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createMaterials, wetness, shared } from './materials.js';
import { createSky } from './sky.js';
import { loadHeight } from './height.js';
import { quality, renderScale, bootStart, bootDone } from './quality.js';
import { fetchJSON, warmStartup } from './net.js';
import { Streamer } from './world/streamer.js';
import { SceneFXPass } from './post/scenefx.js';
import { FinalPass } from './post/final.js';
import { initRTWorld } from './post/rtworld.js';
import { createProbe } from './world/probe.js';
import { createGovernor } from './perf.js';
import { createFarMaterials } from './world/farMaterials.js';

const $ = id => document.getElementById(id);
bootStart();          // crash flag: cleared once the loading screen is gone (quality.js lowers the next start if the browser died in between)
warmStartup();        // start every start-up download now, in parallel, before any code needs it
// exp fog (instead of three's exp2) keeps the far horizon readable: 1 km ~ 50% haze at night, 5 km ~ 98%
// + exponential HEIGHT fog: density falls off with altitude (scale height ~240 m above Republic Square), integrated analytically along
// the view ray. The haze pools in the valley around the Square, looking down from Komitas / Arabkir (+160 m) gets the layered depth.
// World ray from the view-space vertex (works for meshes, instancing and BatchedMesh alike); no extra uniforms needed.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogRay;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogRay;');
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace('1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )',
  '1.0 - exp( - fogDensity * exp( -0.0042 * max( cameraPosition.y, -40.0 ) ) * length( vFogRay ) * ( abs( vFogRay.y ) * 0.0042 > 1e-3 ? ( 1.0 - exp( - vFogRay.y * 0.0042 ) ) / ( vFogRay.y * 0.0042 ) : 1.0 ) )');
const FOG_NIGHT = 0.00075, FOG_DAY = 0.00026;
const FOG = new THREE.Color(0.115 * 0.85, 0.075 * 0.85, 0.13 * 0.85);

// ------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.targetPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;            // (PCFSoft was removed in r18x; PCF + shadow.radius is the soft path now)
document.body.prepend(renderer.domElement);
// GPU reset / out of VRAM: the page used to just go black. Drop one preset tier and reload (once per 60 s, so a broken driver cannot loop).
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  try {
    const last = +(localStorage.getItem('yd.lostT') ?? 0); if (Date.now() - last < 60000) return;
    localStorage.setItem('yd.lostT', String(Date.now()));
    const order = ['low', 'med', 'high', 'ultra'], i = Math.max(0, order.indexOf(quality.level) - 1); localStorage.setItem('yd.cap', order[i]);
  } catch { /* ignore */ }
  setTimeout(() => location.reload(), 400);
});

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, FOG_NIGHT);
scene.background = FOG;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 40000);
camera.position.set(70, 38, 150);
const sky = createSky(); scene.add(sky);

// lights (moonlight + hemisphere; street-lamp point lights are pooled below)
const hemi = new THREE.HemisphereLight(0x4a5c92, 0x1a1422, 1.3); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8aa6e0, 1.3); const moonDir = new THREE.Vector3(-0.45, 0.5, -0.7).normalize(); moon.position.copy(moonDir).multiplyScalar(400);
moon.castShadow = true; moon.shadow.mapSize.set(quality.shadowMap, quality.shadowMap); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.25; moon.shadow.radius = 3;
Object.assign(moon.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 900 }); moon.shadow.camera.updateProjectionMatrix();
scene.add(moon, moon.target);

// environment for wet-asphalt / glass reflections: dark sky + warm/neon blobs near the horizon
function buildEnv() {
  const s = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: {},
    vertexShader: 'varying vec3 v; void main(){ v = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 v; void main(){ float h = normalize(v).y; vec3 c = mix(vec3(0.25,0.14,0.18), vec3(0.015,0.025,0.06), smoothstep(-0.05,0.7,h)); if(h<0.) c = vec3(0.06,0.04,0.07); gl_FragColor = vec4(c,1.); }',
  }));
  s.add(dome);
  const cols = [0xff7a2a, 0xff2d9a, 0x2ad8ff, 0xffc060, 0x8a5cff, 0xff4a3a];
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, el = 0.02 + r() * 0.35, d = 40;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + r() * 5, 0.8 + r() * 2.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[Math.floor(r() * cols.length)]).multiplyScalar(2 + r() * 4), side: THREE.DoubleSide }));
    m.position.set(Math.cos(a) * d * Math.cos(el), Math.sin(el) * d, Math.sin(a) * d * Math.cos(el)); m.lookAt(0, 0, 0); s.add(m);
  }
  // same cube size as the live reflection probe (world/probe.js) so swapping to it does not change the env-map shader variant
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(s, 0.02, 0.1, 100, { size: quality.level === 'ultra' ? 256 : 128 }); pm.dispose();
  return rt.texture;
}
scene.environment = buildEnv();
scene.environmentIntensity = 0.55;

// ------------------------------------------------------------ post
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: quality.msaa });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// pass chain: Render -> SceneFX (AO + RT/SSR reflections + traced far shadows + in-scatter + NaN guard, inserted below once the height grid
// is loaded) -> Bloom -> Final (tone map + grade). The old separate NaN-guard and Output passes are folded into SceneFX / Final.
const depthTex = quality.fx ? new THREE.DepthTexture(innerWidth, innerHeight) : null; if (depthTex) depthTex.type = THREE.UnsignedIntType;
if (depthTex) composer.renderTarget2.depthTexture = depthTex;          // RenderPass renders into renderTarget2: SSR reads colour + depth from it
let sceneFx = null;                                       // created once the height grid is loaded (below)
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 1.05);
bloom.enabled = !!quality.bloom;
composer.addPass(bloom);
const finalPass = new FinalPass(quality); composer.addPass(finalPass);

// ------------------------------------------------------------ loading
const { M, T } = createMaterials(renderer);
const progress = (txt, p) => { $('loadtxt').textContent = txt; $('loadbar').style.width = (p * 100).toFixed(0) + '%'; $('loadpct').textContent = (p * 100).toFixed(0) + '%'; };
progress('Loading metadata…', 0.02);
const meta = await fetchJSON('/map/meta.json');
// fallbacks for materials introduced by the generator (the PBR pass may define better ones in materials.js)
M.pavement ??= new THREE.MeshStandardMaterial({ map: T.plaza, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
M.curb ??= M.wall;
M.trim ??= M.wall;     // window sills / lintels / balconies: separate mesh so the low preset can drop it
const manifest = await fetchJSON('/tiles/manifest.json');
const FM = createFarMaterials(shared, renderer);
const streamer = new Streamer({
  scene, manifest, quality, materials: { ...M, ...FM },
  onMesh(o, name, level) { if (name === 'trim' && quality.level === 'low') o.visible = false; o.castShadow = level === 0 && !/^(asphalt|sidewalk|plaza|grass|dirt|water|mark_|crossing|neon|terrain)/.test(name); o.receiveShadow = level === 0 && name !== 'neon'; },
});
camera.position.set(70, 38, 150);
const heightP = loadHeight();       // 9 MB: downloads while the first tiles stream (it used to start only after them)
heightP.catch(() => { });
await streamer.preload(camera.position, p => progress('Streaming world tiles…', 0.1 + 0.8 * p));
progress('Building scene…', 0.92);

// ------------------------------------------------------------ instanced props
const dummy = new THREE.Object3D();
// (trees / vegetation / street props are owned by src/props.js)
// street lamps: pole + arm + glowing head + additive light pool on the road
const lampHeads = [];
const fx = [];   // { color: THREE.Color, base: THREE.Color } basic-material glows that fade out in daylight
const tod = { day: 0, night: 1 };   // shared with plugins: read tod.night (0..1) to scale emissive/lights
tod.light = { dir: moonDir, key: moon, hemi };   // live references (tyre smoke lights itself with them)
{
  const n = meta.lamps.length / 6;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.1, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.7 }), n);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.07, 0.07), pole.material, n);
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 1.2), toneMapped: false }); fx.push({ color: headMat.color, base: headMat.color.clone(), floor: 0.12 });
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.1, 0.32), headMat, n);
  const poolMat = new THREE.MeshBasicMaterial({ map: T.glow, color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(0.32), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  fx.push({ color: poolMat.color, base: poolMat.color.clone(), floor: 0 });
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, n);
  const ornate = [];   // lamps on Republic Square itself are drawn as the cast-iron multi-globe lamps instead (src/landmarks/ornate_lamp.js)
  for (let i = 0; i < n; i++) {
    const [x, y, z, dx, dz, big] = meta.lamps.slice(i * 6, i * 6 + 6), h = big ? 9 : 6.6, th = Math.atan2(-dz, dx), onSquare = Math.abs(x - 40) < 105 && Math.abs(z + 45) < 90;
    if (onSquare) ornate.push([x, y, z]);
    const k = onSquare ? 1e-4 : 1;
    dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(k, h * k, k); dummy.updateMatrix(); pole.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + dx * 0.9, y + h, z + dz * 0.9); dummy.rotation.set(0, th, 0); dummy.scale.set(1.8 * k, k, k); dummy.updateMatrix(); arm.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + dx * 1.8, y + h - 0.05, z + dz * 1.8); dummy.rotation.set(0, th, 0); dummy.scale.set(k, k, k); dummy.updateMatrix(); head.setMatrixAt(i, dummy.matrix);
    const R = big ? 24 : 17;
    dummy.position.set(x + dx * 2.4, y + 0.19, z + dz * 2.4); dummy.rotation.set(0, 0, 0); dummy.scale.set(R, 1, R); dummy.updateMatrix(); pool.setMatrixAt(i, dummy.matrix);
    lampHeads.push(new THREE.Vector3(x + dx * 1.8, y + h - 0.3, z + dz * 1.8));
  }
  buildOrnateLamps(THREE, mergeGeometries, ornate, fx, scene);
  console.log('[lamps] ornate Republic Square lamps:', ornate.length);
  {   // dense avenues (lamps every ~15 m, both sides) stack their additive glow pools and wash the whole road out: scale each pool by how many neighbours it overlaps
    const CELLG = 14, grid = new Map(), keyOf = (x, z) => Math.floor(x / CELLG) + ',' + Math.floor(z / CELLG), L = meta.lamps, col = new THREE.Color();
    for (let i = 0; i < n; i++) { const k = keyOf(L[i * 6], L[i * 6 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
    for (let i = 0; i < n; i++) {
      const x = L[i * 6], z = L[i * 6 + 2], gx = Math.floor(x / CELLG), gz = Math.floor(z / CELLG); let cnt = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get((gx + dx) + ',' + (gz + dz)) ?? []) if (j !== i && Math.hypot(L[j * 6] - x, L[j * 6 + 2] - z) < 20) cnt++;
      pool.setColorAt(i, col.setScalar(1 / (1 + 1.15 * cnt)));
    }
    pool.instanceColor.needsUpdate = true;
  }
  pool.renderOrder = 5; pool.frustumCulled = false;
  scene.add(pole, arm, head, pool);
}
// neon ground glow (coloured halos spilling from shop signs)
{
  const n = meta.neon.length / 8, mat = new THREE.MeshBasicMaterial({ map: T.glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
  fx.push({ color: mat.color, base: mat.color.clone(), floor: 0 });
  const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, n), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const [x, y, z, ox, oz, r, g, b] = meta.neon.slice(i * 8, i * 8 + 8);
    dummy.position.set(x + ox * 2.5, y + 0.21, z + oz * 2.5); dummy.rotation.set(0, 0, 0); dummy.scale.set(13, 1, 13); dummy.updateMatrix(); halo.setMatrixAt(i, dummy.matrix);
    c.setRGB(r / 255, g / 255, b / 255).convertSRGBToLinear().multiplyScalar(0.28); halo.setColorAt(i, c);
  }
  halo.renderOrder = 5; halo.frustumCulled = false; scene.add(halo);
}

// ------------------------------------------------------------ plug-in modules (landmarks.js, props.js): each default-exports async (ctx) => ({ update?(dt, camera, time) })
const heightAt = await heightP;
if (quality.fx) { sceneFx = new SceneFXPass({ camera, depthTexture: depthTex, heightGrid: heightAt.grid, wetness, quality }); composer.insertPass(sceneFx, 1); }   // index 1 = straight after RenderPass: it must write to rt1, not to rt2 (whose depth texture it samples)
if (sceneFx?.rt) initRTWorld({ heightGrid: heightAt.grid }).catch(e => console.warn('rt world unavailable', e));   // background bake
const pluginUpdates = [];       // { path, update }
// shared with the car plug-in (src/car.js): drive mode takes over the camera, `focus` feeds the shadow frustum / lamp lights
const drive = { active: false, wanted: false, uiLock: false, kind: 'car', streamPos: null, lampLights: null, focus: new THREE.Vector3(), set(v) { setMode(v ? 'drive' : 'orbit'); } };
{
  const found = import.meta.glob(['./landmarks.js', './props.js', './circuits.js', './car.js', './nav.js', './mp.js', './menu.js', './garage.js', './heli.js', './orbeli.js']);
  const wantCircuits = new URLSearchParams(location.search).get('circuits') === '1';     // the race circuits are off by default: free roam (?circuits=1 restores them)
  // The plug-ins used to initialise one after the other (each one: import, download, parse, build). Their downloads and module loads now overlap:
  // phase 1 = everything that does not need the car (world dressing + the big car module itself, 4 MB of WASM), phase 2 = what talks to the car.
  const ctx = { THREE, scene, renderer, camera, M, T, meta, H: heightAt, lampHeads, tod, drive };
  const run = async (path, load) => {
    try { const mod = await load(); const api = await mod.default(ctx); if (api?.update) pluginUpdates.push({ path, update: api.update }); console.log('plugin loaded', path); }
    catch (e) { console.error('plugin failed', path, e); }
  };
  const entries = Object.entries(found).filter(([p]) => !(p.endsWith('circuits.js') && !wantCircuits));
  const carDeps = /\/(menu|mp|nav|garage|heli)\.js$/, late = /\/nav\.js$/;
  await Promise.all(entries.filter(([p]) => !carDeps.test(p)).map(([p, l]) => run(p, l)));
  await Promise.all(entries.filter(([p]) => carDeps.test(p) && !late.test(p)).map(([p, l]) => run(p, l)));
  // the map / GPS (1.4 MB graph + 18 k nodes to index) is not needed to start driving: it finishes behind the loading screen
  for (const [p, l] of entries) if (late.test(p)) run(p, l);
  // keep the historic update order (alphabetical by file) regardless of which plug-in finished first
  pluginUpdates.sort((a, b) => a.path.localeCompare(b.path));
}

// ------------------------------------------------------------ time of day (T toggles). 0 = night (default), 1 = day.
const C = (h) => new THREE.Color(h);
const DAY = { fog: C(0xa9bfd9), hemiSky: C(0xbcd2ff), hemiGround: C(0x6a5f52), key: C(0xfff0d6) };
const NIGHT = { fog: FOG.clone(), hemiSky: C(0x4a5c92), hemiGround: C(0x1a1422), key: C(0x8aa6e0) };
const sunDir = new THREE.Vector3(-0.55, 0.62, 0.55).normalize();
const DUSK_FOG = C(0x8a6f7e), DUSK_KEY = C(0xffa65c), DUSK_SUN = new THREE.Vector3(-0.8, 0.3, 0.6).normalize();       // golden hour (T cycles night -> dusk -> day)
const emissiveMats = ['facade', 'facade_tuff', 'facade_modern', 'facade_house', 'shop'].map(k => ({ m: M[k], base: M[k].emissiveIntensity }));
const neonBase = M.neon.color.r;
let todTarget = 0;
function applyTod(d) {
  tod.day = d; tod.night = 1 - d;
  const n = tod.night;
  const dusk = Math.max(0, 1 - Math.abs(2 * d - 1));            // 0 at night and day, 1 at golden hour (d = 0.5)
  sky.material.uniforms.uDay.value = d; sky.material.uniforms.uDusk.value = dusk;
  scene.fog.color.copy(NIGHT.fog).lerp(DAY.fog, d).lerp(DUSK_FOG, dusk * 0.8); scene.background = scene.fog.color; scene.fog.density = FOG_NIGHT + (FOG_DAY - FOG_NIGHT) * d;
  hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, d); hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, d); hemi.intensity = 1.3 + (1.25 - 1.3) * d;
  moon.color.copy(NIGHT.key).lerp(DAY.key, d).lerp(DUSK_KEY, dusk * 0.85); moon.intensity = 1.3 + (3.3 - 1.3) * d;
  moonDir.set(-0.45, 0.5, -0.7).lerp(sunDir, d).lerp(DUSK_SUN, dusk * 0.8).normalize();
  scene.environmentIntensity = 0.55 + (0.25 - 0.55) * d;
  renderer.toneMappingExposure = 1.0 + (0.85 - 1.0) * d;
  bloom.strength = 0.5 + (0.12 - 0.5) * d; bloom.threshold = 1.05 + 0.4 * d;
  for (const e of emissiveMats) e.m.emissiveIntensity = e.base * (0.03 + 0.97 * n);
  M.neon.color.setScalar(neonBase * (0.08 + 0.92 * n));
  for (const f of fx) f.color.copy(f.base).multiplyScalar(f.floor + (1 - f.floor) * n);
  for (const s2 of headSpots) s2.intensity = 650 * n;
  shared.uDay.value = d;
}
// real point lights recycled onto the nearest street lamps (specular streaks on wet asphalt, light on facades)
// Light count is a per-pixel cost in every lit material, so it scales with the preset (the CPU side is a grid query, not a sort of every lamp).
const POOL = quality.lights, lampLights = [];
for (let i = 0; i < POOL; i++) { const l = new THREE.PointLight(0xffb36b, 0, 34, 2); scene.add(l); lampLights.push(l); }
const focus = new THREE.Vector3();
drive.lampLights = lampLights;       // the garage (src/garage.js) takes the pooled lamp lights over for its ceiling lamps
const LCELL = 48; let lampGrid = null, lampGridN = -1;
const nearD = new Float64Array(POOL), nearI = new Int32Array(POOL);
function updateLampLights() {
  if (lampGridN !== lampHeads.length) {     // plug-ins may append lamp heads after start-up: rebuild the 48 m bucket grid when the list grows
    lampGrid = new Map(); lampGridN = lampHeads.length;
    lampHeads.forEach((p, i) => { const k = Math.floor(p.x / LCELL) * 65536 + Math.floor(p.z / LCELL); let a = lampGrid.get(k); if (!a) lampGrid.set(k, a = []); a.push(i); });
  }
  nearD.fill(Infinity); nearI.fill(-1);
  const cx = Math.floor(focus.x / LCELL), cz = Math.floor(focus.z / LCELL);
  for (let r = 0; r < 12; r++) {            // expanding rings until the K-th nearest lamp is closer than the next ring can be
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const a = lampGrid.get((cx + dx) * 65536 + cz + dz); if (!a) continue;
      for (const i of a) {
        const d = lampHeads[i].distanceToSquared(focus); if (d >= nearD[POOL - 1]) continue;
        let k = POOL - 1; while (k > 0 && nearD[k - 1] > d) { nearD[k] = nearD[k - 1]; nearI[k] = nearI[k - 1]; k--; } nearD[k] = d; nearI[k] = i;
      }
    }
    if (nearI[POOL - 1] >= 0 && Math.sqrt(nearD[POOL - 1]) < r * LCELL) break;
  }
  for (let i = 0; i < POOL; i++) { const l = lampLights[i], j = nearI[i]; if (j >= 0) { l.position.copy(lampHeads[j]); l.intensity = 120 * tod.night; } else l.intensity = 0; }
}

// ------------------------------------------------------------ demo car + tour
const car = new THREE.Group(); const headSpots = [];
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 4.3), new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.25, metalness: 0.85 })); body.position.y = 0.55; car.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.46, 2.0), new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.1, metalness: 0.9 })); cab.position.set(0, 1.0, -0.2); car.add(cab);
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.15, 0.1), toneMapped: false });
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.06), tail); t.position.set(0.6 * s, 0.7, 2.16); car.add(t); }
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5), toneMapped: false });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), head); h.position.set(0.65 * s, 0.68, -2.16); car.add(h);
    const sp = new THREE.SpotLight(0xfff0d8, 650, 90, 0.38, 0.8, 1.8); headSpots.push(sp); sp.position.set(0.65 * s, 0.75, -2.0); sp.target.position.set(0.65 * s, 0.2, -30); car.add(sp, sp.target);
  }
  for (const [x, z] of [[-0.95, -1.4], [0.95, -1.4], [-0.95, 1.4], [0.95, 1.4]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 })); w.position.set(x, 0.34, z); car.add(w); }
  car.visible = false; scene.add(car);
}
const tours = meta.tours.map(flat => { const pts = []; for (let i = 0; i < flat.length; i += 3) pts.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2])); const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1])); return { pts, cum, len: cum[cum.length - 1] }; });
let tourIdx = 0, tourS = 0;
function tourAt(t, s) { s = ((s % t.len) + t.len) % t.len; let i = 1; while (i < t.cum.length - 1 && t.cum[i] < s) i++; const k = (s - t.cum[i - 1]) / (t.cum[i] - t.cum[i - 1] || 1); return new THREE.Vector3().lerpVectors(t.pts[i - 1], t.pts[i], k); }
const carPos = new THREE.Vector3(), carDir = new THREE.Vector3(0, 0, -1), camPos = new THREE.Vector3();

// ------------------------------------------------------------ camera modes
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 4, 0); orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.495; orbit.maxDistance = 20000; orbit.minDistance = 4;
let mode = 'orbit';
const keys = new Set(); let flySpeed = 25, yaw = 0, pitch = -0.2, dragging = false;
function setMode(m) {
  mode = m; orbit.enabled = m === 'orbit'; car.visible = m === 'tour'; drive.active = m === 'drive'; $('hud').classList.toggle('hidden', m === 'drive');
  if (m === 'custom') orbit.enabled = false;
  if (m === 'fly') { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); yaw = e.y; pitch = e.x; }
  if (m === 'tour') { camPos.copy(camera.position); }
  $('mode').textContent = { orbit: 'ORBIT', fly: 'FLY', tour: 'TOUR', drive: 'DRIVE', custom: 'MENU' }[m];
}
drive.setMode = setMode;
// free camera looking at a point of the map (used by the map's "View in 3D")
drive.lookAt = (x, z, dist = 240) => {
  setMode('orbit'); const y = heightAt(x, z); orbit.target.set(x, y + 6, z);
  camera.position.set(x + dist * 0.18, y + dist * 0.62, z + dist * 0.8); orbit.update(); focus.copy(orbit.target);
};
addEventListener('keydown', e => {
  if (e.target?.closest?.('input,textarea,[contenteditable]')) return;      // typing in the map search
  keys.add(e.code);
  if (drive.menuOn && /^(Digit[1-4]|KeyN|KeyH)$/.test(e.code)) return;      // the menu / role system owns the camera modes
  if (e.code === 'Digit1') setMode('orbit'); if (e.code === 'Digit2') setMode('fly'); if (e.code === 'Digit3') setMode('tour'); if (e.code === 'Digit4') setMode('drive');
  if (e.code === 'KeyN' && mode !== 'drive') { tourIdx = (tourIdx + 1) % tours.length; tourS = 0; }
  if (e.code === 'KeyB') bloom.enabled = !bloom.enabled;
  if (e.code === 'KeyR' && mode !== 'drive') wetness.value = wetness.value > 0.5 ? 0.0 : 1.0;
  if (e.code === 'KeyH') $('hud').classList.toggle('hidden');
  if (e.code === 'KeyO' && mode === 'drive') wetness.value = wetness.value > 0.5 ? 0.0 : 1.0;
  if (e.code === 'KeyT') todTarget = todTarget < 0.25 ? 0.5 : todTarget < 0.75 ? 1 : 0;      // night -> dusk -> day
});
addEventListener('keyup', e => keys.delete(e.code), true);
renderer.domElement.addEventListener('pointerdown', e => { if (mode === 'fly') { dragging = true; renderer.domElement.setPointerCapture(e.pointerId); } });
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('pointermove', e => { if (mode === 'fly' && dragging) { yaw -= e.movementX * 0.0035; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0035)); } });
renderer.domElement.addEventListener('wheel', e => { if (mode === 'fly') flySpeed = Math.max(3, Math.min(400, flySpeed * (e.deltaY < 0 ? 1.15 : 0.87))); });
let sizeW = 0, sizeH = 0;
function fitSize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight); if (w === sizeW && h === sizeH) return; sizeW = w; sizeH = h;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); const bs = { med: 0.5, high: 0.75 }[quality.level] ?? 1; bloom.setSize(w * bs, h * bs);
  const pr = renderScale(w, h);       // pixel budget: a bigger window / monitor lowers the render scale instead of exploding the render-target memory
  if (Math.abs(pr - quality.targetPR) > 1e-3) { quality.targetPR = pr; if (typeof governor !== 'undefined') governor.rebase(pr); else { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); } }
}

if (drive.startMode) setMode(drive.startMode); else if (drive.wanted) setMode('drive');
// deterministic hooks for screenshots/tests
window.__yerevan = { drive, THREE, tod, streamer, quality, setTod(v) { todTarget = v; applyTod(v); }, setMode, camera, orbit, setCam(px, py, pz, tx, ty, tz) { setMode('orbit'); camera.position.set(px, py, pz); orbit.target.set(tx, ty, tz); orbit.update(); }, bloom, renderer, scene, wetness, tourStart(i, s) { tourIdx = i; tourS = s; setMode('tour'); } };

// ------------------------------------------------------------ loop
// live reflection probe (high / ultra): replaces the synthetic env dome with the real street around the player
const probe = quality.probe ? createProbe({ renderer, scene, quality, fallback: scene.environment }) : null;
// shadow-depth program grouping: instanced meshes get one shared depth material, so the shadow pass does not flip three's shared depth
// program between instanced / plain / batched objects (each flip = getParameters + getProgram on the CPU)
const instDepth = new THREE.MeshDepthMaterial();
function groupShadowPrograms() { scene.traverse(o => { if (o.isInstancedMesh && o.castShadow && !o.customDepthMaterial && !Array.isArray(o.material) && !o.material?.alphaTest) o.customDepthMaterial = instDepth; }); }
groupShadowPrograms(); if (quality.shadows) setInterval(groupShadowPrograms, 4000);       // (a full scene traversal: pointless when nothing casts shadows)
// compile every program before the loading screen goes away (async with KHR_parallel_shader_compile): no first-sight shader hitches
progress('Compiling shaders…', 0.95);
try { await Promise.race([renderer.compileAsync(scene, camera), new Promise(r => setTimeout(r, 20000))]); } catch (e) { console.warn('precompile', e); }
$('loading').classList.add('done');
progress('Ready', 1);
let statT = 0, shadowTick = 0;
bootDone();
const governor = createGovernor({ renderer, composer, quality, bloom, fxPass: sceneFx, moon, probe, getBasePR: () => quality.targetPR, busy: () => streamer.busy });
drive.prefetch = (x, z) => streamer.prefetch(x, z, heightAt(x, z) + 6);       // plug-ins (map, teleport) announce where the player is going
const gpuName = (() => { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)).replace(/ANGLE \(|\)|Direct3D.*|\(0x[0-9A-F]+\)/gi, '').replace(/NVIDIA,? |Corporation|,/g, '').trim() : '?'; })();
let cpuMs = 8;
const _fwd = new THREE.Vector3(), _keyCol = new THREE.Color(), _amb = new THREE.Color();
const clock = new THREE.Clock(); let frames = 0, acc = 0, lastLamp = 0;
// frame-time ring (last ~600 frames) for the stats line + window.__yerevan.bench(): avg fps and 1% low are what you feel, not the instant fps
const ft = new Float32Array(600); let ftN = 0;
const benchStats = () => { const n = Math.min(ftN, ft.length); if (n < 30) return null; const a = Array.from(ft.subarray(0, n)).sort((x, y) => x - y), avg = a.reduce((s, v) => s + v, 0) / n, low = a.slice(Math.floor(n * 0.99)).reduce((s, v) => s + v, 0) / Math.max(1, n - Math.floor(n * 0.99)); return { fps: +(1000 / avg).toFixed(1), low1: +(1000 / low).toFixed(1), worstMs: +a[n - 1].toFixed(1), frames: n }; };
// renderer.info is reset once per frame (not per pass) so draw calls / triangles cover the shadow map, the scene and every post pass
renderer.info.autoReset = false; const frameInfo = { calls: 0, tris: 0 };
window.__yerevan.benchReset = () => { ftN = 0; };
window.__yerevan.passes = composer.passes; window.__yerevan.fx = sceneFx; window.__yerevan.composer = composer; window.__yerevan.probe = probe;
window.__yerevan.fitForce = () => { composer.setPixelRatio(renderer.getPixelRatio()); sizeW = 0; fitSize(); };
window.__yerevan.bench = () => ({ ...benchStats(), gpuName, governor: governor.status, cpuMs: +cpuMs.toFixed(1), quality: quality.level, pixelRatio: renderer.getPixelRatio(), governorStep: governor.level, drawCalls: frameInfo.calls, triM: +(frameInfo.tris / 1e6).toFixed(2), textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length, gpu: (() => { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })() });
// always-on-screen FPS counter (menu > FPS counter, default on): avg fps / 1% low / frame ms
const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:50;font:600 12px/1.3 ui-monospace,Consolas,monospace;color:#fff;background:rgba(0,0,0,.55);padding:4px 8px;border:1px solid rgba(255,255,255,.18);letter-spacing:.04em;pointer-events:none;white-space:pre;text-align:right';
document.body.appendChild(fpsEl); let fpsOn = true, fpsT = 0;
window.__yerevan.showFps = on => { fpsOn = !!on; fpsEl.style.display = fpsOn ? '' : 'none'; };
try { window.__yerevan.showFps(localStorage.getItem('yd.fps') !== '0'); } catch { /* ignore */ }
// Per-frame section timer. A hitch (frame > 70 ms) is attributed to the sections of the frame BEFORE it (a frame's dt is measured at the start of the next one);
// time not covered by any section is GPU wait / garbage collection / the browser ("other").
const prof = { t: 0, sec: {}, last: {}, avg: {}, hitches: [], show: false };
const pm = n => { const now = performance.now(); prof.sec[n] = (prof.sec[n] ?? 0) + now - prof.t; prof.t = now; };
const pname = p => p.path.replace(/^.*\//, '').replace(/\.js$/, '');
window.__yerevan.prof = prof;
addEventListener('keydown', e => { if (e.code === 'Backquote') prof.show = !prof.show; });
function hitchText() {
  const h = prof.hitches[prof.hitches.length - 1]; if (!h || performance.now() - h.at > 25000) return '';
  return `\nhitch ${h.ms.toFixed(0)} ms ${((performance.now() - h.at) / 1000).toFixed(0)} s ago: ${h.parts}`;
}
function profText() {
  if (!prof.show) return '';
  return '\n' + Object.entries(prof.avg).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([k, v]) => k + ' ' + v.toFixed(1)).join(' · ');
}
renderer.setAnimationLoop(() => {
  fitSize();
  const frameT0 = performance.now();
  prof.t = frameT0; prof.last = prof.sec; prof.sec = {};
  const rawDt = clock.getDelta(); ft[ftN++ % ft.length] = rawDt * 1000;
  if (rawDt > 0.07 && clock.elapsedTime > 4) {
    const prevSum = Object.values(prof.last).reduce((s, v) => s + v, 0), parts = Object.entries({ ...prof.last, other: rawDt * 1000 - prevSum }).filter(e => e[1] > 4).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + v.toFixed(0)).join(' · ');
    prof.hitches.push({ ms: rawDt * 1000, parts, at: performance.now(), streaming: streamer.busy, batch: { ...streamer.batches?.stats } }); if (prof.hitches.length > 20) prof.hitches.shift();
  }
  for (const k in prof.last) prof.avg[k] = (prof.avg[k] ?? 0) + (prof.last[k] - (prof.avg[k] ?? 0)) * 0.05;
  if (fpsOn && (fpsT += rawDt) > 0.5) { fpsT = 0; const b = benchStats(); if (b) fpsEl.textContent = `${Math.round(b.fps)} FPS · ${quality.level.toUpperCase()}${quality.capped ? ' (safe mode)' : ''} · ${renderer.getPixelRatio().toFixed(2)}x\n1% low ${Math.round(b.low1)} · ${(1000 / b.fps).toFixed(1)} ms · cpu ${cpuMs.toFixed(1)} ms${governor.status ? '\n▼ ' + governor.status : ''}${quality.crashRecovered ? '\nlast start crashed: quality lowered' : ''}${streamer.busy ? '\nloading tiles…' : ''}${hitchText()}${profText()}`; }
  const dt = Math.min(rawDt, 0.1);
  if (Math.abs(tod.day - todTarget) > 1e-3) { applyTod(tod.day + Math.sign(todTarget - tod.day) * Math.min(Math.abs(todTarget - tod.day), dt / 2.5)); }
  if (mode === 'orbit') { orbit.update(); focus.copy(orbit.target); }
  else if (mode === 'fly') {
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const sp = flySpeed * (keys.has('ShiftLeft') ? 4 : 1) * Math.max(1, camera.position.y / 150) * dt;       // faster the higher you are: the clouds start at 1.8 km
    if (keys.has('KeyW')) camera.position.addScaledVector(fwd, sp); if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -sp);
    if (keys.has('KeyD')) camera.position.addScaledVector(right, sp); if (keys.has('KeyA')) camera.position.addScaledVector(right, -sp);
    if (keys.has('KeyE')) camera.position.y += sp; if (keys.has('KeyQ')) camera.position.y -= sp;
    camera.lookAt(camera.position.clone().add(fwd)); focus.copy(camera.position).addScaledVector(fwd, 25);
  } else if (mode === 'custom') {
    drive.camUpdate?.(dt, camera); focus.copy(drive.focus);
  } else {
    const t = tours[tourIdx]; tourS += 17 * dt;
    const p = tourAt(t, tourS), q = tourAt(t, tourS + 6);
    carPos.lerp(p, 1 - Math.exp(-dt * 12)); if (carPos.distanceTo(p) > 20) carPos.copy(p);
    const d = q.sub(p); d.y = 0; if (d.lengthSq() > 1e-4) carDir.lerp(d.normalize(), 1 - Math.exp(-dt * 6)).normalize();
    car.position.copy(carPos); car.rotation.y = Math.atan2(-carDir.x, -carDir.z);
    const want = carPos.clone().addScaledVector(carDir, -8.5); want.y += 2.9;
    camPos.lerp(want, 1 - Math.exp(-dt * 5)); if (camPos.distanceTo(want) > 40) camPos.copy(want);
    camera.position.copy(camPos); camera.lookAt(carPos.clone().addScaledVector(carDir, 10).add(new THREE.Vector3(0, 1.2, 0)));
    focus.copy(carPos);
  }
  pm('camera');
  if (clock.elapsedTime - lastLamp > 0.15) { updateLampLights(); lastLamp = clock.elapsedTime; }
  pm('lamps');
  for (const p of pluginUpdates) { p.update(dt, camera, clock.elapsedTime); pm('p:' + pname(p)); }
  // The shadow pass re-draws every caster (twice the draw calls = twice the CPU work on weak CPUs). The map is only refreshed every
  // quality.shadowEvery frames; between refreshes the light window stays where it was, so skipped frames are consistent, not swimming.
  const shadowOn = quality.shadows && moon.castShadow, shadowNow = shadowOn && (shadowTick++ % Math.max(1, quality.shadowEvery) === 0);
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = shadowNow;
  if (shadowNow || !shadowOn) { // shadow window pushed ~45 m ahead of the camera (most of the visible ground is in front of it), snapped to whole shadow texels (no shimmer)
    camera.getWorldDirection(_fwd); _fwd.y = 0; if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
    const q = 140 * 2 / quality.shadowMap, cx = focus.x + _fwd.x * 45, cz = focus.z + _fwd.z * 45;
    moon.target.position.set(Math.round(cx / q) * q, focus.y, Math.round(cz / q) * q); moon.position.copy(moon.target.position).addScaledVector(moonDir, 400); }
  pm('shadow');
  governor.update(dt, cpuMs);
  pm('governor');
  streamer.update(drive.streamPos ?? camera.position);        // the garage sits far outside the map: keep streaming around the real player
  pm('streamer');
  sky.position.copy(camera.position); sky.material.uniforms.uTime.value = clock.elapsedTime;
  if (clock.elapsedTime - statT > 1) { statT = clock.elapsedTime; $('stats').textContent = `${gpuName} · ${(streamer.stat.tris / 1e6).toFixed(2)}M tris · ${streamer.stat.shown} tiles shown · ${streamer.stat.loaded} loaded · q=${quality.level}${governor.level ? '-' + governor.level : ''}${(b => b ? ` · ${b.fps} fps (1% low ${b.low1}) · x${renderer.getPixelRatio().toFixed(2)}` : '')(benchStats())}`; }
  if (sceneFx) {
    const dusk = Math.max(0, 1 - Math.abs(2 * tod.day - 1));
    _keyCol.copy(moon.color).multiplyScalar(moon.intensity * 0.35); _amb.copy(hemi.color).multiplyScalar(hemi.intensity * 0.3);
    sceneFx.update({ time: clock.elapsedTime, fog: scene.fog.color, day: tod.day, dusk, sunDir: moonDir, sunCol: moon.color, moonDir, moonCol: moon.color, fogDensity: scene.fog.density,
      keyDir: moonDir, keyCol: _keyCol, amb: _amb, shadowCenter: moon.target.position, shadowHalf: 140 });
  }
  pm('fx');
  if (probe) probe.update(focus, tod.day, clock.elapsedTime);
  pm('probe');
  // EffectComposer never resets its ping-pong pair: with an odd number of swapping passes (NaN guard + SSR + Output = 3) the scene alternated
  // between rt2 (has the depth texture) and rt1 (doesn't) every frame, so SSR saw fresh depth only on every other frame -> flicker.
  composer.readBuffer = composer.renderTarget2; composer.writeBuffer = composer.renderTarget1;
  composer.render();
  pm('render');
  cpuMs += (performance.now() - frameT0 - cpuMs) * 0.1;
  frameInfo.calls = renderer.info.render.calls; frameInfo.tris = renderer.info.render.triangles; renderer.info.reset();
  frames++; acc += dt; if (acc >= 0.5) { $('fps').textContent = (frames / acc).toFixed(0) + ' fps'; frames = 0; acc = 0; }
});
