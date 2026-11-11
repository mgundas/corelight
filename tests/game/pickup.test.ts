import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { World } from '../../src/sim/world.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { moveBasis } from '../../src/sim/physics/frames.js';
import { upAt } from '../../src/sim/physics/frames.js';
import { findAimedItem } from '../../src/game/pickup.js';

function spawnWorld(seed = 1337): { world: World; playerId: string } {
  const world = new World(seed, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, seed) });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

function addItem(world: World, at: { x: number; y: number; z: number }, holder?: string): string {
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: SELA.id,
    position: { ...at },
    rotation: { ...IDENTITY_QUAT },
    components: { item: holder ? { itemId: 'resin', holder } : { itemId: 'resin' } },
  });
  return id;
}

describe('findAimedItem', () => {
  it('finds the loose item in front of the player', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const up = upAt(SELA, player.position);
    const { forward } = moveBasis(up, 0, 0);
    const at = {
      x: player.position.x + forward.x * 2,
      y: player.position.y + forward.y * 2,
      z: player.position.z + forward.z * 2,
    };
    const itemId = addItem(world, at);
    expect(findAimedItem(world, playerId)).toBe(itemId);
  });

  it('ignores items behind, far away, or already carried', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const up = upAt(SELA, player.position);
    const { forward } = moveBasis(up, 0, 0);
    addItem(world, {
      x: player.position.x - forward.x * 2,
      y: player.position.y - forward.y * 2,
      z: player.position.z - forward.z * 2,
    });
    addItem(world, {
      x: player.position.x + forward.x * 20,
      y: player.position.y + forward.y * 20,
      z: player.position.z + forward.z * 20,
    });
    addItem(world, { ...player.position }, playerId);
    expect(findAimedItem(world, playerId)).toBe(null);
  });
});
