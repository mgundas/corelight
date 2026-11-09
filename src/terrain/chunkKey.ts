// Chunk addressing: `planetId:level:x:y:z`. LOD level n has cell size
// 2^n m and chunk size 32 * 2^n m. Coords are integer chunk indices in
// planet-local space (origin = coord * size).

import type { Vec3d } from '../core/math.js';

export interface ChunkCoord {
  x: number;
  y: number;
  z: number;
}

export function cellSizeForLevel(level: number): number {
  return 2 ** level;
}

export function chunkSizeForLevel(level: number): number {
  return 32 * cellSizeForLevel(level);
}

/** Planet-local position of the chunk's minimum corner. */
export function chunkOrigin(coord: ChunkCoord, level: number): Vec3d {
  const size = chunkSizeForLevel(level);
  return { x: coord.x * size, y: coord.y * size, z: coord.z * size };
}

export function chunkKey(planetId: string, level: number, coord: ChunkCoord): string {
  return `${planetId}:${level}:${coord.x}:${coord.y}:${coord.z}`;
}

export function parseChunkKey(key: string): { planetId: string; level: number; coord: ChunkCoord } {
  const parts = key.split(':');
  if (parts.length !== 5) throw new Error(`bad chunk key: ${key}`);
  const [planetId, levelRaw, xRaw, yRaw, zRaw] = parts as [string, string, string, string, string];
  const level = Number(levelRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  const z = Number(zRaw);
  if (!planetId || !Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    throw new Error(`bad chunk key: ${key}`);
  }
  return { planetId, level, coord: { x, y, z } };
}

/** Chunk coords overlapping the planet-local AABB [min, max]. */
export function chunksInBox(min: Vec3d, max: Vec3d, level: number): ChunkCoord[] {
  const size = chunkSizeForLevel(level);
  const out: ChunkCoord[] = [];
  for (let x = Math.floor(min.x / size); x <= Math.floor(max.x / size); x += 1) {
    for (let y = Math.floor(min.y / size); y <= Math.floor(max.y / size); y += 1) {
      for (let z = Math.floor(min.z / size); z <= Math.floor(max.z / size); z += 1) {
        out.push({ x, y, z });
      }
    }
  }
  return out;
}
