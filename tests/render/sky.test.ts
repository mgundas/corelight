// M05 sky palette tests: day/sunset/night/space blends, cave fog, stars.

import { describe, expect, it } from 'vitest';
import { FOG_CAVE_DENSITY, FOG_SURFACE_DENSITY } from '../../src/core/constants.js';
import { skyStateFor } from '../../src/render/sky.js';

const DAY: [number, number, number] = [0.47, 0.65, 0.92];

describe('skyStateFor', () => {
  it('shows the day color at noon on the surface', () => {
    const s = skyStateFor(1, 0, 0, DAY);
    expect(s.bg[0]).toBeCloseTo(DAY[0] as number, 2);
    expect(s.bg[1]).toBeCloseTo(DAY[1] as number, 2);
    expect(s.bg[2]).toBeCloseTo(DAY[2] as number, 2);
    expect(s.stars).toBe(0);
    expect(s.fogDensity).toBeCloseTo(FOG_SURFACE_DENSITY, 6);
  });

  it('is dark blue at night with stars out', () => {
    const s = skyStateFor(-1, 0, 0, DAY);
    expect(s.bg[0]).toBeLessThan(0.05);
    expect(s.bg[1]).toBeLessThan(0.05);
    expect(s.bg[2]).toBeLessThan(0.1);
    expect(s.stars).toBe(1);
  });

  it('glows sunset orange at the horizon', () => {
    const s = skyStateFor(0, 0, 0, DAY);
    expect(s.bg[0]).toBeGreaterThan(0.5);
    expect(s.bg[0]).toBeGreaterThan(s.bg[2]);
  });

  it('fades to black with stars in space', () => {
    const s = skyStateFor(1, 10000, -10000, DAY);
    expect(s.bg[0]).toBeCloseTo(0, 6);
    expect(s.bg[1]).toBeCloseTo(0, 6);
    expect(s.bg[2]).toBeCloseTo(0, 6);
    expect(s.stars).toBe(1);
    expect(s.fogDensity).toBeCloseTo(0, 6);
  });

  it('makes cave fog darker and denser with depth', () => {
    const surface = skyStateFor(1, 0, 0, DAY);
    const deep = skyStateFor(1, 0, 100, DAY);
    expect(deep.fogDensity).toBeCloseTo(FOG_CAVE_DENSITY, 6);
    expect(deep.fogDensity).toBeGreaterThan(surface.fogDensity);
    const brightness = (c: readonly number[]): number =>
      (c[0] as number) + (c[1] as number) + (c[2] as number);
    expect(brightness(deep.fogColor)).toBeLessThan(brightness(surface.fogColor));
  });

  it('transitions smoothly (no visible pops between keyframes)', () => {
    let prev = skyStateFor(-1, 0, 0, DAY).bg;
    for (let e = -0.99; e <= 1.001; e += 0.01) {
      const bg = skyStateFor(e, 0, 0, DAY).bg;
      const step = Math.abs(bg[0] - prev[0]) + Math.abs(bg[1] - prev[1]) + Math.abs(bg[2] - prev[2]);
      // Per-frame elevation moves ~1e-4 of this probe step: anything under
      // ~0.1 here is far below one display quantum per frame.
      expect(step).toBeLessThan(0.12);
      prev = bg;
    }
  });
});
