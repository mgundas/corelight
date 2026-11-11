// M09 acceptance flow, headless: mine-equivalent inputs -> starter small
// printer -> platform job -> collect -> front carry -> place on the flattened
// starting pad. Exercises the real world setup, systems and action handlers.

import { beforeAll, describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { IDENTITY_QUAT, cross, normalize, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { setupWorldSystems } from '../../src/game/worldSetup.js';
import { checkPlacement } from '../../src/sim/placeActions.js';
import { seatTetherOnGround } from '../../src/sim/tetherActions.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import type { ColliderPool, ColliderRequest, ColliderResult } from '../../src/terrain/colliderPool.js';

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

function give(world: World, playerId: EntityId, itemId: string): void {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const slot = inv.slots.indexOf(null);
  if (slot === -1) throw new Error('pack full');
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

describe('platform printing acceptance flow', () => {
  it('deposits silicates, prints, collects and places a platform', () => {
    const world = new World(1337, { planets: [SELA] });
    const setup = setupWorldSystems(world, [SELA], stubPool(), 1337, undefined);
    const playerId = setup.playerId;
    if (!playerId) throw new Error('no player');
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player entity');
    const station = [...world.entities.values()].find(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'small_printer',
    );
    if (!station) throw new Error('no starter printer');
    expect(station.components.printer).toBeDefined();
    // Two silicate in the pack; deposit both with E-equivalent actions.
    give(world, playerId, 'silicate');
    give(world, playerId, 'silicate');
    for (let i = 0; i < 2; i += 1) {
      world.dispatch({ type: 'depositToStation', playerId, stationId: station.id });
      world.tick(SIM_DT);
    }
    expect(station.components.printer?.inputs).toHaveLength(2);
    // Start the platform job; output appears after the recipe time.
    world.dispatch({
      type: 'printAtStation',
      playerId,
      stationId: station.id,
      recipeId: 'platform',
    });
    world.tick(SIM_DT);
    expect(station.components.printer?.recipeId).toBe('platform');
    for (let i = 0; i < 60; i += 1) world.tick(SIM_DT);
    expect(station.components.printer?.outputReady).toBe('platform');
    // Collect: large package goes into front carry.
    world.dispatch({ type: 'collectStation', playerId, stationId: station.id });
    world.tick(SIM_DT);
    expect(station.components.printer?.outputReady).toBe(null);
    const carriedId = world.entities.get(playerId)?.components.player?.carryingLarge;
    expect(carriedId).toBeTruthy();
    // Place on the flat pad, perpendicular to the habitat/printer axis.
    const up = normalize(sub(player.position, SELA.center));
    const ref = Math.abs(up.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const east = normalize(cross(up, ref));
    const north = normalize(cross(up, east));
    const ground = sub(player.position, { x: up.x * 2, y: up.y * 2, z: up.z * 2 });
    // Find a flat spot on the starting pad (the acceptance path: place on
    // flat ground). Scan around the player instead of assuming a direction.
    let spot: { x: number; y: number; z: number } | null = null;
    let firstReason = '';
    outer: for (let r = 2; r <= 6; r += 1) {
      for (let a = 0; a < 12; a += 1) {
        const angle = (a / 12) * Math.PI * 2;
        const lateral = {
          x: east.x * Math.cos(angle) + north.x * Math.sin(angle),
          y: east.y * Math.cos(angle) + north.y * Math.sin(angle),
          z: east.z * Math.cos(angle) + north.z * Math.sin(angle),
        };
        const anchor = {
          x: ground.x + lateral.x * r + up.x * 4,
          y: ground.y + lateral.y * r + up.y * 4,
          z: ground.z + lateral.z * r + up.z * 4,
        };
        const candidate = seatTetherOnGround(world, SELA.id, anchor);
        const check = checkPlacement(world, SELA.id, 'platform', candidate);
        if (check.ok) {
          spot = candidate;
          break outer;
        }
        if (!firstReason) firstReason = check.reason ?? '';
      }
    }
    expect(spot, `no flat pad spot (first reason: ${firstReason})`).not.toBeNull();
    if (!spot) return;
    const before = [...world.entities.values()].filter((e) => e.kind === 'platform').length;
    world.dispatch({ type: 'placePlaceable', playerId, placeableId: 'platform', position: spot });
    world.tick(SIM_DT);
    const after = [...world.entities.values()].filter((e) => e.kind === 'platform').length;
    expect(after).toBe(before + 1);
    expect(world.entities.get(playerId)?.components.player?.carryingLarge).toBe(null);
    expect(carriedId ? world.entities.has(carriedId) : false).toBe(false);
  });
});
