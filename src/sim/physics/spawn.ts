// Player spawn: raymarch the density field from space down to the surface
// along a direction and hover just above it. Pure + deterministic (same
// seed = same spawn), so co-op clients agree without extra protocol.

import { SPAWN_HOVER_M, SPAWN_RAY_START_M, SPAWN_RAY_STEP_M } from '../../core/constants.js';
import { normalize, scale, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { createDensityField } from '../../terrain/density.js';

/** World-space spawn point above the surface along `dir` (default: north pole). */
export function findSpawnPosition(
  config: PlanetConfig,
  worldSeed: number,
  dir: Vec3d = { x: 0, y: 1, z: 0 },
): Vec3d {
  const field = createDensityField(config, worldSeed);
  const n = normalize(dir);
  let r = config.radius + SPAWN_RAY_START_M;
  while (r > 0) {
    const local = scale(n, r);
    if (field.density(local.x, local.y, local.z) >= 0) break;
    r -= SPAWN_RAY_STEP_M;
  }
  const hover = Math.max(r, 0) + SPAWN_HOVER_M;
  const local = scale(n, hover);
  return { x: config.center.x + local.x, y: config.center.y + local.y, z: config.center.z + local.z };
}
