import { describe, expect, it } from 'vitest';
import { ORIGIN_SHIFT_DISTANCE } from '../../src/core/constants.js';
import {
  getOrigin,
  maybeShiftOrigin,
  resetOrigin,
  toLocal,
} from '../../src/render/floatingOrigin.js';

describe('floating origin', () => {
  it('does not shift within range', () => {
    resetOrigin();
    const shift = maybeShiftOrigin({ x: ORIGIN_SHIFT_DISTANCE - 1, y: 0, z: 0 });
    expect(shift).toBeNull();
    expect(getOrigin()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('shifts to the camera position (snapped) beyond 1000 m', () => {
    resetOrigin();
    const shift = maybeShiftOrigin({ x: 1500, y: 0, z: 0 });
    expect(shift).not.toBeNull();
    const origin = getOrigin();
    // Rounded to 32 m chunks: 1500 -> 1504.
    expect(origin).toEqual({ x: 1504, y: 0, z: 0 });
    // Local coords stay consistent: world - origin.
    expect(toLocal({ x: 1500, y: 10, z: 0 })).toEqual({ x: -4, y: 10, z: 0 });
  });
});
