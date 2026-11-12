// M13: entities and terrain edits on Vorn survive save/load. Edits are keyed
// by planet id already, so no format change or version bump is needed.

import { describe, expect, it } from 'vitest';
import { upAt } from '../../src/sim/physics/frames.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { World } from '../../src/sim/world.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createDensityField } from '../../src/terrain/density.js';
import { deserializeWorld, serializeWorld, SAVE_VERSION } from '../../src/save/serialize.js';

const PLANETS = [SELA, VORN];

describe('Vorn save round trip', () => {
  it('preserves Vorn entities and Vorn chunk edits', () => {
    const world = new World(1337, { planets: PLANETS, time: 456.5 });
    const spawn = findSpawnPosition(VORN, 1337);
    world.dispatch({ type: 'spawnPlayer', planetId: 'vorn', position: spawn });
    world.tick();
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('no player');
    expect(player.planetId).toBe('vorn');

    const up = upAt(VORN, player.position);
    const digCenter = {
      x: player.position.x - up.x * 3,
      y: player.position.y - up.y * 3,
      z: player.position.z - up.z * 3,
    };
    world.dispatch({
      type: 'terrainEdit',
      playerId: player.id,
      planetId: 'vorn',
      mode: 'dig',
      center: digCenter,
      radius: 2,
      strength: 5,
    });
    world.tick();
    expect(world.terrainEdits.sampleCount).toBeGreaterThan(0);

    // A structure on Vorn (plus the habitat-less player) must round-trip.
    const machinePos = { x: spawn.x + 4, y: spawn.y, z: spawn.z };
    const platformId = spawnPlaceableEntity(world, 'vorn', 'platform', machinePos);
    expect(platformId).not.toBe(null);

    const data = serializeWorld(world);
    expect(data.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(3);
    const revived = deserializeWorld(JSON.parse(JSON.stringify(data)) as unknown, PLANETS);
    expect(revived.entities.size).toBe(world.entities.size);
    for (const [id, entity] of world.entities) {
      expect(revived.entities.get(id)).toEqual(entity);
    }
    expect(revived.entities.get(player.id)?.planetId).toBe('vorn');
    expect(revived.terrainEdits.sampleCount).toBe(world.terrainEdits.sampleCount);

    // Same seed + same Vorn edits = identical edited density (1e-6 tolerance
    // covers Float32 quantization in the base64 edit payload).
    const local = {
      x: digCenter.x - VORN.center.x,
      y: digCenter.y - VORN.center.y,
      z: digCenter.z - VORN.center.z,
    };
    const before = createDensityField(VORN, world.seed, (x, y, z) =>
      world.terrainEdits.deltaAt(VORN, VORN.id, x, y, z),
    );
    const after = createDensityField(VORN, revived.seed, (x, y, z) =>
      revived.terrainEdits.deltaAt(VORN, VORN.id, x, y, z),
    );
    expect(after.density(local.x, local.y, local.z)).toBeCloseTo(
      before.density(local.x, local.y, local.z),
      6,
    );
    // Sela terrain is untouched by a Vorn edit.
    expect(revived.terrainEdits.deltaAt(SELA, SELA.id, 0, SELA.radius, 0)).toBe(0);
  });
});
