// M13 dev teleport: ?dev=1 lets V drop the player on Vorn's surface by
// dispatching the existing playerTeleport Action. Without ?dev=1 the helper
// is a no-op, so normal play can never jump planets.

import { afterEach, describe, expect, it } from 'vitest';
import { length, sub } from '../../src/core/math.js';
import { teleportToVorn, devTeleportEnabled } from '../../src/game/devTeleport.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { World } from '../../src/sim/world.js';

const PLANETS = [SELA, VORN];

function makeWorld(): { world: World; playerId: string } {
  const world = new World(1337, { planets: PLANETS });
  world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: SELA.radius + 2, z: 0 } });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

function setDevMode(enabled: boolean): void {
  Object.defineProperty(globalThis, 'window', {
    value: enabled ? { location: { search: '?dev=1' } } : undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('dev teleport to Vorn', () => {
  it('is disabled without ?dev=1', () => {
    setDevMode(false);
    expect(devTeleportEnabled()).toBe(false);
    const { world, playerId } = makeWorld();
    const before = { ...(world.entities.get(playerId)?.position ?? { x: 0, y: 0, z: 0 }) };
    expect(teleportToVorn(world, PLANETS, playerId)).toBe(false);
    world.tick();
    expect(world.entities.get(playerId)?.position).toEqual(before);
  });

  it('drops the player on Vorn with ?dev=1', () => {
    setDevMode(true);
    expect(devTeleportEnabled()).toBe(true);
    const { world, playerId } = makeWorld();
    expect(teleportToVorn(world, PLANETS, playerId)).toBe(true);
    world.tick();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('player lost');
    const r = length(sub(player.position, VORN.center));
    expect(r).toBeGreaterThan(VORN.radius);
    expect(r).toBeLessThan(VORN.radius + 20);
    // The action itself only moves position; the SOI transfer (physics
    // system) owns the planet label. Without physics here it stays Sela.
    expect(player.planetId).toBe('sela');
  });

  it('refuses when there is no player or no Vorn in the world', () => {
    setDevMode(true);
    const { world, playerId } = makeWorld();
    expect(teleportToVorn(world, [SELA], playerId)).toBe(false);
    expect(teleportToVorn(world, PLANETS, null)).toBe(false);
    expect(teleportToVorn(world, PLANETS, 'player_missing')).toBe(false);
  });
});
