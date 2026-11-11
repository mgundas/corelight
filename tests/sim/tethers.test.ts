// Tether graph tests (M08): links form within 12 m with line of sight,
// liveness flows from habitats, and breaking the chain kills the tail.
// placeTether/removeTether actions spend and refund the backpack item.

import { beforeEach, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { SIM_DT, TETHER_PLACE_AHEAD_M } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { distance, IDENTITY_QUAT } from '../../src/core/math.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { updateTethers, segmentBlocked } from '../../src/sim/systems/tethers.js';
import { createDensityField, type DensityField } from '../../src/terrain/density.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';

function airChainWorld(): { world: World; playerId: EntityId; habitatId: EntityId; up: { x: number; y: number; z: number } } {
  const world = new World(1337, { planets: [SELA] });
  const spawn = findSpawnPosition(SELA, 1337);
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: spawn });
  world.tick(SIM_DT);
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  const up = upAt(SELA, spawn);
  // Habitat 20 m above the surface (in open air: LOS is guaranteed clear).
  const habitatPos = {
    x: spawn.x + up.x * 20,
    y: spawn.y + up.y * 20,
    z: spawn.z + up.z * 20,
  };
  world.dispatch({ type: 'spawnHabitat', planetId: SELA.id, position: habitatPos });
  world.tick(SIM_DT);
  const habitatId = [...world.entities.values()].find((e) => e.kind === 'machine')?.id ?? '';
  if (!habitatId) throw new Error('no habitat');
  return { world, playerId, habitatId, up };
}

/** Tether entity floating at an explicit world position (tests own placement). */
function addTether(world: World, pos: { x: number; y: number; z: number }): EntityId {
  const id = world.nextId('tether');
  world.entities.set(id, {
    id,
    kind: 'tether',
    planetId: SELA.id,
    position: { ...pos },
    rotation: { ...IDENTITY_QUAT },
    components: { tether: { live: false, links: [] } },
  });
  return id;
}

function giveTetherItem(world: World, playerId: EntityId): EntityId {
  const id = world.nextId('item');
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId: 'tether', holder: playerId } },
  });
  const inv = player.components.inventory;
  if (!inv) throw new Error('no backpack');
  const free = inv.slots.indexOf(null);
  if (free === -1) throw new Error('backpack full');
  inv.slots[free] = id;
  return id;
}

describe('tether graph', () => {
  beforeEach(() => {
    events.clear();
  });

  it('chains within 12 m go live from the habitat', () => {
    const { world, playerId, habitatId } = airChainWorld();
    const player = world.entities.get(playerId);
    const habitat = world.entities.get(habitatId);
    if (!player || !habitat) throw new Error('setup failed');
    const t1 = addTether(world, {
      x: habitat.position.x,
      y: habitat.position.y + 10,
      z: habitat.position.z,
    });
    const t2 = addTether(world, {
      x: habitat.position.x,
      y: habitat.position.y + 20,
      z: habitat.position.z,
    });
    updateTethers(world, [SELA]);
    expect(world.entities.get(t1)?.components.tether?.live).toBe(true);
    expect(world.entities.get(t2)?.components.tether?.live).toBe(true);
    expect(world.entities.get(t1)?.components.tether?.links).toContain(habitatId);
    expect(world.entities.get(t1)?.components.tether?.links).toContain(t2);
  });

  it('a post past 12 m from everything stays dark', () => {
    const { world } = airChainWorld();
    const far = addTether(world, { x: 0, y: SELA.radius + 300, z: 0 });
    updateTethers(world, [SELA]);
    expect(world.entities.get(far)?.components.tether?.live).toBe(false);
    expect(world.entities.get(far)?.components.tether?.links).toEqual([]);
  });

  it('removing the middle post kills the tail (E-flow acceptance)', () => {
    const { world, playerId, habitatId } = airChainWorld();
    const habitat = world.entities.get(habitatId);
    if (!habitat) throw new Error('setup failed');
    const t1 = addTether(world, {
      x: habitat.position.x,
      y: habitat.position.y + 10,
      z: habitat.position.z,
    });
    const t2 = addTether(world, {
      x: habitat.position.x,
      y: habitat.position.y + 20,
      z: habitat.position.z,
    });
    updateTethers(world, [SELA]);
    expect(world.entities.get(t2)?.components.tether?.live).toBe(true);
    // Walk the player up to the middle post so E reaches it, then pull it.
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { ...(world.entities.get(t1)?.position ?? habitat.position) },
    });
    world.tick(SIM_DT);
    world.dispatch({ type: 'removeTether', playerId, tetherId: t1 });
    world.tick(SIM_DT);
    updateTethers(world, [SELA]);
    expect(world.entities.has(t1)).toBe(false);
    expect(world.entities.get(t2)?.components.tether?.live).toBe(false);
  });

  it('solid rock between posts blocks the link (occlusion rule)', () => {
    const stub = (density: (x: number, y: number, z: number) => number): DensityField => ({
      config: SELA,
      density,
      caveThresholdAt: () => 0,
    });
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 8, y: 0, z: 0 };
    // Open air never blocks.
    expect(segmentBlocked(stub(() => -1), a, b)).toBe(false);
    // A 4 m solid slab blocks; a 0.3 m pebble does not.
    expect(segmentBlocked(stub((x) => (x > 2 && x < 6 ? 1 : -1)), a, b)).toBe(true);
    expect(segmentBlocked(stub((x) => (x > 2 && x < 2.3 ? 1 : -1)), a, b)).toBe(false);
  });

  it('a far-away edit leaves the cached graph intact', () => {
    const { world, playerId, habitatId } = airChainWorld();
    const habitat = world.entities.get(habitatId);
    if (!habitat) throw new Error('setup failed');
    const t1 = addTether(world, {
      x: habitat.position.x,
      y: habitat.position.y + 10,
      z: habitat.position.z,
    });
    updateTethers(world, [SELA]);
    expect(world.entities.get(t1)?.components.tether?.live).toBe(true);
    // Dig 200 m away (in range of the teleported player, far from the
    // chain): the edit event must not disturb the cached adjacency.
    const far = {
      x: habitat.position.x + 200,
      y: habitat.position.y,
      z: habitat.position.z,
    };
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...far } });
    world.tick(SIM_DT);
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: { ...far },
      radius: 2,
      strength: 0.5,
    });
    world.tick(SIM_DT);
    updateTethers(world, [SELA]);
    expect(world.entities.get(t1)?.components.tether?.live).toBe(true);
    expect(world.entities.get(t1)?.components.tether?.links).toContain(habitatId);
  });

  it('placeTether spends a backpack tether and seats a post', () => {
    const { world, playerId } = airChainWorld();
    const itemId = giveTetherItem(world, playerId);
    world.dispatch({ type: 'placeTether', playerId });
    world.tick(SIM_DT);
    expect(world.entities.has(itemId)).toBe(false);
    const posts = [...world.entities.values()].filter((e) => e.kind === 'tether');
    expect(posts).toHaveLength(1);
    expect(world.entities.get(playerId)?.components.inventory?.slots).not.toContain(itemId);
  });

  it('seats the post ahead of the player, never inside the avatar', () => {
    const { world, playerId } = airChainWorld();
    giveTetherItem(world, playerId);
    world.dispatch({ type: 'placeTether', playerId });
    world.tick(SIM_DT);
    const player = world.entities.get(playerId);
    const post = [...world.entities.values()].find((e) => e.kind === 'tether');
    if (!player || !post) throw new Error('setup failed');
    // Far enough to clear the 0.35 m capsule, close enough to see and
    // to pull back up with E (3 m cone).
    const d = distance(post.position, player.position);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(TETHER_PLACE_AHEAD_M + 1.5);
    // Seated on the surface, not buried: base ~0, tip in open air.
    const field = createDensityField(SELA, world.seed, (x, y, z) =>
      world.terrainEdits.deltaAt(SELA, SELA.id, x, y, z),
    );
    const up = upAt(SELA, post.position);
    const lp = {
      x: post.position.x - SELA.center.x,
      y: post.position.y - SELA.center.y,
      z: post.position.z - SELA.center.z,
    };
    expect(field.density(lp.x, lp.y, lp.z)).toBeLessThanOrEqual(0.5);
    expect(field.density(lp.x + up.x * 0.9, lp.y + up.y * 0.9, lp.z + up.z * 0.9)).toBeLessThan(0);
  });

  it('placeTether with an empty-handed pack places nothing', () => {
    const { world, playerId } = airChainWorld();
    world.dispatch({ type: 'placeTether', playerId });
    world.tick(SIM_DT);
    expect([...world.entities.values()].filter((e) => e.kind === 'tether')).toHaveLength(0);
  });

  it('removeTether refunds the item to the backpack', () => {
    const { world, playerId } = airChainWorld();
    giveTetherItem(world, playerId);
    world.dispatch({ type: 'placeTether', playerId });
    world.tick(SIM_DT);
    const post = [...world.entities.values()].find((e) => e.kind === 'tether');
    if (!post) throw new Error('no post placed');
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...post.position } });
    world.tick(SIM_DT);
    world.dispatch({ type: 'removeTether', playerId, tetherId: post.id });
    world.tick(SIM_DT);
    expect(world.entities.has(post.id)).toBe(false);
    const pack = world.entities.get(playerId)?.components.inventory?.slots ?? [];
    const back = pack.find((id) => id && world.entities.get(id)?.components.item?.itemId === 'tether');
    expect(back).toBeDefined();
  });
});
