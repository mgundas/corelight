import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { createDensityField } from '../../src/terrain/density.js';
import { polygonize } from '../../src/terrain/marchingCubes.js';
import { sampleGrid } from '../../src/terrain/sampleGrid.js';

describe('terrain boundary normals', () => {
  it('keeps positions and gradient normals identical across neighboring surface chunks', () => {
    const field = createDensityField(SELA, 1337);
    function boundary(x: number) {
      const { samples, origin } = sampleGrid(field, SELA, 0, { x, y: 28, z: 16 }, 1);
      const mesh = polygonize(samples, origin, 1, () => [1, 1, 1]);
      const result = new Map<string, number[]>();
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const worldX = mesh.positions[i]! + origin.x;
        if (Math.abs(worldX) > 1e-6) continue;
        const y = mesh.positions[i + 1]! + origin.y;
        const z = mesh.positions[i + 2]! + origin.z;
        result.set(`${y.toFixed(5)}:${z.toFixed(5)}`, Array.from(mesh.normals.slice(i, i + 3)));
      }
      return result;
    }
    const left = boundary(15);
    const right = boundary(16);
    expect(left.size).toBeGreaterThan(0);
    expect(left.size).toBe(right.size);
    for (const [key, normal] of left) {
      expect(right.has(key)).toBe(true);
      const other = right.get(key)!;
      for (let axis = 0; axis < 3; axis += 1) expect(other[axis]).toBeCloseTo(normal[axis]!, 6);
    }
  });
});
