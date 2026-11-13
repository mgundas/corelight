// M14 shuttle actions: fuel loading (max two), boarding/disembarking rules
// and validated flight input.

import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { slotFree } from '../../src/sim/snapUtils.js';
import { isEntityEmpty } from '../../src/sim/packActions.js';
import { World } from '../../src/sim/world.js';

function spawnWorld(): { world: World; playerId: EntityId; shuttleId: EntityId } {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: SELA.id,
    position: { x: 0, y: SELA.radius, z: 0 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  const shuttleId = spawnPlaceableEntity(world, SELA.id, 'shuttle', {
    x: 0,
    y: SELA.radius,
    z: 0,
  });
  if (!playerId || !shuttleId) throw new Error('fixture failed');
  return { world, playerId, shuttleId };
}

function giveItem(world: World, playerId: EntityId, itemId: string, slot: number): EntityId {
  const player = world.entities.get(playerId);
  const inventory = player?.components.inventory;
  if (!player || !inventory) throw new Error('no inventory');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  inventory.slots[slot] = id;
  inventory.selectedSlot = slot;
  return id;
}

describe('shuttle placement', () => {
  beforeEach(() => events.clear());

  it('stands on a platform slot and blocks packing that platform', () => {
    const world = new World(1337, { planets: [SELA] });
    const surface = { x: 0, y: SELA.radius, z: 0 };
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: surface });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    const player = world.entities.get(playerId);
    if (!player?.components.player) throw new Error('no player');
    const platformId = spawnPlaceableEntity(world, SELA.id, 'platform', surface);
    if (!platformId) throw new Error('no platform');
    const packageId = world.nextId('item');
    world.entities.set(packageId, {
      id: packageId,
      kind: 'item',
      planetId: SELA.id,
      position: { ...surface },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'shuttle_package', holder: playerId } },
    });
    player.components.player.carryingLarge = packageId;
    world.dispatch({
      type: 'placePlaceable',
      playerId,
      placeableId: 'shuttle',
      position: { ...surface },
      slot: { entityId: platformId, slotIndex: 0 },
    });
    world.tick();
    const shuttles = [...world.entities.values()].filter((e) => e.kind === 'shuttle');
    expect(shuttles).toHaveLength(1);
    expect(shuttles[0]?.components.placeable?.attachedTo).toBe(platformId);
    expect(slotFree(world, { entityId: platformId, slotIndex: 0 })).toBe(false);
    const platform = world.entities.get(platformId);
    if (!platform) throw new Error('platform gone');
    expect(isEntityEmpty(world, platform)).toBe(false);
  });
});

describe('shuttle fuel loading', () => {
  beforeEach(() => events.clear());

  it('loads one fuel cell at a time up to two', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    giveItem(world, playerId, 'fuel_cell', 0);
    giveItem(world, playerId, 'fuel_cell', 1);
    const shuttleComp = () => world.entities.get(shuttleId)?.components.shuttle;
    world.dispatch({ type: 'loadShuttleFuel', playerId, shuttleId });
    world.tick();
    expect(shuttleComp()?.fuel).toBe(1);
    world.dispatch({ type: 'loadShuttleFuel', playerId, shuttleId });
    world.tick();
    expect(shuttleComp()?.fuel).toBe(2);
    // A third cell is refused (both side slots full).
    giveItem(world, playerId, 'fuel_cell', 2);
    world.dispatch({ type: 'loadShuttleFuel', playerId, shuttleId });
    world.tick();
    expect(shuttleComp()?.fuel).toBe(2);
    expect(
      [...world.entities.values()].filter((e) => e.components.item?.itemId === 'fuel_cell'),
    ).toHaveLength(1);
  });

  it('refuses a cell out of range or without one in the pack', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'loadShuttleFuel', playerId, shuttleId });
    world.tick();
    expect(world.entities.get(shuttleId)?.components.shuttle?.fuel).toBe(0);
    giveItem(world, playerId, 'fuel_cell', 0);
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: 0, y: SELA.radius + 20, z: 0 },
    });
    world.tick();
    world.dispatch({ type: 'loadShuttleFuel', playerId, shuttleId });
    world.tick();
    expect(world.entities.get(shuttleId)?.components.shuttle?.fuel).toBe(0);
  });
});

describe('boarding and disembarking', () => {
  beforeEach(() => events.clear());

  it('boards an empty shuttle and attaches the pilot', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId).toBe(shuttleId);
    expect(world.entities.get(shuttleId)?.components.shuttle?.pilotId).toBe(playerId);
    expect(world.entities.get(playerId)?.position).toEqual(world.entities.get(shuttleId)?.position);
  });

  it('refuses boarding out of range and a shuttle already occupied', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: 40, y: SELA.radius, z: 0 },
    });
    world.tick();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId ?? null).toBe(null);
  });

  it('refuses boarding a moving ship', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    const shuttle = world.entities.get(shuttleId)!;
    shuttle.components.shuttle!.airborne = true;
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId ?? null).toBe(null);
    expect(shuttle.components.shuttle?.pilotId ?? null).toBe(null);
  });

  it('stays aboard in deep space (no surface to step onto)', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const shuttle = world.entities.get(shuttleId)!;
    const player = world.entities.get(playerId)!;
    shuttle.planetId = null;
    player.planetId = null;
    world.dispatch({ type: 'exitShuttle', playerId });
    world.tick();
    expect(player.components.player?.pilotingShuttleId).toBe(shuttleId);
    expect(shuttle.components.shuttle?.pilotId).toBe(playerId);
  });

  it('disembarks only when landed and slow, stepping out beside the ship', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const shuttle = world.entities.get(shuttleId);
    if (!shuttle?.components.shuttle) throw new Error('no shuttle');
    shuttle.components.shuttle.airborne = true;
    world.dispatch({ type: 'exitShuttle', playerId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId).toBe(shuttleId);
    shuttle.components.shuttle.airborne = false;
    shuttle.components.shuttle.velocity = { x: 4, y: 0, z: 0 };
    world.dispatch({ type: 'exitShuttle', playerId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId).toBe(shuttleId);
    shuttle.components.shuttle.velocity = { x: 0, y: 0, z: 0 };
    world.dispatch({ type: 'exitShuttle', playerId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId ?? null).toBe(null);
    expect(world.entities.get(shuttleId)?.components.shuttle?.pilotId ?? null).toBe(null);
    const playerPos = world.entities.get(playerId)?.position;
    const shipPos = world.entities.get(shuttleId)?.position;
    if (!playerPos || !shipPos) throw new Error('missing positions');
    expect(Math.hypot(playerPos.x - shipPos.x, playerPos.y - shipPos.y, playerPos.z - shipPos.z)).toBeGreaterThan(1);
  });
});

describe('shuttle input action', () => {
  beforeEach(() => events.clear());

  it('accepts finite input only from the actual pilot and clamps it', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({
      type: 'shuttleInput',
      playerId,
      shuttleId,
      input: { thrust: 1, yawRate: 0, lift: false, boost: false, lookYaw: 0, lookPitch: 0 },
    });
    world.tick();
    expect(world.entities.get(shuttleId)?.components.shuttle?.input).toBe(null);
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    world.dispatch({
      type: 'shuttleInput',
      playerId,
      shuttleId,
      input: { thrust: NaN, yawRate: 0, lift: false, boost: false, lookYaw: 0, lookPitch: 0 },
    });
    world.tick();
    expect(world.entities.get(shuttleId)?.components.shuttle?.input).toBe(null);
    world.dispatch({
      type: 'shuttleInput',
      playerId,
      shuttleId,
      input: { thrust: 3, yawRate: -5, lift: true, boost: true, lookYaw: 0.4, lookPitch: -0.3 },
    });
    world.tick();
    const input = world.entities.get(shuttleId)?.components.shuttle?.input;
    expect(input).toEqual({
      thrust: 1,
      yawRate: -1,
      lift: true,
      boost: true,
      lookYaw: 0.4,
      lookPitch: -0.3,
    });
  });
});
