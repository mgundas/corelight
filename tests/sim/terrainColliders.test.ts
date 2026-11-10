import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SELA } from '../../src/planets/configs/sela.js';
import { buildColliderData, colliderKey } from '../../src/terrain/colliders.js';
import { chunkSizeForLevel, type ChunkCoord } from '../../src/terrain/chunkKey.js';
import { rootMin } from '../../src/terrain/octree.js';
import type { ColliderResult } from '../../src/terrain/colliderPool.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';

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

  it('casts camera rays against terrain colliders, ignoring other bodies', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const calls = { count: 0 };
    const colliders = new TerrainColliders(directSource(calls), () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    const up = upAt(SELA, spawn);
    const origin = { x: spawn.x + up.x * 3, y: spawn.y + up.y * 3, z: spawn.z + up.z * 3 };
    const down = { x: -up.x, y: -up.y, z: -up.z };
    // A non-terrain capsule directly in the ray must not pull the camera in.
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.35).setTranslation(
        spawn.x + up.x * 1.5,
        spawn.y + up.y * 1.5,
        spawn.z + up.z * 1.5,
      ),
    );
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    const hit = colliders.castTerrainRay(origin, down, [SELA], 10);
    expect(hit).not.toBeNull();
    expect(hit as number).toBeGreaterThan(3);
    expect(hit as number).toBeLessThan(6);
    expect(colliders.castTerrainRay(origin, down, [SELA], 1)).toBeNull();
    colliders.dispose();
    rapierWorld.free();
  });

  it('reports deep space as ready with no ray hit', () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const calls = { count: 0 };
    const colliders = new TerrainColliders(directSource(calls), () => rapierWorld);
    const deep = { x: 0, y: SELA.radius * 10, z: 0 };
    colliders.update(deep, [SELA], 1337);
    expect(colliders.pendingCount).toBe(0);
    expect(colliders.groundState(deep, [SELA])).toBe('ready');
    expect(colliders.castTerrainRay(deep, { x: 0, y: -1, z: 0 }, [SELA], 100)).toBeNull();
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
    expect(colliders.castTerrainRay(high, { x: 0, y: -1, z: 0 }, [SELA], 100)).toBeNull();
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

  it('rebuilds edited chunks without ever losing ground (ghost support)', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const seenVersions: number[] = [];
    const requested: string[] = [];
    const source: ColliderSource = {
      request: (planet, worldSeed, coord, editVersion) => {
        seenVersions.push(editVersion ?? -1);
        const data = buildColliderData(planet, worldSeed, coord);
        requested.push(data.key);
        return Promise.resolve({
          id: 0,
          key: data.key,
          origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
          positions: data.positions,
          indices: data.indices,
          empty: data.empty,
          editVersion,
        });
      },
    };
    const colliders = new TerrainColliders(source, () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    expect(colliders.groundState(spawn, [SELA])).toBe('ready');
    const loaded = colliders.loadedCount;
    expect(loaded).toBeGreaterThan(0);
    const callsBefore = requested.length;

    // Edit one loaded chunk: a rebuild is requested even though a collider
    // already exists, and the ground stays 'ready' on ghost support.
    const key = requested[0] as string;
    colliders.notifyEdited([key]);
    expect(colliders.groundState(spawn, [SELA])).toBe('ready');
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    expect(requested.length).toBeGreaterThan(callsBefore);
    expect(seenVersions[seenVersions.length - 1]).toBe(1);
    expect(colliders.loadedCount).toBe(loaded);
    expect(colliders.groundState(spawn, [SELA])).toBe('ready');
    // Settled: no further requests.
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    expect(requested.length).toBeGreaterThan(callsBefore);
    const settled = requested.length;
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    expect(requested.length).toBe(settled);
    colliders.dispose();
    rapierWorld.free();
  });

  it('drops stale collider results and retries with the current version', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const gate: Array<{
      coord: ChunkCoord;
      version: number | undefined;
      resolve: (result: ColliderResult) => void;
    }> = [];
    const source: ColliderSource = {
      request: (planet, worldSeed, coord, editVersion) => {
        void planet;
        void worldSeed;
        return new Promise<ColliderResult>((resolve) => {
          gate.push({ coord: { ...coord }, version: editVersion, resolve });
        });
      },
    };
    const colliders = new TerrainColliders(source, () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    colliders.update(spawn, [SELA], 1337);
    // Race the edit against the player's own (containing) chunk job.
    const size = chunkSizeForLevel(0);
    const min = rootMin(SELA);
    const perAxis = 2 ** SELA.lodMaxLevel;
    const clampAxis = (v: number): number =>
      Math.min(perAxis - 1, Math.max(0, Math.floor(v / size)));
    const here = {
      x: clampAxis(spawn.x - min.x),
      y: clampAxis(spawn.y - min.y),
      z: clampAxis(spawn.z - min.z),
    };
    const first = gate.find(
      (g) => g.coord.x === here.x && g.coord.y === here.y && g.coord.z === here.z,
    );
    if (!first) throw new Error('containing chunk was not requested');
    const key = colliderKey(SELA.id, first.coord);
    colliders.notifyEdited([key]);
    // The pre-edit job (v0) resolves stale: dropped, never installed.
    const staleData = buildColliderData(SELA, 1337, first.coord);
    first.resolve({
      id: 0,
      key: staleData.key,
      origin: { x: staleData.origin.x, y: staleData.origin.y, z: staleData.origin.z },
      positions: staleData.positions,
      indices: staleData.indices,
      empty: staleData.empty,
      editVersion: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    // Retry carries the current version; resolving installs the collider.
    colliders.update(spawn, [SELA], 1337);
    const retries = gate.filter((g) => colliderKey(SELA.id, g.coord) === key);
    const retry = retries[retries.length - 1];
    if (!retry) throw new Error('no retry submitted');
    expect(retry.version).toBe(1);
    const fresh = buildColliderData(SELA, 1337, retry.coord);
    retry.resolve({
      id: 0,
      key: fresh.key,
      origin: { x: fresh.origin.x, y: fresh.origin.y, z: fresh.origin.z },
      positions: fresh.positions,
      indices: fresh.indices,
      empty: fresh.empty,
      editVersion: 1,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(colliders.groundState(spawn, [SELA])).toBe('ready');
    colliders.dispose();
    rapierWorld.free();
  });

  it('prunes rebuild state for chunks evicted from the ring', async () => {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const seen: Array<{ key: string; version: number }> = [];
    const source: ColliderSource = {
      request: (planet, worldSeed, coord, editVersion) => {
        const data = buildColliderData(planet, worldSeed, coord);
        seen.push({ key: data.key, version: editVersion ?? -1 });
        return Promise.resolve({
          id: 0,
          key: data.key,
          origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
          positions: data.positions,
          indices: data.indices,
          empty: data.empty,
          editVersion,
        });
      },
    };
    const colliders = new TerrainColliders(source, () => rapierWorld);
    const spawn = findSpawnPosition(SELA, 1337);
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    expect(colliders.loadedCount).toBeGreaterThan(0);
    const key = seen[0]?.key;
    if (!key) throw new Error('no collider requested');
    // Edit + rebuild, then walk away so the ring evicts the ghost.
    colliders.notifyEdited([key]);
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    const far = { x: -spawn.x, y: -spawn.y, z: -spawn.z };
    colliders.update(far, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    // Walk back: the chunk re-requests with a pruned (0) version.
    seen.length = 0;
    colliders.update(spawn, [SELA], 1337);
    await Promise.resolve();
    await Promise.resolve();
    const retry = seen.find((s) => s.key === key);
    expect(retry?.version).toBe(0);
    colliders.dispose();
    rapierWorld.free();
  });
});
