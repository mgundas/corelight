// Cursor picking for placed structures (click-to-move). A click with the
// tool stowed packs an empty machine/platform and enters placement mode, so
// the player can re-place it elsewhere. Pure ray/sphere test; the sim action
// re-validates emptiness and range.

import { STATION_RANGE_M } from '../core/constants.js';
import { distance, dot, sub, type Vec3d } from '../core/math.js';
import type { EntityId } from '../sim/entities.js';
import { isEntityEmpty, isPackableEntity } from '../sim/packActions.js';
import type { World } from '../sim/world.js';
import type { WorldRay } from './grabPick.js';

/** Nearest empty machine/platform under the cursor within station range. */
export function findPackableAlongRay(
  world: World,
  playerId: EntityId,
  ray: WorldRay,
  maxDist = STATION_RANGE_M + 8,
): EntityId | null {
  const player = world.entities.get(playerId);
  if (!player?.planetId) return null;
  const pickRadius = 0.8;
  let best: EntityId | null = null;
  let bestT = Infinity;
  for (const entity of world.entities.values()) {
    if (entity.planetId !== player.planetId || !isPackableEntity(entity)) continue;
    if (!isEntityEmpty(world, entity)) continue;
    if (distance(entity.position, player.position) > STATION_RANGE_M) continue;
    const to = sub(entity.position, ray.origin);
    const t = dot(to, ray.dir);
    if (t < 0 || t > maxDist || t >= bestT) continue;
    const closest: Vec3d = {
      x: ray.origin.x + ray.dir.x * t,
      y: ray.origin.y + ray.dir.y * t,
      z: ray.origin.z + ray.dir.z * t,
    };
    if (distance(closest, entity.position) > pickRadius) continue;
    best = entity.id;
    bestT = t;
  }
  return best;
}
