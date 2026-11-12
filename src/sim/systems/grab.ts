// Grab-carry follow system: the grabbed item levitates in front of the
// player, following the aim. Direct position writes are the same pattern the
// items system uses for body read-back; the item owns no Rapier body while
// grabbedBy is set. The target is pulled toward the player until it is out of
// solid terrain, so aiming into a wall cannot bury the item.

import { GRAB_DISTANCE_M, GRAB_LEVITATE_M } from '../../core/constants.js';
import { sub, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { isItemLike } from '../entities.js';
import { moveBasis, upAt } from '../physics/frames.js';
import { baseFieldFor } from '../tetherActions.js';
import type { World } from '../world.js';

export function updateGrab(world: World, planets: PlanetConfig[]): void {
  for (const player of world.entities.values()) {
    const playerComp = player.components.player;
    if (!playerComp || playerComp.grabbed === undefined || playerComp.grabbed === null) continue;
    const item = world.entities.get(playerComp.grabbed);
    const itemComp = item?.components.item;
    const planet = planets.find((p) => p.id === player.planetId);
    if (
      !item ||
      !itemComp ||
      !isItemLike(item) ||
      itemComp.grabbedBy !== player.id ||
      !planet
    ) {
      // Stale reference (item consumed/deleted): drop the carry state.
      playerComp.grabbed = null;
      continue;
    }
    const target = carryTarget(world, planet, player.position, playerComp.yaw, playerComp.pitch);
    item.position = target;
    item.planetId = planet.id;
  }
}

function carryTarget(
  world: World,
  planet: PlanetConfig,
  playerPos: Vec3d,
  yaw: number,
  pitch: number,
): Vec3d {
  const up = upAt(planet, playerPos);
  const { forward } = moveBasis(up, yaw, pitch);
  const desired: Vec3d = {
    x: playerPos.x + forward.x * GRAB_DISTANCE_M + up.x * GRAB_LEVITATE_M,
    y: playerPos.y + forward.y * GRAB_DISTANCE_M + up.y * GRAB_LEVITATE_M,
    z: playerPos.z + forward.z * GRAB_DISTANCE_M + up.z * GRAB_LEVITATE_M,
  };
  if (!isSolid(world, planet, desired)) return desired;
  // Aiming into rock: slide the item back toward the player until it is in
  // air, keeping it visible instead of inside the wall.
  for (let t = 0.8; t > 0.15; t -= 0.1) {
    const candidate: Vec3d = {
      x: playerPos.x + forward.x * GRAB_DISTANCE_M * t + up.x * GRAB_LEVITATE_M,
      y: playerPos.y + forward.y * GRAB_DISTANCE_M * t + up.y * GRAB_LEVITATE_M,
      z: playerPos.z + forward.z * GRAB_DISTANCE_M * t + up.z * GRAB_LEVITATE_M,
    };
    if (!isSolid(world, planet, candidate)) return candidate;
  }
  return {
    x: playerPos.x + up.x * 0.8,
    y: playerPos.y + up.y * 0.8,
    z: playerPos.z + up.z * 0.8,
  };
}

function isSolid(world: World, planet: PlanetConfig, worldPos: Vec3d): boolean {
  const local = sub(worldPos, planet.center);
  const base = baseFieldFor(world, planet.id).density(local.x, local.y, local.z);
  const edited = world.terrainEdits.deltaAt(planet, planet.id, local.x, local.y, local.z);
  return base + edited >= 0.2;
}
