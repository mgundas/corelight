// Shuttle actions (M14): board, disembark, load a fuel cell and accept one
// tick of flight input. Validation lives here (range, planet, pilot link,
// landed state, fuel), so a co-op server can reject the same crafted Actions.
// Every terminal path emits `actionApplied` like the other handlers.

import {
  SHUTTLE_ENTER_RANGE_M,
  SHUTTLE_EXIT_SPEED_MPS,
  SHUTTLE_FUEL_MAX,
} from '../core/constants.js';
import { events } from '../core/events.js';
import { clampScalar, distance, IDENTITY_QUAT } from '../core/math.js';
import type { Entity, EntityId, ShuttleInputState } from './entities.js';
import { inventoryFor } from './inventoryActions.js';
import { seatAheadOnGround } from './tetherActions.js';
import { isLanded, isPiloted, shuttleFuel, shuttleSpeed } from './shuttle.js';
import type { World } from './world.js';

/** How far beside the shuttle the astronaut steps out (m). */
export const SHUTTLE_EXIT_AHEAD_M = 3;

function shuttleEntity(world: World, shuttleId: EntityId): Entity | undefined {
  const entity = world.entities.get(shuttleId);
  if (!entity || entity.kind !== 'shuttle' || !entity.components.shuttle) return undefined;
  return entity;
}

/** Drop a grab-carried item before climbing in (it must not follow the ship). */
function releaseGrab(world: World, player: Entity): void {
  const playerComp = player.components.player;
  const grabbedId = playerComp?.grabbed;
  if (!playerComp || !grabbedId) return;
  const item = world.entities.get(grabbedId);
  if (item) {
    item.position = { ...player.position };
    item.planetId = player.planetId;
    item.rotation = { ...IDENTITY_QUAT };
    const itemComp = item.components.item;
    if (itemComp) delete itemComp.grabbedBy;
  }
  playerComp.grabbed = null;
}

/** Keep the pilot entity at the shuttle transform (attachment). */
export function attachPilotToShuttle(player: Entity, shuttle: Entity): void {
  if (!player.components.player) return;
  player.position = { ...shuttle.position };
  player.rotation = { ...shuttle.rotation };
  player.planetId = shuttle.planetId;
  player.components.player.velocity = { x: 0, y: 0, z: 0 };
  player.components.player.input = null;
  player.components.player.grounded = false;
}

function fail(type: 'enterShuttle' | 'exitShuttle' | 'loadShuttleFuel'): void {
  events.emit('actionApplied', { type });
}

/** E near the shuttle: board when empty (fuel loading is its own action). */
export function enterShuttle(world: World, playerId: EntityId, shuttleId: EntityId): void {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const shuttle = shuttleEntity(world, shuttleId);
  if (
    !player ||
    player.kind !== 'player' ||
    !playerComp ||
    !shuttle ||
    !shuttle.components.shuttle ||
    player.planetId === null ||
    shuttle.planetId !== player.planetId ||
    playerComp.pilotingShuttleId ||
    isPiloted(shuttle.components.shuttle) ||
    distance(player.position, shuttle.position) > SHUTTLE_ENTER_RANGE_M
  ) {
    fail('enterShuttle');
    return;
  }
  releaseGrab(world, player);
  playerComp.pilotingShuttleId = shuttle.id;
  shuttle.components.shuttle.pilotId = playerId;
  // The pilot sits inside: keep the entity on the shuttle transform so the
  // collider ring and camera follow it, but never draw the suit.
  attachPilotToShuttle(player, shuttle);
  events.emit('actionApplied', { type: 'enterShuttle' });
}

/** E inside: step out only when landed and slow enough. */
export function exitShuttle(world: World, playerId: EntityId): void {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const shuttleId = playerComp?.pilotingShuttleId;
  const shuttle = shuttleId ? shuttleEntity(world, shuttleId) : undefined;
  const shuttleComp = shuttle?.components.shuttle;
  if (!player || !playerComp || !shuttle || !shuttleComp) {
    if (playerComp) playerComp.pilotingShuttleId = null;
    fail('exitShuttle');
    return;
  }
  if (!isLanded(shuttleComp) || shuttleSpeed(shuttleComp) >= SHUTTLE_EXIT_SPEED_MPS) {
    fail('exitShuttle');
    return;
  }
  const planet = world.planets.find((p) => p.id === shuttle.planetId);
  playerComp.pilotingShuttleId = null;
  shuttleComp.pilotId = null;
  if (planet) {
    // Step out beside the ship (yaw-leveled so a pitched camera cannot bury
    // the astronaut), then let the normal physics system settle them.
    player.position = seatAheadOnGround(world, planet, shuttle.position, shuttleComp.yaw, SHUTTLE_EXIT_AHEAD_M);
  } else {
    player.position = {
      x: shuttle.position.x + shuttleComp.up.x * 1.5,
      y: shuttle.position.y + shuttleComp.up.y * 1.5,
      z: shuttle.position.z + shuttleComp.up.z * 1.5,
    };
  }
  player.planetId = shuttle.planetId;
  playerComp.velocity = { x: 0, y: 0, z: 0 };
  playerComp.input = null;
  playerComp.grounded = false;
  playerComp.embeddedTime = 0;
  playerComp.escaping = false;
  events.emit('actionApplied', { type: 'exitShuttle' });
}

/** Load one backpack fuel cell into a side slot (max two). */
export function loadShuttleFuel(world: World, playerId: EntityId, shuttleId: EntityId): void {
  const player = world.entities.get(playerId);
  const inventory = inventoryFor(world, playerId);
  const shuttle = shuttleEntity(world, shuttleId);
  const shuttleComp = shuttle?.components.shuttle;
  if (
    !player ||
    !inventory ||
    !shuttle ||
    !shuttleComp ||
    player.planetId === null ||
    shuttle.planetId !== player.planetId ||
    distance(player.position, shuttle.position) > SHUTTLE_ENTER_RANGE_M ||
    shuttleFuel(shuttleComp) >= SHUTTLE_FUEL_MAX
  ) {
    fail('loadShuttleFuel');
    return;
  }
  // Prefer the selected slot (the player chose it), then any fuel cell.
  const slots = inventory.slots;
  const isFuel = (id: EntityId | null): boolean =>
    id !== null && world.entities.get(id)?.components.item?.itemId === 'fuel_cell';
  const selected = slots[inventory.selectedSlot] ?? null;
  const slot = isFuel(selected) ? inventory.selectedSlot : slots.findIndex(isFuel);
  if (slot === -1) {
    fail('loadShuttleFuel');
    return;
  }
  const spent = slots[slot] as EntityId;
  world.entities.delete(spent);
  slots[slot] = null;
  shuttleComp.fuel = clampScalar(shuttleFuel(shuttleComp) + 1, 0, SHUTTLE_FUEL_MAX);
  events.emit('actionApplied', { type: 'loadShuttleFuel' });
}

/** Clamp + store one tick of flight intent from the pilot. */
export function applyShuttleInput(
  world: World,
  playerId: EntityId,
  shuttleId: EntityId,
  input: ShuttleInputState,
): void {
  const player = world.entities.get(playerId);
  const shuttle = shuttleEntity(world, shuttleId);
  const shuttleComp = shuttle?.components.shuttle;
  const valid =
    player?.components.player &&
    shuttleComp &&
    player.components.player.pilotingShuttleId === shuttleId &&
    shuttleComp.pilotId === playerId &&
    Number.isFinite(input.thrust) &&
    Number.isFinite(input.yawRate) &&
    Number.isFinite(input.lookYaw) &&
    Number.isFinite(input.lookPitch) &&
    typeof input.lift === 'boolean' &&
    typeof input.boost === 'boolean';
  if (!valid || !shuttleComp) {
    events.emit('actionApplied', { type: 'shuttleInput' });
    return;
  }
  shuttleComp.input = {
    thrust: clampScalar(input.thrust, -1, 1),
    yawRate: clampScalar(input.yawRate, -1, 1),
    lift: input.lift,
    boost: input.boost,
    lookYaw: input.lookYaw,
    lookPitch: input.lookPitch,
  };
  events.emit('actionApplied', { type: 'shuttleInput' });
}
