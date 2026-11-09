# M03: Spherical gravity and the player

## Goal
A third-person astronaut who walks all the way around the planet, into caves and down into the low-gravity core chamber, with correct spherical gravity and solid terrain collision.

## Tasks
1. `src/sim/physics/rapierWorld.ts`: initialize Rapier (async `init()` before the game starts), one Rapier world per active planet frame, global gravity set to zero.
2. `src/sim/physics/gravity.ts`: `gravityAt(planets, worldPos)` returning the gravity vector and the dominant planet, using the formula and sphere of influence rule in ARCHITECTURE.md. Unit tested (direction points to center, magnitude reduced in the core, zero outside SOI).
3. `src/terrain/workers/`: extend the mesh worker (or add a collider worker) to output collider data (vertices and indices, planet-local) for LOD0 chunks.
4. `src/sim/physics/terrainColliders.ts`: keeps trimesh colliders for LOD0 chunks within 48 m of the player. Requests collider data for missing chunks, removes far ones. Must not depend on render meshes.
5. The player entity:
   - Created at game start on Sela's surface at a spot found by raymarching the density from space down to the surface.
   - `src/sim/physics/characterController.ts`: Rapier kinematic character controller with a capsule (height 1.8 m, radius 0.35 m). Up = away from planet center. Supports walking, sprinting, jumping, sliding on steep slopes (max climb angle 50 degrees), step offset 0.3 m, snap to ground.
   - Movement input arrives as an Action each tick (`{ type: 'playerInput', playerId, move: {x,z}, jump, sprint, lookYaw, lookPitch }`), so this works for co-op later.
   - Falling far (more than 30 m) does no damage in v1.
   - Safety: if the player is ever inside solid terrain (density > 0.5 at the capsule center) for more than 1 s, push them out along the gradient. If colliders are not loaded yet under the player, freeze the player instead of letting them fall.
6. `src/player/cameraRig.ts`: third-person orbit camera (distance 4 m, scroll zoom 2 to 8 m), aligned to the local up vector, collides with terrain using a short raycast so it does not clip through cave walls. F3 still toggles the free-fly camera.
7. `src/render/views/playerView.ts`: placeholder low-poly astronaut (capsule body, round helmet with a visor, small backpack) built from three.js primitives, with interpolation between sim ticks.
8. `src/player/input.ts`: keyboard/mouse state mapped to the playerInput action; pointer lock on click.
9. Chunk streaming (M02) follows the active camera.

## Out of scope
Terrain editing, resources, UI besides debug.

## Acceptance criteria
- `npm run check` passes.
- You can walk in a straight line all the way around the planet and arrive back where you started, always standing upright.
- You can walk into a natural cave and back out.
- Using F3 to fly into the core chamber and pressing F3 again to drop the player there: gravity is noticeably low and jumps are floaty.
- The player never falls through the terrain during 5 minutes of play.

## Finish
Update `docs/PROGRESS.md`. Commit: `M03: spherical gravity and player`.
