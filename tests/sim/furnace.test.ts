// M12 furnace: ore -> metal smelting over time, one recipe input plus the
// optional biomass fuel slot (2x speed, consumed at job start), the input
// cap, and the power gate (a job never advances while the network cannot
// afford its 2/s demand).

import { beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity } from '../../src/sim/snapUtils.js';
import { updateCrafting } from '../../src/sim/systems/crafting.js';
import { updatePower } from '../../src/sim/systems/power.js';
import { spawnHabitatEntity } from '../../src/sim/tetherActions.js';
import { World } from '../../src/sim/world.js';

function spawnWorld(): { world: World; playerId: EntityId } {
  const world = new World(1337, { planets: [SELA] });
  // Furnace recipes are research-gated; this suite tests the machine, not
  // the tree (M11 tests cover the unlock).
  world.research.unlocked = ['smelting'];
  world.dispatch({
    type: 'spawnPlayer',
    planetId: SELA.id,
    position: { x: 0, y: SELA.radius, z: 0 },
  });
  world.addSystem((w, dt) => updateCrafting(w, dt));
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

function spawnFurnace(world: World, playerId: EntityId): EntityId {
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player');
  const id = world.nextId('machine');
  world.entities.set(id, {
    id,
    kind: 'machine',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: {
      machine: { machineType: 'furnace' },
      printer: { recipeId: null, progressS: 0, inputs: [], outputReady: null },
    },
  });
  return id;
}

function giveItem(world: World, playerId: EntityId, itemId: string, slot = 0): EntityId {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
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

function deposit(world: World, playerId: EntityId, stationId: EntityId): void {
  world.dispatch({ type: 'depositToStation', playerId, stationId });
  world.tick();
}

function printerOf(world: World, stationId: EntityId) {
  const printer = world.entities.get(stationId)?.components.printer;
  if (!printer) throw new Error('no printer component');
  return printer;
}

function jobTicks(seconds: number): number {
  return Math.ceil(seconds / SIM_DT);
}

describe('furnace timing', () => {
  beforeEach(() => events.clear());

  it('smelts ferrite into iron in 10 s', () => {
    const { world, playerId } = spawnWorld();
    const furnaceId = spawnFurnace(world, playerId);
    giveItem(world, playerId, 'ferrite_ore');
    deposit(world, playerId, furnaceId);
    world.dispatch({ type: 'printAtStation', playerId, stationId: furnaceId, recipeId: 'smelt_iron' });
    world.tick();
    const printer = printerOf(world, furnaceId);
    expect(printer.recipeId).toBe('smelt_iron');
    expect(printer.boosted).toBe(false);
    const ticks = jobTicks(10);
    for (let i = 0; i < ticks - 2; i += 1) world.tick();
    expect(printer.outputReady).toBe(null);
    for (let i = 0; i < 2; i += 1) world.tick();
    expect(printer.outputReady).toBe('iron');
  });

  it('biomass in the second slot doubles speed and is consumed at start', () => {
    const { world, playerId } = spawnWorld();
    const furnaceId = spawnFurnace(world, playerId);
    giveItem(world, playerId, 'cuprite_ore', 0);
    const fuelId = giveItem(world, playerId, 'biomass', 1);
    // First deposit is the ore (keep it selected; a biomass would win the
    // selected-slot priority otherwise), then select and load the fuel.
    const inv = world.entities.get(playerId)?.components.inventory;
    if (!inv) throw new Error('no inventory');
    inv.selectedSlot = 0;
    deposit(world, playerId, furnaceId);
    inv.selectedSlot = 1;
    deposit(world, playerId, furnaceId);
    expect(printerOf(world, furnaceId).inputs).toHaveLength(2);
    world.dispatch({ type: 'printAtStation', playerId, stationId: furnaceId, recipeId: 'smelt_copper' });
    world.tick();
    const printer = printerOf(world, furnaceId);
    expect(printer.boosted).toBe(true);
    expect(printer.inputs).toHaveLength(0);
    // Both the ore and the fuel left the world.
    expect(world.entities.get(fuelId)).toBeUndefined();
    expect(
      [...world.entities.values()].filter((e) => e.components.item?.itemId === 'biomass'),
    ).toHaveLength(0);
    const ticks = jobTicks(5);
    for (let i = 0; i < ticks - 2; i += 1) world.tick();
    expect(printer.outputReady).toBe(null);
    for (let i = 0; i < 2; i += 1) world.tick();
    expect(printer.outputReady).toBe('copper');
    // The boost never carries into the next (unfuelled) job.
    expect(printer.boosted).toBe(false);
  });

  it('keeps one ore slot and one fuel slot (no unload trap)', () => {
    const { world, playerId } = spawnWorld();
    const furnaceId = spawnFurnace(world, playerId);
    giveItem(world, playerId, 'ferrite_ore', 0);
    deposit(world, playerId, furnaceId);
    expect(printerOf(world, furnaceId).inputs).toHaveLength(1);
    // A second ore is rejected: the ore slot is taken until the job starts.
    giveItem(world, playerId, 'cuprite_ore', 1);
    deposit(world, playerId, furnaceId);
    expect(printerOf(world, furnaceId).inputs).toHaveLength(1);
    // The second slot is reserved for biomass fuel.
    giveItem(world, playerId, 'biomass', 2);
    deposit(world, playerId, furnaceId);
    expect(printerOf(world, furnaceId).inputs).toHaveLength(2);
    // A second biomass is rejected too (it would block every ore forever).
    giveItem(world, playerId, 'biomass', 3);
    deposit(world, playerId, furnaceId);
    expect(printerOf(world, furnaceId).inputs).toHaveLength(2);
    // Silicate has no furnace recipe.
    giveItem(world, playerId, 'silicate', 4);
    world.dispatch({ type: 'depositToStation', playerId, stationId: furnaceId });
    world.tick();
    expect(printerOf(world, furnaceId).inputs).toHaveLength(2);
  });
});

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat-furnace',
    name: 'Flat furnace world',
    seed: 991,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface PowerCtx {
  world: World;
  planet: PlanetConfig;
  playerId: EntityId;
  furnaceId: EntityId;
  platformId: EntityId;
  cableId: EntityId;
}

function powerContext(): PowerCtx {
  const planet = flatPlanet();
  const world = new World(99, { planets: [planet] });
  world.research.unlocked = ['smelting', 'power_basics'];
  const surface = { x: 0, y: planet.radius, z: 0 };
  world.dispatch({ type: 'spawnPlayer', planetId: planet.id, position: surface });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  const platformId = spawnPlaceableEntity(world, planet.id, 'platform', surface) as EntityId;
  const furnaceId = spawnPlaceableEntity(
    world,
    planet.id,
    'furnace',
    { x: surface.x, y: surface.y + 0.7, z: surface.z },
    { attachTo: platformId, attachSlot: 1 },
  ) as EntityId;
  spawnPlaceableEntity(
    world,
    planet.id,
    'solar_panel',
    { x: surface.x, y: surface.y + 0.7, z: surface.z },
    { attachTo: platformId, attachSlot: 2 },
  );
  const habitatId = spawnHabitatEntity(world, planet.id, { x: 1, y: surface.y, z: 0 }) as EntityId;
  const cableId = createCableEntity(
    world,
    planet.id,
    { entityId: habitatId, snapIndex: 0 },
    { entityId: platformId, snapIndex: 0 },
  ) as EntityId;
  return { world, planet, playerId, furnaceId, platformId, cableId };
}

function startSmelt(ctx: PowerCtx, recipeId: string): void {
  giveItem(ctx.world, ctx.playerId, recipeId === 'smelt_iron' ? 'ferrite_ore' : 'cuprite_ore', 0);
  giveItem(ctx.world, ctx.playerId, 'biomass', 1);
  ctx.world.dispatch({ type: 'depositToStation', playerId: ctx.playerId, stationId: ctx.furnaceId });
  ctx.world.dispatch({ type: 'depositToStation', playerId: ctx.playerId, stationId: ctx.furnaceId });
  ctx.world.dispatch({
    type: 'printAtStation',
    playerId: ctx.playerId,
    stationId: ctx.furnaceId,
    recipeId,
  });
  ctx.world.tick();
}

function runPowerAndCraft(ctx: PowerCtx, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    updatePower(ctx.world, SIM_DT);
    updateCrafting(ctx.world, SIM_DT);
  }
}

describe('furnace power gate', () => {
  beforeEach(() => events.clear());

  it('runs at doubled speed when the network supplies 2/s', () => {
    const ctx = powerContext();
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    startSmelt(ctx, 'smelt_iron');
    // One extra tick: 150 ticks of 2*dt accumulates a hair under 10.0.
    runPowerAndCraft(ctx, jobTicks(5) + 1);
    expect(ctx.world.entities.get(ctx.furnaceId)?.components.printer?.outputReady).toBe('iron');
  });

  it('freezes the job (no progress) when the network cannot afford it', () => {
    const ctx = powerContext();
    // Night + no cable: the platform network has zero generation.
    ctx.world.sunDirection = { x: 0, y: -1, z: 0 };
    ctx.world.entities.delete(ctx.cableId);
    startSmelt(ctx, 'smelt_copper');
    const printer = printerOf(ctx.world, ctx.furnaceId);
    runPowerAndCraft(ctx, jobTicks(3));
    expect(printer.progressS).toBe(0);
    expect(printer.outputReady).toBe(null);
    expect(ctx.world.entities.get(ctx.furnaceId)?.components.power?.paused).toBe(true);
  });
});
