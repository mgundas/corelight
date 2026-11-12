// Grab-carry actions (cursor mode). The first LMB grabs a loose item; it
// levitates in front of the player (systems/grab.ts) and the second LMB
// releases it. Releasing a packaged placeable resolves the normal placement
// rules (ground / platform snap / platform slot); anything else drops loose.

import { GRAB_RANGE_M, GRAB_RELEASE_RANGE_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance, IDENTITY_QUAT, sub, type Vec3d } from '../core/math.js';
import { placeableForPackageItem } from '../data/loadPlaceables.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { isItemLike, type EntityId } from './entities.js';
import { moveBasis, upAt } from './physics/frames.js';
import { spawnPlaceableEntity } from './placeActions.js';
import { resolvePlacement, type PlacementTarget } from './placeResolve.js';
import { baseFieldFor } from './tetherActions.js';
import type { World } from './world.js';

/** First click: take a loose item into the levitating carry. */
export function grabItem(world: World, playerId: EntityId, itemId: EntityId): void {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const item = world.entities.get(itemId);
  const itemComp = item?.components.item;
  if (!player || !playerComp || !item || !itemComp || !isItemLike(item)) {
    events.emit('actionApplied', { type: 'grabItem' });
    return;
  }
  if (
    itemComp.holder !== undefined ||
    itemComp.grabbedBy !== undefined ||
    playerComp.grabbed ||
    item.planetId !== player.planetId ||
    distance(item.position, player.position) > GRAB_RANGE_M
  ) {
    events.emit('actionApplied', { type: 'grabItem' });
    return;
  }
  playerComp.grabbed = itemId;
  itemComp.grabbedBy = playerId;
  events.emit('actionApplied', { type: 'grabItem' });
}

/**
 * Second click: release. A packaged placeable resolves into a placed entity
 * when the requested spot/target is valid; otherwise (or for resources) the
 * item drops loose at the requested point (range-clamped).
 */
export function releaseGrabbed(
  world: World,
  playerId: EntityId,
  requested: Vec3d | null,
  target: PlacementTarget | null = null,
  allowPlace = true,
): void {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const itemId = playerComp?.grabbed ?? null;
  if (!player || !playerComp || !player.planetId || !itemId) {
    events.emit('actionApplied', { type: 'releaseGrabbed' });
    return;
  }
  const item = world.entities.get(itemId);
  const itemComp = item?.components.item;
  if (!item || !itemComp) {
    playerComp.grabbed = null;
    events.emit('actionApplied', { type: 'releaseGrabbed' });
    return;
  }
  playerComp.grabbed = null;
  delete itemComp.grabbedBy;
  const planet = world.planets.find((p) => p.id === player.planetId);
  if (!planet) {
    events.emit('actionApplied', { type: 'releaseGrabbed' });
    return;
  }
  const finite =
    requested !== null &&
    Number.isFinite(requested.x) &&
    Number.isFinite(requested.y) &&
    Number.isFinite(requested.z);
  const inRange = finite && requested !== null && distance(requested, player.position) <= GRAB_RELEASE_RANGE_M;
  let spot: Vec3d = inRange && requested ? { ...requested } : dropAhead(planet, player.position, playerComp.yaw);
  // Releasing into rock would bury the item: fall back to the clear spot in
  // front of the player (the item owns no body while grabbed, so nothing
  // would push it out).
  if (isSolidAt(world, planet, spot)) {
    spot = dropAhead(planet, player.position, playerComp.yaw);
  }
  // Packaged placeables place like the normal ghost flow; a failed resolve
  // (no room, wrong ground) falls through to a loose package drop.
  const def = placeableForPackageItem(itemComp.itemId);
  if (def && allowPlace) {
    const resolved = resolvePlacement(world, planet.id, def.id, spot, player.position, target);
    if (resolved.ok && resolved.placement) {
      world.entities.delete(itemId);
      const { position, ...spawnOpts } = resolved.placement;
      spawnPlaceableEntity(world, planet.id, def.id, position, spawnOpts);
      events.emit('actionApplied', { type: 'releaseGrabbed' });
      return;
    }
  }
  const up = upAt(planet, spot);
  item.position = {
    x: spot.x + up.x * 0.4,
    y: spot.y + up.y * 0.4,
    z: spot.z + up.z * 0.4,
  };
  item.planetId = planet.id;
  item.rotation = { ...IDENTITY_QUAT };
  events.emit('actionApplied', { type: 'releaseGrabbed' });
}

function dropAhead(planet: PlanetConfig, playerPosition: Vec3d, yaw: number): Vec3d {
  const up = upAt(planet, playerPosition);
  // Yaw-leveled forward: pitching straight down must not bury the item.
  const { forward } = moveBasis(up, yaw, 0);
  return {
    x: playerPosition.x + forward.x * 1.5 + up.x * 0.5,
    y: playerPosition.y + forward.y * 1.5 + up.y * 0.5,
    z: playerPosition.z + forward.z * 1.5 + up.z * 0.5,
  };
}

function isSolidAt(world: World, planet: PlanetConfig, worldPos: Vec3d): boolean {
  const local = sub(worldPos, planet.center);
  const base = baseFieldFor(world, planet.id).density(local.x, local.y, local.z);
  const edited = world.terrainEdits.deltaAt(planet, planet.id, local.x, local.y, local.z);
  return base + edited >= 0.2;
}
