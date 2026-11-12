// M11 end-to-end: print the research station at a small printer, place the
// package through the real placement action, load a sample, analyze 20 s and
// collect Data. The station tests elsewhere spawn the entity directly; this
// pins the full production path (including spawnPlaceableEntity's research
// component initialisation).

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SIM_DT } from '../../src/core/constants.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { updateCrafting } from '../../src/sim/systems/crafting.js';
import { updateResearch } from '../../src/sim/systems/research.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat research flow world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

function addStationInput(world: World, stationId: EntityId, itemId: string): void {
  const station = world.entities.get(stationId);
  const printer = station?.components.printer;
  if (!station || !printer) throw new Error('no printer');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: station.planetId,
    position: { ...station.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: stationId } },
  });
  printer.inputs.push(id);
}

function ticks(world: World, seconds: number): void {
  const count = Math.ceil(seconds / SIM_DT) + 1;
  for (let i = 0; i < count; i += 1) world.tick();
}

describe('research station production flow', () => {
  it('prints, places, analyzes and collects through the real actions', () => {
    const planet = flatPlanet();
    const world = new World(7, { planets: [planet] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: planet.id,
      position: { x: 0, y: planet.radius + 0.9, z: 2 },
    });
    world.addSystem((w, dt) => updateCrafting(w, dt));
    world.addSystem((w, dt) => updateResearch(w, dt));
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    if (!playerId) throw new Error('no player');

    // A small printer at the base prints the research station.
    const printerId = spawnPlaceableEntity(world, planet.id, 'small_printer', {
      x: 0,
      y: planet.radius,
      z: 0,
    });
    if (!printerId) throw new Error('no printer');
    addStationInput(world, printerId, 'silicate');
    addStationInput(world, printerId, 'silicate');
    addStationInput(world, printerId, 'lumen_crystal');
    world.dispatch({ type: 'printAtStation', playerId, stationId: printerId, recipeId: 'research_station' });
    world.tick();
    expect(world.entities.get(printerId)?.components.printer?.recipeId).toBe('research_station');
    ticks(world, 3);
    expect(world.entities.get(printerId)?.components.printer?.outputReady).toBe('research_station');
    world.dispatch({ type: 'collectStation', playerId, stationId: printerId });
    world.tick();
    const inventory = world.entities.get(playerId)?.components.inventory;
    expect(inventory?.slots.some((id) => world.entities.get(id ?? '')?.components.item?.itemId === 'research_station_package')).toBe(true);

    // Place the package on the flat pad through the validated action.
    world.dispatch({
      type: 'placePlaceable',
      playerId,
      placeableId: 'research_station',
      position: { x: -3, y: planet.radius, z: 0 },
    });
    world.tick();
    const station = [...world.entities.values()].find(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'research_station',
    );
    if (!station) throw new Error('research station was not placed');
    expect(station.components.research).toEqual({ inputId: null, progressS: 0, dataReady: 0 });

    // Load a sample, analyze it, collect the Data.
    const sampleId = world.nextId('sample');
    world.entities.set(sampleId, {
      id: sampleId,
      kind: 'sample',
      planetId: planet.id,
      position: { ...world.entities.get(playerId)!.position },
      rotation: { ...IDENTITY_QUAT },
      components: {
        sample: { value: 10, chunkKey: 'flat:0:0:0:0' },
        item: { itemId: 'research_sample', holder: playerId },
      },
    });
    if (!inventory) throw new Error('no inventory');
    const slot = inventory.slots.indexOf(null);
    inventory.slots[slot] = sampleId;
    inventory.selectedSlot = slot;
    world.dispatch({ type: 'depositResearchSample', playerId, stationId: station.id });
    world.tick();
    expect(station.components.research?.inputId).toBe(sampleId);
    ticks(world, 20);
    expect(station.components.research?.dataReady).toBe(10);
    world.dispatch({ type: 'collectResearch', playerId, stationId: station.id });
    world.tick();
    expect(world.research.data).toBe(10);
  });
});
