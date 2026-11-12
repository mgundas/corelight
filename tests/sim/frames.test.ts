import { describe, expect, it } from 'vitest';
import { dot, length, normalize, rotateVector, vec3 } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import {
  moveBasis,
  orientationForUpYaw,
  toLocalFrame,
  toWorldFrame,
  upAt,
} from '../../src/sim/physics/frames.js';

describe('moveBasis', () => {
  it('keeps the default heading continuous around a full polar great circle', () => {
    let previous = moveBasis(vec3(0, 1, 0), 0, 0);
    for (let i = 1; i <= 720; i += 1) {
      const angle = i * Math.PI / 360;
      const up = vec3(Math.sin(angle), Math.cos(angle), 0);
      const current = moveBasis(up, 0, 0);
      expect(dot(previous.forward, current.forward)).toBeGreaterThan(0.999);
      expect(dot(previous.right, current.right)).toBeGreaterThan(0.999);
      expect(dot(current.forward, up)).toBeCloseTo(0, 6);
      previous = current;
    }
  });

  it('keeps forward/right continuous across the former pole reference-axis boundary', () => {
    // The report's (52.2, 391.1, 17.9) lies just inside this latitude.
    for (const y of [391.1, -391.1]) {
      for (const z of [0, 17.9, -17.9]) {
        const x = Math.sqrt(y * y * (1 / 0.99 ** 2 - 1) - z * z);
        const before = normalize(vec3(x - 0.01, y, z));
        const after = normalize(vec3(x + 0.01, y, z));
        for (const yaw of [0, 0.7, 2]) {
          const a = moveBasis(before, yaw, 0.2);
          const b = moveBasis(after, yaw, 0.2);
          expect(dot(a.forward, b.forward)).toBeGreaterThan(0.999);
          expect(dot(a.right, b.right)).toBeGreaterThan(0.999);
        }
      }
    }
  });

  it('produces an orthonormal aim frame with pitch', () => {
    const up = vec3(0, 1, 0);
    const { forward, right } = moveBasis(up, 0.7, 0.3);
    expect(length(forward)).toBeCloseTo(1, 6);
    expect(length(right)).toBeCloseTo(1, 6);
    expect(dot(forward, right)).toBeCloseTo(0, 6);
    // Positive pitch looks up.
    expect(dot(forward, up)).toBeCloseTo(Math.sin(0.3), 6);
  });

  it('yaw = 0 faces north, yaw turns right', () => {
    const up = vec3(0, 1, 0);
    const f0 = moveBasis(up, 0, 0).forward;
    const f90 = moveBasis(up, Math.PI / 2, 0).forward;
    // Facing differs by 90 degrees around up.
    expect(dot(f0, f90)).toBeCloseTo(0, 5);
    // Right-hand rule: right = forward x up stays tangent.
    const { right } = moveBasis(up, 0, 0);
    expect(dot(right, up)).toBeCloseTo(0, 6);
  });

  it('stays tangent on the side of the planet', () => {
    const up = normalize(vec3(1, 0.2, 0));
    const { forward, right } = moveBasis(up, 1.1, -0.2);
    expect(dot(forward, forward)).toBeCloseTo(1, 6);
    expect(dot(right, up)).toBeCloseTo(0, 6);
  });
});

describe('orientationForUpYaw', () => {
  it('faces the model along movement at poles, equator and tilted ground for every heading', () => {
    const normals = [vec3(0, 1, 0), vec3(0, -1, 0), vec3(1, 0, 0), vec3(0, 0, -1), normalize(vec3(0.3, 1, -0.2))];
    for (const up of normals) {
      for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.73]) {
        const q = orientationForUpYaw(up, yaw);
        const facing = rotateVector(vec3(0, 0, 1), q);
        const expected = moveBasis(up, yaw, 0).forward;
        expect(facing.x).toBeCloseTo(expected.x, 6);
        expect(facing.y).toBeCloseTo(expected.y, 6);
        expect(facing.z).toBeCloseTo(expected.z, 6);
        const actualUp = rotateVector(vec3(0, 1, 0), q);
        expect(dot(actualUp, up)).toBeCloseTo(1, 6);
      }
    }
  });

  it('maps local +Y onto up', () => {
    const up = normalize(vec3(0.3, 1, -0.2));
    const q = orientationForUpYaw(up, 0.9);
    const mapped = rotateVector(vec3(0, 1, 0), q);
    expect(mapped.x).toBeCloseTo(up.x, 5);
    expect(mapped.y).toBeCloseTo(up.y, 5);
    expect(mapped.z).toBeCloseTo(up.z, 5);
  });
});

describe('planet frames', () => {
  it('round-trips world and local coordinates', () => {
    const moved = { ...SELA, center: { x: 12000, y: 1500, z: 4000 } };
    const local = toLocalFrame(moved, { x: 12001, y: 1500, z: 4000 });
    expect(local).toEqual({ x: 1, y: 0, z: 0 });
    expect(toWorldFrame(moved, local)).toEqual({ x: 12001, y: 1500, z: 4000 });
  });

  it('points up away from the center at poles, equator, and antipode', () => {
    expect(upAt(SELA, { x: 0, y: SELA.radius, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
    expect(upAt(SELA, { x: 0, y: -SELA.radius, z: 0 })).toEqual({ x: 0, y: -1, z: 0 });
    const equator = upAt(SELA, { x: SELA.radius, y: 0, z: 0 });
    expect(equator.x).toBeCloseTo(1, 6);
    expect(equator.y).toBeCloseTo(0, 6);
    expect(equator.z).toBeCloseTo(0, 6);
  });

  it('has a defined fallback at the exact center', () => {
    expect(length(upAt(SELA, { x: 0, y: 0, z: 0 }))).toBeCloseTo(1, 6);
  });
});
