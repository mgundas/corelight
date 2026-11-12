// Primed pack-up target (M10). Mirrors the E priority chain: an aimed
// station wins first, then loose items/tethers keep their normal tap-E
// behavior, and only an empty machine/platform becomes a hold-E target.
// Carrying a package or a light stick disables hold-to-pack so placement
// keeps its familiar single click.

import { STATION_RANGE_M } from '../core/constants.js';
import { distance, dot, normalize, sub, type Vec3d } from '../core/math.js';
import { placeableForPackageItem } from '../data/loadPlaceables.js';
import type { EntityId } from '../sim/entities.js';
import { depositCandidate } from '../sim/stationInputs.js';
import { isEntityEmpty, isPackableEntity } from '../sim/packActions.js';
import { isResearchStation, researchSampleCandidate } from '../sim/researchActions.js';
import { moveBasis, upAt } from '../sim/physics/frames.js';
import { defForEntity } from '../sim/snapUtils.js';
import type { World } from '../sim/world.js';
import { findAimedItem, findAimedStation, findAimedTether } from './pickup.js';

const AIM_COS = Math.cos((35 * Math.PI) / 180);

function holdingSomething(world: World, playerId: EntityId): boolean {
  const player = world.entities.get(playerId);
  if (!player) return true;
  if (player.components.player?.carryingLarge) return true;
  const inventory = player.components.inventory;
  if (!inventory) return false;
  const selected = inventory.slots[inventory.selectedSlot];
  const itemId = selected ? world.entities.get(selected)?.components.item?.itemId : null;
  return itemId === 'light_stick' || (itemId !== null && itemId !== undefined && placeableForPackageItem(itemId) !== undefined);
}

/** Nearest machine/platform whose body is inside the look cone. */
function findAimedStructure(world: World, playerId: EntityId): EntityId | null {
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
    if (entity.planetId !== planet.id || !isPackableEntity(entity)) continue;
    const baseDist = distance(entity.position, player.position);
    if (baseDist > STATION_RANGE_M) continue;
    const def = defForEntity(entity);
    const midHeight = entity.kind === 'platform' ? 0.35 : (def?.heightM ?? 1) * 0.5;
    const center: Vec3d = {
      x: entity.position.x + up.x * midHeight,
      y: entity.position.y + up.y * midHeight,
      z: entity.position.z + up.z * midHeight,
    };
    const dist = distance(center, player.position);
    if (dist >= bestDist) continue;
    const to: Vec3d = dist < 1e-6 ? forward : normalize(sub(center, player.position));
    if (dot(to, forward) < AIM_COS) continue;
    best = entity.id;
    bestDist = dist;
  }
  return best;
}

/** The entity hold-E would pack right now, or null. Read-only. */
export function primaryPackTarget(world: World, playerId: EntityId): EntityId | null {
  if (holdingSomething(world, playerId)) return null;
  const stationId = findAimedStation(world, playerId);
  if (stationId) {
    const station = world.entities.get(stationId);
    if (!station || !isEntityEmpty(world, station)) return null;
    // A matching held input means tap-E would deposit; hold-E packing must
    // not steal that familiar action.
    const inventory = world.entities.get(playerId)?.components.inventory;
    if (inventory && depositCandidate(world, inventory, station)) return null;
    if (inventory && isResearchStation(station) && researchSampleCandidate(world, inventory)) {
      return null;
    }
    return station.id;
  }
  if (findAimedItem(world, playerId)) return null;
  if (findAimedTether(world, playerId)) return null;
  const structure = findAimedStructure(world, playerId);
  if (!structure) return null;
  const entity = world.entities.get(structure);
  return entity && isEntityEmpty(world, entity) ? entity.id : null;
}
