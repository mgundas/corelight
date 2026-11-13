import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { buildPrinterState } from '../../src/game/printerWiring.js';
import type { MachineComponent } from '../../src/sim/entities.js';
import { giveItemToPlayer } from '../../src/sim/inventoryActions.js';
import { World } from '../../src/sim/world.js';

function setup(machineType: MachineComponent['machineType'] = 'small_printer', material = 'silicate') {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: { x: 0, y: 402, z: 0 } });
  world.tick();
  const player = [...world.entities.values()][0]!;
  const stationId = world.nextId('machine');
  const printer = { recipeId: null as string | null, progressS: 0, inputs: [] as string[], outputReady: null as string | null };
  world.entities.set(stationId, {
    id: stationId, kind: 'machine', planetId: SELA.id,
    position: { ...player.position }, rotation: { ...IDENTITY_QUAT },
    components: { machine: { machineType }, printer },
  });
  giveItemToPlayer(world, player, material);
  const inventory = player.components.inventory!;
  const itemId = inventory.slots[0]!;
  world.dispatch({ type: 'depositSlotToStation', playerId: player.id, stationId, slot: 0 });
  world.tick();
  expect(printer.inputs).toEqual([itemId]);
  const unload = () => {
    world.dispatch({ type: 'unloadStationInput', playerId: player.id, stationId, itemId });
    world.tick();
  };
  return { world, player, stationId, printer, itemId, inventory, unload };
}

describe('unloading station inputs', () => {
  it.each([
    ['small_printer', 'silicate'], ['medium_printer', 'iron'],
    ['furnace', 'ferrite_ore'], ['refinery', 'biomass'],
  ] as const)('returns the same item from a %s without duplication', (type, material) => {
    const { world, player, printer, itemId, inventory, unload } = setup(type, material);
    const count = world.entities.size;
    unload();
    unload();
    expect(printer.inputs).toEqual([]);
    expect(inventory.slots.filter((id) => id === itemId)).toHaveLength(1);
    expect(world.entities.get(itemId)?.components.item?.holder).toBe(player.id);
    expect(world.entities.size).toBe(count);
  });

  it('leaves a full-backpack input intact, then permits recovery after freeing a slot', () => {
    const { world, player, stationId, printer, itemId, inventory, unload } = setup();
    for (let i = 0; i < 8; i++) giveItemToPlayer(world, player, 'resin');
    expect(buildPrinterState(world, player.id, stationId)?.station?.canUnload).toBe(false);
    unload();
    expect(printer.inputs).toEqual([itemId]);
    expect(world.entities.get(itemId)?.components.item?.holder).toBe(stationId);
    world.dispatch({ type: 'drop', playerId: player.id, slot: 3 });
    world.tick();
    unload();
    expect(inventory.slots[3]).toBe(itemId);
    expect(printer.inputs).toEqual([]);
  });

  it.each(['far', 'other planet', 'wrong holder', 'not loaded', 'missing item', 'missing station', 'missing player'])('rejects %s actions', (reason) => {
    const { world, player, stationId, printer, itemId, inventory, unload } = setup();
    if (reason === 'far') player.position.x += 100;
    if (reason === 'other planet') player.planetId = 'vorn';
    if (reason === 'wrong holder') world.entities.get(itemId)!.components.item!.holder = player.id;
    if (reason === 'not loaded') printer.inputs = [];
    if (reason === 'missing item') world.entities.delete(itemId);
    if (reason === 'missing station') world.entities.delete(stationId);
    if (reason === 'missing player') world.entities.delete(player.id);
    const before = [...printer.inputs];
    unload();
    expect(printer.inputs).toEqual(before);
    expect(inventory.slots.every((id) => id === null)).toBe(true);
  });

  it('unloads leftovers during a job without changing progress or withdrawing a shifted slot twice', () => {
    const { world, player, stationId, printer, itemId, inventory, unload } = setup();
    giveItemToPlayer(world, player, 'silicate');
    const otherId = inventory.slots[0]!;
    world.dispatch({ type: 'depositSlotToStation', playerId: player.id, stationId, slot: 0 });
    world.tick();
    printer.recipeId = 'platform';
    printer.progressS = 1;
    printer.outputReady = 'platform';
    const state = buildPrinterState(world, player.id, stationId);
    expect(state?.station?.inputIds.slice(0, 2)).toEqual([itemId, otherId]);
    unload();
    unload();
    expect(printer.inputs).toEqual([otherId]);
    expect(printer.recipeId).toBe('platform');
    expect(printer.progressS).toBe(1);
    expect(printer.outputReady).toBe('platform');
  });

  it('frees a full station so a different recipe can be loaded and started', () => {
    const { world, player, stationId, printer, inventory } = setup('small_printer', 'copper');
    while (printer.inputs.length < 8) {
      giveItemToPlayer(world, player, 'copper');
      world.dispatch({ type: 'depositSlotToStation', playerId: player.id, stationId, slot: 0 });
      world.tick();
    }
    for (const itemId of [...printer.inputs]) {
      world.dispatch({ type: 'unloadStationInput', playerId: player.id, stationId, itemId });
    }
    world.tick();
    expect(printer.inputs).toEqual([]);
    for (let slot = 0; slot < inventory.slots.length; slot++) world.dispatch({ type: 'drop', playerId: player.id, slot });
    world.tick();
    for (let i = 0; i < 2; i++) {
      giveItemToPlayer(world, player, 'silicate');
      world.dispatch({ type: 'depositSlotToStation', playerId: player.id, stationId, slot: 0 });
      world.tick();
    }
    world.dispatch({ type: 'printAtStation', playerId: player.id, stationId, recipeId: 'platform' });
    world.tick();
    expect(printer.recipeId).toBe('platform');
    expect(printer.inputs).toEqual([]);
  });
});
