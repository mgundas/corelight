// Node streaming system (M07): deterministic nodes exist near each player
// and are removed when far. Placements derive from seed + chunk (never
// stored); only mining outcomes persist (node entities with charges,
// nodeCharges for partial progress across far despawns, depletedNodes once
// exhausted). Runs after physics in the tick order.
//
// Cost control: the density marches behind placement run once per chunk per
// visit (tracked in a per-world settled set), never every tick. Despawned
// chunks leave the settled set so returning recomputes them — determinism
// holds because recompute is a pure function of seed + chunk (+ edits).

import { NODE_DESPAWN_RANGE_M } from '../../core/constants.js';
import { distance } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../../terrain/density.js';
import type { World } from '../world.js';
import { l0ChunksNear, nodeChunkKey, nodesForChunk } from '../nodes.js';

const fieldCache = new WeakMap<World, Map<string, DensityField>>();
const settledCache = new WeakMap<World, Set<string>>();

function fieldFor(world: World, planet: PlanetConfig): DensityField {
  let perWorld = fieldCache.get(world);
  if (!perWorld) {
    perWorld = new Map();
    fieldCache.set(world, perWorld);
  }
  let field = perWorld.get(planet.id);
  if (!field) {
    field = createDensityField(planet, world.seed, (x, y, z) =>
      world.terrainEdits.deltaAt(planet, planet.id, x, y, z),
    );
    perWorld.set(planet.id, field);
  }
  return field;
}

function settledFor(world: World): Set<string> {
  let settled = settledCache.get(world);
  if (!settled) {
    settled = new Set();
    settledCache.set(world, settled);
  }
  return settled;
}

/** Spawn nearby deterministic nodes; despawn ones every player left behind. */
export function updateNodes(world: World, planets: PlanetConfig[]): void {
  const players = [...world.entities.values()].filter((e) => e.kind === 'player');
  if (players.length === 0) return;
  const settled = settledFor(world);
  for (const player of players) {
    const planet = planets.find((p) => p.id === player.planetId);
    if (!planet) continue;
    const field = fieldFor(world, planet);
    for (const coord of l0ChunksNear(player.position, planet)) {
      // Placement marches are the expensive part: run them once per visit.
      const key = nodeChunkKey(planet.id, coord);
      if (settled.has(key)) continue;
      settled.add(key);
      for (const spec of nodesForChunk(world.seed, planet, coord, field.density)) {
        if (world.depletedNodes.has(spec.id)) continue;
        if (world.entities.has(spec.id)) continue;
        const charges = world.nodeCharges.get(spec.id) ?? spec.charges;
        world.entities.set(spec.id, {
          id: spec.id,
          kind: 'node',
          planetId: planet.id,
          position: { ...spec.position },
          rotation: { ...spec.rotation },
          components: {
            node: { resourceId: spec.resourceId, charges, maxCharges: spec.maxCharges, chunkKey: spec.chunkKey },
          },
        });
      }
    }
  }
  // Despawn nodes no player is near. Partial charges persist in nodeCharges
  // (reapplied on respawn); depletions persist in depletedNodes.
  for (const [id, entity] of [...world.entities]) {
    if (entity.kind !== 'node') continue;
    let near = false;
    for (const player of players) {
      if (distance(entity.position, player.position) <= NODE_DESPAWN_RANGE_M) {
        near = true;
        break;
      }
    }
    if (!near) {
      const charges = entity.components.node?.charges;
      if (typeof charges === 'number') world.nodeCharges.set(id, charges);
      settled.delete(entity.components.node?.chunkKey ?? '');
      world.entities.delete(id);
    }
  }
}
