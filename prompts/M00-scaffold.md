# M00: Project scaffold

## Goal
Create the empty but correctly structured project: build tooling, folder layout, fixed-timestep loop, Action system skeleton, floating origin, and debug overlay. Nothing playable yet, but every later milestone builds on this, so the structure must match `docs/ARCHITECTURE.md` exactly.

## Tasks
1. Initialize a Vite + TypeScript project in the repo root (not in a subfolder). `tsconfig` with `strict: true`, `noUncheckedIndexedAccess: true`.
2. Install: `three`, `@types/three`, `@dimforge/rapier3d-compat`, `simplex-noise`, `idb-keyval`, `vitest`.
3. Add scripts `dev`, `build`, `check` (`tsc --noEmit && vitest run`).
4. Create the folder structure from ARCHITECTURE.md as you add files to it. Do not create empty placeholder files just for show.
5. `src/core/`:
   - `math.ts`: `Vec3d` and `Quat` types and functions (add, sub, scale, length, normalize, dot, cross, lerp, quat from axis-angle, quat multiply, rotate vector). Plain objects, doubles.
   - `ids.ts`: `newId(prefix)` producing short unique IDs, plus a deterministic variant seeded for tests.
   - `rng.ts`: seeded RNG (mulberry32 or similar) and `hashSeed(string|number)`.
   - `events.ts`: tiny typed event bus.
   - `constants.ts`: `SIM_DT = 1/30`, `ORIGIN_SHIFT_DISTANCE = 1000`, etc.
6. `src/sim/`:
   - `entities.ts`: `Entity` and component types as in ARCHITECTURE.md (components can be mostly empty interfaces for now).
   - `actions.ts`: `Action` discriminated union (start with `{ type: 'noop' }` and `{ type: 'debugSpawnMarker', position }`), and `applyAction(world, action)`.
   - `world.ts`: `World` class with `entities`, `time`, `seed`, `dispatch()`, `tick()` that applies queued actions then runs a list of systems.
7. `src/game/Game.ts`: owns World and Renderer, runs a fixed-timestep accumulator loop (sim at 30 Hz, render every frame with `alpha` for interpolation). Cap catch-up at 5 ticks per frame.
8. `src/render/`:
   - `Renderer.ts`: three.js WebGLRenderer with `logarithmicDepthBuffer: true`, a scene, a perspective camera (near 0.1, far 200000), resize handling.
   - `floatingOrigin.ts`: as described in ARCHITECTURE.md, with a `toLocal(worldPos)` helper and shift logic + event.
   - Render a placeholder: a 400 m radius low-poly icosphere at world (0,0,0), lit by a directional light, so we can see the scale.
9. `src/ui/debugOverlay.ts`: F1 toggles an overlay showing FPS, sim tick time (ms), camera world position, current origin, draw calls.
10. `src/player/freeFlyCamera.ts`: F3 free-fly camera (WASD + mouse with pointer lock, Q/E down/up, scroll changes speed from 1 to 2000 m/s). For now it is the only camera and is on by default.
11. URL params: `?seed=` and `?skipBoot=` parsed in `src/core/urlParams.ts`.
12. Tests: `tests/core/math.test.ts`, `tests/core/rng.test.ts` (same seed gives same sequence), `tests/sim/world.test.ts` (dispatching an action and ticking applies it; systems run in order).
13. Create `.gitignore` (node_modules, dist). `git init` if no repo exists and make the first commit.

## Out of scope
Terrain, physics, gameplay, UI beyond the debug overlay.

## Acceptance criteria
- `npm run check` passes.
- `npm run dev` shows the sphere; you can fly around it with F3 camera controls; F1 shows the overlay.
- Flying more than 1000 m from the start triggers an origin shift (visible in the overlay) with no visible jump.
- `src/sim/` contains no import from `three` (verify with grep and state the result).

## Finish
Update `docs/PROGRESS.md`: set M00 to done and add a short note with how to run the project. Commit: `M00: project scaffold`.
