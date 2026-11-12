// M13 frame transfer: the dominant SOI planet owns an entity's frame. The
// transfer is an id relabel (world doubles never change); body owners rebind
// to the new planet's Rapier world. Pinned end to end on real Vorn terrain.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, length, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { World } from '../../src/sim/world.js';
import { transferPlanetId } from '../../src/sim/physics/frames.js';
import { initPhysics, disposePhysics, physicsWorldFor } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { makePhysicsSystem } from '../../src/sim/physics/system.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { makeItemsSystem } from '../../src/sim/systems/items.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import type { ChunkCoord } from '../../src/terrain/chunkKey.js';

const PLANETS: PlanetConfig[] = [SELA, VORN];

beforeAll(async () => {
  await initPhysics();
}, 30000);

afterAll(() => {
  disposePhysics();
});

function directSource(): ColliderSource {
  return {
    request: (planet, worldSeed, coord: ChunkCoord) => {
      const data = buildColliderData(planet, worldSeed, coord);
      return Promise.resolve({
        id: 0,
        key: data.key,
        origin: { ...data.origin },
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

describe('transferPlanetId', () => {
  it('picks the dominant SOI planet and null in deep space', () => {
    expect(transferPlanetId(PLANETS, { x: 0, y: SELA.radius + 2, z: 0 })).toBe('sela');
    expect(transferPlanetId(PLANETS, { x: 12000, y: 1500 + VORN.radius + 2, z: 4000 })).toBe('vorn');
    // Midpoint between the two: outside both SOIs (3 * radius).
    expect(transferPlanetId(PLANETS, { x: 6000, y: 750, z: 2000 })).toBeNull();
    expect(transferPlanetId([SELA], { x: 0, y: 5000, z: 0 })).toBeNull();
  });
});

describe('physics frame handoff', () => {
  it('transfers a player teleported from Sela to Vorn and lands there', async () => {
    const colliders = new TerrainColliders(directSource(), physicsWorldFor);
    const world = new World(1337, { planets: PLANETS });
    world.addSystem(makePhysicsSystem({ planets: PLANETS, worldSeed: 1337, colliders }));
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: findSpawnPosition(SELA, 1337) });
    world.tick();
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('no player');
    expect(player.planetId).toBe('sela');
    // Teleport across (the action moves position only; the system transfers).
    world.dispatch({ type: 'playerTeleport', playerId: player.id, position: findSpawnPosition(VORN, 1337) });
    await tickFlushed(world, 400);
    expect(player.planetId).toBe('vorn');
    expect(player.components.player?.grounded).toBe(true);
    expect(length(sub(player.position, VORN.center))).toBeLessThan(VORN.radius + 3);
    // Out of every SOI: the frame becomes deep space and integration stops.
    world.dispatch({ type: 'playerTeleport', playerId: player.id, position: { x: 6000, y: 750, z: 2000 } });
    world.tick();
    expect(player.planetId).toBeNull();
    colliders.dispose();
  }, 60000);
});

describe('item frame handoff', () => {
  it('relabels loose items and moves their body to the new planet world', () => {
    const world = new World(1337, { planets: PLANETS });
    world.addSystem(makeItemsSystem({ planets: PLANETS, worldFor: physicsWorldFor }));
    const vornSpawn = findSpawnPosition(VORN, 1337);
    const nearVorn = world.nextId('item');
    world.entities.set(nearVorn, {
      id: nearVorn,
      kind: 'item',
      // Stale Sela label from before a backpack trip: must transfer to Vorn.
      planetId: 'sela',
      position: { x: vornSpawn.x, y: vornSpawn.y + 5, z: vornSpawn.z },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    const nearSela = world.nextId('item');
    world.entities.set(nearSela, {
      id: nearSela,
      kind: 'item',
      planetId: 'vorn',
      position: { x: 0, y: SELA.radius + 5, z: 0 },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    world.tick();
    expect(world.entities.get(nearVorn)?.planetId).toBe('vorn');
    expect(world.entities.get(nearSela)?.planetId).toBe('sela');
    expect(physicsWorldFor('vorn').bodies.len()).toBe(1);
    expect(physicsWorldFor('sela').bodies.len()).toBe(1);
  });
});
