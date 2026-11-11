// M09 crafting rules: backpack printing (instant) and station jobs (timed,
// input slots, collect). Covers missing inputs, locked recipes, wrong
// stations and output timing.

import { beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import { updateCrafting } from '../../src/sim/systems/crafting.js';
import type { EntityId } from '../../src/sim/entities.js';
import { CRAFTING_REQUIRE_POWER } from '../../src/core/constants.js';
import { placeableDef } from '../../src/data/loadPlaceables.js';
import { recipeDef } from '../../src/data/loadRecipes.js';

function spawnWorld(): { world: World; playerId: EntityId } {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
  world.addSystem((w, dt) => updateCrafting(w, dt));
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

function giveItem(world: World, playerId: EntityId, itemId: string, slot?: number): EntityId {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const at = slot ?? inv.slots.indexOf(null);
  if (at === -1 || at >= inv.slots.length) throw new Error('backpack full');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  inv.slots[at] = id;
  return id;
}

function spawnStation(world: World, playerId: EntityId, machineType: string): EntityId {
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
      machine: {
        machineType: machineType as
          | 'habitat'
          | 'small_printer'
          | 'medium_printer'
          | 'solar_panel'
          | 'battery'
          | 'furnace'
          | 'research_station'
          | 'refinery',
      },
      printer: { recipeId: null, progressS: 0, inputs: [], outputReady: null },
    },
  });
  return id;
}

function slotItemIds(world: World, playerId: EntityId): (string | null)[] {
  const inv = world.entities.get(playerId)?.components.inventory;
  return (inv?.slots ?? []).map((id) => (id ? (world.entities.get(id)?.components.item?.itemId ?? null) : null));
}

describe('backpack printing', () => {
  beforeEach(() => events.clear());

  it('turns resin into a tether and consumes the input', () => {
    const { world, playerId } = spawnWorld();
    giveItem(world, playerId, 'resin');
    world.dispatch({ type: 'printBackpack', playerId, recipeId: 'tether' });
    world.tick();
    expect(slotItemIds(world, playerId)).toEqual(['tether', null, null, null, null, null, null, null]);
    expect(
      [...world.entities.values()].filter((e) => e.components.item?.itemId === 'resin'),
    ).toHaveLength(0);
  });

  it('fails without inputs and emits actionApplied', () => {
    const { world, playerId } = spawnWorld();
    let applied = 0;
    events.on('actionApplied', ({ type }) => {
      if (type === 'printBackpack') applied += 1;
    });
    world.dispatch({ type: 'printBackpack', playerId, recipeId: 'tether' });
    world.tick();
    expect(slotItemIds(world, playerId).every((id) => id === null)).toBe(true);
    expect(applied).toBe(1);
  });

  it('rejects locked recipes and station recipes', () => {
    const { world, playerId } = spawnWorld();
    giveItem(world, playerId, 'resin');
    // oxygen_canister is a starter, but solar_panel is a locked station recipe.
    world.dispatch({ type: 'printBackpack', playerId, recipeId: 'solar_panel' });
    world.tick();
    expect(slotItemIds(world, playerId)).toEqual(['resin', null, null, null, null, null, null, null]);
    // Raw machine outputs are not hand-craftable either.
    giveItem(world, playerId, 'silicate');
    giveItem(world, playerId, 'copper');
    world.dispatch({ type: 'printBackpack', playerId, recipeId: 'battery' });
    world.tick();
    expect(slotItemIds(world, playerId).filter((id) => id !== null)).toHaveLength(3);
  });

  it('prints oxygen canisters from two ingredients', () => {
    const { world, playerId } = spawnWorld();
    giveItem(world, playerId, 'resin');
    giveItem(world, playerId, 'silicate');
    world.dispatch({ type: 'printBackpack', playerId, recipeId: 'oxygen_canister' });
    world.tick();
    expect(slotItemIds(world, playerId)).toEqual([
      'oxygen_canister',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('station printing', () => {
  beforeEach(() => events.clear());

  it('deposits selected inputs and consumes them at job start', () => {
    const { world, playerId } = spawnWorld();
    const stationId = spawnStation(world, playerId, 'small_printer');
    giveItem(world, playerId, 'silicate', 0);
    world.dispatch({ type: 'selectSlot', playerId, slot: 0 });
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    const printer = world.entities.get(stationId)?.components.printer;
    expect(printer?.inputs).toHaveLength(1);
    expect(slotItemIds(world, playerId)[0]).toBe(null);
    // Second silicate.
    giveItem(world, playerId, 'silicate', 0);
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    expect(printer?.inputs).toHaveLength(2);
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.recipeId).toBe('platform');
    expect(world.entities.get(stationId)?.components.printer?.inputs).toHaveLength(0);
    // Inputs were consumed into the job.
    expect([...world.entities.values()].filter((e) => e.components.item?.itemId === 'silicate')).toHaveLength(0);
  });

  it('produces the output only after the recipe time', () => {
    const { world, playerId } = spawnWorld();
    const stationId = spawnStation(world, playerId, 'small_printer');
    giveItem(world, playerId, 'silicate');
    giveItem(world, playerId, 'silicate');
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    const time = recipeDef('platform').time;
    const ticks = Math.ceil(time / SIM_DT);
    for (let i = 0; i < ticks - 1; i += 1) world.tick();
    expect(world.entities.get(stationId)?.components.printer?.outputReady).toBe(null);
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.outputReady).toBe('platform');
  });

  it('rejects missing inputs, locked recipes, wrong stations and busy stations', () => {
    const { world, playerId } = spawnWorld();
    const stationId = spawnStation(world, playerId, 'small_printer');
    const printer = world.entities.get(stationId)?.components.printer;
    // Missing inputs.
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    world.tick();
    expect(printer?.recipeId).toBe(null);
    // Locked recipe with inputs present.
    giveItem(world, playerId, 'silicate');
    giveItem(world, playerId, 'copper');
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'battery' });
    world.tick();
    expect(printer?.recipeId).toBe(null);
    // Wrong station: a platform recipe at a furnace.
    const furnaceId = spawnStation(world, playerId, 'furnace');
    giveItem(world, playerId, 'silicate');
    giveItem(world, playerId, 'silicate');
    world.dispatch({ type: 'depositToStation', playerId, stationId: furnaceId });
    world.dispatch({ type: 'depositToStation', playerId, stationId: furnaceId });
    world.tick();
    world.dispatch({ type: 'printAtStation', playerId, stationId: furnaceId, recipeId: 'platform' });
    world.tick();
    expect(world.entities.get(furnaceId)?.components.printer?.recipeId).toBe(null);
    // Busy station: start a job, then a second print must not replace it.
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    world.tick();
    expect(printer?.recipeId).toBe('platform');
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    world.tick();
    expect(printer?.recipeId).toBe('platform');
    expect(printer?.progressS).toBeCloseTo(SIM_DT * 2, 6);
  });

  it('collects a finished platform into front carry and clears the output', () => {
    const { world, playerId } = spawnWorld();
    const stationId = spawnStation(world, playerId, 'small_printer');
    giveItem(world, playerId, 'silicate');
    giveItem(world, playerId, 'silicate');
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    const ticks = Math.ceil(recipeDef('platform').time / SIM_DT);
    for (let i = 0; i < ticks; i += 1) world.tick();
    expect(world.entities.get(stationId)?.components.printer?.outputReady).toBe('platform');
    world.dispatch({ type: 'collectStation', playerId, stationId });
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.outputReady).toBe(null);
    const player = world.entities.get(playerId);
    const carriedId = player?.components.player?.carryingLarge;
    expect(carriedId).toBeTruthy();
    const carried = carriedId ? world.entities.get(carriedId) : undefined;
    expect(carried?.components.item?.itemId).toBe(placeableDef('platform').packageItem);
    expect(carried?.components.item?.holder).toBe(playerId);
  });

  it('refuses a deposit that is not an input, and a ninth input', () => {
    const { world, playerId } = spawnWorld();
    const stationId = spawnStation(world, playerId, 'small_printer');
    giveItem(world, playerId, 'resin');
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.inputs).toHaveLength(0);
    expect(slotItemIds(world, playerId)[0]).toBe('resin');
    for (let i = 0; i < 9; i += 1) {
      giveItem(world, playerId, 'silicate', 0);
      world.dispatch({ type: 'depositToStation', playerId, stationId });
      world.tick();
    }
    expect(world.entities.get(stationId)?.components.printer?.inputs).toHaveLength(8);
    expect(slotItemIds(world, playerId)[0]).toBe('silicate');
  });

  it('keeps the temporary M09 flag off (stations always powered)', () => {
    expect(CRAFTING_REQUIRE_POWER).toBe(false);
    const { world, playerId } = spawnWorld();
    const stationId = spawnStation(world, playerId, 'small_printer');
    expect(recipeDef('platform').power).toBeGreaterThan(0);
    giveItem(world, playerId, 'silicate');
    giveItem(world, playerId, 'silicate');
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.dispatch({ type: 'depositToStation', playerId, stationId });
    world.tick();
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'platform' });
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.progressS).toBeGreaterThan(0);
  });
});
