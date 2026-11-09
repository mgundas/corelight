# M04: Terrain tool (dig, add, flatten)

## Goal
The signature mechanic: a terrain tool that smoothly digs, adds and flattens the ground, with updates fast enough to feel instant, colliders that update correctly, and hardness limits per layer.

## Tasks
1. `src/terrain/edits.ts`: `TerrainEdits` class as described in ARCHITECTURE.md (sparse per LOD0 chunk deltas). Methods: `applySphere(planetId, center, radius, strength, mode)`, `getDelta(planetId, chunkKey)`, `serialize()`, `deserialize()`. Returns the list of affected chunk keys. Unit tested.
2. Workers receive the relevant edit deltas for the chunk they mesh (send only the chunk's delta buffer, or a version number plus a shared edits snapshot). LOD1 meshing averages LOD0 edits. Higher levels ignore edits.
3. Actions: `{ type: 'terrainEdit', playerId, planetId, mode: 'dig' | 'add' | 'flatten', center, radius, strength, flattenPlane? }`. Applied in `applyAction`. Hardness check: samples whose layer hardness is above the tool's hardness are not changed. Dig adds to the player's soil counter (max 200), add consumes soil and fails when soil is empty.
4. `src/player/terrainTool.ts`: raycast from the camera to the terrain (use the Rapier colliders, fall back to density raymarching), show a translucent sphere at the hit point. Left mouse = dig, right mouse = add, F or middle mouse = flatten (the flatten plane is captured at stroke start from the hit normal). Hold to keep editing at 10 edits per second. Scroll while holding Ctrl changes radius (1 to 4 m). Range 6 m.
5. Remeshing priority: edited chunks jump to the front of the queue. Target: the visual update appears within 2 frames on a mid-range PC. Keep the old mesh until the new one is ready.
6. Colliders: update colliders of edited chunks in the same tick the new data arrives. The player must not fall into freshly dug holes before collider updates (the controller should treat missing/updating colliders as solid for 1 frame).
7. Drill tiers: a `toolHardness` value on the player (Mk1 = 2). Show a brief "Too hard" indicator when digging rock that is too hard.
8. Debug: F1 overlay shows the layer and hardness under the tool cursor and the soil counter.
9. Tests: edits determinism (same edits produce the same density), hardness rule, soil accounting.

## Out of scope
Saving edits (M06), resources inside rock (M07).

## Acceptance criteria
- `npm run check` passes.
- You can dig a tunnel straight down, walk into it, and keep digging until you hit the mantle (too hard for Mk1).
- You can build a hill with the add mode and walk on it.
- Flatten makes a usable flat area on a slope.
- No visible cracks or holes appear at chunk borders after editing.
- Digging continuously for 30 s does not drop FPS below 30.

## Finish
Update `docs/PROGRESS.md`. Commit: `M04: terrain tool`.
