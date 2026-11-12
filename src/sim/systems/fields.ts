// Shared per-world density fields for streaming systems (M07/M11). Nodes and
// research samples both need the unedited placement field (identity) and the
// live edited field (re-seating); caching per world + planet keeps the
// deterministic marches cheap and guarantees both systems see one field.

import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../../terrain/density.js';
import type { World } from '../world.js';

const liveCache = new WeakMap<World, Map<string, DensityField>>();
const baseCache = new WeakMap<World, Map<string, DensityField>>();

function cached(
  cache: WeakMap<World, Map<string, DensityField>>,
  world: World,
  planet: PlanetConfig,
  build: () => DensityField,
): DensityField {
  let perWorld = cache.get(world);
  if (!perWorld) {
    perWorld = new Map();
    cache.set(world, perWorld);
  }
  let field = perWorld.get(planet.id);
  if (!field) {
    field = build();
    perWorld.set(planet.id, field);
  }
  return field;
}

/** Live field: base terrain + the player's sparse edits. */
export function liveFieldFor(world: World, planet: PlanetConfig): DensityField {
  return cached(liveCache, world, planet, () =>
    createDensityField(planet, world.seed, (x, y, z) =>
      world.terrainEdits.deltaAt(planet, planet.id, x, y, z),
    ),
  );
}

/** Unedited placement field: identity (spot + value) never sees digs. */
export function baseFieldFor(world: World, planet: PlanetConfig): DensityField {
  return cached(baseCache, world, planet, () => createDensityField(planet, world.seed));
}
