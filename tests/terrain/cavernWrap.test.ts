// Cavern wrap continuity (#7): the room term must not jump at floor
// boundaries. u resets at every wrap while the mask/anchor noise is
// per-floor, so the raw term jumps (phantom ceilings). The guard pinches
// rooms shut there, so radial rays stay gradient-bounded across wraps.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { cavernStack, createDensityField } from '../../src/terrain/density.js';
import { createRng } from '../../src/core/rng.js';

describe('cavern wrap continuity', () => {
  it('has no large radial jumps at floor boundaries', () => {
    const field = createDensityField(SELA, 1337);
    const stack = cavernStack(SELA);
    const rng = createRng('wrap-probe');
    // Step well below the mesh cell so a jump reads as a spike, not a slope:
    // continuous ground changes ~gradient (<= ~10/m near caves) x step; the
    // old seam jumped up to 17 with 107 sign changes on this probe shape.
    const step = 0.1;
    const maxJump = 1.0;
    let rays = 0;
    let samples = 0;
    for (let ray = 0; ray < 40; ray += 1) {
      const theta = rng() * Math.PI * 2;
      const z = rng() * 2 - 1;
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      const dir = { x: s * Math.cos(theta), y: s * Math.sin(theta), z };
      for (let floor = 0; floor < stack.count; floor += 1) {
        const wrapDepth = stack.start + floor * stack.pitch;
        // Straddle the wrap plane +-2 m (inside the guard on both sides).
        for (let off = -2; off < 2; off += step) {
          const depth = wrapDepth + off;
          const r0 = SELA.radius - depth;
          const r1 = SELA.radius - (depth + step);
          if (r0 <= 0 || r1 <= 0) continue;
          const d0 = field.density(dir.x * r0, dir.y * r0, dir.z * r0);
          const d1 = field.density(dir.x * r1, dir.y * r1, dir.z * r1);
          expect(Math.abs(d1 - d0)).toBeLessThan(maxJump);
          samples += 1;
        }
      }
      rays += 1;
    }
    expect(rays).toBe(40);
    expect(samples).toBeGreaterThan(1000);
  });
});
