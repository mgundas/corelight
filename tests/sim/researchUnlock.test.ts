// M11 unlock rules: cost/prerequisite validation, one-time purchases, the
// toast event, and the acceptance gate (no solar panel before Power basics).

import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import { canUnlockResearch, unlockedRecipesFor } from '../../src/sim/researchActions.js';

interface Ctx {
  world: World;
  playerId: EntityId;
  stationId: EntityId;
}

function spawnWorld(): Ctx {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
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
      machine: { machineType: 'small_printer' },
      printer: { recipeId: null, progressS: 0, inputs: [], outputReady: null },
    },
  });
  return { world, playerId: player.id, stationId };
}

function addInput(world: World, stationId: EntityId, itemId: string): void {
  const station = world.entities.get(stationId);
  const printer = station?.components.printer;
  if (!station || !printer) throw new Error('no station');
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

function appliedCount(type: string): () => number {
  let count = 0;
  events.on('actionApplied', ({ type: eventType }) => {
    if (eventType === type) count += 1;
  });
  return () => count;
}

describe('unlockResearch', () => {
  beforeEach(() => events.clear());

  it('rejects unknown, already unlocked, underfunded and blocked entries', () => {
    const { world, playerId } = spawnWorld();
    const applied = appliedCount('unlockResearch');
    world.dispatch({ type: 'unlockResearch', playerId, id: 'nope' });
    world.tick();
    expect(world.research.unlocked).toEqual([]);
    expect(applied()).toBe(1);
    // Power basics costs 20; no Data yet.
    world.dispatch({ type: 'unlockResearch', playerId, id: 'power_basics' });
    world.tick();
    expect(world.research.unlocked).toEqual([]);
    expect(applied()).toBe(2);
    // Drill Mk3 requires Drill Mk2 even with plenty of Data.
    world.research.data = 500;
    world.dispatch({ type: 'unlockResearch', playerId, id: 'drill_mk3' });
    world.tick();
    expect(world.research.unlocked).toEqual([]);
    expect(world.research.data).toBe(500);
    // Unknown player is a no-op, not a crash.
    world.dispatch({ type: 'unlockResearch', playerId: 'player_missing', id: 'power_basics' });
    world.tick();
    expect(world.research.unlocked).toEqual([]);
  });

  it('deducts Data, records the entry and emits the toast payload', () => {
    const { world, playerId } = spawnWorld();
    world.research.data = 25;
    let payload: { id: string; recipeIds: string[] } | null = null;
    events.on('researchUnlocked', (event) => {
      payload = event;
    });
    world.dispatch({ type: 'unlockResearch', playerId, id: 'power_basics' });
    world.tick();
    expect(world.research.data).toBe(5);
    expect(world.research.unlocked).toEqual(['power_basics']);
    expect(payload).toEqual({ id: 'power_basics', recipeIds: ['solar_panel', 'battery'] });
    expect([...unlockedRecipesFor(world)].sort()).toEqual(['battery', 'solar_panel']);
    // Buying it twice is a no-op and never charges twice.
    world.dispatch({ type: 'unlockResearch', playerId, id: 'power_basics' });
    world.tick();
    expect(world.research.data).toBe(5);
    expect(world.research.unlocked).toEqual(['power_basics']);
  });

  it('unlocks prerequisites in order', () => {
    const { world, playerId } = spawnWorld();
    world.research.data = 100;
    expect(canUnlockResearch(world.research, 'drill_mk3')).toBe(false);
    world.dispatch({ type: 'unlockResearch', playerId, id: 'drill_mk2' });
    world.tick();
    expect(canUnlockResearch(world.research, 'drill_mk3')).toBe(true);
    world.dispatch({ type: 'unlockResearch', playerId, id: 'drill_mk3' });
    world.tick();
    expect(world.research.unlocked).toEqual(['drill_mk2', 'drill_mk3']);
    expect(world.research.data).toBe(40);
  });

  it('a new game cannot print solar panels until Power basics is bought', () => {
    const { world, playerId, stationId } = spawnWorld();
    addInput(world, stationId, 'silicate');
    addInput(world, stationId, 'copper');
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'solar_panel' });
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.recipeId).toBe(null);
    // The synapse: enough Data plus the unlock makes the very same action work.
    world.research.data = 20;
    world.dispatch({ type: 'unlockResearch', playerId, id: 'power_basics' });
    world.tick();
    world.dispatch({ type: 'printAtStation', playerId, stationId, recipeId: 'solar_panel' });
    world.tick();
    expect(world.entities.get(stationId)?.components.printer?.recipeId).toBe('solar_panel');
  });
});
