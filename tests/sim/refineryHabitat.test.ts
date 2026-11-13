// M14 refinery + habitat kit acceptance pieces: 15 s at 3 power/s for both
// fuel recipes, and a placed habitat kit becoming a real oxygen source.

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
import { isOnOxygenNetwork } from '../../src/sim/systems/oxygen.js';
import { spawnHabitatEntity } from '../../src/sim/tetherActions.js';
import { World } from '../../src/sim/world.js';

function flatPlanet(id = 'flat-m14'): PlanetConfig {
  return {
    ...SELA,
    id,
    name: 'Flat M14 world',
    seed: 12014,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

function giveItem(world: World, playerId: EntityId, itemId: string): void {
  const player = world.entities.get(playerId);
  const inventory = player?.components.inventory;
  if (!player || !inventory) throw new Error('no inventory');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  const slot = inventory.slots.indexOf(null);
  inventory.slots[slot] = id;
  inventory.selectedSlot = slot;
}

interface RefineryCtx {
  world: World;
  planet: PlanetConfig;
  playerId: EntityId;
  refineryId: EntityId;
}

function refineryContext(): RefineryCtx {
  const planet = flatPlanet();
  const world = new World(12014, { planets: [planet] });
  world.research.unlocked = ['fuel_refining'];
  const surface = { x: 0, y: planet.radius, z: 0 };
  world.dispatch({ type: 'spawnPlayer', planetId: planet.id, position: surface });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  // The refinery and solar panel sit beside the habitat, all cabled into one
  // network: habitat 1/s + solar 2/s (noon) exactly covers the recipe's 3/s.
  const habitatId = spawnHabitatEntity(world, planet.id, { x: 0, y: surface.y, z: 0 });
  const refineryId = spawnPlaceableEntity(world, planet.id, 'refinery', { x: 0, y: surface.y, z: 4 });
  const solarId = spawnPlaceableEntity(world, planet.id, 'solar_panel', {
    x: 0,
    y: surface.y,
    z: 0,
  });
  if (!habitatId || !refineryId || !solarId) throw new Error('fixture failed');
  createCableEntity(
    world,
    planet.id,
    { entityId: habitatId, snapIndex: 0 },
    { entityId: refineryId, snapIndex: 0 },
  );
  createCableEntity(
    world,
    planet.id,
    { entityId: habitatId, snapIndex: 0 },
    { entityId: solarId, snapIndex: 0 },
  );
  return { world, planet, playerId, refineryId };
}

function run(ctx: RefineryCtx, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    updatePower(ctx.world, SIM_DT);
    updateCrafting(ctx.world, SIM_DT);
  }
}

describe('refinery fuel recipes', () => {
  beforeEach(() => events.clear());

  it('turns one hydrite into a fuel cell in 15 s', () => {
    const ctx = refineryContext();
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    giveItem(ctx.world, ctx.playerId, 'hydrite');
    ctx.world.dispatch({ type: 'depositToStation', playerId: ctx.playerId, stationId: ctx.refineryId });
    ctx.world.dispatch({
      type: 'printAtStation',
      playerId: ctx.playerId,
      stationId: ctx.refineryId,
      recipeId: 'fuel_cell_hydrite',
    });
    ctx.world.tick();
    const printer = ctx.world.entities.get(ctx.refineryId)?.components.printer;
    expect(printer?.recipeId).toBe('fuel_cell_hydrite');
    run(ctx, 449);
    expect(printer?.outputReady).toBe(null);
    run(ctx, 2);
    expect(printer?.outputReady).toBe('fuel_cell');
  });

  it('turns two biomass into a fuel cell and needs the 3/s network', () => {
    const ctx = refineryContext();
    ctx.world.sunDirection = { x: 0, y: -1, z: 0 }; // night: habitat alone is 1/s
    // Drain the habitat's internal reserve so the first tick already exposes
    // the 3/s shortfall instead of running off stored power.
    for (const entity of ctx.world.entities.values()) {
      if (entity.components.machine?.machineType === 'habitat' && entity.components.power) {
        entity.components.power.stored = 0;
      }
    }
    giveItem(ctx.world, ctx.playerId, 'biomass');
    giveItem(ctx.world, ctx.playerId, 'biomass');
    const inventory = ctx.world.entities.get(ctx.playerId)?.components.inventory;
    if (!inventory) throw new Error('no inventory');
    ctx.world.dispatch({ type: 'depositToStation', playerId: ctx.playerId, stationId: ctx.refineryId });
    ctx.world.dispatch({ type: 'depositToStation', playerId: ctx.playerId, stationId: ctx.refineryId });
    ctx.world.dispatch({
      type: 'printAtStation',
      playerId: ctx.playerId,
      stationId: ctx.refineryId,
      recipeId: 'fuel_cell_biomass',
    });
    ctx.world.tick();
    const printer = ctx.world.entities.get(ctx.refineryId)?.components.printer;
    expect(printer?.recipeId).toBe('fuel_cell_biomass');
    run(ctx, 120);
    // Generation is 1/s against a 3/s job: the network browns out, so the
    // 15 s recipe barely advances (only the habitat's trickle-buffer duty
    // cycle is allowed) and the refinery reports paused.
    expect(printer?.progressS).toBeLessThan(2);
    expect(ctx.world.entities.get(ctx.refineryId)?.components.power?.paused).toBe(true);
  });
});

describe('habitat kit placement', () => {
  beforeEach(() => events.clear());

  it('unpacks into a habitat that supplies oxygen', () => {
    const planet = flatPlanet('flat-habitat');
    const world = new World(77, { planets: [planet] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: planet.id,
      position: { x: 0, y: planet.radius, z: 0 },
    });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    const player = world.entities.get(playerId);
    if (!player?.components.player) throw new Error('no player');
    const packageId = world.nextId('item');
    world.entities.set(packageId, {
      id: packageId,
      kind: 'item',
      planetId: planet.id,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'habitat_kit_package', holder: playerId } },
    });
    player.components.player.carryingLarge = packageId;
    world.dispatch({
      type: 'placePlaceable',
      playerId,
      placeableId: 'habitat_kit',
      position: { x: 0, y: planet.radius, z: 2 },
    });
    world.tick();
    expect(player.components.player.carryingLarge ?? null).toBe(null);
    const habitats = [...world.entities.values()].filter(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'habitat',
    );
    expect(habitats).toHaveLength(1);
    expect(habitats[0]?.components.power?.capacity).toBeGreaterThan(0);
    expect(isOnOxygenNetwork(world, playerId)).toBe(true);
    // Not packable: a fixed base anchor.
    expect(habitats[0]?.components.placeable?.placeableId).toBe('habitat_kit');
  });
});
