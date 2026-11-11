// Oxygen system tests (M08): drain off-network, refill on-network,
// mantle heat doubling, canister auto-refills, and death/respawn with the
// lost-backpack marker. The tether chain integration pins the acceptance
// flow: a chain into the dark keeps the player alive.

import { beforeEach, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { OXYGEN_MAX, SIM_DT } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { hazardMultiplier, updateOxygen } from '../../src/sim/systems/oxygen.js';
import { updateTethers } from '../../src/sim/systems/tethers.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';

function oxygenWorld(): { world: World; playerId: EntityId; habitatId: EntityId } {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
  world.tick(SIM_DT);
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player entity');
  world.dispatch({ type: 'spawnHabitat', planetId: SELA.id, position: { ...player.position } });
  world.tick(SIM_DT);
  const habitatId = [...world.entities.values()].find((e) => e.kind === 'machine')?.id ?? '';
  if (!habitatId) throw new Error('no habitat');
  world.addSystem((w) => updateTethers(w, [SELA]));
  world.addSystem((w, dt) => updateOxygen(w, [SELA], dt));
  return { world, playerId, habitatId };
}

function setOxygen(world: World, playerId: EntityId, value: number): void {
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player');
  if (!player.components.oxygen) player.components.oxygen = { value };
  else player.components.oxygen.value = value;
}

function oxygenOf(world: World, playerId: EntityId): number {
  const value = world.entities.get(playerId)?.components.oxygen?.value;
  if (value === undefined) throw new Error('no oxygen component');
  return value;
}

function giveItem(world: World, playerId: EntityId, itemId: string): void {
  const player = world.entities.get(playerId);
  if (!player) throw new Error('no player');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  const inv = player.components.inventory;
  if (!inv) throw new Error('no backpack');
  const free = inv.slots.indexOf(null);
  if (free === -1) throw new Error('backpack full');
  inv.slots[free] = id;
}

describe('oxygen system', () => {
  beforeEach(() => {
    events.clear();
  });

  it('drains 1/s off-network and refills 20/s on it', () => {
    const { world, playerId } = oxygenWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const up = upAt(SELA, player.position);
    // 100 m straight up: off every network, still on the planet.
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: player.position.x + up.x * 100, y: player.position.y + up.y * 100, z: player.position.z + up.z * 100 },
    });
    world.tick(SIM_DT);
    for (let i = 0; i < 29; i += 1) world.tick(SIM_DT);
    expect(oxygenOf(world, playerId)).toBeCloseTo(OXYGEN_MAX - 1, 6);
    // Walk home: 1 s of breathing restores 20.
    const habitat = [...world.entities.values()].find((e) => e.kind === 'machine');
    if (!habitat) throw new Error('no habitat');
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...habitat.position } });
    world.tick(SIM_DT);
    for (let i = 0; i < 30; i += 1) world.tick(SIM_DT);
    expect(oxygenOf(world, playerId)).toBe(OXYGEN_MAX);
  });

  it('a live tether chain keeps a far player breathing', () => {
    const { world, playerId } = oxygenWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const habitat = [...world.entities.values()].find((e) => e.kind === 'machine');
    if (!habitat) throw new Error('no habitat');
    // Two 12 m hops of open air above the habitat: a live chain.
    const up = upAt(SELA, habitat.position);
    const hop1 = {
      x: habitat.position.x + up.x * 12,
      y: habitat.position.y + up.y * 12,
      z: habitat.position.z + up.z * 12,
    };
    const hop2 = {
      x: habitat.position.x + up.x * 24,
      y: habitat.position.y + up.y * 24,
      z: habitat.position.z + up.z * 24,
    };
    for (const pos of [hop1, hop2]) {
      const id = world.nextId('tether');
      world.entities.set(id, {
        id,
        kind: 'tether',
        planetId: SELA.id,
        position: { ...pos },
        rotation: { ...IDENTITY_QUAT },
        components: { tether: { live: false, links: [] } },
      });
    }
    setOxygen(world, playerId, 50);
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...hop2 } });
    world.tick(SIM_DT);
    for (let i = 0; i < 29; i += 1) world.tick(SIM_DT);
    // 24 m from the habitat but on the live chain: refills 20/s.
    expect(oxygenOf(world, playerId)).toBeCloseTo(70, 6);
    // Break the middle hop: the far end goes dark and drains again.
    const mid = [...world.entities.values()].find((e) => e.kind === 'tether');
    if (!mid) throw new Error('no mid post');
    world.entities.delete(mid.id);
    const before = oxygenOf(world, playerId);
    for (let i = 0; i < 30; i += 1) world.tick(SIM_DT);
    expect(oxygenOf(world, playerId)).toBeLessThan(before);
  });

  it('mantle heat doubles the drain', () => {
    const { world, playerId } = oxygenWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    // 150 m deep: mantle layer, far from any post.
    const up = upAt(SELA, player.position);
    const r = SELA.radius - 150;
    const deep = {
      x: SELA.center.x + up.x * r,
      y: SELA.center.y + up.y * r,
      z: SELA.center.z + up.z * r,
    };
    setOxygen(world, playerId, OXYGEN_MAX);
    world.dispatch({ type: 'playerTeleport', playerId, position: deep });
    world.tick(SIM_DT);
    for (let i = 0; i < 29; i += 1) world.tick(SIM_DT);
    expect(oxygenOf(world, playerId)).toBeCloseTo(OXYGEN_MAX - 2, 6);
  });

  it('hazardMultiplier pins the Vorn cold hook (renamed Sela)', () => {
    const vorn = { ...SELA, id: 'vorn' };
    const spawn = findSpawnPosition(SELA, 1337);
    const local = { x: spawn.x - SELA.center.x, y: spawn.y - SELA.center.y, z: spawn.z - SELA.center.z };
    expect(hazardMultiplier(SELA, local)).toBe(1);
    expect(hazardMultiplier(vorn, local)).toBe(1.5);
  });

  it('a canister auto-fires at 20 and refills to full', () => {    const { world, playerId } = oxygenWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const up = upAt(SELA, player.position);
    giveItem(world, playerId, 'oxygen_canister');
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: player.position.x + up.x * 100, y: player.position.y + up.y * 100, z: player.position.z + up.z * 100 },
    });
    world.tick(SIM_DT);
    // Above the threshold the canister stays packed.
    setOxygen(world, playerId, 20.5);
    world.tick(SIM_DT);
    const packBefore = world.entities.get(playerId)?.components.inventory?.slots ?? [];
    expect(packBefore.some((id) => id && world.entities.get(id)?.components.item?.itemId === 'oxygen_canister')).toBe(
      true,
    );
    // At the threshold it fires: full suit, canister gone.
    setOxygen(world, playerId, 20.0);
    world.tick(SIM_DT);
    expect(oxygenOf(world, playerId)).toBe(OXYGEN_MAX);
    const packAfter = world.entities.get(playerId)?.components.inventory?.slots ?? [];
    expect(
      packAfter.every((id) => id === null || world.entities.get(id)?.components.item?.itemId !== 'oxygen_canister'),
    ).toBe(true);
  });

  it('on-network refill never burns a canister', () => {
    const { world, playerId } = oxygenWorld();
    giveItem(world, playerId, 'oxygen_canister');
    // At the habitat (distance 0): refill only, canister stays packed.
    setOxygen(world, playerId, 15);
    world.tick(SIM_DT);
    expect(oxygenOf(world, playerId)).toBeGreaterThan(15);
    expect(oxygenOf(world, playerId)).toBeLessThan(OXYGEN_MAX);
    const pack = world.entities.get(playerId)?.components.inventory?.slots ?? [];
    expect(
      pack.some((id) => id !== null && world.entities.get(id)?.components.item?.itemId === 'oxygen_canister'),
    ).toBe(true);
  });

  it('death drops the pack, leaves a marker and respawns at the habitat', () => {
    const { world, playerId, habitatId } = oxygenWorld();
    const player = world.entities.get(playerId);
    const habitat = world.entities.get(habitatId);
    if (!player || !habitat) throw new Error('setup failed');
    giveItem(world, playerId, 'resin');
    const up = upAt(SELA, player.position);
    const deathSpot = {
      x: player.position.x + up.x * 100,
      y: player.position.y + up.y * 100,
      z: player.position.z + up.z * 100,
    };
    world.dispatch({ type: 'playerTeleport', playerId, position: deathSpot });
    world.tick(SIM_DT);
    // Stale motion must not survive the respawn (same reset as teleport).
    const dying = world.entities.get(playerId);
    if (!dying?.components.player) throw new Error('no player comp');
    dying.components.player.velocity = { x: 5, y: -9, z: 2 };
    dying.components.player.grounded = true;
    dying.components.player.embeddedTime = 3;
    dying.components.player.escaping = true;
    let died: string | null = null;
    const off = events.on('playerDied', ({ playerId: id }) => {
      died = id;
    });
    setOxygen(world, playerId, 0.01);
    world.tick(SIM_DT);
    off();
    expect(died).toBe(playerId);
    // Respawned at the habitat with a full suit.
    const respawned = world.entities.get(playerId);
    if (!respawned) throw new Error('player lost');
    expect(respawned.position.x).toBeCloseTo(habitat.position.x + up.x * 2, 6);
    expect(oxygenOf(world, playerId)).toBe(OXYGEN_MAX);
    // Motion state reset like a teleport (no fall-through or push-out).
    expect(respawned.components.player?.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(respawned.components.player?.grounded).toBe(false);
    expect(respawned.components.player?.input).toBeNull();
    expect(respawned.components.player?.embeddedTime).toBe(0);
    expect(respawned.components.player?.escaping).toBe(false);
    // The pack dropped where the player died, plus a marker.
    const markerId = respawned.components.player?.deathMarkerId;
    expect(markerId).not.toBeNull();
    const marker = markerId ? world.entities.get(markerId) : undefined;
    expect(marker?.kind).toBe('marker');
    const loose = [...world.entities.values()].filter(
      (e) => e.kind === 'item' && e.components.item?.holder === undefined,
    );
    expect(loose.length).toBeGreaterThan(0);
    for (const item of loose) {
      const d = Math.hypot(
        item.position.x - deathSpot.x,
        item.position.y - deathSpot.y,
        item.position.z - deathSpot.z,
      );
      expect(d).toBeLessThan(5);
    }
  });
});
