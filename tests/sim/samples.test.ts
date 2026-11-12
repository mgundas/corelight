// M11 research samples: deterministic placement, depth-based values, safe
// streaming/despawn, pickup depletion, edit re-seating and node-mined values.

import { describe, expect, it } from 'vitest';
import { SAMPLE_DESPAWN_RANGE_M } from '../../src/core/constants.js';
import { distance } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import { updateSamples } from '../../src/sim/systems/samples.js';
import { updateNodes } from '../../src/sim/systems/nodes.js';
import {
  sampleChanceForLayer,
  sampleForChunk,
  sampleIdFor,
  sampleValueForLayer,
} from '../../src/sim/samples.js';
import { mineNodes } from '../../src/sim/mining.js';
import { createDensityField, layerAt } from '../../src/terrain/density.js';
import { TerrainEdits } from '../../src/terrain/edits.js';
import type { ChunkCoord } from '../../src/terrain/chunkKey.js';
import { nodeOrigin } from '../../src/terrain/octree.js';

function spawnWorld(seed = 1337): { world: World; playerId: EntityId } {
  const world = new World(seed, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: findSpawnPosition(SELA, seed) });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId };
}

interface FoundSample {
  coord: ChunkCoord;
  spec: ReturnType<typeof sampleForChunk>[number];
}

/** Deterministic scan for a chunk that actually rolls a pod (gates vary). */
function findSample(seed: number, ys: number[]): FoundSample {
  const field = createDensityField(SELA, seed);
  for (const y of ys) {
    for (let x = 14; x <= 18; x += 1) {
      for (let z = 14; z <= 18; z += 1) {
        const coord = { x, y, z };
        const spec = sampleForChunk(seed, SELA, coord, field.density)[0];
        if (spec) return { coord, spec };
      }
    }
  }
  throw new Error(`no sample found for y=${ys.join(',')} seed=${seed}`);
}

describe('sample placement', () => {
  it('maps depth layers to PROJECT.md values and rates', () => {
    expect(sampleValueForLayer('surface')).toBe(10);
    expect(sampleValueForLayer('crust')).toBe(10);
    expect(sampleValueForLayer('mantle')).toBe(20);
    expect(sampleValueForLayer('core_chamber')).toBe(40);
    expect(sampleChanceForLayer('surface')).toBe(0);
    expect(sampleChanceForLayer('crust')).toBeCloseTo(1 / 6, 10);
    expect(sampleChanceForLayer('mantle')).toBeCloseTo(1 / 3, 10);
    expect(sampleChanceForLayer('core_chamber')).toBe(1);
  });

  it('spawns at the designed deeper-weighted rate (crust ~1/6, mantle ~1/3)', () => {
    const field = createDensityField(SELA, 1337);
    let crust = 0;
    let mantle = 0;
    let crustHits = 0;
    let mantleHits = 0;
    for (let y = 20; y <= 27; y += 1) {
      for (let x = 12; x <= 20; x += 1) {
        for (let z = 12; z <= 20; z += 1) {
          const center = {
            x: -512 + x * 32 + 16,
            y: -512 + y * 32 + 16,
            z: -512 + z * 32 + 16,
          };
          const layer = layerAt(SELA, center.x, center.y, center.z).name;
          const hit = sampleForChunk(1337, SELA, { x, y, z }, field.density).length > 0;
          if (layer === 'crust') {
            crust += 1;
            if (hit) crustHits += 1;
          } else if (layer === 'mantle') {
            mantle += 1;
            if (hit) mantleHits += 1;
          }
        }
      }
    }
    // Deterministic counts on seed 1337: 43/297 crust, 71/261 mantle.
    expect(crustHits).toBeGreaterThan(crust / 12);
    expect(crustHits).toBeLessThan(crust / 3);
    expect(mantleHits).toBeGreaterThan(crustHits);
    expect(mantleHits).toBeGreaterThan(mantle / 6);
    expect(mantleHits).toBeLessThan(mantle * 0.7);
  });

  it('always places a core-chamber sample worth 40 Data', () => {
    const field = createDensityField(SELA, 1337);
    const specs = sampleForChunk(1337, SELA, { x: 16, y: 16, z: 16 }, field.density);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.value).toBe(40);
  });

  it('is deterministic per chunk and varies by seed', () => {
    const fieldA = createDensityField(SELA, 1337);
    const fieldB = createDensityField(SELA, 1337);
    const found = findSample(1337, [26, 25, 24, 23, 22]);
    const a = sampleForChunk(1337, SELA, found.coord, fieldA.density);
    const b = sampleForChunk(1337, SELA, found.coord, fieldB.density);
    expect(a).toEqual(b);
    expect(a[0]?.id).toBe(sampleIdFor(SELA.id, found.coord));
    // Different seeds disagree somewhere across the scanned band (single
    // gated chunks can both be empty).
    const collect = (seed: number): string => {
      const field = createDensityField(SELA, seed);
      const parts: string[] = [];
      for (let y = 22; y <= 26; y += 1) {
        for (let x = 14; x <= 18; x += 1) {
          for (let z = 14; z <= 18; z += 1) {
            parts.push(JSON.stringify(sampleForChunk(seed, SELA, { x, y, z }, field.density)));
          }
        }
      }
      return parts.join('|');
    };
    expect(collect(99)).not.toBe(collect(1337));
  });

  it('keeps id/value across an unrelated edit (live field re-seats only)', () => {
    const found = findSample(1337, [23, 22, 21]);
    const base = createDensityField(SELA, 1337);
    const before = sampleForChunk(1337, SELA, found.coord, base.density);
    expect(before.length).toBe(1);
    const edits = new TerrainEdits();
    const local = {
      x: found.spec.position.x - SELA.center.x,
      y: found.spec.position.y - SELA.center.y,
      z: found.spec.position.z - SELA.center.z,
    };
    edits.applySphere(SELA, base.density, local, 1, 0.5, 'dig');
    const live = createDensityField(SELA, 1337, (x, y, z) => edits.deltaAt(SELA, SELA.id, x, y, z));
    const after = sampleForChunk(1337, SELA, found.coord, base.density, live.density);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.value).toBe(before[0]?.value);
  });
});

describe('sample streaming', () => {
  it('streams pods near the player, despawns far ones and respawns on return', () => {
    const { world, playerId } = spawnWorld();
    const found = findSample(1337, [23, 22, 21]);
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...found.spec.position } });
    world.tick();
    updateSamples(world, [SELA]);
    expect(world.entities.get(found.spec.id)?.kind).toBe('sample');
    expect(world.entities.get(found.spec.id)?.components.sample?.value).toBe(found.spec.value);
    // All spawned pods are within the despawn radius of the player.
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'sample') continue;
      expect(distance(entity.position, found.spec.position)).toBeLessThanOrEqual(SAMPLE_DESPAWN_RANGE_M);
    }
    // Far away: pristine pods despawn.
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: 0, y: -(SELA.radius + 50), z: 0 },
    });
    world.tick();
    updateSamples(world, [SELA]);
    expect(world.entities.has(found.spec.id)).toBe(false);
    // Return: the same deterministic id comes back.
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...found.spec.position } });
    world.tick();
    updateSamples(world, [SELA]);
    expect(world.entities.has(found.spec.id)).toBe(true);
  });

  it('picked-up pods are recorded and never respawn as world spawns', () => {
    const { world, playerId } = spawnWorld();
    const found = findSample(1337, [23, 22, 21]);
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...found.spec.position } });
    world.tick();
    updateSamples(world, [SELA]);
    world.dispatch({ type: 'pickUp', playerId, itemId: found.spec.id });
    world.tick();
    const inventory = world.entities.get(playerId)?.components.inventory;
    expect(inventory?.slots).toContain(found.spec.id);
    expect(world.depletedSamples.has(found.spec.id)).toBe(true);
    // Walk far: the carried pod is owned by the player, never despawned.
    world.dispatch({
      type: 'playerTeleport',
      playerId,
      position: { x: 0, y: -(SELA.radius + 50), z: 0 },
    });
    world.tick();
    updateSamples(world, [SELA]);
    expect(world.entities.has(found.spec.id)).toBe(true);
    // Return: it is not duplicated as a fresh world pod.
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...found.spec.position } });
    world.tick();
    updateSamples(world, [SELA]);
    expect([...world.entities.values()].filter((e) => e.id === found.spec.id)).toHaveLength(1);
  });

  it('does not teleport a resting pod when an unrelated edit hits its chunk', () => {
    const { world, playerId } = spawnWorld();
    const found = findSample(1337, [23, 22, 21]);
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...found.spec.position } });
    world.tick();
    updateSamples(world, [SELA]);
    const pod = world.entities.get(found.spec.id);
    if (!pod) throw new Error('no pod spawned');
    // Simulate a pod that fell/rested a few metres away from its wall spot:
    // scan the same chunk's base field for an air point.
    const field = createDensityField(SELA, 1337);
    const min = nodeOrigin(SELA, 0, found.coord);
    let resting: { x: number; y: number; z: number } | null = null;
    for (let gx = 0; gx <= 32 && !resting; gx += 4) {
      for (let gy = 0; gy <= 32 && !resting; gy += 4) {
        for (let gz = 0; gz <= 32 && !resting; gz += 4) {
          const local = { x: min.x + gx, y: min.y + gy, z: min.z + gz };
          if (field.density(local.x, local.y, local.z) >= -1) continue;
          const p = {
            x: SELA.center.x + local.x,
            y: SELA.center.y + local.y,
            z: SELA.center.z + local.z,
          };
          if (distance(p, found.spec.position) < 4) continue;
          resting = p;
        }
      }
    }
    if (!resting) throw new Error('no air point near pod');
    pod.position = { ...resting };
    const expected = { ...resting };
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: { ...found.spec.position },
      radius: 2,
      strength: 0.5,
    });
    world.tick();
    updateNodes(world, [SELA]);
    updateSamples(world, [SELA]);
    const after = world.entities.get(found.spec.id);
    expect(after).toBeDefined();
    expect(after?.position).toEqual(expected);
  });

  it('a terrain edit re-seats the pod instead of deleting it', () => {
    const { world, playerId } = spawnWorld();
    const found = findSample(1337, [23, 22, 21]);
    world.dispatch({ type: 'playerTeleport', playerId, position: { ...found.spec.position } });
    world.tick();
    updateSamples(world, [SELA]);
    expect(world.entities.has(found.spec.id)).toBe(true);
    world.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: SELA.id,
      mode: 'dig',
      center: { ...found.spec.position },
      radius: 2,
      strength: 0.5,
    });
    world.tick();
    // Both streaming subscribers must receive the edit: the node system
    // drains its own queue first, so a shared queue would starve samples.
    updateNodes(world, [SELA]);
    updateSamples(world, [SELA]);
    const reseated = world.entities.get(found.spec.id);
    expect(reseated?.kind).toBe('sample');
    expect(reseated?.components.sample?.value).toBe(found.spec.value);
  });
});

describe('node-mined research samples', () => {
  it('carries the origin layer value into the dropped item', () => {
    const { world } = spawnWorld();
    // Mantle point on the +Y axis (depth ~190 m).
    const at = { x: 0, y: 210, z: 0 };
    const nodeId = world.nextId('node');
    world.entities.set(nodeId, {
      id: nodeId,
      kind: 'node',
      planetId: SELA.id,
      position: { ...at },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      components: { node: { resourceId: 'research_sample', charges: 1, maxCharges: 1, chunkKey: 'k' } },
    });
    mineNodes(world, SELA.id, at, 2);
    const drop = [...world.entities.values()].find(
      (e) => e.kind === 'item' && e.components.item?.itemId === 'research_sample',
    );
    expect(drop?.components.item?.sampleValue).toBe(20);
  });
});
