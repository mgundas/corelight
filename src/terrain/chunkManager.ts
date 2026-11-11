// Streaming chunk manager: diffs the desired octree leaf set against what
// is on screen, priority-queues mesh jobs, and swaps meshes with no holes.
// Pure main-thread logic + worker pool I/O; render access goes through the
// MeshSink interface so this file (like all of terrain/) never imports
// three.js. Meshes upload on the main thread within a 4 ms frame budget.

import {
  EMPTY_KEY_BUDGET,
  STREAM_APPLY_BUDGET_MS,
  STREAM_FRUSTUM_BONUS,
  STREAM_MAX_INFLIGHT_FACTOR,
  STREAM_UPDATE_INTERVAL_MS,
} from '../core/constants.js';
import { distance, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { parseChunkKey } from './chunkKey.js';
import { createDensityField, type DensityField } from './density.js';
import type { EditAttachment } from './edits.js';
import { EditRemesher } from './editRemesh.js';
import {
  boxesOverlap,
  isDefinitelyAir,
  nodeKey,
  updateOctree,
  type OctreeNode,
} from './octree.js';
import { boxInFrustum, type FrustumPlane, type MeshSink, type StreamStats } from './streaming.js';
import type { MeshResult, MeshWorkerPool } from './workerPool.js';

interface DesiredNode {
  planet: PlanetConfig;
  node: OctreeNode;
  key: string;
}

interface PlanetState {
  config: PlanetConfig;
  field: DensityField;
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
  private completed: Array<DesiredNode & { result: MeshResult; submitVersion?: number; isEdit?: boolean }> = [];
  private readonly failures = new Map<string, number>();
  private desiredKeys = new Set<string>();
  private desiredCount = 0;
  private lastTick = -Infinity;
  /** Priority rebuilds for player-edited chunks (owns the edit lineage). */
  private readonly remesher: EditRemesher;

  constructor(
    pool: MeshWorkerPool,
    sink: MeshSink,
    planets: PlanetConfig[],
    worldSeed: number,
    opts?: { updateIntervalMs?: number; maxInflight?: number; minEditSubmitIntervalMs?: number },
  ) {
    this.pool = pool;
    this.sink = sink;
    this.planets = planets.map((config) => ({ config, field: createDensityField(config, worldSeed) }));
    this.worldSeed = worldSeed;
    this.updateIntervalMs = opts?.updateIntervalMs ?? STREAM_UPDATE_INTERVAL_MS;
    this.maxInflight = opts?.maxInflight ?? pool.workerCount * STREAM_MAX_INFLIGHT_FACTOR;
    this.remesher = new EditRemesher(
      pool,
      planets.map((config) => config),
      worldSeed,
      { minSubmitIntervalMs: opts?.minEditSubmitIntervalMs },
    );
  }

  get pendingCount(): number {
    return this.queued.size + this.inflight.size;
  }

  /** Adopt boot pre-generation results (meshes + empty keys) before streaming. */
  adopt(config: PlanetConfig, results: MeshResult[], emptyKeys: string[]): void {
    for (const result of results) this.sink.add(config, result);
    for (const key of emptyKeys) this.sink.markEmpty(key);
  }

  /** Provide player-edit deltas for mesh jobs (called with LOD0/LOD1 keys). */
  setEditSource(source: ((key: string) => EditAttachment | null) | null): void {
    this.remesher.setEditSource(source);
  }

  /**
   * Rebuild chunks touched by player edits, ahead of the streaming queue
   * (delegates to the EditRemesher; see terrain/editRemesh.ts).
   */
  notifyEdited(lod0Keys: string[]): void {
    this.remesher.notifyEdited(lod0Keys, {
      forgetEmpty: (key) => this.sink.forgetEmpty(key),
      hasMesh: (key) => this.sink.hasMesh(key),
      unqueue: (key) => {
        this.queued.delete(key);
      },
      isStreamingInflight: (key) => this.inflight.has(key),
      pushCompletion: (item) => {
        this.completed.push(item);
      },
    });
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
    const { perLevel, total } = this.sink.meshCounts();
    return {
      perLevel,
      pending: this.pendingCount,
      cacheSize: total,
      empty: this.sink.emptyCount,
      desired: this.desiredCount,
    };
  }

  private recompute(cameraWorld: Vec3d, frustum: FrustumPlane[] | null, now: number): void {
    // Expire old failures so the map stays bounded and stale entries can
    // never block a retry (the cooldown check below only reads fresh ones).
    for (const [key, failedAt] of this.failures) {
      if (now - failedAt >= FAILURE_COOLDOWN_MS) this.failures.delete(key);
    }
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
        if (this.sink.has(key) || this.inflight.has(key)) continue;
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
        const score = distance(cameraWorld, center) - bonus;
        const waiting = this.queued.get(key);
        if (waiting) {
          // Re-score every tick: a fast camera outdates first-sighting
          // priority while entries wait behind the in-flight cap.
          waiting.score = score;
          continue;
        }
        // Only 'air' skips are sound (tunnel-wall cliffs break the 'solid'
        // branch; see octree.classifyNode). Everything else queues and the
        // worker's full-grid sampling decides exactly.
        if (isDefinitelyAir(field.density, node)) {
          this.sink.markEmpty(key);
          continue;
        }
        if (this.failures.has(key)) continue;
        this.queued.set(key, { planet: config, node, key, score });
      }
    }
    this.desiredCount = desired.length;
    const wanted = new Set(desired.map((d) => d.key));
    this.desiredKeys = wanted;
    for (const key of this.queued.keys()) {
      if (!wanted.has(key)) this.queued.delete(key);
    }
    // Fine-grained empty keys from flown-over regions accumulate without
    // bound, so age out the non-desired ones past a budget. Coarse empties
    // (few, huge volumes) are kept; re-verifying a pruned key later costs a
    // single background worker job.
    if (this.sink.emptyCount > EMPTY_KEY_BUDGET) {
      this.sink.pruneEmpty((key) => {
        if (this.desiredKeys.has(key)) return true;
        try {
          return parseChunkKey(key).level >= 2;
        } catch {
          return true;
        }
      });
    }
    const sorted = [...this.queued.values()].sort((a, b) => a.score - b.score);
    while (this.inflight.size < this.maxInflight && sorted.length > 0) {
      const job = sorted.shift() as DesiredNode & { score: number };
      this.queued.delete(job.key);
      this.inflight.set(job.key, job);
      const attempt: DesiredNode = { planet: job.planet, node: job.node, key: job.key };
      // Fresh edit deltas ride along so a chunk edited while queued still
      // meshes correctly; the version lets drainCompleted drop stale jobs.
      const version = this.remesher.currentVersion(job.key);
      const edits = job.node.level <= 1 ? this.remesher.editDeltas(job.key) : null;
      void this.pool
        .submit({
          planetConfig: job.planet,
          worldSeed: this.worldSeed,
          level: job.node.level,
          coord: { ...job.node.coord },
          edits: edits ?? undefined,
          editVersion: version,
        })
        .then(
          (result) => {
            this.inflight.delete(job.key);
            this.completed.push({ ...attempt, result, submitVersion: version });
          },
          () => {
            this.inflight.delete(job.key);
            this.failures.set(job.key, performance.now());
          },
        );
    }
    // Edited keys with no job outstanding (a submit failed, or the stream
    // never picked them up): retry promptly while still desired.
    this.remesher.retryDirty(
      wanted,
      (key) => this.inflight.has(key),
      (key) =>
        this.remesher.submitEditJob(key, (item) => {
          this.completed.push(item);
        }),
    );
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
    // Cheap path first: visible meshes that are still desired cost one Set
    // lookup each. Only stale leftovers pay the overlap scan, so the cost
    // scales with transitions, not with visible x desired.
    const stale = this.sink.boxes().filter((box) => !this.desiredKeys.has(box.key));
    if (stale.length === 0) return;
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
    for (const box of stale) {
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
    // Keys with an outstanding rebuild first: the remesh the player is
    // waiting for jumps the 4 ms apply budget. Nearest first within
    // each group. (Sorted on the dirty set, not edit history: versions
    // are pruned once applied so old edits never keep priority.)
    this.completed.sort((a, b) => {
      const ae = this.remesher.isDirty(a.key) ? 0 : 1;
      const be = this.remesher.isDirty(b.key) ? 0 : 1;
      if (ae !== be) return ae - be;
      return distance(cameraWorld, centerOf(a)) - distance(cameraWorld, centerOf(b));
    });
    const start = performance.now();
    while (this.completed.length > 0 && performance.now() - start < budgetMs) {
      const item = this.completed.shift() as DesiredNode & {
        result: MeshResult;
        submitVersion?: number;
        isEdit?: boolean;
      };
      const submitted = item.submitVersion ?? 0;
      if (this.remesher.isStale(item.key, submitted)) {
        // Coalesce instead of refreshing: under continuous editing every
        // result is outdated on arrival (strokes land faster than worker
        // latency), and resubmitting each one saturates the pool with
        // redundant remeshes of the same chunks — starving streaming jobs
        // and making meshes swap constantly. A newer job already covers
        // the key, or dirty + retryDirty will pick it up; resubmit only
        // when nothing outstanding remains.
        if (!this.remesher.hasOutstanding(item.key) && !this.inflight.has(item.key)) {
          this.remesher.submitEditJob(item.key, (completion) => {
            this.completed.push(completion);
          });
        }
        continue;
      }
      this.remesher.applied(item.key, this.inflight.has(item.key));
      if (item.result.empty) {
        // An edit can empty a chunk (a small bump dug away): the old mesh
        // must go, or it stays visible forever while the key is desired.
        if (item.isEdit || this.sink.hasMesh(item.key)) this.sink.remove(item.key);
        this.sink.markEmpty(item.key);
      } else if (item.isEdit && !this.desiredKeys.has(item.key) && !this.sink.hasMesh(item.key)) {
        // The chunk left the visible set while its rebuild ran (or was
        // never visible, e.g. an LOD1 parent): materializing it now would
        // flash a stale mesh over the scene until the next garbage
        // collection. Edits persist in the store and re-attach with fresh
        // deltas if the chunk streams back.
      } else if (item.isEdit) {
        // Edit rebuild: keep the old mesh visible until the new one is
        // ready, then swap atomically.
        this.sink.remove(item.key);
        this.sink.add(item.planet, item.result);
      } else {
        this.sink.add(item.planet, item.result);
      }
    }
  }
}
