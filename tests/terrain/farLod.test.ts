// M13: the camera's planet streams full LOD; other planets are capped at
// their boot-prebuilt detail floor (lodMaxLevel - 2) and never take worker
// slots ahead of the near planet.

import { describe, expect, it } from 'vitest';
import { FAR_PLANET_LOD_DROP } from '../../src/core/constants.js';
import type { Vec3d } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { parseChunkKey } from '../../src/terrain/chunkKey.js';
import { ChunkManager } from '../../src/terrain/chunkManager.js';
import { updateOctree } from '../../src/terrain/octree.js';
import type { MeshSink } from '../../src/terrain/streaming.js';
import type { MeshWorkerPool, MeshResult } from '../../src/terrain/workerPool.js';

interface SubmitRequest {
  planetConfig: PlanetConfig;
  level: number;
  coord: { x: number; y: number; z: number };
}

function fakePool(submitted: string[]): MeshWorkerPool {
  return {
    workerCount: 2,
    submit(req: SubmitRequest): Promise<MeshResult> {
      submitted.push(`${req.planetConfig.id}:${req.level}:${req.coord.x}:${req.coord.y}:${req.coord.z}`);
      // Never resolves: everything that would run is visible in `submitted`.
      return new Promise<MeshResult>(() => undefined);
    },
    dispose(): void {},
  } as unknown as MeshWorkerPool;
}

function fakeSink(): MeshSink {
  return {
    emptyCount: 0,
    has: () => false,
    hasMesh: () => false,
    add: () => 'added',
    remove: () => false,
    markEmpty: () => undefined,
    forgetEmpty: () => false,
    pruneEmpty: () => undefined,
    meshCounts: () => ({ perLevel: [], total: 0 }),
    boxes: () => [],
  };
}

function makeManager(planets: PlanetConfig[], submitted: string[], maxInflight: number): ChunkManager {
  return new ChunkManager(fakePool(submitted), fakeSink(), planets, 1337, {
    updateIntervalMs: 0,
    maxInflight,
  });
}

const LEVEL = (key: string): number => parseChunkKey(key).level;

describe('far-planet LOD cap', () => {
  it('streams full LOD around the camera planet and only coarse Vorn beyond it', () => {
    const submitted: string[] = [];
    const manager = makeManager([SELA, VORN], submitted, 2000);
    manager.update({ x: 10, y: 402, z: 5 }, null, 1e6);
    const sela = submitted.filter((key) => key.startsWith('sela:'));
    const vorn = submitted.filter((key) => key.startsWith('vorn:'));
    expect(sela.some((key) => LEVEL(key) === 0)).toBe(true);
    expect(vorn.length).toBeGreaterThan(0);
    for (const key of vorn) {
      expect(LEVEL(key)).toBeGreaterThanOrEqual(VORN.lodMaxLevel - FAR_PLANET_LOD_DROP);
    }
  });

  it('caps even when a non-primary planet is close enough to refine deeper', () => {
    // Two overlapping worlds (streaming math only): the fake second planet
    // sits 600 m from Sela's center, so the un-capped octree would split it
    // down to L2 or finer around the camera.
    const close = { ...VORN, id: 'vorn_near', center: { x: 600, y: 0, z: 0 } };
    const camera: Vec3d = { x: 0, y: 0, z: 400 };
    const local = { x: camera.x - close.center.x, y: camera.y - close.center.y, z: camera.z - close.center.z };
    expect(updateOctree(close, local).some((node) => node.level < 3)).toBe(true);

    const submitted: string[] = [];
    const manager = makeManager([SELA, close], submitted, 4000);
    manager.update(camera, null, 1e6);
    const far = submitted.filter((key) => key.startsWith('vorn_near:'));
    expect(far.length).toBeGreaterThan(0);
    for (const key of far) expect(LEVEL(key)).toBeGreaterThanOrEqual(3);
  });

  it('never spends the first worker slot on the far planet', () => {
    const submitted: string[] = [];
    const manager = makeManager([SELA, VORN], submitted, 1);
    manager.update({ x: 10, y: 402, z: 5 }, null, 1e6);
    expect(submitted.length).toBe(1);
    expect(submitted[0]?.startsWith('sela:')).toBe(true);
    // The far root is queued behind the near work, not lost.
    expect(manager.pendingCount).toBeGreaterThan(1);
  });
});
