// Cave wall tessellation: walls must mesh as clean quads, not slivers.
// (Seed-1337 probe: the conditional carve put 64% of a cave chunk's
// triangles under 5 cm min-edge; the unconditional ARCH-formula carve
// brings that down to the single digits, near the surface baseline.)

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { createDensityField } from '../../src/terrain/density.js';
import { polygonize } from '../../src/terrain/marchingCubes.js';
import { sampleGrid } from '../../src/terrain/sampleGrid.js';
import { cellSizeForLevel } from '../../src/terrain/chunkKey.js';

describe('cave wall tessellation', () => {
  it('keeps sliver triangles rare in a seeded cave chunk', () => {
    const field = createDensityField(SELA, 1337);
    const size = cellSizeForLevel(0);
    const { samples, origin } = sampleGrid(field, SELA, 0, { x: 10, y: 22, z: 10 }, size);
    const mesh = polygonize(samples, origin, size, () => [1, 1, 1]);
    expect(mesh.empty).toBe(false);
    const pos = mesh.positions;
    const idx = mesh.indices;
    const total = idx.length / 3;
    expect(total).toBeGreaterThan(100);
    let slivers = 0;
    for (let t = 0; t < idx.length; t += 3) {
      let minEdge = Infinity;
      for (let e = 0; e < 3; e += 1) {
        const a = (idx[t + e] as number) * 3;
        const b = (idx[t + ((e + 1) % 3)] as number) * 3;
        const dx = (pos[a] as number) - (pos[b] as number);
        const dy = (pos[a + 1] as number) - (pos[b + 1] as number);
        const dz = (pos[a + 2] as number) - (pos[b + 2] as number);
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < minEdge) minEdge = len;
      }
      if (minEdge < 0.05) slivers += 1;
    }
    // Healthy marching-cubes output has a single-digit sliver share
    // (the surface baseline is ~3%); shredded walls read 60%+.
    expect(slivers / total).toBeLessThan(0.15);
  });
});
