// Marching cubes over a 35^3 sample grid (32^3 cells + 1 border sample
// per side for central-difference normals). Welds shared vertices with an
// edge-indexed cache. Positions are planet-local, relative to the chunk
// origin passed in (no three.js here: this runs in a Web Worker).

import type { Rgb } from '../planets/PlanetConfig.js';
import { gradientAt, sampleIndex } from './density.js';
import { EDGE_TABLE, TRI_TABLE } from './marchingCubesTables.js';
import { addSkirts } from './skirts.js';

/** Samples per side: 32 cells + one border sample on each side. */
export const SAMPLE_GRID = 35;
/** Marched cells per side (inner grid, border excluded). */
export const CELLS_PER_CHUNK = 32;

export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => Rgb;

export interface PolygonizeOptions {
  /** Generate boundary skirts to hide cracks between LOD levels. */
  skirts?: boolean;
}

export interface ChunkMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  empty: boolean;
}

interface GridPos {
  x: number;
  y: number;
  z: number;
}

/** The 8 corners of a unit cell, Bourke ordering. */
const CORNERS: ReadonlyArray<GridPos> = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 1, y: 1, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 1, y: 0, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: 0, y: 1, z: 1 },
];

/** Corner pairs for the 12 edges, Bourke ordering. */
const EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function axisOf(a: GridPos, b: GridPos): number {
  if (a.x !== b.x) return 0;
  if (a.y !== b.y) return 1;
  return 2;
}

/**
 * March `samples` (SAMPLE_GRID^3, border included) into a triangle mesh.
 * Emitted positions are relative to `origin` (the chunk's minimum corner =
 * sample 1,1,1); the color callback receives absolute planet-local coords.
 */
export function polygonize(
  samples: Float32Array,
  origin: GridPos,
  cellSize: number,
  colorAt: ColorFn,
  options?: PolygonizeOptions,
): ChunkMeshData {
  const size = SAMPLE_GRID;
  const cells = CELLS_PER_CHUNK;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // Weld: one vertex per grid edge. Key = (min endpoint sample index, axis).
  const edgeVerts = new Map<number, number>();

  const cornerValues = new Float32Array(8);
  const gx = new Float32Array(8);
  const gy = new Float32Array(8);
  const gz = new Float32Array(8);

  for (let iz = 0; iz < cells; iz += 1) {
    for (let iy = 0; iy < cells; iy += 1) {
      for (let ix = 0; ix < cells; ix += 1) {
        const sx = ix + 1;
        const sy = iy + 1;
        const sz = iz + 1;
        let cubeIndex = 0;
        for (let c = 0; c < 8; c += 1) {
          const corner = CORNERS[c] as GridPos;
          const vx = sx + corner.x;
          const vy = sy + corner.y;
          const vz = sz + corner.z;
          const value = samples[sampleIndex(vx, vy, vz, size)] as number;
          cornerValues[c] = value;
          if (value > 0) cubeIndex |= 1 << c;
          const g = gradientAt(samples, size, vx, vy, vz);
          gx[c] = g.x;
          gy[c] = g.y;
          gz[c] = g.z;
        }
        if (cubeIndex === 0 || cubeIndex === 255) continue;
        const edgeMask = EDGE_TABLE[cubeIndex] as number;
        if (edgeMask === 0) continue;

        const vertIndex = new Array<number>(12).fill(-1);
        for (let e = 0; e < 12; e += 1) {
          if ((edgeMask & (1 << e)) === 0) continue;
          const [ca, cb] = EDGE_CORNERS[e] as readonly [number, number];
          const va = cornerValues[ca] as number;
          const vb = cornerValues[cb] as number;
          const denom = vb - va;
          const t = denom === 0 ? 0.5 : (0 - va) / denom;
          const pa = CORNERS[ca] as GridPos;
          const pb = CORNERS[cb] as GridPos;
          // Canonical edge key from the minimum sample-space endpoint.
          const ax = sx + pa.x;
          const ay = sy + pa.y;
          const az = sz + pa.z;
          const bx = sx + pb.x;
          const by = sy + pb.y;
          const bz = sz + pb.z;
          const mx = Math.min(ax, bx);
          const my = Math.min(ay, by);
          const mz = Math.min(az, bz);
          const axis = axisOf(pa, pb);
          const key = ((mz * size + my) * size + mx) * 3 + axis;
          const cached = edgeVerts.get(key);
          if (cached !== undefined) {
            vertIndex[e] = cached;
            continue;
          }
          // Vertex position relative to the chunk origin (ARCH: the worker
          // reports positions relative to chunk origin; render adds it back
          // via the floating origin). Colors need absolute planet-local
          // coordinates, so re-add the origin only for the color lookup.
          const lx = (ix + pa.x + (pb.x - pa.x) * t) * cellSize;
          const ly = (iy + pa.y + (pb.y - pa.y) * t) * cellSize;
          const lz = (iz + pa.z + (pb.z - pa.z) * t) * cellSize;
          // Interpolated density gradient, negated: points out of the solid.
          let nx = -((gx[ca] as number) + ((gx[cb] as number) - (gx[ca] as number)) * t);
          let ny = -((gy[ca] as number) + ((gy[cb] as number) - (gy[ca] as number)) * t);
          let nz = -((gz[ca] as number) + ((gz[cb] as number) - (gz[ca] as number)) * t);
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (len > 1e-9) {
            nx /= len;
            ny /= len;
            nz /= len;
          } else {
            nx = 0;
            ny = 1;
            nz = 0;
          }
          const rgb = colorAt(lx + origin.x, ly + origin.y, lz + origin.z, nx, ny, nz);
          const vi = positions.length / 3;
          positions.push(lx, ly, lz);
          normals.push(nx, ny, nz);
          colors.push(rgb[0], rgb[1], rgb[2]);
          edgeVerts.set(key, vi);
          vertIndex[e] = vi;
        }

        const base = cubeIndex * 16;
        for (let ti = 0; ti < 16; ti += 3) {
          const e0 = TRI_TABLE[base + ti] as number;
          if (e0 === -1) break;
          const e1 = TRI_TABLE[base + ti + 1] as number;
          const e2 = TRI_TABLE[base + ti + 2] as number;
          // Reversed vs. the table order: Bourke's rows assume the set bit
          // means "below the isolevel", but our solid is density > 0, so the
          // listed order faces inward. Swap for outward-facing FrontSide.
          indices.push(vertIndex[e0] as number, vertIndex[e2] as number, vertIndex[e1] as number);
        }
      }
    }
  }

  if (options?.skirts) {
    addSkirts(positions, normals, colors, indices, samples, origin, cellSize, colorAt);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    empty: indices.length === 0,
  };
}
