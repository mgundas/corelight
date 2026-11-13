import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { add, length, normalize, scale, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { createDensityField } from '../../src/terrain/density.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { disposePhysics, initPhysics, stepPlanetWorlds } from '../../src/sim/physics/rapierWorld.js';
import { shuttleGroundProbe } from '../../src/sim/shuttleGround.js';
import { makeShuttleSystem } from '../../src/sim/systems/shuttle.js';
import { World } from '../../src/sim/world.js';

beforeAll(initPhysics);
afterEach(disposePhysics);

describe('interplanetary arrival with terrain colliders still pending', () => {
  it.each([SELA, VORN])('brakes and stops on the real $id surface with its pilot', (planet) => {
    const world = new World(1337, { planets: [SELA, VORN] });
    const direction = normalize({ x: 1, y: 0.2, z: 0.1 });
    const start = add(planet.center, scale(direction, planet.radius + 1000));
    world.dispatch({ type: 'spawnPlayer', planetId: planet.id, position: start });
    world.tick();
    const player = [...world.entities.values()][0]!;
    const id = spawnPlaceableEntity(world, planet.id, 'shuttle', start)!;
    const entity = world.entities.get(id)!;
    const ship = entity.components.shuttle!;
    entity.planetId = null;
    player.components.player!.pilotingShuttleId = id;
    ship.pilotId = player.id;
    ship.airborne = true;
    ship.velocity = scale(direction, -600);
    ship.up = scale(direction, -1);
    // Production order: physics steps first, shuttle reads back last.
    world.addSystem((_w, dt) => stepPlanetWorlds(dt));
    world.addSystem(makeShuttleSystem({ planets: [SELA, VORN],
      probe: shuttleGroundProbe(world, { castTerrainRay: () => null }) }));
    const field = createDensityField(planet, world.seed);
    let entrySpeed = 0;
    for (let i = 0; i < 2400 && ship.airborne; i++) {
      world.dispatch({ type: 'shuttleInput', playerId: player.id, shuttleId: id,
        input: { thrust: 0, yawRate: 0, lift: false, boost: true, lookYaw: 0, lookPitch: 0 } });
      world.tick();
      if (entity.planetId === planet.id) entrySpeed = Math.max(entrySpeed, length(ship.velocity));
      const local = sub(entity.position, planet.center);
      if (length(local) < planet.radius + 30) expect(field.density(local.x, local.y, local.z)).toBeLessThan(0.3);
    }
    expect(entrySpeed).toBeGreaterThan(550);
    expect(ship.airborne).toBe(false);
    expect(ship.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.planetId).toBe(planet.id);
    expect(player.position).toEqual(entity.position);
    const parked = { ...entity.position };
    for (let i = 0; i < 60; i++) world.tick();
    expect(length(sub(entity.position, parked))).toBeLessThan(0.01);
    world.dispatch({ type: 'exitShuttle', playerId: player.id });
    world.tick();
    expect(player.components.player?.pilotingShuttleId).toBeNull();
    const local = sub(player.position, planet.center);
    expect(field.density(local.x, local.y, local.z)).toBeLessThan(0);
  });

  it('boarding rebases mouse look instead of snapping to the old on-foot heading', () => {
    const world = new World(1337, { planets: [SELA] });
    const start = { x: 0, y: 900, z: 0 };
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: start });
    world.tick();
    const player = [...world.entities.values()][0]!;
    const id = spawnPlaceableEntity(world, SELA.id, 'shuttle', start)!;
    world.addSystem(makeShuttleSystem({ planets: [SELA], probe: { castTerrainRay: () => null } }));
    world.dispatch({ type: 'enterShuttle', playerId: player.id, shuttleId: id });
    const steer = (lookYaw: number, lookPitch: number) => {
      world.dispatch({ type: 'shuttleInput', playerId: player.id, shuttleId: id,
        input: { thrust: 0, yawRate: 0, lift: false, boost: false, lookYaw, lookPitch } });
      world.tick();
    };
    steer(2, -1.2);
    const ship = world.entities.get(id)!.components.shuttle!;
    expect(ship.yaw).toBeCloseTo(0);
    expect(ship.pitch).toBeCloseTo(0);
    steer(2.1, -1);
    expect(ship.yaw).toBeCloseTo(0.1);
    expect(ship.pitch).toBeCloseTo(0.2);
  });
});
