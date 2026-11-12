// M09 placement + light sticks: a flat synthetic planet isolates the rules
// (normal within 20 deg, free space, near the surface, out of reach,
// overlapping structures) from Sela's noisy terrain.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { World } from '../../src/sim/world.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import {
  checkPlacement,
  isGroundFlat,
  spawnPlaceableEntity,
} from '../../src/sim/placeActions.js';
import { itemDef } from '../../src/data/loadData.js';
import { placeableDef } from '../../src/data/loadPlaceables.js';
import type { EntityId } from '../../src/sim/entities.js';

/** Sela with no relief and no caves: a perfect sphere, easy to place on. */
function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat test world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface FlatWorld {
  world: World;
  playerId: EntityId;
  planet: PlanetConfig;
  surface: { x: number; y: number; z: number };
}

function flatWorld(): FlatWorld {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  const surface = { x: 0, y: planet.radius, z: 0 };
  world.dispatch({ type: 'spawnPlayer', planetId: planet.id, position: { x: 0, y: planet.radius + 0.9, z: 2 } });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId, planet, surface };
}

function give(world: World, playerId: EntityId, itemId: string, slot = 0): EntityId {
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

describe('placement rules', () => {
  it('accepts a flat, clear surface spot', () => {
    const { world, planet, surface } = flatWorld();
    const check = checkPlacement(world, planet.id, 'platform', surface);
    expect(check).toEqual({ ok: true, reason: null });
  });

  it('rejects rock, air, steep slopes, and occupied spots', () => {
    const { world, planet, surface, playerId } = flatWorld();
    // Below the surface is rock.
    const inside = checkPlacement(world, planet.id, 'platform', {
      x: surface.x,
      y: surface.y - 2.0,
      z: surface.z,
    });
    expect(inside.ok).toBe(false);
    expect(inside.reason).toBe('Inside rock');
    // A metre above the surface is air.
    const air = checkPlacement(world, planet.id, 'platform', {
      x: surface.x,
      y: surface.y + 1.0,
      z: surface.z,
    });
    expect(air.ok).toBe(false);
    // Slope rule directly: 10 deg is fine, 30 deg is not.
    const up = { x: 0, y: 1, z: 0 };
    const tilt = (deg: number) => ({
      x: Math.sin((deg * Math.PI) / 180),
      y: Math.cos((deg * Math.PI) / 180),
      z: 0,
    });
    expect(isGroundFlat(tilt(10), up)).toBe(true);
    expect(isGroundFlat(tilt(10), up)).toBe(true);
    expect(isGroundFlat(tilt(19.9), up)).toBe(true);
    expect(isGroundFlat(tilt(20.1), up)).toBe(false);
    expect(isGroundFlat(tilt(30), up)).toBe(false);
    // Occupy the spot with a platform: the next placement must refuse it.
    const check = checkPlacement(world, planet.id, 'platform', surface);
    expect(check.ok).toBe(true);
    spawnPlaceableEntity(world, planet.id, 'platform', surface);
    const occupied = checkPlacement(world, planet.id, 'platform', surface);
    expect(occupied.ok).toBe(false);
    expect(occupied.reason).toBe('Too close to another structure');
    // Also verify a package-less spawn produced the entity (test setup).
    expect(
      [...world.entities.values()].some((e) => e.kind === 'platform' && e.planetId === planet.id),
    ).toBe(true);
    // The player exists but is ignored by occupancy.
    expect(world.entities.get(playerId)).toBeDefined();
  });

  it('blocks ground placement under a structure in the same footprint column', () => {
    const { world, planet, surface } = flatWorld();
    const floatingId = world.nextId('platform');
    world.entities.set(floatingId, {
      id: floatingId,
      kind: 'platform',
      planetId: planet.id,
      position: { x: surface.x, y: surface.y + 10, z: surface.z },
      rotation: { ...IDENTITY_QUAT },
      components: { placeable: { placeableId: 'platform' } },
    });
    const under = checkPlacement(world, planet.id, 'platform', surface);
    expect(under.ok).toBe(false);
    expect(under.reason).toBe('Too close to another structure');
    // Move it clear laterally: the ground spot is free again.
    const moved = world.entities.get(floatingId);
    if (!moved) throw new Error('missing floating platform');
    moved.position = { x: surface.x + 6, y: surface.y + 10, z: surface.z };
    expect(checkPlacement(world, planet.id, 'platform', surface)).toEqual({ ok: true, reason: null });
  });

  it('places a carried platform package on the ground', () => {
    const { world, playerId, planet, surface } = flatWorld();
    const packageItem = placeableDef('platform').packageItem;
    const packageId = give(world, playerId, packageItem);
    world.dispatch({ type: 'placePlaceable', playerId, placeableId: 'platform', position: surface });
    world.tick();
    expect(world.entities.has(packageId)).toBe(false);
    expect(world.entities.get(playerId)?.components.inventory?.slots[0]).toBe(null);
    const platforms = [...world.entities.values()].filter((e) => e.kind === 'platform');
    expect(platforms).toHaveLength(1);
    expect(platforms[0]?.components.placeable?.placeableId).toBe('platform');
    expect(platforms[0]?.planetId).toBe(planet.id);
  });

  it('front-carries large packages and rejects placement out of reach', () => {
    const { world, playerId, surface } = flatWorld();
    // A loose large package on the ground at the player's feet.
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const packageItem = placeableDef('platform').packageItem;
    const looseId = world.nextId('item');
    world.entities.set(looseId, {
      id: looseId,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: packageItem } },
    });
    world.dispatch({ type: 'pickUp', playerId, itemId: looseId });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.carryingLarge).toBe(looseId);
    expect(world.entities.get(playerId)?.components.inventory?.slots).not.toContain(looseId);
    // Out of reach: 20 m from the player.
    const far = { x: surface.x + 20, y: surface.y, z: surface.z };
    world.dispatch({ type: 'placePlaceable', playerId, placeableId: 'platform', position: far });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.carryingLarge).toBe(looseId);
    expect(world.entities.has(looseId)).toBe(true);
    // Dropping the large package with Q (empty selected slot) clears the carry.
    world.dispatch({ type: 'drop', playerId, slot: 0 });
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.carryingLarge).toBe(null);
    expect(world.entities.get(looseId)?.components.item?.holder).toBeUndefined();
  });

  it('seats a light stick ahead of the player and removes it from the pack', () => {
    const { world, playerId, planet } = flatWorld();
    const stickId = give(world, playerId, 'light_stick');
    world.dispatch({ type: 'placeLightstick', playerId });
    world.tick();
    expect(world.entities.has(stickId)).toBe(false);
    expect(world.entities.get(playerId)?.components.inventory?.slots[0]).toBe(null);
    const sticks = [...world.entities.values()].filter((e) => e.kind === 'lightstick');
    expect(sticks).toHaveLength(1);
    const stick = sticks[0];
    expect(stick?.components.item?.itemId).toBe('light_stick');
    expect(stick?.planetId).toBe(planet.id);
    // Emits light per the item catalog (drives the point-light pool).
    expect(itemDef('light_stick').emitsLight).toBeDefined();
    // Seated near the player, on the surface (not inside the capsule).
    const player = world.entities.get(playerId);
    if (!stick || !player) throw new Error('missing entities');
    const dist = Math.hypot(
      stick.position.x - player.position.x,
      stick.position.y - player.position.y,
      stick.position.z - player.position.z,
    );
    expect(dist).toBeGreaterThan(1);
    expect(dist).toBeLessThan(4);
    expect(stick.position.y).toBeCloseTo(planet.radius, 1);
  });

  it('only places a light stick from the selected slot', () => {
    const { world, playerId } = flatWorld();
    const stickId = give(world, playerId, 'light_stick', 0);
    world.dispatch({ type: 'selectSlot', playerId, slot: 1 });
    world.tick();
    world.dispatch({ type: 'placeLightstick', playerId });
    world.tick();
    expect([...world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(0);
    expect(world.entities.has(stickId)).toBe(true);
    world.dispatch({ type: 'selectSlot', playerId, slot: 0 });
    world.tick();
    world.dispatch({ type: 'placeLightstick', playerId });
    world.tick();
    expect([...world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(1);
    expect(world.entities.has(stickId)).toBe(false);
  });
});
