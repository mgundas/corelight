import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { DensityField } from '../../src/terrain/density.js';
import { raycastDensity } from '../../src/terrain/raycast.js';

const plane: DensityField = { config: SELA, density: (_x, y) => -y, caveThresholdAt: () => 0 };
const down = { x: 0, y: -1, z: 0 };

describe('density terrain ray', () => {
  it('finds a crossing within a fractional final step and respects the distance limit', () => {
    const origin = { x: 0, y: 1.13, z: 0 };
    expect(raycastDensity(plane, origin, down, 1.13)).toBeCloseTo(1.13);
    expect(raycastDensity(plane, origin, down, 1.12)).toBeNull();
  });
  it('reports an embedded origin immediately', () => {
    expect(raycastDensity(plane, { x: 0, y: -1, z: 0 }, down, 10)).toBe(0);
  });
  it('returns no hit for an empty zero-length ray', () => {
    expect(raycastDensity(plane, { x: 0, y: 1, z: 0 }, down, 0)).toBeNull();
  });
});
