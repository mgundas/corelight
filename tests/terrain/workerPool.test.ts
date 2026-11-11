// Worker pool edit-buffer retry tests (#5): transferring the stored edit
// buffers detaches them, so a worker crash retry would re-send neutered
// buffers and throw DataCloneError (losing the worker and hanging the job).
// The pools must transfer copies and survive postMessage failures.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { ColliderPool } from '../../src/terrain/colliderPool.js';
import { MeshWorkerPool } from '../../src/terrain/workerPool.js';

interface CapturedPost {
  msg: Record<string, unknown>;
  transfer: unknown[];
}

// Minimal Worker stand-in: the pools only use postMessage, terminate,
// onmessage, onerror and onmessageerror.
function fakeWorkerImpl(behavior: (w: FakeWorker, msg: Record<string, unknown>) => void): FakeWorker {
  const w = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onerror: null as ((e: { message: string }) => void) | null,
    onmessageerror: null as (() => void) | null,
    posted: [] as CapturedPost[],
    terminated: false,
    postMessage(msg: Record<string, unknown>, transfer?: unknown[]): void {
      this.posted.push({ msg, transfer: transfer ?? [] });
      behavior(this as unknown as FakeWorker, msg);
    },
    terminate(): void {
      this.terminated = true;
    },
  };
  return w as unknown as FakeWorker;
}

type FakeWorker = {
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
  posted: CapturedPost[];
  postMessage(msg: Record<string, unknown>, transfer?: unknown[]): void;
  terminate(): void;
};

function successResult(id: number, key: string): Record<string, unknown> {
  return {
    id,
    key,
    origin: { x: 0, y: 0, z: 0 },
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    empty: true,
  };
}

describe('mesh worker pool edit retries', () => {
  it('transfers copies so the stored buffers survive for retry', async () => {
    const ref: { worker: FakeWorker | null } = { worker: null };
    const pool = new MeshWorkerPool(1, () => {
      const w = fakeWorkerImpl((self, msg) => {
        const id = msg['id'] as number;
        self.onmessage?.({ data: successResult(id, 'k') });
      });
      ref.worker = w;
      return w as unknown as Worker;
    });
    const indices = new Uint32Array([1, 2, 3]);
    const values = new Float32Array([0.5, 0.5, 0.5]);
    const promise = pool.submit({
      planetConfig: SELA,
      worldSeed: 1337,
      level: 0,
      coord: { x: 0, y: 0, z: 0 },
      edits: { indices, values },
    });
    await promise;
    // Originals untouched (a real transfer would have detached them).
    expect(indices.length).toBe(3);
    expect(values.length).toBe(3);
    expect(indices.buffer.byteLength).toBeGreaterThan(0);
    // What crossed the boundary are copies, not the stored buffers.
    const posted = ref.worker?.posted[0];
    const postedEdits = posted?.msg['edits'] as { indices: Uint32Array; values: Float32Array };
    expect(postedEdits.indices).not.toBe(indices);
    expect(postedEdits.values).not.toBe(values);
    expect([...postedEdits.indices]).toEqual([1, 2, 3]);
    pool.dispose();
  });

  it('a throwing postMessage rejects the job but keeps the pool usable', async () => {
    let calls = 0;
    const pool = new MeshWorkerPool(1, () =>
      fakeWorkerImpl((self, msg) => {
        calls += 1;
        if (calls === 1) throw new Error('DataCloneError');
        const id = msg['id'] as number;
        self.onmessage?.({ data: successResult(id, 'k2') });
      }) as unknown as Worker,
    );
    await expect(
      pool.submit({ planetConfig: SELA, worldSeed: 1337, level: 0, coord: { x: 1, y: 0, z: 0 } }),
    ).rejects.toThrow();
    // The worker was returned to idle: the next job still settles.
    const second = await pool.submit({
      planetConfig: SELA,
      worldSeed: 1337,
      level: 0,
      coord: { x: 2, y: 0, z: 0 },
    });
    expect(second.empty).toBe(true);
    pool.dispose();
  });

  it('a crashed worker retries the edit job and the promise settles', async () => {
    let workers = 0;
    const pool = new MeshWorkerPool(1, () => {
      workers += 1;
      const generation = workers;
      return fakeWorkerImpl((self, msg) => {
        const id = msg['id'] as number;
        if (generation === 1) {
          // Simulate a crash: the pool replaces the worker and re-queues.
          self.onerror?.({ message: 'boom' });
          return;
        }
        self.onmessage?.({ data: successResult(id, 'k3') });
      }) as unknown as Worker;
    });
    const result = await pool.submit({
      planetConfig: SELA,
      worldSeed: 1337,
      level: 0,
      coord: { x: 3, y: 0, z: 0 },
      edits: { indices: new Uint32Array([7]), values: new Float32Array([1]) },
    });
    expect(result.empty).toBe(true);
    expect(workers).toBe(2);
    pool.dispose();
  });
});

describe('collider pool edit retries', () => {
  it('a crashed worker retries and the promise settles', async () => {
    let workers = 0;
    const pool = new ColliderPool(1, () => {
      workers += 1;
      const generation = workers;
      return fakeWorkerImpl((self, msg) => {
        const id = msg['id'] as number;
        if (generation === 1) {
          self.onerror?.({ message: 'boom' });
          return;
        }
        self.onmessage?.({ data: { ...successResult(id, 'c'), coord: { x: 0, y: 0, z: 0 } } });
      }) as unknown as Worker;
    });
    const result = await pool.request({
      planetConfig: SELA,
      worldSeed: 1337,
      coord: { x: 0, y: 0, z: 0 },
      edits: { indices: new Uint32Array([7]), values: new Float32Array([1]) },
    });
    expect(result.empty).toBe(true);
    expect(workers).toBe(2);
    pool.dispose();
  });
});
