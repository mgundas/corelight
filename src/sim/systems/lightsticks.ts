// Light-stick re-seating system (M09). Static sticks must follow terrain
// edits: digging under one would leave it floating, and adding soil would
// bury it. Terrain edits mark their planet dirty; the next tick re-seats
// every stick on that planet with the same precise surface march used at
// placement (0.25 m steps + bisection). Cost is tiny (stick counts are small)
// and only runs on edited planets.

import { events } from '../../core/events.js';
import { quatFromTo } from '../../core/math.js';
import { upAt } from '../physics/frames.js';
import { seatTetherOnGround } from '../tetherActions.js';
import type { World } from '../world.js';

const dirtyCache = new WeakMap<World, Set<string>>();

/** Dirty planet ids for a world, with a WeakRef terrainEdited subscription
 * (dead sessions must never be kept alive by the bus). */
function dirtyPlanetsFor(world: World): Set<string> {
  let dirty = dirtyCache.get(world);
  if (!dirty) {
    dirty = new Set<string>();
    dirtyCache.set(world, dirty);
    const ref = new WeakRef(world);
    events.on('terrainEdited', ({ planetId }) => {
      const live = ref.deref();
      if (!live) return;
      dirtyCache.get(live)?.add(planetId);
    });
  }
  return dirty;
}

export function updateLightsticks(world: World): void {
  const dirty = dirtyPlanetsFor(world);
  if (dirty.size === 0) return;
  const planets = new Set(dirty);
  dirty.clear();
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'lightstick' || !entity.planetId) continue;
    if (!planets.has(entity.planetId)) continue;
    const planet = world.planets.find((p) => p.id === entity.planetId);
    if (!planet) continue;
    entity.position = seatTetherOnGround(world, planet.id, entity.position);
    entity.rotation = quatFromTo({ x: 0, y: 1, z: 0 }, upAt(planet, entity.position));
  }
}
