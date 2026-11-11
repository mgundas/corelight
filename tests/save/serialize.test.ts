// Save round-trip tests: serialize -> deserialize preserves entities,
// clock, ID counter and edits; same seed + same edits = identical density.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { events } from '../../src/core/events.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import { createDensityField } from '../../src/terrain/density.js';
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
  });

  it('ships version 1 with no migrations yet', () => {
    expect(SAVE_VERSION).toBe(1);
    expect(Object.keys(migrations)).toHaveLength(0);
  });
});
