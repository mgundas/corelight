import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/world.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';

describe('player actions', () => {
  it('spawnPlayer creates a player entity with defaults', () => {
    const world = new World(9);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 410, z: 0 } });
    world.tick();
    expect(world.entities.size).toBe(1);
    const player = [...world.entities.values()][0];
    expect(player?.kind).toBe('player');
    expect(player?.planetId).toBe('sela');
    expect(player?.position).toEqual({ x: 0, y: 410, z: 0 });
    expect(player?.rotation).toEqual(IDENTITY_QUAT);
    expect(player?.components.player).toMatchObject({
      grounded: false,
      yaw: 0,
      pitch: 0,
      input: null,
      embeddedTime: 0,
    });
  });

  it('playerInput stores look + clamped one-shot input', () => {
    const world = new World(9);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 410, z: 0 } });
    world.tick();
    const id = [...world.entities.keys()][0] as string;
    world.dispatch({
      type: 'playerInput',
      playerId: id,
      move: { x: 5, z: -2 },
      jump: true,
      sprint: true,
      lookYaw: 1.2,
      lookPitch: 99, // clamped to +PI/2
    });
    world.tick();
    const player = world.entities.get(id);
    expect(player?.components.player?.yaw).toBeCloseTo(1.2);
    expect(player?.components.player?.pitch).toBeCloseTo(Math.PI / 2);
    expect(player?.components.player?.input).toEqual({ moveX: 1, moveZ: -1, jump: true, sprint: true });
  });

  it('playerInput on a missing entity is ignored', () => {
    const world = new World(9);
    world.dispatch({
      type: 'playerInput',
      playerId: 'player_missing',
      move: { x: 0, z: 0 },
      jump: false,
      sprint: false,
      lookYaw: 0,
      lookPitch: 0,
    });
    world.tick();
    expect(world.entities.size).toBe(0);
  });

  it('playerTeleport moves the player and zeroes velocity', () => {
    const world = new World(9);
    world.dispatch({ type: 'spawnPlayer', planetId: 'sela', position: { x: 0, y: 410, z: 0 } });
    world.tick();
    const id = [...world.entities.keys()][0] as string;
    const player = world.entities.get(id);
    player?.components.player && (player.components.player.velocity = { x: 3, y: -4, z: 0 });
    world.dispatch({ type: 'playerTeleport', playerId: id, position: { x: 1, y: 2, z: 3 } });
    world.tick();
    const moved = world.entities.get(id);
    expect(moved?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(moved?.components.player?.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(moved?.components.player?.embeddedTime).toBe(0);
  });
});
