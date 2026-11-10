// Small worker pool for LOD0 collider jobs. Same crash-safety shape as
// the mesh pool (replace a dead worker, retry once), but sized for the
// collider working set (a few dozen chunks around the player, not the
// whole streaming queue).

import { poolSize } from './workerPool.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { ChunkCoord } from './chunkKey.js';
import type { ColliderError, ColliderResult } from './workers/colliderWorker.js';

export type { ColliderResult };

export interface ColliderRequest {
  planetConfig: PlanetConfig;
  worldSeed: number;
  coord: ChunkCoord;
  /** Sparse player-edit deltas for this job's 35^3 grid (optional). */
  edits?: { indices: Uint32Array; values: Float32Array };
  /** Edit version at submit time (lets callers drop stale results). */
  editVersion?: number;
}

interface Pending {
  resolve: (result: ColliderResult) => void;
  reject: (err: Error) => void;
}

export class ColliderPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ id: number; request: ColliderRequest }> = [];
  private pending = new Map<number, Pending>();
  private requests = new Map<number, ColliderRequest>();
  private retries = new Map<number, number>();
  private inFlight = new Map<Worker, Set<number>>();
  private nextId = 0;
  private closed = false;

  constructor(count: number = Math.min(3, poolSize())) {
    const n = Math.max(1, count);
    for (let i = 0; i < n; i += 1) {
      this.workers.push(this.spawnWorker());
    }
  }

  get queuedJobs(): number {
    return this.queue.length;
  }

  request(req: ColliderRequest): Promise<ColliderResult> {
    if (this.closed) return Promise.reject(new Error('collider pool is closed'));
    return new Promise<ColliderResult>((resolve, reject) => {
      this.nextId += 1;
      this.pending.set(this.nextId, { resolve, reject });
      this.requests.set(this.nextId, { ...req, coord: { ...req.coord } });
      this.queue.push({ id: this.nextId, request: { ...req, coord: { ...req.coord } } });
      this.pump();
    });
  }

  dispose(): void {
    this.closed = true;
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.requests.clear();
    this.retries.clear();
    this.inFlight.clear();
    for (const [, pending] of this.pending) pending.reject(new Error('collider pool disposed'));
    this.pending.clear();
  }

  private spawnWorker(): Worker {
    const worker = new Worker(new URL('./workers/colliderWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<ColliderResult | ColliderError>): void => {
      this.handleMessage(worker, event.data);
    };
    worker.onerror = (event: ErrorEvent): void => {
      this.failWorker(worker, event.message || 'collider worker error');
    };
    worker.onmessageerror = (): void => {
      this.failWorker(worker, 'collider worker message error');
    };
    this.inFlight.set(worker, new Set());
    this.idle.push(worker);
    return worker;
  }

  private failWorker(worker: Worker, reason: string): void {
    const ids = this.inFlight.get(worker) ?? new Set<number>();
    this.inFlight.delete(worker);
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    try {
      worker.terminate();
    } catch {
      // Already dead; nothing to do.
    }
    if (!this.closed) this.workers.push(this.spawnWorker());
    for (const id of ids) {
      const attempts = (this.retries.get(id) ?? 0) + 1;
      this.retries.set(id, attempts);
      const pending = this.pending.get(id);
      const request = this.requests.get(id);
      if (attempts > 1 || !pending || !request) {
        this.pending.delete(id);
        this.requests.delete(id);
        this.retries.delete(id);
        pending?.reject(new Error(`collider worker failed: ${reason}`));
        continue;
      }
      this.queue.unshift({ id, request });
    }
    this.pump();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop() as Worker;
      const entry = this.queue.shift() as { id: number; request: ColliderRequest };
      this.inFlight.get(worker)?.add(entry.id);
      worker.postMessage({
        id: entry.id,
        planetConfig: entry.request.planetConfig,
        worldSeed: entry.request.worldSeed,
        coord: entry.request.coord,
        edits: entry.request.edits,
        editVersion: entry.request.editVersion,
      });
    }
  }

  private handleMessage(worker: Worker, data: ColliderResult | ColliderError): void {
    this.inFlight.get(worker)?.delete(data.id);
    const pending = this.pending.get(data.id);
    this.pending.delete(data.id);
    this.requests.delete(data.id);
    this.retries.delete(data.id);
    if (!this.closed) {
      this.idle.push(worker);
      this.pump();
    }
    if (!pending) return;
    if ('error' in data) {
      pending.reject(new Error(`collider worker: ${data.error}`));
    } else {
      pending.resolve(data);
    }
  }
}
