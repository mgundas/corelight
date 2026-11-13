import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { dot, length, normalize, scale } from '../../src/core/math.js';
import { easeUp, integrateShuttleVelocity, shuttleForward } from '../../src/sim/shuttle.js';
import { shuttleHeadingFor, steerShuttleVelocity } from '../../src/sim/shuttleSteering.js';

const up = { x: 0, y: 1, z: 0 };
const forward = { x: 1, y: 0, z: 0 };

describe('manual shuttle steering', () => {
  it.each([{ x: 0, y: 600, z: 0 }, { x: -600, y: 0, z: 0 }, { x: 0, y: 0, z: 600 }])('redirects cruise drift toward the pilot heading from %j', (start) => {
    let velocity = start;
    for (let i = 0; i < 60; i++) velocity = steerShuttleVelocity(velocity, forward, up, 1, false, SIM_DT);
    expect(dot(normalize(velocity), forward)).toBeGreaterThan(0.999);
    expect(length(velocity)).toBeCloseTo(600);
  });
  it('brakes promptly with S and still permits reverse thrust', () => {
    let velocity = scale(forward, 600);
    const zero = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60; i++) {
      velocity = steerShuttleVelocity(velocity, forward, up, -1, false, SIM_DT);
      velocity = integrateShuttleVelocity(velocity, zero, forward, up, -30, 0, SIM_DT);
    }
    expect(length(velocity)).toBeLessThan(15);
    expect(dot(velocity, forward)).toBeLessThan(0);
  });
  it('preserves free coast and independent Space climb', () => {
    const climb = { x: 0, y: 100, z: 20 };
    expect(steerShuttleVelocity(climb, forward, up, 0, false, SIM_DT)).toEqual(climb);
    expect(steerShuttleVelocity(climb, forward, up, 1, true, SIM_DT).y).toBeCloseTo(100);
  });
  it('keeps a world heading unchanged while planetary up rotates', () => {
    const desired = normalize({ x: 1, y: 3, z: -2 });
    let changingUp = up;
    for (let i = 0; i < 120; i++) {
      changingUp = easeUp(changingUp, { x: 0, y: -1, z: 0 }, 3, SIM_DT);
      const heading = shuttleHeadingFor(changingUp, desired);
      expect(dot(shuttleForward(changingUp, heading.yaw, heading.pitch), desired)).toBeGreaterThan(0.999999);
    }
  });
  it.each([up, { x: 0, y: -1, z: 0 }])('can point directly along a vertical destination %j', (desired) => {
    const heading = shuttleHeadingFor(up, desired, 0.7);
    expect(dot(shuttleForward(up, heading.yaw, heading.pitch), desired)).toBeGreaterThan(0.999999);
  });
});
