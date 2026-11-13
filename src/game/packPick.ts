// Cursor picking for placed structures (click-to-move). A click with the
// tool stowed packs an empty machine/platform and enters placement mode, so
// the player can re-place it elsewhere. Pure ray/sphere test; the sim action
// re-validates emptiness and range.

import { STATION_RANGE_M, STRUCTURE_PICK_MARGIN_M } from '../core/constants.js';
import { distance, dot, rotateVector, sub, type Vec3d } from '../core/math.js';
import type { Entity, EntityId } from '../sim/entities.js';
import { isEntityEmpty, isPackableEntity } from '../sim/packActions.js';
import { defForEntity } from '../sim/snapUtils.js';
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

/** Pick the whole catalog-sized body, independent of player facing and camera zoom. */
export function findStructureAlongRay(
  world: World,
  playerId: EntityId,
  ray: WorldRay,
  range: number,
  accepts: (entity: Entity) => boolean,
  maxDist = Infinity,
): EntityId | null {
  const player = world.entities.get(playerId);
  if (!player?.planetId) return null;
  let best: EntityId | null = null;
  let bestT = Infinity;
  for (const entity of world.entities.values()) {
    if (entity.planetId !== player.planetId || !accepts(entity)) continue;
    if (distance(entity.position, player.position) > range) continue;
    const def = defForEntity(entity);
    if (!def) continue;
    // Transform the ray into the building's frame so walls, roofs and bases
    // remain selectable on either planet and on rotated platforms.
    const q = entity.rotation;
    const inverse = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const origin = rotateVector(sub(ray.origin, entity.position), inverse);
    const dir = rotateVector(ray.dir, inverse);
    const margin = STRUCTURE_PICK_MARGIN_M;
    const radius = def.footprintRadiusM + margin;
    let near = 0;
    let far = maxDist;
    for (const axis of ['x', 'y', 'z'] as const) {
      const min = axis === 'y' ? -margin : -radius;
      const max = axis === 'y' ? def.heightM + margin : radius;
      if (Math.abs(dir[axis]) < 1e-9) {
        if (origin[axis] < min || origin[axis] > max) far = -1;
        continue;
      }
      const a = (min - origin[axis]) / dir[axis];
      const b = (max - origin[axis]) / dir[axis];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (near > far || near >= bestT) continue;
    best = entity.id;
    bestT = near;
  }
  return best;
}
