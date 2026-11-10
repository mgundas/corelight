# Corelight: Progress Log

The coding agent updates this file at the end of every milestone. Keep it short: future sessions read it to know what exists.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M00 Scaffold | done | Vite + TS strict scaffold, fixed-timestep loop, debug overlay, free-fly camera |
| M01 Density and meshing | done | Deterministic density field + worker meshing; temp preview scene (M02 replaces it with LOD) |
| M02 Chunk streaming and LOD | done | Octree streaming, skirts, boot pre-gen, F4/F5 debug |
| M03 Gravity and player | done | Spherical gravity, Rapier character controller, collider ring, third-person astronaut |
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
- M02 solid-skip deviation: ARCH's "certainly all solid" corner+center check is unsound for our density — tunnel walls are cliffs (d -> 0- inside, ~= depth+relief outside), so a worm thinner than the sample spacing reads solid at all 9 points (regression test pins a seed-1337 case). The streamer and boot only pre-skip 'air' verdicts (proven sound: large-magnitude negative density only occurs in the continuous above-ground field); everything else is decided exactly by the worker's full-grid sampling.
- M02 origin-shift fix: `applyOriginShift` moved `chunks.group` (meshes are re-synced absolutely), which double-shifted all terrain after flying >1000 m. Groups that position children from world doubles now set `userData.originManaged` and are skipped; chunk bounds resync from stored world boxes.
- M02 drain-before-recompute: applying finished jobs before diffing avoids re-queueing jobs that already completed (was doubling every submission).
- M03 Rapier queries need `world.step()` every tick: without it the broadphase stays stale and `computeColliderMovement` falls through the floor. Step only refreshes queries in M03 (no dynamic bodies yet), deterministic at fixed dt.
- M03 collider data is a separate path, not reused mesh buffers: new `colliderWorker` (marching cubes, no skirts/colors) + `ColliderPool`, sharing `terrain/sampleGrid.ts` with the mesh worker so visual and collision surfaces sample the identical grid.
- M03 embedded safety freezes instead of falls: fully-solid L0 chunks produce no trimesh (no surface), so a buried player must skip gravity/controller integration and only push out along the inverse gradient (depth-scaled, capped per tick), else the fall velocity outruns the push.
- M03 ring always requests the containing L0 chunk even past the 48 m filter: `groundState` depends on it, and a player dropped from high above learns "all air, keep falling" (empty -> ready) instead of freezing on an unrequested chunk. Ring range clamps into the octree root.
- M03 boots into third-person (fly default-off; F3 still toggles, exiting fly teleports the player to the camera). PlayerInput handlers are gated by mode so fly keys never leak into the rig.
- M03 review fixes: camera collision queries nearby Rapier LOD0 terrain colliders directly (`TerrainColliders.castTerrainRay`) instead of traversing render meshes; pure orientation/basis helpers live in `frames.ts`; deep space reports `ready` because there is no terrain chunk to wait for (directed space motion stays out of scope); all astronaut materials are disposed.
- FIX walk jitter + terrain seams: the orbit camera and the astronaut now share one interpolated render transform (`PlayerView.interpolatedWorld`), instead of the camera following raw post-tick sim state while the mesh rendered a lagged interpolation; terrain material uses smooth vertex normals (`flatShading: false`) so facets and LOD-boundary shading steps soften. This narrows the old "flat-shaded everything" look to props/character only (docs updated).

## Per-milestone notes

### M00 Scaffold (done)
Built: Vite + TS (`strict`, `noUncheckedIndexedAccess`) project `corelight`; scripts `dev`/`build`/`check`. `src/core` (math, ids, rng, events, constants, urlParams), `src/sim` (entities, actions, world with fixed 30 Hz tick), `src/game/Game.ts` (accumulator loop, max 5 catch-up ticks), `src/render` (Renderer with logarithmic depth buffer + 400 m placeholder icosphere, floatingOrigin with >1000 m shift + `originShifted` event), `src/player/freeFlyCamera.ts` (default-on F3 fly), `src/ui/debugOverlay.ts` (F1), `src/main.ts` boot. Tests: math, rng, world dispatch/order, floating-origin shift (13 tests, `npm run check` passes). `grep three src/sim/` returns no matches.
Run: `npm install` (once), `npm run dev`, open http://localhost:5183. Fly: click canvas (pointer lock) or drag to look, WASD + Q/E, wheel = speed 1..2000 m/s, F1 overlay, F3 toggles fly. `?seed=123` overrides seed; `?skipBoot=1` accepted for later use.

### M01 Density and meshing (done)
Built: `src/planets/PlanetConfig.ts` + `configs/sela.ts` (radius 400, gravity 6, surfaceAmp 15, caves f 0.022/top 0.07/bottom 0.24/start 6, layers surface 0-30/crust 30-140/mantle 140-354, core chamber 40/shell 6). `src/terrain/noise.ts` (seeded simplex 3D + fbm from `createRng`), `density.ts` (`createDensityField`/`createDensityFn` per ARCH: `depth + fbm(dir)*amp`, worm carve `min(d,(c-threshold)*10)` skipped above 6 m and inside core shell, `min(r-chamberRadius)` hollow core; `layerAt` incl. shell/chamber pseudo-layers; `colorAt` grass/dirt by slope near surface + noise variation). `marchingCubes.ts` (35^3 samples, inner 32^3 cells, Bourke tables in `marchingCubesTables.ts` extracted from three.js, lerp verts, negated central-difference normals, edge-cache weld) + `chunkKey.ts` + `workers/meshWorker.ts` (transferables, `empty` flag) + `workerPool.ts` (cores-1 clamped [2,6], FIFO promise API). `src/render/chunkMeshes.ts` (shared flat-shaded vertex-color material, world-pos re-sync, LRU 1500) + `previewTerrain.ts` (56 L3 shell chunks + 8 L1 chunks in 128 m cube at (0,400,0); M02 replaces with LOD). Renderer loads preview async (no boot screen yet); overlay shows chunk/queue progress. Tests: `tests/terrain/density.test.ts` (determinism, signs, layers), `marchingCubes.test.ts` (sphere radius/normals, empty grids, table consistency) — 27 tests pass.
How the density works: same `worldSeed:planetSeed:field` seeds everywhere give identical terrain in any worker; caves are `|n1|+|n2| < threshold(depth)` worms with depth-independent width via the `*10` min-carve; the core stays hollow because `r - chamberRadius` wins the min inside r=40.
Run: `npm run dev`, F3 fly out to see the bumpy sphere, fly to the top (detail area) for 2 m-cell terrain and cave mouths, fly to (0,0,0) for the hollow core chamber. F1 shows `chunks: meshes / done of total (queue N)`.

### M01 review fixes (done)
Static review of M01 found real bugs; all fixed here. Critical: (1) `polygonize` emitted absolute planet-local positions while `ChunkMeshes.add` also offset by chunk origin — terrain would have rendered double-offset; positions are now chunk-relative per ARCH, colors still sampled at absolute coords; regression test pins `[0, 32*cellSize]` range. (2) Temp scene never meshed the planet center, so the core chamber was unreachable — added 8 L1 chunks over `[-64, 64]^3` (verified: 84k tris across the 8 core chunks). (3) Winding was inverted for our solid-positive convention (Bourke rows assume set-bit = below isolevel) — triangles now emit reversed for outward FrontSide; single-cube test asserts geometric normal `(+,+,+)`. Major: Renderer takes `PlanetConfig[]` (no single-planet assumption); empty worker results are cached (`has`/`emptyCount`) so M02 won't re-queue them; pool has `onerror`/`onmessageerror` with worker replacement + 2-retry requeue (a crash can't hang the preview); removed per-frame `syncAll` (position on add + re-sync on origin shift only) for the 4 ms budget. Minor: color variation seeded per world (`colorAt` salt), cave-threshold ramp divides by `deep - startDepth`, worker memoizes one field per planet+seed, overlay shows planet/depth/layer. 29 tests pass.

### M02 Chunk streaming and LOD (done)
Built: `src/terrain/octree.ts` (centered single root, root-relative integer coords so the root stays on the key grid; `updateOctree` exact ARCH split rule; `nodesAtLevel`; `classifyNode` + sound `isDefinitelyAir` wrapper), `skirts.ts` (marching-squares boundary ribbons, both windings, 1-cellSize drop; `polygonize(..., { skirts })`, worker enables it), `chunkKey.ts` trimmed to size/key helpers, `chunkManager.ts` (100 ms diff, frustum-bonus priority, maxInflight = 2x workers, 4 ms drain budget, no-hole removal via overlap-vs-loaded, 5 s failure cooldown; render isolated behind `MeshSink`), `render/chunkBounds.ts` (F5 Box3Helpers colored by level) + `frustum.ts`, `game/boot.ts` (Corelight title + progress bar, levels max..max-2, `?skipBoot=1`), `planets/solarSystem.ts` (`PLANETS`), Renderer streams per frame (F4 wireframe, F5 bounds), overlay shows `L0:n ... (desired/pending/cache/empty)`. Deleted `previewTerrain.ts`. Tests: `octree.test.ts` (far=1 root leaf, surface/core contain L0, exact cover no overlaps, deterministic, air-safety sweep + false-solid regression), `chunkManager.test.ts` (root streaming, nearest-first, surface settle with air-skips never submitted, split no-hole, merge no-hole vs single-flight pool), `marchingCubes.test.ts` +2 skirt tests, `chunkMeshes.test.ts` (sink contract, LRU eviction at 1500). 50 tests pass.
Run: `npm run dev`, watch boot pre-generate, F3 fly out to 3 km (coarse planet), dive back (detail refines, no holes), F5 for LOD boxes, F1 for `chunks L0:.. (desired N, pending M, cache C, empty E)`.

### M02 review fixes (done)
Review found no critical issues; fixed 7 findings here. Major: (1) frustum priority ran in mismatched frames after origin shifts (camera-local planes vs world-frame boxes) — `Renderer` now translates planes with new `toWorldPlanes(origin)`; unit test pins the translation. (2) Queued jobs kept first-sighting priority scores — `recompute` re-scores waiting entries every tick; regression test (surface then +300 m climb, single-flight pool) fails on stale code (`sela:2:5:7:4` vs correct `sela:2:4:7:4`) and passes fixed. Minor: (3) overlay stats no longer parse every key per frame — `ChunkMeshes` keeps incremental `levelCounts` (`meshCounts()`), and `Game` skips stats while F1 is hidden. (4) One failed mesh job no longer aborts boot — per-job catch records `failed` keys for the streamer to retry (plus `main.ts` catch so boot can never black-screen). (5) `failures` map entries expire after the cooldown. (6) `emptyKeys` bounded by `EMPTY_KEY_BUDGET` (2000): non-desired fine (L0/L1) keys age out, coarse kept; re-verify costs one background job. (7) `collectGarbage` filters stale boxes first so cost scales with transitions, not visible x desired. 52 tests pass.

### M03 Gravity and player (done)
Built: `src/sim/physics/` (`gravity.ts` ARCH formula + SOI + dominant-planet rule, `frames.ts` planet-local frames + `upAt`, `rapierWorld.ts` async init + zero-g world per planet, `spawn.ts` density raymarch, `characterController.ts` capsule controller + `moveBasis`/`orientationForUpYaw`, `terrainColliders.ts` 48 m LOD0 ring with freeze/ready states, `system.ts` tick wiring + embedded safety). `src/terrain/` (`sampleGrid.ts` shared sampler, `colliders.ts` pure builder, `workers/colliderWorker.ts`, `colliderPool.ts`). Sim: `PlayerComponent`, `spawnPlayer`/`playerInput`/`playerTeleport` actions. Player-side: `player/input.ts` (per-tick Action sampling), `player/cameraRig.ts` (4 m orbit, 2–8 m zoom, terrain-clamped), `render/views/playerView.ts` (primitive astronaut, tick interpolation with teleport snap). `Game` boots third-person, streams LOD around the active camera, F3 toggles fly (exit drops the player), F1 shows player/grounded/colliders. Tests: gravity, frames, spawn, basis/orientation, flat-floor fall/walk/jump, ring load/drop/empty/failure, full Sela spawn→stand + core float + burial push-out. 86 tests pass.
Run: `npm run dev`, walk with WASD (mouse-look after click), Space jump, wheel zoom; F3 fly into the core, F3 again to drop (floaty jumps); walk into caves; F1 shows `player: ... grounded: yes colliders: N +0 pending`.
Manual acceptance still to verify in-browser: full walk around the planet, 5-minute no-fall soak.

### M03 review fixes (done)
Review found one major performance concern and six smaller issues; all fixed. Major: camera terrain collision now uses direct queries against nearby Rapier LOD0 colliders (`castTerrainRay`) instead of per-frame traversal of all loaded render meshes. Minor: all astronaut materials dispose; stale `world.step()` comment corrected; pure orientation helpers moved to `frames.ts`; deep space reports `ready` instead of freezing on an unloadable chunk; focused `frames`/`spawn` tests added; Rapier import in `system.ts` is type-only. 92 tests pass.

### FIX walk jitter + terrain seams (done)
Camera and avatar shared one interpolated render transform (`PlayerView.interpolatedWorld`), fixing the per-frame disagreement that made walking judder; terrain switched to smooth vertex normals. 96 tests pass.
