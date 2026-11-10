// Chunk addressing: `planetId:level:x:y:z`. LOD level n has cell size
// 2^n m and chunk size 32 * 2^n m. Coords are integer node indices
// relative to the octree root's minimum corner (see terrain/octree.ts:
// the root itself is 0,0,0 at lodMaxLevel, so the centered root cube
// stays on the integer grid).

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
