// Dev-only teleport (M13): drop the player on Vorn's surface for testing
// without flying there. Gated on ?dev=1 so normal play can never trigger it.
// Uses the existing playerTeleport Action (hard rule 2); the physics system's
// SOI transfer relabels the planet on the next tick.

import { getUrlParams } from '../core/urlParams.js';
import { VORN } from '../planets/configs/vorn.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { EntityId } from '../sim/entities.js';
import { findSpawnPosition } from '../sim/physics/spawn.js';
import type { World } from '../sim/world.js';

/** True when the debug key is allowed in this session. */
export function devTeleportEnabled(): boolean {
  return getUrlParams().dev;
}

/**
 * Dispatch a teleport to the Vorn spawn. Returns true when a teleport was
 * dispatched (dev mode, a live player, and a Vorn config present).
 */
export function teleportToVorn(
  world: World,
  planets: PlanetConfig[],
  playerId: EntityId | null,
): boolean {
  if (!devTeleportEnabled()) return false;
  if (!playerId || !world.entities.has(playerId)) return false;
  const vorn = planets.find((planet) => planet.id === VORN.id);
  if (!vorn) return false;
  world.dispatch({ type: 'playerTeleport', playerId, position: findSpawnPosition(vorn, world.seed) });
  return true;
}
