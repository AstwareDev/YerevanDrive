# Handoff: Ultra graphics / perf / ray tracing / Orbeli + Komitas detail (session of 2026-11-20)

The work is uncommitted, so check it with `git.exe diff` / `git.exe status`.

Use the **Windows** binaries from WSL: `node.exe`, `git.exe`. The Linux shell has no node or git.

The dev server is `node.exe node_modules/vite/bin/vite.js --port 5173 --host 127.0.0.1`.

## Tools
- `node.exe tools/bench.mjs` is a headless bench and screenshot harness (raw CDP, no npm deps).
  - It runs Playwright's chrome-headless-shell on the real GPU via ANGLE/D3D11. On this machine that is a GTX 1660 Super.
  - `--q ultra|high|med|low` picks the preset.
  - `--views square,street,orbeli,orbeli_hi,komitas,komitas_hi,baghramyan,drive` picks the views (`drive` = player car in chase cam).
  - `--tod 0|0.5|1` sets time of day; `--secs N` is the measuring time per view.
  - `--out .scratch/bench/x` sets where PNGs go.
  - `--params "ao=0&rt=0"` adds URL params.
  - `--prejs "<js>"` runs before the views; `--js "<expr>"` prints a result.
  - Analysis modes:
    - `--exp`: A/B costs of features (pixel ratio, shadow map, MSAA, bloom, RT, AO, probe, post).
    - `--profile`: JS CPU profile.
    - `--stats`: draw-call breakdown.
- Benchmarks are only meaningful when no other session is running SwiftShader renders. A parallel session did this earlier and skewed the numbers.
- `window.__yerevan.bench()` now reports the true total draw calls per frame (`renderer.info.autoReset = false`).
- The new URL toggles are `?ao=0|low|high`, `?rt=0|refl|full`, `?probe=0|1`, `?batch=0` (old one-mesh-per-tile path) and `?facdbg=1..4` (facade debug views).

## Done (verified with screenshots and bench)

### 1. Performance
Diagnosis: at Ultra the game was **CPU-bound**, not GPU-bound. It made ~700–1000 draw calls, and dropping the pixel ratio did not raise fps.

- `src/world/batches.js`: cross-tile **BatchedMesh** batching per material. Streamed tile geometry is copied into one multi-draw per material.
  - Freed slots are recycled; batches grow or compact as needed.
  - Batches have their own depth material, to avoid shadow-pass program flips.
  - Material world varyings handle `batchingMatrix` (`WORLD_VARYINGS` in materials.js, farMaterials.js).
  - Result: draw calls went from 954 to 370 (street view) and from 757 to 220 (Komitas).
- `streamer.js`:
  - meshopt decoding moved to workers;
  - static tile groups skip the per-frame matrix walk;
  - L0 roof meshes are kept as invisible proxies for the props roof raycaster.
- `props/util.js`: empty instanced LOD levels are now hidden. They used to cost a full program setup and an empty draw per pass.
- `main.js`:
  - lamp-light selection is a grid query instead of sorting every lamp;
  - the point-light count scales with the preset;
  - shaders are precompiled with `compileAsync` before the loading screen closes;
  - instanced meshes share one depth material.
- Post effects at half resolution (see section 2). The day square view went from 24 to 37 fps once reflections were half-res.
- The frame is now **GPU-bound** at Ultra (pixel ratio 1.5 plus MSAA 4). Lowering the pixel ratio to 1.0 gives about +70%.

### 2. Ultra rendering
- `src/post/scenefx.js` (replaces post/ssr.js and the separate NaN-guard pass):
  - half-res depth-only horizon AO with bilateral blur and upsample;
  - half-res reflections: SSR with bisection refinement, plus the **ray-traced fallback**;
  - fog in-scattering;
  - a bit-level NaN/Inf guard (D3D strips `isnan()`).
- `src/post/rtworld.js` + `rtbake.worker.js`: **hybrid software ray tracing.**
  - A worker bakes a 2 m city heightfield (terrain plus all 11.5k building prisms from colliders.json) with a 16 m max level.
  - It is traced in the shader for off-screen reflections (facades with lit windows, streets, road glow) and for sun shadows beyond the 280 m shadow map.
- `src/post/final.js`: tone mapping, vignette, grain/dither, and chromatic aberration (Ultra), merged into one pass that replaces OutputPass.
- `src/world/probe.js`: time-sliced live reflection probe that replaces the static env dome.
  - The PMREM output is **sanitised** (NaN/Inf to 0, clamped at 24).
  - That fixes the full-screen white-out seen while driving at dusk: a half-float overflow got blurred over the whole env map.
- Height fog: an exponential falloff with altitude, patched globally in the fog chunks in main.js.
- The shadow window is pushed ahead of the camera and snapped to texels.
- `perf.js`: new governor steps. `fxPass.degrade` goes 1 = no RT, 2 = also no AO, 3 = also no SSR.
- `quality.js`: new preset fields `ao`, `rt`, `probe`.

### 3. Orbeli + Komitas
- Street survey: `.scratch/streets-reference.md`. It is built from OSM, Wikimedia Commons photos and a tree survey, with per-segment facts, hex palette, landmarks and coordinates. **Read it first.** The photos are in `.scratch/ref/`.
- `tools/build-orbeli.mjs` now selects **136 blocks** along the whole of both streets: 33 on Orbeli and 103 on Komitas (Komitas stops at x 1010, the L0 region edge).
  - Each block gets style, palette, roof, ground-floor type and landmark overrides (`SPECIAL` table).
  - It also writes crossings and junctions.
  - The map was rebuilt so these blocks are removed from the tiles: build-landmarks → build-map → build-tiles → build-props. All exited 0; the log is `data/build-streets.log`.
- `src/streets/facade.js`: **procedural facade shader**, one quad per wall and about 8 draw calls for all blocks.
  - Ray-traced window recesses, interior-mapped rooms, PVC frames, sills and surrounds.
  - Tuff ashlar or tile cladding.
  - Hipped sheet-metal roofs, cornices and parapets.
  - Instanced balconies (iron, glazed, cage), AC units, shop lightbox signs and Orbeli 8's slatted balconies.
  - Shader LOD.
  - The JS `h3`/`cellKind` must stay identical to the GLSL versions, because balconies line up with the painted doors.
- `src/streets/streetscape.js`:
  - Komitas trolleybus line (poles, span wires, two contact-wire pairs per direction);
  - Orbeli basalt retaining walls with a grass bank;
  - whitewashed trunks on Orbeli;
  - the bus shelter at Orbeli 12 and the street-name stele;
  - the Komitas Market portico and the Komitas 15 clock;
  - yellow zebras (this changes the global `M.crossing` colour).
- `src/orbeli.js` uses the new system. The BISA strip is unchanged. The old concrete utility poles and wires are now restricted to Orbeli.
- `src/orbeli_blocks.js` (the old canvas kit) is no longer imported. Delete it once the new system is approved.

## TODO (in priority order)
1. **BUG: speckle / dash noise in lit facade windows** (and some wall pixels near them). This is the biggest visible problem.
   - It is NOT caused by AO, not by shadow receiving, and not by glass normals (all three tested).
   - Debug renders already exist: `.scratch/bench/dbg1/crop.png` (emission only) and `dbg2/crop.png` (albedo only). They have not been inspected yet; run them with `--views komitas_hi --params facdbg=1`.
   - Suspects:
     - the `room()` interior-mapping branches (`t == tx/ty/tz` float compares; try picking the minimum with an index instead);
     - `h3()` with large float seeds (`rs = seed*31 + ...`); try `mod(rs, 8191.0)`;
     - the curtain `step()` lines.
2. Facade polish:
   - towers: check loggia density;
   - add arched windows (Kievyan 12 `arches`, Orbeli 67/2 `topArch`, Market central arch) — the flags are passed to the shader but no arch shapes are drawn yet;
   - Mergelyan crown band and wings need visual checks;
   - Komitas 15 terracotta and band colours;
   - the facade glass looks dark by day, so tune `dayView`.
3. Komitas street dressing still missing:
   - pollarded elm rows (5.5–6 m spacing; the props tree model is a natural crown);
   - Mher Mkrtchyan Square island;
   - Holy Cross church (996,-3116);
   - Yerevan City box (786,-3109);
   - Mergelyan green curtain wall (style `glass` exists, needs checking);
   - parked cars along both kerbs;
   - the west boulevard central park strip.
4. Orbeli:
   - south-side low red-brick / cream houses with corrugated hipped roofs (still generic tiles);
   - the Orbeli 23 orange tuff fence;
   - the split-level east end parapet and keep-right bollard;
   - the School 83 canopy.
5. Perf (now GPU-bound at Ultra):
   - consider MSAA 2 when supersampling ≥1.4 (bench `msaa2` was only slightly faster; numbers were noisy);
   - dynamic-resolution scaling on Ultra;
   - the cost of the 14 forward point lights per pixel (clustered or deferred-ish light pools?);
   - KTX2/Basis textures (no encoder installed);
   - streaming `TileBatches.add` copies interleaved attributes per component in JS. Profile streaming hitches (1% lows are still low).
6. RT quality:
   - heightfield reflections are blocky (2 m cells); add roughness-based blur or 1 m cells near the camera;
   - RT shadows are sun-only and day-only by design.
7. Ultra car paint looks dark at dusk with the probe env; check `envMapIntensity` and `scene.environmentIntensity` versus the captured env.
8. Clean-up: remove the old `src/post/ssr.js` (unused); README section for the new pipeline; commit.

## Baseline numbers (Ultra, 1600x900, pixel ratio 1.5, GTX 1660S, night)
- Before: 44–55 fps, 667–1005 draw calls, CPU-bound.
- After batching alone: Komitas went from 49 to 71 fps.
- With all new effects on (AO, RT, probe, half-res reflections): ~38–49 fps at night and ~32–37 fps by day, GPU-bound.
