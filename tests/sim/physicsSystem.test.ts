import { beforeAll, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { initPhysics, physicsWorldFor } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { makePhysicsSystem } from '../../src/sim/physics/system.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import { createDensityField } from '../../src/terrain/density.js';
import type { ChunkCoord } from '../../src/terrain/chunkKey.js';
import { length, sub } from '../../src/core/math.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

function directSource(): ColliderSource {
  return {
    request: (planet, worldSeed, coord: ChunkCoord) => {
      const data = buildColliderData(planet, worldSeed, coord);
      return Promise.resolve({
        id: 0,
        key: data.key,
        origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
        positions: data.positions,
        indices: data.indices,
        empty: data.empty,
      });
    },
  };
}

/** Tick the world, flushing collider worker completions between ticks. */
async function tickFlushed(world: World, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    world.tick();
    // Let resolved collider promises create their Rapier trimeshes.
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('physics system on real terrain', () => {
  it('spawns, freezes while loading, then lands and stands', async () => {
    const colliders = new TerrainColliders(directSource(), physicsWorldFor);
    const world = new World(1337);
    world.addSystem(makePhysicsSystem({ planets: [SELA], worldSeed: 1337, colliders }));
    const spawn = findSpawnPosition(SELA, 1337);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: spawn });
    world.tick();
    const id = [...world.entities.keys()][0] as string;
    const entity = world.entities.get(id);
    expect(entity).toBeDefined();
    if (!entity) return;
    const startY = entity.position.y;
    // First ticks: frozen mid-air (colliders still loading).
    for (let i = 0; i < 3; i += 1) world.tick();
    expect(entity.position.y).toBeCloseTo(startY, 9);
    await tickFlushed(world, 400);
    const player = entity.components.player;
    expect(player?.grounded).toBe(true);
    expect(player?.embeddedTime).toBe(0);
    // Stood still near the spawn (no input dispatched).
    expect(length(sub(entity.position, spawn))).toBeLessThan(6);
    // Feet on the ground: density just below the capsule center is solid.
    const field = createDensityField(SELA, 1337);
    const local = sub(entity.position, SELA.center);
    const r = length(local);
    expect(r).toBeLessThan(SELA.radius + 3);
    expect(field.density(local.x, local.y, local.z)).toBeLessThan(0.5);
    colliders.dispose();
  }, 60000);

  it('low gravity in the core chamber: slow floaty fall', async () => {
    const colliders = new TerrainColliders(directSource(), physicsWorldFor);
    const world = new World(1337);
    world.addSystem(makePhysicsSystem({ planets: [SELA], worldSeed: 1337, colliders }));
    // Center of the hollow core chamber (radius 40).
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 10, z: 0 } });
    await tickFlushed(world, 120);
    const entity = [...world.entities.values()][0];
    expect(entity).toBeDefined();
    if (!entity) return;
    // g ~= 0.9 m/s^2: 4 s of falling covers ~7 m (vs ~47 m at surface g).
    expect(entity.position.y).toBeGreaterThan(0);
    expect(entity.position.y).toBeLessThan(10);
    expect(entity.components.player?.grounded).toBe(false);
    colliders.dispose();
  }, 60000);

  it('safety pushes out a player teleported inside solid rock', async () => {
    const colliders = new TerrainColliders(directSource(), physicsWorldFor);
    const world = new World(1337);
    world.addSystem(makePhysicsSystem({ planets: [SELA], worldSeed: 1337, colliders }));
    const field = createDensityField(SELA, 1337);
    // 50 m deep on the surface axis: well inside solid terrain.
    const buried = { x: 0, y: SELA.radius - 50, z: 0 };
    expect(field.density(buried.x, buried.y, buried.z)).toBeGreaterThan(0.5);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: buried });
    // Grace period first (1 s), then push-out at 2 m/s.
    await tickFlushed(world, 200);
    const entity = [...world.entities.values()][0];
    expect(entity).toBeDefined();
    if (!entity) return;
    const local = sub(entity.position, SELA.center);
    expect(field.density(local.x, local.y, local.z)).toBeLessThanOrEqual(0.5);
    colliders.dispose();
  }, 60000);
});
