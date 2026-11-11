// Job-grid resolution for player edits (M04). Split out of TerrainEdits
// to keep both files under the 400-line hard rule: this pure function
// maps the sparse per-chunk store into a mesh job's 35^3 sample grid.
// LOD0 copies directly; LOD1 averages each 2^3 LOD0 cube (weight 1/8);
// higher levels ignore edits.

import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkKey } from './chunkKey.js';
import { rootMin } from './octree.js';
import { sampleIndex } from './density.js';
import { SAMPLE_GRID } from './marchingCubes.js';
import type { EditAttachment } from './edits.js';

/** Samples owned per LOD0 chunk axis (32 cells + shared far edge). */
const OWNED_PER_CHUNK = 33;

function decodeIndex33(idx: number): { x: number; y: number; z: number } {
  const iz = Math.floor(idx / (OWNED_PER_CHUNK * OWNED_PER_CHUNK));
  const rem = idx - iz * OWNED_PER_CHUNK * OWNED_PER_CHUNK;
  const iy = Math.floor(rem / OWNED_PER_CHUNK);
  return { x: rem - iy * OWNED_PER_CHUNK, y: iy, z: iz };
}

/**
 * Resolve stored deltas into a mesh job's 35^3 sample grid. Null when the
 * job window holds no edits.
 */
export function deltasForJob(
  chunks: ReadonlyMap<string, ReadonlyMap<number, number>>,
  planet: PlanetConfig,
  level: number,
  coord: { x: number; y: number; z: number },
): EditAttachment | null {
  if (level !== 0 && level !== 1) return null;
  const perAxis = 2 ** planet.lodMaxLevel;
  const min = rootMin(planet);
  const size = SAMPLE_GRID;
  // Job window in lattice coords (chunk span plus the 1-sample border in
  // LOD0 units: 1 for LOD0, 2 for LOD1).
  const cell = 2 ** level;
  const origin = {
    x: min.x + coord.x * 32 * cell,
    y: min.y + coord.y * 32 * cell,
    z: min.z + coord.z * 32 * cell,
  };
  const border = cell;
  const lo = {
    x: Math.max(0, Math.round(origin.x - min.x - border)),
    y: Math.max(0, Math.round(origin.y - min.y - border)),
    z: Math.max(0, Math.round(origin.z - min.z - border)),
  };
  // LOD1 samples average a 2-wide LOD0 cube: sample 34 covers lattice +66
  // and +67, so the window must reach one past the border (+67, not +66),
  // or the edge normals average half a cube. LOD0 needs no extra (+0).
  const hiPad = border + (cell - 1);
  const hi = {
    x: Math.min(perAxis * 32, Math.round(origin.x - min.x + 32 * cell + hiPad)),
    y: Math.min(perAxis * 32, Math.round(origin.y - min.y + 32 * cell + hiPad)),
    z: Math.min(perAxis * 32, Math.round(origin.z - min.z + 32 * cell + hiPad)),
  };
  const acc = new Map<number, number>();
  const ownerMin = {
    x: Math.max(0, Math.floor(lo.x / 32)),
    y: Math.max(0, Math.floor(lo.y / 32)),
    z: Math.max(0, Math.floor(lo.z / 32)),
  };
  const ownerMax = {
    x: Math.min(perAxis - 1, Math.floor(hi.x / 32)),
    y: Math.min(perAxis - 1, Math.floor(hi.y / 32)),
    z: Math.min(perAxis - 1, Math.floor(hi.z / 32)),
  };
  for (let cz = ownerMin.z; cz <= ownerMax.z; cz += 1) {
    for (let cy = ownerMin.y; cy <= ownerMax.y; cy += 1) {
      for (let cx = ownerMin.x; cx <= ownerMax.x; cx += 1) {
        const inner = chunks.get(chunkKey(planet.id, 0, { x: cx, y: cy, z: cz }));
        if (!inner) continue;
        for (const [local, delta] of inner) {
          const { x: lx, y: ly, z: lz } = decodeIndex33(local);
          const gx = cx * 32 + lx;
          const gy = cy * 32 + ly;
          const gz = cz * 32 + lz;
          if (gx < lo.x || gx > hi.x || gy < lo.y || gy > hi.y || gz < lo.z || gz > hi.z) {
            continue;
          }
          if (level === 0) {
            const ix = gx - (coord.x * 32 - 1);
            const iy = gy - (coord.y * 32 - 1);
            const iz = gz - (coord.z * 32 - 1);
            if (ix < 0 || iy < 0 || iz < 0 || ix >= size || iy >= size || iz >= size) continue;
            acc.set(sampleIndex(ix, iy, iz, size), delta);
          } else {
            // Each LOD0 point falls in exactly one LOD1 averaging cube
            // (left-closed); its delta contributes 1/8 of that sample.
            const ix = Math.floor((gx - coord.x * 64) / 2) + 1;
            const iy = Math.floor((gy - coord.y * 64) / 2) + 1;
            const iz = Math.floor((gz - coord.z * 64) / 2) + 1;
            if (ix < 0 || iy < 0 || iz < 0 || ix >= size || iy >= size || iz >= size) continue;
            const at = sampleIndex(ix, iy, iz, size);
            acc.set(at, (acc.get(at) ?? 0) + delta / 8);
          }
        }
      }
    }
  }
  if (acc.size === 0) return null;
  const indices = new Uint32Array(acc.size);
  const values = new Float32Array(acc.size);
  let i = 0;
  for (const [at, delta] of acc) {
    indices[i] = at;
    values[i] = delta;
    i += 1;
  }
  return { indices, values };
}
