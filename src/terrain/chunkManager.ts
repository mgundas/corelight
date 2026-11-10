// Streaming chunk manager: diffs the desired octree leaf set against what
// is on screen, priority-queues mesh jobs, and swaps meshes with no holes.
// Pure main-thread logic + worker pool I/O; render access goes through the
// MeshSink interface so this file (like all of terrain/) never imports
// three.js. Meshes upload on the main thread within a 4 ms frame budget.

import {
  STREAM_APPLY_BUDGET_MS,
  STREAM_FRUSTUM_BONUS,
  STREAM_MAX_INFLIGHT_FACTOR,
  STREAM_UPDATE_INTERVAL_MS,
} from '../core/constants.js';
import { distance, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from './density.js';
import {
  boxesOverlap,
  isDefinitelyAir,
  nodeKey,
  updateOctree,
  type OctreeNode,
} from './octree.js';
import type { MeshResult, MeshWorkerPool } from './workerPool.js';

/** Render-side mesh store (structurally satisfied by ChunkMeshes). */
export interface MeshSink {
  has(key: string): boolean;
  add(config: PlanetConfig, result: MeshResult): 'added' | 'empty' | 'duplicate';
  /** Forget a mesh and dispose its geometry. */
  remove(key: string): boolean;
  /** Remember a key the worker (or boot) reported empty: never re-queue. */
  markEmpty(key: string): void;
  /** Keys known empty (worker-reported + pre-skipped). */
  readonly emptyCount: number;
  boxes(): Array<{ key: string; level: number; min: Vec3d; size: number }>;
}

/** A frustum plane in world space: inside when normal.p + constant >= 0. */
export interface FrustumPlane {
  normal: Vec3d;
  constant: number;
}

export function boxInFrustum(min: Vec3d, size: number, planes: FrustumPlane[] | null): boolean {
  if (!planes) return true;
  for (const plane of planes) {
    const px = plane.normal.x >= 0 ? min.x + size : min.x;
    const py = plane.normal.y >= 0 ? min.y + size : min.y;
    const pz = plane.normal.z >= 0 ? min.z + size : min.z;
    if (px * plane.normal.x + py * plane.normal.y + pz * plane.normal.z + plane.constant < 0) {
      return false;
    }
  }
  return true;
}

interface DesiredNode {
  planet: PlanetConfig;
  node: OctreeNode;
  key: string;
}

interface PlanetState {
  config: PlanetConfig;
  field: DensityField;
}

export interface StreamStats {
  /** Visible mesh count per LOD level (index = level). */
  perLevel: number[];
  /** Jobs waiting + in flight. */
  pending: number;
  /** Meshes currently in the sink. */
  cacheSize: number;
  /** Keys known empty (air-skipped + worker-reported). */
  empty: number;
  /** Desired leaves this tick. */
  desired: number;
}

const FAILURE_COOLDOWN_MS = 5000;

export class ChunkManager {
  private readonly pool: MeshWorkerPool;
  private readonly sink: MeshSink;
  private readonly planets: PlanetState[];
  private readonly worldSeed: number;
  private readonly updateIntervalMs: number;
  private readonly maxInflight: number;
  private readonly queued = new Map<string, DesiredNode & { score: number }>();
  private readonly inflight = new Map<string, DesiredNode>();
  private completed: Array<DesiredNode & { result: MeshResult }> = [];
  private readonly failures = new Map<string, number>();
  private desiredKeys = new Set<string>();
  private desiredCount = 0;
  private lastTick = -Infinity;

  constructor(
    pool: MeshWorkerPool,
    sink: MeshSink,
    planets: PlanetConfig[],
    worldSeed: number,
    opts?: { updateIntervalMs?: number; maxInflight?: number },
  ) {
    this.pool = pool;
    this.sink = sink;
    this.planets = planets.map((config) => ({ config, field: createDensityField(config, worldSeed) }));
    this.worldSeed = worldSeed;
    this.updateIntervalMs = opts?.updateIntervalMs ?? STREAM_UPDATE_INTERVAL_MS;
    this.maxInflight = opts?.maxInflight ?? pool.workerCount * STREAM_MAX_INFLIGHT_FACTOR;
  }

  get pendingCount(): number {
    return this.queued.size + this.inflight.size;
  }

  /** Adopt boot pre-generation results (meshes + empty keys) before streaming. */
  adopt(config: PlanetConfig, results: MeshResult[], emptyKeys: string[]): void {
    for (const result of results) this.sink.add(config, result);
    for (const key of emptyKeys) this.sink.markEmpty(key);
  }

  /**
   * Recompute the desired set (throttled), submit priority jobs, remove
   * superseded meshes, and apply finished results within the frame budget.
   * Finished results drain first so the diff sees the freshest scene state
   * (and never re-queues a job that already completed).
   */
  update(cameraWorld: Vec3d, frustum: FrustumPlane[] | null, budgetMs = STREAM_APPLY_BUDGET_MS): void {
    this.drainCompleted(cameraWorld, budgetMs);
    const now = performance.now();
    if (now - this.lastTick >= this.updateIntervalMs) {
      this.lastTick = now;
      this.recompute(cameraWorld, frustum, now);
    }
  }

  stats(): StreamStats {
    const perLevel: number[] = [];
    let cacheSize = 0;
    for (const box of this.sink.boxes()) {
      perLevel[box.level] = (perLevel[box.level] ?? 0) + 1;
      cacheSize += 1;
    }
    return {
      perLevel,
      pending: this.pendingCount,
      cacheSize,
      empty: this.sink.emptyCount,
      desired: this.desiredCount,
    };
  }

  private recompute(cameraWorld: Vec3d, frustum: FrustumPlane[] | null, now: number): void {
    const desired: DesiredNode[] = [];
    for (const { config, field } of this.planets) {
      const local: Vec3d = {
        x: cameraWorld.x - config.center.x,
        y: cameraWorld.y - config.center.y,
        z: cameraWorld.z - config.center.z,
      };
      for (const node of updateOctree(config, local)) {
        const key = nodeKey(config.id, node.level, node.coord);
        desired.push({ planet: config, node, key });
        if (this.sink.has(key) || this.inflight.has(key) || this.queued.has(key)) continue;
        // Only 'air' skips are sound (tunnel-wall cliffs break the 'solid'
        // branch; see octree.classifyNode). Everything else queues and the
        // worker's full-grid sampling decides exactly.
        if (isDefinitelyAir(field.density, node)) {
          this.sink.markEmpty(key);
          continue;
        }
        const failedAt = this.failures.get(key);
        if (failedAt !== undefined && now - failedAt < FAILURE_COOLDOWN_MS) continue;
        const worldMin: Vec3d = {
          x: config.center.x + node.min.x,
          y: config.center.y + node.min.y,
          z: config.center.z + node.min.z,
        };
        const center: Vec3d = {
          x: worldMin.x + node.size / 2,
          y: worldMin.y + node.size / 2,
          z: worldMin.z + node.size / 2,
        };
        const bonus = boxInFrustum(worldMin, node.size, frustum) ? STREAM_FRUSTUM_BONUS : 0;
        this.queued.set(key, { planet: config, node, key, score: distance(cameraWorld, center) - bonus });
      }
    }
    this.desiredCount = desired.length;
    const wanted = new Set(desired.map((d) => d.key));
    this.desiredKeys = wanted;
    for (const key of this.queued.keys()) {
      if (!wanted.has(key)) this.queued.delete(key);
    }
    const sorted = [...this.queued.values()].sort((a, b) => a.score - b.score);
    while (this.inflight.size < this.maxInflight && sorted.length > 0) {
      const job = sorted.shift() as DesiredNode & { score: number };
      this.queued.delete(job.key);
      this.inflight.set(job.key, job);
      const attempt: DesiredNode = { planet: job.planet, node: job.node, key: job.key };
      void this.pool
        .submit({
          planetConfig: job.planet,
          worldSeed: this.worldSeed,
          level: job.node.level,
          coord: { ...job.node.coord },
        })
        .then(
          (result) => {
            this.inflight.delete(job.key);
            this.completed.push({ ...attempt, result });
          },
          () => {
            this.inflight.delete(job.key);
            this.failures.set(job.key, performance.now());
          },
        );
    }
    this.collectGarbage(desired);
  }

  /**
   * No-hole swap: a visible mesh that is no longer desired stays until
   * every desired node overlapping its volume is actually in the scene
   * (split children ready, merge parent ready, or lateral neighbor ready).
   * Completed-but-unapplied results count as not loaded, so parents also
   * survive the drain budget boundary.
   */
  private collectGarbage(desired: DesiredNode[]): void {
    const loaded = (key: string): boolean => this.sink.has(key);
    const desiredBoxes = desired.map((d) => ({
      key: d.key,
      min: {
        x: d.planet.center.x + d.node.min.x,
        y: d.planet.center.y + d.node.min.y,
        z: d.planet.center.z + d.node.min.z,
      },
      size: d.node.size,
    }));
    for (const box of this.sink.boxes()) {
      if (this.desiredKeys.has(box.key)) continue;
      let covered = true;
      for (const other of desiredBoxes) {
        if (boxesOverlap(box.min, box.size, other.min, other.size) && !loaded(other.key)) {
          covered = false;
          break;
        }
      }
      if (covered) this.sink.remove(box.key);
    }
  }

  private drainCompleted(cameraWorld: Vec3d, budgetMs: number): void {
    if (this.completed.length === 0) return;
    const centerOf = (item: DesiredNode): Vec3d => ({
      x: item.planet.center.x + item.node.min.x + item.node.size / 2,
      y: item.planet.center.y + item.node.min.y + item.node.size / 2,
      z: item.planet.center.z + item.node.min.z + item.node.size / 2,
    });
    // Nearest first: detail pops in where the camera is.
    this.completed.sort((a, b) => distance(cameraWorld, centerOf(a)) - distance(cameraWorld, centerOf(b)));
    const start = performance.now();
    while (this.completed.length > 0 && performance.now() - start < budgetMs) {
      const item = this.completed.shift() as DesiredNode & { result: MeshResult };
      if (item.result.empty) {
        this.sink.markEmpty(item.key);
      } else {
        this.sink.add(item.planet, item.result);
      }
    }
  }
}
