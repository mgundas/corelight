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
  private nextId = 0;
  private closed = false;

  constructor(count: number = poolSize()) {
    for (let i = 0; i < count; i += 1) {
      const worker = new Worker(new URL('./workers/meshWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<MeshResult | MeshError>): void => {
        this.handleMessage(worker, event.data);
      };
      this.workers.push(worker);
      this.idle.push(worker);
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
    for (const [, pending] of this.pending) pending.reject(new Error('pool disposed'));
    this.pending.clear();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop() as Worker;
      const entry = this.queue.shift() as { id: number; request: MeshRequest };
      worker.postMessage({
        id: entry.id,
        planetConfig: entry.request.planetConfig,
        worldSeed: entry.request.worldSeed,
        level: entry.request.level,
        coord: entry.request.coord,
      });
    }
  }

  private handleMessage(worker: Worker, data: MeshResult | MeshError): void {
    const pending = this.pending.get(data.id);
    this.pending.delete(data.id);
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
