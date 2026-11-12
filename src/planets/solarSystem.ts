// Solar system: fixed planet centers for v1 (planets do not move).
// Both configs feed the same generator, streamer, physics and renderer.

import type { PlanetConfig } from './PlanetConfig.js';
import { SELA } from './configs/sela.js';
import { VORN } from './configs/vorn.js';

export const PLANETS: PlanetConfig[] = [SELA, VORN];

/**
 * Planet whose sphere the point is nearest to (center distance). Streaming,
 * sky/fog and debug readouts use this when no SOI is active. Pure: shared by
 * game, render and tests without importing each other.
 */
export function nearestPlanet(planets: PlanetConfig[], pos: { x: number; y: number; z: number }): PlanetConfig {
  if (planets.length === 0) throw new Error('nearestPlanet: no planets');
  let nearest = planets[0] as PlanetConfig;
  let best = Infinity;
  for (const planet of planets) {
    const dx = pos.x - planet.center.x;
    const dy = pos.y - planet.center.y;
    const dz = pos.z - planet.center.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) {
      best = d;
      nearest = planet;
    }
  }
  return nearest;
}
