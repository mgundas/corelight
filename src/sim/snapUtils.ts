// Snap-point math (M10). Pure sim-side helpers: catalog snap points rotate
// with their entity, cables occupy a snap, platform joins occupy a rim snap,
// and platform top slots hold attached machines. The renderer reuses
// `defForEntity` so a habitat dome and a cabled habitat kit share one snap
// definition.

import { distance, IDENTITY_QUAT, rotateVector, type Vec3d } from '../core/math.js';
import {
  placeableById,
  placeableForMachineType,
  type PlaceableDef,
} from '../data/loadPlaceables.js';
import type { SnapPoint } from '../data/loadPlaceables.js';
import type { Entity, EntityId, SlotRef, SnapRef } from './entities.js';
import type { World } from './world.js';

/** Catalog definition backing an entity (placeable id, else machine type). */
export function defForEntity(entity: Entity): PlaceableDef | undefined {
  const placeableId = entity.components.placeable?.placeableId;
  if (placeableId) return placeableById(placeableId);
  const machineType = entity.components.machine?.machineType;
  if (machineType) return placeableForMachineType(machineType);
  return undefined;
}

function localNap(def: PlaceableDef, index: number): SnapPoint | null {
  if (!Number.isInteger(index) || index < 0 || index >= def.snapPoints.length) return null;
  return def.snapPoints[index] as SnapPoint;
}

function localSlot(def: PlaceableDef, index: number): SnapPoint | null {
  if (!Number.isInteger(index) || index < 0 || index >= def.slots.length) return null;
  return def.slots[index] as SnapPoint;
}

/** World-space position of one catalog snap point. */
export function snapWorld(entity: Entity, index: number): Vec3d | null {
  const def = defForEntity(entity);
  const local = def ? localNap(def, index) : null;
  if (!local) return null;
  const offset = rotateVector(local, entity.rotation);
  return {
    x: entity.position.x + offset.x,
    y: entity.position.y + offset.y,
    z: entity.position.z + offset.z,
  };
}

/** World-space position of one platform top slot. */
export function slotWorld(entity: Entity, index: number): Vec3d | null {
  const def = defForEntity(entity);
  const local = def ? localSlot(def, index) : null;
  if (!local) return null;
  const offset = rotateVector(local, entity.rotation);
  return {
    x: entity.position.x + offset.x,
    y: entity.position.y + offset.y,
    z: entity.position.z + offset.z,
  };
}

export function sameSnap(a: SnapRef, b: SnapRef): boolean {
  return a.entityId === b.entityId && a.snapIndex === b.snapIndex;
}

/** Runtime guard for crafted action payloads. */
export function isSnapRef(value: unknown): value is SnapRef {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['entityId'] === 'string' &&
    Number.isInteger(r['snapIndex']) &&
    (r['snapIndex'] as number) >= 0
  );
}

/** Runtime guard for crafted action payloads. */
export function isSlotRef(value: unknown): value is SlotRef {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['entityId'] === 'string' &&
    Number.isInteger(r['slotIndex']) &&
    (r['slotIndex'] as number) >= 0
  );
}

/** Cable id using this snap, if any. */
export function cableOnSnap(world: World, ref: SnapRef): EntityId | null {
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'cable') continue;
    const cable = entity.components.cable;
    if (!cable) continue;
    if (sameSnap(cable.a, ref) || sameSnap(cable.b, ref)) return entity.id;
  }
  return null;
}

function platformJoinedAt(world: World, entity: Entity, index: number): boolean {
  if (entity.components.placeable?.snappedOwnSnap === index) return true;
  for (const other of world.entities.values()) {
    if (other.kind !== 'platform' || other.id === entity.id) continue;
    const placeable = other.components.placeable;
    if (!placeable || placeable.snappedTo !== entity.id) continue;
    if (placeable.snappedToSnap === index) return true;
  }
  return false;
}

/** True when a cable or platform join still needs this snap point. */
export function snapFree(world: World, ref: SnapRef): boolean {
  const entity = world.entities.get(ref.entityId);
  if (!entity || entity.planetId === null) return false;
  const def = defForEntity(entity);
  if (!def || !localNap(def, ref.snapIndex)) return false;
  if (cableOnSnap(world, ref)) return false;
  return !platformJoinedAt(world, entity, ref.snapIndex);
}

/** True when no machine/shuttle is attached to a platform slot. */
export function slotFree(world: World, ref: SlotRef): boolean {
  const entity = world.entities.get(ref.entityId);
  if (!entity || entity.kind !== 'platform') return false;
  const def = defForEntity(entity);
  if (!def || !localSlot(def, ref.slotIndex)) return false;
  for (const other of world.entities.values()) {
    if (other.kind !== 'machine' && other.kind !== 'shuttle') continue;
    const placeable = other.components.placeable;
    if (placeable?.attachedTo === ref.entityId && placeable.attachedSlot === ref.slotIndex) {
      return false;
    }
  }
  return true;
}

/**
 * Create a cable entity between two snaps. Validation lives in the action;
 * world setup uses the same helper for the starter habitat link (the same
 * initialization exemption as the base pad and starter platform).
 */
export function createCableEntity(
  world: World,
  planetId: string,
  a: SnapRef,
  b: SnapRef,
): EntityId | null {
  const planet = world.planets.find((p) => p.id === planetId);
  const aEntity = world.entities.get(a.entityId);
  const bEntity = world.entities.get(b.entityId);
  if (!planet || !aEntity || !bEntity) return null;
  if (aEntity.planetId !== planetId || bEntity.planetId !== planetId) return null;
  if (a.entityId === b.entityId) return null;
  const aPos = snapWorld(aEntity, a.snapIndex);
  const bPos = snapWorld(bEntity, b.snapIndex);
  if (!aPos || !bPos) return null;
  const id = world.nextId('cable');
  world.entities.set(id, {
    id,
    kind: 'cable',
    planetId,
    position: {
      x: (aPos.x + bPos.x) / 2,
      y: (aPos.y + bPos.y) / 2,
      z: (aPos.z + bPos.z) / 2,
    },
    rotation: { ...IDENTITY_QUAT },
    components: {
      cable: {
        a: { entityId: a.entityId, snapIndex: a.snapIndex },
        b: { entityId: b.entityId, snapIndex: b.snapIndex },
      },
    },
  });
  return id;
}

/**
 * Closest pair of free snaps between two entities (starter habitat cable).
 * Returns null when the planets differ or no pair is within `maxDist`.
 */
export function nearestFreeSnapPair(
  world: World,
  a: Entity,
  b: Entity,
  maxDist = Infinity,
): { a: SnapRef; b: SnapRef; distanceM: number } | null {
  if (a.planetId === null || a.planetId !== b.planetId) return null;
  const planet = world.planets.find((p) => p.id === a.planetId);
  const defA = defForEntity(a);
  const defB = defForEntity(b);
  if (!planet || !defA || !defB) return null;
  let best: { a: SnapRef; b: SnapRef; distanceM: number } | null = null;
  for (let i = 0; i < defA.snapPoints.length; i += 1) {
    const refA: SnapRef = { entityId: a.id, snapIndex: i };
    if (!snapFree(world, refA)) continue;
    const posA = snapWorld(a, i);
    if (!posA) continue;
    for (let j = 0; j < defB.snapPoints.length; j += 1) {
      const refB: SnapRef = { entityId: b.id, snapIndex: j };
      if (!snapFree(world, refB)) continue;
      const posB = snapWorld(b, j);
      if (!posB) continue;
      const d = distance(posA, posB);
      if (d > maxDist) continue;
      if (!best || d < best.distanceM) best = { a: refA, b: refB, distanceM: d };
    }
  }
  return best;
}
