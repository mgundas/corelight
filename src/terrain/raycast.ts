import { TERRAIN_QUERY_STEP_M } from '../core/constants.js';
import { add, scale, type Vec3d } from '../core/math.js';
import type { DensityField } from './density.js';

/** Distance to the first solid crossing in a planet-local density field.
 * Shared by aiming and streamed-physics safety; direction must be unit length. */
export function raycastDensity(field: DensityField, origin: Vec3d, direction: Vec3d, maxDistance: number): number | null {
  const densityAt = (t: number): number => {
    const p = add(origin, scale(direction, t));
    return field.density(p.x, p.y, p.z);
  };
  let previousDistance = 0;
  let previousDensity = densityAt(0);
  if (previousDensity >= 0) return 0;
  while (previousDistance < maxDistance) {
    const t = Math.min(previousDistance + TERRAIN_QUERY_STEP_M, maxDistance);
    const density = densityAt(t);
    if (density >= 0) return previousDistance + previousDensity / (previousDensity - density) * (t - previousDistance);
    previousDistance = t;
    previousDensity = density;
  }
  return null;
}
