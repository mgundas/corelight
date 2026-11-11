// Habitat + tether action handlers (M08). Split out of actions.ts to keep
// both files under the 400-line hard rule: placement math (ground seating,
// backpack spend/refund) lives here, dispatch stays in applyAction.

import { distance, dot, IDENTITY_QUAT, normalize, quatFromTo, sub } from '../core/math.js';
import { PICKUP_RANGE_M, TETHER_GROUND_SEARCH_M, TETHER_PLACE_AHEAD_M, TETHER_SEAT_TOP_M } from '../core/constants.js';
import { events } from '../core/events.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../terrain/density.js';
import type { EntityId } from './entities.js';
import { inventoryFor } from './inventoryActions.js';
import { moveBasis, upAt } from './physics/frames.js';
import type { World } from './world.js';

/** Backpack, lazily created (old M06 saves predate inventory). */

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
 * Seat a post at a ground anchor: march down along -up through the live
 * (edited) density field for the first air->solid crossing. Starts well
 * above the anchor to clear overhangs; falls back to 1 m below the anchor
 * when nothing is hit (mid-air placement).
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
  const top = TETHER_SEAT_TOP_M;
  const bottom = -TETHER_GROUND_SEARCH_M;
  let prevT = top;
  let prevD = live(local.x + up.x * prevT, local.y + up.y * prevT, local.z + up.z * prevT);
  for (let t = top - step; t >= bottom; t -= step) {
    const d = live(local.x + up.x * t, local.y + up.y * t, local.z + up.z * t);
    if (prevD < 0 && d >= 0) {
      // Bisect the crossing (surface at density 0). lo is the solid side
      // (lower t), hi the air side (upper t): solid mids pull lo up, air
      // mids pull hi down, so the interval always brackets the zero.
      let lo = t;
      let hi = prevT;
      for (let i = 0; i < 8; i += 1) {
        const mid = (lo + hi) / 2;
        const md = live(local.x + up.x * mid, local.y + up.y * mid, local.z + up.z * mid);
        if (md >= 0) lo = mid;
        else hi = mid;
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

/**
 * Seat a point `aheadM` in front of the player (yaw-leveled look) on the
 * ground. Shared by tethers and light sticks so both are placed visibly in
 * front of the astronaut instead of inside the capsule.
 */
export function seatAheadOnGround(
  world: World,
  planet: PlanetConfig,
  playerPos: { x: number; y: number; z: number },
  yaw: number,
  aheadM = TETHER_PLACE_AHEAD_M,
): { x: number; y: number; z: number } {
  const up = upAt(planet, playerPos);
  // Level the look direction (yaw only): pitching up must not skydrop the
  // post, pitching down must not plant it inside the boots.
  const { forward } = moveBasis(up, yaw, 0);
  const flat = sub(forward, { x: up.x * dot(forward, up), y: up.y * dot(forward, up), z: up.z * dot(forward, up) });
  const ahead = dot(flat, flat) > 1e-6 ? normalize(flat) : forward;
  const anchor = {
    x: playerPos.x + ahead.x * aheadM,
    y: playerPos.y + ahead.y * aheadM,
    z: playerPos.z + ahead.z * aheadM,
  };
  return seatTetherOnGround(world, planet.id, anchor);
}

/** Spend one backpack Tether item on a post ahead of the player. The post
 * lands TETHER_PLACE_AHEAD_M in front (level with the look yaw): seating it
 * under the feet buries it inside the astronaut where no camera can see it. */
export function placeTether(world: World, playerId: EntityId): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = playerEntity ? inventoryFor(world, playerId) : null;
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
  const planet = world.planets.find((p) => p.id === playerEntity.planetId);
  if (!planet) {
    events.emit('actionApplied', { type: 'placeTether' });
    return;
  }
  const spentId = inventory.slots[slot] as EntityId;
  world.entities.delete(spentId);
  inventory.slots[slot] = null;
  const up = upAt(planet, playerEntity.position);
  const position = seatAheadOnGround(world, planet, playerEntity.position, player.yaw);
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
  const inventory = playerEntity ? inventoryFor(world, playerId) : null;
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

