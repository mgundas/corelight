import { describe, expect, it } from 'vitest';
import {
  add,
  clampScalar,
  cross,
  distance,
  dot,
  length,
  lerp,
  normalize,
  quatFromAxisAngle,
  quatFromTo,
  quatMultiply,
  rotateVector,
  scale,
  smoothstep,
  sub,
  vec3,
  IDENTITY_QUAT,
} from '../../src/core/math.js';

describe('vec3 math', () => {
  it('adds and subtracts', () => {
    expect(add(vec3(1, 2, 3), vec3(4, -1, 0))).toEqual({ x: 5, y: 1, z: 3 });
    expect(sub(vec3(1, 2, 3), vec3(1, 2, 3))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('scales, lengths, normalizes', () => {
    expect(scale(vec3(1, 2, 3), 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(length(vec3(3, 4, 0))).toBeCloseTo(5);
    expect(length(normalize(vec3(3, 4, 0)))).toBeCloseTo(1);
    expect(normalize(vec3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('dots, crosses, distances, lerps', () => {
    expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    expect(distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBeCloseTo(5);
    expect(lerp(vec3(0, 0, 0), vec3(10, 0, 0), 0.5)).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('rotates vectors with quaternions', () => {
    // 90 degrees about +Y maps +X to -Z.
    const q = quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const r = rotateVector(vec3(1, 0, 0), q);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(-1, 5);
    // Identity quaternion leaves vectors unchanged.
    expect(rotateVector(vec3(1, 2, 3), IDENTITY_QUAT)).toEqual({ x: 1, y: 2, z: 3 });
    // q * identity = q.
    expect(quatMultiply(q, IDENTITY_QUAT)).toEqual(q);
  });

  it('clamps and smoothsteps scalars', () => {
    expect(clampScalar(5, 0, 3)).toBe(3);
    expect(clampScalar(-1, 0, 3)).toBe(0);
    expect(clampScalar(2, 0, 3)).toBe(2);
    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 11)).toBe(1);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(0, 10, 2.5)).toBeCloseTo(0.15625, 6);
  });

  it('quatFromTo aligns unit vectors (incl. degenerate cases)', () => {
    const r = rotateVector(vec3(0, 1, 0), quatFromTo(vec3(0, 1, 0), vec3(0, 0, 1)));
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(1, 5);
    // Identity case.
    expect(quatFromTo(vec3(0, 1, 0), vec3(0, 1, 0))).toEqual(IDENTITY_QUAT);
    // Antiparallel case maps +Y to -Y.
    const flip = rotateVector(vec3(0, 1, 0), quatFromTo(vec3(0, 1, 0), vec3(0, -1, 0)));
    expect(flip.x).toBeCloseTo(0, 5);
    expect(flip.y).toBeCloseTo(-1, 5);
    expect(flip.z).toBeCloseTo(0, 5);
  });
});
