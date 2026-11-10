// Collision meshes for LOD0 chunks (ARCHITECTURE.md: trimesh colliders
// built from worker output, never from three.js geometry).
// buildColliderData samples the same density grid as the mesh worker and
// runs marching cubes without skirts or colors; the result feeds Rapier
// trimesh colliders in sim/physics/terrainColliders.ts.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { cellSizeForLevel, type ChunkCoord } from './chunkKey.js';
import { createDensityField } from './density.js';
import { polygonize } from './marchingCubes.js';
import { sampleGrid } from './sampleGrid.js';

export interface ColliderData {
  key: string;
  /** Planet-local chunk origin (collider verts are relative to this). */
  origin: Vec3d;
  positions: Float32Array;
  indices: Uint32Array;
  empty: boolean;
}

export function colliderKey(planetId: string, coord: ChunkCoord): string {
  return `${planetId}:0:${coord.x}:${coord.y}:${coord.z}`;
}

/** Pure + deterministic: same seed + chunk = identical collision mesh. */
export function buildColliderData(
  config: PlanetConfig,
  worldSeed: number,
  coord: ChunkCoord,
  edits?: { indices: Uint32Array; values: Float32Array },
): ColliderData {
  const field = createDensityField(config, worldSeed);
  const cellSize = cellSizeForLevel(0);
  const { samples, origin } = sampleGrid(field, config, 0, coord, cellSize);
  if (edits) {
    for (let k = 0; k < edits.indices.length; k += 1) {
      const at = edits.indices[k] as number;
      samples[at] = (samples[at] as number) + (edits.values[k] as number);
    }
  }
  // No colors needed for collision; normals are still computed (cheap).
  const mesh = polygonize(samples, origin, cellSize, () => [0, 0, 0]);
  return {
    key: colliderKey(config.id, coord),
    origin: { x: origin.x, y: origin.y, z: origin.z },
    positions: mesh.positions,
    indices: mesh.indices,
    empty: mesh.empty,
  };
}
