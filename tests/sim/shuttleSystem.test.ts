// M14 shuttle flight system: launch rule (2 s hold, two fuel cells), arcade
// thrust/lift, space→SOI handoff, landing assist and safe/bounce touchdown.
// The physics body is real Rapier; a test system steps the planet worlds after
// the shuttle update, mirroring the production central step.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events.js';
import { dot } from '../../src/core/math.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { disposePhysics, initPhysics, stepPlanetWorlds } from '../../src/sim/physics/rapierWorld.js';
import { makeShuttleSystem } from '../../src/sim/systems/shuttle.js';
import { World } from '../../src/sim/world.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

afterEach(() => {
  disposePhysics();
});

interface Fixture {
  world: World;
  playerId: EntityId;
  shuttleId: EntityId;
  ground: { distance: number | null };
}

function makeFixture(
  planets: PlanetConfig[] = [SELA],
  spawn: { x: number; y: number; z: number } = { x: 0, y: SELA.radius, z: 0 },
): Fixture {
  const world = new World(1337, { planets });
  world.dispatch({ type: 'spawnPlayer', planetId: planets[0]!.id, position: spawn });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  const shuttleId = spawnPlaceableEntity(world, planets[0]!.id, 'shuttle', spawn);
  if (!playerId || !shuttleId) throw new Error('fixture failed');
  const ground = { distance: null as number | null };
  world.addSystem(
    makeShuttleSystem({
      planets,
      probe: {
        castTerrainRay: () => ground.distance,
      },
    }),
  );
  world.addSystem((_world, dt) => stepPlanetWorlds(dt));
  return { world, playerId, shuttleId, ground };
}

/** Direct pilot link (actions already tested elsewhere). */
function pilot(fixture: Fixture): void {
  const player = fixture.world.entities.get(fixture.playerId);
  const shuttle = fixture.world.entities.get(fixture.shuttleId);
  if (!player?.components.player || !shuttle?.components.shuttle) throw new Error('missing');
  player.components.player.pilotingShuttleId = fixture.shuttleId;
  shuttle.components.shuttle.pilotId = fixture.playerId;
}

function lift(fixture: Fixture, ticks: number, release = false): void {
  for (let i = 0; i < ticks; i += 1) {
    fixture.world.dispatch({
      type: 'shuttleInput',
      playerId: fixture.playerId,
      shuttleId: fixture.shuttleId,
      input: {
        thrust: 0,
        yawRate: 0,
        lift: i < ticks - (release ? 1 : 0),
        boost: false,
        lookYaw: 0,
        lookPitch: 0,
      },
    });
    fixture.world.tick();
  }
}

function shuttleOf(fixture: Fixture) {
  const shuttle = fixture.world.entities.get(fixture.shuttleId)?.components.shuttle;
  if (!shuttle) throw new Error('no shuttle');
  return shuttle;
}

describe('launch rule', () => {
  beforeEach(() => events.clear());

  it('consumes both cells after a full 2 s Space hold', () => {
    const fixture = makeFixture();
    pilot(fixture);
    shuttleOf(fixture).fuel = 2;
    // Just under 2 s: still parked with both cells loaded.
    lift(fixture, 59);
    expect(shuttleOf(fixture).airborne).toBe(false);
    expect(shuttleOf(fixture).fuel).toBe(2);
    lift(fixture, 1);
    expect(shuttleOf(fixture).airborne).toBe(true);
    expect(shuttleOf(fixture).fuel).toBe(0);
    expect(shuttleOf(fixture).velocity.y).toBeGreaterThan(30);
  });

  it('never launches with one cell or when the hold is released early', () => {
    const one = makeFixture();
    pilot(one);
    shuttleOf(one).fuel = 1;
    lift(one, 90);
    expect(shuttleOf(one).airborne).toBe(false);
    expect(shuttleOf(one).fuel).toBe(1);
    const early = makeFixture();
    pilot(early);
    shuttleOf(early).fuel = 2;
    lift(early, 30);
    expect(shuttleOf(early).launchChargeS).toBeGreaterThan(0.9);
    lift(early, 1, true); // release resets the charge
    expect(shuttleOf(early).launchChargeS).toBe(0);
    lift(early, 30);
    expect(shuttleOf(early).airborne).toBe(false);
    expect(shuttleOf(early).fuel).toBe(2);
  });
});

describe('arcade flight', () => {
  beforeEach(() => events.clear());

  it('thrusts along the heading when W is held', () => {
    const fixture = makeFixture();
    pilot(fixture);
    const shuttle = shuttleOf(fixture);
    shuttle.airborne = true;
    shuttle.fuel = 0;
    shuttle.velocity = { x: 0, y: 0, z: 0 };
    const start = { ...fixture.world.entities.get(fixture.shuttleId)!.position };
    for (let i = 0; i < 15; i += 1) {
      fixture.world.dispatch({
        type: 'shuttleInput',
        playerId: fixture.playerId,
        shuttleId: fixture.shuttleId,
        input: { thrust: 1, yawRate: 0, lift: false, boost: false, lookYaw: 0, lookPitch: 0 },
      });
      fixture.world.tick();
    }
    const end = fixture.world.entities.get(fixture.shuttleId)!.position;
    expect(Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)).toBeGreaterThan(2);
    expect(shuttleOf(fixture).velocity.x).toBeGreaterThan(2);
  });

  it('holds A/D as a continuous yaw rate', () => {
    const fixture = makeFixture();
    pilot(fixture);
    const shuttle = shuttleOf(fixture);
    shuttle.airborne = true;
    const before = shuttle.yaw;
    for (let i = 0; i < 15; i += 1) {
      fixture.world.dispatch({
        type: 'shuttleInput',
        playerId: fixture.playerId,
        shuttleId: fixture.shuttleId,
        input: { thrust: 0, yawRate: 1, lift: false, boost: false, lookYaw: 0, lookPitch: 0 },
      });
      fixture.world.tick();
    }
    expect(shuttleOf(fixture).yaw - before).toBeLessThan(-0.4);
  });

  it('keeps a drifting space shuttle moving and hands the SOI to Vorn', () => {    const fixture = makeFixture([SELA, VORN], { x: 0, y: SELA.radius, z: 0 });
    const shuttle = shuttleOf(fixture);
    const entity = fixture.world.entities.get(fixture.shuttleId)!;
    // Deep space outside both SOIs, aimed at Vorn.
    entity.planetId = null;
    entity.position = { x: VORN.center.x + 1500, y: VORN.center.y, z: VORN.center.z };
    shuttle.airborne = true;
    shuttle.up = { x: 0, y: 1, z: 0 };
    shuttle.velocity = { x: -300, y: 0, z: 0 };
    let sawVorn = false;
    for (let i = 0; i < 180; i += 1) {
      fixture.world.tick();
      if (fixture.world.entities.get(fixture.shuttleId)!.planetId === VORN.id) {
        sawVorn = true;
        break;
      }
    }
    expect(sawVorn).toBe(true);
    expect(Math.hypot(...Object.values(shuttle.velocity))).toBeGreaterThan(10);
    // Auto-orient eases "down" toward Vorn instead of snapping a hemisphere.
    for (let i = 0; i < 30; i += 1) fixture.world.tick();
    const settled = fixture.world.entities.get(fixture.shuttleId)!;
    const radial = upAt(VORN, settled.position);
    expect(dot(shuttleOf(fixture).up, radial)).toBeGreaterThan(0.8);
  });

  it('hands the SOI back to Sela on the return leg', () => {
    const fixture = makeFixture([SELA, VORN], { x: 0, y: SELA.radius, z: 0 });
    const shuttle = shuttleOf(fixture);
    const entity = fixture.world.entities.get(fixture.shuttleId)!;
    entity.planetId = null;
    entity.position = { x: 1500, y: 0, z: 0 };
    shuttle.airborne = true;
    shuttle.up = { x: 0, y: 1, z: 0 };
    shuttle.velocity = { x: -300, y: 0, z: 0 };
    let sawSela = false;
    for (let i = 0; i < 180; i += 1) {
      fixture.world.tick();
      if (fixture.world.entities.get(fixture.shuttleId)!.planetId === SELA.id) {
        sawSela = true;
        break;
      }
    }
    expect(sawSela).toBe(true);
  });
});

describe('landing assist', () => {
  beforeEach(() => events.clear());

  function airborneAt(fixture: Fixture, altitude: number): void {
    const entity = fixture.world.entities.get(fixture.shuttleId)!;
    entity.position = { x: 0, y: SELA.radius + altitude, z: 0 };
    const shuttle = shuttleOf(fixture);
    shuttle.airborne = true;
    shuttle.up = { x: 0, y: 1, z: 0 };
    shuttle.pitch = 0.5;
    shuttle.velocity = { x: 0, y: -50, z: 0 };
  }

  it('clamps a fast descent below 40 m and levels the nose', () => {
    const fixture = makeFixture();
    fixture.ground.distance = 15;
    airborneAt(fixture, 20);
    fixture.world.tick();
    const shuttle = shuttleOf(fixture);
    expect(shuttle.velocity.y).toBeGreaterThan(-5.5);
    expect(Math.abs(shuttle.pitch)).toBeLessThan(0.5);
    expect(shuttle.airborne).toBe(true);
  });

  it('rests on its legs under 6 m/s and bounces a faster impact', () => {
    const fixture = makeFixture();
    fixture.ground.distance = 0.1;
    airborneAt(fixture, 5);
    const slow = shuttleOf(fixture);
    slow.velocity = { x: 0, y: -2, z: 0 };
    fixture.world.tick();
    expect(slow.airborne).toBe(false);
    expect(slow.velocity).toEqual({ x: 0, y: 0, z: 0 });

    const bounce = makeFixture();
    bounce.ground.distance = 0.1;
    airborneAt(bounce, 5);
    const fast = shuttleOf(bounce);
    fast.velocity = { x: 0, y: -20, z: 0 };
    bounce.world.tick();
    expect(fast.airborne).toBe(true);
    expect(fast.velocity.y).toBeGreaterThan(0);
  });

  it('keeps a high descent unclamped without a ground hit', () => {
    const fixture = makeFixture();
    fixture.ground.distance = null;
    airborneAt(fixture, 200);
    fixture.world.tick();
    expect(shuttleOf(fixture).velocity.y).toBeLessThan(-40);
  });

  it('drops to assist speed when the ground probe misses while low', () => {
    const fixture = makeFixture();
    fixture.ground.distance = null;
    airborneAt(fixture, 50);
    const shuttle = shuttleOf(fixture);
    shuttle.velocity = { x: 120, y: 0, z: 0 };
    fixture.world.tick();
    expect(Math.hypot(...Object.values(shuttleOf(fixture).velocity))).toBeLessThan(45);
  });
});
