// computeAim tests: collider hits, idle vs detailed paths, the fallback
// density march, and the buried-camera case. Fields and rays are stubbed.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { TOOL_RANGE_M } from '../../src/core/constants.js';
import { computeAim, aimFromOrbitCamera, surfaceNormal, type AimInput } from '../../src/player/toolAim.js';

function base(input: Partial<AimInput>): AimInput {
  return {
    origin: { x: 0, y: 0, z: 0 },
    viewDir: { x: 1, y: 0, z: 0 },
    planet: SELA,
    field: { config: SELA, density: () => -10, caveThresholdAt: () => 0 },
    castRay: () => null,
    detailed: true,
    ...input,
  };
}

describe('computeAim', () => {
  it('takes the collider hit and skips the normal when idle', () => {
    const aim = computeAim(
      base({ castRay: () => 3, detailed: false }),
    );
    expect(aim.hit).toEqual({ x: 3, y: 0, z: 0 });
    expect(aim.normal).toBeNull();
    expect(aim.planet?.id).toBe('sela');
  });

  it('computes the surface normal when detailed', () => {
    const aim = computeAim(
      base({ castRay: () => 3, detailed: true, field: { config: SELA, density: (x) => x - 3, caveThresholdAt: () => 0 } }),
    );
    expect(aim.hit?.x).toBeCloseTo(3);
    // Density grows along +x: outward normal points -x.
    expect(aim.normal?.x).toBeCloseTo(-1);
  });

  it('skips the fallback march when idle and colliders miss', () => {
    let evals = 0;
    const aim = computeAim(
      base({
        castRay: () => null,
        detailed: false,
        field: {
          config: SELA,
          density: () => {
            evals += 1;
            return -10;
          },
          caveThresholdAt: () => 0,
        },
      }),
    );
    expect(aim.hit).toBeNull();
    expect(evals).toBe(0);
  });

  it('marches to the surface when detailed and colliders miss', () => {
    const aim = computeAim(
      base({
        castRay: () => null,
        detailed: true,
        field: { config: SELA, density: (x) => x - 4, caveThresholdAt: () => 0 },
      }),
    );
    // Center (0,0,0) is SELA's center here; density x - 4 hits zero at x = 4.
    expect(aim.hit?.x).toBeCloseTo(4, 1);
    expect(aim.normal?.x).toBeCloseTo(-1);
  });

  it('reports t = 0 when the camera starts inside rock', () => {
    const aim = computeAim(
      base({
        castRay: () => null,
        detailed: true,
        field: { config: SELA, density: () => 2, caveThresholdAt: () => 0 },
      }),
    );
    expect(aim.hit).toEqual({ x: 0, y: 0, z: 0 });
    expect(aim.normal).not.toBeNull();
  });

  it('reaches the ground at the feet even when zoomed far out', () => {
    // Keep camera distance beyond the current tool budget: measuring reach
    // from the camera must not consume the astronaut's digging distance.
    const head = { x: 0, y: 1.5, z: 0 };
    const cam = { x: 0, y: 5, z: -(TOOL_RANGE_M + 2) };
    const { origin, dir } = aimFromOrbitCamera(head, cam);
    expect(origin).toEqual(head);
    // Thin solid slab at y in [-0.5, 0], air elsewhere: both origins
    // start in air, but only the head ray reaches the slab within budget.
    const field = {
      config: SELA,
      density: (_x: number, y: number) => Math.min(y + 0.5, -y),
      caveThresholdAt: () => 0,
    };
    const aim = computeAim({ origin, viewDir: dir, planet: SELA, field, castRay: () => null, detailed: true });
    expect(aim.hit).not.toBeNull();
    // Sanity: from the camera the same ray cannot reach (the old behavior).
    const old = computeAim({ origin: cam, viewDir: dir, planet: SELA, field, castRay: () => null, detailed: true });
    expect(old.hit).toBeNull();
  });

  it('returns no aim for a zero direction or a beyond-range hit', () => {
    expect(computeAim(base({ viewDir: { x: 0, y: 0, z: 0 } })).hit).toBeNull();
    expect(computeAim(base({ castRay: () => TOOL_RANGE_M + 1 })).hit).toBeNull();
  });

  it('surfaceNormal falls back to up when the gradient vanishes', () => {
    const n = surfaceNormal(
      { config: SELA, density: () => 1, caveThresholdAt: () => 0 },
      SELA,
      { x: 0, y: 410, z: 0 },
    );
    expect(n.y).toBeCloseTo(1);
  });
});
