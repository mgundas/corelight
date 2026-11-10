import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SELA } from '../../src/planets/configs/sela.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import type { ChunkCoord } from '../../src/terrain/chunkKey.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

/** Synchronous in-process collider source (real density, no workers). */
function directSource(calls: { count: number }): ColliderSource {
  return {
    request: (planet, worldSeed, coord: ChunkCoord) => {
      calls.count += 1;
      const data = buildColliderData(planet, worldSeed, coord);
      return Promise.resolve({
        id: 0,
        key: data.key,
        origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
        positions: data.positions,
        indices: data.indices,
        empty: data.empty,
      });
    },
  };
}

describe('TerrainColliders', () => {
  it('loads the ring around the player and reports ready', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const calls = { count: 0 };
    const colliders = new TerrainColliders(directSource(calls), () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    expect(colliders.groundState(spawn, [SELA])).toBe('pending');
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    expect(colliders.pendingCount).toBe(0);
    expect(colliders.loadedCount).toBeGreaterThan(0);
    expect(colliders.groundState(spawn, [SELA])).toBe('ready');
    const requested = calls.count;
    // Second update with no motion: no duplicate requests.
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    expect(calls.count).toBe(requested);
    colliders.dispose();
    rapierWorld.free();
  });

  it('drops far colliders when the player teleports away', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const calls = { count: 0 };
    const colliders = new TerrainColliders(directSource(calls), () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    const loaded = colliders.loadedCount;
    expect(loaded).toBeGreaterThan(0);
    // Opposite side of the planet: nothing overlaps the old ring.
    const far = { x: -spawn.x, y: -spawn.y, z: -spawn.z };
    colliders.update(far, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    // Old colliders are gone (new ones load for the far side).
    expect(colliders.loadedCount).toBeLessThanOrEqual(loaded);
    expect(colliders.groundState(far, [SELA])).toBe('ready');
    colliders.dispose();
    rapierWorld.free();
  });

  it('treats known-empty chunks as ready without colliders', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const emptySource: ColliderSource = {
      request: () =>
        Promise.resolve({
          id: 0,
          key: 'sela:0:0:0:0',
          origin: { x: 0, y: 0, z: 0 },
          positions: new Float32Array(0),
          indices: new Uint32Array(0),
          empty: true,
        }),
    };
    const colliders = new TerrainColliders(emptySource, () => rapierWorld);
    // High above the surface: the containing L0 chunk is all air.
    const high = { x: 0, y: SELA.radius + 300, z: 0 };
    colliders.update(high, [SELA], 1337);
    await Promise.resolve();
    expect(colliders.loadedCount).toBe(0);
    expect(colliders.groundState(high, [SELA])).toBe('ready');
    colliders.dispose();
    rapierWorld.free();
  });

  it('recovers from source failures on the next update', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    let fail = true;
    const flaky: ColliderSource = {
      request: (planet, worldSeed, coord) => {
        if (fail) return Promise.reject(new Error('boom'));
        const data = buildColliderData(planet, worldSeed, coord);
        return Promise.resolve({
          id: 0,
          key: data.key,
          origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
          positions: data.positions,
          indices: data.indices,
          empty: data.empty,
        });
      },
    };
    const colliders = new TerrainColliders(flaky, () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    expect(colliders.loadedCount).toBe(0);
    expect(colliders.groundState(spawn, [SELA])).toBe('pending');
    fail = false;
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    expect(colliders.loadedCount).toBeGreaterThan(0);
    colliders.dispose();
    rapierWorld.free();
  });

  it('only loads chunks intersecting the 48 m ring', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const calls = { count: 0 };
    const colliders = new TerrainColliders(directSource(calls), () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    // 48 m ring over 32 m chunks: a handful of chunks, not the whole planet.
    expect(colliders.loadedCount).toBeGreaterThan(0);
    expect(colliders.loadedCount).toBeLessThan(64);
    colliders.dispose();
    rapierWorld.free();
  });
});
