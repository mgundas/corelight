// Terrain-edit plumbing (M04). Split out of Game to keep both files under
// the 400-line hard rule: connects the World's edit store to the collider
// ring and the mesh streamer, and owns the edited-density fields the tool
// aim reads. Returns the event unsubscribe for Game.stop().

import { events } from '../core/events.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../terrain/density.js';
import { parseChunkKey } from '../terrain/chunkKey.js';
import type { ChunkManager } from '../terrain/chunkManager.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';
import type { World } from '../sim/world.js';

export interface EditWiring {
  /** Edited-density fields for the tool fallback raymarch + normals. */
  toolFields: Map<string, DensityField>;
  /** Undo the terrainEdited subscription (call from Game.stop). */
  dispose(): void;
}

export function wireTerrainEdits(
  world: World,
  planets: PlanetConfig[],
  colliders: TerrainColliders,
  streamer: ChunkManager,
): EditWiring {
  const toolFields = new Map<string, DensityField>();
  for (const planet of planets) {
    toolFields.set(
      planet.id,
      createDensityField(planet, world.seed, (x, y, z) =>
        world.terrainEdits.deltaAt(planet, planet.id, x, y, z),
      ),
    );
  }
  // Edited chunks carry their deltas into every mesh job (streaming and
  // priority remesh alike); the streamer diffs by job version.
  streamer.setEditSource((key) => {
    try {
      const parsed = parseChunkKey(key);
      const planet = planets.find((p) => p.id === parsed.planetId);
      if (!planet || parsed.level > 1) return null;
      return world.terrainEdits.deltasForJob(planet, parsed.level, parsed.coord);
    } catch {
      return null;
    }
  });
  // Fan-out for remeshing: the same tick's edits rebuild render meshes
  // and physics colliders (old meshes/colliders stay until fresh data
  // lands, so the player never falls through a half-updated hole).
  const dispose = events.on('terrainEdited', ({ keys }) => {
    colliders.notifyEdited(keys);
    streamer.notifyEdited(keys);
  });
  return { toolFields, dispose };
}
