// M14 oxygen/respawn rules: a pilot breathes from the shuttle's life support
// and the respawn point is the last habitat the player stood near (including
// an outpost on another planet).

import { beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { events } from '../../src/core/events.js';
import { distance } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { updateOxygen } from '../../src/sim/systems/oxygen.js';
import { spawnHabitatEntity } from '../../src/sim/tetherActions.js';
import { World } from '../../src/sim/world.js';

function worldWithPlayer(planetId: string, position: { x: number; y: number; z: number }): {
  world: World;
  playerId: EntityId;
} {
  const world = new World(1337, { planets: [SELA, VORN] });
  world.dispatch({ type: 'spawnPlayer', planetId, position });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

function oxygenOf(world: World, playerId: EntityId): number {
  return world.entities.get(playerId)?.components.oxygen?.value ?? -1;
}

describe('pilot life support', () => {
  beforeEach(() => events.clear());

  it('keeps a pilot at full oxygen in space and never kills them', () => {
    const { world, playerId } = worldWithPlayer(SELA.id, { x: 0, y: SELA.radius, z: 0 });
    const shuttleId = spawnPlaceableEntity(world, SELA.id, 'shuttle', {
      x: 0,
      y: SELA.radius,
      z: 0,
    });
    if (!shuttleId) throw new Error('no shuttle');
    const player = world.entities.get(playerId)!;
    const shuttle = world.entities.get(shuttleId)!;
    player.components.oxygen!.value = 0;
    player.components.player!.pilotingShuttleId = shuttleId;
    shuttle.components.shuttle!.pilotId = playerId;
    // Outside every SOI: without life support this would drain and kill.
    player.planetId = null;
    player.position = { x: 0, y: 200000, z: 0 };
    updateOxygen(world, [SELA, VORN], SIM_DT);
    expect(oxygenOf(world, playerId)).toBe(100);
    expect(world.entities.get(playerId)?.planetId).toBe(null);
  });

  it('drains the suit again once back on foot', () => {
    const { world, playerId } = worldWithPlayer(VORN.id, { x: 0, y: VORN.radius, z: 0 });
    const player = world.entities.get(playerId)!;
    player.components.oxygen!.value = 50;
    updateOxygen(world, [SELA, VORN], 1);
    // Vorn surface cold is 1.5x the base drain.
    expect(oxygenOf(world, playerId)).toBeCloseTo(48.5, 5);
  });
});

describe('last-habitat respawn', () => {
  beforeEach(() => events.clear());

  it('records the habitat the player stood near and keeps it after walking away', () => {
    const world = new World(1337, { planets: [SELA, VORN] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: VORN.id,
      position: { x: 0, y: VORN.radius, z: 0 },
    });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    const habitatId = spawnHabitatEntity(world, VORN.id, { x: 2, y: VORN.radius, z: 0 });
    if (!playerId || !habitatId) throw new Error('fixture failed');
    updateOxygen(world, [SELA, VORN], SIM_DT);
    expect(world.entities.get(playerId)?.components.player?.lastHabitatId).toBe(habitatId);
    const player = world.entities.get(playerId)!;
    player.position = { x: 200, y: VORN.radius, z: 0 };
    updateOxygen(world, [SELA, VORN], SIM_DT);
    expect(world.entities.get(playerId)?.components.player?.lastHabitatId).toBe(habitatId);
  });

  it('respawns at a Vorn outpost instead of Sela', () => {
    const world = new World(1337, { planets: [SELA, VORN] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: VORN.id,
      position: { x: 0, y: VORN.radius, z: 0 },
    });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    const vornHub = spawnHabitatEntity(world, VORN.id, { x: 2, y: VORN.radius, z: 0 });
    spawnHabitatEntity(world, SELA.id, { x: 0, y: SELA.radius, z: 0 });
    if (!playerId || !vornHub) throw new Error('fixture failed');
    updateOxygen(world, [SELA, VORN], SIM_DT);
    const player = world.entities.get(playerId)!;
    player.position = { x: 200, y: VORN.radius, z: 0 };
    player.components.oxygen!.value = 0;
    updateOxygen(world, [SELA, VORN], SIM_DT);
    const hub = world.entities.get(vornHub)!;
    expect(world.entities.get(playerId)?.planetId).toBe(VORN.id);
    expect(distance(player.position, hub.position)).toBeLessThan(5);
    expect(oxygenOf(world, playerId)).toBe(100);
  });

  it('can respawn across planets at a Sela habitat recorded earlier', () => {
    const { world, playerId } = worldWithPlayer(SELA.id, { x: 0, y: SELA.radius, z: 0 });
    const hubId = spawnHabitatEntity(world, SELA.id, { x: 2, y: SELA.radius, z: 0 });
    if (!hubId) throw new Error('no habitat');
    updateOxygen(world, [SELA, VORN], SIM_DT);
    const player = world.entities.get(playerId)!;
    // Teleport the player to Vorn without a habitat: dies there, wakes at the
    // previously visited Sela base.
    player.planetId = VORN.id;
    player.position = { x: 0, y: VORN.radius, z: 0 };
    player.components.oxygen!.value = 0;
    updateOxygen(world, [SELA, VORN], SIM_DT);
    expect(player.planetId).toBe(SELA.id);
    const hub = world.entities.get(hubId)!;
    expect(distance(player.position, hub.position)).toBeLessThan(5);
  });
});

describe('stale pilot links heal', () => {
  beforeEach(() => events.clear());

  it('clears a link whose shuttle is gone and resumes breathing', () => {
    const { world, playerId } = worldWithPlayer(SELA.id, { x: 0, y: SELA.radius, z: 0 });
    const player = world.entities.get(playerId)!;
    player.components.player!.pilotingShuttleId = 'missing_shuttle';
    player.components.oxygen!.value = 10;
    updateOxygen(world, [SELA, VORN], 1);
    expect(player.components.player?.pilotingShuttleId).toBe(null);
    expect(oxygenOf(world, playerId)).toBeLessThan(10);
  });
});
