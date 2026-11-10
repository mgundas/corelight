// Shared density-grid sampling for workers.
// WHY one helper: the mesh worker and the collider builder must sample the
// exact same 35^3 grid (inner 33^3 cells marched, outer ring for
// central-difference normals), or visual and collision surfaces diverge.

import { SAMPLE_GRID } from './marchingCubes.js';
import { nodeOrigin } from './octree.js';
import type { ChunkCoord } from './chunkKey.js';
import type { DensityField } from './density.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';

/** Fill a 35^3 Float32Array with density in planet-local coords. */
export function sampleGrid(
  field: DensityField,
  config: PlanetConfig,
  level: number,
  coord: ChunkCoord,
  cellSize: number,
): { samples: Float32Array; origin: { x: number; y: number; z: number } } {
  const size = SAMPLE_GRID;
  const samples = new Float32Array(size * size * size);
  const origin = nodeOrigin(config, level, coord);
  const density = field.density;
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
  return { samples, origin };
}
