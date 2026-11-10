// Collider worker entry: samples the density field for one LOD0 chunk,
// runs marching cubes without skirts/colors, and posts the trimesh back
// with transferable buffers. Keeps heavy sampling off the main thread so
// the 4 ms terrain budget holds while the player moves.

import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import type { ChunkCoord } from '../chunkKey.js';
import { buildColliderData } from '../colliders.js';

export interface ColliderJob {
  id: number;
  planetConfig: PlanetConfig;
  worldSeed: number;
  coord: ChunkCoord;
}

export interface ColliderResult {
  id: number;
  key: string;
  origin: { x: number; y: number; z: number };
  positions: Float32Array;
  indices: Uint32Array;
  empty: boolean;
}

export interface ColliderError {
  id: number;
  error: string;
}

const workerScope = self as unknown as {
  postMessage: (message: ColliderResult | ColliderError, transfer: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ColliderJob>) => void) | null;
};

workerScope.onmessage = (event: MessageEvent<ColliderJob>): void => {
  const job = event.data;
  try {
    const data = buildColliderData(job.planetConfig, job.worldSeed, job.coord);
    const result: ColliderResult = {
      id: job.id,
      key: data.key,
      origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
      positions: data.positions,
      indices: data.indices,
      empty: data.empty,
    };
    workerScope.postMessage(result, [
      result.positions.buffer as Transferable,
      result.indices.buffer as Transferable,
    ]);
  } catch (err) {
    const message: ColliderError = {
      id: job.id,
      error: err instanceof Error ? err.message : String(err),
    };
    workerScope.postMessage(message, []);
  }
};
