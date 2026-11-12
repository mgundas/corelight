// M10 cable tool state: first click arms a source, second click connects,
// clicking a cabled snap cuts, and E exits. The sim action still
// validates range/freeness; this test pins the click-click gesture.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { normalize, sub } from '../../src/core/math.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity, snapWorld } from '../../src/sim/snapUtils.js';
import { World } from '../../src/sim/world.js';
import { CableMode } from '../../src/game/cableMode.js';
import type { ToolAim } from '../../src/player/terrainTool.js';
import { HEAD_HEIGHT } from '../../src/player/cameraRig.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat cable tool world',
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
  a: EntityId;
  b: EntityId;
}

function context(): Ctx {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 0 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  const a = spawnPlaceableEntity(world, planet.id, 'platform', {
    x: -2,
    y: planet.radius,
    z: 0,
  }) as EntityId;
  const b = spawnPlaceableEntity(world, planet.id, 'platform', {
    x: 2,
    y: planet.radius,
    z: 0,
  }) as EntityId;
  return { world, planet, playerId, a, b };
}

function aimAt(ctx: Ctx, entityId: EntityId, snapIndex: number): ToolAim {
  const player = ctx.world.entities.get(ctx.playerId);
  const entity = ctx.world.entities.get(entityId);
  if (!player || !entity) throw new Error('missing entity');
  const origin = { x: player.position.x, y: player.position.y + HEAD_HEIGHT, z: player.position.z };
  const point = snapWorld(entity, snapIndex);
  if (!point) throw new Error('no snap world');
  return {
    hit: null,
    normal: null,
    planet: ctx.planet,
    ray: { origin, dir: normalize(sub(point, origin)) },
  };
}

describe('cable tool', () => {
  it('arms a source then connects to a second snap', () => {
    const ctx = context();
    const mode = new CableMode();
    mode.activate();
    const aSnap = { entityId: ctx.a, snapIndex: 2 };
    const bSnap = { entityId: ctx.b, snapIndex: 0 };
    expect(mode.tick(ctx.world, ctx.playerId, aimAt(ctx, ctx.a, 2), true)).toBe(null);
    expect(mode.pendingRef()).toEqual(aSnap);
    // Release then click: a fresh edge on the second snap.
    expect(mode.tick(ctx.world, ctx.playerId, aimAt(ctx, ctx.b, 0), false)).toBe(null);
    const request = mode.tick(ctx.world, ctx.playerId, aimAt(ctx, ctx.b, 0), true);
    expect(request).toEqual({ type: 'connect', from: aSnap, to: bSnap });
    expect(mode.pendingRef()).toBe(null);
    ctx.world.dispatch({
      type: 'connectCable',
      playerId: ctx.playerId,
      from: aSnap,
      to: bSnap,
    });
    ctx.world.tick();
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'cable')).toHaveLength(1);
  });

  it('cuts a cable when clicking an occupied snap', () => {
    const ctx = context();
    const cableId = createCableEntity(
      ctx.world,
      ctx.planet.id,
      { entityId: ctx.a, snapIndex: 2 },
      { entityId: ctx.b, snapIndex: 0 },
    ) as EntityId;
    const mode = new CableMode();
    mode.activate();
    const request = mode.tick(ctx.world, ctx.playerId, aimAt(ctx, ctx.a, 2), true);
    expect(request).toEqual({ type: 'disconnect', cableId });
  });

  it('keeps the pending source on a non-primary tick (RMB is unbound)', () => {
    const ctx = context();
    const mode = new CableMode();
    mode.activate();
    mode.tick(ctx.world, ctx.playerId, aimAt(ctx, ctx.a, 2), true);
    expect(mode.pendingRef()).not.toBe(null);
    expect(mode.tick(ctx.world, ctx.playerId, aimAt(ctx, ctx.b, 0), false)).toBe(null);
    expect(mode.isActive()).toBe(true);
    expect(mode.pendingRef()).not.toBe(null);
  });
});
