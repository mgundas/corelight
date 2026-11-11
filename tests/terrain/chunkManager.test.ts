// ChunkManager tests: desired-set diffing, priority submission, the
// no-hole parent/child swap rule, and empty-key caching. The worker pool
// and mesh sink are faked (manual promise control); density is real.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { distance, type Vec3d } from '../../src/core/math.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { nodeOrigin } from '../../src/terrain/octree.js';
import { createDensityField } from '../../src/terrain/density.js';
import { parseChunkKey } from '../../src/terrain/chunkKey.js';
import { ChunkManager } from '../../src/terrain/chunkManager.js';
import {
  boxInFrustum,
  toWorldPlanes,
} from '../../src/terrain/streaming.js';
import type { MeshSink } from '../../src/terrain/streaming.js';
import type { MeshResult } from '../../src/terrain/workerPool.js';
import { nodeKey, updateOctree, isDefinitelyAir, type OctreeNode } from '../../src/terrain/octree.js';

interface PendingJob {
  level: number;
  coord: { x: number; y: number; z: number };
  resolve: (result: MeshResult) => void;
}

interface PoolSubmitRequest {
  planetConfig: PlanetConfig;
  worldSeed: number;
  level: number;
  coord: OctreeNode['coord'];
}

interface PoolStub {
  readonly workerCount: number;
  submit(req: PoolSubmitRequest): Promise<MeshResult>;
  dispose(): void;
}

function fakePool(): { pool: PoolStub; pending: PendingJob[]; submitted: string[] } {
  const pending: PendingJob[] = [];
  const submitted: string[] = [];
  const pool: PoolStub = {
    workerCount: 2,
    submit(req: PoolSubmitRequest) {
      const key = nodeKey(req.planetConfig.id, req.level, req.coord);
      submitted.push(key);
      return new Promise<MeshResult>((resolve) => {
        pending.push({
          level: req.level,
          coord: { ...req.coord },
          resolve,
        });
      });
    },
    dispose(): void {},
  };
  return { pool, pending, submitted };
}

function meshResult(planet: PlanetConfig, level: number, coord: OctreeNode['coord'], empty: boolean): MeshResult {
  const origin = nodeOrigin(planet, level, coord);
  return {
    id: 0,
    key: nodeKey(planet.id, level, coord),
    origin: { ...origin },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    empty,
  };
}

class FakeSink implements MeshSink {
  readonly meshes = new Set<string>();
  readonly empty = new Set<string>();

  get emptyCount(): number {
    return this.empty.size;
  }

  has(key: string): boolean {
    return this.meshes.has(key) || this.empty.has(key);
  }

  hasMesh(key: string): boolean {
    return this.meshes.has(key);
  }

  add(_config: PlanetConfig, result: MeshResult): 'added' | 'empty' | 'duplicate' {
    if (this.has(result.key)) return 'duplicate';
    if (result.empty) {
      this.empty.add(result.key);
      return 'empty';
    }
    this.meshes.add(result.key);
    return 'added';
  }

  remove(key: string): boolean {
    return this.meshes.delete(key);
  }

  markEmpty(key: string): void {
    if (!this.meshes.has(key)) this.empty.add(key);
  }

  forgetEmpty(key: string): boolean {
    return this.empty.delete(key);
  }

  pruneEmpty(keep: (key: string) => boolean): void {
    for (const key of [...this.empty]) {
      if (!keep(key)) this.empty.delete(key);
    }
  }

  meshCounts(): { perLevel: number[]; total: number } {
    const perLevel: number[] = [];
    for (const key of this.meshes) {
      const { level } = parseChunkKey(key);
      perLevel[level] = (perLevel[level] ?? 0) + 1;
    }
    return { perLevel, total: this.meshes.size };
  }

  boxes(): Array<{ key: string; level: number; min: Vec3d; size: number }> {
    const out: Array<{ key: string; level: number; min: Vec3d; size: number }> = [];
    for (const key of this.meshes) {
      const { level, coord } = parseChunkKey(key);
      // SELA sits at the world origin in these tests.
      out.push({ key, level, min: nodeOrigin(SELA, level, coord), size: 32 * 2 ** level });
    }
    return out;
  }
}

function makeManager(
  pool: PoolStub,
  sink: FakeSink,
  maxInflight: number,
): ChunkManager {
  return new ChunkManager(
    pool as unknown as import('../../src/terrain/workerPool.js').MeshWorkerPool,
    sink,
    [SELA],
    1337,
    { updateIntervalMs: 0, maxInflight },
  );
}

/** Flush submissions until nothing is pending (all jobs resolve solid). */
async function settle(
  manager: ChunkManager,
  pool: { pending: PendingJob[] },
  camera: Vec3d,
): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    manager.update(camera, null, 100000);
    const jobs = pool.pending.splice(0);
    for (const job of jobs) job.resolve(meshResult(SELA, job.level, job.coord, false));
    await Promise.resolve();
    manager.update(camera, null, 100000);
    if (manager.pendingCount === 0 && pool.pending.length === 0) return;
  }
  throw new Error('settling did not converge');
}

describe('boxInFrustum', () => {
  it('accepts everything with no planes, rejects fully outside boxes', () => {
    expect(boxInFrustum({ x: 0, y: 0, z: 0 }, 8, null)).toBe(true);
    const front = [{ normal: { x: 0, y: 0, z: 1 }, constant: 0 }];
    expect(boxInFrustum({ x: 0, y: 0, z: 5 }, 4, front)).toBe(true);
    expect(boxInFrustum({ x: 0, y: 0, z: -9 }, 4, front)).toBe(false);
    // Straddling the plane counts as visible (positive vertex test).
    expect(boxInFrustum({ x: 0, y: 0, z: -2 }, 4, front)).toBe(true);
  });
});

describe('toWorldPlanes', () => {
  it('translates render-local planes by the floating origin', () => {
    // Local plane z >= 0 with the origin 100 m up means world z >= 100.
    const world = toWorldPlanes([{ normal: { x: 0, y: 0, z: 1 }, constant: 0 }], { x: 0, y: 0, z: 100 });
    expect(world.length).toBe(1);
    expect(world[0]?.constant).toBe(-100);
    expect(boxInFrustum({ x: 0, y: 0, z: 150 }, 8, world)).toBe(true);
    expect(boxInFrustum({ x: 0, y: 0, z: 50 }, 8, world)).toBe(false);
  });
});

describe('ChunkManager', () => {
  it('streams a single coarse root for a far camera', async () => {
    const { pool, pending } = fakePool();
    const sink = new FakeSink();
    const manager = makeManager(pool, sink, 4);
    const camera = { x: 0, y: 0, z: 3000 };
    manager.update(camera, null, 100000);
    expect(pending.length).toBe(1);
    expect(pending[0]?.level).toBe(SELA.lodMaxLevel);
    const jobs = pending.splice(0);
    for (const job of jobs) job.resolve(meshResult(SELA, job.level, job.coord, false));
    await Promise.resolve();
    manager.update(camera, null, 100000);
    expect(manager.pendingCount).toBe(0);
    expect(sink.has(nodeKey(SELA.id, SELA.lodMaxLevel, { x: 0, y: 0, z: 0 }))).toBe(true);
  });

  it('submits the nearest leaf first', () => {
    const { pool, pending } = fakePool();
    const sink = new FakeSink();
    const manager = makeManager(pool, sink, 1000);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    expect(pending.length).toBeGreaterThan(0);
    const first = pending[0] as PendingJob;
    const leaves = updateOctree(SELA, { x: 10, y: 402, z: 5 });
    const containing = leaves.find(
      (leaf) =>
        10 >= leaf.min.x &&
        10 < leaf.min.x + leaf.size &&
        402 >= leaf.min.y &&
        402 < leaf.min.y + leaf.size &&
        5 >= leaf.min.z &&
        5 < leaf.min.z + leaf.size,
    );
    expect(containing?.level).toBe(0);
    expect(first.level).toBe(0);
    expect(first.coord).toEqual(containing?.coord);
  });

  it('re-scores queued jobs when the camera moves', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const manager = makeManager(fakes.pool, sink, 1);
    // Start on the surface: the nearest leaf submits, the rest queue.
    const camA = { x: 10, y: 402, z: 5 };
    manager.update(camA, null, 100000);
    expect(fakes.pending.length).toBe(1);
    // Climb 300 m without resolving: the queue must re-prioritize around
    // the new camera even though nothing can submit yet (in flight is full).
    const camB = { x: 10, y: 700, z: 5 };
    manager.update(camB, null, 100000);
    expect(fakes.pending.length).toBe(1);
    const jobs = fakes.pending.splice(0);
    for (const job of jobs) job.resolve(meshResult(SELA, job.level, job.coord, false));
    await Promise.resolve();
    manager.update(camB, null, 100000);
    expect(fakes.submitted.length).toBe(2);
    const second = fakes.submitted[1] as string;
    // Expectation computed independently: nearest desired leaf to camB that
    // is neither loaded nor air-skipped. With stale scores the streamer
    // would instead resubmit a leftover surface chunk scored from camA.
    const field = createDensityField(SELA, 1337);
    const leavesB = updateOctree(SELA, camB);
    let expected = '';
    let best = Infinity;
    for (const leaf of leavesB) {
      const key = nodeKey(SELA.id, leaf.level, leaf.coord);
      if (sink.has(key)) continue;
      if (isDefinitelyAir(field.density, leaf)) continue;
      const d = distance(camB, {
        x: leaf.min.x + leaf.size / 2,
        y: leaf.min.y + leaf.size / 2,
        z: leaf.min.z + leaf.size / 2,
      });
      if (d < best) {
        best = d;
        expected = key;
      }
    }
    expect(expected).not.toBe('');
    expect(second).toBe(expected);
  });

  it('settles at the surface with detail around the camera and skips air', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const manager = makeManager(fakes.pool, sink, 1000);
    const camera = { x: 10, y: 402, z: 5 };
    await settle(manager, fakes, camera);
    expect(manager.pendingCount).toBe(0);
    // The leaf containing the camera is finest detail.
    const leaves = updateOctree(SELA, camera);
    const containing = leaves.find(
      (leaf) =>
        10 >= leaf.min.x &&
        10 < leaf.min.x + leaf.size &&
        402 >= leaf.min.y &&
        402 < leaf.min.y + leaf.size &&
        5 >= leaf.min.z &&
        5 < leaf.min.z + leaf.size,
    ) as OctreeNode;
    expect(sink.has(nodeKey(SELA.id, containing.level, containing.coord))).toBe(true);
    expect(containing.level).toBe(0);
    // Air-skipped keys are cached empty without ever hitting the pool.
    expect(sink.empty.size).toBeGreaterThan(0);
    for (const key of sink.empty) {
      expect(fakes.submitted.includes(key)).toBe(false);
    }
    const stats = manager.stats();
    expect(stats.pending).toBe(0);
    expect(stats.empty).toBe(sink.empty.size);
    expect(stats.desired).toBe(leaves.length);
  });

  it('keeps the parent visible until all split children arrive (no holes)', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const manager = makeManager(fakes.pool, sink, 1000);
    const surface = { x: 10, y: 402, z: 5 };
    await settle(manager, fakes, surface);
    const l0Keys = [...sink.meshes].filter((key) => parseChunkKey(key).level === 0);
    expect(l0Keys.length).toBeGreaterThan(0);

    // Teleport far away: the coarse root is desired but not loaded, so the
    // old fine meshes must stay put (no holes during the transition).
    const far = { x: 0, y: 0, z: 3000 };
    manager.update(far, null, 100000);
    const rootKey = nodeKey(SELA.id, SELA.lodMaxLevel, { x: 0, y: 0, z: 0 });
    expect(fakes.pending.some((job) => nodeKey(SELA.id, job.level, job.coord) === rootKey)).toBe(true);
    for (const key of l0Keys) expect(sink.has(key)).toBe(true);

    // Once the root mesh lands, the fine meshes it covers go away.
    const jobs = fakes.pending.splice(0);
    for (const job of jobs) job.resolve(meshResult(SELA, job.level, job.coord, false));
    await Promise.resolve();
    manager.update(far, null, 100000);
    manager.update(far, null, 100000);
    expect(sink.has(rootKey)).toBe(true);
    for (const key of l0Keys) expect(sink.has(key)).toBe(false);
  });

  it('keeps children visible until the merge parent arrives', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const manager = makeManager(fakes.pool, sink, 1000);
    const far = { x: 0, y: 0, z: 3000 };
    await settle(manager, fakes, far);
    const rootKey = nodeKey(SELA.id, SELA.lodMaxLevel, { x: 0, y: 0, z: 0 });
    expect(sink.has(rootKey)).toBe(true);

    // Fly to the surface with a choked pool: only one job in flight, so
    // the root must stay while its children stream in.
    const fakes2 = fakePool();
    const sink2 = new FakeSink();
    sink2.meshes.add(rootKey);
    const manager2 = makeManager(fakes2.pool, sink2, 1);
    const surface = { x: 10, y: 402, z: 5 };
    manager2.update(surface, null, 100000);
    expect(fakes2.pending.length).toBe(1);
    expect(sink2.has(rootKey)).toBe(true);
    // Resolve jobs one at a time; the root survives until full coverage.
    for (let i = 0; i < 400 && fakes2.pending.length + manager2.pendingCount > 0; i += 1) {
      const jobs = fakes2.pending.splice(0);
      for (const job of jobs) job.resolve(meshResult(SELA, job.level, job.coord, false));
      await Promise.resolve();
      manager2.update(surface, null, 100000);
      if (manager2.pendingCount === 0 && fakes2.pending.length === 0) break;
    }
    expect(manager2.pendingCount).toBe(0);
    expect(sink2.has(rootKey)).toBe(false);
  });
});
