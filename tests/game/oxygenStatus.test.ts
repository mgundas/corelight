// Oxygen HUD status tests (M08): arrow sectors, habitat hints only
// off-network, and lost-pack hints while the marker waits.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { SIM_DT } from '../../src/core/constants.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { arrowForBearing, oxygenStatusFor } from '../../src/game/oxygenStatus.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';

function statusWorld(): { world: World; playerId: EntityId; habitatId: EntityId } {
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
  return { world, playerId, habitatId };
}

describe('arrowForBearing', () => {
  it('maps the eight compass sectors', () => {
    expect(arrowForBearing(0)).toBe('↑');
    expect(arrowForBearing(90)).toBe('→');
    expect(arrowForBearing(180)).toBe('↓');
    expect(arrowForBearing(-90)).toBe('←');
    expect(arrowForBearing(45)).toBe('↗');
    expect(arrowForBearing(360)).toBe('↑');
  });
});

describe('oxygenStatusFor', () => {
  it('reports on-network at the habitat with no hints', () => {
    const { world, playerId } = statusWorld();
    const status = oxygenStatusFor(world, playerId);
    expect(status?.onNetwork).toBe(true);
    expect(status?.oxygen).toBe(100);
    expect(status?.habitat).toBe(null);
    expect(status?.deathMarker).toBe(null);
  });

  it('points at the habitat once off-network', () => {
    const { world, playerId } = statusWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const up = upAt(SELA, player.position);
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: player.position.x + up.x * 100, y: player.position.y + up.y * 100, z: player.position.z + up.z * 100 },
    });
    world.tick(SIM_DT);
    const status = oxygenStatusFor(world, playerId);
    expect(status?.onNetwork).toBe(false);
    expect(status?.habitat?.label).toBe('Habitat');
    expect(status?.habitat?.distM).toBeCloseTo(100, 0);
  });

  it('points at the lost pack after a death', () => {
    const { world, playerId } = statusWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const markerId = world.nextId('marker');
    world.entities.set(markerId, {
      id: markerId,
      kind: 'marker',
      planetId: player.planetId,
      position: { x: player.position.x + 10, y: player.position.y, z: player.position.z },
      rotation: { ...IDENTITY_QUAT },
      components: {},
    });
    const comp = player.components.player;
    if (!comp) throw new Error('no player comp');
    comp.deathMarkerId = markerId;
    const status = oxygenStatusFor(world, playerId);
    expect(status?.deathMarker?.label).toBe('Pack');
    expect(status?.deathMarker?.distM).toBeCloseTo(10, 0);
  });

  it('returns null with no player', () => {
    const { world } = statusWorld();
    expect(oxygenStatusFor(world, null)).toBe(null);
    expect(oxygenStatusFor(world, 'player_missing')).toBe(null);
  });

  it('marks mantle depth as hot for the heat vignette', () => {
    const { world, playerId } = statusWorld();
    expect(oxygenStatusFor(world, playerId)?.heat).toBe(false);
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    const up = upAt(SELA, player.position);
    const deep = {
      x: SELA.center.x + up.x * (SELA.radius - 180),
      y: SELA.center.y + up.y * (SELA.radius - 180),
      z: SELA.center.z + up.z * (SELA.radius - 180),
    };
    world.dispatch({ type: 'playerTeleport', playerId, position: deep });
    world.tick(SIM_DT);
    expect(oxygenStatusFor(world, playerId)?.heat).toBe(true);
    expect(oxygenStatusFor(world, playerId)?.cold).toBe(false);
  });

  it("marks Vorn's cold surface and hot mantle for the right vignette", () => {
    const world = new World(1337, { planets: [VORN] });
    world.dispatch({ type: 'spawnPlayer', planetId: VORN.id, position: findSpawnPosition(VORN, 1337) });
    world.tick(SIM_DT);
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    if (!playerId) throw new Error('no player');
    const surface = oxygenStatusFor(world, playerId);
    expect(surface?.cold).toBe(true);
    expect(surface?.heat).toBe(false);
    // Deep in the mantle the same planet switches to heat.
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player entity');
    const up = upAt(VORN, player.position);
    const r = VORN.radius - 200;
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: VORN.center.x + up.x * r, y: VORN.center.y + up.y * r, z: VORN.center.z + up.z * r },
    });
    world.tick(SIM_DT);
    const mantle = oxygenStatusFor(world, playerId);
    expect(mantle?.heat).toBe(true);
    expect(mantle?.cold).toBe(false);
  });
});
