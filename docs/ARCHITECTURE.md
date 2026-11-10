# Corelight: Architecture

Read this file before every task. The **Hard rules** section is not optional. If a task seems to require breaking a hard rule, stop and explain why in your reply instead of breaking it.

## Stack

| Purpose | Choice |
|---|---|
| Language | TypeScript, `strict: true` |
| Build | Vite |
| Rendering | three (latest) |
| Physics | @dimforge/rapier3d-compat |
| Noise | simplex-noise (with our own seeded RNG) |
| Storage | idb-keyval (IndexedDB) |
| Tests | vitest |
| UI | Plain DOM + CSS modules in `src/ui/`. No React/Vue. |

Do not add other runtime dependencies without adding them to this table in the same commit and explaining why in the commit message.

`package.json` scripts:
- `npm run dev`: Vite dev server
- `npm run build`: production build
- `npm run check`: `tsc --noEmit && vitest run` (must pass before every commit)

## Folder structure

```
src/
  main.ts              entry: boot screen, create Game, start loop
  game/                Game class: owns World, Renderer, input, loop wiring
  core/                math (Vec3d doubles), ids, seeded rng, event bus, constants
  sim/                 GAME STATE AND RULES. No three.js imports here, ever.
    world.ts           World: entities, planets state, time
    entities.ts        entity + component types
    actions.ts         Action union type + applyAction()
    systems/           oxygen, power, crafting, research, items, tethers, shuttle, engine
    physics/           Rapier wrapper, gravity, character controller, colliders
  terrain/             density, noise, marching cubes, chunks, octree LOD, edits
    workers/           Web Worker entry points (meshing, collider data)
  planets/             PlanetConfig type, configs/sela.ts, configs/vorn.ts, solarSystem.ts
  render/              three.js only: scene, floating origin, chunk meshes, atmosphere, sky, lights, entity views
  player/              input mapping, camera rig, terrain tool (turns input into Actions)
  ui/                  HUD, backpack, printer UI, menus, debug overlay
  save/                serialize/deserialize World, IndexedDB
  data/                items.json, recipes.json, research.json (data-driven game content)
  audio/               WebAudio procedural sound effects
tests/                 vitest tests, mirrors src/ structure
```

## Hard rules

1. **`src/sim/` and `src/terrain/` never import three.js.** They may use Rapier (sim/physics only). Rendering reads sim state; it never owns game state. Reason: the same sim code must run on a Node server later for co-op.
2. **All gameplay changes go through Actions.** Input code creates an `Action` object (e.g. `{ type: 'dig', planetId, center, radius }`) and calls `world.dispatch(action)`. Only `applyAction` and systems mutate the World. No direct mutation from UI, render or player code.
3. **Fixed timestep simulation**: 30 ticks per second (`SIM_DT = 1/30`). Rendering runs at display rate and interpolates. Never put gameplay logic in `requestAnimationFrame` code.
4. **Positions are doubles in the sim.** Use `Vec3d` (plain `{x,y,z}` numbers) in sim and terrain. Only `src/render/` converts to three.js float vectors, always relative to the floating origin.
5. **Every entity has a stable string ID** from `core/ids.ts` (`newId(prefix)`), e.g. `tether_8f3k2`. Never use array indexes as references.
6. **Terrain is generated, not stored.** Only edits are stored, as sparse per-chunk diffs. Same seed + same edits = identical terrain.
7. **Heavy work runs in Web Workers**: meshing and collider data. Main thread budget for terrain work: max 4 ms per frame (apply results, upload buffers).
8. **Game content is data**: items, recipes and research live in `src/data/*.json`, validated at load. Adding an item must not need code changes beyond its behavior.
9. **Files stay under ~400 lines.** Split when they grow.
10. **No `any`.** Use `unknown` and narrow.
11. **Every system with logic gets unit tests** in `tests/` (density, edits, action application, oxygen, power, crafting, research, gravity).
12. **Do not break earlier milestones.** Run `npm run check` and the manual test steps of the previous milestone before committing.

## Coordinates and scale

- 1 unit = 1 meter.
- Solar system space: each planet has a fixed `center: Vec3d`. Sela at (0,0,0), Vorn at (12000, 1500, 4000). Planets do not move or rotate in v1.
- The sun is a directional light. Day/night: the sun direction rotates around a fixed axis with a 12 minute period. Both planets share the sun.
- Planet-local coordinates: `local = world - planet.center`. Terrain functions take planet-local positions.

## Floating origin

- `render/floatingOrigin.ts` holds `origin: Vec3d`.
- Every three.js object position = `worldPos - origin` (converted to float).
- When the camera is more than 1000 m from the origin, set `origin = cameraWorldPos` (rounded to chunk size) and shift every object. Emit `originShifted` event.
- Rapier also uses a local frame per planet: physics bodies near a planet live in that planet's local frame. In space (outside any sphere of influence), the shuttle uses a space physics frame centered on itself. Switching frames is handled in `sim/physics/frames.ts`.

## Terrain

### Density function

`density(planet, localPos) -> number`. Positive = solid, negative = air. Surface at 0.

```
r = length(localPos)
depth = planet.radius - r
d = depth + surfaceNoise(dir) * planet.surfaceAmplitude        // fbm on the unit direction, amplitude ~15 m
d = carveCaves(d, localPos, depth)                              // see below
d = carveCaverns(d, localPos, depth)                           // cavern floors: open rooms + walkable floors, slab rock between
d = min(d, r - planet.core.chamberRadius)                       // hollow core chamber
d += editDelta(localPos)                                        // player edits
```

- Caves: two 3D simplex "worm" fields, `c = abs(n1(p*f)) + abs(n2(p*f))`; carve where `c < caveThreshold(depth)` (unconditional `min`, so wall crossings sit mid-cell). No caves in the top 6 m (keeps the surface solid), threshold grows with depth, no caves inside the core shell.
- Cavern floors: room/slab bands on a depth cycle derived from planet size (`cavernStack`: Sela gets 6 floors of ~30 m rooms separated by ~24 m slabs). Rooms are hollowed with walkable noise-relief floors and capped pit bowls (pits can never breach a slab); slabs stay solid except where worms pierce them (widened inside slabs, so floors get irregular diggable openings). Same deterministic density field: same seed = identical floors.
- Layer at a point = from `depth` using `planet.layers`. Layer gives hardness and color.
- Vertex color = layer color blended with a small noise variation. Surface top uses `planet.surfaceColors` (grass/dirt by slope).
- The density function must be pure and deterministic (seeded noise). It runs in workers.

### Chunks and LOD

- Chunk = 32 x 32 x 32 cells, sampled on a 33 x 33 x 33 grid (+1 border sample each side for normals: 35^3 samples).
- LOD level `n`: cell size = `2^n` meters, chunk size = `32 * 2^n` m.
- Octree root per planet covers a cube of side `32 * 2^maxLevel` that contains the whole planet. Sela: maxLevel 5 (1024 m). Vorn: maxLevel 5.
- Split rule: a node splits if `distance(camera, nodeCenter) < node.size * LOD_SPLIT_FACTOR` (start with 1.5) and `level > 0`.
- Skip nodes that are fully solid or fully air (check density at corners plus center with a margin; the worker reports empty meshes, cache that result).
- Seams between LOD levels: add skirts (extend boundary triangles downward along the inverse normal by `cellSize`). Accept minor visual overlap.
- Meshing: marching cubes in a worker pool (`navigator.hardwareConcurrency - 1`, min 2, max 6). Output: positions (Float32 planet-local relative to chunk origin), normals, colors, indices.
- Priority queue: chunks closest to the camera and in front of it first.
- Cache meshes per chunk key `planetId:level:x:y:z`; LRU evict when over budget (start: 1500 chunks).
- At game start, pre-generate levels 5 to 3 for both planets behind the boot screen. This is the only loading screen.

### Edits

- `TerrainEdits` stores per LOD0 chunk a `Map<sampleIndex, delta>` (Float32 deltas, clamped to [-4, 4]).
- A dig action applies a smooth spherical falloff: `delta -= strength * (1 - dist/radius)^2`. Add is the reverse. Flatten moves density toward a plane defined at the start of the stroke.
- Edits only apply where `layer.hardness <= tool.hardness`. Soil gained = volume removed (approx count of samples crossing 0).
- After an edit: remesh the affected LOD0 chunks and neighbors sharing border samples, and LOD1 parents (LOD1 samples LOD0 edits by averaging). Higher LODs ignore edits.
- Edits are part of the save file and (later) the network protocol.

## Physics and gravity

- Rapier world per active planet frame. Terrain colliders: trimesh colliders built for LOD0 chunks within 48 m of the player (and the shuttle when landed/flying low). Built from worker output, not from three.js geometry.
- Gravity: direction = toward planet center. Magnitude `g = planet.gravity * clamp(r / (0.5 * planet.radius), 0.15, 1.0)`. Inside the core chamber this gives low gravity.
- Sphere of influence = `3 * planet.radius`. Outside every SOI, gravity is zero.
- Character controller: Rapier `KinematicCharacterController` with a capsule. Its "up" is the direction away from the planet center, updated every tick. The player body is rotated so its local up matches.
- Items and machines are dynamic bodies with custom gravity applied each tick (Rapier global gravity is zero; we apply forces ourselves).

## Simulation model

```ts
type EntityId = string;
interface Entity {
  id: EntityId;
  kind: 'player' | 'item' | 'tether' | 'machine' | 'platform' | 'shuttle' | 'node' | 'sample' | 'engine' | 'lightstick';
  planetId: string | null;     // null when in space
  position: Vec3d;             // world space doubles
  rotation: Quat;              // plain {x,y,z,w}
  components: Partial<Components>;  // oxygen, inventory, power, printer, furnace, etc.
}
```

- `World` holds `entities: Map<EntityId, Entity>`, `terrainEdits`, `research`, `time`, `seed`.
- `World.dispatch(action)` queues actions; `World.tick()` applies queued actions then runs systems in a fixed order: physics, items, tethers, oxygen, power, machines, research, shuttle, engine.
- Systems are functions `(world: World, dt: number) => void`.
- Events (for audio, UI, render) go out through `core/events.ts`. The sim never calls UI or render code directly.

## Rendering

- `Renderer` subscribes to world state each frame and keeps a `Map<EntityId, Object3D>` of views.
- Materials: `MeshStandardMaterial` with `vertexColors: true`. Terrain uses smooth shading (`flatShading: false`) so the worker-computed vertex normals soften facets and LOD-boundary steps; entity views keep their own flat-shaded low-poly materials. Fog color matches the sky.
- Lighting underground: ambient intensity scales with depth below the surface (1.0 at surface, 0.08 below 25 m). Headlamp = SpotLight attached to the camera. Light sticks and lumen crystals = PointLights, at most 12 active, nearest first.
- Atmosphere: back-side sphere shell at `1.25 * radius` with a simple scattering-style gradient shader. Sky color fades to black as altitude rises, stars appear in space.
- Logarithmic depth buffer on (needed for space to ground scale).

## Saving

- `save/serialize.ts` converts World to a plain JSON-able object (entities, edits as base64 Float32 per chunk, research, time, seed, version).
- Autosave every 60 s and on page unload to IndexedDB key `corelight-save-v1`.
- The save format is versioned. Add a migration function when the format changes.
- The same serialized shapes will later be used for network snapshots.

## Debug tools (keep them working in every milestone)

- F1: overlay with FPS, tick time, planet, depth, layer, LOD chunk counts, worker queue length, draw calls, player world position, current origin.
- F3: free-fly camera (fast, no collision, scroll to change speed).
- F4: wireframe toggle. F5: show chunk bounds.
- URL `?seed=123` overrides the world seed. `?skipBoot=1` skips pre-generation for fast iteration (low detail far away is fine).
