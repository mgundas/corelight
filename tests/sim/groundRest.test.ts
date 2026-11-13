import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { IDENTITY_QUAT, length, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { PlayerBody } from '../../src/sim/physics/characterController.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { makeItemsSystem } from '../../src/sim/systems/items.js';
import { World } from '../../src/sim/world.js';

beforeAll(initPhysics);

function fixture(slope: number) {
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const angle = slope * Math.PI / 180;
  const vertices: number[] = [];
  const indices: number[] = [];
  // Match terrain's metre-scale triangles instead of giant, ill-conditioned
  // triangles that yield inaccurate shape-cast normals near capsule contacts.
  for (let z = 0; z <= 64; z++) {
    for (let x = 0; x <= 64; x++) {
      vertices.push((x - 32) * Math.cos(angle), 380 + (x - 32) * Math.sin(angle), z - 32);
      if (x < 64 && z < 64) {
        const a = z * 65 + x;
        indices.push(a, a + 65, a + 66, a, a + 66, a + 1);
      }
    }
  }
  const floor = physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)));
  physics.timestep = SIM_DT;
  const world = new World(1337, { planets: [SELA] });
  return { physics, floor, world };
}

describe('ground resting stability', () => {
  it.each([0, 2, 15])('items stop on a %s degree floor and fall when it is removed', (slope) => {
    const { physics, floor, world } = fixture(slope);
    const id = world.nextId('item');
    world.entities.set(id, {
      id, kind: 'item', planetId: SELA.id,
      position: { x: 8, y: 386, z: 0 }, rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    const items = makeItemsSystem({ planets: [SELA], worldFor: () => physics });
    const tick = () => { physics.step(); items(world, SIM_DT); };
    try {
      for (let i = 0; i < 180; i++) tick();
      const item = world.entities.get(id)!;
      const start = { ...item.position };
      for (let i = 0; i < 900; i++) tick();
      expect(length(sub(item.position, start))).toBeLessThan(0.05);
      physics.removeCollider(floor, true);
      for (let i = 0; i < 30; i++) tick();
      expect(item.position.y).toBeLessThan(start.y - 2);
    } finally { physics.free(); }
  });

  it.each([0, 2, 15, 45])('the idle player stays put on a %s degree floor', (slope) => {
    const { physics, world } = fixture(slope);
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: { x: 8, y: 392, z: 0 } });
    world.tick();
    const entity = [...world.entities.values()][0]!;
    const body = new PlayerBody(() => physics);
    const tick = () => { body.step(entity, [SELA], SIM_DT); physics.step(); };
    try {
      for (let i = 0; i < 180; i++) tick();
      expect(entity.components.player?.grounded).toBe(true);
      const start = { ...entity.position };
      for (let i = 0; i < 900; i++) tick();
      expect(length(sub(entity.position, start))).toBeLessThan(0.05);
    } finally { body.dispose(); physics.free(); }
  });

  it('still lets the player slide down steep terrain', () => {
    const { physics, world } = fixture(65);
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: { x: 0, y: 386, z: 20 } });
    world.tick();
    const entity = [...world.entities.values()][0]!;
    const body = new PlayerBody(() => physics);
    try {
      for (let i = 0; i < 60; i++) { body.step(entity, [SELA], SIM_DT); physics.step(); }
      const start = { ...entity.position };
      for (let i = 0; i < 60; i++) { body.step(entity, [SELA], SIM_DT); physics.step(); }
      expect(entity.position.x, JSON.stringify({ start, end: entity.position })).toBeLessThan(start.x - 0.5);
      expect(entity.position.y).toBeLessThan(start.y - 0.5);
    } finally { body.dispose(); physics.free(); }
  });
});
