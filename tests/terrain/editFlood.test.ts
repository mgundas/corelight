// Regression test for the edit-submit flood: 300 continuous strokes
// (30 s at 10 strokes/s) with simulated 300 ms worker latency must NOT
// amplify into tens of thousands of mesh jobs. Before the coalescing fix,
// 300 strokes submitted 21,652 jobs with a superlinear profile —
// saturating the shared worker pool (streaming starves, meshes swap
// constantly, applied edits lag seconds behind the brush).
//
// Uses production-shaped settings: capped streaming inflight, per-key
// submit throttle disabled here (covered with a manual clock in
// editRemesh.test.ts) so this test pins the stale-completion coalescing.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import type { Vec3d } from '../../src/core/math.js';
import { nodeKey, nodeOrigin, type OctreeNode } from '../../src/terrain/octree.js';
import { parseChunkKey } from '../../src/terrain/chunkKey.js';
import { createDensityField } from '../../src/terrain/density.js';
import { ChunkManager } from '../../src/terrain/chunkManager.js';
import type { MeshSink } from '../../src/terrain/streaming.js';
import { TerrainEdits } from '../../src/terrain/edits.js';
import type { MeshResult, MeshWorkerPool } from '../../src/terrain/workerPool.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';

interface PendingJob {
  level: number;
  coord: OctreeNode['coord'];
  age: number;
  resolve: (result: MeshResult) => void;
}

function meshResult(planet: PlanetConfig, level: number, coord: OctreeNode['coord']): MeshResult {
  const origin = nodeOrigin(planet, level, coord);
  return {
    id: 0,
    key: nodeKey(planet.id, level, coord),
    origin: { ...origin },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    empty: false,
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

describe('edit submit flood', () => {
  it('stays linear and bounded under 30 s of continuous digging', async () => {
    const pending: PendingJob[] = [];
    let submitted = 0;
    const pool = {
      workerCount: 4,
      submit(req: { planetConfig: PlanetConfig; level: number; coord: OctreeNode['coord'] }) {
        submitted += 1;
        return new Promise<MeshResult>((resolve) => {
          pending.push({ level: req.level, coord: { ...req.coord }, age: 0, resolve });
        });
      },
      dispose(): void {},
    };
    const sink = new FakeSink();
    const manager = new ChunkManager(pool as unknown as MeshWorkerPool, sink, [SELA], 1337, {
      updateIntervalMs: 0,
      minEditSubmitIntervalMs: 0,
    });
    const edits = new TerrainEdits();
    manager.setEditSource((key) => {
      try {
        const parsed = parseChunkKey(key);
        return edits.deltasForJob(SELA, parsed.level, parsed.coord);
      } catch {
        return null;
      }
    });

    const field = createDensityField(SELA, 1337);
    const spawn = findSpawnPosition(SELA, 1337);
    const up = upAt(SELA, spawn);
    const center = {
      x: spawn.x - up.x * 1,
      y: spawn.y - up.y * 1,
      z: spawn.z - up.z * 1,
    };
    const camera = { x: spawn.x, y: spawn.y + 4, z: spawn.z + 4 };
    const flush = async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };
    const strokes = 300;
    const buckets: number[] = [];
    let lastTotal = 0;
    for (let s = 0; s < strokes; s += 1) {
      const outcome = edits.applySphere(SELA, field.density, center, 2, 0.3, 'dig', {
        maxHardness: 2,
        hardnessAt: () => 1,
      });
      if (outcome.keys.length > 0) manager.notifyEdited(outcome.keys);
      manager.update(camera, null, 100000);
      for (const job of pending) job.age += 1;
      const ready = pending.filter((job) => job.age >= 3);
      for (const job of ready) {
        pending.splice(pending.indexOf(job), 1);
        job.resolve(meshResult(SELA, job.level, job.coord));
      }
      await flush();
      manager.update(camera, null, 100000);
      await flush();
      if ((s + 1) % 50 === 0) {
        buckets.push(submitted - lastTotal);
        lastTotal = submitted;
      }
    }
    // Bounded: a handful of jobs per stroke (edited chunks + parents +
    // initial streaming settle), not dozens. The flood hit 21,652.
    expect(submitted).toBeLessThan(strokes * 12);
    // Linear: no acceleration as completions pile up. The flood's second
    // half submitted 6.5x the first half.
    const firstHalf = (buckets[0] as number) + (buckets[1] as number) + (buckets[2] as number);
    const secondHalf = (buckets[3] as number) + (buckets[4] as number) + (buckets[5] as number);
    expect(secondHalf).toBeLessThanOrEqual(firstHalf * 1.5);
    // The dig actually applied at full rate (center clamped to -4).
    expect(edits.deltaAt(SELA, SELA.id, center.x, center.y, center.z)).toBeLessThanOrEqual(-3.9);
  });
});
