// M11 research station: one sample slot, 20 s analysis at 1 power/s, Data
// collection, power pausing and the headless samples -> Data -> unlock flow.

import { beforeEach, describe, expect, it } from 'vitest';
import { RESEARCH_TIME_S, SIM_DT } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import { updateResearch } from '../../src/sim/systems/research.js';
import { researchFor } from '../../src/sim/researchActions.js';
import { isEntityEmpty } from '../../src/sim/packActions.js';

interface Ctx {
  world: World;
  playerId: EntityId;
  stationId: EntityId;
}

function spawnWorld(): Ctx {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
  world.tick();
  world.addSystem((w, dt) => updateResearch(w, dt));
  world.tick();
  const player = [...world.entities.values()].find((e) => e.kind === 'player');
  if (!player) throw new Error('no player');
  const stationId = world.nextId('machine');
  world.entities.set(stationId, {
    id: stationId,
    kind: 'machine',
    planetId: SELA.id,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: {
      machine: { machineType: 'research_station' },
      placeable: { placeableId: 'research_station' },
      research: { inputId: null, progressS: 0, dataReady: 0 },
      power: { stored: 0, capacity: 0, paused: false, networkId: null },
    },
  });
  return { world, playerId: player.id, stationId };
}

function giveSample(world: World, playerId: EntityId, value: number, kind: 'sample' | 'item' = 'sample'): EntityId {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const id = world.nextId(kind);
  const item = kind === 'sample' ? { itemId: 'research_sample' } : { itemId: 'research_sample', sampleValue: value };
  world.entities.set(id, {
    id,
    kind,
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components:
      kind === 'sample'
        ? { sample: { value, chunkKey: 'k' }, item: { ...item, holder: playerId } }
        : { item: { ...item, holder: playerId } },
  });
  const slot = inv.slots.indexOf(null);
  if (slot === -1) throw new Error('pack full');
  inv.slots[slot] = id;
  inv.selectedSlot = slot;
  return id;
}

function research(world: World, stationId: EntityId) {
  const entity = world.entities.get(stationId);
  if (!entity) throw new Error('no station');
  const component = researchFor(entity);
  if (!component) throw new Error('no research component');
  return component;
}

/** Run the system until just under/over the 20 s threshold. */
function tickToReady(world: World, stationId: EntityId): void {
  let guard = 0;
  while (research(world, stationId).progressS + SIM_DT < RESEARCH_TIME_S - 1e-9) {
    world.tick();
    guard += 1;
    if (guard > 2000) throw new Error('analysis never completed');
  }
}

describe('research station', () => {
  beforeEach(() => events.clear());

  it('loads one selected sample and rejects wrong items, a full slot and far stations', () => {
    const { world, playerId, stationId } = spawnWorld();
    // Resin is not a sample.
    const resinId = world.nextId('item');
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    world.entities.set(resinId, {
      id: resinId,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin', holder: playerId } },
    });
    const inv = player.components.inventory;
    if (!inv) throw new Error('no inventory');
    inv.slots[0] = resinId;
    inv.selectedSlot = 0;
    world.dispatch({ type: 'depositResearchSample', playerId, stationId });
    world.tick();
    expect(research(world, stationId).inputId).toBe(null);
    // A real sample loads from the pack and is owned by the station.
    const sampleId = giveSample(world, playerId, 10);
    world.dispatch({ type: 'depositResearchSample', playerId, stationId });
    world.tick();
    expect(research(world, stationId).inputId).toBe(sampleId);
    expect(inv.slots).not.toContain(sampleId);
    expect(world.entities.get(sampleId)?.components.item?.holder).toBe(stationId);
    expect(world.depletedSamples.has(sampleId)).toBe(true);
    // Crafted pickUp must not steal a station input (the station would keep
    // analyzing a player-carried item).
    world.dispatch({ type: 'pickUp', playerId, itemId: sampleId });
    world.tick();
    expect(research(world, stationId).inputId).toBe(sampleId);
    expect(world.entities.get(sampleId)?.components.item?.holder).toBe(stationId);
    expect(inv.slots).not.toContain(sampleId);
    // The single slot refuses a second sample.
    giveSample(world, playerId, 20);
    world.dispatch({ type: 'depositResearchSample', playerId, stationId });
    world.tick();
    expect(research(world, stationId).inputId).toBe(sampleId);
    // Out of range refuses.
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: player.position.x + 50, y: player.position.y, z: player.position.z },
    });
    world.tick();
    const farSample = giveSample(world, playerId, 10);
    world.dispatch({ type: 'depositResearchSample', playerId, stationId });
    world.tick();
    expect(research(world, stationId).inputId).toBe(sampleId);
    expect(world.entities.get(farSample)?.components.item?.holder).toBe(playerId);
  });

  it('analyzes for 20 s then exposes the sample value as Data', () => {
    const { world, playerId, stationId } = spawnWorld();
    const sampleId = giveSample(world, playerId, 20);
    world.dispatch({ type: 'depositResearchSample', playerId, stationId });
    world.tick();
    tickToReady(world, stationId);
    expect(research(world, stationId).dataReady).toBe(0);
    world.tick();
    expect(research(world, stationId).dataReady).toBe(20);
    expect(research(world, stationId).inputId).toBe(null);
    expect(world.entities.has(sampleId)).toBe(false);
    // Collect adds to the global pool and clears the station.
    world.dispatch({ type: 'collectResearch', playerId, stationId });
    world.tick();
    expect(world.research.data).toBe(20);
    expect(research(world, stationId).dataReady).toBe(0);
  });

  it('honors the sample value for pods, node drops and core samples', () => {
    for (const [value, kind] of [
      [10, 'item'],
      [20, 'item'],
      [40, 'sample'],
    ] as const) {
      const { world, playerId, stationId } = spawnWorld();
      giveSample(world, playerId, value, kind);
      world.dispatch({ type: 'depositResearchSample', playerId, stationId });
      world.tick();
      tickToReady(world, stationId);
      world.tick();
      world.dispatch({ type: 'collectResearch', playerId, stationId });
      world.tick();
      expect(world.research.data).toBe(value);
    }
  });

  it('freezes analysis while the network cannot afford power', () => {
    const { world, playerId, stationId } = spawnWorld();
    giveSample(world, playerId, 10);
    world.dispatch({ type: 'depositResearchSample', playerId, stationId });
    world.tick();
    const power = world.entities.get(stationId)?.components.power;
    if (!power) throw new Error('no power');
    power.paused = true;
    const before = research(world, stationId).progressS;
    for (let i = 0; i < 60; i += 1) world.tick();
    expect(research(world, stationId).progressS).toBe(before);
    power.paused = false;
    for (let i = 0; i < 10; i += 1) world.tick();
    expect(research(world, stationId).progressS).toBeGreaterThan(before);
    // A loaded station is never empty enough to pack up.
    const station = world.entities.get(stationId);
    if (!station) throw new Error('no station');
    expect(isEntityEmpty(world, station)).toBe(false);
  });

  it('clears a stale saved input instead of advancing forever', () => {
    const { world, stationId } = spawnWorld();
    const component = research(world, stationId);
    component.inputId = 'sample_missing';
    world.tick();
    expect(component.inputId).toBe(null);
    expect(component.progressS).toBe(0);
  });

  it('fresh game: two crust samples fund Power basics end to end', () => {
    const { world, playerId, stationId } = spawnWorld();
    const processOne = (): void => {
      giveSample(world, playerId, 10);
      world.dispatch({ type: 'depositResearchSample', playerId, stationId });
      world.tick();
      tickToReady(world, stationId);
      world.tick();
      world.dispatch({ type: 'collectResearch', playerId, stationId });
      world.tick();
    };
    processOne();
    expect(world.research.data).toBe(10);
    world.dispatch({ type: 'unlockResearch', playerId, id: 'power_basics' });
    world.tick();
    expect(world.research.unlocked).toEqual([]);
    processOne();
    expect(world.research.data).toBe(20);
    world.dispatch({ type: 'unlockResearch', playerId, id: 'power_basics' });
    world.tick();
    expect(world.research.unlocked).toEqual(['power_basics']);
    expect(world.research.data).toBe(0);
  });
});
