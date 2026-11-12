// Fresh-game setup tests (M08+): the habitat + player spawn, and the
// ?dev=1 tether pack that lets testers use tethers before the M09 printer
// can craft them. Uses a stub collider source (no workers in tests).

import { beforeAll, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { distance } from '../../src/core/math.js';
import { snapWorld } from '../../src/sim/snapUtils.js';
import type { PlayerInput } from '../../src/player/input.js';
import { tickBackpackInput } from '../../src/game/backpackWiring.js';
import { tickInteraction } from '../../src/game/interactWiring.js';
import { PlacementMode } from '../../src/game/placement.js';
import { setupWorldSystems } from '../../src/game/worldSetup.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
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
    consumePrinter: () => false,
  } as unknown as PlayerInput;
}

function freshWorld(devTethers: boolean, devBuild = false): { world: World; playerId: EntityId } {
  const world = new World(1337, { planets: [SELA] });
  const setup = setupWorldSystems(world, [SELA], stubPool(), 1337, undefined, {
    devTethers,
    devBuild,
  });
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

  it('pre-places the starting platform, slot-attached printer and power cable', () => {
    const { world } = freshWorld(false);
    const platforms = [...world.entities.values()].filter((e) => e.kind === 'platform');
    const printers = [...world.entities.values()].filter(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'small_printer',
    );
    const habitats = [...world.entities.values()].filter(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'habitat',
    );
    expect(platforms).toHaveLength(1);
    expect(printers).toHaveLength(1);
    expect(habitats).toHaveLength(1);
    const printer = printers[0];
    const platform = platforms[0];
    expect(printer?.components.printer?.recipeId).toBe(null);
    expect(printer?.components.printer?.inputs).toEqual([]);
    expect(printer?.components.printer?.outputReady).toBe(null);
    // M10: the printer sits on the platform's center slot and inherits its
    // rotation; both structures are power network members.
    expect(printer?.components.placeable?.attachedTo).toBe(platform?.id);
    expect(printer?.components.placeable?.attachedSlot).toBe(0);
    expect(printer?.components.power).toBeDefined();
    expect(platform?.components.power).toBeDefined();
    // The habitat's 1/s powers the starter printer from tick one; the link is
    // a real cable entity that can be cut with the cable tool.
    const cables = [...world.entities.values()].filter((e) => e.kind === 'cable');
    expect(cables).toHaveLength(1);
    const cable = cables[0]?.components.cable;
    const ends = [cable?.a.entityId, cable?.b.entityId];
    expect(ends).toContain(platform?.id);
    expect(ends).toContain(habitats[0]?.id);
  });

  it('heals an M08 save with a habitat but no printer', () => {
    const world = new World(1337, { planets: [SELA] });
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    if (!playerId) throw new Error('no player');
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    world.dispatch({ type: 'spawnHabitat', planetId: SELA.id, position: { ...player.position } });
    world.tick();
    const setup = setupWorldSystems(world, [SELA], stubPool(), 1337, world);
    const platforms = [...world.entities.values()].filter((e) => e.kind === 'platform');
    const printers = [...world.entities.values()].filter(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'small_printer',
    );
    expect(platforms).toHaveLength(1);
    expect(printers).toHaveLength(1);
    // The heal flattens a real pad and seats the base near the player.
    expect(setup.editedKeys.length).toBeGreaterThan(0);
    const platform = platforms[0];
    if (!platform) throw new Error('no platform');
    const dist = Math.hypot(
      platform.position.x - player.position.x,
      platform.position.y - player.position.y,
      platform.position.z - player.position.z,
    );
    expect(dist).toBeLessThan(6);
    // The heal must not spawn a second habitat.
    expect(
      [...world.entities.values()].filter(
        (e) => e.kind === 'machine' && e.components.machine?.machineType === 'habitat',
      ),
    ).toHaveLength(1);
  });

  it('?dev=1 fills the backpack with tethers; without it the pack is empty', () => {
    const withDev = freshWorld(true);
    expect(tetherItems(withDev.world, withDev.playerId)).toHaveLength(8);
    const withoutDev = freshWorld(false);
    expect(tetherItems(withoutDev.world, withoutDev.playerId)).toHaveLength(0);
  });

  it('links the starter habitat on multiple seeds within the cable limit', () => {
    for (const seed of [1, 42, 2024]) {
      const world = new World(seed, { planets: [SELA] });
      setupWorldSystems(world, [SELA], stubPool(), seed, undefined);
      const cables = [...world.entities.values()].filter((e) => e.kind === 'cable');
      expect(cables, `seed ${seed}`).toHaveLength(1);
      const ends = cables[0]?.components.cable;
      const a = ends ? world.entities.get(ends.a.entityId) : undefined;
      const b = ends ? world.entities.get(ends.b.entityId) : undefined;
      if (!a || !b || !ends) throw new Error('starter cable endpoints missing');
      const aPos = snapWorld(a, ends.a.snapIndex);
      const bPos = snapWorld(b, ends.b.snapIndex);
      if (!aPos || !bPos) throw new Error('starter cable snap missing');
      expect(distance(aPos, bPos), `seed ${seed}`).toBeLessThanOrEqual(10);
    }
  });

  it('?build=1 grants platform, solar and battery packages', () => {
    const { world, playerId } = freshWorld(false, true);
    const slots = world.entities.get(playerId)?.components.inventory?.slots ?? [];
    const ids = slots.map((id) => (id ? world.entities.get(id)?.components.item?.itemId : null));
    expect(ids.filter((id) => id === 'platform_package')).toHaveLength(2);
    expect(ids).toContain('solar_panel_package');
    expect(ids).toContain('battery_package');
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
    tickInteraction({
      world,
      playerId,
      input: stubInput({}),
      interact: true,
      canAct: true,
      aim: { hit: null, normal: null, planet: null },
      placement: new PlacementMode(),
      openStation: () => undefined,
      togglePrinter: () => undefined,
    });
    world.tick();
    expect(world.entities.has(post.id)).toBe(false);
    expect(tetherItems(world, playerId)).toHaveLength(8);
  });
});
