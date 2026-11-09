# M02: Chunk streaming and octree LOD

## Goal
Replace the temporary chunk set from M01 with a real streaming octree LOD so that the whole planet is visible from space, and full 1 m detail appears around the camera wherever it goes, including deep inside caves and the core.

## Tasks
1. `src/terrain/octree.ts`: per-planet octree. Root covers a cube of side `32 * 2^lodMaxLevel` centered on the planet. `update(cameraLocalPos)` decides the set of leaf nodes using the split rule in ARCHITECTURE.md. Pure logic, no three.js, unit tested.
2. Empty-node skipping: before queueing a mesh job, cheaply test if a node is certainly all solid or all air (sample corners + center, compare against `|density| > node diagonal`). Cache the worker's `empty` results per key.
3. `src/terrain/chunkManager.ts`:
   - Diffs the desired leaf set against the current set each frame (or every 100 ms).
   - Queues mesh jobs in a priority queue: distance to camera, with a bonus for chunks inside the view frustum.
   - Never removes a parent's mesh until all its children are ready (and the reverse when merging), so there are no holes during transitions.
   - Applies at most a time budget of 4 ms per frame of results to the scene.
   - LRU mesh cache with the budget from ARCHITECTURE.md; dispose geometries on eviction.
4. Skirts: add to `marchingCubes.ts` an option to generate skirts on the chunk boundary faces to hide LOD cracks, as described in ARCHITECTURE.md.
5. Boot pre-generation: `src/game/boot.ts` shows a simple boot screen (title "Corelight", progress bar) and pre-generates LOD levels `lodMaxLevel` down to `lodMaxLevel - 2` for every planet, then starts the game. `?skipBoot=1` skips it.
6. Debug: F5 toggles chunk bounding boxes colored by LOD level. The F1 overlay shows chunk counts per level, pending jobs and cache size.
7. Tests: `tests/terrain/octree.test.ts` (camera far away gives only coarse leaves; camera at surface gives level-0 leaves near it; leaf set covers the root with no overlaps).

## Out of scope
Physics, player, editing.

## Acceptance criteria
- `npm run check` passes.
- From 3 km away the whole planet is visible as a coarse mesh. Flying in with F3 at high speed, detail refines without holes and without freezing.
- At the surface, terrain within about 50 m uses 1 m cells (check with F5).
- Flying through caves down to the core keeps full detail around the camera.
- Memory stays stable while flying around for several minutes (cache evicts).

## Finish
Update `docs/PROGRESS.md`. Commit: `M02: chunk streaming and octree LOD`.
