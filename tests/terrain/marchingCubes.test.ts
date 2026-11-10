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

  it('emits positions relative to the chunk origin (colors get absolute coords)', () => {
    const radius = 10;
    const samples = sphereSamples(radius);
    const origin = { x: 1000, y: -500, z: 250 };
    const seen: Array<{ x: number; y: number; z: number }> = [];
    const mesh = polygonize(samples, origin, 2, (x, y, z) => {
      seen.push({ x, y, z });
      return [1, 1, 1];
    });
    expect(mesh.empty).toBe(false);
    // Relative: inside [0, 32 * cellSize] on every axis, not shifted by origin.
    for (let i = 0; i < mesh.positions.length; i += 1) {
      const v = mesh.positions[i] as number;
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(64 + 1e-6);
    }
    // Absolute: the color callback saw origin-shifted coordinates.
    expect(seen.length).toBeGreaterThan(0);
    const first = seen[0] as { x: number; y: number; z: number };
    expect(first.x).toBeGreaterThanOrEqual(origin.x);
    expect(first.y).toBeGreaterThanOrEqual(origin.y - 64 - 1);
  });

  it('winds triangles outward (geometric normal agrees with vertex normals)', () => {
    // One solid corner in the first cell: a single triangle whose front
    // face must point away from the solid corner, i.e. (+,+,+).
    const samples = new Float32Array(SIZE * SIZE * SIZE).fill(-1);
    samples[1 + SIZE * (1 + SIZE * 1)] = 1;
    const mesh = polygonize(samples, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1]);
    expect(mesh.indices.length).toBe(3);
    const at = (i: number): [number, number, number] => [
      mesh.positions[i * 3] as number,
      mesh.positions[i * 3 + 1] as number,
      mesh.positions[i * 3 + 2] as number,
    ];
    const [a, b, c] = [at(0), at(1), at(2)];
    const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    expect(n[0]).toBeGreaterThan(0);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[2]).toBeGreaterThan(0);
  });
});

describe('skirts', () => {
  // Half-space solid for x < 16 cells: the surface plane crosses the four
  // side boundary faces, so skirts must appear; the min/max-x faces are
  // fully solid/air and contribute none.
  function halfSpaceSamples(): Float32Array {
    const samples = new Float32Array(SIZE * SIZE * SIZE);
    for (let iz = 0; iz < SIZE; iz += 1) {
      for (let iy = 0; iy < SIZE; iy += 1) {
        for (let ix = 0; ix < SIZE; ix += 1) {
          samples[ix + SIZE * (iy + SIZE * iz)] = 16 - (ix - 1);
        }
      }
    }
    return samples;
  }

  it('adds boundary ribbons without breaking the base mesh', () => {
    const samples = halfSpaceSamples();
    const plain = polygonize(samples, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1]);
    const skirted = polygonize(samples, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1], {
      skirts: true,
    });
    expect(plain.empty).toBe(false);
    expect(skirted.empty).toBe(false);
    expect(skirted.indices.length).toBeGreaterThan(plain.indices.length);
    expect(skirted.indices.length % 3).toBe(0);
    // Every index addresses a real vertex.
    const verts = skirted.positions.length / 3;
    for (const index of skirted.indices) expect(index).toBeLessThan(verts);
    // Skirt verts hang at most one cellSize off the chunk: positions stay
    // within [-cellSize, 32 * cellSize + cellSize].
    for (const v of skirted.positions) {
      expect(v).toBeGreaterThanOrEqual(-1 - 1e-6);
      expect(v).toBeLessThanOrEqual(33 + 1e-6);
    }
  });

  it('keeps fully solid and fully air grids empty with skirts on', () => {
    const solid = new Float32Array(SIZE * SIZE * SIZE).fill(1);
    expect(
      polygonize(solid, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1], { skirts: true }).empty,
    ).toBe(true);
    const air = new Float32Array(SIZE * SIZE * SIZE).fill(-1);
    expect(
      polygonize(air, { x: 0, y: 0, z: 0 }, 1, () => [1, 1, 1], { skirts: true }).empty,
    ).toBe(true);
  });
});
