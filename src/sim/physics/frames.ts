// Planet-local physics frames (ARCHITECTURE.md: Floating origin).
// Rapier bodies near a planet live in that planet's local frame
// (local = world - center), so coordinates stay small and stable even
// 12 km from the origin on Vorn. In space the shuttle later gets its own
// frame centered on itself (M13/M14); M03 only needs the planet frames.

import { normalize, sub, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';

/** World-space doubles -> planet-local doubles. */
export function toLocalFrame(planet: PlanetConfig, worldPos: Vec3d): Vec3d {
  return sub(worldPos, planet.center);
}

/** Planet-local doubles -> world-space doubles. */
export function toWorldFrame(planet: PlanetConfig, localPos: Vec3d): Vec3d {
  return { x: localPos.x + planet.center.x, y: localPos.y + planet.center.y, z: localPos.z + planet.center.z };
}

/** Unit "up" (away from the planet center) at a world-space position. */
export function upAt(planet: PlanetConfig, worldPos: Vec3d): Vec3d {
  const up = sub(worldPos, planet.center);
  const n = normalize(up);
  // Exactly at the center: pick an arbitrary axis (gravity is minimal there).
  if (n.x === 0 && n.y === 0 && n.z === 0) return { x: 0, y: 1, z: 0 };
  return n;
}
