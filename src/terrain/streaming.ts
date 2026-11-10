// Shared streaming types and pure helpers (M02). Split out of the chunk
// manager to keep both files under the 400-line hard rule: this file owns
// the render-side sink contract, frustum math, and stats, all free of
// worker I/O and three.js.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { MeshResult } from './workerPool.js';

/** Render-side mesh store (structurally satisfied by ChunkMeshes). */
export interface MeshSink {
  has(key: string): boolean;
  add(config: PlanetConfig, result: MeshResult): 'added' | 'empty' | 'duplicate';
  /** Forget a mesh and dispose its geometry. */
  remove(key: string): boolean;
  /** Remember a key the worker (or boot) reported empty: never re-queue. */
  markEmpty(key: string): void;
  /** Drop a remembered empty key so the next update re-meshes it (edits). */
  forgetEmpty(key: string): void;
  /** Drop empty keys the predicate rejects (bounds the empty-key cache). */
  pruneEmpty(keep: (key: string) => boolean): void;
  /** Keys known empty (worker-reported + pre-skipped). */
  readonly emptyCount: number;
  /** Incrementally maintained mesh counts (cheap per-frame overlay source). */
  meshCounts(): { perLevel: number[]; total: number };
  boxes(): Array<{ key: string; level: number; min: Vec3d; size: number }>;
}

/** A frustum plane in world space: inside when normal.p + constant >= 0. */
export interface FrustumPlane {
  normal: Vec3d;
  constant: number;
}

/**
 * Translate render-local frustum planes into the world frame. The camera
 * lives in floating-origin local space (local = world - origin), so a
 * local plane n.l + c >= 0 becomes n.w + (c - n.origin) >= 0 in world
 * space. Without this the in-frustum priority bonus rewards the wrong
 * chunks after any origin shift.
 */
export function toWorldPlanes(planes: FrustumPlane[], origin: Vec3d): FrustumPlane[] {
  return planes.map((plane) => ({
    normal: { ...plane.normal },
    constant:
      plane.constant -
      (plane.normal.x * origin.x + plane.normal.y * origin.y + plane.normal.z * origin.z),
  }));
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
