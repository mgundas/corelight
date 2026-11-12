// Placement resolution (M10): ground, platform rim snap, or platform top
// slot. The client finds the nearest aimed target and passes it through an
// Action; the sim re-validates the same target here before mutating. This is
// the only place that turns a target into a world transform, so the ghost and
// the real placement can never disagree.

import { CABLE_MAX_LENGTH_M, PLACE_RANGE_M } from '../core/constants.js';
import { distance, quatFromTo, rotateVector, type Quat, type Vec3d } from '../core/math.js';
import { placeableById } from '../data/loadPlaceables.js';
import type { EntityId, SlotRef, SnapRef } from './entities.js';
import { upAt } from './physics/frames.js';
import { checkPlacement, checkSnappedClearance, type PlacementCheck } from './placementRules.js';
import {
  defForEntity,
  isSlotRef,
  isSnapRef,
  slotFree,
  slotWorld,
  snapFree,
  snapWorld,
} from './snapUtils.js';
import type { World } from './world.js';

export interface PlacementTarget {
  snap?: SnapRef;
  slot?: SlotRef;
}

/** Transform + attachment metadata consumed by spawnPlaceableEntity. */
export interface PlacementPlacement {
  position: Vec3d;
  rotation: Quat;
  attachTo?: EntityId;
  attachSlot?: number;
  snapTo?: EntityId;
  snapToSnap?: number;
  snapOwnSnap?: number;
}

export interface ResolvedPlacement extends PlacementCheck {
  placement: PlacementPlacement | null;
  snap: SnapRef | null;
  slot: SlotRef | null;
}

function fail(reason: string): ResolvedPlacement {
  return { ok: false, reason, placement: null, snap: null, slot: null };
}

function groundPlacement(
  world: World,
  planetId: string,
  placeableId: string,
  position: Vec3d,
  playerPosition: Vec3d,
): ResolvedPlacement {
  if (distance(playerPosition, position) > PLACE_RANGE_M) return fail('Out of reach');
  const check = checkPlacement(world, planetId, placeableId, position);
  if (!check.ok) return { ...check, placement: null, snap: null, slot: null };
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) return fail('Unknown planet');
  const rotation = quatFromTo({ x: 0, y: 1, z: 0 }, upAt(planet, position));
  return {
    ok: true,
    reason: null,
    placement: { position: { ...position }, rotation },
    snap: null,
    slot: null,
  };
}

function slotPlacement(
  world: World,
  planetId: string,
  placeableId: string,
  target: SlotRef,
  playerPosition: Vec3d,
): ResolvedPlacement {
  const def = placeableById(placeableId);
  if (!def || def.entityKind !== 'machine') return fail('Only machines fit a slot');
  if (def.machineType === 'habitat') return fail('The habitat cannot sit on a platform');
  const platform = world.entities.get(target.entityId);
  if (!platform || platform.kind !== 'platform' || platform.planetId !== planetId) {
    return fail('Unknown platform');
  }
  const platformDef = defForEntity(platform);
  if (!platformDef || target.slotIndex >= platformDef.slots.length) return fail('Unknown slot');
  if (!slotFree(world, target)) return fail('Slot is occupied');
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) return fail('Unknown planet');
  const position = slotWorld(platform, target.slotIndex);
  if (!position) return fail('Unknown slot');
  if (distance(playerPosition, position) > PLACE_RANGE_M) return fail('Out of reach');
  return {
    ok: true,
    reason: null,
    placement: {
      position,
      rotation: { ...platform.rotation },
      attachTo: platform.id,
      attachSlot: target.slotIndex,
    },
    snap: null,
    slot: target,
  };
}

function snapPlacement(
  world: World,
  planetId: string,
  placeableId: string,
  target: SnapRef,
  playerPosition: Vec3d,
): ResolvedPlacement {
  const def = placeableById(placeableId);
  if (!def || def.entityKind !== 'platform') return fail('Only platforms snap together');
  const targetEntity = world.entities.get(target.entityId);
  if (!targetEntity || targetEntity.kind !== 'platform' || targetEntity.planetId !== planetId) {
    return fail('Unknown platform');
  }
  const targetDef = defForEntity(targetEntity);
  if (!targetDef || target.snapIndex >= targetDef.snapPoints.length) return fail('Unknown snap point');
  if (!snapFree(world, target)) return fail('Snap point is occupied');
  const targetLocal = targetDef.snapPoints[target.snapIndex];
  if (!targetLocal) return fail('Unknown snap point');
  // Pick this platform's rim facing the target: the most opposite local snap.
  let ownIndex = -1;
  let bestDot = Infinity;
  for (let i = 0; i < def.snapPoints.length; i += 1) {
    const own = def.snapPoints[i];
    if (!own) continue;
    const d = own.x * targetLocal.x + own.y * targetLocal.y + own.z * targetLocal.z;
    if (d < bestDot) {
      bestDot = d;
      ownIndex = i;
    }
  }
  if (ownIndex === -1) return fail('Platform has no snap points');
  const ownLocal = def.snapPoints[ownIndex];
  if (!ownLocal) return fail('Platform has no snap points');
  const targetOffset = rotateVector(targetLocal, targetEntity.rotation);
  const ownOffset = rotateVector(ownLocal, targetEntity.rotation);
  const position = {
    x: targetEntity.position.x + targetOffset.x - ownOffset.x,
    y: targetEntity.position.y + targetOffset.y - ownOffset.y,
    z: targetEntity.position.z + targetOffset.z - ownOffset.z,
  };
  if (distance(playerPosition, position) > PLACE_RANGE_M) return fail('Out of reach');
  const clearance = checkSnappedClearance(world, planetId, placeableId, position, targetEntity.id);
  if (!clearance.ok) return { ...clearance, placement: null, snap: null, slot: null };
  return {
    ok: true,
    reason: null,
    placement: {
      position,
      rotation: { ...targetEntity.rotation },
      snapTo: targetEntity.id,
      snapToSnap: target.snapIndex,
      snapOwnSnap: ownIndex,
    },
    snap: target,
    slot: null,
  };
}

/**
 * Resolve one requested placement. Ground placement uses the normal rules;
 * snapped platforms and slot machines bypass ground checks but validate the
 * target, occupancy and player range.
 */
export function resolvePlacement(
  world: World,
  planetId: string,
  placeableId: string,
  requested: Vec3d,
  playerPosition: Vec3d,
  target: PlacementTarget | null,
): ResolvedPlacement {
  if (target?.slot) {
    if (!isSlotRef(target.slot)) return fail('Invalid slot');
    return slotPlacement(world, planetId, placeableId, target.slot, playerPosition);
  }
  if (target?.snap) {
    if (!isSnapRef(target.snap)) return fail('Invalid snap point');
    return snapPlacement(world, planetId, placeableId, target.snap, playerPosition);
  }
  if (!requested || !Number.isFinite(requested.x) || !Number.isFinite(requested.y) || !Number.isFinite(requested.z)) {
    return fail('Invalid position');
  }
  return groundPlacement(world, planetId, placeableId, requested, playerPosition);
}

/** Distance between two snap points, for the cable action (null if invalid). */
export function snapPairDistance(world: World, a: SnapRef, b: SnapRef): number | null {
  const planetA = world.entities.get(a.entityId)?.planetId;
  const planetB = world.entities.get(b.entityId)?.planetId;
  if (!planetA || planetA !== planetB) return null;
  const planet = world.planets.find((p) => p.id === planetA);
  const aEntity = world.entities.get(a.entityId);
  const bEntity = world.entities.get(b.entityId);
  if (!planet || !aEntity || !bEntity) return null;
  const aPos = snapWorld(aEntity, a.snapIndex);
  const bPos = snapWorld(bEntity, b.snapIndex);
  if (!aPos || !bPos) return null;
  const d = distance(aPos, bPos);
  return d <= CABLE_MAX_LENGTH_M ? d : null;
}
