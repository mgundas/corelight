// M11 research panel projection: tree states/costs, Data balance, station
// slot/progress, range closing and the toast text.

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import { buildResearchState } from '../../src/game/researchWiring.js';
import { unlockToastText } from '../../src/ui/researchUi.js';

interface Ctx {
  world: World;
  playerId: EntityId;
  stationId: EntityId;
}

function context(): Ctx {
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
      machine: { machineType: 'research_station' },
      placeable: { placeableId: 'research_station' },
      research: { inputId: null, progressS: 0, dataReady: 0 },
      power: { stored: 0, capacity: 0, paused: false, networkId: null },
    },
  });
  return { world, playerId: player.id, stationId };
}

describe('research panel state', () => {
  it('lists the tree with costs, prerequisites and affordability', () => {
    const { world, playerId, stationId } = context();
    const fresh = buildResearchState(world, playerId, stationId);
    if (!fresh) throw new Error('no state');
    expect(fresh.data).toBe(0);
    const power = fresh.rows.find((row) => row.id === 'power_basics');
    expect(power?.state).toBe('available');
    expect(power?.cost).toBe(20);
    expect(power?.enabled).toBe(false);
    const mk3 = fresh.rows.find((row) => row.id === 'drill_mk3');
    expect(mk3?.state).toBe('locked');
    expect(mk3?.requires).toEqual(['Drill Mk2']);
    expect(mk3?.enabled).toBe(false);
    // Data arrives: the affordable row enables.
    world.research.data = 20;
    const affordable = buildResearchState(world, playerId, stationId);
    expect(affordable?.rows.find((row) => row.id === 'power_basics')?.enabled).toBe(true);
    // Buying it flips the row; a prerequisite opens the next entry.
    world.research.unlocked = ['drill_mk2'];
    world.research.data = 40;
    const progressed = buildResearchState(world, playerId, stationId);
    expect(progressed?.rows.find((row) => row.id === 'drill_mk2')?.state).toBe('unlocked');
    expect(progressed?.rows.find((row) => row.id === 'drill_mk3')?.state).toBe('available');
  });

  it('shows the sample slot, progress, pause state and ready Data', () => {
    const { world, playerId, stationId } = context();
    const station = world.entities.get(stationId);
    if (!station) throw new Error('no station');
    const sampleId = world.nextId('sample');
    world.entities.set(sampleId, {
      id: sampleId,
      kind: 'sample',
      planetId: SELA.id,
      position: { ...station.position },
      rotation: { ...IDENTITY_QUAT },
      components: {
        sample: { value: 20, chunkKey: 'k' },
        item: { itemId: 'research_sample', holder: stationId },
      },
    });
    const research = station.components.research;
    if (!research) throw new Error('no research');
    research.inputId = sampleId;
    research.progressS = 7.25;
    let state = buildResearchState(world, playerId, stationId);
    expect(state?.station.slots).toEqual(['Research sample']);
    expect(state?.station.hasInput).toBe(true);
    expect(state?.station.progressS).toBe(7.3);
    expect(state?.station.timeS).toBe(20);
    expect(state?.station.paused).toBe(false);
    if (station.components.power) station.components.power.paused = true;
    state = buildResearchState(world, playerId, stationId);
    expect(state?.station.paused).toBe(true);
    expect(state?.hint).toMatch(/paused/i);
    research.inputId = null;
    research.progressS = 0;
    research.dataReady = 20;
    state = buildResearchState(world, playerId, stationId);
    expect(state?.station.dataReady).toBe(20);
    expect(state?.hint).toMatch(/collect/i);
  });

  it('returns null for non-research/far stations but tolerates an unhealed component', () => {
    const { world, playerId, stationId } = context();
    const station = world.entities.get(stationId);
    if (!station) throw new Error('no station');
    station.components.machine = { machineType: 'small_printer' };
    expect(buildResearchState(world, playerId, stationId)).toBe(null);
    station.components.machine = { machineType: 'research_station' };
    delete station.components.research;
    // Old/hand-made save: the panel opens as an empty station instead of
    // closing before updateResearch can heal the component.
    const unhealed = buildResearchState(world, playerId, stationId);
    expect(unhealed).not.toBe(null);
    expect(unhealed?.station.hasInput).toBe(false);
    expect(unhealed?.station.dataReady).toBe(0);
    expect(unhealed?.station.slots).toEqual([null]);
    station.components.research = { inputId: null, progressS: 0, dataReady: 0 };
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: player.position.x + 50, y: player.position.y, z: player.position.z },
    });
    world.tick();
    expect(buildResearchState(world, playerId, stationId)).toBe(null);
  });
});

describe('unlock toast text', () => {
  it('names one or several blueprints', () => {
    expect(unlockToastText(['solar_panel'])).toBe('New blueprint: Solar panel');
    expect(unlockToastText(['solar_panel', 'battery'])).toBe(
      'New blueprints: Solar panel, Battery',
    );
    expect(unlockToastText([])).toBe('New blueprint unlocked');
    expect(unlockToastText(['unknown_id'])).toBe('New blueprint: unknown_id');
  });
});
