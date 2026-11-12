// M13 acceptance: after the SOI transfer, Vorn is a fully playable planet —
// walk/stand, dig (with soil), place a tether, and drop an item that falls
// and rests under Vorn gravity.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { distance, IDENTITY_QUAT, length, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { World } from '../../src/sim/world.js';
import { initPhysics, disposePhysics, physicsWorldFor } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { makePhysicsSystem } from '../../src/sim/physics/system.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { makeItemsSystem } from '../../src/sim/systems/items.js';
import { updateTethers } from '../../src/sim/systems/tethers.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import type { ChunkCoord } from '../../src/terrain/chunkKey.js';
import type { EntityId } from '../../src/sim/entities.js';

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

function giveTetherItem(world: World, playerId: EntityId): void {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no backpack');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId: 'tether', holder: playerId } },
  });
  const free = inv.slots.indexOf(null);
  if (free === -1) throw new Error('backpack full');
  inv.slots[free] = id;
}

describe('Vorn gameplay after the frame transfer', () => {
  it('stands, digs, places a tether and drops a falling item', async () => {
    const colliders = new TerrainColliders(directSource(), physicsWorldFor);
    const world = new World(1337, { planets: PLANETS });
    world.addSystem(makePhysicsSystem({ planets: PLANETS, worldSeed: 1337, colliders }));
    world.addSystem(makeItemsSystem({ planets: PLANETS, worldFor: physicsWorldFor }));
    world.addSystem((w) => updateTethers(w, PLANETS));
    const spawn = findSpawnPosition(VORN, 1337);
    world.dispatch({ type: 'spawnPlayer', planetId: 'vorn', position: spawn });
    await tickFlushed(world, 400);
    const player = [...world.entities.values()].find((e) => e.kind === 'player');
    if (!player) throw new Error('no player');
    expect(player.planetId).toBe('vorn');
    expect(player.components.player?.grounded).toBe(true);

    // Dig at the feet: the sim accepts a Vorn stroke and earns soil.
    const up = upAt(VORN, player.position);
    world.dispatch({
      type: 'terrainEdit',
      playerId: player.id,
      planetId: 'vorn',
      mode: 'dig',
      center: {
        x: player.position.x - up.x * 2,
        y: player.position.y - up.y * 2,
        z: player.position.z - up.z * 2,
      },
      radius: 2,
      strength: 3,
    });
    world.tick();
    expect(player.components.player?.soil ?? 0).toBeGreaterThan(0);
    expect(world.terrainEdits.sampleCount).toBeGreaterThan(0);

    // Tethers place on Vorn (dark without a habitat; M14 brings the kit).
    giveTetherItem(world, player.id);
    world.dispatch({ type: 'placeTether', playerId: player.id });
    world.tick();
    const tether = [...world.entities.values()].find((e) => e.kind === 'tether');
    expect(tether?.planetId).toBe('vorn');
    expect(tether?.components.tether?.live).toBe(false);

    // A loose item falls under Vorn gravity and comes to rest on the ground.
    const itemId = world.nextId('item');
    const start = {
      x: spawn.x + 3,
      y: spawn.y + 6,
      z: spawn.z + 3,
    };
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: 'vorn',
      position: { ...start },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'hydrite' } },
    });
    await tickFlushed(world, 200);
    const item = world.entities.get(itemId);
    if (!item) throw new Error('item lost');
    expect(item.planetId).toBe('vorn');
    expect(distance(item.position, VORN.center)).toBeLessThan(distance(start, VORN.center) - 1);
    expect(length(sub(item.position, VORN.center))).toBeLessThan(VORN.radius + 3);
    colliders.dispose();
  }, 60000);
});
