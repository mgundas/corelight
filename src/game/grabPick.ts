// Cursor picking for grab-carry: a pure ray/sphere test against loose items
// (no three.js). The ray comes from the renderer's screen ray; the sim-side
// grab action re-validates range and ownership.

import { GRAB_RANGE_M, ITEM_BODY_RADIUS } from '../core/constants.js';
import { distance, dot, sub, type Vec3d } from '../core/math.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';

export interface WorldRay {
  origin: Vec3d;
  dir: Vec3d;
}

/** Nearest loose item under the cursor within grab range, if any. */
export function findItemAlongRay(
  world: World,
  playerId: EntityId,
  ray: WorldRay,
  maxDist = GRAB_RANGE_M + 12,
): EntityId | null {
  const player = world.entities.get(playerId);
  if (!player?.planetId) return null;
  const pickRadius = ITEM_BODY_RADIUS + 0.2;
  let best: EntityId | null = null;
  let bestT = Infinity;
  for (const entity of world.entities.values()) {
    const item = entity.components.item;
    if (entity.kind !== 'item' || !item || item.holder !== undefined || item.grabbedBy !== undefined) continue;
    if (entity.planetId !== player.planetId) continue;
    if (distance(entity.position, player.position) > GRAB_RANGE_M) continue;
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
