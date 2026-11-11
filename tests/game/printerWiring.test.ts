// M09 printer panel projection: recipe rows show have/need counts, starter
// recipes are enabled, locked station recipes stay greyed, loaded inputs and
// job progress/output mirror the sim component, and a far station closes.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import { buildPrinterState } from '../../src/game/printerWiring.js';

function world(): { world: World; playerId: EntityId } {
  const w = new World(1337, { planets: [SELA] });
  w.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
  w.tick();
  const playerId = [...w.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world: w, playerId };
}

function give(world: World, playerId: EntityId, itemId: string): EntityId {
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
  const slot = inv.slots.indexOf(null);
  if (slot === -1) throw new Error('pack full');
  inv.slots[slot] = id;
  return id;
}

function station(world: World, playerId: EntityId): EntityId {
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
      machine: { machineType: 'small_printer' },
      printer: { recipeId: null, progressS: 0, inputs: [], outputReady: null },
      placeable: { placeableId: 'small_printer' },
    },
  });
  return id;
}

function addStationInput(world: World, stationId: EntityId, itemId: string): void {
  const stationEntity = world.entities.get(stationId);
  const printer = stationEntity?.components.printer;
  if (!stationEntity || !printer) throw new Error('no station');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: stationEntity.planetId,
    position: { ...stationEntity.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: stationId } },
  });
  printer.inputs.push(id);
}

describe('printer UI state', () => {
  it('lists backpack recipes with have/need counts and enables complete rows', () => {
    const { world: w, playerId } = world();
    give(w, playerId, 'resin');
    const state = buildPrinterState(w, playerId, null);
    if (!state) throw new Error('no state');
    expect(state.mode).toBe('backpack');
    const tether = state.rows.find((row) => row.recipeId === 'tether');
    expect(tether?.inputs).toEqual([{ name: 'Resin', need: 1, have: 1 }]);
    expect(tether?.enabled).toBe(true);
    const stick = state.rows.find((row) => row.recipeId === 'light_stick');
    expect(stick?.enabled).toBe(false);
    expect(stick?.inputs[0]?.have).toBe(0);
  });

  it('shows station inputs, progressive job state and output', () => {
    const { world: w, playerId } = world();
    const stationId = station(w, playerId);
    const printer = w.entities.get(stationId)?.components.printer;
    if (!printer) throw new Error('no printer');
    addStationInput(w, stationId, 'silicate');
    addStationInput(w, stationId, 'silicate');
    const ready = buildPrinterState(w, playerId, stationId);
    if (!ready) throw new Error('no state');
    expect(ready.mode).toBe('station');
    expect(ready.station?.slots.slice(0, 3)).toEqual(['Silicate', 'Silicate', null]);
    const platform = ready.rows.find((row) => row.recipeId === 'platform');
    expect(platform?.enabled).toBe(true);
    expect(platform?.inputs[0]).toEqual({ name: 'Silicate', need: 2, have: 2 });
    // Locked (M11 research) rows stay visible but disabled.
    const solar = ready.rows.find((row) => row.recipeId === 'solar_panel');
    expect(solar?.locked).toBe(true);
    expect(solar?.enabled).toBe(false);
    // Busy job: rows disable, progress shows.
    printer.recipeId = 'platform';
    printer.progressS = 1;
    const busy = buildPrinterState(w, playerId, stationId);
    expect(busy?.station?.job?.progress).toBe(1);
    expect(busy?.station?.job?.time).toBe(2);
    expect(busy?.rows.every((row) => !row.enabled)).toBe(true);
    // Finished output is collectable.
    printer.recipeId = null;
    printer.outputReady = 'platform';
    const done = buildPrinterState(w, playerId, stationId);
    expect(done?.station?.outputName).toBe('Platform');
  });

  it('returns null when the station is out of range', () => {
    const { world: w, playerId } = world();
    const stationId = station(w, playerId);
    const player = w.entities.get(playerId);
    if (!player) throw new Error('no player');
    w.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: player.position.x + 50, y: player.position.y, z: player.position.z },
    });
    w.tick();
    expect(buildPrinterState(w, playerId, stationId)).toBe(null);
  });
});
