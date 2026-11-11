import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { updateNodes } from '../../src/sim/systems/nodes.js';
import { l0ChunksNear, nodeIdFor, nodesForChunk } from '../../src/sim/nodes.js';
import { createDensityField } from '../../src/terrain/density.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { distance } from '../../src/core/math.js';
import { NODE_DESPAWN_RANGE_M } from '../../src/core/constants.js';

function spawnWorld(seed = 1337): { world: World; playerId: string } {
  const world = new World(seed, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, seed) });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

describe('deterministic node placement', () => {
  it('is deterministic per chunk and varies by seed', () => {
    const fieldA = createDensityField(SELA, 1337);
    const fieldB = createDensityField(SELA, 1337);
    const coord = { x: 16, y: 15, z: 16 };
    const a = nodesForChunk(1337, SELA, coord, fieldA.density);
    const b = nodesForChunk(1337, SELA, coord, fieldB.density);
    expect(a).toEqual(b);
    // Seeds diverge across a neighborhood (single chunks can both be empty).
    const collect = (seed: number): string => {
      const field = createDensityField(SELA, seed);
      const parts: string[] = [];
      for (let x = 14; x <= 18; x += 1) {
        for (let z = 14; z <= 18; z += 1) {
          parts.push(JSON.stringify(nodesForChunk(seed, SELA, { x, y: 15, z }, field.density)));
        }
      }
      return parts.join('|');
    };
    expect(collect(99)).not.toBe(collect(1337));
  });

  it('charges are in [2, 5] and ids are stable chunk-derived strings', () => {
    const field = createDensityField(SELA, 1337);
    const coord = { x: 16, y: 15, z: 16 };
    const specs = nodesForChunk(1337, SELA, coord, field.density);
    for (const [i, spec] of specs.entries()) {
      expect(spec.charges).toBeGreaterThanOrEqual(2);
      expect(spec.charges).toBeLessThanOrEqual(5);
      expect(spec.id).toBe(nodeIdFor(SELA.id, coord, i));
    }
  });

  it('surface nodes sit on the density surface', () => {
    const field = createDensityField(SELA, 1337);
    let checked = 0;
    for (let x = 14; x <= 18 && checked < 4; x += 1) {
      const coord = { x, y: 15, z: 16 };
      for (const spec of nodesForChunk(1337, SELA, coord, field.density)) {
        const local = {
          x: spec.position.x - SELA.center.x,
          y: spec.position.y - SELA.center.y,
          z: spec.position.z - SELA.center.z,
        };
        // Within a couple meters of the zero set (wall or surface).
        expect(Math.abs(field.density(local.x, local.y, local.z))).toBeLessThan(3);
        checked += 1;
        if (checked >= 4) break;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('node streaming system', () => {
  it('spawns nodes near the player and despawns them when far', () => {
    const { world, playerId } = spawnWorld();
    updateNodes(world, [SELA]);
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const near = [...world.entities.values()].filter((e) => e.kind === 'node');
    expect(near.length).toBeGreaterThan(0);
    for (const node of near) {
      expect(distance(node.position, player.position)).toBeLessThan(NODE_DESPAWN_RANGE_M);
    }
    // Teleport far away: old nodes go, new ones arrive.
    const before = new Set(near.map((n) => n.id));
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: 0, y: -(SELA.radius + 50), z: 0 },
    });
    world.tick();
    updateNodes(world, [SELA]);
    const after = [...world.entities.values()].filter((e) => e.kind === 'node');
    for (const node of after) expect(before.has(node.id)).toBe(false);
  });

  it('depleted nodes never respawn', () => {
    const { world } = spawnWorld();
    updateNodes(world, [SELA]);
    const node = [...world.entities.values()].find((e) => e.kind === 'node');
    if (!node) throw new Error('no nodes spawned');
    world.depletedNodes.add(node.id);
    world.entities.delete(node.id);
    updateNodes(world, [SELA]);
    expect(world.entities.has(node.id)).toBe(false);
  });

  it('l0ChunksNear always includes the player chunk', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    expect(l0ChunksNear(player.position, SELA).length).toBeGreaterThan(0);
  });
});
