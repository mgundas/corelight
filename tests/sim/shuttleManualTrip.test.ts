import { afterEach, beforeAll, expect, it } from 'vitest';
import { SIM_DT, SHUTTLE_YAW_RATE } from '../../src/core/constants.js';
import { clampScalar, distance, normalize, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { disposePhysics, initPhysics, stepPlanetWorlds } from '../../src/sim/physics/rapierWorld.js';
import { altitudeAbove, shortestAngle } from '../../src/sim/shuttle.js';
import { shuttleHeadingFor } from '../../src/sim/shuttleSteering.js';
import { shuttleGroundProbe } from '../../src/sim/shuttleGround.js';
import { makeShuttleSystem } from '../../src/sim/systems/shuttle.js';
import { World } from '../../src/sim/world.js';

beforeAll(initPhysics);
afterEach(disposePhysics);

it('flies Sela → Vorn → Sela by pilot Actions, starting parked without pre-aimed velocity', () => {
  const planets = [SELA, VORN];
  const world = new World(1337, { planets });
  const spawn = findSpawnPosition(SELA, world.seed);
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: spawn });
  world.tick();
  const player = [...world.entities.values()][0]!;
  const id = spawnPlaceableEntity(world, SELA.id, 'shuttle', spawn)!;
  const entity = world.entities.get(id)!;
  const ship = entity.components.shuttle!;
  world.addSystem((_w, dt) => stepPlanetWorlds(dt));
  world.addSystem(makeShuttleSystem({ planets, probe: shuttleGroundProbe(world, { castTerrainRay: () => null }) }));
  world.dispatch({ type: 'enterShuttle', playerId: player.id, shuttleId: id });
  world.tick();
  let lookYaw = 0;
  let lookPitch = 0;
  const flyInput = (thrust: number, lift: boolean) => {
    world.dispatch({ type: 'shuttleInput', playerId: player.id, shuttleId: id,
      input: { thrust, yawRate: 0, lift, boost: true, lookYaw, lookPitch } });
    world.tick();
  };
  const travel = (source: PlanetConfig, target: PlanetConfig) => {
    world.dispatch({ type: 'debugGiveItem', playerId: player.id, itemId: 'fuel_cell', count: 2 });
    world.dispatch({ type: 'loadShuttleFuel', playerId: player.id, shuttleId: id });
    world.dispatch({ type: 'loadShuttleFuel', playerId: player.id, shuttleId: id });
    world.tick();
    expect(ship.fuel).toBe(2);
    // The pilot launches and climbs clear before pointing at a destination.
    for (let i = 0; i < 600 && (!ship.airborne || altitudeAbove(source, entity.position) < 400); i++) flyInput(0, true);
    expect(ship.airborne).toBe(true);
    expect(ship.fuel).toBe(0);
    expect(altitudeAbove(source, entity.position)).toBeGreaterThanOrEqual(400);
    let visitedTarget = false;
    for (let i = 0; i < 6000 && ship.airborne; i++) {
      // A scripted pilot moves the mouse toward the selected planet. This
      // feeds ordinary steering Actions; it never sets position/velocity.
      const desired = shuttleHeadingFor(ship.up, normalize(sub(target.center, entity.position)), ship.yaw);
      const turn = SHUTTLE_YAW_RATE * SIM_DT;
      lookYaw += clampScalar(shortestAngle(desired.yaw - ship.yaw), -turn, turn);
      lookPitch += clampScalar(desired.pitch - ship.pitch, -turn, turn);
      const approach = entity.planetId === target.id && altitudeAbove(target, entity.position) < 100;
      flyInput(approach ? 0 : 1, false);
      visitedTarget ||= entity.planetId === target.id;
    }
    expect(visitedTarget, `never entered ${target.id}`).toBe(true);
    expect(ship.airborne, `did not land on ${target.id}: ${JSON.stringify(entity.position)}`).toBe(false);
    expect(entity.planetId).toBe(target.id);
    expect(distance(entity.position, target.center)).toBeLessThan(target.radius + 30);
    expect(ship.velocity).toEqual({ x: 0, y: 0, z: 0 });
  };
  travel(SELA, VORN);
  travel(VORN, SELA);
}, 20000);
