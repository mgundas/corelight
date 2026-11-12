// Cursor picking for grab-carry: ray/sphere test, range and ownership gates.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT, normalize, sub } from '../../src/core/math.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';
import { findItemAlongRay } from '../../src/game/grabPick.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat pick world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface Ctx {
  world: World;
  planet: PlanetConfig;
  playerId: EntityId;
  origin: { x: number; y: number; z: number };
}

function context(): Ctx {
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

function itemAt(ctx: Ctx, pos: { x: number; y: number; z: number }, holder?: EntityId): EntityId {
  const id = ctx.world.nextId('item');
  ctx.world.entities.set(id, {
    id,
    kind: 'item',
    planetId: ctx.planet.id,
    position: { ...pos },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId: 'resin', ...(holder ? { holder } : {}) } },
  });
  return id;
}

describe('findItemAlongRay', () => {
  it('picks the loose item under the cursor ray', () => {
    const ctx = context();
    const pos = { x: 0, y: ctx.planet.radius + 1, z: ctx.origin.z + 1.5 };
    const id = itemAt(ctx, pos);
    const dir = normalize(sub(pos, ctx.origin));
    expect(findItemAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir })).toBe(id);
  });

  it('ignores held items, far items and misses', () => {
    const ctx = context();
    const pos = { x: 0, y: ctx.planet.radius + 1, z: ctx.origin.z + 1.5 };
    const dir = normalize(sub(pos, ctx.origin));
    itemAt(ctx, pos, ctx.playerId);
    expect(findItemAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir })).toBe(null);

    const far = { x: 0, y: ctx.planet.radius + 1, z: ctx.origin.z + 20 };
    itemAt(ctx, far);
    const farDir = normalize(sub(far, ctx.origin));
    expect(findItemAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir: farDir })).toBe(null);

    const elsewhere = itemAt(ctx, { x: 8, y: ctx.planet.radius + 1, z: ctx.origin.z });
    const upDir = { x: 0, y: 1, z: 0 };
    expect(findItemAlongRay(ctx.world, ctx.playerId, { origin: ctx.origin, dir: upDir })).not.toBe(elsewhere);
  });
});
