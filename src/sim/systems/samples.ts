// Sample pod streaming (M11): deterministic pods exist near each player and
// are removed when far, exactly like nodes. Placements derive from seed +
// chunk; only picked-up pod ids persist (World.depletedSamples), so a pod
// never respawns after collection while a dropped pod never vanishes.
//
// Picked-up pods stay in the entity map because the player may drop them or
// leave them at a station: those are excluded from streaming/deletion. A pod
// that was carried once but is not depleted yet is also left alone (defensive
// for hand-made saves) until the action records the depletion.
//
// Cost control matches nodes: one placement march per chunk per visit. Edits
// only re-seat pristine pods that a fill buried; resting or dropped pods keep
// the position physics gave them.

import { SAMPLE_DESPAWN_RANGE_M, SAMPLE_SPAWN_RANGE_M } from '../../core/constants.js';
import { distance, sub } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { parseChunkKey, type ChunkCoord } from '../../terrain/chunkKey.js';
import type { World } from '../world.js';
import { l0ChunksNear } from '../nodes.js';
import { sampleChunkKey, sampleForChunk } from '../samples.js';
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

/** Player-owned pods (carried, station-held, or already collected) persist. */
function ownedByPlayer(world: World, id: string): boolean {
  if (world.depletedSamples.has(id)) return true;
  const item = world.entities.get(id)?.components.item;
  return item?.holder !== undefined || item?.grabbedBy !== undefined;
}

/**
 * Edits must not teleport a pod that is resting where physics left it. Only a
 * fill that buries a pristine pod moves it, back to the fresh deterministic
 * wall spot (same id/value). Existing lives are reused; nothing is deleted.
 */
function reseatBuriedPods(
  world: World,
  planet: PlanetConfig,
  key: string,
  coord: ChunkCoord,
): void {
  const live = liveFieldFor(world, planet);
  const base = baseFieldFor(world, planet);
  for (const [id, entity] of [...world.entities]) {
    if (entity.kind !== 'sample' || entity.components.sample?.chunkKey !== key) continue;
    if (ownedByPlayer(world, id)) continue;
    const local = sub(entity.position, planet.center);
    if (live.density(local.x, local.y, local.z) < 0.2) continue;
    const spec = sampleForChunk(world.seed, planet, coord, base.density, live.density)[0];
    if (!spec) {
      world.entities.delete(id);
      continue;
    }
    entity.position = { ...spec.position };
    entity.rotation = { ...spec.rotation };
    const sample = entity.components.sample;
    if (sample) sample.value = spec.value;
  }
}

export function updateSamples(world: World, planets: PlanetConfig[]): void {
  const players = [...world.entities.values()].filter((e) => e.kind === 'player');
  if (players.length === 0) return;
  const settled = settledFor(world);
  const dirty = dirtyL0ChunksFor(world, 'samples');
  if (dirty.size > 0) {
    for (const key of dirty) {
      settled.delete(key);
      let parsed: { planetId: string; level: number; coord: ChunkCoord };
      try {
        parsed = parseChunkKey(key);
      } catch {
        continue;
      }
      if (parsed.level !== 0) continue;
      const planet = planets.find((p) => p.id === parsed.planetId);
      if (!planet) continue;
      reseatBuriedPods(world, planet, key, parsed.coord);
    }
    dirty.clear();
  }
  for (const player of players) {
    const planet = planets.find((p) => p.id === player.planetId);
    if (!planet) continue;
    const live = liveFieldFor(world, planet);
    const base = baseFieldFor(world, planet);
    for (const coord of l0ChunksNear(player.position, planet, SAMPLE_SPAWN_RANGE_M)) {
      const key = sampleChunkKey(planet.id, coord);
      if (settled.has(key)) continue;
      settled.add(key);
      for (const spec of sampleForChunk(world.seed, planet, coord, base.density, live.density)) {
        if (world.depletedSamples.has(spec.id)) continue;
        if (world.entities.has(spec.id)) continue;
        world.entities.set(spec.id, {
          id: spec.id,
          kind: 'sample',
          planetId: planet.id,
          position: { ...spec.position },
          rotation: { ...spec.rotation },
          components: {
            sample: { value: spec.value, chunkKey: spec.chunkKey },
            item: { itemId: 'research_sample' },
          },
        });
      }
    }
  }
  // Despawn pristine pods no player is near. Dropped/collected pods stay.
  const leaving: { id: string; chunkKey: string }[] = [];
  for (const [id, entity] of [...world.entities]) {
    if (entity.kind !== 'sample') continue;
    if (ownedByPlayer(world, id)) continue;
    let near = false;
    for (const player of players) {
      if (distance(entity.position, player.position) <= SAMPLE_DESPAWN_RANGE_M) {
        near = true;
        break;
      }
    }
    const chunkKey = entity.components.sample?.chunkKey;
    if (!near && chunkKey) leaving.push({ id, chunkKey });
  }
  if (leaving.length === 0) return;
  const leavingIds = new Set(leaving.map((l) => l.id));
  const liveKeys = new Set<string>();
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'sample' || leavingIds.has(entity.id)) continue;
    const key = entity.components.sample?.chunkKey;
    if (key) liveKeys.add(key);
  }
  for (const gone of leaving) {
    if (!liveKeys.has(gone.chunkKey)) settled.delete(gone.chunkKey);
    world.entities.delete(gone.id);
  }
}
