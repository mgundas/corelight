// M01 temporary scene: mesh every level-3 chunk (8 m cells) that touches
// the planet surface shell, plus all level-1 chunks in a 128 m cube around
// a surface point. Replaced by real LOD streaming in M02.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkOrigin, chunkSizeForLevel, chunksInBox, type ChunkCoord } from '../terrain/chunkKey.js';
import type { MeshWorkerPool } from '../terrain/workerPool.js';
import type { ChunkMeshes } from './chunkMeshes.js';

export interface PreviewProgress {
  /** Jobs settled (success or failure). */
  loaded: number;
  /** Jobs that produced a mesh. */
  added: number;
  /** Jobs the worker reported empty (cached, e.g. deep-solid chunks). */
  empty: number;
  /** Total jobs submitted. */
  total: number;
}

function chunkTouchesShell(config: PlanetConfig, coord: ChunkCoord, level: number): boolean {
  // Approximate: tests the 8 corners only (the true closest point of a box
  // to the center can be a face). Good enough for the temp scene; M02 must
  // use the face-clamped min distance for LOD decisions.
  const origin = chunkOrigin(coord, level);
  const size = chunkSizeForLevel(level);
  const margin = config.surfaceAmplitude + 15;
  let minD = Infinity;
  let maxD = 0;
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        const px = origin.x + dx * size;
        const py = origin.y + dy * size;
        const pz = origin.z + dz * size;
        const d = Math.sqrt(px * px + py * py + pz * pz);
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }
    }
  }
  return minD <= config.radius + margin && maxD >= config.radius - margin;
}

/** Level-3 chunks of the octree root cube that touch the surface shell. */
export function surfaceShellChunks(config: PlanetConfig, level: number): ChunkCoord[] {
  const size = chunkSizeForLevel(level);
  // Root cube side 32 * 2^lodMaxLevel covers the whole planet (Sela: 1024 m).
  const half = (32 * 2 ** config.lodMaxLevel) / 2;
  const out: ChunkCoord[] = [];
  for (let x = -half / size; x < half / size; x += 1) {
    for (let y = -half / size; y < half / size; y += 1) {
      for (let z = -half / size; z < half / size; z += 1) {
        const coord = { x, y, z };
        if (chunkTouchesShell(config, coord, level)) out.push(coord);
      }
    }
  }
  return out;
}

/** The 8 level-1 chunks forming a 128 m cube that contains `point`. */
export function detailCubeChunks(point: Vec3d, level: number): ChunkCoord[] {
  const size = chunkSizeForLevel(level);
  const base = (v: number): number => Math.floor(v / size) * size - size / 2;
  const bx = base(point.x);
  const by = base(point.y);
  const bz = base(point.z);
  const cx = Math.floor(bx / size);
  const cy = Math.floor(by / size);
  const cz = Math.floor(bz / size);
  const out: ChunkCoord[] = [];
  for (let x = cx; x <= cx + 1; x += 1) {
    for (let y = cy; y <= cy + 1; y += 1) {
      for (let z = cz; z <= cz + 1; z += 1) {
        out.push({ x, y, z });
      }
    }
  }
  return out;
}

/** Fire off all preview jobs; resolves when every job settles. */
export async function loadPreviewTerrain(
  pool: MeshWorkerPool,
  chunks: ChunkMeshes,
  config: PlanetConfig,
  worldSeed: number,
  onProgress?: (progress: PreviewProgress) => void,
): Promise<PreviewProgress> {
  const shell = surfaceShellChunks(config, 3);
  const detailPoint: Vec3d = { x: 0, y: config.radius, z: 0 };
  const detail = detailCubeChunks(detailPoint, 1);
  // Core chamber at level 1: the 8 chunks covering [-64, 64]^3 around the
  // planet center, so the hollow chamber has visible walls (temp-only;
  // M02 streams this).
  const coreHalf = 32;
  const core = chunksInBox(
    { x: -coreHalf, y: -coreHalf, z: -coreHalf },
    { x: coreHalf, y: coreHalf, z: coreHalf },
    1,
  );
  const jobs: Array<{ level: number; coord: ChunkCoord }> = shell.map((coord) => ({ level: 3, coord }));
  const seen = new Set(shell.map((c) => `3:${c.x}:${c.y}:${c.z}`));
  const all = jobs;
  for (const coord of [...detail, ...core]) {
    const key = `1:${coord.x}:${coord.y}:${coord.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ level: 1, coord });
  }
  const progress: PreviewProgress = { loaded: 0, added: 0, empty: 0, total: all.length };
  await Promise.all(
    all.map(async ({ level, coord }) => {
      try {
        const result = await pool.submit({ planetConfig: config, worldSeed, level, coord });
        const status = chunks.add(config, result);
        if (status === 'added') progress.added += 1;
        else if (status === 'empty') progress.empty += 1;
      } catch {
        // A failed chunk leaves a hole; the overlay shows the shortfall.
      } finally {
        progress.loaded += 1;
        onProgress?.({ ...progress });
      }
    }),
  );
  return { ...progress };
}
