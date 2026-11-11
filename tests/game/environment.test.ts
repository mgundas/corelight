// M05 review fixes: environment assembly tests (nearestPlanet guard,
// findFollowed, computeEnvironment focus/camera split) plus an offset-planet
// daylight check pinning translation invariance for Vorn (M13).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { isDaylight } from '../../src/sim/systems/sun.js';
import {
  computeEnvironment,
  findFollowed,
  nearestPlanet,
} from '../../src/game/environment.js';

describe('nearestPlanet', () => {
  it('picks the closest planet', () => {
    const far = { ...SELA, id: 'far', center: { x: 10000, y: 0, z: 0 } };
    expect(nearestPlanet([SELA, far], { x: 0, y: 410, z: 0 }).id).toBe('sela');
    expect(nearestPlanet([SELA, far], { x: 9900, y: 0, z: 0 }).id).toBe('far');
  });

  it('throws on an empty array instead of returning undefined', () => {
    expect(() => nearestPlanet([], { x: 0, y: 0, z: 0 })).toThrow();
  });
});

describe('findFollowed', () => {
  it('returns null with no player', () => {
    const world = new World(3);
    expect(findFollowed(world, [SELA], null)).toBe(null);
    expect(findFollowed(world, [SELA], 'player_missing')).toBe(null);
  });

  it('resolves the player planet, falling back to nearest in space', () => {
    const world = new World(3);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 410, z: 0 } });
    world.tick();
    const id = [...world.entities.keys()][0] as string;
    const followed = findFollowed(world, [SELA], id);
    expect(followed?.planet.id).toBe('sela');
    expect(followed?.position).toEqual({ x: 0, y: 410, z: 0 });
  });
});

describe('computeEnvironment', () => {
  it('splits the camera frame (sky/fog) from the focus frame (hemisphere)', () => {
    const world = new World(1337);
    world.sunDirection = { x: 0, y: 1, z: 0 };
    const camera = { x: 0, y: 430, z: 0 };
    const focus = { x: 0, y: 415, z: 0 };
    const env = computeEnvironment(world, [SELA], camera, focus, true);
    // Camera looks straight up at the noon sun.
    expect(env.elevation).toBeCloseTo(1, 10);
    expect(env.focusElevation).toBeCloseTo(1, 10);
    // The focus (player) is deeper than the camera behind it.
    expect(env.focusDepthBelowM).toBeGreaterThan(env.depthBelowM);
    expect(env.altitudeM).toBeCloseTo(30, 0);
    expect(env.headlampOn).toBe(true);
    expect(env.dayColor).toEqual(SELA.atmosphere.sky);
  });
});

describe('isDaylight with an offset planet', () => {
  it('depends only on the planet-local direction, never the center', () => {
    const world = new World(7);
    world.sunDirection = { x: 0, y: 1, z: 0 };
    // Same local geometry as Sela's pole, but filed under another planet id
    // (Vorn sits at (12000, 1500, 4000) in M13): the answer must not change.
    expect(isDaylight(world, 'sela', { x: 0, y: 400, z: 0 })).toBe(true);
    expect(isDaylight(world, 'vorn', { x: 0, y: 400, z: 0 })).toBe(true);
    expect(isDaylight(world, 'vorn', { x: 0, y: -400, z: 0 })).toBe(false);
  });
});
