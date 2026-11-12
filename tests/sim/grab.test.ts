// Grab-carry actions + follow system: click grabs a loose item, it levitates
// in front of the player, and the second click drops it (or places a packaged
// placeable through the normal resolve rules).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { GRAB_DISTANCE_M } from '../../src/core/constants.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { EntityId } from '../../src/sim/entities.js';
import { grabItem, releaseGrabbed } from '../../src/sim/grabActions.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { slotWorld } from '../../src/sim/snapUtils.js';
import { updateGrab } from '../../src/sim/systems/grab.js';
import { World } from '../../src/sim/world.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat grab world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface Ctx {
  world: World;
  planet: PlanetConfig;
  playerId: EntityId;
}

function context(): Ctx {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 2 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, planet, playerId };
}

function looseItem(ctx: Ctx, itemId: string, offset: { x: number; y: number; z: number }): EntityId {
  const player = ctx.world.entities.get(ctx.playerId);
  if (!player) throw new Error('no player');
  const id = ctx.world.nextId('item');
  ctx.world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { x: player.position.x + offset.x, y: player.position.y + offset.y, z: player.position.z + offset.z },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId } },
  });
  return id;
}

describe('grab-carry', () => {
  it('grabs a loose item in range and levitates it in front of the player', () => {
    const ctx = context();
    const itemId = looseItem(ctx, 'resin', { x: 0, y: 0, z: 0.8 });
    grabItem(ctx.world, ctx.playerId, itemId);
    const player = ctx.world.entities.get(ctx.playerId);
    const item = ctx.world.entities.get(itemId);
    expect(player?.components.player?.grabbed).toBe(itemId);
    expect(item?.components.item?.grabbedBy).toBe(ctx.playerId);
    updateGrab(ctx.world, [ctx.planet]);
    const playerPos = ctx.world.entities.get(ctx.playerId)?.position;
    const itemPos = ctx.world.entities.get(itemId)?.position;
    if (!playerPos || !itemPos) throw new Error('missing positions');
    // Yaw 0 faces +X on the flat test basis: the item hovers ahead.
    expect(itemPos.x - playerPos.x).toBeCloseTo(GRAB_DISTANCE_M, 3);
    expect(itemPos.y).toBeGreaterThan(playerPos.y);
  });

  it('rejects out-of-range items and items already held', () => {
    const ctx = context();
    const far = looseItem(ctx, 'resin', { x: 0, y: 0, z: 10 });
    grabItem(ctx.world, ctx.playerId, far);
    expect(ctx.world.entities.get(ctx.playerId)?.components.player?.grabbed).toBe(null);

    const held = looseItem(ctx, 'silicate', { x: 0, y: 0, z: 0.5 });
    const heldComp = ctx.world.entities.get(held)?.components.item;
    if (!heldComp) throw new Error('missing item');
    heldComp.holder = ctx.playerId;
    grabItem(ctx.world, ctx.playerId, held);
    expect(ctx.world.entities.get(ctx.playerId)?.components.player?.grabbed).toBe(null);
  });

  it('releases the item at the requested point and clears the carry', () => {
    const ctx = context();
    const itemId = looseItem(ctx, 'resin', { x: 0, y: 0, z: 0.8 });
    grabItem(ctx.world, ctx.playerId, itemId);
    updateGrab(ctx.world, [ctx.planet]);
    releaseGrabbed(ctx.world, ctx.playerId, { x: 0, y: ctx.planet.radius, z: 3 });
    const player = ctx.world.entities.get(ctx.playerId);
    const item = ctx.world.entities.get(itemId);
    expect(player?.components.player?.grabbed).toBe(null);
    expect(item?.components.item?.grabbedBy).toBeUndefined();
    expect(item?.position.z).toBeCloseTo(3, 2);
    expect(item?.position.y).toBeCloseTo(ctx.planet.radius + 0.4, 2);
  });

  it('stowing (allowPlace=false) drops a packaged placeable loose', () => {
    const ctx = context();
    const packageId = looseItem(ctx, 'solar_panel_package', { x: 0, y: 0, z: 0.8 });
    grabItem(ctx.world, ctx.playerId, packageId);
    updateGrab(ctx.world, [ctx.planet]);
    releaseGrabbed(ctx.world, ctx.playerId, null, null, false);
    expect(ctx.world.entities.has(packageId)).toBe(true);
    expect(ctx.world.entities.get(packageId)?.components.item?.grabbedBy).toBeUndefined();
    const panels = [...ctx.world.entities.values()].filter(
      (e) => e.components.machine?.machineType === 'solar_panel',
    );
    expect(panels).toHaveLength(0);
  });

  it('places a packaged placeable into a free platform slot on release', () => {    const ctx = context();
    const platformId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: 1,
      y: ctx.planet.radius,
      z: 2,
    }) as EntityId;
    const platform = ctx.world.entities.get(platformId);
    if (!platform) throw new Error('no platform');
    const slot = slotWorld(platform, 0);
    if (!slot) throw new Error('no slot');
    const packageId = looseItem(ctx, 'solar_panel_package', { x: 0, y: 0, z: 0.8 });
    grabItem(ctx.world, ctx.playerId, packageId);
    updateGrab(ctx.world, [ctx.planet]);
    releaseGrabbed(ctx.world, ctx.playerId, slot, {
      slot: { entityId: platformId, slotIndex: 0 },
    });
    expect(ctx.world.entities.has(packageId)).toBe(false);
    const panels = [...ctx.world.entities.values()].filter(
      (e) => e.components.machine?.machineType === 'solar_panel',
    );
    expect(panels).toHaveLength(1);
    expect(panels[0]?.components.placeable?.attachedTo).toBe(platformId);
  });
});
