# M13: Second planet and seamless space

## Goal
Add Vorn and make the solar system seamless: both planets visible from each other, travel between them with the free-fly camera without any loading screen, correct precision far from the origin, and correct gravity handoff. The shuttle comes in M14; this milestone proves the world and rendering side.

## Tasks
1. `src/planets/configs/vorn.ts` with the values from PROJECT.md (radius 320, ice theme, dense caves, layer depths, cold surface hazard 1.5x, mantle hardness 4, core chamber 32 m). Add Vorn-only resources: Hydrite ice nodes on the surface, Voidstone in the mantle. No Biomass on Vorn.
2. `src/planets/solarSystem.ts`: list of planets with centers from ARCHITECTURE.md. Everything that used "the planet" must now use "the planet for this position" (dominant SOI) or iterate all planets. Search the code for any remaining single-planet assumptions and remove them.
3. Chunk manager: one octree per planet. The planet the camera is in (or nearest to) gets full LOD streaming; other planets are limited to levels `lodMaxLevel` to `lodMaxLevel - 2` (from boot pre-generation). Keep the worker queue fair so the far planet never starves the near one.
4. Floating origin under stress: flying from Sela to Vorn (about 12.7 km) must have no jitter on the player, items or terrain. Verify origin shifts happen and all views follow (including shadows, lights, atmosphere shells, cables).
5. Physics frames (`src/sim/physics/frames.ts`): bodies near a planet live in that planet's local Rapier frame; moving into another SOI transfers them (position, velocity, rotation) to the new frame. Out of all SOIs, entities go to a space frame. Unit test the transfer math.
6. Rendering: both atmospheres, Vorn's colors, sky transitions when approaching a different planet, the sun lights both. Space between planets shows stars and the sun.
7. Debug: F1 shows dominant planet, SOI distance, physics frame. Add a debug action (only with `?dev=1`) to teleport the player to Vorn's surface.
8. Save: entities on Vorn and edits on Vorn are saved; edits are already keyed by planet id.

## Out of scope
Shuttle, Vorn base building beyond what already works generically.

## Acceptance criteria
- `npm run check` passes.
- From Sela's surface at night you can see Vorn as a small lit sphere in the sky.
- With F3 you can fly from Sela's surface to Vorn's surface and into its caves in one continuous flight, no loading screen, no holes, no jitter.
- Dropping the player on Vorn with F3: walking, digging, oxygen (with cold multiplier), tethers and items work there.
- FPS while in space looking at both planets stays above 50 on a mid-range PC.

## Finish
Update `docs/PROGRESS.md`. Commit: `M13: second planet and seamless space`.
