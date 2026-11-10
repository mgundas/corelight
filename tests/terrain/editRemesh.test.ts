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
import {
  ChunkManager,
  type MeshSink,
} from '../../src/terrain/chunkManager.js';
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

  forgetEmpty(key: string): void {
    this.empty.delete(key);
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
  const manager = new ChunkManager(pool, sink, [SELA], 1337, {
    updateIntervalMs: 0,
    maxInflight: 1000,
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
    // Both the LOD0 chunk and its LOD1 parent rebuild.
    manager.notifyEdited([key]);
    expect(fakes.submitted.length).toBe(before + 2);
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

    // Two edits with jobs in flight: the second notify skips the submit.
    // (One job per level: LOD0 chunk + LOD1 parent.)
    manager.notifyEdited([key]);
    expect(fakes.pending.length).toBe(2);
    manager.notifyEdited([key]);
    expect(fakes.pending.length).toBe(2);
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
    expect(fakes.pending.length).toBe(2);
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
    manager.notifyEdited([key]);
    // The LOD0 chunk plus its LOD1 parent both rebuild.
    const levels = fakes.pending.map((job) => job.level).sort();
    expect(levels).toContain(0);
    expect(levels).toContain(1);
    const parent = fakes.pending.find((job) => job.level === 1);
    if (!parent) throw new Error('no LOD1 parent job submitted');
    const parsed = parseChunkKey(key);
    expect(parent.coord).toEqual({
      x: Math.floor(parsed.coord.x / 2),
      y: Math.floor(parsed.coord.y / 2),
      z: Math.floor(parsed.coord.z / 2),
    });
  });
});
