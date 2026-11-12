// Node streaming system (M07): deterministic nodes exist near each player
// and are removed when far. Placements derive from seed + chunk (never
// stored); only mining outcomes persist (node entities with charges,
// nodeCharges for partial progress across far despawns, depletedNodes once
// exhausted). Runs after physics in the tick order.
//
// Cost control: the density marches behind placement run once per chunk per
// visit (tracked in a per-world settled set), never per tick. Far despawns
// leave the set only when the chunk's last node leaves, so returns are
// cheap; terrain edits evict affected chunks (via terrainEdited) and re-seat
// their nodes the same tick, so deposits never float over dug ground.
// Determinism holds throughout: recompute is a pure function of seed +
// chunk (+ live edits).

import { NODE_DESPAWN_RANGE_M } from '../../core/constants.js';
import { distance } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import type { World } from '../world.js';
import { l0ChunksNear, nodeChunkKey, nodesForChunk } from '../nodes.js';
import { dirtyL0ChunksFor } from './editedChunks.js';
import { baseFieldFor, liveFieldFor } from './fields.js';

const settledCache = new WeakMap<World, Set<string>>();

function settledFor(world: World): Set<string> {
  let settled = settledCache.get(world);
  if (!settled) {
    settled = new Set();
    settledCache.set(world, settled);
  }
  return settled;
}

/** Stash partial progress (full-charge nodes need no record). */
function stashCharges(world: World, id: string, charges: number, maxCharges: number): void {
  if (charges !== maxCharges) world.nodeCharges.set(id, charges);
  else world.nodeCharges.delete(id);
}

/** Spawn nearby deterministic nodes; despawn ones every player left behind. */
export function updateNodes(world: World, planets: PlanetConfig[]): void {
  const players = [...world.entities.values()].filter((e) => e.kind === 'player');
  if (players.length === 0) return;
  const settled = settledFor(world);
  const dirty = dirtyL0ChunksFor(world, 'nodes');
  // Edited chunks re-seat the same tick: drop their nodes (stashing partial
  // charges) and forget the placement so the spawn loop recomputes it from
  // the live edited field below.
  if (dirty.size > 0) {
    for (const key of dirty) {
      settled.delete(key);
      for (const [id, entity] of [...world.entities]) {
        if (entity.kind !== 'node' || entity.components.node?.chunkKey !== key) continue;
        const nc = entity.components.node;
        if (nc) stashCharges(world, id, nc.charges, nc.maxCharges);
        world.entities.delete(id);
      }
    }
    dirty.clear();
  }
  for (const player of players) {
    const planet = planets.find((p) => p.id === player.planetId);
    if (!planet) continue;
    const field = liveFieldFor(world, planet);
    const base = baseFieldFor(world, planet);
    for (const coord of l0ChunksNear(player.position, planet)) {
      // Placement marches are the expensive part: run them once per visit.
      const key = nodeChunkKey(planet.id, coord);
      if (settled.has(key)) continue;
      settled.add(key);
      for (const spec of nodesForChunk(world.seed, planet, coord, base.density, field.density)) {
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
  // (reapplied on respawn); depletions persist in depletedNodes. The chunk
  // leaves the settled set only with its last node, so a boundary hover
  // with siblings still live never re-marches.
  const leaving: { id: string; chunkKey: string; charges: number; maxCharges: number }[] = [];
  for (const [id, entity] of [...world.entities]) {
    if (entity.kind !== 'node') continue;
    let near = false;
    for (const player of players) {
      if (distance(entity.position, player.position) <= NODE_DESPAWN_RANGE_M) {
        near = true;
        break;
      }
    }
    if (!near && entity.components.node) {
      const nc = entity.components.node;
      leaving.push({ id, chunkKey: nc.chunkKey, charges: nc.charges, maxCharges: nc.maxCharges });
    }
  }
  if (leaving.length === 0) return;
  const leavingIds = new Set(leaving.map((l) => l.id));
  const liveKeys = new Set<string>();
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'node' || leavingIds.has(entity.id)) continue;
    const key = entity.components.node?.chunkKey;
    if (key) liveKeys.add(key);
  }
  for (const gone of leaving) {
    stashCharges(world, gone.id, gone.charges, gone.maxCharges);
    if (!liveKeys.has(gone.chunkKey)) settled.delete(gone.chunkKey);
    world.entities.delete(gone.id);
  }
}
