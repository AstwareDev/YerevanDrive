# Yerevan Drift — Republic Square map (Three.js)

A drivable 3D map of central Yerevan around Republic Square (40.17765 N, 44.5127 E), built from open data + real aerial imagery. Night by default (neon, wet asphalt), day mode on `T`. Drive a drift car, fly the free camera, search addresses with a GPS navigator, or join other drivers online. Everything runs in the browser; there is no backend.

## Quick start
You need [Node.js](https://nodejs.org/) 22 or newer. The baked map data (`public/`, ~240 MB) is committed, so a fresh clone runs as is; you do **not** have to rebuild anything.

```
npm install
npm run dev      # then open the printed address (usually http://localhost:5173)
```

Use a desktop browser with WebGL2 and a dedicated GPU if you can. The game picks a quality preset automatically (`?q=low|med|high|ultra` overrides it, see *Performance* below).

```
npm run dev      # viewer: 1 orbit · 2 fly (drag, WASD, Q/E, Shift, wheel) · 3 drive tour · N next road · T day/night · R wet/dry · B bloom · H hide HUD
npm run build    # production bundle (dist/)
```

## How it works (UML)
![Component overview](docs/img/01-components.png)

`src/main.js` owns the renderer, camera modes and the frame loop, and auto-loads independent **plug-ins** (landmarks, props, car, map/GPS, multiplayer, menu). The map itself is baked offline by the scripts in `tools/` and streamed as LOD tiles at run time.

Full UML set in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: start-up and per-frame sequence diagrams, car and streaming class diagrams, the menu / camera state machine and the build-time data pipeline. Regenerate the images with `npm run docs:diagrams`.

## Rebuild the data (order matters)
`npm run build:all` runs the baking tools in the right order (orbeli → landmarks → map → tiles → props → clean-onroad → car → nav). The older step list below still shows what each tool does; the *Extended city* section further down has the current fetch order.

```
npm run data              # OSM (Overpass) + elevation (AWS Terrain Tiles z15)      -> data/
npm run imagery           # aerial mosaics (z18 whole map, z19 centre)               -> public/map/aerial*.webp
npm run build:landmarks   # hand-modelled landmarks, writes data/landmark-skip.json  -> public/map/lm/
npm run build:map         # base map GLB + meta + AO (needs the skip list above)     -> public/map/yerevan.glb (46 MB raw -> 13 MB meshopt)
npm run build:props       # vegetation / parked cars / street furniture placement    -> public/map/props.json
```

## Layout
- `tools/build-map.mjs` – terrain, roads (lane markings, sidewalks, crossings), parks/plazas/water, extruded buildings in 4 facade styles (tuff, panel, glass tower, house), hipped roofs detected from the aerial photo, parapets/cornices, neon signs, walls, lamps, baked contact-AO. Local frame: x east, y up (0 = square), z south.
- `tools/build-landmarks.mjs` + `src/landmarks*` – Republic Square ensemble (Government House + clock tower, History Museum/National Gallery, Marriott, Post, Foreign Ministry), animated singing fountains, Northern Avenue, Opera House, St Gregory Cathedral. Not built: Cascade and Karen Demirchyan complex (outside the ±1 km terrain).
- `tools/build-props.mjs` + `src/props*` – 6 tree species with leaf cards + wind, bushes/hedges, ~4k parked cars, signalised junctions with animated lights, signs, bus shelters, kiosks, flags, rooftop signs.
- `src/` – procedural PBR textures, wet-asphalt/aerial/AO shader patch (`materials.js`), sky (stars, moon, sun, Ararat silhouette at its true bearing), time of day, shadows, bloom with a NaN-safety pass.
- Plug-ins (`landmarks.js`, `props.js`) are auto-loaded by `main.js` and receive `{ THREE, scene, renderer, camera, M, T, meta, H, lampHeads, tod }`; read `tod.night` (0..1) to dim emissive things in daylight.
- `public/map/height.bin/json` – 5 m height grid; `src/height.js` / `tools/terrain.mjs` expose `H(x,z)` for physics.

## Data & licensing
- Map data © OpenStreetMap contributors (ODbL) — keep the attribution.
- Elevation: Mapzen/AWS Terrain Tiles.
- **Aerial imagery: Esri World Imagery, fetched for prototyping only.** Check the provider's terms before shipping; replace `TILE_URL` in `tools/fetch-imagery.mjs` with a licensed source (Mapbox, Maxar, local survey) for release.

## Driving (src/car.js + src/car/*)

The map now has a playable drift car (BMW G87 M2 widebody). It starts on the *Republic Loop* grid; `Tab` swaps between driving and the free cameras.

| Key | Action |
|---|---|
| W / S | throttle / brake, reverse when stopped |
| A / D | steer |
| Space | handbrake (clutch is disengaged while held) |
| Shift | clutch-kick (torque spike to break the rear loose) |
| E / Q, M | shift up / down in manual mode, toggle auto / manual |
| G | assists on/off (auto counter-steer, drift-angle stability torque, drift throttle, launch control) · V ABS |
| C | camera (chase, far, hood, cockpit) · R respawn · P paint · L lights · F2 sound · O wet/dry · T day/night |

* **Physics**: Rapier owns the rigid body and all collisions; the car dynamics are ours (`car/vehicle.js`): 4 spring/damper corners over the analytic ground
  (`H(x,z)` + a 0.5 m surface raster with curbs/sidewalks, `car/ground.js`), combined-slip tyre model with load sensitivity and relaxation length, RWD drivetrain with
  torque curve, 6-speed gearbox, locked-ish rear diff, aero, belly/roof scrape springs. Tune everything in the `CAR` constants at the top of that file.
* **World colliders** (`car/colliders.js`): building footprints, OSM walls/fences, circuit barriers (tyres/jersey/armco), trees, lamp poles, bollards and parked cars are
  bucketed in 96 m cells and streamed into Rapier as one triangle-mesh collider per cell around the car. Data comes from `public/map/colliders.json` and
  `surface.bin/json`, both written by `tools/build-map.mjs`.
* **Car model**: `node tools/build-car.mjs` turns `data/car/bmw_m2.glb` (Sketchfab FBX export, 271k tris) into `public/car/bmw_m2.glb` (3 MB, 241k tris): bakes the 0.01 FBX scale,
  drops the engine and the stock body, splits wheels into `steer_XX` → `spin_XX` nodes, removes transmission, renames the paint material to `paint`.
* **FX / audio / HUD**: `car/fx.js` (skid-mark ribbons, tyre smoke, sparks), `car/audio.js` (procedural engine/turbo/pops/tyres/wind, no sample files),
  `car/hud.js` (gauges + drift scoring: angle × speed × combo, near-wall and transition bonuses).
* **Headless tuning**: `npm run sim:car -- kick|hb|hold|circle|corner|accel` runs the vehicle on a flat road in Node and prints slip angle / yaw rate time series.

**Audio samples**: `public/audio/eng_*.wav` are ElevenLabs-generated engine loops (idle / ~3k / ~5k / ~7k rpm, loop-crossfaded and loudness-matched with SenseMCP) plus an off-throttle overrun burst.
`car/audio.js` cross-fades them by rpm and pitches them with `playbackRate`, and keeps the synthesized engine underneath so the pitch stays exact. Raw downloads are in `data/audio_raw/`.
Parked cars are off by default (clear roads); `?cars=1` restores them and their colliders.

## Gamepad / joystick
Plug in a controller (Xbox / PlayStation / most USB pads; Chrome and Edge need one button press before the page sees it). Left stick steers, **RT** gas, **LT** brake/reverse, **A** handbrake, **X** clutch-kick, **LB/RB** gears, **Y** camera, **B** respawn (closes the map), D-pad = auto/manual, assists, lights, paint, **Start** map, **Back** free camera, **L3** cancel route, **R3** quick teleport. In the map the left stick pans and the triggers zoom. Rumble on tyre slip, rev limiter and impacts. Generic joysticks/wheels: X axis steers, Y axis gas/brake, buttons 0-3 = handbrake / kick / camera / respawn. Keyboard and pad can be used together. Code: `src/car/input.js`.

## Sky
`src/sky.js`: night / dusk (golden hour) / day, with procedural banded cloud decks that drift with the wind and are lit by the sun or moon (dark blue deck with a golden gap at dusk, city-glow violet at night). **T** cycles night -> dusk -> day; `uCover` in the sky material sets cloud amount.

**Volumetric clouds (High / Ultra).** A slab 1.8-4 km above the camera is ray-marched through a tileable 3D noise texture (`src/skyNoise.js`, 64^3, generated in small CPU slices in the background; the 2D clouds show until it is ready, then cross-fade) with Beer-Lambert extinction, a two-lobe Henyey-Greenstein phase (silver lining), a short march towards the sun/moon for self-shadowing, bump shading of the lumps, flat bellies / rounded tops and a height-based ambient. Clouds are in world space (parallax while driving) and drift with the wind. **Free camera:** the layer is a real slab 1.8-4 km above the ground. Below it the sky dome draws the clouds; once the camera reaches 1.8 km (free camera / orbit, **E** climbs and flight speed grows with altitude) `src/post/cloudpass.js` composites the same march over the scene using the depth buffer, so you can fly into the mist and look down on the cloud deck with the city beneath (costs nothing at street level). Ultra = 22 steps + 3 light taps, High = 12 steps + 2, reflection-probe faces use a rough 6-step pass; Low / Med keep the 2D decks. Override with `?clouds=0|1|2` (0 = 2D, 1 = High, 2 = Ultra) to compare or if a GPU struggles. To preview the look without a GPU/browser: `node tools/sim-clouds.mjs out.png <day 0..1> <yaw> <pitch>` (CPU port of the march, kept in sync by hand with `volClouds` in `src/skyClouds.js`; optional last argument = camera altitude, e.g. 2600 inside the layer, 6000 above it).

## Multiplayer + deploying to Netlify
Every browser tab is a player; everyone sees everyone's car (ghost cars, no player-vs-player collisions), name tags, an *ONLINE* list (click your own row to rename) and the other drivers on the minimap / map.
`src/mp.js` sends the car state at 15 Hz over serverless WebRTC (Trystero; public Nostr relays are only used to find peers) plus a BroadcastChannel for tabs of the same browser, so **no backend is needed**. Default room is `public`; `?room=friends` makes a private one, `?mp=0` turns it off.
Deploy: `npm run build` then upload `dist/` (`netlify deploy --prod --dir=dist`, or connect the repo: `netlify.toml` is included). The site is ~235 MB of baked map data, mostly streamed on demand.
Limits: players behind strict NATs/corporate firewalls may not connect (no TURN server); works well up to roughly 10-15 drivers per room (full mesh).

## Map, search & GPS navigator
Press **F** (or the *Map* button) at any time:

* **Search** an address, street, house number (`Abovyan 12`), or a place (`Cascade`, `metro`); Armenian, English and Russian names all work and spelling variants (Baghramyan / Bagramyan) are tolerated. Category chips list the nearest metro stations, food, parks, hotels, shops, culture. *Enter* with no local match falls back to the Photon geocoder over OpenStreetMap (online, only on Enter; the typed text is the only thing sent).
* The result is shown on the **2D map** (dark vector map or satellite, pan / zoom / click to drop a pin) **and in the 3D world** as a light beam + floating label.
* **Navigate** starts turn-by-turn guidance from the car: heading-up minimap, turn card (arrow, distance, street, remaining distance / ETA), a glowing route ribbon painted on the road ahead, voice prompts (toggle in the map panel), automatic re-routing. **X** cancels the route. **Teleport car** drops the car on the nearest road; **View in 3D** flies the free camera there (Tab returns to the car).

Data: `node tools/build-nav.mjs` -> `public/map/nav.json` (road graph, search index, footprints) and `public/map/nav_aerial.webp` (satellite basemap). Code: `src/nav.js` (plug-in), `src/nav/{data,search,mapview,world3d,ui,geo}.js`. `node tools/test-nav.mjs` checks routing headlessly.

## Extended city (free-drive region)

The full-detail (L0) map is no longer 2 km x 2 km: `REGION` in `tools/config.mjs` (x -2560..1024, z -3584..1024, tile aligned) covers Republic Square plus
Marshal Baghramyan Ave, Orbeli Brothers St, Barekamutyun metro and Komitas Ave (252 L0 tiles, ~4.8 M triangles, ~105 MB of tiles; only tiles near the car are streamed).
Beyond it the usual far LOD tiles (L1 now reaches +-4096 m) carry the rest of Yerevan. `J` in the game teleports to the named streets (`places` in `public/map/meta.json`).

* `NEAR` (centre -768/-1280, half-size 2304 m) is the shared window of the aerial mosaic (`public/map/aerial.webp`, Esri z17), the contact-AO map and the road field. It is hard-coded in `src/materials.js` and `src/world/farMaterials.js` too.
* The fine 5 m height grid is now +-3800 m (`FINE_R`); the drivable surface raster (`public/map/surface.bin/json`) is cropped to the region (0.5 m cells, ~70 MB in memory).
* Rebuild order: `node tools/fetch-region.mjs` (fine OSM detail in 1 km chunks, merged with `data/osm_far` into `data/osm.json`; the old file is kept as `data/osm_center.json`) →
  `node tools/fetch-data.mjs` (height grid, OSM is skipped when present) → `node tools/fetch-imagery.mjs 17 2304 public/map/aerial.webp -768 -1280` → `node tools/build-textures.mjs roadfield` →
  `node --max-old-space-size=20000 tools/build-map.mjs` (~15 min) → `tools/build-props.mjs` → `tools/build-tiles.mjs`.
* Lamp glow pools are scaled down where lamps are dense (long avenues), otherwise the additive pools washed the whole road out.

## Performance & memory (weak PCs, tablets)

- **Presets** (`src/quality.js`): `low / med / high / ultra`. Besides resolution/shadows each one has a *pixel budget* (max internal pixels, so a 1440p monitor
  on Ultra is no longer rendered as 4K + 4x MSAA), a point-light pool size (`lights`, paid per pixel in every lit material), a shadow-map refresh rate
  (`shadowEvery`) and photo-layer sizes (`aerial`). `?pr=1.0` forces a render scale, `?lights=N`, `?shadowEvery=N`, `?msaa=N` override single knobs.
- **Auto mode** picks the preset from the GPU name, core count, device memory and touch input. If the previous start died while loading (OOM / GPU reset) the
  next start is capped one tier lower ("safe mode" in the fps box); picking a level in Settings > Graphics lifts the cap. A lost WebGL context does the same.
- **Governor** (`src/perf.js`): works out whether the frame is CPU- or GPU-bound, lowers resolution / shadow refresh / draw distance / effects in that order,
  climbs back up when there is headroom, remembers what it learned per preset, and shows what it changed under the fps counter.
- **Streaming** (`src/world/streamer.js`): coarse tiles (L2+) stay resident so a teleport always has terrain under it; L3-L4 come from one pack file
  (`node tools/pack-tiles.mjs`); map selection / teleport call `drive.prefetch(x, z)`; tile attach is time-sliced per mesh.
- **Assets**: `node tools/make-lowres.mjs` writes the half-resolution photo layers (`*.2k.webp`, `roadfield.2k.png`) used by Low/Med; PBR texture sets are capped at 1K
  except the hero surfaces (road, pavement, plaza, main facades) in `src/pbr.js`.
- Not done yet (biggest remaining wins): KTX2/Basis GPU texture compression (needs an encoder), moving GLB parsing + batching into a Worker, TAA/FSR-style upscaling.
