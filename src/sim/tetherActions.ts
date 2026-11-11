// Habitat + tether action handlers (M08). Split out of actions.ts to keep
// both files under the 400-line hard rule: placement math (ground seating,
// backpack spend/refund) lives here, dispatch stays in applyAction.

import { distance, IDENTITY_QUAT, quatFromTo } from '../core/math.js';
import { BACKPACK_SLOTS, PICKUP_RANGE_M, TETHER_GROUND_SEARCH_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { createDensityField, type DensityField } from '../terrain/density.js';
import type { Entity, EntityId } from './entities.js';
import { upAt } from './physics/frames.js';
import type { World } from './world.js';

/** Backpack, lazily created (old M06 saves predate inventory). */
function backpackFor(playerEntity: Entity): { slots: (EntityId | null)[]; selectedSlot: number } | null {
  if (playerEntity.kind !== 'player' || !playerEntity.components.player) return null;
  let inventory = playerEntity.components.inventory;
  if (!inventory) {
    inventory = { slots: Array<EntityId | null>(BACKPACK_SLOTS).fill(null), selectedSlot: 0 };
    playerEntity.components.inventory = inventory;
  }
  return inventory;
}

/**
 * Base (unedited) density fields per world, cached so every stroke bit does
 * not rebuild seeded noise. Crossings are measured against base + stored
 * deltas inside TerrainEdits; the live (edited) fields used by physics are
 * built separately in the physics system.
 */
const baseFieldCache = new WeakMap<World, Map<string, DensityField>>();

export function baseFieldFor(world: World, planetId: string): DensityField {
  let perWorld = baseFieldCache.get(world);
  if (!perWorld) {
    perWorld = new Map();
    baseFieldCache.set(world, perWorld);
  }
  let field = perWorld.get(planetId);
  if (!field) {
    const planet = world.planets.find((p) => p.id === planetId);
    if (!planet) throw new Error(`terrainEdit: unknown planet ${planetId}`);
    field = createDensityField(planet, world.seed);
    perWorld.set(planetId, field);
  }
  return field;
}

/** Create the habitat dome entity for a spawnHabitat action. */
export function spawnHabitatEntity(world: World, planetId: string, position: { x: number; y: number; z: number }): void {
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) {
    events.emit('actionApplied', { type: 'spawnHabitat' });
    return;
  }
  const id = world.nextId('machine');
  world.entities.set(id, {
    id,
    kind: 'machine',
    planetId: planet.id,
    position: { ...position },
    // Dome +Y maps onto the local up so the door sits level anywhere.
    rotation: { ...quatFromTo({ x: 0, y: 1, z: 0 }, upAt(planet, position)) },
    components: { machine: { machineType: 'habitat' } },
  });
  events.emit('actionApplied', { type: 'spawnHabitat' });
}

/**
 * Seat a new tether on the ground under the player: march down along -up
 * through the live (edited) density field for the first air->solid crossing.
 * Falls back to the player's feet when nothing is hit (mid-air placement).
 */
export function seatTetherOnGround(
  world: World,
  planetId: string,
  playerPos: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) return { ...playerPos };
  const up = upAt(planet, playerPos);
  const local = {
    x: playerPos.x - planet.center.x,
    y: playerPos.y - planet.center.y,
    z: playerPos.z - planet.center.z,
  };
  const live = (x: number, y: number, z: number): number =>
    baseFieldFor(world, planet.id).density(x, y, z) +
    world.terrainEdits.deltaAt(planet, planet.id, x, y, z);
  const step = 0.25;
  const top = 1.0;
  const bottom = -TETHER_GROUND_SEARCH_M;
  let prevT = top;
  let prevD = live(local.x + up.x * prevT, local.y + up.y * prevT, local.z + up.z * prevT);
  for (let t = top - step; t >= bottom; t -= step) {
    const d = live(local.x + up.x * t, local.y + up.y * t, local.z + up.z * t);
    if (prevD < 0 && d >= 0) {
      // Bisect the crossing (surface at density 0).
      let lo = t;
      let hi = prevT;
      for (let i = 0; i < 8; i += 1) {
        const mid = (lo + hi) / 2;
        const md = live(local.x + up.x * mid, local.y + up.y * mid, local.z + up.z * mid);
        if (md >= 0) hi = mid;
        else lo = mid;
      }
      const hit = (lo + hi) / 2;
      return {
        x: playerPos.x + up.x * hit,
        y: playerPos.y + up.y * hit,
        z: playerPos.z + up.z * hit,
      };
    }
    prevT = t;
    prevD = d;
  }
  return { x: playerPos.x - up.x, y: playerPos.y - up.y, z: playerPos.z - up.z };
}

/** Spend one backpack Tether item on a post under the player. */
export function placeTether(world: World, playerId: EntityId): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = playerEntity ? backpackFor(playerEntity) : null;
  const player = playerEntity?.components.player;
  if (!playerEntity || playerEntity.kind !== 'player' || !inventory || !player || !playerEntity.planetId) {
    events.emit('actionApplied', { type: 'placeTether' });
    return;
  }
  const slot = inventory.slots.findIndex(
    (id) => id !== null && world.entities.get(id)?.components.item?.itemId === 'tether',
  );
  if (slot === -1) {
    // No tether item to spend: the keypress is heard but does nothing.
    events.emit('actionApplied', { type: 'placeTether' });
    return;
  }
  const spentId = inventory.slots[slot] as EntityId;
  world.entities.delete(spentId);
  inventory.slots[slot] = null;
  const planet = world.planets.find((p) => p.id === playerEntity.planetId);
  const position = seatTetherOnGround(world, playerEntity.planetId, playerEntity.position);
  const up = planet ? upAt(planet, playerEntity.position) : { x: 0, y: 1, z: 0 };
  const id = world.nextId('tether');
  world.entities.set(id, {
    id,
    kind: 'tether',
    planetId: playerEntity.planetId,
    position,
    rotation: { ...quatFromTo({ x: 0, y: 1, z: 0 }, up) },
    components: { tether: { live: false, links: [] } },
  });
  events.emit('actionApplied', { type: 'placeTether' });
}

/**
 * E on a tether pulls the post back up: the entity is removed and a Tether
 * item returns to the backpack (or drops at the post when the pack is full).
 */
export function removeTether(world: World, playerId: EntityId, tetherId: EntityId): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = playerEntity ? backpackFor(playerEntity) : null;
  if (!playerEntity || !inventory) {
    events.emit('actionApplied', { type: 'removeTether' });
    return;
  }
  const tether = world.entities.get(tetherId);
  if (
    !tether ||
    tether.kind !== 'tether' ||
    tether.planetId !== playerEntity.planetId ||
    distance(tether.position, playerEntity.position) > PICKUP_RANGE_M
  ) {
    events.emit('actionApplied', { type: 'removeTether' });
    return;
  }
  const position = { ...tether.position };
  const planetId = tether.planetId;
  world.entities.delete(tetherId);
  const free = inventory.slots.indexOf(null);
  const id = world.nextId('item');
  if (free === -1) {
    world.entities.set(id, {
      id,
      kind: 'item',
      planetId,
      position,
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'tether' } },
    });
  } else {
    inventory.slots[free] = id;
    world.entities.set(id, {
      id,
      kind: 'item',
      planetId,
      position,
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'tether', holder: playerId } },
    });
  }
  events.emit('actionApplied', { type: 'removeTether' });
}

