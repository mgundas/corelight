// Cable actions (M10): connect a source snap to a target within 10 m, or cut
// an existing cable. Cable entities are pure graph edges with a midpoint
// position (the renderer draws the sagging line from the live snap refs).
// Everything is validated here; the cable tool only proposes refs.

import { CABLE_MAX_LENGTH_M, CABLE_REACH_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance } from '../core/math.js';
import type { EntityId, SnapRef } from './entities.js';
import {
  cableOnSnap,
  createCableEntity,
  isSnapRef,
  snapFree,
  snapWorld,
} from './snapUtils.js';
import type { World } from './world.js';

function playerNear(world: World, playerId: EntityId, point: { x: number; y: number; z: number }): boolean {
  const player = world.entities.get(playerId);
  return (
    player !== undefined &&
    player.kind === 'player' &&
    player.planetId !== null &&
    distance(player.position, point) <= CABLE_REACH_M
  );
}

/** Join two free snap points with a cable. */
export function connectCable(world: World, playerId: EntityId, from: SnapRef, to: SnapRef): void {
  const player = world.entities.get(playerId);
  if (!player || player.kind !== 'player' || !player.planetId) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  if (!isSnapRef(from) || !isSnapRef(to) || from.entityId === to.entityId) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  const fromEntity = world.entities.get(from.entityId);
  const toEntity = world.entities.get(to.entityId);
  const planet = world.planets.find((p) => p.id === player.planetId);
  if (
    !fromEntity ||
    !toEntity ||
    !planet ||
    fromEntity.planetId !== planet.id ||
    toEntity.planetId !== planet.id
  ) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  const fromPos = snapWorld(fromEntity, from.snapIndex);
  const toPos = snapWorld(toEntity, to.snapIndex);
  if (!fromPos || !toPos) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  if (!playerNear(world, playerId, fromPos) || !playerNear(world, playerId, toPos)) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  if (distance(fromPos, toPos) > CABLE_MAX_LENGTH_M) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  if (!snapFree(world, from) || !snapFree(world, to)) {
    events.emit('actionApplied', { type: 'connectCable' });
    return;
  }
  createCableEntity(world, planet.id, from, to);
  events.emit('actionApplied', { type: 'connectCable' });
}

/** Remove one cable (C tool click on an occupied snap). */
export function disconnectCable(world: World, playerId: EntityId, cableId: EntityId): void {
  const player = world.entities.get(playerId);
  const cable = world.entities.get(cableId);
  if (
    !player ||
    player.kind !== 'player' ||
    !player.planetId ||
    !cable ||
    cable.kind !== 'cable' ||
    cable.planetId !== player.planetId
  ) {
    events.emit('actionApplied', { type: 'disconnectCable' });
    return;
  }
  if (!playerNear(world, playerId, cable.position)) {
    events.emit('actionApplied', { type: 'disconnectCable' });
    return;
  }
  world.entities.delete(cableId);
  events.emit('actionApplied', { type: 'disconnectCable' });
}

/** Cable id on a snap, for tool clicks/prompts (read-only convenience). */
export function cableIdOnSnap(world: World, ref: SnapRef): EntityId | null {
  return cableOnSnap(world, ref);
}
