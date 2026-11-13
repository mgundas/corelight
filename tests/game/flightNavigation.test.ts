import { describe, expect, it } from 'vitest';
import { flightDirectionTo, flightStatusFor } from '../../src/game/shuttleHud.js';
import { normalize, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { shuttleHeadingFor } from '../../src/sim/shuttleSteering.js';
import { World } from '../../src/sim/world.js';

describe('flight navigation in the actual steering frame', () => {
  it('reports a target dead ahead, right, above or behind in three dimensions', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const up = { x: 0, y: 1, z: 0 };
    expect(flightDirectionTo(origin, 0, 0, up, { x: 10, y: 0, z: 0 })).toEqual({ bearingDeg: 0, elevationDeg: 0 });
    expect(flightDirectionTo(origin, 0, 0, up, { x: 0, y: 0, z: 10 }).bearingDeg).toBeCloseTo(90);
    expect(flightDirectionTo(origin, 0, 0, up, { x: 0, y: 10, z: 0 }).elevationDeg).toBeCloseTo(90);
    expect(Math.abs(flightDirectionTo(origin, 0, 0, up, { x: -10, y: 0, z: 0 }).bearingDeg)).toBeCloseTo(180);
  });
  it.each([SELA, VORN])('shows $id ahead when aimed at it, even in deep space with a tilted up frame', (target) => {
    const planets = [SELA, VORN];
    const world = new World(1337, { planets });
    const position = { x: 6000, y: 3000, z: 2000 };
    world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position });
    world.tick();
    const player = [...world.entities.values()][0]!;
    const id = spawnPlaceableEntity(world, SELA.id, 'shuttle', position)!;
    world.dispatch({ type: 'enterShuttle', playerId: player.id, shuttleId: id });
    world.tick();
    const entity = world.entities.get(id)!;
    entity.planetId = null;
    entity.components.shuttle!.up = normalize({ x: 1, y: 2, z: -3 });
    const heading = shuttleHeadingFor(entity.components.shuttle!.up, sub(target.center, entity.position));
    Object.assign(entity.components.shuttle!, heading);
    const marker = flightStatusFor(world, planets, player.id)!.planets.find((m) => m.label === target.name)!;
    expect(marker.bearingDeg).toBeCloseTo(0, 5);
    expect(marker.elevationDeg).toBeCloseTo(0, 5);
    expect(marker.samePlanet).toBe(false);
  });
});
