// M05 lighting math tests: sun color/intensity, depth-scaled ambient,
// texel-snapped shadow target (all pure, no WebGL needed).

import { describe, expect, it } from 'vitest';
import {
  ambientForDepth,
  hemisphereBaseForElevation,
  shadowTexelSize,
  snapTargetToTexel,
  sunColorForElevation,
  sunIntensityForElevation,
} from '../../src/render/lighting.js';
import { dot, normalize } from '../../src/core/math.js';
import { AMBIENT_DEEP, AMBIENT_SURFACE, SUN_NIGHT_FLOOR } from '../../src/core/constants.js';

describe('sunColorForElevation', () => {
  it('is warm at the horizon and white at noon', () => {
    const horizon = sunColorForElevation(0);
    expect(horizon[0]).toBeCloseTo(1, 10);
    expect(horizon[1]).toBeCloseTo(0.55, 10);
    expect(horizon[2]).toBeCloseTo(0.28, 10);
    const noon = sunColorForElevation(1);
    expect(noon[0]).toBeCloseTo(1, 10);
    expect(noon[1]).toBeCloseTo(0.98, 10);
    expect(noon[2]).toBeCloseTo(0.94, 10);
  });

  it('blends smoothly between (no banding steps)', () => {
    let prev = sunColorForElevation(-0.2);
    for (let e = -0.1; e <= 1.01; e += 0.05) {
      const c = sunColorForElevation(e);
      const step = Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1]) + Math.abs(c[2] - prev[2]);
      expect(step).toBeLessThan(0.25);
      prev = c;
    }
  });
});

describe('sunIntensityForElevation', () => {
  it('keeps a night floor so the shared sun lights the far planet', () => {
    const night = sunIntensityForElevation(-1);
    expect(night).toBeCloseTo(2.2 * SUN_NIGHT_FLOOR, 10);
    expect(night).toBeGreaterThan(0);
    expect(sunIntensityForElevation(1)).toBeCloseTo(2.2, 10);
    const mid = sunIntensityForElevation(0);
    expect(mid).toBeGreaterThan(night);
    expect(mid).toBeLessThan(2.2);
  });
});

describe('ambientForDepth', () => {
  it('is full at the surface and floored deep down', () => {
    expect(ambientForDepth(0)).toBe(AMBIENT_SURFACE);
    expect(ambientForDepth(-10)).toBe(AMBIENT_SURFACE);
    expect(ambientForDepth(25)).toBeCloseTo(AMBIENT_DEEP, 10);
    expect(ambientForDepth(200)).toBeCloseTo(AMBIENT_DEEP, 10);
  });

  it('ramps smoothly so caves darken gradually', () => {
    const mid = ambientForDepth(12.5);
    expect(mid).toBeGreaterThan(AMBIENT_DEEP);
    expect(mid).toBeLessThan(AMBIENT_SURFACE);
  });
});

describe('hemisphereBaseForElevation', () => {
  it('keeps a dim floor at night and full fill by day', () => {
    expect(hemisphereBaseForElevation(-1)).toBeCloseTo(0.06, 10);
    expect(hemisphereBaseForElevation(1)).toBeCloseTo(0.76, 10);
  });
});

describe('snapTargetToTexel', () => {
  it('snaps lateral components to the texel grid (no shimmer)', () => {
    const texel = shadowTexelSize();
    const sunDir = normalize({ x: 0.5, y: 0.8, z: 0.2 });
    const target = { x: 123.456, y: 407.789, z: -55.123 };
    const snapped = snapTargetToTexel(target, sunDir, texel);
    // Stays within one texel of the original point.
    const dx = snapped.x - target.x;
    const dy = snapped.y - target.y;
    const dz = snapped.z - target.z;
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeLessThanOrEqual(texel);
    // Idempotent: snapping twice changes nothing.
    expect(snapTargetToTexel(snapped, sunDir, texel)).toEqual(snapped);
  });

  it('preserves the range along the sun direction', () => {
    const texel = shadowTexelSize();
    const sunDir = normalize({ x: 0.2, y: 1, z: 0.1 });
    const target = { x: 10.3, y: 410.7, z: -4.2 };
    const snapped = snapTargetToTexel(target, sunDir, texel);
    expect(dot(snapped, sunDir)).toBeCloseTo(dot(target, sunDir), 10);
  });
});
