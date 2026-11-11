// Priority remesh for player-edited chunks (M04). Owns the edit lineage —
// per-key versions, the outstanding-rebuild set, and edit-job refcounts —
// while ChunkManager keeps the streaming queue, completions, and the sink.
// Split out to keep both files under the 400-line hard rule.

import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkKey, chunkSizeForLevel, parseChunkKey } from './chunkKey.js';
import { nodeOrigin, type OctreeNode } from './octree.js';
import type { EditAttachment } from './edits.js';
import type { MeshResult, MeshWorkerPool } from './workerPool.js';

/** A finished edit job, ready for the manager's completion queue. */
export interface EditCompletion {
  planet: PlanetConfig;
  node: OctreeNode;
  key: string;
  result: MeshResult;
  submitVersion: number;
  isEdit: true;
}

export interface EditRemeshHooks {
  /** Drop the sink's empty mark; true when a mark was actually removed. */
  forgetEmpty(key: string): boolean;
  /** True while the sink shows a mesh for the key (visible right now). */
  hasMesh(key: string): boolean;
  /** Drop any queued (not yet submitted) streaming job for the key. */
  unqueue(key: string): void;
  /** True while a streaming job for the key is in flight. */
  isStreamingInflight(key: string): boolean;
  pushCompletion(item: EditCompletion): void;
}

export interface EditRemesherOptions {
  /** Minimum ms between edit submits for one key (default 250). Zero disables. */
  minSubmitIntervalMs?: number;
  /** Clock (injectable for tests; defaults to performance.now). */
  now?: () => number;
}

export class EditRemesher {
  private editSource: ((key: string) => EditAttachment | null) | null = null;
  /** Edit counter per LOD0/LOD1 key, bumped by notifyEdited. */
  private readonly versions = new Map<string, number>();
  /** Edited keys with a fresh rebuild outstanding. */
  private readonly dirty = new Set<string>();
  /** Edit-job refcount per key (they bypass the streaming inflight cap). */
  private readonly inflight = new Map<string, number>();
  /** Last submit time per key (rate control; pruned with versions). */
  private readonly lastSubmit = new Map<string, number>();
  private readonly minInterval: number;
  private readonly now: () => number;

  constructor(
    private readonly pool: MeshWorkerPool,
    private readonly planets: PlanetConfig[],
    private readonly worldSeed: number,
    opts: EditRemesherOptions = {},
  ) {
    this.minInterval = opts.minSubmitIntervalMs ?? 250;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Player-edit delta provider (called with LOD0/LOD1 keys). */
  setEditSource(source: ((key: string) => EditAttachment | null) | null): void {
    this.editSource = source;
  }

  isDirty(key: string): boolean {
    return this.dirty.has(key);
  }

  /** Edit version captured when a job for the key is submitted. */
  currentVersion(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  /** Fresh deltas for a job (streaming submits share this path). */
  editDeltas(key: string): EditAttachment | null {
    return this.editSource?.(key) ?? null;
  }

  /** A submitted job is stale when a newer edit landed while it ran. */
  isStale(key: string, submitted: number): boolean {
    return submitted !== (this.versions.get(key) ?? 0);
  }

  /** Whether an edit job for the key is currently running. */
  hasOutstanding(key: string): boolean {
    return (this.inflight.get(key) ?? 0) > 0;
  }

  /**
   * Rebuild chunks touched by player edits, ahead of the streaming queue.
   * Takes the LOD0 keys from TerrainEdits and adds their LOD1 parents
   * (coarse meshes ignore edits past LOD1, so parents are the widest level
   * that must refresh). Submits immediately (bypassing the 100 ms
   * recompute throttle) so the visual update lands within a couple of
   * frames — but only for chunks that have a mesh (visible) or carried an
   * empty mark (air turned solid): materializing an invisible chunk would
   * flash a coarse mesh over the fine children until the next garbage
   * collection, and the streaming path re-attaches fresh deltas if the
   * chunk ever meshes later. Stale in-flight jobs are detected by version
   * at completion and refreshed, never shown.
   */
  notifyEdited(lod0Keys: string[], hooks: EditRemeshHooks): void {
    const keys = new Set<string>();
    for (const key of lod0Keys) {
      try {
        const parsed = parseChunkKey(key);
        if (parsed.level !== 0) continue;
        keys.add(key);
        // The LOD1 parent covering this chunk (and its edited neighbors).
        const parent = {
          x: Math.floor(parsed.coord.x / 2),
          y: Math.floor(parsed.coord.y / 2),
          z: Math.floor(parsed.coord.z / 2),
        };
        keys.add(chunkKey(parsed.planetId, 1, parent));
      } catch {
        continue;
      }
    }
    for (const key of keys) {
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
      this.dirty.add(key);
      const wasEmpty = hooks.forgetEmpty(key);
      hooks.unqueue(key);
      // Invisible chunks (no mesh, no empty mark) skip the priority submit:
      // building them now would pop a mesh over the scene until the next
      // garbage collection, and the streaming path picks them up with fresh
      // deltas if they are ever desired. They stay dirty so the retry
      // fallback still covers them while desired.
      if (!hooks.hasMesh(key) && !wasEmpty) continue;
      if ((this.inflight.get(key) ?? 0) === 0 && !hooks.isStreamingInflight(key)) {
        this.submitEditJob(key, hooks.pushCompletion);
      }
    }
  }

  /** Submit one priority edit job for an LOD0/LOD1 key (fresh deltas). */
  submitEditJob(key: string, pushCompletion: (item: EditCompletion) => void): void {
    let parsed;
    try {
      parsed = parseChunkKey(key);
    } catch {
      this.dirty.delete(key);
      return;
    }
    const planet = this.planets.find((p) => p.id === parsed.planetId);
    if (!planet || parsed.level > 1) {
      this.dirty.delete(key);
      return;
    }
    // Rate control: at most one submit per key per interval. Continuous
    // digging would otherwise resubmit every stale completion (strokes
    // land faster than worker latency, so all of them are outdated on
    // arrival). Skipped keys stay dirty; retryDirty picks them up with
    // the latest deltas once the interval elapses.
    const nowMs = this.now();
    if (nowMs - (this.lastSubmit.get(key) ?? -Infinity) < this.minInterval) return;
    this.lastSubmit.set(key, nowMs);
    const level = parsed.level;
    const version = this.versions.get(key) ?? 0;
    const coord = { ...parsed.coord };
    const min = nodeOrigin(planet, level, coord);
    const size = chunkSizeForLevel(level);
    const node: OctreeNode = {
      level,
      coord,
      min,
      size,
      center: { x: min.x + size / 2, y: min.y + size / 2, z: min.z + size / 2 },
    };
    const edits = this.editSource?.(key) ?? null;
    this.inflight.set(key, (this.inflight.get(key) ?? 0) + 1);
    void this.pool
      .submit({
        planetConfig: planet,
        worldSeed: this.worldSeed,
        level,
        coord: { ...coord },
        edits: edits ?? undefined,
        editVersion: version,
      })
      .then(
        (result) => {
          this.decInflight(key);
          pushCompletion({ planet, node, key, result, submitVersion: version, isEdit: true });
        },
        () => {
          this.decInflight(key);
          // Stay dirty: the recompute fallback retries within 100 ms.
        },
      );
  }

  /**
   * A matching completion applied: clear the rebuild flag, pruning the
   * version when no job for the key is outstanding (a still-running
   * pre-edit job keeps its lineage and is detected stale on arrival).
   */
  applied(key: string, streamingInflight: boolean): void {
    this.dirty.delete(key);
    if (!streamingInflight && (this.inflight.get(key) ?? 0) === 0) {
      this.versions.delete(key);
      // A settled key starts its next burst immediately (first stroke
      // after a pause must show within a couple of frames).
      this.lastSubmit.delete(key);
    }
  }

  /**
   * Retry dirty keys with no job outstanding (a submit failed, or the
   * stream never picked them up). Keys the camera left behind are
   * forgotten: edits persist in the store and re-attach if the chunk
   * streams back.
   */
  retryDirty(
    desired: Set<string>,
    isStreamingInflight: (key: string) => boolean,
    submit: (key: string) => void,
  ): void {
    for (const key of [...this.dirty]) {
      if (!desired.has(key)) {
        this.dirty.delete(key);
        this.lastSubmit.delete(key);
        continue;
      }
      if (!isStreamingInflight(key) && (this.inflight.get(key) ?? 0) === 0) {
        submit(key);
      }
    }
  }

  private decInflight(key: string): void {
    const left = (this.inflight.get(key) ?? 1) - 1;
    if (left <= 0) this.inflight.delete(key);
    else this.inflight.set(key, left);
  }
}
