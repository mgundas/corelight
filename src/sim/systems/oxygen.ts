// Oxygen system (M08): players breathe from the tether network, burn
// canisters in emergencies, and suffocate back at the habitat otherwise.
//
// Each tick, per player: inside OXYGEN_RANGE_M of a live tether or any
// habitat the suit refills at OXYGEN_REFILL_PER_S; off-network it drains at
// OXYGEN_DRAIN_PER_S times the hazard multiplier. Hazards are planet-config
// data (Sela's mantle heat 2x, Vorn's cold surface 1.5x and mantle 2x), so
// adding a hazard needs no code change here (M12/M13).
// A carried oxygen canister auto-fires at OXYGEN_CANISTER_THRESHOLD and
// refills to full. At 0 the player drops every carried item where they
// stand, leaves a lost-backpack marker, and wakes up at the habitat.

import {
  BACKPACK_SLOTS,
  OXYGEN_CANISTER_THRESHOLD,
  OXYGEN_DRAIN_PER_S,
  OXYGEN_MAX,
  OXYGEN_RANGE_M,
  OXYGEN_REFILL_PER_S,
  PICKUP_RANGE_M,
} from '../../core/constants.js';
import { events } from '../../core/events.js';
import { distance, IDENTITY_QUAT } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { layerAt } from '../../terrain/density.js';
import { upAt } from '../physics/frames.js';
import { findSpawnPosition } from '../physics/spawn.js';
import type { Entity, EntityId } from '../entities.js';
import type { World } from '../world.js';
import { habitatsOn, liveTethersNear } from './tethers.js';

/** Off-network drain multiplier for a planet-local point. Pure data:
 * a layer's `hazardOxygenMult` (Sela mantle 2x, Vorn cold 1.5x / heat 2x). */
export function hazardMultiplier(planet: PlanetConfig, local: { x: number; y: number; z: number }): number {
  const layer = layerAt(planet, local.x, local.y, local.z);
  return layer.hazardOxygenMult ?? 1;
}

/** True when the player breathes from a habitat or a live tether. */
export function isOnOxygenNetwork(world: World, playerId: EntityId): boolean {
  const player = world.entities.get(playerId);
  if (!player || player.kind !== 'player' || !player.planetId) return false;
  for (const habitat of habitatsOn(world, player.planetId)) {
    if (distance(habitat.position, player.position) <= OXYGEN_RANGE_M) return true;
  }
  return liveTethersNear(world, player.planetId, player.position, OXYGEN_RANGE_M).length > 0;
}

function oxygenFor(player: Entity): { value: number } {
  let oxygen = player.components.oxygen;
  if (!oxygen) {
    // Old saves predate oxygen (M06/M07): start full, never punish a load.
    oxygen = { value: OXYGEN_MAX };
    player.components.oxygen = oxygen;
  }
  return oxygen;
}

function consumeCanister(world: World, player: Entity): boolean {
  let inventory = player.components.inventory;
  if (player.kind === 'player' && player.components.player && !inventory) {
    // Old saves predate backpacks (M06): create before spending.
    inventory = { slots: Array<EntityId | null>(BACKPACK_SLOTS).fill(null), selectedSlot: 0 };
    player.components.inventory = inventory;
  }
  if (!inventory) return false;
  const slot = inventory.slots.findIndex(
    (id) => id !== null && world.entities.get(id)?.components.item?.itemId === 'oxygen_canister',
  );
  if (slot === -1) return false;
  const spentId = inventory.slots[slot] as EntityId;
  world.entities.delete(spentId);
  inventory.slots[slot] = null;
  return true;
}

/**
 * Where a dead player wakes. PROJECT.md: "respawn at the last habitat". A
 * habitat on the death planet wins; otherwise the nearest habitat anywhere
 * (M13: Vorn has no habitat until the M14 kit, so a Vorn death returns the
 * player to Sela instead of leaving them to die in place forever). With no
 * habitat at all, fall back to the death planet's surface spawn; deep space
 * without a habitat stays put.
 */
function respawnFor(
  world: World,
  planets: PlanetConfig[],
  player: Entity,
  deathPlanet: PlanetConfig | undefined,
): { planetId: string; position: { x: number; y: number; z: number } } | null {
  let hub: { planet: PlanetConfig; position: { x: number; y: number; z: number } } | null = null;
  const samePlanet = deathPlanet ? habitatsOn(world, deathPlanet.id)[0] : undefined;
  if (samePlanet && deathPlanet) hub = { planet: deathPlanet, position: samePlanet.position };
  if (!hub) {
    let best = Infinity;
    for (const planet of planets) {
      for (const habitat of habitatsOn(world, planet.id)) {
        const d = distance(habitat.position, player.position);
        if (d < best) {
          best = d;
          hub = { planet, position: habitat.position };
        }
      }
    }
  }
  if (hub) {
    const up = upAt(hub.planet, hub.position);
    return {
      planetId: hub.planet.id,
      position: {
        x: hub.position.x + up.x * 2,
        y: hub.position.y + up.y * 2,
        z: hub.position.z + up.z * 2,
      },
    };
  }
  if (!deathPlanet) return null;
  return { planetId: deathPlanet.id, position: findSpawnPosition(deathPlanet, world.seed) };
}

/**
 * Death: every carried item drops in a ring at the death position, a
 * lost-backpack marker stays behind, and the player wakes at the habitat
 * with a full suit. Emits `playerDied` for the fade-to-black.
 */
function die(world: World, player: Entity, planets: PlanetConfig[]): void {
  const planet = planets.find((p) => p.id === player.planetId);
  const up = planet ? upAt(planet, player.position) : { x: 0, y: 1, z: 0 };
  const inventory = player.components.inventory;
  const deathPos = { ...player.position };
  let dropped = 0;
  if (inventory) {
    for (let i = 0; i < inventory.slots.length; i += 1) {
      const carriedId = inventory.slots[i];
      if (!carriedId) continue;
      const item = world.entities.get(carriedId);
      if (item) {
        // Golden-angle ring so a full pack does not stack into one point.
        const angle = dropped * 2.4;
        const radius = 0.4 + dropped * 0.15;
        item.position = {
          x: deathPos.x + Math.cos(angle) * radius + up.x * 0.5,
          y: deathPos.y + Math.sin(angle) * radius + up.y * 0.5,
          z: deathPos.z + Math.sin(angle * 1.7) * radius + up.z * 0.5,
        };
        item.planetId = player.planetId;
        item.rotation = { ...IDENTITY_QUAT };
        const itemComp = item.components.item;
        if (itemComp) delete itemComp.holder;
      }
      inventory.slots[i] = null;
      dropped += 1;
    }
  }
  // A front-carried large package drops with the rest of the pack.
  const playerComp = player.components.player;
  const largeId = playerComp?.carryingLarge;
  if (largeId) {
    const large = world.entities.get(largeId);
    if (large) {
      large.position = { ...deathPos };
      large.planetId = player.planetId;
      large.rotation = { ...IDENTITY_QUAT };
      const largeComp = large.components.item;
      if (largeComp) delete largeComp.holder;
    }
    playerComp.carryingLarge = null;
  }
  // A grab-carried item drops with the rest of the pack (cursor mode).
  const grabbedId = playerComp?.grabbed;
  if (grabbedId) {
    const grabbed = world.entities.get(grabbedId);
    if (grabbed) {
      grabbed.position = {
        x: deathPos.x + up.x * 0.5,
        y: deathPos.y + up.y * 0.5,
        z: deathPos.z + up.z * 0.5,
      };
      grabbed.planetId = player.planetId;
      grabbed.rotation = { ...IDENTITY_QUAT };
      const grabbedComp = grabbed.components.item;
      if (grabbedComp) delete grabbedComp.grabbedBy;
    }
    playerComp.grabbed = null;
  }
  // A second death supersedes the first: the old marker goes with it.
  if (playerComp?.deathMarkerId) {
    world.entities.delete(playerComp.deathMarkerId);
    playerComp.deathMarkerId = null;
  }
  const markerId = world.nextId('marker');
  world.entities.set(markerId, {
    id: markerId,
    kind: 'marker',
    planetId: player.planetId,
    position: { ...deathPos },
    rotation: { ...IDENTITY_QUAT },
    components: {},
  });
  if (playerComp) playerComp.deathMarkerId = markerId;
  // M13: habitats are cross-planet rescue now. The marker and the dropped
  // pack stay on the death planet; only the player teleports.
  const spawn = respawnFor(world, planets, player, planet);
  if (spawn) {
    player.position = spawn.position;
    player.planetId = spawn.planetId;
  }
  if (playerComp) {
    // Same reset as playerTeleport: no fall velocity, no stale input, out
    // of any embedded-escape latch so the respawn never pushes or drops.
    playerComp.velocity = { x: 0, y: 0, z: 0 };
    playerComp.grounded = false;
    playerComp.input = null;
    playerComp.embeddedTime = 0;
    playerComp.escaping = false;
  }
  const oxygen = oxygenFor(player);
  oxygen.value = OXYGEN_MAX;
  events.emit('playerDied', { playerId: player.id });
}

/** Sim system: refill/drain every player, then canisters, then death. */
export function updateOxygen(world: World, planets: PlanetConfig[], dt: number): void {
  for (const player of world.entities.values()) {
    if (player.kind !== 'player' || !player.components.player) continue;
    const planet = planets.find((p) => p.id === player.planetId);
    const oxygen = oxygenFor(player);
    // A recovered pack clears its marker once the player walks back to it.
    const playerComp = player.components.player;
    if (playerComp.deathMarkerId) {
      const marker = world.entities.get(playerComp.deathMarkerId);
      if (!marker) {
        playerComp.deathMarkerId = null;
      } else if (distance(marker.position, player.position) <= PICKUP_RANGE_M) {
        world.entities.delete(marker.id);
        playerComp.deathMarkerId = null;
      }
    }
    const onNetwork = planet ? isOnOxygenNetwork(world, player.id) : false;
    if (onNetwork) {
      oxygen.value = Math.min(OXYGEN_MAX, oxygen.value + OXYGEN_REFILL_PER_S * dt);
    } else if (planet) {
      const local = {
        x: player.position.x - planet.center.x,
        y: player.position.y - planet.center.y,
        z: player.position.z - planet.center.z,
      };
      oxygen.value = Math.max(0, oxygen.value - OXYGEN_DRAIN_PER_S * hazardMultiplier(planet, local) * dt);
    } else {
      // Deep space (no planet yet in v1 beyond SOIs): slow drain, no refill.
      oxygen.value = Math.max(0, oxygen.value - OXYGEN_DRAIN_PER_S * dt);
    }
    // Emergency canisters fire off-network only: arriving home at low O2
    // must refill from the habitat, not burn a packed canister.
    if (!onNetwork && oxygen.value <= OXYGEN_CANISTER_THRESHOLD && consumeCanister(world, player)) {
      oxygen.value = OXYGEN_MAX;
    }
    if (oxygen.value <= 0) {
      die(world, player, planets);
    }
  }
}
