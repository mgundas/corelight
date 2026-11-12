// Spherical gravity (ARCHITECTURE.md: Physics and gravity).
// Direction points at the planet center; magnitude is full at/above half
// the radius and eases to 15% at the center (floaty core chamber).
// Outside every sphere of influence (3 * radius) gravity is zero.

import { distance, length, normalize, scale, sub, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { nearestPlanet } from '../../planets/solarSystem.js';

export interface GravitySample {
  /** Acceleration vector in m/s^2, world frame. Zero outside every SOI. */
  vector: Vec3d;
  /** Dominant planet, or null in deep space. */
  planet: PlanetConfig | null;
}

/** Sphere of influence: 3 * planet radius (zero gravity outside it). */
export function sphereOfInfluence(config: PlanetConfig): number {
  return 3 * config.radius;
}

function magnitudeAt(config: PlanetConfig, r: number): number {
  const t = Math.min(1, Math.max(0, r / (0.5 * config.radius)));
  return config.gravity * Math.min(1, Math.max(0.15, t));
}

/**
 * Gravity at a world-space position. When spheres of influence overlap,
 * the strongest pull wins (deterministic dominant planet).
 */
export function gravityAt(planets: PlanetConfig[], worldPos: Vec3d): GravitySample {
  let best: PlanetConfig | null = null;
  let bestMag = 0;
  let bestR = 0;
  for (const planet of planets) {
    const r = length(sub(worldPos, planet.center));
    if (r > sphereOfInfluence(planet)) continue;
    // At the exact center direction is undefined; magnitude is minimal.
    if (r < 1e-6) {
      const mag = magnitudeAt(planet, 0);
      if (mag > bestMag) {
        bestMag = mag;
        best = planet;
        bestR = 0;
      }
      continue;
    }
    const mag = magnitudeAt(planet, r);
    if (mag > bestMag) {
      bestMag = mag;
      best = planet;
      bestR = r;
    }
  }
  if (!best) return { vector: { x: 0, y: 0, z: 0 }, planet: null };
  if (bestR < 1e-6) {
    // Arbitrary downward axis at the singular center (magnitude is what matters).
    return { vector: { x: 0, y: -bestMag, z: 0 }, planet: best };
  }
  const toward = normalize(sub(best.center, worldPos));
  return { vector: scale(toward, bestMag), planet: best };
}

/**
 * Planet that owns a world position: the dominant SOI planet (the one whose
 * gravity wins), or the nearest one outside every SOI (M13). Streaming,
 * fog, sky and physics all resolve "the planet for this position" through
 * this one helper so they cannot disagree.
 */
export function primaryPlanet(planets: PlanetConfig[], worldPos: Vec3d): PlanetConfig {
  return gravityAt(planets, worldPos).planet ?? nearestPlanet(planets, worldPos);
}

/**
 * Primary planet with hysteresis: once `currentId` owns the frame, a
 * challenger must be closer by more than `marginM` before taking over. This
 * keeps the LOD/fog swap from flapping at the exact midpoint between two
 * planets (M13 review).
 */
export function selectPrimaryPlanet(
  planets: PlanetConfig[],
  worldPos: Vec3d,
  currentId: string | null,
  marginM: number,
): PlanetConfig {
  const candidate = primaryPlanet(planets, worldPos);
  if (!currentId || currentId === candidate.id) return candidate;
  const current = planets.find((planet) => planet.id === currentId);
  if (!current) return candidate;
  return distance(worldPos, candidate.center) + marginM < distance(worldPos, current.center)
    ? candidate
    : current;
}
