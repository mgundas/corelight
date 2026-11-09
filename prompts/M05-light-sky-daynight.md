# M05: Lighting, sky, atmosphere and day/night

## Goal
Make the planet look good and make caves feel dark and dangerous: a moving sun, an atmosphere that fades to space, depth-based darkness underground, a headlamp, and fog.

## Tasks
1. `src/sim/systems/sun.ts`: sun direction as part of World state, rotating around a fixed tilted axis with a 12 minute period. Expose `sunDirection(world)` and `isDaylight(world, planetId, localPos)` (sun above the local horizon). Unit tested.
2. `src/render/lighting.ts`:
   - Directional sun light following the sun direction, warm color at low angles, white at noon.
   - Shadows: one shadow-casting cascade only around the player (64 m frustum), following the player and snapped to texel size to avoid shimmering. Terrain chunks at LOD0 and LOD1 cast and receive shadows; others do not.
   - Hemisphere/ambient light whose intensity scales with depth below the local surface: 1.0 at the surface, smoothly to 0.08 at 25 m below. Compute "depth below surface" in the sim as `planet.radius + surfaceNoise(dir) - r`, not with raycasts.
   - Headlamp: SpotLight attached to the camera rig, toggled with L via an action (`toggleHeadlamp`) so it is part of the player state.
3. `src/render/atmosphere.ts`: atmosphere shell (back-side sphere at 1.25 x radius) with a gradient shader using the planet's `atmosphere` colors, brighter on the sunlit side, a rim glow when seen from space.
4. `src/render/sky.ts`: sky dome/background color driven by altitude and sun angle (day blue, sunset orange, night dark blue, space black). A star field (points on a large sphere) that fades in at night and in space. A simple sun disc.
5. Fog: `THREE.FogExp2` matched to the sky color at the surface, darker and denser in caves, nearly zero in space.
6. Day/night affects nothing in gameplay yet except light; solar power comes in M10.
7. Debug: F1 shows time of day and "depth below surface". Add `?time=0.5` URL param to start at a chosen time of day (0 to 1).

## Out of scope
Light sticks (M09), crystal lights (M07).

## Acceptance criteria
- `npm run check` passes.
- Watching a full day cycle shows sunrise, day, sunset and night with smooth transitions.
- Walking into a cave becomes dark within about 20 m of depth; the headlamp makes it navigable.
- From space the planet has a visible atmosphere glow and the sky is black with stars.
- Shadows do not shimmer when walking.
- FPS impact of this milestone is less than 15 percent compared to M04 (state the before/after numbers you measured).

## Finish
Update `docs/PROGRESS.md`. Commit: `M05: lighting, sky and day/night`.
