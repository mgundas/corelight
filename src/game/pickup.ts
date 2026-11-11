// Aimed-item query (M07): E picks up the loose item the player is looking
// at within PICKUP_RANGE_M. Pure sim-side math (no three.js): the forward
// comes from the player's yaw/pitch, so the client and any future server
// agree on what "looking at" means.

import { PICKUP_RANGE_M } from '../core/constants.js';
import { distance, dot, normalize, sub, type Vec3d } from '../core/math.js';
import type { EntityId } from '../sim/entities.js';
import { moveBasis, upAt } from '../sim/physics/frames.js';
import type { World } from '../sim/world.js';

/** Cosine of the aim cone half-angle (25 degrees off-center still grabs). */
const AIM_COS = Math.cos((25 * Math.PI) / 180);

/** Nearest loose item in range and inside the look cone, if any. */
export function findAimedItem(world: World, playerId: EntityId): EntityId | null {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  if (!player || player.kind !== 'player' || !playerComp) return null;
  const planet = world.planets.find((p) => p.id === player.planetId);
  if (!planet) return null;
  const up = upAt(planet, player.position);
  const { forward } = moveBasis(up, playerComp.yaw, playerComp.pitch);
  let best: EntityId | null = null;
  let bestDist = Infinity;
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'item' || entity.components.item?.holder !== undefined) continue;
    if (entity.planetId !== planet.id) continue;
    const dist = distance(entity.position, player.position);
    if (dist > PICKUP_RANGE_M || dist >= bestDist) continue;
    const to: Vec3d = dist < 1e-6 ? forward : normalize(sub(entity.position, player.position));
    if (dot(to, forward) < AIM_COS) continue;
    best = entity.id;
    bestDist = dist;
  }
  return best;
}
