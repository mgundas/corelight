// Cave wall tessellation: zero-crossings must sit mid-cell so marching
// cubes emits well-shaped quads, not sliver caps hugging grid points.
// (Seed-1337 probe: the conditional carve put 279/279 wall crossings at
// t < 0.1 or t > 0.9, i.e. every wall vertex within 10 cm of a sample.)

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { createDensityField } from '../../src/terrain/density.js';
import { sampleGrid } from '../../src/terrain/sampleGrid.js';
import { cellSizeForLevel } from '../../src/terrain/chunkKey.js';

describe('cave wall crossings', () => {
  it('sit mid-cell on worm walls, not hugging grid points', () => {
    const field = createDensityField(SELA, 1337);
    const size = cellSizeForLevel(0);
    const { samples } = sampleGrid(field, SELA, 0, { x: 10, y: 22, z: 10 }, size);
    const S = 35;
    const at = (ix: number, iy: number, iz: number): number =>
      samples[ix + S * (iy + S * iz)] as number;
    let extreme = 0;
    let total = 0;
    for (let iz = 1; iz <= 33; iz += 1) {
      for (let iy = 1; iy <= 33; iy += 1) {
        for (let ix = 1; ix <= 33; ix += 1) {
          const v0 = at(ix, iy, iz);
          const v1 = at(ix + 1, iy, iz);
          if ((v0 > 0) !== (v1 > 0)) {
            const t = (0 - v0) / (v1 - v0);
            total += 1;
            if (t < 0.1 || t > 0.9) extreme += 1;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    // Well-formed walls: crossings spread across the cell, not all pinned
    // to its corners.
    expect(extreme / total).toBeLessThan(0.25);
  });
});
