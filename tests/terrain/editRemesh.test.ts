// Edit-remesh tests: notifyEdited submits priority jobs with fresh deltas
// (bypassing the streaming throttle), stale completions refresh instead of
// flashing old meshes, and streaming submits also carry edit data. The pool
// and sink are faked with manual promise control.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import type { Vec3d } from '../../src/core/math.js';
import { nodeKey, nodeOrigin, type OctreeNode } from '../../src/terrain/octree.js';
import { parseChunkKey } from '../../src/terrain/chunkKey.js';
import { ChunkManager } from '../../src/terrain/chunkManager.js';
import { EditRemesher, type EditCompletion } from '../../src/terrain/editRemesh.js';
import type { MeshSink } from '../../src/terrain/streaming.js';
import type { EditAttachment } from '../../src/terrain/edits.js';
import type { MeshResult, MeshWorkerPool } from '../../src/terrain/workerPool.js';

interface PendingJob {
  level: number;
  coord: OctreeNode['coord'];
  edits?: { indices: Uint32Array; values: Float32Array };
  editVersion?: number;
  resolve: (result: MeshResult) => void;
}

function fakePool(): { pool: MeshWorkerPool; pending: PendingJob[]; submitted: string[] } {
  const pending: PendingJob[] = [];
  const submitted: string[] = [];
  const pool = {
    workerCount: 2,
    submit(req: {
      planetConfig: PlanetConfig;
      worldSeed: number;
      level: number;
      coord: OctreeNode['coord'];
      edits?: { indices: Uint32Array; values: Float32Array };
      editVersion?: number;
    }) {
      const key = nodeKey(req.planetConfig.id, req.level, req.coord);
      submitted.push(key);
      return new Promise<MeshResult>((resolve) => {
        pending.push({
          level: req.level,
          coord: { ...req.coord },
          edits: req.edits,
          editVersion: req.editVersion,
          resolve,
        });
      });
    },
    dispose(): void {},
  };
  return { pool: pool as unknown as MeshWorkerPool, pending, submitted };
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
    return { perLevel: [], total: this.meshes.size };
  }

  boxes(): Array<{ key: string; level: number; min: Vec3d; size: number }> {
    return [];
  }
}

const ATTACHMENT: EditAttachment = {
  indices: new Uint32Array([100]),
  values: new Float32Array([0.5]),
};

function makeManager(
  pool: MeshWorkerPool,
  sink: FakeSink,
): { manager: ChunkManager; pending: PendingJob[]; submitted: string[] } {
  // updateIntervalMs 0: every update recomputes (no throttle in tests).
  // minEditSubmitIntervalMs 0: no rate control (covered separately below).
  const manager = new ChunkManager(pool, sink, [SELA], 1337, {
    updateIntervalMs: 0,
    maxInflight: 1000,
    minEditSubmitIntervalMs: 0,
  });
  manager.setEditSource(() => ATTACHMENT);
  return { manager, pending: [], submitted: [] };
}

describe('ChunkManager.notifyEdited', () => {
  it('submits a priority job with fresh deltas and swaps on completion', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const { manager } = makeManager(fakes.pool, sink);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    // Settle streaming for one LOD0 key: resolve everything, drain.
    for (const job of fakes.pending.splice(0)) {
      job.resolve(meshResult(SELA, job.level, job.coord, false));
    }
    await Promise.resolve();
    manager.update(camera, null, 100000);
    const key = fakes.submitted.find((k) => parseChunkKey(k).level === 0);
    if (!key) throw new Error('no LOD0 job submitted');
    expect(sink.has(key)).toBe(true);
    const before = fakes.submitted.length;

    // Edit: submits immediately (no throttle wait), carrying deltas.
    // Only the visible LOD0 chunk rebuilds: its LOD1 parent has no mesh
    // (it is not desired while the children cover it), so building it
    // would flash a coarse mesh over the fine one until GC removes it.
    // Edits persist in the store and re-attach if the parent ever meshes.
    manager.notifyEdited([key]);
    expect(fakes.submitted.length).toBe(before + 1);
    expect(fakes.submitted.slice(before).every((k) => parseChunkKey(k).level === 0)).toBe(true);
    const editJob = fakes.pending.find((job) => job.level === 0) as PendingJob;
    expect(editJob.edits).toBe(ATTACHMENT);
    expect(editJob.editVersion).toBe(1);
    // Old mesh stays until the fresh result is applied.
    expect(sink.has(key)).toBe(true);
    editJob.resolve(meshResult(SELA, 0, editJob.coord, false));
    await Promise.resolve();
    manager.update(camera, null, 100000);
    expect(sink.has(key)).toBe(true);
  });

  it('drops stale completions and refreshes with the recompute fallback', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const { manager } = makeManager(fakes.pool, sink);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    for (const job of fakes.pending.splice(0)) {
      job.resolve(meshResult(SELA, job.level, job.coord, false));
    }
    await Promise.resolve();
    manager.update(camera, null, 100000);
    const key = fakes.submitted.find((k) => parseChunkKey(k).level === 0);
    if (!key) throw new Error('no LOD0 job submitted');
    fakes.submitted.length = 0;

    // Two edits with a job in flight: the second notify skips the submit.
    // (One job: the visible LOD0 chunk. The meshless LOD1 parent is skipped.)
    manager.notifyEdited([key]);
    expect(fakes.pending.length).toBe(1);
    manager.notifyEdited([key]);
    expect(fakes.pending.length).toBe(1);
    // The in-flight LOD0 job (v1) completes stale against v2: dropped,
    // no flash. (Leave the LOD1 job held; the fallback only resubmits
    // keys with nothing outstanding.)
    const staleIdx = fakes.pending.findIndex((job) => job.level === 0);
    const stale = fakes.pending.splice(staleIdx, 1)[0] as PendingJob;
    stale.resolve(meshResult(SELA, 0, stale.coord, false));
    await Promise.resolve();
    manager.update(camera, null, 100000);
    // Fallback resubmits with the current version; resolving applies it.
    const fresh = fakes.pending.find((job) => job.level === 0) as PendingJob;
    expect(fresh.editVersion).toBe(2);
    fresh.resolve(meshResult(SELA, 0, fresh.coord, false));
    await Promise.resolve();
    manager.update(camera, null, 100000);
    expect(sink.has(key)).toBe(true);
    expect(manager.pendingCount).toBe(0);
  });

  it('remeshes chunks the streamer had marked empty', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const { manager } = makeManager(fakes.pool, sink);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    // Everything resolves empty (all air above the surface).
    for (const job of fakes.pending.splice(0)) {
      job.resolve(meshResult(SELA, job.level, job.coord, true));
    }
    await Promise.resolve();
    manager.update(camera, null, 100000);
    // Player adds soil to an empty (air) chunk: it must remesh, not stay skipped.
    const key = fakes.submitted.find((k) => parseChunkKey(k).level === 0);
    if (!key) throw new Error('no LOD0 job submitted');
    expect(sink.has(key)).toBe(true);
    manager.notifyEdited([key]);
    // Only the empty-marked LOD0 owner rebuilds (its forgotten mark counts
    // as visible intent); the meshless LOD1 parent is skipped.
    expect(fakes.pending.length).toBe(1);
    expect(fakes.pending[0]?.level).toBe(0);
    const jobs = fakes.pending.splice(0);
    const l0 = jobs.find((job) => job.level === 0);
    if (!l0) throw new Error('no LOD0 edit job');
    l0.resolve(meshResult(SELA, 0, l0.coord, false));
    await Promise.resolve();
    manager.update(camera, null, 100000);
    expect(sink.has(key)).toBe(true);
  });

  it('remeshes the LOD1 parent so coarse views include edits', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const { manager } = makeManager(fakes.pool, sink);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    for (const job of fakes.pending.splice(0)) {
      job.resolve(meshResult(SELA, job.level, job.coord, false));
    }
    await Promise.resolve();
    manager.update(camera, null, 100000);
    const key = fakes.submitted.find((k) => parseChunkKey(k).level === 0);
    if (!key) throw new Error('no LOD0 job submitted');
    fakes.submitted.length = 0;
    // Simulate a visible parent (no-hole transition or distant view): with
    // a mesh in the sink, an edit refreshes it instead of skipping it.
    const parsed = parseChunkKey(key);
    const parentCoord = {
      x: Math.floor(parsed.coord.x / 2),
      y: Math.floor(parsed.coord.y / 2),
      z: Math.floor(parsed.coord.z / 2),
    };
    sink.add(SELA, meshResult(SELA, 1, parentCoord, false));
    manager.notifyEdited([key]);
    // The LOD0 chunk plus its visible LOD1 parent both rebuild.
    const levels = fakes.pending.map((job) => job.level).sort();
    expect(levels).toContain(0);
    expect(levels).toContain(1);
    const parent = fakes.pending.find((job) => job.level === 1);
    if (!parent) throw new Error('no LOD1 parent job submitted');
    expect(parent.coord).toEqual(parentCoord);
  });

  it('never materializes an edit rebuild for a chunk that left the visible set', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const { manager } = makeManager(fakes.pool, sink);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    for (const job of fakes.pending.splice(0)) {
      job.resolve(meshResult(SELA, job.level, job.coord, false));
    }
    await Promise.resolve();
    manager.update(camera, null, 100000);
    const key = fakes.submitted.find((k) => parseChunkKey(k).level === 0);
    if (!key) throw new Error('no LOD0 job submitted');
    manager.notifyEdited([key]);
    const editJob = fakes.pending.find((job) => job.level === 0);
    if (!editJob) throw new Error('no LOD0 edit job');
    // Fly far away before the rebuild lands and drop the stale mesh (as
    // the garbage collector would): the key is no longer desired.
    const far = { x: 600, y: 900, z: 600 };
    manager.update(far, null, 100000);
    sink.remove(key);
    editJob.resolve(meshResult(SELA, 0, editJob.coord, false));
    await Promise.resolve();
    manager.update(far, null, 100000);
    // The stale rebuild is dropped instead of flashing a mesh over a
    // region the camera already left; the edits persist in the store and
    // re-attach with fresh deltas if the chunk streams back.
    expect(sink.hasMesh(key)).toBe(false);
    expect(sink.has(key)).toBe(false);
  });

  it('prunes edit versions once the rebuild is applied', async () => {
    const fakes = fakePool();
    const sink = new FakeSink();
    const { manager } = makeManager(fakes.pool, sink);
    const camera = { x: 10, y: 402, z: 5 };
    manager.update(camera, null, 100000);
    for (const job of fakes.pending.splice(0)) {
      job.resolve(meshResult(SELA, job.level, job.coord, false));
    }
    await Promise.resolve();
    manager.update(camera, null, 100000);
    const key = fakes.submitted.find((k) => parseChunkKey(k).level === 0);
    if (!key) throw new Error('no LOD0 job submitted');
    // Edit, apply, then force a plain streaming rebuild: with the version
    // pruned it submits as an ordinary (version-0) job again.
    manager.notifyEdited([key]);
    const editJob = fakes.pending.find((job) => job.level === 0);
    if (!editJob) throw new Error('no LOD0 edit job');
    expect(editJob.editVersion).toBe(1);
    fakes.pending.splice(0).forEach((job) => {
      if (job.level === 0) job.resolve(meshResult(SELA, 0, job.coord, false));
    });
    await Promise.resolve();
    manager.update(camera, null, 100000);
    expect(sink.has(key)).toBe(true);
    sink.remove(key);
    manager.update(camera, null, 100000);
    const resubmits = fakes.pending.filter(
      (job) => job.level === 0 && nodeKey(SELA.id, 0, job.coord) === key,
    );
    expect(resubmits.length).toBeGreaterThan(0);
    for (const job of resubmits) expect(job.editVersion).toBe(0);
  });
});

describe('EditRemesher rate control', () => {
  it('submits at most one job per key per interval, with latest deltas', async () => {
    let now = 1000;
    const submitted: Array<{ key: string; version: number }> = [];
    const completions: EditCompletion[] = [];
    const pool = {
      submit(req: { planetConfig: PlanetConfig; level: number; coord: OctreeNode['coord']; editVersion?: number }) {
        submitted.push({ key: nodeKey(req.planetConfig.id, req.level, req.coord), version: req.editVersion ?? -1 });
        return Promise.resolve({} as MeshResult);
      },
      dispose(): void {},
    };
    const remesher = new EditRemesher(pool as unknown as MeshWorkerPool, [SELA], 1337, {
      minSubmitIntervalMs: 250,
      now: () => now,
    });
    remesher.setEditSource(() => ATTACHMENT);
    const hooks = {
      forgetEmpty: (): boolean => false,
      hasMesh: (): boolean => true,
      unqueue: (): void => {},
      isStreamingInflight: (): boolean => false,
      pushCompletion: (item: EditCompletion): void => {
        completions.push(item);
      },
    };
    const key = 'sela:0:16:16:16';
    remesher.notifyEdited([key], hooks);
    // LOD0 chunk plus its LOD1 parent (first stroke always goes through).
    expect(submitted.length).toBe(2);
    expect(submitted.find((s) => s.key === key)?.version).toBe(1);
    // 100 ms later: throttled (version still bumps for staleness tracking).
    now += 100;
    remesher.notifyEdited([key], hooks);
    expect(submitted.length).toBe(2);
    expect(remesher.currentVersion(key)).toBe(2);
    // Interval elapsed: the retry picks both up with the current versions.
    now += 200;
    await Promise.resolve();
    await Promise.resolve();
    remesher.retryDirty(
      new Set([key, 'sela:1:8:8:8']),
      () => false,
      (k) => remesher.submitEditJob(k, hooks.pushCompletion),
    );
    expect(submitted.length).toBe(4);
    expect(submitted.filter((s) => s.key === key).map((s) => s.version)).toEqual([1, 2]);
    await Promise.resolve();
    expect(completions.length).toBe(4);
    const l0 = completions.filter((c) => c.key === key);
    expect(l0[1]?.submitVersion).toBe(2);
    expect(l0[1]?.isEdit).toBe(true);
  });

  it('skips invisible chunks without empty marks, but still tracks versions', () => {
    const submitted: string[] = [];
    const pool = {
      submit(req: { planetConfig: PlanetConfig; level: number; coord: OctreeNode['coord'] }) {
        submitted.push(nodeKey(req.planetConfig.id, req.level, req.coord));
        return Promise.resolve({} as MeshResult);
      },
      dispose(): void {},
    };
    const remesher = new EditRemesher(pool as unknown as MeshWorkerPool, [SELA], 1337, {
      minSubmitIntervalMs: 0,
    });
    remesher.setEditSource(() => ATTACHMENT);
    const visible = new Set<string>(['sela:0:16:16:16']);
    const hooks = {
      forgetEmpty: (): boolean => false,
      hasMesh: (key: string): boolean => visible.has(key),
      unqueue: (): void => {},
      isStreamingInflight: (): boolean => false,
      pushCompletion: (): void => {},
    };
    remesher.notifyEdited(['sela:0:16:16:16'], hooks);
    // The visible owner rebuilds; the meshless LOD1 parent does not (it
    // would flash over the fine children until garbage-collected).
    expect(submitted).toEqual(['sela:0:16:16:16']);
    // ...but the parent version still bumped, so a late completion reads
    // stale instead of showing.
    expect(remesher.currentVersion('sela:1:8:8:8')).toBe(1);
    expect(remesher.isDirty('sela:1:8:8:8')).toBe(true);
    // The retry fallback still covers it while desired.
    remesher.retryDirty(
      new Set(['sela:1:8:8:8']),
      () => false,
      (k) => remesher.submitEditJob(k, () => {}),
    );
    expect(submitted).toEqual(['sela:0:16:16:16', 'sela:1:8:8:8']);
  });
});
