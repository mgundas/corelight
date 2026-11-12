// M10 snap placement: rim-snapped platforms join at the exact snap point,
// machines attach to platform top slots, occupied targets are rejected, and
// the aim-ray helper picks the same targets the ghost/action use.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT, distance, normalize, sub } from '../../src/core/math.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { resolvePlacement, type PlacementTarget } from '../../src/sim/placeResolve.js';
import { snapWorld, slotWorld } from '../../src/sim/snapUtils.js';
import { createCableEntity } from '../../src/sim/snapUtils.js';
import { World } from '../../src/sim/world.js';
import { findPlacementTarget } from '../../src/game/snapTarget.js';
import type { ToolAim } from '../../src/player/terrainTool.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat snap world',
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
  surface: { x: number; y: number; z: number };
}

function context(): Ctx {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  const surface = { x: 0, y: planet.radius, z: 0 };
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 0 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, planet, playerId, surface };
}

function give(world: World, playerId: EntityId, itemId: string): EntityId {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const slot = inv.slots.indexOf(null);
  if (slot === -1) throw new Error('pack full');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  inv.slots[slot] = id;
  inv.selectedSlot = slot;
  return id;
}

function playerPos(ctx: Ctx) {
  const player = ctx.world.entities.get(ctx.playerId);
  if (!player) throw new Error('no player');
  return player.position;
}

function resolve(ctx: Ctx, placeableId: string, target: PlacementTarget) {
  return resolvePlacement(
    ctx.world,
    ctx.planet.id,
    placeableId,
    { x: 0, y: ctx.surface.y, z: 0 },
    playerPos(ctx),
    target,
  );
}

function place(ctx: Ctx, placeableId: string, target: PlacementTarget, position: { x: number; y: number; z: number }): void {
  ctx.world.dispatch({
    type: 'placePlaceable',
    playerId: ctx.playerId,
    placeableId,
    position,
    snap: target.snap,
    slot: target.slot,
  });
  ctx.world.tick();
}

describe('snapped platform placement', () => {
  it('joins at the exact rim snap and stores the join metadata', () => {
    const ctx = context();
    const targetId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: -1,
      y: ctx.surface.y,
      z: 0,
    }) as EntityId;
    const target = ctx.world.entities.get(targetId);
    if (!target) throw new Error('no target platform');
    give(ctx.world, ctx.playerId, 'platform_package');
    const resolved = resolve(ctx, 'platform', { snap: { entityId: targetId, snapIndex: 0 } });
    expect(resolved.ok).toBe(true);
    expect(resolved.placement?.snapTo).toBe(targetId);
    expect(resolved.placement?.snapToSnap).toBe(0);
    expect(resolved.placement?.snapOwnSnap).toBe(2);
    place(ctx, 'platform', { snap: { entityId: targetId, snapIndex: 0 } }, resolved.placement?.position ?? ctx.surface);
    const placed = [...ctx.world.entities.values()].find(
      (e) => e.kind === 'platform' && e.id !== targetId,
    );
    if (!placed) throw new Error('no placed platform');
    expect(placed.components.placeable?.snappedTo).toBe(targetId);
    expect(placed.components.placeable?.snappedToSnap).toBe(0);
    const expected = snapWorld(target, 0);
    const actual = snapWorld(placed, placed.components.placeable?.snappedOwnSnap ?? 0);
    if (!expected || !actual) throw new Error('no snap world');
    expect(distance(expected, actual)).toBeLessThan(1e-6);
    // A second join on the used rim snap is refused; another rim point works.
    expect(resolve(ctx, 'platform', { snap: { entityId: targetId, snapIndex: 0 } }).ok).toBe(false);
    expect(resolve(ctx, 'platform', { snap: { entityId: targetId, snapIndex: 1 } }).ok).toBe(true);
  });

  it('rejects a platform placed into a slot and a machine placed on a rim snap', () => {
    const ctx = context();
    const platformId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', ctx.surface) as EntityId;
    expect(resolve(ctx, 'platform', { slot: { entityId: platformId, slotIndex: 0 } }).ok).toBe(false);
    expect(resolve(ctx, 'small_printer', { snap: { entityId: platformId, snapIndex: 0 } }).ok).toBe(false);
  });
});

describe('platform slot attachment', () => {
  it('attaches a machine at the slot world transform and frees it when packed', () => {
    const ctx = context();
    const platformId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', ctx.surface) as EntityId;
    const platform = ctx.world.entities.get(platformId);
    if (!platform) throw new Error('no platform');
    give(ctx.world, ctx.playerId, 'small_printer_package');
    const resolved = resolve(ctx, 'small_printer', { slot: { entityId: platformId, slotIndex: 1 } });
    expect(resolved.ok).toBe(true);
    expect(resolved.placement?.attachTo).toBe(platformId);
    expect(resolved.placement?.attachSlot).toBe(1);
    const expected = slotWorld(platform, 1);
    if (!expected || !resolved.placement) throw new Error('no slot world');
    expect(distance(expected, resolved.placement.position)).toBeLessThan(1e-6);
    place(ctx, 'small_printer', { slot: { entityId: platformId, slotIndex: 1 } }, resolved.placement.position);
    const printer = [...ctx.world.entities.values()].find(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'small_printer',
    );
    expect(printer?.components.placeable?.attachedTo).toBe(platformId);
    expect(printer?.components.placeable?.attachedSlot).toBe(1);
    // The same slot is now occupied; an out-of-range index is refused.
    expect(resolve(ctx, 'battery', { slot: { entityId: platformId, slotIndex: 1 } }).ok).toBe(false);
    expect(resolve(ctx, 'battery', { slot: { entityId: platformId, slotIndex: 9 } }).ok).toBe(false);
  });
});

describe('aim target picking', () => {
  function aimAt(origin: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }): ToolAim {
    return {
      hit: null,
      normal: null,
      planet: null,
      ray: { origin: { ...origin }, dir: normalize(sub(point, origin)) },
    };
  }

  it('picks free slots for machines and free rim snaps for platforms', () => {
    const ctx = context();
    const platformId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', ctx.surface) as EntityId;
    const platform = ctx.world.entities.get(platformId);
    if (!platform) throw new Error('no platform');
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player) throw new Error('no player');
    const head = { x: player.position.x, y: player.position.y + 1.5, z: player.position.z };
    const slot = slotWorld(platform, 1);
    const rim = snapWorld(platform, 0);
    if (!slot || !rim) throw new Error('no target');
    const slotAim = aimAt(head, slot);
    expect(findPlacementTarget(ctx.world, ctx.playerId, 'small_printer', slotAim)).toEqual({
      slot: { entityId: platformId, slotIndex: 1 },
    });
    const rimAim = aimAt(head, rim);
    const target = findPlacementTarget(ctx.world, ctx.playerId, 'platform', rimAim);
    expect(target?.snap?.entityId).toBe(platformId);
    // Cabling the rim snap makes it unavailable to placement.
    const cableSnap = target?.snap;
    if (!cableSnap) throw new Error('no rim target');
    createCableEntity(
      ctx.world,
      ctx.planet.id,
      cableSnap,
      { entityId: spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', { x: 6, y: ctx.surface.y, z: 6 }) as EntityId, snapIndex: 0 },
    );
    expect(findPlacementTarget(ctx.world, ctx.playerId, 'platform', rimAim)).toBe(null);
  });
});
