// Simple worker pool for meshing (size per ARCHITECTURE.md:
// hardwareConcurrency - 1, clamped to [2, 6]). FIFO queue, promise API.
// Idle workers pull the next job; callers get MeshResult or an Error.

import { MESH_WORKER_MAX, MESH_WORKER_MIN } from '../core/constants.js';
import type { ChunkCoord } from './chunkKey.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { MeshError, MeshResult } from './workers/meshWorker.js';

export type { MeshResult };

export interface MeshRequest {
  planetConfig: PlanetConfig;
  worldSeed: number;
  level: number;
  coord: ChunkCoord;
  /** Sparse player-edit deltas for this job's 35^3 grid (optional). */
  edits?: { indices: Uint32Array; values: Float32Array };
  /** Edit version at submit time (lets callers drop stale results). */
  editVersion?: number;
}

export function poolSize(): number {
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  return Math.min(MESH_WORKER_MAX, Math.max(MESH_WORKER_MIN, cores - 1));
}

interface Pending {
  resolve: (result: MeshResult) => void;
  reject: (err: Error) => void;
}

export class MeshWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ id: number; request: MeshRequest }> = [];
  private pending = new Map<number, Pending>();
  private requests = new Map<number, MeshRequest>();
  private retries = new Map<number, number>();
  private inFlight = new Map<Worker, Set<number>>();
  private nextId = 0;
  private closed = false;

  constructor(count: number = poolSize()) {
    for (let i = 0; i < count; i += 1) {
      this.workers.push(this.spawnWorker());
    }
    if (this.workers.length === 0) throw new Error('mesh pool needs >= 1 worker');
  }

  get queuedJobs(): number {
    return this.queue.length;
  }

  get workerCount(): number {
    return this.workers.length;
  }

  submit(request: MeshRequest): Promise<MeshResult> {
    if (this.closed) return Promise.reject(new Error('pool is closed'));
    return new Promise<MeshResult>((resolve, reject) => {
      this.nextId += 1;
      this.pending.set(this.nextId, { resolve, reject });
      this.requests.set(this.nextId, { ...request });
      this.queue.push({ id: this.nextId, request: { ...request } });
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
    for (const [, pending] of this.pending) pending.reject(new Error('pool disposed'));
    this.pending.clear();
  }

  private spawnWorker(): Worker {
    const worker = new Worker(new URL('./workers/meshWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<MeshResult | MeshError>): void => {
      this.handleMessage(worker, event.data);
    };
    // A crashed worker never answers: re-queue its jobs onto a replacement
    // so one bad chunk can't hang the whole preview (with a retry cap).
    worker.onerror = (event: ErrorEvent): void => {
      this.failWorker(worker, event.message || 'worker error');
    };
    worker.onmessageerror = (): void => {
      this.failWorker(worker, 'worker message error');
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
      if (attempts > 2 || !pending || !request) {
        this.pending.delete(id);
        this.requests.delete(id);
        this.retries.delete(id);
        pending?.reject(new Error(`mesh worker failed: ${reason}`));
        continue;
      }
      // Same id, back to the front of the queue for the next idle worker.
      this.queue.unshift({ id, request });
    }
    this.pump();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop() as Worker;
      const entry = this.queue.shift() as { id: number; request: MeshRequest };
      this.inFlight.get(worker)?.add(entry.id);
      worker.postMessage({
        id: entry.id,
        planetConfig: entry.request.planetConfig,
        worldSeed: entry.request.worldSeed,
        level: entry.request.level,
        coord: entry.request.coord,
        edits: entry.request.edits,
        editVersion: entry.request.editVersion,
      });
    }
  }

  private handleMessage(worker: Worker, data: MeshResult | MeshError): void {
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
      pending.reject(new Error(`mesh worker: ${data.error}`));
    } else {
      pending.resolve(data);
    }
  }
}
