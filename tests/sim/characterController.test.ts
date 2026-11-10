import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SIM_DT } from '../../src/core/constants.js';
import { dot, length, normalize, rotateVector, sub, vec3 } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import {
  moveBasis,
  orientationForUpYaw,
  PlayerBody,
} from '../../src/sim/physics/characterController.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

describe('moveBasis', () => {
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
  it('maps local +Y onto up', () => {
    const up = normalize(vec3(0.3, 1, -0.2));
    const q = orientationForUpYaw(up, 0.9);
    const mapped = rotateVector(vec3(0, 1, 0), q);
    expect(mapped.x).toBeCloseTo(up.x, 5);
    expect(mapped.y).toBeCloseTo(up.y, 5);
    expect(mapped.z).toBeCloseTo(up.z, 5);
  });
});

describe('findSpawnPosition', () => {
  it('hovers just above the surface', async () => {
    const { createDensityField } = await import('../../src/terrain/density.js');
    const spawn = findSpawnPosition(SELA, 1337);
    const field = createDensityField(SELA, 1337);
    const local = sub(spawn, SELA.center);
    // In the air...
    expect(field.density(local.x, local.y, local.z)).toBeLessThan(0);
    // ...but close to the ground (hover + relief margin).
    expect(length(local)).toBeGreaterThan(SELA.radius - 25);
    expect(length(local)).toBeLessThan(SELA.radius + 25);
  });
});

describe('PlayerBody on a flat floor', () => {
  // Floor top at local y = 380 (near Sela's surface radius): "up" is stable
  // there. (A floor through the planet center would make up singular.)
  const FLOOR_TOP = 380;

  function flatWorld(): { rapierWorld: RAPIER.World; world: World } {
    const rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 1, 50).setTranslation(0, FLOOR_TOP - 1, 0),
    );
    return { rapierWorld, world: new World(5) };
  }

  it('falls, lands, and reports grounded', () => {
    const { rapierWorld, world } = flatWorld();
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 400, z: 0 } });
    world.tick();
    const entity = [...world.entities.values()][0];
    expect(entity).toBeDefined();
    if (!entity) return;
    const body = new PlayerBody(() => rapierWorld);
    // Drop 20 m at g = 6 (~2.6 s of fall).
    for (let i = 0; i < 200; i += 1) {
      body.step(entity, [SELA], SIM_DT);
    }
    // Landed on the capsule (half-height + radius = 0.9, plus controller gap).
    expect(entity.position.y).toBeGreaterThan(FLOOR_TOP + 0.5);
    expect(entity.position.y).toBeLessThan(FLOOR_TOP + 1.5);
    expect(entity.components.player?.grounded).toBe(true);
    body.dispose();
    rapierWorld.free();
  });

  it('walks forward and jumps', () => {
    const { rapierWorld, world } = flatWorld();
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 400, z: 0 } });
    world.tick();
    const entity = [...world.entities.values()][0];
    expect(entity).toBeDefined();
    if (!entity) return;
    const body = new PlayerBody(() => rapierWorld);
    for (let i = 0; i < 200; i += 1) body.step(entity, [SELA], SIM_DT);
    expect(entity.components.player?.grounded).toBe(true);
    const startX = entity.position.x;
    const startZ = entity.position.z;
    // Walk forward for 1 s at 5 m/s.
    for (let i = 0; i < 30; i += 1) {
      const player = entity.components.player;
      if (player) player.input = { moveX: 0, moveZ: 1, jump: false, sprint: false };
      body.step(entity, [SELA], SIM_DT);
    }
    const walked = Math.hypot(entity.position.x - startX, entity.position.z - startZ);
    expect(walked).toBeGreaterThan(3);
    expect(walked).toBeLessThan(7);
    // Jump: must leave the ground.
    const player = entity.components.player;
    if (player) player.input = { moveX: 0, moveZ: 0, jump: true, sprint: false };
    body.step(entity, [SELA], SIM_DT);
    let apex = entity.position.y;
    for (let i = 0; i < 60; i += 1) {
      body.step(entity, [SELA], SIM_DT);
      apex = Math.max(apex, entity.position.y);
    }
    expect(apex).toBeGreaterThan(FLOOR_TOP + 1.5);
    body.dispose();
    rapierWorld.free();
  });
});
