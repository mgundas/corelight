import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { BACKPACK_SLOTS } from '../../src/core/constants.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { World } from '../../src/sim/world.js';
import { updateNodes } from '../../src/sim/systems/nodes.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';

function spawnWorld(seed = 1337): { world: World; playerId: string } {
  const world = new World(seed, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, seed) });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  updateNodes(world, [SELA]);
  return { world, playerId };
}

function spawnItem(world: World, near: { x: number; y: number; z: number }, itemId = 'resin'): string {
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: SELA.id,
    position: { ...near },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId } },
  });
  return id;
}

describe('backpack pick up / drop / select', () => {
  it('spawnPlayer starts with an empty 8-slot backpack', () => {
    const { world, playerId } = spawnWorld();
    const inv = world.entities.get(playerId)?.components.inventory;
    expect(inv?.slots).toHaveLength(BACKPACK_SLOTS);
    expect(inv?.slots.every((s) => s === null)).toBe(true);
    expect(inv?.selectedSlot).toBe(0);
  });

  it('pickUp takes an item within 3 m into the first free slot', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const itemId = spawnItem(world, player.position);
    world.dispatch({ type: 'pickUp', playerId, itemId });
    world.tick();
    const inv = world.entities.get(playerId)?.components.inventory;
    expect(inv?.slots[0]).toBe(itemId);
    expect(world.entities.get(itemId)?.components.item?.holder).toBe(playerId);
  });

  it('pickUp fails into a full backpack', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    for (let i = 0; i < BACKPACK_SLOTS; i += 1) {
      const itemId = spawnItem(world, player.position, 'resin');
      world.dispatch({ type: 'pickUp', playerId, itemId });
      world.tick();
    }
    const extra = spawnItem(world, player.position, 'silicate');
    world.dispatch({ type: 'pickUp', playerId, itemId: extra });
    world.tick();
    const inv = world.entities.get(playerId)?.components.inventory;
    expect(inv?.slots).not.toContain(extra);
    expect(world.entities.get(extra)?.components.item?.holder).toBeUndefined();
  });

  it('pickUp fails beyond 3 m', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const up = upAt(SELA, player.position);
    const far = {
      x: player.position.x + up.x * 20,
      y: player.position.y + up.y * 20,
      z: player.position.z + up.z * 20,
    };
    const itemId = spawnItem(world, far);
    world.dispatch({ type: 'pickUp', playerId, itemId });
    world.tick();
    expect(world.entities.get(playerId)?.components.inventory?.slots[0]).toBe(null);
  });

  it('drop puts the item in front of the player', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const itemId = spawnItem(world, player.position);
    world.dispatch({ type: 'pickUp', playerId, itemId });
    world.tick();
    world.dispatch({ type: 'drop', playerId, slot: 0 });
    world.tick();
    const inv = world.entities.get(playerId)?.components.inventory;
    expect(inv?.slots[0]).toBe(null);
    const item = world.entities.get(itemId);
    expect(item?.components.item?.holder).toBeUndefined();
    const dist = Math.hypot(
      (item?.position.x ?? 0) - player.position.x,
      (item?.position.y ?? 0) - player.position.y,
      (item?.position.z ?? 0) - player.position.z,
    );
    expect(dist).toBeGreaterThan(0.5);
    expect(dist).toBeLessThan(3);
  });

  it('selectSlot switches the selected slot', () => {
    const { world, playerId } = spawnWorld();
    world.dispatch({ type: 'selectSlot', playerId, slot: 5 });
    world.tick();
    expect(world.entities.get(playerId)?.components.inventory?.selectedSlot).toBe(5);
    world.dispatch({ type: 'selectSlot', playerId, slot: 99 });
    world.tick();
    expect(world.entities.get(playerId)?.components.inventory?.selectedSlot).toBe(5);
  });
});

describe('mining nodes with the terrain tool', () => {
  it('a dig stroke on a node yields an item and depletes to the id set', () => {
    const { world, playerId } = spawnWorld();
    const node = [...world.entities.values()].find((e) => e.kind === 'node');
    if (!node) throw new Error('no nodes spawned');
    const nodeComp = node.components.node;
    if (!nodeComp) throw new Error('node has no component');
    const charges = nodeComp.charges;
    const resource = nodeComp.resourceId;
    // Stand on the node so the stroke passes the range check.
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...node.position } });
    world.tick();
    const itemsBefore = [...world.entities.values()].filter((e) => e.kind === 'item').length;
    for (let i = 0; i < charges; i += 1) {
      world.dispatch({
        type: 'terrainEdit',
        playerId,
        planetId: SELA.id,
        mode: 'dig',
        center: { ...node.position },
        radius: 2,
        strength: 0.5,
      });
      world.tick();
    }
    const itemsAfter = [...world.entities.values()].filter(
      (e) => e.kind === 'item' && e.components.item?.itemId === resource,
    ).length;
    expect(itemsAfter - itemsBefore).toBe(charges);
    expect(world.entities.has(node.id)).toBe(false);
    expect(world.depletedNodes.has(node.id)).toBe(true);
    // The deterministic placer never brings it back.
    updateNodes(world, [SELA]);
    expect(world.entities.has(node.id)).toBe(false);
  });

  it('partial mining progress survives a far despawn and respawn', () => {
    const { world, playerId } = spawnWorld();
    const node = [...world.entities.values()].find((e) => e.kind === 'node');
    if (!node) throw new Error('no nodes spawned');
    const nodeComp = node.components.node;
    if (!nodeComp) throw new Error('node has no component');
    const full = nodeComp.charges;
    expect(full).toBeGreaterThan(1);
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...node.position } });
    world.tick();
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: { ...node.position },
      radius: 2,
      strength: 0.5,
    });
    world.tick();
    expect(world.entities.get(node.id)?.components.node?.charges).toBe(full - 1);
    // Walk away (despawn) and back: the node returns with charges kept.
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const away = { ...player.position };
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: 0, y: -(SELA.radius + 50), z: 0 },
    });
    world.tick();
    updateNodes(world, [SELA]);
    expect(world.entities.has(node.id)).toBe(false);
    world.dispatch({ type: 'playerTeleport', playerId, position: away });
    world.tick();
    updateNodes(world, [SELA]);
    expect(world.entities.get(node.id)?.components.node?.charges).toBe(full - 1);
  });

  it('reloading keeps depleted nodes depleted and items where left', async () => {
    const { world, playerId } = spawnWorld(42);
    const node = [...world.entities.values()].find((e) => e.kind === 'node');
    if (!node) throw new Error('no nodes spawned');
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...node.position } });
    world.tick();
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: { ...node.position },
      radius: 2,
      strength: 0.5,
    });
    world.tick();
    const { serializeWorld, deserializeWorld } = await import('../../src/save/serialize.js');
    const revived = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))), [SELA]);
    expect(revived.depletedNodes).toEqual(world.depletedNodes);
    expect(revived.nodeCharges).toEqual(world.nodeCharges);
    for (const [id, entity] of world.entities) {
      expect(revived.entities.get(id)).toEqual(entity);
    }
  });
});
