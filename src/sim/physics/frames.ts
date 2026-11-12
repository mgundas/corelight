// Planet-local physics frames (ARCHITECTURE.md: Floating origin).
// Rapier bodies near a planet live in that planet's local frame
// (local = world - center), so coordinates stay small and stable even
// 12 km from the origin on Vorn. In space the shuttle later gets its own
// frame centered on itself (M13/M14); M03 only needs the planet frames.

import {
  add,
  cross,
  normalize,
  quatFromAxisAngle,
  quatFromTo,
  quatMultiply,
  scale,
  sub,
  type Quat,
  type Vec3d,
} from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { gravityAt } from './gravity.js';

/** World-space doubles -> planet-local doubles. */
export function toLocalFrame(planet: PlanetConfig, worldPos: Vec3d): Vec3d {
  return sub(worldPos, planet.center);
}

/**
 * Planet whose local frame owns a world-space point: the dominant SOI
 * planet, or null in deep space. The transfer itself is an id relabel —
 * entity positions stay world-frame doubles (M13) — so no coordinate math
 * is needed; body owners rebind when the id changes.
 */
export function transferPlanetId(planets: PlanetConfig[], worldPos: Vec3d): string | null {
  return gravityAt(planets, worldPos).planet?.id ?? null;
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

/**
 * Camera/movement basis at a look orientation. `forward` includes pitch
 * (aim direction); ground movement uses its projection onto the tangent
 * plane. Pure math: safe to share between sim and render-side camera code.
 */
export function moveBasis(up: Vec3d, yaw: number, pitch: number): { forward: Vec3d; right: Vec3d } {
  const ref = Math.abs(up.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const east = normalize(cross(up, ref));
  const north = cross(east, up);
  // Yaw rotates around up; yaw = 0 faces north, positive yaw turns right.
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const flatFwd = add(scale(north, cosY), scale(east, sinY));
  const right = normalize(cross(flatFwd, up));
  const forward = normalize(add(scale(flatFwd, Math.cos(pitch)), scale(up, Math.sin(pitch))));
  return { forward, right };
}

/** Orientation quaternion: local +Y maps to `up`, then yawed around up. */
export function orientationForUpYaw(up: Vec3d, yaw: number): Quat {
  const align = quatFromTo({ x: 0, y: 1, z: 0 }, normalize(up));
  return quatMultiply(quatFromAxisAngle(normalize(up), yaw), align);
}
