// Sun state for the day/night cycle (ARCHITECTURE.md: one shared sun, fixed
// tilted axis, 12 minute period). The direction lives on the World so every
// client and replay agrees; it is derived from world.time, so same
// seed + same time = identical sunlight. No three.js here: render reads it.

import { DAY_LENGTH_S } from '../../core/constants.js';
import { dot, normalize, quatFromAxisAngle, rotateVector, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { surfaceDepthAt } from '../../terrain/density.js';
import type { World } from '../world.js';

/** Fixed tilt: the sun's orbit plane is tipped off the planet pole. */
export const SUN_AXIS: Vec3d = normalize({ x: 0.3, y: 1, z: 0.15 });

/** Sun direction at time 0: low in the east, i.e. morning at the pole spawn. */
export const SUN_INITIAL: Vec3d = normalize({ x: 1, y: 0.12, z: 0.2 });

/** Sun direction after `timeS` seconds: INITIAL rotated about SUN_AXIS. */
export function sunDirectionAt(timeS: number): Vec3d {
  const angle = (2 * Math.PI * timeS) / DAY_LENGTH_S;
  return rotateVector(SUN_INITIAL, quatFromAxisAngle(SUN_AXIS, angle));
}

/** Fractional time of day in [0, 1): 0 = sunrise, 0.25 = noon. */
export function timeOfDay(world: World): number {
  const f = (world.time / DAY_LENGTH_S) % 1;
  return f < 0 ? f + 1 : f;
}

/** Live sun direction (world space, unit length). */
export function sunDirection(world: World): Vec3d {
  return { ...world.sunDirection };
}

/**
 * True when the sun is above the local horizon at a planet-local point.
 * `planetId` is intentionally unused: both planets share one sun and neither
 * moves in v1 (ARCHITECTURE.md: Coordinates and scale), so daylight math is
 * planet-independent. The parameter stays so call sites must name the frame
 * explicitly and cannot silently mix up planet-local coordinates.
 */
export function isDaylight(world: World, _planetId: string, localPos: Vec3d): boolean {
  const up = normalize(localPos);
  if (up.x === 0 && up.y === 0 && up.z === 0) return false;
  return dot(world.sunDirection, up) > 0;
}

/**
 * Cheap depth below the unedited surface (positive = underground), from the
 * sim formula `planet.radius + surfaceNoise(dir) - r`. Never raycasts, so
 * it is safe to call every frame for lighting and fog.
 */
export function depthBelowSurface(world: World, planet: PlanetConfig, localPos: Vec3d): number {
  return surfaceDepthAt(planet, world.seed, localPos.x, localPos.y, localPos.z);
}

/** Sim system: re-derive the stored direction from the clock every tick.
 * Uses `time + dt` (the post-tick clock) because `World.tick` advances time
 * after running systems: the stored direction then matches `world.time`
 * exactly instead of lagging one tick behind it. `dt` is required (no
 * default): a bare `updateSun(world)` call would silently use the pre-tick
 * clock and disagree with the system path for the same world. */
export function updateSun(world: World, dt: number): void {
  world.sunDirection = sunDirectionAt(world.time + dt);
}
