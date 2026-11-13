import { describe, expect, it } from 'vitest';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from '../../src/core/constants.js';
import { add, scale, sub, normalize } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { createDensityField } from '../../src/terrain/density.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { seatAheadOnGround } from '../../src/sim/tetherActions.js';
import { World } from '../../src/sim/world.js';

describe('safe shuttle exits', () => {
  it.each([SELA, VORN])('exits above terrain on $id, including slopes and live edits', (planet) => {
    for (const dir of [{ x: 0, y: 1, z: 0 }, { x: 0.13, y: 0.98, z: 0.04 }, { x: 1, y: 0.4, z: -0.3 }]) {
      const world = new World(1337, { planets: [planet] });
      const spawn = findSpawnPosition(planet, world.seed, normalize(dir));
      world.dispatch({ type: 'spawnPlayer', planetId: planet.id, position: spawn });
      world.tick();
      const player = [...world.entities.values()][0]!;
      const id = spawnPlaceableEntity(world, planet.id, 'shuttle', spawn)!;
      world.dispatch({ type: 'enterShuttle', playerId: player.id, shuttleId: id });
      world.tick();
      if (dir.x === 0) {
        const ground = seatAheadOnGround(world, planet, player.position, 0, 3);
        player.components.player!.soil = 200;
        world.dispatch({ type: 'terrainEdit', playerId: player.id, planetId: planet.id,
          mode: 'add', center: ground, radius: 2, strength: 4 });
        world.tick();
      }
      world.dispatch({ type: 'exitShuttle', playerId: player.id });
      world.tick();
      expect(player.components.player?.pilotingShuttleId).toBeNull();
      const up = upAt(planet, player.position);
      const field = createDensityField(planet, world.seed, (x, y, z) => world.terrainEdits.deltaAt(planet, planet.id, x, y, z));
      for (const h of [-PLAYER_HALF_HEIGHT - PLAYER_RADIUS, 0, PLAYER_HALF_HEIGHT + PLAYER_RADIUS]) {
        const p = sub(add(player.position, scale(up, h)), planet.center);
        expect(field.density(p.x, p.y, p.z)).toBeLessThan(0);
      }
      expect(player.components.player?.embeddedTime).toBe(0);
    }
  });
});
