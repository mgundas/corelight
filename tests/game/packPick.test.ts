// Cursor picking for placed structures (click-to-move): only empty
// machines/platforms in range and under the ray are packable.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT, add, normalize, quatFromAxisAngle, rotateVector, sub } from '../../src/core/math.js';
import { STATION_RANGE_M } from '../../src/core/constants.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { World } from '../../src/sim/world.js';
import { findPackableAlongRay, findStructureAlongRay } from '../../src/game/packPick.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat pack world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

function context(): {
  world: World;
  planet: PlanetConfig;
  playerId: EntityId;
  origin: { x: number; y: number; z: number };
} {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 2 },
  });
  world.tick();
  const player = [...world.entities.values()].find((e) => e.kind === 'player');
  if (!player) throw new Error('no player');
  return {
    world,
    planet,
    playerId: player.id,
    origin: { x: player.position.x, y: player.position.y + 1.5, z: player.position.z },
  };
}

describe('findPackableAlongRay', () => {
  it('targets a rotated building body using world doubles and picks the front station', () => {
    const ctx = context();
    const rotation = quatFromAxisAngle({ x: 1, y: 0, z: 1 }, 1.2);
    const position = { x: 12000, y: 1500, z: 4000 };
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player) throw new Error('missing player');
    player.position = { ...position };
    const origin = add(position, rotateVector({ x: 1.1, y: 1.4, z: -8 }, rotation));
    const dir = rotateVector({ x: 0, y: 0, z: 1 }, rotation);
    // Insert the far station first so map order cannot decide the pick.
    spawnPlaceableEntity(ctx.world, ctx.planet.id, 'research_station', add(position, rotateVector({ x: 0, y: 0, z: 3 }, rotation)), { rotation });
    const front = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'research_station', position, { rotation });
    expect(findStructureAlongRay(ctx.world, ctx.playerId, { origin, dir }, STATION_RANGE_M, (entity) => entity.kind === 'machine')).toBe(front);
    const miss = add(origin, rotateVector({ x: 3, y: 0, z: 0 }, rotation));
    expect(findStructureAlongRay(ctx.world, ctx.playerId, { origin: miss, dir }, STATION_RANGE_M, (entity) => entity.kind === 'machine')).toBeNull();
  });

  it('picks an empty platform under the cursor', () => {
    const ctx = context();
    const platform = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: 0,
      y: ctx.planet.radius,
      z: 4,
    }) as EntityId;
    const target = ctx.world.entities.get(platform)?.position;
    if (!target) throw new Error('no platform');
    const dir = normalize(sub(target, ctx.origin));
    expect(findPackableAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir })).toBe(platform);
  });

  it('ignores occupied platforms and far structures', () => {
    const ctx = context();
    const platform = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: 0,
      y: ctx.planet.radius,
      z: 4,
    }) as EntityId;
    spawnPlaceableEntity(ctx.world, ctx.planet.id, 'small_printer', { x: 0, y: ctx.planet.radius + 1, z: 4 }, {
      attachTo: platform,
      attachSlot: 0,
      rotation: { ...IDENTITY_QUAT },
    });
    const target = ctx.world.entities.get(platform)?.position;
    if (!target) throw new Error('no platform');
    // Aim at the platform rim, away from the printer body: the platform is
    // occupied, so nothing is packable there.
    const rim = { x: target.x + 1.5, y: target.y, z: target.z };
    const dir = normalize(sub(rim, ctx.origin));
    expect(findPackableAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir })).toBe(null);

    const far = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: 0,
      y: ctx.planet.radius,
      z: 30,
    }) as EntityId;
    const farPos = ctx.world.entities.get(far)?.position;
    if (!farPos) throw new Error('no far platform');
    const farDir = normalize(sub(farPos, ctx.origin));
    expect(findPackableAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir: farDir })).toBe(null);
  });
});
