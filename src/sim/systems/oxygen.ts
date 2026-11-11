// Oxygen system (M08): players breathe from the tether network, burn
// canisters in emergencies, and suffocate back at the habitat otherwise.
//
// Each tick, per player: inside OXYGEN_RANGE_M of a live tether or any
// habitat the suit refills at OXYGEN_REFILL_PER_S; off-network it drains at
// OXYGEN_DRAIN_PER_S times the hazard multiplier (mantle heat 2x, Vorn
// surface cold 1.5x — the Vorn branch is a hook for M13, harmless on Sela).
// A carried oxygen canister auto-fires at OXYGEN_CANISTER_THRESHOLD and
// refills to full. At 0 the player drops every carried item where they
// stand, leaves a lost-backpack marker, and wakes up at the habitat.

import {
  BACKPACK_SLOTS,
  OXYGEN_CANISTER_THRESHOLD,
  OXYGEN_DRAIN_PER_S,
  OXYGEN_MANTLE_MULT,
  OXYGEN_MAX,
  OXYGEN_RANGE_M,
  OXYGEN_REFILL_PER_S,
  OXYGEN_VORN_COLD_MULT,
  PICKUP_RANGE_M,
} from '../../core/constants.js';
import { events } from '../../core/events.js';
import { distance, IDENTITY_QUAT } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { layerAt } from '../../terrain/density.js';
import { upAt } from '../physics/frames.js';
import type { Entity, EntityId } from '../entities.js';
import type { World } from '../world.js';
import { habitatsOn, liveTethersNear } from './tethers.js';

/** Off-network drain multiplier for a planet-local point (hookable per planet). */
export function hazardMultiplier(planet: PlanetConfig, local: { x: number; y: number; z: number }): number {
  const layer = layerAt(planet, local.x, local.y, local.z);
  if (layer.name === 'mantle') return OXYGEN_MANTLE_MULT;
  // Vorn's surface cold (PROJECT.md: 1.5x). No Vorn config exists yet (M13),
  // so on Sela this branch never fires; it is pinned by a test with a
  // renamed Sela config.
  if (planet.id === 'vorn' && layer.name === 'surface') return OXYGEN_VORN_COLD_MULT;
  return 1;
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
  const habitat = planet ? habitatsOn(world, planet.id)[0] : undefined;
  // NOTE: single-habitat v1 respawns at habitats[0]; with several habitats
  // this must become the last visited one (PROJECT.md). Latent until M10+.
  if (habitat && planet) {
    const hub = upAt(planet, habitat.position);
    player.position = {
      x: habitat.position.x + hub.x * 2,
      y: habitat.position.y + hub.y * 2,
      z: habitat.position.z + hub.z * 2,
    };
    player.planetId = planet.id;
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
