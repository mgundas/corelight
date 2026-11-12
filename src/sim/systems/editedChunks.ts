// Per-world dirty LOD0 chunk set for deterministic streaming systems. The
// terrainEdited event carries the affected keys; each subscriber (nodes,
// samples) gets its own queue and drains it on its next tick — a shared set
// would let the first system consume edits the next one still needs. A
// WeakRef handler means a dead session's World is never kept alive by the bus.

import { events } from '../../core/events.js';
import { parseChunkKey } from '../../terrain/chunkKey.js';
import type { World } from '../world.js';

const cache = new WeakMap<World, Map<string, Set<string>>>();

/** Edited LOD0 chunk keys not yet drained by `owner`. */
export function dirtyL0ChunksFor(world: World, owner: string): Set<string> {
  let perWorld = cache.get(world);
  if (!perWorld) {
    perWorld = new Map();
    cache.set(world, perWorld);
  }
  let dirty = perWorld.get(owner);
  if (!dirty) {
    dirty = new Set<string>();
    perWorld.set(owner, dirty);
    const ref = new WeakRef(world);
    events.on('terrainEdited', ({ keys }) => {
      const live = ref.deref();
      if (!live) return;
      const set = cache.get(live)?.get(owner);
      if (!set) return;
      for (const key of keys) {
        try {
          if (parseChunkKey(key).level === 0) set.add(key);
        } catch {
          // Malformed keys never match a chunk; ignore them.
        }
      }
    });
  }
  return dirty;
}
