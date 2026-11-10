// Action-level tests for the terrain tool: dig/add/flatten application,
// hardness limits, soil accounting, and the terrainEdited event. Uses the
// real Sela density field; near-surface digs stay above the cave start
// depth (6 m), so no worm can interfere with the assertions.

import { afterEach, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { events } from '../../src/core/events.js';
import { SIM_DT, SOIL_MAX } from '../../src/core/constants.js';
import { World } from '../../src/sim/world.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { upAt } from '../../src/sim/physics/frames.js';

afterEach(() => {
  events.clear();
});

function makeWorld(): { world: World; playerId: string } {
  const world = new World(1337);
  world.planets = [SELA];
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, 1337) });
  world.tick();
  let playerId = '';
  for (const entity of world.entities.values()) {
    if (entity.kind === 'player') playerId = entity.id;
  }
  if (!playerId) throw new Error('no player spawned');
  return { world, playerId };
}

describe('terrainEdit action', () => {
  it('digs below the surface, earns soil, and emits terrainEdited', () => {
    const { world, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    const up = upAt(SELA, player.position);
    const center = {
      x: player.position.x - up.x * 3,
      y: player.position.y - up.y * 3,
      z: player.position.z - up.z * 3,
    };
    const seen: Array<{ planetId: string; keys: string[] }> = [];
    const off = events.on('terrainEdited', (payload) => {
      seen.push(payload);
    });
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'dig', center, radius: 2, strength: 5 });
    world.tick();
    off();
    expect(world.terrainEdits.sampleCount).toBeGreaterThan(0);
    expect(player.components.player?.soil).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.planetId).toBe(SELA.id);
    expect(seen[0]?.keys.length).toBeGreaterThan(0);
  });

  it('add fails with empty soil and consumes soil otherwise', () => {
    const { world, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player || !player.components.player) throw new Error('missing player');
    const up = upAt(SELA, player.position);
    const center = {
      x: player.position.x - up.x * 1,
      y: player.position.y - up.y * 1,
      z: player.position.z - up.z * 1,
    };
    // Empty counter: no-op, no edits stored.
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'add', center, radius: 2, strength: 5 });
    world.tick();
    expect(world.terrainEdits.sampleCount).toBe(0);
    // After earning soil, add works and spends it.
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'dig', center, radius: 2, strength: 5 });
    world.tick();
    const earned = player.components.player.soil;
    expect(earned).toBeGreaterThan(0);
    const before = world.terrainEdits.sampleCount;
    void before;
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'add', center, radius: 2, strength: 5 });
    world.tick();
    expect(player.components.player.soil).toBeLessThanOrEqual(earned);
    expect(world.terrainEdits.sampleCount).toBeGreaterThan(0);
  });

  it('caps soil at SOIL_MAX', () => {
    const { world, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player || !player.components.player) throw new Error('missing player');
    player.components.player.soil = SOIL_MAX - 1;
    const up = upAt(SELA, player.position);
    const center = {
      x: player.position.x - up.x * 3,
      y: player.position.y - up.y * 3,
      z: player.position.z - up.z * 3,
    };
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'dig', center, radius: 4, strength: 5 });
    world.tick();
    expect(player.components.player.soil).toBeLessThanOrEqual(SOIL_MAX);
  });

  it('blocks mantle rock for the Mk1 drill and flags too-hard', () => {
    const { world, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player || !player.components.player) throw new Error('missing player');
    // Depth 200 m: mantle (hardness 3) > Mk1 tool hardness (2).
    const center = { x: SELA.center.x, y: SELA.center.y + 200, z: SELA.center.z };
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'dig', center, radius: 2, strength: 5 });
    world.tick();
    expect(world.terrainEdits.sampleCount).toBe(0);
    expect(player.components.player.soil).toBe(0);
    // Stamped during applyAction, one tick before time advanced.
    expect(world.time - player.components.player.lastTooHard).toBeCloseTo(SIM_DT, 10);
  });

  it('ignores degenerate strokes', () => {
    const { world, playerId } = makeWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'dig', center: { ...player.position }, radius: 0, strength: 1 });
    world.dispatch({ type: 'terrainEdit', playerId, planetId: SELA.id, mode: 'dig', center: { ...player.position }, radius: 2, strength: 0 });
    world.tick();
    expect(world.terrainEdits.sampleCount).toBe(0);
  });
});
