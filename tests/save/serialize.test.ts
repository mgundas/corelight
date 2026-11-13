// Save round-trip tests: serialize -> deserialize preserves entities,
// clock, ID counter and edits; same seed + same edits = identical density.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { events } from '../../src/core/events.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import { createDensityField } from '../../src/terrain/density.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity } from '../../src/sim/snapUtils.js';
import {
  deserializeWorld,
  migrations,
  serializeWorld,
  SAVE_VERSION,
} from '../../src/save/serialize.js';

function makeEditedWorld(seed: number): World {
  const world = new World(seed, { planets: [SELA], time: 123.5 });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, seed) });
  world.dispatch({ type: 'debugSpawnMarker', position: { x: 10, y: 20, z: 30 } });
  world.dispatch({ type: 'debugSpawnMarker', position: { x: -5, y: 410, z: 7 } });
  world.tick();
  let playerId = '';
  for (const entity of world.entities.values()) {
    if (entity.kind === 'player') playerId = entity.id;
  }
  if (!playerId) throw new Error('no player spawned');
  const player = world.entities.get(playerId);
  if (!player) throw new Error('missing player');
  // A dig below the feet (earns soil) plus an add beside it (spends soil).
  const up = upAt(SELA, player.position);
  const digCenter = {
    x: player.position.x - up.x * 3,
    y: player.position.y - up.y * 3,
    z: player.position.z - up.z * 3,
  };
  world.dispatch({
    type: 'terrainEdit',
    playerId,
    planetId: SELA.id,
    mode: 'dig',
    center: digCenter,
    radius: 2,
    strength: 5,
  });
  world.tick();
  const soil = player.components.player?.soil ?? 0;
  expect(soil).toBeGreaterThan(0);
  const addCenter = {
    x: player.position.x + up.x * 2,
    y: player.position.y + up.y * 2,
    z: player.position.z + up.z * 2,
  };
  world.dispatch({
    type: 'terrainEdit',
    playerId,
    planetId: SELA.id,
    mode: 'add',
    center: addCenter,
    radius: 1.5,
    strength: 2,
  });
  world.tick();
  expect(world.terrainEdits.sampleCount).toBeGreaterThan(0);
  return world;
}

describe('save round trip', () => {
  it('deserialize(serialize(world)) equals the original', () => {
    events.clear();
    const world = makeEditedWorld(1337);
    const data = serializeWorld(world);
    expect(data.version).toBe(SAVE_VERSION);
    // JSON-able: survives a string round trip (the IndexedDB shape).
    const revived = deserializeWorld(JSON.parse(JSON.stringify(data)) as unknown, [SELA]);
    expect(revived.seed).toBe(world.seed);
    expect(revived.time).toBe(world.time);
    expect(revived.getIdCounter()).toBe(world.getIdCounter());
    expect(revived.nextId('probe')).toBe(world.nextId('probe'));
    expect(revived.entities.size).toBe(world.entities.size);
    for (const [id, entity] of world.entities) {
      expect(revived.entities.get(id)).toEqual(entity);
    }
    expect(revived.terrainEdits.sampleCount).toBe(world.terrainEdits.sampleCount);
    // Same seed + same edits = identical density at edited and far points.
    const a = createDensityField(SELA, world.seed, (x, y, z) =>
      world.terrainEdits.deltaAt(SELA, SELA.id, x, y, z),
    );
    const b = createDensityField(SELA, revived.seed, (x, y, z) =>
      revived.terrainEdits.deltaAt(SELA, SELA.id, x, y, z),
    );
    const player = [...revived.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('player lost in round trip');
    const local = {
      x: player.position.x - SELA.center.x,
      y: player.position.y - SELA.center.y,
      z: player.position.z - SELA.center.z,
    };
    const points = [
      local,
      { x: local.x + 1.3, y: local.y - 2.1, z: local.z + 0.7 },
      { x: 0, y: SELA.radius + 50, z: 0 },
      { x: 100, y: SELA.radius - 200, z: -60 },
    ];
    for (const p of points) {
      // Float32 save blobs quantize deltas: equality holds to ~1e-7.
      expect(Math.abs(b.density(p.x, p.y, p.z) - a.density(p.x, p.y, p.z))).toBeLessThan(1e-6);
    }
  });

  it('round-trips cables, slot attachments and battery charge', () => {
    events.clear();
    const world = makeEditedWorld(1337);
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('missing player');
    const platformId = spawnPlaceableEntity(world, SELA.id, 'platform', {
      ...player.position,
      y: player.position.y - 1,
    });
    if (!platformId) throw new Error('no platform');
    const batteryId = spawnPlaceableEntity(
      world,
      SELA.id,
      'battery',
      { ...player.position, y: player.position.y - 0.3 },
      { attachTo: platformId, attachSlot: 1 },
    );
    if (!batteryId) throw new Error('no battery');
    const power = world.entities.get(batteryId)?.components.power;
    if (!power) throw new Error('no power');
    power.stored = 42;
    const cableId = createCableEntity(
      world,
      SELA.id,
      { entityId: platformId, snapIndex: 0 },
      { entityId: batteryId, snapIndex: 0 },
    );
    if (!cableId) throw new Error('no cable');
    const revived = deserializeWorld(
      JSON.parse(JSON.stringify(serializeWorld(world))) as unknown,
      [SELA],
    );
    expect(revived.entities.get(cableId)?.kind).toBe('cable');
    expect(revived.entities.get(cableId)?.components.cable?.a.entityId).toBe(platformId);
    expect(revived.entities.get(batteryId)?.components.power?.stored).toBe(42);
    expect(revived.entities.get(batteryId)?.components.placeable?.attachedTo).toBe(platformId);
    expect([...revived.entities.values()].filter((e) => e.kind === 'cable')).toHaveLength(1);
  });

  it('two worlds with the same seed and edits agree exactly', () => {
    events.clear();
    const a = makeEditedWorld(99);
    const b = deserializeWorld(serializeWorld(a), [SELA]);
    const fa = createDensityField(SELA, 99, (x, y, z) => a.terrainEdits.deltaAt(SELA, SELA.id, x, y, z));
    const fb = createDensityField(SELA, 99, (x, y, z) => b.terrainEdits.deltaAt(SELA, SELA.id, x, y, z));
    for (let i = 0; i < 20; i += 1) {
      const p = { x: i * 3.7 - 20, y: SELA.radius - 10 - i * 7.3, z: i * 1.9 };
      expect(Math.abs(fb.density(p.x, p.y, p.z) - fa.density(p.x, p.y, p.z))).toBeLessThan(1e-6);
    }
  });

  it('rejects corrupt saves loudly', () => {
    expect(() => deserializeWorld(null, [SELA])).toThrow();
    expect(() => deserializeWorld({ version: 999, seed: 1 }, [SELA])).toThrow();
    const good = serializeWorld(makeEditedWorld(5));
    expect(() => deserializeWorld({ ...good, entities: [{ id: 'x' }] }, [SELA])).toThrow();
    expect(() => deserializeWorld({ ...good, edits: { bogus: '!!!' } }, [SELA])).toThrow();
    // Components must be a record of objects, not primitives or arrays.
    const badComponents = JSON.parse(JSON.stringify(good)) as typeof good;
    (badComponents.entities[0] as unknown as Record<string, unknown>)['components'] = { player: 5 };
    expect(() => deserializeWorld(badComponents, [SELA])).toThrow();
  });

  it('ships version 3 with v1/v2 migrations', () => {
    expect(SAVE_VERSION).toBe(3);
    expect(Object.keys(migrations)).toEqual(['1', '2']);
    const v1 = { ...serializeWorld(makeEditedWorld(5)), version: 1 } as unknown as Record<string, unknown>;
    delete v1['depleted'];
    delete v1['nodeCharges'];
    delete v1['research'];
    delete v1['depletedSamples'];
    const revived = deserializeWorld(v1, [SELA]);
    expect(revived.depletedNodes.size).toBe(0);
    expect(revived.nodeCharges.size).toBe(0);
    expect(revived.research).toEqual({ data: 0, unlocked: [] });
    expect(revived.depletedSamples.size).toBe(0);
  });

  it('migrates v2 saves with default research state', () => {
    const v2 = { ...serializeWorld(makeEditedWorld(5)), version: 2 } as unknown as Record<string, unknown>;
    delete v2['research'];
    delete v2['depletedSamples'];
    const revived = deserializeWorld(v2, [SELA]);
    expect(revived.research.data).toBe(0);
    expect(revived.research.unlocked).toEqual([]);
    expect(revived.depletedSamples.size).toBe(0);
  });

  it('round-trips research Data, unlocks and depleted samples', () => {
    events.clear();
    const world = makeEditedWorld(77);
    world.research.data = 35;
    world.research.unlocked = ['power_basics', 'drill_mk2'];
    world.depletedSamples.add('sample_sela_0_16_23_16');
    world.depletedSamples.add('sample_sela_0_17_24_16');
    const data = serializeWorld(world);
    expect(data.research).toEqual({ data: 35, unlocked: ['power_basics', 'drill_mk2'] });
    expect(data.depletedSamples).toHaveLength(2);
    const revived = deserializeWorld(JSON.parse(JSON.stringify(data)) as unknown, [SELA]);
    expect(revived.research).toEqual({ data: 35, unlocked: ['power_basics', 'drill_mk2'] });
    expect([...revived.depletedSamples].sort()).toEqual([
      'sample_sela_0_16_23_16',
      'sample_sela_0_17_24_16',
    ]);
  });

  it('rejects malformed research and sample component fields', () => {
    const good = serializeWorld(makeEditedWorld(5));
    const corrupt = (components: Record<string, unknown>): Record<string, unknown> => {
      const copy = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
      const list = copy['entities'] as Array<Record<string, unknown>>;
      const first = list[0];
      if (!first) throw new Error('no entity in fixture');
      first['components'] = components;
      return copy;
    };
    expect(() => deserializeWorld(corrupt({ research: { inputId: 5, progressS: 0, dataReady: 0 } }), [SELA])).toThrow();
    expect(() => deserializeWorld(corrupt({ research: { inputId: null, progressS: '1', dataReady: 0 } }), [SELA])).toThrow();
    expect(() => deserializeWorld(corrupt({ research: { inputId: null, progressS: 0, dataReady: null } }), [SELA])).toThrow();
    expect(() => deserializeWorld(corrupt({ sample: { value: null, chunkKey: 'k' } }), [SELA])).toThrow();
    expect(() => deserializeWorld(corrupt({ sample: { value: 10, chunkKey: 3 } }), [SELA])).toThrow();
  });

  it('drops unknown research ids and rejects malformed research on load', () => {
    const good = serializeWorld(makeEditedWorld(5));
    const unknown = JSON.parse(JSON.stringify(good)) as typeof good;
    unknown.research = { data: 10, unlocked: ['power_basics', 'gone_entry'] };
    const revived = deserializeWorld(unknown, [SELA]);
    expect(revived.research.unlocked).toEqual(['power_basics']);
    for (const research of [
      { data: -1, unlocked: [] },
      { data: Number.NaN, unlocked: [] },
      { data: 5, unlocked: [3] },
      { data: 5 },
      null,
    ]) {
      expect(() => deserializeWorld({ ...good, research } as unknown, [SELA])).toThrow();
    }
  });

  it('round-trips habitats, tethers, oxygen and death markers exactly', () => {
    events.clear();
    const world = new World(1337, { planets: [SELA] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: SELA.id,
      position: findSpawnPosition(SELA, 1337),
    });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    if (!playerId) throw new Error('no player');
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    world.dispatch({ type: 'spawnHabitat', planetId: SELA.id, position: { ...player.position } });
    world.tick();
    const habitat = [...world.entities.values()].find((e) => e.kind === 'machine');
    if (!habitat) throw new Error('no habitat');
    const tetherId = world.nextId('tether');
    world.entities.set(tetherId, {
      id: tetherId,
      kind: 'tether',
      planetId: SELA.id,
      position: { ...player.position },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: { tether: { live: true, links: [] } },
    });
    const markerId = world.nextId('marker');
    world.entities.set(markerId, {
      id: markerId,
      kind: 'marker',
      planetId: SELA.id,
      position: { ...player.position },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: {},
    });
    const comp = player.components.player;
    if (!comp) throw new Error('no player comp');
    comp.deathMarkerId = markerId;
    if (player.components.oxygen) player.components.oxygen.value = 42.5;
    const revived = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))) as unknown, [SELA]);
    expect(revived.entities.size).toBe(world.entities.size);
    for (const [id, entity] of world.entities) {
      expect(revived.entities.get(id)).toEqual(entity);
    }
  });

  it('round-trips a research station job and a sample pod (M11)', () => {
    events.clear();
    const world = makeEditedWorld(1337);
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('missing player');
    const stationId = spawnPlaceableEntity(world, SELA.id, 'research_station', {
      ...player.position,
      y: player.position.y - 0.3,
    });
    if (!stationId) throw new Error('no station');
    const sampleId = world.nextId('sample');
    world.entities.set(sampleId, {
      id: sampleId,
      kind: 'sample',
      planetId: SELA.id,
      position: { ...player.position },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: {
        sample: { value: 20, chunkKey: 'sela:0:16:23:16' },
        item: { itemId: 'research_sample', holder: stationId },
      },
    });
    const research = world.entities.get(stationId)?.components.research;
    if (!research) throw new Error('no research component');
    research.inputId = sampleId;
    research.progressS = 7.5;
    research.dataReady = 40;
    world.depletedSamples.add(sampleId);
    const revived = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))) as unknown, [SELA]);
    expect(revived.entities.get(stationId)?.components.research).toEqual({
      inputId: sampleId,
      progressS: 7.5,
      dataReady: 40,
    });
    expect(revived.entities.get(sampleId)).toEqual(world.entities.get(sampleId));
    expect(revived.depletedSamples.has(sampleId)).toBe(true);
  });

  it('round-trips M09 printer jobs and front-carried packages', () => {
    events.clear();
    const world = new World(1337, { planets: [SELA] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: SELA.id,
      position: findSpawnPosition(SELA, 1337),
    });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    if (!playerId) throw new Error('no player');
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const stationId = world.nextId('machine');
    world.entities.set(stationId, {
      id: stationId,
      kind: 'machine',
      planetId: SELA.id,
      position: { ...player.position },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: {
        machine: { machineType: 'small_printer' },
        placeable: { placeableId: 'small_printer' },
        printer: {
          recipeId: 'platform',
          progressS: 0.75,
          inputs: [],
          outputReady: 'platform',
          // M12: furnace fuel boost is a free-form printer field.
          boosted: true,
        },
      },
    });
    const inputId = world.nextId('item');
    world.entities.set(inputId, {
      id: inputId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...player.position },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: { item: { itemId: 'silicate', holder: stationId } },
    });
    const printer = world.entities.get(stationId)?.components.printer;
    if (printer) printer.inputs.push(inputId);
    const packageId = world.nextId('item');
    world.entities.set(packageId, {
      id: packageId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...player.position },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: { item: { itemId: 'platform_package', holder: playerId } },
    });
    const playerComp = player.components.player;
    if (playerComp) playerComp.carryingLarge = packageId;
    const revived = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))) as unknown, [SELA]);
    expect(SAVE_VERSION).toBe(3);
    expect(revived.entities.get(stationId)).toEqual(world.entities.get(stationId));
    expect(revived.entities.get(playerId)?.components.player?.carryingLarge).toBe(packageId);
    expect(revived.entities.get(inputId)?.components.item?.holder).toBe(stationId);
  });

  it('round-trips a piloted shuttle and the last-habitat respawn link', () => {
    events.clear();
    const world = makeEditedWorld(1337);
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('no player');
    const shuttleId = spawnPlaceableEntity(world, SELA.id, 'shuttle', { ...player.position });
    if (!shuttleId) throw new Error('no shuttle');
    const shuttle = world.entities.get(shuttleId)?.components.shuttle;
    const playerComp = player.components.player;
    if (!shuttle || !playerComp) throw new Error('missing components');
    shuttle.fuel = 2;
    shuttle.pilotId = player.id;
    shuttle.velocity = { x: 12, y: -3, z: 4 };
    shuttle.yaw = 0.4;
    shuttle.pitch = -0.2;
    shuttle.up = { x: 0.1, y: 0.9, z: 0.2 };
    shuttle.launchChargeS = 0.5;
    shuttle.airborne = true;
    playerComp.pilotingShuttleId = shuttleId;
    playerComp.lastHabitatId = 'habitat_from_an_earlier_visit';
    const revived = deserializeWorld(
      JSON.parse(JSON.stringify(serializeWorld(world))) as unknown,
      [SELA],
    );
    expect(revived.entities.get(shuttleId)?.components.shuttle).toEqual(shuttle);
    expect(revived.entities.get(player.id)?.components.player?.pilotingShuttleId).toBe(shuttleId);
    expect(revived.entities.get(player.id)?.components.player?.lastHabitatId).toBe(
      'habitat_from_an_earlier_visit',
    );
  });

  it('rejects malformed shuttle flight state and player links', () => {
    const world = makeEditedWorld(1337);
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('no player');
    const shuttleId = spawnPlaceableEntity(world, SELA.id, 'shuttle', { ...player.position });
    if (!shuttleId) throw new Error('no shuttle');
    const good = JSON.parse(JSON.stringify(serializeWorld(world))) as {
      entities: Array<{ id: string; components: Record<string, unknown> }>;
    };
    const badFuel = JSON.parse(JSON.stringify(good)) as typeof good;
    const shuttleEntry = badFuel.entities.find((e) => e.id === shuttleId);
    if (!shuttleEntry) throw new Error('missing shuttle');
    (shuttleEntry.components['shuttle'] as Record<string, unknown>)['fuel'] = 'full';
    expect(() => deserializeWorld(badFuel, [SELA])).toThrow();
    for (const patch of [
      { fuel: 999 },
      { launchChargeS: 3 },
      { up: { x: 0, y: 0, z: 0 } },
      { airborne: 'yes' },
    ]) {
      const bad = JSON.parse(JSON.stringify(good)) as typeof good;
      const entry = bad.entities.find((e) => e.id === shuttleId);
      if (!entry) throw new Error('missing shuttle');
      Object.assign(entry.components['shuttle'] as Record<string, unknown>, patch);
      expect(() => deserializeWorld(bad, [SELA]), JSON.stringify(patch)).toThrow();
    }
    const badLink = JSON.parse(JSON.stringify(good)) as typeof good;
    const playerEntry = badLink.entities.find((e) => e.id === player.id);
    if (!playerEntry) throw new Error('missing player');
    (playerEntry.components['player'] as Record<string, unknown>)['pilotingShuttleId'] = 7;
    expect(() => deserializeWorld(badLink, [SELA])).toThrow();
  });
});
