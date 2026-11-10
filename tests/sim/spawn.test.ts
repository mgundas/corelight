import { describe, expect, it } from 'vitest';
import { SPAWN_HOVER_M } from '../../src/core/constants.js';
import { length, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { createDensityField } from '../../src/terrain/density.js';

describe('findSpawnPosition', () => {
  it('is deterministic for the same seed', () => {
    expect(findSpawnPosition(SELA, 1337)).toEqual(findSpawnPosition(SELA, 1337));
  });

  it('hovers just above the surface', () => {
    const spawn = findSpawnPosition(SELA, 1337);
    const field = createDensityField(SELA, 1337);
    const local = sub(spawn, SELA.center);
    // In the air...
    expect(field.density(local.x, local.y, local.z)).toBeLessThan(0);
    // ...but close to the ground (hover + relief margin).
    expect(length(local)).toBeGreaterThan(SELA.radius - 25);
    expect(length(local)).toBeLessThan(SELA.radius + SPAWN_HOVER_M + 25);
  });
});
