// M12 acceptance flow (headless): mine ferrite/cuprite with the terrain
// tool, smelt them in a powered furnace, print Drill Mk2 at the small
// printer, equip it from a selected backpack slot and dig into the mantle.
// A second case pins the endgame rule: Mk2 cannot cut the hardness-4 core
// shell, Mk3 can. The mantle 2x drain is covered by tests/sim/oxygen.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { EntityId } from '../../src/sim/entities.js';
import { toolHardnessFor } from '../../src/sim/drill.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity } from '../../src/sim/snapUtils.js';
import { updateCrafting } from '../../src/sim/systems/crafting.js';
import { updatePower } from '../../src/sim/systems/power.js';
import { spawnHabitatEntity } from '../../src/sim/tetherActions.js';
import { World } from '../../src/sim/world.js';

interface Base {
  world: World;
  playerId: EntityId;
  smallPrinterId: EntityId;
  furnaceId: EntityId;
}

function spawnBase(unlocked: string[]): Base {
  const world = new World(1337, { planets: [SELA] });
  world.research.unlocked = [...unlocked];
  world.dispatch({
    type: 'spawnPlayer',
    planetId: SELA.id,
    position: findSpawnPosition(SELA, 1337),
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player');
  const platformId = spawnPlaceableEntity(world, SELA.id, 'platform', { ...player.position }) as EntityId;
  const smallPrinterId = spawnPlaceableEntity(world, SELA.id, 'small_printer', { ...player.position }, {
    attachTo: platformId,
    attachSlot: 0,
  }) as EntityId;
  const furnaceId = spawnPlaceableEntity(world, SELA.id, 'furnace', { ...player.position }, {
    attachTo: platformId,
    attachSlot: 1,
  }) as EntityId;
  spawnPlaceableEntity(world, SELA.id, 'solar_panel', { ...player.position }, {
    attachTo: platformId,
    attachSlot: 2,
  });
  const habitatId = spawnHabitatEntity(world, SELA.id, { ...player.position }) as EntityId;
  createCableEntity(
    world,
    SELA.id,
    { entityId: habitatId, snapIndex: 0 },
    { entityId: platformId, snapIndex: 0 },
  );
  world.sunDirection = { x: 0, y: 1, z: 0 };
  return { world, playerId, smallPrinterId, furnaceId };
}

function giveItem(world: World, playerId: EntityId, itemId: string, slot = 0): EntityId {
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
  return id;
}

/** Spawn a one-charge deposit at the player and mine it with a dig stroke. */
function mineOne(world: World, playerId: EntityId, resourceId: string): EntityId {
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player');
  const nodeId = `node_accept_${resourceId}`;
  world.entities.set(nodeId, {
    id: nodeId,
    kind: 'node',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: {
      node: { resourceId, charges: 1, maxCharges: 1, chunkKey: 'acceptance-probe' },
    },
  });
  world.dispatch({
    type: 'terrainEdit',
    playerId,
    planetId: SELA.id,
    mode: 'dig',
    center: { ...player.position },
    radius: 2,
    strength: 1,
  });
  world.tick();
  const mined = [...world.entities.values()].find(
    (e) => e.kind === 'item' && e.components.item?.itemId === resourceId && e.components.item.holder === undefined,
  );
  if (!mined) throw new Error(`mining ${resourceId} produced no item`);
  world.dispatch({ type: 'pickUp', playerId, itemId: mined.id });
  world.tick();
  return mined.id;
}

function slotOf(world: World, playerId: EntityId, itemId: EntityId): number {
  const inv = world.entities.get(playerId)?.components.inventory;
  const slot = inv ? inv.slots.indexOf(itemId) : -1;
  if (slot < 0) throw new Error(`item ${itemId} is not in the backpack`);
  return slot;
}

function runPowerAndCraft(world: World, seconds: number): void {
  const ticks = Math.ceil(seconds / SIM_DT) + 1;
  for (let i = 0; i < ticks; i += 1) {
    updatePower(world, SIM_DT);
    updateCrafting(world, SIM_DT);
  }
}

describe('M12 progression acceptance', () => {
  beforeEach(() => events.clear());

  it('mines ore, smelts it, prints Drill Mk2 and digs into the mantle', () => {
    const base = spawnBase(['smelting', 'drill_mk2']);
    const { world, playerId, smallPrinterId, furnaceId } = base;
    const ferrite = mineOne(world, playerId, 'ferrite_ore');
    const cuprite = mineOne(world, playerId, 'cuprite_ore');
    expect(world.entities.get(ferrite)?.components.item?.holder).toBe(playerId);
    expect(world.entities.get(cuprite)?.components.item?.holder).toBe(playerId);

    // Powered furnace: 10 s per ore (3/s generated vs 2/s demand).
    for (const [item, recipe] of [
      [ferrite, 'smelt_iron'],
      [cuprite, 'smelt_copper'],
    ] as const) {
      world.dispatch({ type: 'selectSlot', playerId, slot: slotOf(world, playerId, item) });
      world.dispatch({ type: 'depositToStation', playerId, stationId: furnaceId });
      world.tick();
      world.dispatch({ type: 'printAtStation', playerId, stationId: furnaceId, recipeId: recipe });
      world.tick();
      runPowerAndCraft(world, 10);
      expect(world.entities.get(furnaceId)?.components.printer?.outputReady).not.toBe(null);
      world.dispatch({ type: 'collectStation', playerId, stationId: furnaceId });
      world.tick();
    }
    const inv = world.entities.get(playerId)?.components.inventory;
    const carried = (inv?.slots ?? []).map((id) =>
      id ? world.entities.get(id)?.components.item?.itemId : null,
    );
    expect(carried).toContain('iron');
    expect(carried).toContain('copper');

    // Small printer: Drill Mk2 (1 iron + 1 copper, 3 s at 1/s).
    for (const itemId of ['iron', 'copper']) {
      const id = (inv?.slots ?? []).find(
        (slotId) => slotId && world.entities.get(slotId)?.components.item?.itemId === itemId,
      );
      if (!id) throw new Error(`missing ${itemId}`);
      world.dispatch({ type: 'selectSlot', playerId, slot: slotOf(world, playerId, id) });
      world.dispatch({ type: 'depositToStation', playerId, stationId: smallPrinterId });
      world.tick();
    }
    world.dispatch({
      type: 'printAtStation',
      playerId,
      stationId: smallPrinterId,
      recipeId: 'drill_mk2',
    });
    world.tick();
    runPowerAndCraft(world, 3);
    expect(world.entities.get(smallPrinterId)?.components.printer?.outputReady).toBe('drill_mk2');
    world.dispatch({ type: 'collectStation', playerId, stationId: smallPrinterId });
    world.tick();
    const drillId = [...world.entities.values()].find(
      (e) => e.kind === 'item' && e.components.item?.itemId === 'drill_mk2' && e.components.item.holder === playerId,
    )?.id;
    if (!drillId) throw new Error('Drill Mk2 not in the backpack');
    world.dispatch({ type: 'selectSlot', playerId, slot: slotOf(world, playerId, drillId) });
    world.tick();
    expect(toolHardnessFor(world, playerId)).toBe(3);

    // Mantle (hardness 3) is now diggable. The old Mk1 tool was pinned as
    // blocked by tests/sim/terrainEdit.test.ts.
    const mantle = { x: SELA.center.x, y: SELA.center.y + 200, z: SELA.center.z };
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: SELA.center.x, y: SELA.center.y + 205, z: SELA.center.z },
    });
    const before = world.terrainEdits.sampleCount;
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: mantle,
      radius: 2,
      strength: 2,
    });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.toolHardness).toBe(3);
    expect(world.terrainEdits.sampleCount).toBeGreaterThan(before);
  });

  it('Mk3 breaks the hardness-4 core shell; Mk2 cannot', () => {
    const digShell = (drill: string | null): number => {
      const { world, playerId } = spawnBase([]);
      if (drill) giveItem(world, playerId, drill, 0);
      const shellLocal = { x: 0, y: 43, z: 0 }; // between r=40 and r=46
      world.dispatch({
        type: 'playerTeleport',
        playerId,
        position: { ...shellLocal },
      });
      world.dispatch({
        type: 'terrainEdit',
        playerId,
        planetId: SELA.id,
        mode: 'dig',
        center: { ...shellLocal },
        radius: 2,
        strength: 2,
      });
      world.tick();
      return world.terrainEdits.sampleCount;
    };
    expect(digShell('drill_mk2')).toBe(0);
    expect(digShell('drill_mk3')).toBeGreaterThan(0);
    // Mk3 also outranks Mk2's hardness from the selected slot.
    const { world, playerId } = spawnBase([]);
    giveItem(world, playerId, 'drill_mk3', 0);
    expect(toolHardnessFor(world, playerId)).toBe(4);
  });
});
