import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, SHUTTLE_EXIT_SEARCH_M, TERRAIN_QUERY_STEP_M, SPAWN_HOVER_M } from '../core/constants.js';
import { add, scale, sub, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { createDensityField } from '../terrain/density.js';
import { moveBasis, upAt } from './physics/frames.js';
import { seatAheadOnGround } from './tetherActions.js';
import type { World } from './world.js';

/** Ground seating returns a feet position; a player entity is a capsule
 * centre. Check the whole capsule against live terrain before releasing it. */
export function shuttleExitPosition(world: World, planet: PlanetConfig, position: Vec3d, yaw: number, ahead: number): Vec3d | null {
  const ground = seatAheadOnGround(world, planet, position, yaw, ahead);
  const up = upAt(planet, ground);
  const { forward, right } = moveBasis(up, yaw, 0);
  const field = createDensityField(planet, world.seed, (x, y, z) => world.terrainEdits.deltaAt(planet, planet.id, x, y, z));
  // Sampling the bounding rings is conservative at the rounded capsule ends.
  const offsets: Vec3d[] = [];
  for (const height of [-PLAYER_HALF_HEIGHT - PLAYER_RADIUS, -PLAYER_HALF_HEIGHT, 0, PLAYER_HALF_HEIGHT, PLAYER_HALF_HEIGHT + PLAYER_RADIUS]) {
    const centre = scale(up, height);
    offsets.push(centre);
    for (const axis of [forward, right]) for (const sign of [-1, 1]) offsets.push(add(centre, scale(axis, sign * PLAYER_RADIUS)));
  }
  for (let lift = SPAWN_HOVER_M; lift <= SHUTTLE_EXIT_SEARCH_M; lift += TERRAIN_QUERY_STEP_M) {
    const candidate = add(ground, scale(up, lift));
    const local = sub(candidate, planet.center);
    if (offsets.every((offset) => {
      const p = add(local, offset);
      return field.density(p.x, p.y, p.z) < 0;
    })) return candidate;
  }
  return null;
}
