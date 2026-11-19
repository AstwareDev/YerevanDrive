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
