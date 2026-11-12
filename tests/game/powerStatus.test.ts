// M10 HUD power projection: the aimed machine reports its network totals and
// state (working / paused / idle), and looking away hides it.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';
import { powerStatusFor } from '../../src/game/powerStatus.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat power HUD world',
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
  stationId: EntityId;
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
  const player = world.entities.get(playerId);
  if (!playerId || !player) throw new Error('no player');
  const stationId = world.nextId('machine');
  world.entities.set(stationId, {
    id: stationId,
    kind: 'machine',
    planetId: planet.id,
    position: { x: player.position.x + 2, y: player.position.y - 0.4, z: player.position.z },
    rotation: { ...IDENTITY_QUAT },
    components: {
      machine: { machineType: 'small_printer' },
      placeable: { placeableId: 'small_printer' },
      printer: { recipeId: 'platform', progressS: 0, inputs: [], outputReady: null },
      power: {
        stored: 0,
        capacity: 0,
        paused: false,
        networkId: 'net',
        generation: 3,
        demand: 1,
        networkStored: 42,
        networkCapacity: 100,
      },
    },
  });
  return { world, planet, playerId, stationId };
}

describe('power HUD status', () => {
  it('shows network numbers and working/paused/idle state', () => {
    const ctx = context();
    const working = powerStatusFor(ctx.world, ctx.playerId);
    expect(working?.name).toBe('Small printer');
    expect(working?.status).toMatchObject({
      generation: 3,
      demand: 1,
      stored: 42,
      capacity: 100,
      state: 'working',
    });
    const power = ctx.world.entities.get(ctx.stationId)?.components.power;
    if (!power) throw new Error('no power');
    power.paused = true;
    expect(powerStatusFor(ctx.world, ctx.playerId)?.status.state).toBe('paused');
    power.paused = false;
    const printer = ctx.world.entities.get(ctx.stationId)?.components.printer;
    if (!printer) throw new Error('no printer');
    printer.recipeId = null;
    expect(powerStatusFor(ctx.world, ctx.playerId)?.status.state).toBe('idle');
  });

  it('hides when the machine is not in the look cone', () => {
    const ctx = context();
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player?.components.player) throw new Error('no player comp');
    player.components.player.yaw = Math.PI;
    expect(powerStatusFor(ctx.world, ctx.playerId)).toBe(null);
  });

  it('hides while flying (no player)', () => {
    const ctx = context();
    expect(powerStatusFor(ctx.world, null)).toBe(null);
  });
});
