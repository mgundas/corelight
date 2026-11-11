// seatTetherOnGround edge cases (M08): the helper behind placeTether.
// A mid-air anchor with no ground in reach falls back to 1 m below the
// anchor instead of returning rock or throwing.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { seatTetherOnGround } from '../../src/sim/tetherActions.js';
import { World } from '../../src/sim/world.js';

describe('seatTetherOnGround', () => {
  it('falls back below a mid-air anchor when nothing is hit', () => {
    const world = new World(1337, { planets: [SELA] });
    const spawn = findSpawnPosition(SELA, 1337);
    const up = upAt(SELA, spawn);
    const anchor = {
      x: spawn.x + up.x * 60,
      y: spawn.y + up.y * 60,
      z: spawn.z + up.z * 60,
    };
    // 60 m up: the downward march finds no ground, so the seat is the
    // documented fallback exactly 1 m below the anchor.
    const seated = seatTetherOnGround(world, SELA.id, anchor);
    expect(seated.x).toBeCloseTo(anchor.x - up.x, 6);
    expect(seated.y).toBeCloseTo(anchor.y - up.y, 6);
    expect(seated.z).toBeCloseTo(anchor.z - up.z, 6);
  });

  it('passes an unknown planet through untouched', () => {
    const world = new World(1337, { planets: [SELA] });
    const at = { x: 1, y: 2, z: 3 };
    expect(seatTetherOnGround(world, 'nope', at)).toEqual(at);
  });
});
