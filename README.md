# Yerevan Drift — Republic Square map (Three.js)

2 km × 2 km map of central Yerevan centered on Republic Square (40.17765 N, 44.5127 E), built from open data + real aerial imagery. Night by default (neon, wet asphalt), day mode on `T`.

## Run
```
npm run dev      # viewer: 1 orbit · 2 fly (drag, WASD, Q/E, Shift, wheel) · 3 drive tour · N next road · T day/night · R wet/dry · B bloom · H hide HUD
npm run build    # production bundle (dist/)
```

## Rebuild the data (order matters)
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
