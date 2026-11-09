# M14: Fuel refinery and the shuttle

## Goal
Real travel between planets: craft fuel, build a shuttle, launch, fly through space and land anywhere on the other planet.

## Tasks
1. Fuel refinery machine: 2 Biomass or 1 Hydrite into 1 Fuel cell, 15 s, 3 power/s.
2. Shuttle placeable (from the medium printer): placed on a platform or flat ground. Two fuel slots on its side. Low-poly model: small capsule cockpit, two side thrusters, landing legs.
3. Enter/exit: E near the shuttle enters it (the player entity is attached to the shuttle; it keeps oxygen at full while inside). E again exits, only when landed (speed under 1 m/s).
4. Launch: Space held for 2 s with 2 Fuel cells loaded consumes them and launches the shuttle into a stable climb.
5. Flight model (`src/sim/systems/shuttle.ts`): arcade-style, not realistic orbital mechanics.
   - Inside an SOI: gravity applies; W/S thrust forward/back, A/D yaw, mouse pitch/yaw, Space up, Shift boost. Max speed 120 m/s near the surface, scaling up with altitude.
   - In space: no gravity, max speed 600 m/s with Shift, so the trip takes about 30 to 60 s.
   - Auto-orient: when entering an SOI, the shuttle gently rotates so "down" points toward the planet.
   - A landing assist: below 40 m altitude, speed is clamped and the shuttle levels itself; touching down with legs below 6 m/s is a safe landing, faster bounces it (no damage in v1).
   - All flight input goes through actions (`shuttleInput`), so co-op works later.
6. Shuttle collision: dynamic body with a compound collider; terrain colliders also load around the shuttle while it is low.
7. Camera: chase camera behind the shuttle; free-look with the right mouse button.
8. HUD in flight: speed, altitude above the dominant planet, a marker for each planet with distance, and a marker for each habitat/base.
9. Habitat kit: a placeable that creates a new habitat (oxygen source) wherever placed, for starting a base on Vorn. The respawn point becomes the last habitat the player was near.
10. Tests: fuel consumption and launch rule; SOI transfer during flight works (reuse M13 frame tests).

## Out of scope
Damage, crashes, orbital mechanics, autopilot.

## Acceptance criteria
- `npm run check` passes.
- Full trip without debug tools: refine fuel, build the shuttle, launch from Sela, fly to Vorn, land anywhere, place a habitat kit, survive on Vorn.
- Return trip works with fuel made from Hydrite on Vorn.
- No loading screens and no jitter during the trip.

## Finish
Update `docs/PROGRESS.md`. Commit: `M14: shuttle`.
