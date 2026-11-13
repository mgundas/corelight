// Placement + light-stick actions (M09/M10). Ground placement is rejected on
// steep terrain, inside rock, under low ceilings and when another structure
// occupies the spot. M10 adds two resolved alternatives: a platform rim snap
// (position + rotation, auto-joined) and a platform top slot (machine
// attached to the platform). The client ghost calls resolvePlacement for
// tinting; only the action mutates the world.

import { BATTERY_CAPACITY, HABITAT_CAPACITY, SHUTTLE_GROUND_CLEARANCE_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { quatFromTo, type Quat, type Vec3d } from '../core/math.js';
import { placeableById, type PlaceableDef } from '../data/loadPlaceables.js';
import type { Entity, EntityId, MachineType } from './entities.js';
import { inventoryFor } from './inventoryActions.js';
import { upAt } from './physics/frames.js';
import { resolvePlacement, type PlacementTarget } from './placeResolve.js';
import { seatAheadOnGround } from './tetherActions.js';
import type { World } from './world.js';

export { checkPlacement, isGroundFlat, type PlacementCheck } from './placementRules.js';

/**
 * Optional transform metadata for spawnPlaceableEntity: slot attachment,
 * platform join, or an explicit rotation. Setup and the placement action use
 * the same shape so the starter base and player-built bases are identical.
 */
export interface SpawnOptions {
  rotation?: Quat;
  attachTo?: EntityId;
  attachSlot?: number;
  snapTo?: EntityId;
  snapToSnap?: number;
  snapOwnSnap?: number;
}

const MACHINE_TYPES: ReadonlySet<string> = new Set([
  'habitat',
  'small_printer',
  'medium_printer',
  'solar_panel',
  'battery',
  'furnace',
  'research_station',
  'refinery',
]);

/** Create a placed entity for a catalog placeable (also used by setup). */
export function spawnPlaceableEntity(
  world: World,
  planetId: string,
  placeableId: string,
  position: Vec3d,
  opts: SpawnOptions = {},
): EntityId | null {
  const def = placeableById(placeableId);
  const planet = world.planets.find((p) => p.id === planetId);
  if (!def || !planet) return null;
  const id = world.nextId(def.entityKind);
  const up = upAt(planet, position);
  // A shuttle's origin sits between its landing legs, so seat it on the
  // ground/deck with the same clearance the landing assist uses. Without
  // this the parked body's legs graze the terrain and the solver nudges the
  // visual every tick.
  const seat = def.entityKind === 'shuttle'
    ? {
        x: position.x + up.x * SHUTTLE_GROUND_CLEARANCE_M,
        y: position.y + up.y * SHUTTLE_GROUND_CLEARANCE_M,
        z: position.z + up.z * SHUTTLE_GROUND_CLEARANCE_M,
      }
    : { ...position };
  const rotation = opts.rotation ? { ...opts.rotation } : quatFromTo({ x: 0, y: 1, z: 0 }, up);
  const placeable: NonNullable<Entity['components']['placeable']> = { placeableId: def.id };
  if (opts.attachTo !== undefined) placeable.attachedTo = opts.attachTo;
  if (opts.attachSlot !== undefined) placeable.attachedSlot = opts.attachSlot;
  if (opts.snapTo !== undefined) placeable.snappedTo = opts.snapTo;
  if (opts.snapToSnap !== undefined) placeable.snappedToSnap = opts.snapToSnap;
  if (opts.snapOwnSnap !== undefined) placeable.snappedOwnSnap = opts.snapOwnSnap;
  const capacity =
    def.machineType === 'battery'
      ? BATTERY_CAPACITY
      : def.machineType === 'habitat'
        ? HABITAT_CAPACITY
        : 0;
  const components: Entity['components'] = {
    placeable,
    power: { stored: 0, capacity, paused: false, networkId: null },
  };
  if (def.entityKind === 'machine' && def.machineType && MACHINE_TYPES.has(def.machineType)) {
    components.machine = { machineType: def.machineType as MachineType };
    if (def.machineType === 'small_printer' || def.machineType === 'medium_printer' || def.machineType === 'furnace' || def.machineType === 'refinery') {
      components.printer = { recipeId: null, progressS: 0, inputs: [], outputReady: null };
    }
    if (def.machineType === 'research_station') {
      components.research = { inputId: null, progressS: 0, dataReady: 0 };
    }
  }
  if (def.entityKind === 'shuttle') {
    // Flight state starts parked, empty and level with the local up. The
    // model origin is the base (between the landing legs).
    components.shuttle = {
      fuel: 0,
      pilotId: null,
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      up: upAt(planet, position),
      launchChargeS: 0,
      lastLookYaw: 0,
      airborne: false,
      input: null,
    };
  }
  world.entities.set(id, {
    id,
    kind: def.entityKind,
    planetId: planet.id,
    position: { ...seat },
    rotation,
    components,
  });
  return id;
}

function findPackage(
  world: World,
  player: Entity,
  def: PlaceableDef,
): { itemId: EntityId; slot: number | null } | null {
  const playerComp = player.components.player;
  const inventory = player.components.inventory;
  const carriedId = playerComp?.carryingLarge;
  if (carriedId) {
    const item = world.entities.get(carriedId);
    if (item?.components.item?.itemId === def.packageItem) return { itemId: carriedId, slot: null };
  }
  if (!inventory) return null;
  for (let i = 0; i < inventory.slots.length; i += 1) {
    const id = inventory.slots[i];
    if (!id) continue;
    if (world.entities.get(id)?.components.item?.itemId === def.packageItem) {
      return { itemId: id, slot: i };
    }
  }
  return null;
}

/** Unpack the carried package into a placed entity (ghost click / action). */
export function placePlaceable(
  world: World,
  playerId: EntityId,
  placeableId: string,
  position: Vec3d,
  target: PlacementTarget | null = null,
): void {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const inventory = player ? inventoryFor(world, playerId) : null;
  const def = placeableById(placeableId);
  if (!player || !playerComp || !inventory || !def || !player.planetId) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  const resolved = resolvePlacement(world, player.planetId, placeableId, position, player.position, target);
  if (!resolved.ok || !resolved.placement) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  const pkg = findPackage(world, player, def);
  if (!pkg) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  if (pkg.slot === null) {
    if (playerComp.carryingLarge === pkg.itemId) playerComp.carryingLarge = null;
  } else {
    inventory.slots[pkg.slot] = null;
  }
  world.entities.delete(pkg.itemId);
  const { position: spawnPos, ...spawnOpts } = resolved.placement;
  spawnPlaceableEntity(world, player.planetId, def.id, spawnPos, spawnOpts);
  events.emit('actionApplied', { type: 'placePlaceable' });
}

/**
 * E on the ground with a light stick selected: spend it, seat it on the
 * surface ahead of the player, and leave a static emitter behind.
 */
export function placeLightstick(world: World, playerId: EntityId): void {
  const player = world.entities.get(playerId);
  const inventory = player ? inventoryFor(world, playerId) : null;
  const playerComp = player?.components.player;
  const planet = player?.planetId ? world.planets.find((p) => p.id === player.planetId) : undefined;
  if (!player || !inventory || !playerComp || !planet) {
    events.emit('actionApplied', { type: 'placeLightstick' });
    return;
  }
  // "Holding" means the selected slot: a stick elsewhere in the pack must
  // not fire (and must not shadow a carried placeable's placement mode).
  const slot = inventory.selectedSlot;
  const spentId = inventory.slots[slot];
  if (!spentId || world.entities.get(spentId)?.components.item?.itemId !== 'light_stick') {
    events.emit('actionApplied', { type: 'placeLightstick' });
    return;
  }
  world.entities.delete(spentId);
  inventory.slots[slot] = null;
  const position = seatAheadOnGround(world, planet, player.position, playerComp.yaw);
  const id = world.nextId('lightstick');
  world.entities.set(id, {
    id,
    kind: 'lightstick',
    planetId: planet.id,
    position,
    rotation: { ...quatFromTo({ x: 0, y: 1, z: 0 }, upAt(planet, position)) },
    // The item component carries the glow definition (items.json) into the
    // renderer; kind 'lightstick' keeps it out of the physics/backpack paths.
    components: { item: { itemId: 'light_stick' } },
  });
  events.emit('actionApplied', { type: 'placeLightstick' });
}
