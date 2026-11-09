// Density field tests: determinism, sign conventions, core carving, layers.
// WHY: the same seed must always build the same planet (saves, co-op).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { createDensityFn, layerAt } from '../../src/terrain/density.js';

describe('density', () => {
  it('is deterministic for the same seed', () => {
    const a = createDensityFn(SELA, 1337);
    const b = createDensityFn(SELA, 1337);
    const points = [
      [0, 400, 0],
      [100, 350, -50],
      [0, 0, 200],
      [0, 43, 0],
      [250, -250, 100],
    ] as const;
    for (const [x, y, z] of points) {
      expect(a(x, y, z)).toBe(b(x, y, z));
    }
  });

  it('differs for different world seeds', () => {
    const a = createDensityFn(SELA, 1337);
    const b = createDensityFn(SELA, 4242);
    // Surface relief is seeded: at least one probe point must differ.
    const points = [
      [0, 400, 0],
      [300, 200, 100],
      [-150, -350, 80],
      [50, 390, -30],
    ] as const;
    const same = points.every(([x, y, z]) => a(x, y, z) === b(x, y, z));
    expect(same).toBe(false);
  });

  it('is negative far above the surface', () => {
    const density = createDensityFn(SELA, 1337);
    expect(density(0, SELA.radius + 100, 0)).toBeLessThan(0);
  });

  it('is negative at the planet center (hollow core chamber)', () => {
    const density = createDensityFn(SELA, 1337);
    expect(density(0, 0, 0)).toBeLessThan(0);
  });

  it('is positive in the core shell', () => {
    const density = createDensityFn(SELA, 1337);
    const r = SELA.core.chamberRadius + SELA.core.shellThickness / 2;
    expect(density(0, r, 0)).toBeGreaterThan(0);
  });

  it('maps depth to layers', () => {
    // Points on +Y: depth = radius - r.
    expect(layerAt(SELA, 0, SELA.radius - 10, 0).name).toBe('surface');
    expect(layerAt(SELA, 0, SELA.radius - 80, 0).name).toBe('crust');
    expect(layerAt(SELA, 0, SELA.radius - 200, 0).name).toBe('mantle');
  });

  it('maps the core shell and chamber to pseudo-layers', () => {
    const rShell = SELA.core.chamberRadius + SELA.core.shellThickness / 2;
    const shell = layerAt(SELA, 0, rShell, 0);
    expect(shell.kind).toBe('core_shell');
    expect(shell.hardness).toBe(SELA.core.shellHardness);
    const chamber = layerAt(SELA, 0, 0, 0);
    expect(chamber.kind).toBe('core_chamber');
  });
});
