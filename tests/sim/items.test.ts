import { beforeAll, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { World } from '../../src/sim/world.js';
import { initPhysics, physicsWorldFor } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { makePhysicsSystem } from '../../src/sim/physics/system.js';
import { makeItemsSystem } from '../../src/sim/systems/items.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import { createDensityField } from '../../src/terrain/density.js';
import type { ChunkCoord } from '../../src/terrain/chunkKey.js';
import { upAt } from '../../src/sim/physics/frames.js';
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

async function tickFlushed(world: World, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    world.tick();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function makeWorld(seed = 1337): { world: World; colliders: TerrainColliders; playerId: string } {
  const colliders = new TerrainColliders(directSource(), physicsWorldFor);
  const world = new World(seed, { planets: [SELA] });
  world.addSystem(makePhysicsSystem({ planets: [SELA], worldSeed: seed, colliders }));
  world.addSystem(makeItemsSystem({ planets: [SELA], worldFor: physicsWorldFor }));
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, seed) });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, colliders, playerId };
}

describe('item physics', () => {
  it('loose items fall with spherical gravity and rest on the ground', async () => {
    const { world, colliders, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    await tickFlushed(world, 400);
    const up = upAt(SELA, player.position);
    const start = {
      x: player.position.x + up.x * 6,
      y: player.position.y + up.y * 6,
      z: player.position.z + up.z * 6,
    };
    const itemId = world.nextId('item');
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...start },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    await tickFlushed(world, 300);
    const item = world.entities.get(itemId);
    if (!item) throw new Error('item lost');
    // Fell toward the planet and stopped near the surface.
    expect(length(sub(item.position, SELA.center))).toBeLessThan(length(sub(start, SELA.center)) - 2);
    const field = createDensityField(SELA, 1337);
    const local = sub(item.position, SELA.center);
    expect(field.density(local.x, local.y, local.z)).toBeLessThan(0.6);
    colliders.dispose();
  }, 60000);

  it('loose items integrate gravity once per tick (single step authority)', async () => {
    const { world, colliders, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    // Let the player land so terrain colliders are loaded (shared world).
    await tickFlushed(world, 400);
    const up = upAt(SELA, player.position);
    const start = {
      x: player.position.x + up.x * 30,
      y: player.position.y + up.y * 30,
      z: player.position.z + up.z * 30,
    };
    const itemId = world.nextId('item');
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...start },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    // 60 ticks = 2 s at g = 6: semi-implicit Euler falls ~12 m. A second
    // world.step per tick would double-integrate to ~24 m.
    await tickFlushed(world, 60);
    const item = world.entities.get(itemId);
    if (!item) throw new Error('item lost');
    const fallen = length(sub(start, item.position));
    expect(fallen).toBeGreaterThan(10);
    expect(fallen).toBeLessThan(14);
    colliders.dispose();
  }, 60000);

  it('carried items own no body and never move', async () => {
    const { world, colliders, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    await tickFlushed(world, 200);
    const itemId = world.nextId('item');
    const at = { ...player.position };
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...at },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'silicate', holder: playerId } },
    });
    await tickFlushed(world, 120);
    expect(world.entities.get(itemId)?.position).toEqual(at);
    colliders.dispose();
  }, 60000);

  it('items with unloaded ground stay frozen instead of falling to the core', async () => {
    const colliders = new TerrainColliders(directSource(), physicsWorldFor);
    const world = new World(1337, { planets: [SELA] });
    world.addSystem(makePhysicsSystem({ planets: [SELA], worldSeed: 1337, colliders }));
    // Ground never ready: mirrors a dropped item whose chunk unloaded.
    world.addSystem(makeItemsSystem({ planets: [SELA], worldFor: physicsWorldFor, groundReady: () => false }));
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
    world.tick();
    const start = { x: SELA.center.x, y: SELA.center.y + SELA.radius + 20, z: SELA.center.z };
    const itemId = world.nextId('item');
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...start },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    await tickFlushed(world, 60);
    expect(world.entities.get(itemId)?.position).toEqual(start);
    colliders.dispose();
  }, 60000);
});
