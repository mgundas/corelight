// Marching-cubes tests: a sphere SDF must produce a closed mesh whose
// vertices sit near the expected radius, with unit normals. Also covers
// the empty (fully solid / fully air) cases and the lookup tables.

import { describe, expect, it } from 'vitest';
import { EDGE_TABLE, TRI_TABLE } from '../../src/terrain/marchingCubesTables.js';
import { polygonize, SAMPLE_GRID } from '../../src/terrain/marchingCubes.js';

const SIZE = SAMPLE_GRID;
const CELLS = 32;

function sphereSamples(radius: number): Float32Array {
  // Sphere centered in the inner 32^3 grid (sample 1,1,1 == cell 0,0,0).
  const samples = new Float32Array(SIZE * SIZE * SIZE);
  const center = CELLS / 2;
  for (let iz = 0; iz < SIZE; iz += 1) {
    for (let iy = 0; iy < SIZE; iy += 1) {
      for (let ix = 0; ix < SIZE; ix += 1) {
        const dx = ix - 1 - center;
        const dy = iy - 1 - center;
        const dz = iz - 1 - center;
        // SDF: positive = solid outside the sphere... but our convention is
        // positive = solid, so negate: solid OUTSIDE the sphere shell test
        // uses inside-solid: value = radius - dist (positive inside).
        samples[ix + SIZE * (iy + SIZE * iz)] = radius - Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
  }
  return samples;
}

describe('marching cubes tables', () => {
  it('has 256 edge entries and 256 16-wide triangle rows', () => {
    expect(EDGE_TABLE.length).toBe(256);
    expect(TRI_TABLE.length).toBe(256 * 16);
  });

  it('only references edges present in the edge mask, in complete triangles', () => {
    for (let ci = 0; ci < 256; ci += 1) {
      const mask = EDGE_TABLE[ci] as number;
      const row: number[] = [];
      for (let i = 0; i < 16; i += 1) row.push(TRI_TABLE[ci * 16 + i] as number);
      const used = row.filter((v) => v !== -1);
      expect(used.length % 3).toBe(0);
      for (const e of used) {
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThan(12);
        expect(mask & (1 << e)).not.toBe(0);
      }
    }
  });
});

describe('marching cubes polygonize', () => {
  it('meshes a sphere SDF with vertices near the expected radius', () => {
    const radius = 10;
    const samples = sphereSamples(radius);
    const mesh = polygonize(samples, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1]);
    expect(mesh.empty).toBe(false);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    const center = CELLS / 2;
    const count = mesh.positions.length / 3;
    expect(count).toBeGreaterThan(100);
    for (let i = 0; i < count; i += 1) {
      const x = (mesh.positions[i * 3] as number) - center;
      const y = (mesh.positions[i * 3 + 1] as number) - center;
      const z = (mesh.positions[i * 3 + 2] as number) - center;
      const r = Math.sqrt(x * x + y * y + z * z);
      expect(Math.abs(r - radius)).toBeLessThan(1.5);
      const nx = mesh.normals[i * 3] as number;
      const ny = mesh.normals[i * 3 + 1] as number;
      const nz = mesh.normals[i * 3 + 2] as number;
      expect(Math.abs(Math.sqrt(nx * nx + ny * ny + nz * nz) - 1)).toBeLessThan(1e-6);
    }
  });

  it('reports empty for fully solid and fully air grids', () => {
    const solid = new Float32Array(SIZE * SIZE * SIZE).fill(1);
    expect(polygonize(solid, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1]).empty).toBe(true);
    const air = new Float32Array(SIZE * SIZE * SIZE).fill(-1);
    expect(polygonize(air, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1]).empty).toBe(true);
  });
});
