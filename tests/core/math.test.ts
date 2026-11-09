import { describe, expect, it } from 'vitest';
import {
  add,
  cross,
  distance,
  dot,
  length,
  lerp,
  normalize,
  quatFromAxisAngle,
  quatMultiply,
  rotateVector,
  scale,
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
});
