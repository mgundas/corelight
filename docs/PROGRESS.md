# Corelight: Progress Log

The coding agent updates this file at the end of every milestone. Keep it short: future sessions read it to know what exists.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M00 Scaffold | done | Vite + TS strict scaffold, fixed-timestep loop, debug overlay, free-fly camera |
| M01 Density and meshing | done | Deterministic density field + worker meshing; temp preview scene (M02 replaces it with LOD) |
| M02 Chunk streaming and LOD | not started | |
| M03 Gravity and player | not started | |
| M04 Terrain tool | not started | |
| M05 Light, sky, day/night | not started | |
| M06 Save and load | not started | |
| M07 Resources and backpack | not started | |
| M08 Oxygen and tethers | not started | |
| M09 Printing | not started | |
| M10 Base and power | not started | |
| M11 Research | not started | |
| M12 Smelting and progression | not started | |
| M13 Second planet and space | not started | |
| M14 Shuttle | not started | |
| M15 Cores and endgame | not started | |
| M16 Polish | not started | |
| M17 Co-op (optional) | not started | |

## Known issues

(none yet)

## Decisions made during development

- M00 review fixes: `World.nextId()` (seed + per-world counter) is the only ID source in sim paths (`applyAction`); `newId()` is UI-only and counter-based (no `Date.now`/`Math.random`) to keep same-seed replays identical. `Renderer.applyOriginShift` skips `THREE.Light` objects and re-pins the sun to a fixed direction so origin shifts never change lighting. Placeholder sphere detail 24 -> 5 (detail 24 = ~5e15 tris, hangs the tab).

## Per-milestone notes

### M00 Scaffold (done)
Built: Vite + TS (`strict`, `noUncheckedIndexedAccess`) project `corelight`; scripts `dev`/`build`/`check`. `src/core` (math, ids, rng, events, constants, urlParams), `src/sim` (entities, actions, world with fixed 30 Hz tick), `src/game/Game.ts` (accumulator loop, max 5 catch-up ticks), `src/render` (Renderer with logarithmic depth buffer + 400 m placeholder icosphere, floatingOrigin with >1000 m shift + `originShifted` event), `src/player/freeFlyCamera.ts` (default-on F3 fly), `src/ui/debugOverlay.ts` (F1), `src/main.ts` boot. Tests: math, rng, world dispatch/order, floating-origin shift (13 tests, `npm run check` passes). `grep three src/sim/` returns no matches.
Run: `npm install` (once), `npm run dev`, open http://localhost:5173. Fly: click canvas (pointer lock) or drag to look, WASD + Q/E, wheel = speed 1..2000 m/s, F1 overlay, F3 toggles fly. `?seed=123` overrides seed; `?skipBoot=1` accepted for later use.

### M01 Density and meshing (done)
Built: `src/planets/PlanetConfig.ts` + `configs/sela.ts` (radius 400, gravity 6, surfaceAmp 15, caves f 0.022/top 0.07/bottom 0.24/start 6, layers surface 0-30/crust 30-140/mantle 140-354, core chamber 40/shell 6). `src/terrain/noise.ts` (seeded simplex 3D + fbm from `createRng`), `density.ts` (`createDensityField`/`createDensityFn` per ARCH: `depth + fbm(dir)*amp`, worm carve `min(d,(c-threshold)*10)` skipped above 6 m and inside core shell, `min(r-chamberRadius)` hollow core; `layerAt` incl. shell/chamber pseudo-layers; `colorAt` grass/dirt by slope near surface + noise variation). `marchingCubes.ts` (35^3 samples, inner 32^3 cells, Bourke tables in `marchingCubesTables.ts` extracted from three.js, lerp verts, negated central-difference normals, edge-cache weld) + `chunkKey.ts` + `workers/meshWorker.ts` (transferables, `empty` flag) + `workerPool.ts` (cores-1 clamped [2,6], FIFO promise API). `src/render/chunkMeshes.ts` (shared flat-shaded vertex-color material, world-pos re-sync, LRU 1500) + `previewTerrain.ts` (56 L3 shell chunks + 8 L1 chunks in 128 m cube at (0,400,0); M02 replaces with LOD). Renderer loads preview async (no boot screen yet); overlay shows chunk/queue progress. Tests: `tests/terrain/density.test.ts` (determinism, signs, layers), `marchingCubes.test.ts` (sphere radius/normals, empty grids, table consistency) — 27 tests pass.
How the density works: same `worldSeed:planetSeed:field` seeds everywhere give identical terrain in any worker; caves are `|n1|+|n2| < threshold(depth)` worms with depth-independent width via the `*10` min-carve; the core stays hollow because `r - chamberRadius` wins the min inside r=40.
Run: `npm run dev`, F3 fly out to see the bumpy sphere, fly to the top (detail area) for 2 m-cell terrain and cave mouths, fly to (0,0,0) for the hollow core chamber. F1 shows `chunks: meshes / done of total (queue N)`.

### M01 review fixes (done)
Static review of M01 found real bugs; all fixed here. Critical: (1) `polygonize` emitted absolute planet-local positions while `ChunkMeshes.add` also offset by chunk origin — terrain would have rendered double-offset; positions are now chunk-relative per ARCH, colors still sampled at absolute coords; regression test pins `[0, 32*cellSize]` range. (2) Temp scene never meshed the planet center, so the core chamber was unreachable — added 8 L1 chunks over `[-64, 64]^3` (verified: 84k tris across the 8 core chunks). (3) Winding was inverted for our solid-positive convention (Bourke rows assume set-bit = below isolevel) — triangles now emit reversed for outward FrontSide; single-cube test asserts geometric normal `(+,+,+)`. Major: Renderer takes `PlanetConfig[]` (no single-planet assumption); empty worker results are cached (`has`/`emptyCount`) so M02 won't re-queue them; pool has `onerror`/`onmessageerror` with worker replacement + 2-retry requeue (a crash can't hang the preview); removed per-frame `syncAll` (position on add + re-sync on origin shift only) for the 4 ms budget. Minor: color variation seeded per world (`colorAt` salt), cave-threshold ramp divides by `deep - startDepth`, worker memoizes one field per planet+seed, overlay shows planet/depth/layer. 29 tests pass.
