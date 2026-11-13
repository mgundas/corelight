import { describe, expect, it } from 'vitest';
import { add, scale } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { shuttleGroundProbe } from '../../src/sim/shuttleGround.js';
import { World } from '../../src/sim/world.js';

describe('shuttle streamed-ground fallback', () => {
  it.each([SELA, VORN])('sees live terrain edits on $id while workers are pending', (planet) => {
    const world = new World(1337, { planets: [planet] });
    const spawn = findSpawnPosition(planet, world.seed);
    const up = upAt(planet, spawn);
    const origin = add(spawn, scale(up, 10));
    const direction = scale(up, -1);
    const probe = shuttleGroundProbe(world, { castTerrainRay: () => null });
    const before = probe.castTerrainRay(origin, direction, [planet], 30);
    expect(before).not.toBeNull();
    const hit = add(origin, scale(direction, before!));
    world.dispatch({ type: 'spawnPlayer', planetId: planet.id, position: origin });
    world.tick();
    const player = [...world.entities.values()][0]!;
    world.dispatch({ type: 'terrainEdit', playerId: player.id, planetId: planet.id,
      mode: 'dig', center: hit, radius: 2, strength: 4 });
    world.tick();
    const after = probe.castTerrainRay(origin, direction, [planet], 30);
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(before! + 0.1);
  });
  it('prefers resolved terrain colliders when available', () => {
    const world = new World(1337, { planets: [SELA] });
    const probe = shuttleGroundProbe(world, { castTerrainRay: () => 2 });
    expect(probe.castTerrainRay({ x: 0, y: 402, z: 0 }, { x: 0, y: -1, z: 0 }, [SELA], 30)).toBe(2);
  });
});
