import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SIM_DT } from '../../src/core/constants.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { PlayerBody } from '../../src/sim/physics/characterController.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

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
    // Drop 20 m at g = 6 (~2.6 s of fall). Production steps the shared
    // world once per tick after every body writes intent; the loop mirrors
    // that here with an explicit step per iteration.
    for (let i = 0; i < 200; i += 1) {
      body.step(entity, [SELA], SIM_DT);
      rapierWorld.timestep = SIM_DT;
      rapierWorld.step();
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
    for (let i = 0; i < 200; i += 1) {
      body.step(entity, [SELA], SIM_DT);
      rapierWorld.timestep = SIM_DT;
      rapierWorld.step();
    }
    expect(entity.components.player?.grounded).toBe(true);
    const startX = entity.position.x;
    const startZ = entity.position.z;
    // Walk forward for 1 s at 5 m/s.
    for (let i = 0; i < 30; i += 1) {
      const player = entity.components.player;
      if (player) player.input = { moveX: 0, moveZ: 1, jump: false, sprint: false };
      body.step(entity, [SELA], SIM_DT);
      rapierWorld.timestep = SIM_DT;
      rapierWorld.step();
    }
    const walked = Math.hypot(entity.position.x - startX, entity.position.z - startZ);
    expect(walked).toBeGreaterThan(3);
    expect(walked).toBeLessThan(7);
    // Jump: must leave the ground.
    const player = entity.components.player;
    if (player) player.input = { moveX: 0, moveZ: 0, jump: true, sprint: false };
    body.step(entity, [SELA], SIM_DT);
    rapierWorld.timestep = SIM_DT;
    rapierWorld.step();
    let apex = entity.position.y;
    for (let i = 0; i < 60; i += 1) {
      body.step(entity, [SELA], SIM_DT);
      rapierWorld.timestep = SIM_DT;
      rapierWorld.step();
      apex = Math.max(apex, entity.position.y);
    }
    expect(apex).toBeGreaterThan(FLOOR_TOP + 1.5);
    body.dispose();
    rapierWorld.free();
  });
});
