// M10 pack-up: hold-E only folds an EMPTY placed object back into its
// package. Inputs/jobs/outputs, battery charge, attached machines and cables
// block it. Packing a platform clears neighbours' join refs.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity, snapFree, slotWorld } from '../../src/sim/snapUtils.js';
import { World } from '../../src/sim/world.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat pack world',
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

function pack(ctx: Ctx, entityId: EntityId): void {
  ctx.world.dispatch({ type: 'packUpPlaced', playerId: ctx.playerId, entityId });
  ctx.world.tick();
}

function itemIds(ctx: Ctx): (string | null)[] {
  const inv = ctx.world.entities.get(ctx.playerId)?.components.inventory;
  return (inv?.slots ?? []).map((id) =>
    id ? (ctx.world.entities.get(id)?.components.item?.itemId ?? null) : null,
  );
}

describe('pack-up rules', () => {
  it('packs an empty printer into its package item', () => {
    const ctx = context();
    const id = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'small_printer', ctx.surface) as EntityId;
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(false);
    expect(itemIds(ctx)).toContain('small_printer_package');
  });

  it('refuses a printer with inputs, a job or a ready output', () => {
    const ctx = context();
    const id = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'small_printer', ctx.surface) as EntityId;
    const printer = ctx.world.entities.get(id)?.components.printer;
    if (!printer) throw new Error('no printer');
    printer.recipeId = 'platform';
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(true);
    printer.recipeId = null;
    printer.outputReady = 'platform';
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(true);
    printer.outputReady = null;
    const input = ctx.world.nextId('item');
    ctx.world.entities.set(input, {
      id: input,
      kind: 'item',
      planetId: ctx.planet.id,
      position: { ...ctx.surface },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: { item: { itemId: 'silicate', holder: id } },
    });
    printer.inputs.push(input);
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(true);
  });

  it('refuses a charged battery but packs an empty one', () => {
    const ctx = context();
    const id = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'battery', ctx.surface) as EntityId;
    const power = ctx.world.entities.get(id)?.components.power;
    if (!power) throw new Error('no power');
    power.stored = 5;
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(true);
    power.stored = 0;
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(false);
    expect(itemIds(ctx)).toContain('battery_package');
  });

  it('refuses a platform with an attached machine or a cable', () => {
    const ctx = context();
    const platformId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', ctx.surface) as EntityId;
    const platform = ctx.world.entities.get(platformId);
    if (!platform) throw new Error('no platform');
    const slot = slotWorld(platform, 0);
    if (!slot) throw new Error('no slot');
    const printerId = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'small_printer', slot, {
      attachTo: platformId,
      attachSlot: 0,
    }) as EntityId;
    pack(ctx, platformId);
    expect(ctx.world.entities.has(platformId)).toBe(true);
    // Removing the machine frees the platform, but a cable still blocks it.
    pack(ctx, printerId);
    const probe = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'solar_panel', {
      x: 3,
      y: ctx.surface.y,
      z: 0,
    }) as EntityId;
    createCableEntity(
      ctx.world,
      ctx.planet.id,
      { entityId: platformId, snapIndex: 0 },
      { entityId: probe, snapIndex: 0 },
    );
    pack(ctx, platformId);
    expect(ctx.world.entities.has(platformId)).toBe(true);
  });

  it('clears dangling platform join refs when the partner is packed', () => {
    const ctx = context();
    const a = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: -1,
      y: ctx.surface.y,
      z: 0,
    }) as EntityId;
    const b = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: 3,
      y: ctx.surface.y,
      z: 0,
    }) as EntityId;
    const bp = ctx.world.entities.get(b)?.components.placeable;
    if (!bp) throw new Error('no b placeable');
    bp.snappedTo = a;
    bp.snappedToSnap = 0;
    bp.snappedOwnSnap = 2;
    pack(ctx, a);
    expect(ctx.world.entities.has(a)).toBe(false);
    expect(bp.snappedTo).toBeUndefined();
    expect(bp.snappedToSnap).toBeUndefined();
    expect(bp.snappedOwnSnap).toBeUndefined();
    expect(snapFree(ctx.world, { entityId: b, snapIndex: 2 })).toBe(true);
  });

  it('refuses out-of-range and habitat pack-up', () => {
    const ctx = context();
    const id = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'solar_panel', ctx.surface) as EntityId;
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player) throw new Error('no player');
    const home = { ...player.position };
    ctx.world.dispatch({
      type: 'playerTeleport',
      playerId: ctx.playerId,
      position: { x: home.x + 40, y: home.y, z: home.z },
    });
    ctx.world.tick();
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(true);
    ctx.world.dispatch({ type: 'playerTeleport', playerId: ctx.playerId, position: home });
    ctx.world.tick();
    pack(ctx, id);
    expect(ctx.world.entities.has(id)).toBe(false);
    // The habitat has no package item and is a fixed base anchor.
    const habitatId = ctx.world.nextId('machine');
    ctx.world.entities.set(habitatId, {
      id: habitatId,
      kind: 'machine',
      planetId: ctx.planet.id,
      position: { ...ctx.surface },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: {
        machine: { machineType: 'habitat' },
        placeable: { placeableId: 'habitat_kit' },
        power: { stored: 0, capacity: 20, paused: false, networkId: null },
      },
    });
    pack(ctx, habitatId);
    expect(ctx.world.entities.has(habitatId)).toBe(true);
  });
});
