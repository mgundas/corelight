# M01: Planet density field and marching cubes

## Goal
Generate real planet terrain: a deterministic density function with surface noise, caves, layers and a hollow core, meshed with marching cubes inside a Web Worker. In this milestone we mesh a fixed set of chunks (no LOD yet) so we can see and verify the shape.

## Tasks
1. `src/planets/PlanetConfig.ts`: type with `id`, `name`, `seed`, `center`, `radius`, `gravity`, `surfaceAmplitude`, `surfaceFrequency`, `cave` settings (frequency, threshold at top, threshold at bottom, start depth), `layers` (name, fromDepth, toDepth, hardness, color, colorVariation), `core` (chamberRadius, shellThickness, shellHardness, chamberColor), `surfaceColors` (flat, steep), `atmosphere` (colors, height) and `lodMaxLevel`.
2. `src/planets/configs/sela.ts` with the values from `docs/PROJECT.md` (radius 400, Sela colors). Leave Vorn for M13 but make sure nothing assumes a single planet.
3. `src/terrain/noise.ts`: seeded 3D simplex + fbm helpers (octaves, lacunarity, gain). Seeded from planet seed + world seed.
4. `src/terrain/density.ts`: `createDensityFn(config)` returning `(x, y, z) => number` in planet-local coordinates, exactly following the Density function section in ARCHITECTURE.md. Also `layerAt(config, localPos)` returning the layer (including core shell and core chamber pseudo-layers) and `colorAt(...)`.
5. `src/terrain/marchingCubes.ts`: standard marching cubes with the full edge and triangle tables, linear vertex interpolation, normals from the density gradient (central differences using the border samples), vertex colors from `colorAt`. Input: a `Float32Array` of 35^3 samples. Output: `{ positions, normals, colors, indices }` typed arrays. Weld shared vertices per chunk (edge-indexed cache).
6. `src/terrain/chunkKey.ts`: chunk key helpers (`planetId:level:x:y:z`), chunk origin/size from level.
7. `src/terrain/workers/meshWorker.ts`: receives `{ planetConfig, worldSeed, level, chunkCoord }`, samples density, runs marching cubes, posts the mesh back with transferable buffers. Reports `empty: true` when no triangles.
8. `src/terrain/workerPool.ts`: simple pool (size per ARCHITECTURE.md) with a job queue and promise-based API.
9. `src/render/chunkMeshes.ts`: creates `THREE.Mesh` per result with `MeshStandardMaterial({ vertexColors: true, flatShading: true })`, positioned via the floating origin.
10. Temporary test scene: replace the placeholder sphere with all level-3 chunks (8 m cells) of Sela that intersect the planet surface shell, plus all level-1 chunks in a 128 m cube around a point on the surface. This is temporary and will be replaced in M02.
11. Tests: `tests/terrain/density.test.ts`: deterministic for the same seed; solid at depth 50 below a surface point outside caves is not guaranteed, so instead test: density at radius + 100 is negative, density at the planet center is negative (core chamber), density in the core shell is positive, layer at depth 10 is surface, at depth 80 is crust, at depth 200 is mantle. `tests/terrain/marchingCubes.test.ts`: a sphere SDF produces a closed mesh with vertices near the expected radius.

## Out of scope
LOD, streaming, physics, editing.

## Acceptance criteria
- `npm run check` passes.
- With the F3 camera you can see a bumpy spherical planet from space, fly to the detailed area and into cave openings, and see different layer colors on cave walls.
- Using F3 you can fly down into the planet center and see a hollow core chamber.
- Meshing happens in workers; the main thread does not freeze while chunks load (FPS stays above 30 in the overlay during loading on a mid-range PC).

## Finish
Update `docs/PROGRESS.md` (M01 done, notes on files and how the density works). Commit: `M01: density field and marching cubes`.
