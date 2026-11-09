# Corelight: Progress Log

The coding agent updates this file at the end of every milestone. Keep it short: future sessions read it to know what exists.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M00 Scaffold | done | Vite + TS strict scaffold, fixed-timestep loop, debug overlay, free-fly camera |
| M01 Density and meshing | not started | |
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
