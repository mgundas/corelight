import { SHUTTLE_TERRAIN_PENDING_ALTITUDE_M } from '../core/constants.js';
import { normalize, sub, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../terrain/density.js';
import { raycastDensity } from '../terrain/raycast.js';
import { gravityAt } from './physics/gravity.js';
import { altitudeAbove } from './shuttle.js';
import type { ShuttleSystemOptions } from './systems/shuttle.js';
import type { World } from './world.js';

/** Colliders are the contact authority, but a fast arrival must still see
 * the ground while worker results are pending. Live edits use the same field. */
export function shuttleGroundProbe(world: World, colliderProbe: ShuttleSystemOptions['probe']): ShuttleSystemOptions['probe'] {
  const fields = new Map<string, DensityField>();
  return {
    castTerrainRay(origin: Vec3d, direction: Vec3d, planets: PlanetConfig[], maxDistance: number): number | null {
      const hit = colliderProbe.castTerrainRay(origin, direction, planets, maxDistance);
      if (hit !== null) return hit;
      const planet = gravityAt(planets, origin).planet;
      if (!planet || altitudeAbove(planet, origin) > SHUTTLE_TERRAIN_PENDING_ALTITUDE_M) return null;
      let field = fields.get(planet.id);
      if (!field) {
        field = createDensityField(planet, world.seed, (x, y, z) => world.terrainEdits.deltaAt(planet, planet.id, x, y, z));
        fields.set(planet.id, field);
      }
      return raycastDensity(field, sub(origin, planet.center), normalize(direction), maxDistance);
    },
  };
}
