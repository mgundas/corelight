// M10 cable rules: source/target within 10 m, both snaps free, same planet,
// player in reach; disconnect removes the graph edge. These are the sim
// guards behind the C-tool's click-click flow.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { World } from '../../src/sim/world.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat cable world',
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

function context(gap = 4): Ctx {
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
    x: -gap / 2,
    y: planet.radius,
    z: 0,
  }) as EntityId;
  const b = spawnPlaceableEntity(world, planet.id, 'platform', {
    x: gap / 2,
    y: planet.radius,
    z: 0,
  }) as EntityId;
  return { world, planet, playerId, a, b };
}

function connect(ctx: Ctx, aSnap = 2, bSnap = 0): void {
  ctx.world.dispatch({
    type: 'connectCable',
    playerId: ctx.playerId,
    from: { entityId: ctx.a, snapIndex: aSnap },
    to: { entityId: ctx.b, snapIndex: bSnap },
  });
  ctx.world.tick();
}

function cables(ctx: Ctx) {
  return [...ctx.world.entities.values()].filter((e) => e.kind === 'cable');
}

describe('cable actions', () => {
  it('connects two free snaps with a cable entity', () => {
    const ctx = context();
    connect(ctx);
    expect(cables(ctx)).toHaveLength(1);
    const cable = cables(ctx)[0]?.components.cable;
    expect(cable?.a.entityId).toBe(ctx.a);
    expect(cable?.a.snapIndex).toBe(2);
    expect(cable?.b.entityId).toBe(ctx.b);
    expect(cable?.b.snapIndex).toBe(0);
  });

  it('rejects an occupied snap, a too-long run, a cross-planet target and a self cable', () => {
    const ctx = context();
    connect(ctx);
    connect(ctx); // both snaps already cabled
    expect(cables(ctx)).toHaveLength(1);
    // Too long: move the second platform 20 m away.
    const far = spawnPlaceableEntity(ctx.world, ctx.planet.id, 'platform', {
      x: 30,
      y: ctx.planet.radius,
      z: 0,
    }) as EntityId;
    ctx.world.dispatch({
      type: 'connectCable',
      playerId: ctx.playerId,
      from: { entityId: ctx.a, snapIndex: 0 },
      to: { entityId: far, snapIndex: 0 },
    });
    ctx.world.tick();
    expect(cables(ctx)).toHaveLength(1);
    // Cross-planet target (a hand-edited save shape) is ignored.
    const foreignId = ctx.world.nextId('platform');
    ctx.world.entities.set(foreignId, {
      id: foreignId,
      kind: 'platform',
      planetId: 'elsewhere',
      position: { x: 1, y: ctx.planet.radius, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: { placeable: { placeableId: 'platform' } },
    });
    ctx.world.dispatch({
      type: 'connectCable',
      playerId: ctx.playerId,
      from: { entityId: ctx.a, snapIndex: 0 },
      to: { entityId: foreignId, snapIndex: 0 },
    });
    ctx.world.tick();
    expect(cables(ctx)).toHaveLength(1);
    // Self cable: rejected even with two free snaps.
    ctx.world.dispatch({
      type: 'connectCable',
      playerId: ctx.playerId,
      from: { entityId: ctx.a, snapIndex: 0 },
      to: { entityId: ctx.a, snapIndex: 1 },
    });
    ctx.world.tick();
    expect(cables(ctx)).toHaveLength(1);
  });

  it('disconnects by id and enforces player reach', () => {
    const ctx = context();
    connect(ctx);
    const cableId = cables(ctx)[0]?.id as EntityId;
    // Far away: the cut is rejected.
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player) throw new Error('no player');
    const home = { ...player.position };
    ctx.world.dispatch({
      type: 'playerTeleport',
      playerId: ctx.playerId,
      position: { x: home.x + 50, y: home.y, z: home.z },
    });
    ctx.world.tick();
    ctx.world.dispatch({ type: 'disconnectCable', playerId: ctx.playerId, cableId });
    ctx.world.tick();
    expect(cables(ctx)).toHaveLength(1);
    // Back in reach: removed.
    ctx.world.dispatch({ type: 'playerTeleport', playerId: ctx.playerId, position: home });
    ctx.world.tick();
    ctx.world.dispatch({ type: 'disconnectCable', playerId: ctx.playerId, cableId });
    ctx.world.tick();
    expect(cables(ctx)).toHaveLength(0);
  });
});
