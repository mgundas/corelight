// Fresh-game setup tests (M08+): the habitat + player spawn, and the
// ?dev=1 tether pack that lets testers use tethers before the M09 printer
// can craft them. Uses a stub collider source (no workers in tests).

import { beforeAll, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlayerInput } from '../../src/player/input.js';
import { tickBackpackInput } from '../../src/game/backpackWiring.js';
import { setupWorldSystems } from '../../src/game/worldSetup.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import type { ColliderPool, ColliderRequest, ColliderResult } from '../../src/terrain/colliderPool.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

function stubPool(): ColliderPool {
  const request = (req: ColliderRequest): Promise<ColliderResult> => {
    const data = buildColliderData(req.planetConfig, req.worldSeed, req.coord);
    return Promise.resolve({
      id: 0,
      key: data.key,
      origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
      positions: data.positions,
      indices: data.indices,
      empty: data.empty,
    });
  };
  return { request } as unknown as ColliderPool;
}

function stubInput(overrides: Partial<Record<'select' | 'drop' | 'interact' | 'tether', boolean>>): PlayerInput {
  return {
    consumeSelect: () => (overrides.select === true ? 0 : null),
    consumeDrop: () => overrides.drop === true,
    consumeInteract: () => overrides.interact === true,
    consumeTether: () => overrides.tether === true,
  } as unknown as PlayerInput;
}

function freshWorld(devTethers: boolean): { world: World; playerId: EntityId } {
  const world = new World(1337, { planets: [SELA] });
  const setup = setupWorldSystems(world, [SELA], stubPool(), 1337, undefined, { devTethers });
  if (!setup.playerId) throw new Error('no player spawned');
  return { world, playerId: setup.playerId };
}

function tetherItems(world: World, playerId: EntityId): EntityId[] {
  const slots = world.entities.get(playerId)?.components.inventory?.slots ?? [];
  return slots.filter(
    (id): id is EntityId => id !== null && world.entities.get(id)?.components.item?.itemId === 'tether',
  );
}

describe('fresh-game setup', () => {
  it('spawns the player next to a habitat on a flattened pad', () => {
    const { world, playerId } = freshWorld(false);
    const player = world.entities.get(playerId);
    const habitats = [...world.entities.values()].filter(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'habitat',
    );
    expect(habitats).toHaveLength(1);
    expect(player?.planetId).toBe(SELA.id);
  });

  it('?dev=1 fills the backpack with tethers; without it the pack is empty', () => {
    const withDev = freshWorld(true);
    expect(tetherItems(withDev.world, withDev.playerId)).toHaveLength(8);
    const withoutDev = freshWorld(false);
    expect(tetherItems(withoutDev.world, withoutDev.playerId)).toHaveLength(0);
  });

  it('T spends a dev tether on a post (Game tick wiring)', () => {
    const { world, playerId } = freshWorld(true);
    tickBackpackInput(world, playerId, stubInput({ tether: true }), true);
    world.tick();
    expect([...world.entities.values()].filter((e) => e.kind === 'tether')).toHaveLength(1);
    expect(tetherItems(world, playerId)).toHaveLength(7);
  });

  it('E on an aimed post pulls it back into the pack', () => {
    const { world, playerId } = freshWorld(true);
    tickBackpackInput(world, playerId, stubInput({ tether: true }), true);
    world.tick();
    const post = [...world.entities.values()].find((e) => e.kind === 'tether');
    if (!post) throw new Error('no post placed');
    // Face the post point-blank (dist ~0 always counts as aimed).
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...post.position } });
    world.tick();
    tickBackpackInput(world, playerId, stubInput({ interact: true }), true);
    world.tick();
    expect(world.entities.has(post.id)).toBe(false);
    expect(tetherItems(world, playerId)).toHaveLength(8);
  });
});
