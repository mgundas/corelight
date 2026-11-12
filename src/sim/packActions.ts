// Pack-up action (M10): hold E on an empty machine/platform for 1 s to fold
// it back into its packaged item. "Empty" is strict: no inputs, job or
// output, no battery charge, no attached machines and no cables. Packing a
// platform also clears dangling join refs on its neighbours so their rim
// snaps become free again.

import { STATION_RANGE_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance } from '../core/math.js';
import { placeableById } from '../data/loadPlaceables.js';
import type { Entity, EntityId } from './entities.js';
import { giveItemToPlayer } from './inventoryActions.js';
import { cableOnSnap, defForEntity } from './snapUtils.js';
import type { World } from './world.js';

/** Machines/platforms that can fold back into a package at all. */
export function isPackableEntity(entity: Entity): boolean {
  if (entity.kind !== 'machine' && entity.kind !== 'platform') return false;
  if (entity.kind === 'machine' && entity.components.machine?.machineType === 'habitat') return false;
  const placeable = entity.components.placeable;
  if (!placeable) return false;
  return placeableById(placeable.placeableId) !== undefined;
}

/** True when nothing is stored, loaded, attached or cabled to the entity. */
export function isEntityEmpty(world: World, entity: Entity): boolean {
  if (!isPackableEntity(entity)) return false;
  const printer = entity.components.printer;
  if (
    printer &&
    (printer.recipeId !== null || printer.outputReady !== null || printer.inputs.length > 0)
  ) {
    return false;
  }
  if ((entity.components.power?.stored ?? 0) > 1e-6) return false;
  if (entity.kind === 'platform') {
    for (const other of world.entities.values()) {
      if (other.kind !== 'machine') continue;
      if (other.components.placeable?.attachedTo === entity.id) return false;
    }
  }
  const def = defForEntity(entity);
  if (def) {
    for (let i = 0; i < def.snapPoints.length; i += 1) {
      if (cableOnSnap(world, { entityId: entity.id, snapIndex: i })) return false;
    }
  }
  return true;
}

/** Fold an empty placed object back into its package item. */
export function packUpPlaced(world: World, playerId: EntityId, entityId: EntityId): void {
  const player = world.entities.get(playerId);
  const entity = world.entities.get(entityId);
  if (
    !player ||
    player.kind !== 'player' ||
    !player.planetId ||
    !entity ||
    entity.planetId !== player.planetId ||
    !isEntityEmpty(world, entity) ||
    distance(player.position, entity.position) > STATION_RANGE_M
  ) {
    events.emit('actionApplied', { type: 'packUpPlaced' });
    return;
  }
  const placeable = entity.components.placeable;
  const def = placeable ? placeableById(placeable.placeableId) : undefined;
  if (!def) {
    events.emit('actionApplied', { type: 'packUpPlaced' });
    return;
  }
  // A platform join is a one-way reference on each platform. Clear the
  // neighbours' refs so their used rim snaps become available again.
  if (entity.kind === 'platform') {
    for (const other of world.entities.values()) {
      if (other.kind !== 'platform') continue;
      const p = other.components.placeable;
      if (!p || p.snappedTo !== entity.id) continue;
      delete p.snappedTo;
      delete p.snappedToSnap;
      delete p.snappedOwnSnap;
    }
  }
  world.entities.delete(entity.id);
  giveItemToPlayer(world, player, def.packageItem);
  events.emit('actionApplied', { type: 'packUpPlaced' });
}
