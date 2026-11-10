// Mesh worker entry: samples the density field for one chunk, runs
// marching cubes, and posts the mesh back with transferable buffers.
// Input and output cross the worker boundary as plain structured-cloneable
// data (PlanetConfig is plain JSON: Vec3d center, arrays for colors).

import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { cellSizeForLevel, type ChunkCoord } from '../chunkKey.js';
import { colorAt, createDensityField, type DensityField } from '../density.js';
import { polygonize } from '../marchingCubes.js';
import { sampleGrid } from '../sampleGrid.js';

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

// One field per planet+seed: building 3 simplex instances per chunk is
// wasteful once M02 streams hundreds of chunks through each worker.
const fields = new Map<string, DensityField>();

function fieldFor(config: PlanetConfig, worldSeed: number): DensityField {
  const key = `${config.id}:${worldSeed}`;
  let field = fields.get(key);
  if (!field) {
    field = createDensityField(config, worldSeed);
    fields.set(key, field);
  }
  return field;
}

workerScope.onmessage = (event: MessageEvent<MeshJob>): void => {
  const job = event.data;
  try {
    const field = fieldFor(job.planetConfig, job.worldSeed);
    const colorSalt = `${job.worldSeed}:${job.planetConfig.seed}:color`;
    const cellSize = cellSizeForLevel(job.level);
    // Full 35^3 grid: inner 33^3 cells marched, outer ring is the border
    // for central-difference normals. Index 1,1,1 == chunk origin.
    const { samples, origin } = sampleGrid(field, job.planetConfig, job.level, job.coord, cellSize);
    const mesh = polygonize(
      samples,
      origin,
      cellSize,
      (x, y, z, nx, ny, nz) => colorAt(job.planetConfig, x, y, z, nx, ny, nz, colorSalt),
      { skirts: true },
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
