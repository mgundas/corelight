import { describe, expect, it } from 'vitest';
import { DEV_ITEM_MAX_COUNT } from '../../src/core/constants.js';
import { ITEMS } from '../../src/data/loadData.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { deserializeWorld, serializeWorld } from '../../src/save/serialize.js';
import { isLargePackage } from '../../src/sim/inventoryActions.js';
import { World } from '../../src/sim/world.js';

function setup() {
  const world = new World(1337, { planets: [SELA, VORN] });
  world.dispatch({ type: 'spawnPlayer', planetId: VORN.id,
    position: { x: VORN.center.x, y: VORN.center.y + VORN.radius + 2, z: VORN.center.z } });
  world.tick();
  const player = [...world.entities.values()][0]!;
  const grant = (itemId: string, count = 1) => {
    world.dispatch({ type: 'debugGiveItem', playerId: player.id, itemId, count });
    world.tick();
  };
  return { world, player, grant };
}

describe('dev item grants', () => {
  it.each(ITEMS.map((item) => item.id))('can give the catalog item %s without recipe inputs or research', (itemId) => {
    const { world, player, grant } = setup();
    grant(itemId);
    const item = [...world.entities.values()].find((e) => e.components.item?.itemId === itemId)!;
    expect(item).toBeDefined();
    expect(item.planetId).toBe(VORN.id);
    expect(item.components.item?.holder).toBe(player.id);
    if (isLargePackage(itemId)) expect(player.components.player?.carryingLarge).toBe(item.id);
    else expect(player.components.inventory?.slots).toContain(item.id);
    expect(world.research.unlocked).toEqual([]);
  });

  it('gives batches and safely drops overflow on the player planet, preserving existing items', () => {
    const { world, player, grant } = setup();
    grant('resin', DEV_ITEM_MAX_COUNT);
    const held = [...player.components.inventory!.slots];
    grant('copper', DEV_ITEM_MAX_COUNT);
    expect(player.components.inventory?.slots).toEqual(held);
    const loose = [...world.entities.values()].filter((e) => e.components.item?.itemId === 'copper');
    expect(loose).toHaveLength(DEV_ITEM_MAX_COUNT);
    expect(new Set(loose.map((item) => item.id)).size).toBe(DEV_ITEM_MAX_COUNT);
    for (const item of loose) {
      expect(item.components.item?.holder).toBeUndefined();
      expect(item.position.y).toBeGreaterThan(player.position.y);
      expect(item.position.x).toBe(VORN.center.x);
      expect(item.planetId).toBe(VORN.id);
    }
  });

  it('carries one large package and drops the others, and survives a save round trip', () => {
    const { world, player, grant } = setup();
    grant('shuttle_package', 4);
    const items = [...world.entities.values()].filter((e) => e.components.item);
    expect(items.filter((e) => e.components.item?.holder === player.id)).toHaveLength(1);
    expect(items.filter((e) => e.components.item?.holder === undefined)).toHaveLength(3);
    expect(player.components.inventory?.slots.every((id) => id === null)).toBe(true);
    const restored = deserializeWorld(serializeWorld(world), [SELA, VORN]);
    expect(serializeWorld(restored)).toEqual(serializeWorld(world));
  });

  it.each([0, -1, 1.5, DEV_ITEM_MAX_COUNT + 1, NaN, Infinity])('rejects malformed quantity %s', (count) => {
    const { world, grant } = setup();
    grant('copper', count);
    expect(world.entities.size).toBe(1);
  });

  it('rejects unknown items, missing players, and a player in deep space', () => {
    const { world, player, grant } = setup();
    grant('made_up');
    world.dispatch({ type: 'debugGiveItem', playerId: 'missing', itemId: 'copper', count: 1 });
    world.tick();
    player.planetId = null;
    grant('copper');
    expect(world.entities.size).toBe(1);
  });
});
