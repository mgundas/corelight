// Mesh worker entry: samples the density field for one chunk, runs
// marching cubes, and posts the mesh back with transferable buffers.
// Input and output cross the worker boundary as plain structured-cloneable
// data (PlanetConfig is plain JSON: Vec3d center, arrays for colors).

import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { cellSizeForLevel, chunkOrigin, type ChunkCoord } from '../chunkKey.js';
import { colorAt, createDensityFn } from '../density.js';
import { SAMPLE_GRID, polygonize } from '../marchingCubes.js';

export interface MeshJob {
  id: number;
  planetConfig: PlanetConfig;
  worldSeed: number;
  level: number;
  coord: ChunkCoord;
}

export interface MeshResult {
  id: number;
  key: string;
  origin: { x: number; y: number; z: number };
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  empty: boolean;
}

export interface MeshError {
  id: number;
  error: string;
}

const workerScope = self as unknown as {
  postMessage: (message: MeshResult | MeshError, transfer: Transferable[]) => void;
  onmessage: ((event: MessageEvent<MeshJob>) => void) | null;
};

workerScope.onmessage = (event: MessageEvent<MeshJob>): void => {
  const job = event.data;
  try {
    const density = createDensityFn(job.planetConfig, job.worldSeed);
    const cellSize = cellSizeForLevel(job.level);
    const size = SAMPLE_GRID;
    const samples = new Float32Array(size * size * size);
    const origin = chunkOrigin(job.coord, job.level);
    // Sample the full 35^3 grid: inner 33^3 cells marched, outer ring is the
    // border for central-difference normals. Index 1,1,1 == chunk origin.
    let i = 0;
    for (let iz = 0; iz < size; iz += 1) {
      const z = origin.z + (iz - 1) * cellSize;
      for (let iy = 0; iy < size; iy += 1) {
        const y = origin.y + (iy - 1) * cellSize;
        for (let ix = 0; ix < size; ix += 1) {
          const x = origin.x + (ix - 1) * cellSize;
          samples[i] = density(x, y, z);
          i += 1;
        }
      }
    }
    const mesh = polygonize(samples, origin, cellSize, (x, y, z, nx, ny, nz) =>
      colorAt(job.planetConfig, x, y, z, nx, ny, nz),
    );
    const result: MeshResult = {
      id: job.id,
      key: `${job.planetConfig.id}:${job.level}:${job.coord.x}:${job.coord.y}:${job.coord.z}`,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      positions: mesh.positions,
      normals: mesh.normals,
      colors: mesh.colors,
      indices: mesh.indices,
      empty: mesh.empty,
    };
    workerScope.postMessage(result, [
      result.positions.buffer as Transferable,
      result.normals.buffer as Transferable,
      result.colors.buffer as Transferable,
      result.indices.buffer as Transferable,
    ]);
  } catch (err) {
    const message: MeshError = {
      id: job.id,
      error: err instanceof Error ? err.message : String(err),
    };
    workerScope.postMessage(message, []);
  }
};
