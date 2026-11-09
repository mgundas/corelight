// Seeded 3D simplex noise + fbm. Runs in workers and on the main thread.
// WHY seeded: same world seed + planet seed must give identical terrain
// everywhere (workers, future server, replays).

import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import { createRng } from '../core/rng.js';

export type { NoiseFunction3D };

/** Deterministic 3D noise from any string|number seed. */
export function createSeededNoise3D(seed: string | number): NoiseFunction3D {
  return createNoise3D(createRng(seed));
}

/**
 * Fractal Brownian motion over `octaves`, normalized to roughly [-1, 1].
 * Divide by the amplitude sum so callers can scale by a fixed amplitude.
 */
export function fbm3(
  noise: NoiseFunction3D,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * noise(x * frequency, y * frequency, z * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}
