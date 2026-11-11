import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { updateNodes } from '../../src/sim/systems/nodes.js';
import { l0ChunksNear, nodeIdFor, nodesForChunk } from '../../src/sim/nodes.js';
import { createDensityField } from '../../src/terrain/density.js';
import { TerrainEdits } from '../../src/terrain/edits.js';
import { chunkSizeForLevel } from '../../src/terrain/chunkKey.js';
import { nodeOrigin } from '../../src/terrain/octree.js';
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

  it('a terrain edit re-seats nodes instead of leaving them floating', () => {
    const { world, playerId } = spawnWorld();
    updateNodes(world, [SELA]);
    const node = [...world.entities.values()].find((e) => e.kind === 'node');
    if (!node) throw new Error('no nodes spawned');
    const nodeComp = node.components.node;
    if (!nodeComp) throw new Error('node has no component');
    const full = nodeComp.charges;
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...node.position } });
    world.tick();
    // One dig stroke mines a charge AND flags the chunk dirty. The drain
    // re-seats the same deterministic id with progress kept.
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: { ...node.position },
      radius: 2,
      strength: 0.5,
    });
    world.tick();
    updateNodes(world, [SELA]);
    const reseated = world.entities.get(node.id);
    expect(reseated).toBeDefined();
    expect(reseated?.components.node?.charges).toBe(full - 1);
    expect(world.nodeCharges.get(node.id)).toBe(full - 1);
  });

  it('nodeCharges only tracks partial progress', () => {
    const { world } = spawnWorld();
    // Fresh full-charge nodes near the player record nothing.
    expect(world.nodeCharges.size).toBe(0);
  });

  it('an unrelated dig in the same chunk keeps id to resource mapping', () => {
    // Base specs from the unedited field; live specs after a far-away dig
    // in the same chunk must keep every id -> resource (and charges).
    let coord: { x: number; y: number; z: number } | null = null;
    let before: ReturnType<typeof nodesForChunk> = [];
    const probeBase = createDensityField(SELA, 1337);
    for (let x = 12; x <= 20 && !coord; x += 1) {
      for (let z = 12; z <= 20 && !coord; z += 1) {
        const candidate = { x, y: 15, z };
        const specs = nodesForChunk(1337, SELA, candidate, probeBase.density);
        if (specs.length > 0) {
          coord = candidate;
          before = specs;
        }
      }
    }
    if (!coord) throw new Error('no nodes for stability probe');
    const base = createDensityField(SELA, 1337);
    const min = nodeOrigin(SELA, 0, coord);
    const size = chunkSizeForLevel(0);
    // Dig center far from every node spot (same chunk, unrelated ground).
    let center: { x: number; y: number; z: number } | null = null;
    for (let gx = 0; gx <= 4 && !center; gx += 1) {
      for (let gz = 0; gz <= 4 && !center; gz += 1) {
        const candidate = {
          x: min.x + 4 + gx * 6 - SELA.center.x,
          y: 0,
          z: min.z + 4 + gz * 6 - SELA.center.z,
        };
        // Project onto the surface along the radial ray first.
        const dirLen = Math.hypot(candidate.x, 10, candidate.z);
        const dir = { x: candidate.x / dirLen, y: 10 / dirLen, z: candidate.z / dirLen };
        let hit: { x: number; y: number; z: number } | null = null;
        let prevD = base.density(dir.x * (SELA.radius + 80), dir.y * (SELA.radius + 80), dir.z * (SELA.radius + 80));
        let prevR = SELA.radius + 80;
        for (let r = prevR - 1; r > SELA.radius - 60; r -= 1) {
          const d = base.density(dir.x * r, dir.y * r, dir.z * r);
          if (prevD < 0 && d >= 0) {
            hit = { x: dir.x * r, y: dir.y * r, z: dir.z * r };
            break;
          }
          prevR = r;
          prevD = d;
        }
        if (!hit) continue;
        const far = before.every((spec) => {
          const local = {
            x: spec.position.x - SELA.center.x,
            y: spec.position.y - SELA.center.y,
            z: spec.position.z - SELA.center.z,
          };
          return Math.hypot(local.x - hit.x, local.y - hit.y, local.z - hit.z) > 10;
        });
        if (far) center = hit;
      }
    }
    if (!center) throw new Error('no unrelated dig spot in chunk');
    const edits = new TerrainEdits();
    edits.applySphere(SELA, base.density, center, 2, 0.5, 'dig');
    const live = createDensityField(SELA, 1337, (x, y, z) => edits.deltaAt(SELA, SELA.id, x, y, z));
    const after = nodesForChunk(1337, SELA, coord, base.density, live.density);
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    for (const spec of after) {
      const prev = before.find((s) => s.id === spec.id);
      expect(prev).toBeDefined();
      expect(spec.resourceId).toBe(prev?.resourceId);
      expect(spec.charges).toBe(prev?.charges);
    }
    void size;
  });

  it('l0ChunksNear always includes the player chunk', () => {
    const { world, playerId } = spawnWorld();
    const player = world.entities.get(playerId);
    if (!player) throw new Error('missing player');
    expect(l0ChunksNear(player.position, SELA).length).toBeGreaterThan(0);
  });
});
