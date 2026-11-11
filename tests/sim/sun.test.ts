// M05 sun tests: period, daylight rule, sim depth formula, headlamp action.

import { describe, expect, it } from 'vitest';
import { DAY_LENGTH_S } from '../../src/core/constants.js';
import { dot, length } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import {
  depthBelowSurface,
  isDaylight,
  SUN_INITIAL,
  sunDirection,
  sunDirectionAt,
  timeOfDay,
  updateSun,
} from '../../src/sim/systems/sun.js';
import { createDensityField } from '../../src/terrain/density.js';

describe('sunDirectionAt', () => {
  it('starts at the morning initial direction and has unit length', () => {
    const d = sunDirectionAt(0);
    expect(length(d)).toBeCloseTo(1, 10);
    expect(d).toEqual(SUN_INITIAL);
  });

  it('completes one revolution per 12 minute day', () => {
    const a = sunDirectionAt(0);
    const b = sunDirectionAt(DAY_LENGTH_S);
    expect(dot(a, b)).toBeCloseTo(1, 10);
    // Quarter period: 90 degrees around the axis, not the same direction.
    const q = sunDirectionAt(DAY_LENGTH_S / 4);
    expect(length(q)).toBeCloseTo(1, 10);
    expect(dot(a, q)).toBeLessThan(0.99);
  });

  it('is deterministic for the same time', () => {
    expect(sunDirectionAt(123.456)).toEqual(sunDirectionAt(123.456));
  });
});

describe('updateSun + timeOfDay', () => {
  it('re-derives the stored direction from the clock each tick', () => {
    const world = new World(7);
    world.time = 100;
    updateSun(world);
    expect(world.sunDirection).toEqual(sunDirectionAt(100));
    expect(sunDirection(world)).toEqual(world.sunDirection);
    world.addSystem(updateSun);
    world.tick();
    expect(timeOfDay(world)).toBeCloseTo(world.time / DAY_LENGTH_S, 10);
  });

  it('wraps the fractional time of day past one full cycle', () => {
    const world = new World(7);
    world.time = DAY_LENGTH_S * 1.5;
    expect(timeOfDay(world)).toBeCloseTo(0.5, 10);
    world.time = DAY_LENGTH_S / 4;
    expect(timeOfDay(world)).toBeCloseTo(0.25, 10);
  });
});

describe('isDaylight', () => {
  it('is day when the sun is above the local horizon', () => {
    const world = new World(7);
    world.sunDirection = { x: 0, y: 1, z: 0 };
    expect(isDaylight(world, 'sela', { x: 0, y: 400, z: 0 })).toBe(true);
    expect(isDaylight(world, 'sela', { x: 0, y: -400, z: 0 })).toBe(false);
  });

  it('is night exactly at the horizon and at the planet center', () => {
    const world = new World(7);
    world.sunDirection = { x: 0, y: 1, z: 0 };
    expect(isDaylight(world, 'sela', { x: 400, y: 0, z: 0 })).toBe(false);
    expect(isDaylight(world, 'sela', { x: 0, y: 0, z: 0 })).toBe(false);
  });
});

describe('depthBelowSurface', () => {
  it('matches the base density field above ground (no carve there)', () => {
    const world = new World(1337);
    const field = createDensityField(SELA, world.seed);
    // At 30 m altitude every point is above the caves and far from the
    // core shell, so density == depth + surface relief == the sim formula.
    const dirs = [
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0.3, y: 0.9, z: 0.2 },
      { x: -0.5, y: 0.7, z: -0.4 },
    ];
    for (const dir of dirs) {
      const n = Math.hypot(dir.x, dir.y, dir.z);
      const local = { x: (dir.x / n) * (SELA.radius + 30), y: (dir.y / n) * (SELA.radius + 30), z: (dir.z / n) * (SELA.radius + 30) };
      expect(depthBelowSurface(world, SELA, local)).toBeCloseTo(
        field.density(local.x, local.y, local.z),
        10,
      );
    }
  });

  it('is negative above the surface and positive underground', () => {
    const world = new World(1337);
    const up = depthBelowSurface(world, SELA, { x: 0, y: SELA.radius + 30, z: 0 });
    const down = depthBelowSurface(world, SELA, { x: 0, y: SELA.radius - 30, z: 0 });
    expect(up).toBeLessThan(0);
    expect(down).toBeGreaterThan(0);
    // Must not see cave carving: |value| stays within relief amplitude.
    expect(Math.abs(up)).toBeLessThanOrEqual(45);
    expect(Math.abs(down)).toBeLessThanOrEqual(45);
  });
});

describe('toggleHeadlamp', () => {
  it('flips the player headlamp state (default on)', () => {
    const world = new World(9);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 410, z: 0 } });
    world.tick();
    const id = [...world.entities.keys()][0] as string;
    expect(world.entities.get(id)?.components.player?.headlampOn).toBe(true);
    world.dispatch({ type: 'toggleHeadlamp', playerId: id });
    world.tick();
    expect(world.entities.get(id)?.components.player?.headlampOn).toBe(false);
    world.dispatch({ type: 'toggleHeadlamp', playerId: id });
    world.tick();
    expect(world.entities.get(id)?.components.player?.headlampOn).toBe(true);
  });

  it('ignores unknown players', () => {
    const world = new World(9);
    world.dispatch({ type: 'toggleHeadlamp', playerId: 'player_missing' });
    world.tick();
    expect(world.entities.size).toBe(0);
  });
});
