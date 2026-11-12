// Aimed-item query (M07): E picks up the loose item the player is looking
// at within PICKUP_RANGE_M. M08 adds tether posts to the same cone: E on a
// post pulls it back up (removeTether). Pure sim-side math (no three.js):
// the forward comes from the player's yaw/pitch, so the client and any
// future server agree on what "looking at" means.

import { PICKUP_RANGE_M, POWER_VIEW_RANGE_M, STATION_RANGE_M } from '../core/constants.js';
import { distance, dot, normalize, sub, type Vec3d } from '../core/math.js';
import { placeableForMachineType } from '../data/loadPlaceables.js';
import type { Entity, EntityId } from '../sim/entities.js';
import { isStationMachine } from '../sim/craftingActions.js';
import { moveBasis, upAt } from '../sim/physics/frames.js';
import type { World } from '../sim/world.js';

/** Cosine of the aim cone half-angle (25 degrees off-center still grabs). */
const AIM_COS = Math.cos((25 * Math.PI) / 180);
/** Stations are bulky; a wider 35 degree cone makes "look at it" forgiving. */
const STATION_AIM_COS = Math.cos((35 * Math.PI) / 180);

/** Nearest loose item in range and inside the look cone, if any. */
export function findAimedItem(world: World, playerId: EntityId): EntityId | null {
  return findAimed(world, playerId, 'item');
}

/**
 * Nearest tether post in range and inside the look cone, if any.
 * E on a post pulls it back up (removeTether refunds the item).
 */
export function findAimedTether(world: World, playerId: EntityId): EntityId | null {
  return findAimed(world, playerId, 'tether');
}

/**
 * Nearest station machine in range and inside the (wider) look cone. The
 * aim point is the model's mid-height, not its base, so looking at the body
 * of a printer registers.
 */
export function findAimedStation(world: World, playerId: EntityId): EntityId | null {
  return findAimedMachineMatching(world, playerId, STATION_RANGE_M, (entity) => isStationMachine(entity));
}

/** Nearest machine (any type) for the HUD power readout. */
export function findAimedMachine(world: World, playerId: EntityId): EntityId | null {
  return findAimedMachineMatching(world, playerId, POWER_VIEW_RANGE_M, () => true);
}

function findAimedMachineMatching(
  world: World,
  playerId: EntityId,
  range: number,
  accepts: (entity: Entity) => boolean,
): EntityId | null {
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
    if (entity.planetId !== planet.id || entity.kind !== 'machine' || !accepts(entity)) continue;
    // Range is base-to-player (the same measure the sim actions use); the
    // wider mid-height point is only for the look-cone direction.
    const baseDist = distance(entity.position, player.position);
    if (baseDist > range) continue;
    const def = placeableForMachineType(entity.components.machine?.machineType ?? '');
    const center: Vec3d = {
      x: entity.position.x + up.x * ((def?.heightM ?? 1) * 0.5),
      y: entity.position.y + up.y * ((def?.heightM ?? 1) * 0.5),
      z: entity.position.z + up.z * ((def?.heightM ?? 1) * 0.5),
    };
    const dist = distance(center, player.position);
    if (dist >= bestDist) continue;
    const to: Vec3d = dist < 1e-6 ? forward : normalize(sub(center, player.position));
    if (dot(to, forward) < STATION_AIM_COS) continue;
    best = entity.id;
    bestDist = dist;
  }
  return best;
}

function findAimed(world: World, playerId: EntityId, kind: 'item' | 'tether'): EntityId | null {
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
    if (kind === 'item') {
      if (entity.kind !== 'item' || entity.components.item?.holder !== undefined) continue;
    } else {
      if (entity.kind !== 'tether') continue;
    }
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
