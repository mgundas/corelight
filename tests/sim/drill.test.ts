// M12 drill tiers: the selected backpack slot decides the terrain tool's
// hardness (Mk1 2, Mk2 3, Mk3 4) and Mk3's 30% faster dig stroke. All rules
// derive from the item id, so switching slots is immediate and no extra
// drill state needs saving.

import { afterEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import {
  digSpeedMult,
  drillTierForItem,
  equippedDrillTier,
  toolHardnessFor,
} from '../../src/sim/drill.js';
import type { EntityId } from '../../src/sim/entities.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import { backpackFrame } from '../../src/game/backpackWiring.js';

afterEach(() => events.clear());

function makeWorld(): { world: World; playerId: EntityId } {
  const world = new World(1337);
  world.planets = [SELA];
  world.dispatch({
    type: 'spawnPlayer',
    planetId: SELA.id,
    position: findSpawnPosition(SELA, 1337),
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

function giveDrill(world: World, playerId: EntityId, itemId: string, slot: number): void {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  inv.slots[slot] = id;
  inv.selectedSlot = slot;
}

describe('drill tiers', () => {
  it('maps held items to tiers and hardness', () => {
    expect(drillTierForItem('drill_mk2')).toBe(2);
    expect(drillTierForItem('drill_mk3')).toBe(3);
    expect(drillTierForItem('resin')).toBe(1);
    expect(drillTierForItem(null)).toBe(1);
    const { world, playerId } = makeWorld();
    expect(equippedDrillTier(world, playerId)).toBe(1);
    expect(toolHardnessFor(world, playerId)).toBe(2);
    giveDrill(world, playerId, 'drill_mk2', 2);
    expect(equippedDrillTier(world, playerId)).toBe(2);
    expect(toolHardnessFor(world, playerId)).toBe(3);
    giveDrill(world, playerId, 'drill_mk3', 3);
    expect(toolHardnessFor(world, playerId)).toBe(4);
    expect(digSpeedMult(world, playerId)).toBeCloseTo(1.3, 10);
    // The HUD projection reads the same rule.
    expect(backpackFrame(world, playerId, false).drillTier).toBe(3);
  });

  it('ignores a drill that is not in the selected slot', () => {
    const { world, playerId } = makeWorld();
    giveDrill(world, playerId, 'drill_mk3', 5);
    const inv = world.entities.get(playerId)?.components.inventory;
    if (!inv) throw new Error('no inventory');
    inv.selectedSlot = 0;
    expect(equippedDrillTier(world, playerId)).toBe(1);
    inv.selectedSlot = 5;
    expect(equippedDrillTier(world, playerId)).toBe(3);
  });

  it('lets Mk2 dig mantle that the Mk1 tool cannot', () => {
    const mantlePoint = { x: 0, y: 200, z: 0 };
    // Mk1: mantle hardness 3 > 2, the stroke is fully blocked.
    const bare = makeWorld();
    bare.world.dispatch({ type: 'playerTeleport', playerId: bare.playerId, position: { x: 0, y: 205, z: 0 } });
    bare.world.dispatch({
      type: 'terrainEdit',
      playerId: bare.playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: mantlePoint,
      radius: 2,
      strength: 5,
    });
    bare.world.tick();
    expect(bare.world.terrainEdits.sampleCount).toBe(0);
    // Mk2: hardness 3 matches the mantle, the stroke lands.
    const mk2 = makeWorld();
    giveDrill(mk2.world, mk2.playerId, 'drill_mk2', 0);
    mk2.world.dispatch({ type: 'playerTeleport', playerId: mk2.playerId, position: { x: 0, y: 205, z: 0 } });
    mk2.world.dispatch({
      type: 'terrainEdit',
      playerId: mk2.playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: mantlePoint,
      radius: 2,
      strength: 5,
    });
    mk2.world.tick();
    expect(mk2.world.terrainEdits.sampleCount).toBeGreaterThan(0);
    expect(mk2.world.entities.get(mk2.playerId)?.components.player?.toolHardness).toBe(3);
  });

  it('Mk3 digs 30% stronger per stroke than Mk1', () => {
    const point = { x: 0, y: 300, z: 0 }; // depth 100 m: crust, hardness 2
    const digOnce = (drillItem: string | null): number => {
      const { world, playerId } = makeWorld();
      if (drillItem) giveDrill(world, playerId, drillItem, 0);
      world.dispatch({ type: 'playerTeleport', playerId, position: { x: 0, y: 300, z: 0 } });
      world.dispatch({
        type: 'terrainEdit',
        playerId,
        planetId: SELA.id,
        mode: 'dig',
        center: point,
        radius: 2,
        strength: 1,
      });
      world.tick();
      return world.terrainEdits.deltaAt(SELA, SELA.id, point.x, point.y, point.z);
    };
    const mk1 = digOnce(null);
    const mk3 = digOnce('drill_mk3');
    expect(mk1).toBeLessThan(0);
    expect(mk3 / mk1).toBeCloseTo(1.3, 6);
  });
});
