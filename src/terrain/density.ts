// Planet density field, exactly per docs/ARCHITECTURE.md:
//   d = depth + surfaceNoise * amplitude, minus cave carving,
//   min() with the hollow core chamber.
// Positive = solid, negative = air, surface at 0. Pure + deterministic.

import type { LayerConfig, PlanetConfig, Rgb } from '../planets/PlanetConfig.js';
import { createSeededNoise3D, fbm3, type NoiseFunction3D } from './noise.js';

export type DensityFn = (x: number, y: number, z: number) => number;

export interface DensityField {
  config: PlanetConfig;
  /** Density in planet-local coordinates. */
  density: DensityFn;
  caveThresholdAt: (depth: number) => number;
}

function depthAt(config: PlanetConfig, r: number): number {
  return config.radius - r;
}

/** Cave carve threshold grows with depth (thin near surface, wide deep). */
export function caveThresholdAtDepth(config: PlanetConfig, depth: number): number {
  const deep = config.radius - config.core.chamberRadius - config.core.shellThickness;
  const span = Math.max(1, deep - config.caves.startDepth);
  const t = Math.min(1, Math.max(0, (depth - config.caves.startDepth) / span));
  return config.caves.thresholdTop + (config.caves.thresholdBottom - config.caves.thresholdTop) * t;
}

export function createDensityField(config: PlanetConfig, worldSeed: number): DensityField {
  const base = `${worldSeed}:${config.seed}`;
  const surfaceNoise = createSeededNoise3D(`${base}:surface`);
  const caveA = createSeededNoise3D(`${base}:caveA`);
  const caveB = createSeededNoise3D(`${base}:caveB`);
  const caveThresholdAt = (depth: number): number => caveThresholdAtDepth(config, depth);

  const density: DensityFn = (x, y, z) => {
    const r = Math.sqrt(x * x + y * y + z * z);
    const depth = depthAt(config, r);
    // Surface relief: fbm sampled on the unit direction so bumps are
    // independent of radius (pure function of direction + seed).
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (r > 1e-6) {
      nx = x / r;
      ny = y / r;
      nz = z / r;
    }
    const f = config.surfaceFrequency;
    const relief = fbm3(surfaceNoise, nx * f, ny * f, nz * f, 4) * config.surfaceAmplitude;
    let d = depth + relief;
    // Cave worms: carve where both fields are near zero. min() keeps the
    // carve independent of depth so tunnels stay open in the deep mantle.
    // The carve applies UNCONDITIONALLY (plain min, exactly as documented):
    // near a worm wall both sides follow the carved branch, so the zero
    // crossing sits mid-cell and marching cubes emits clean quads with
    // smooth central-difference normals. A conditional carve (depth branch
    // outside, carved branch inside) pits +depth against ~0 and pins every
    // wall vertex onto a grid point, shredding walls into slivers. The zero
    // set is identical either way: min() is zero exactly at the surface or
    // at a worm wall.
    const shellOuter = config.core.chamberRadius + config.core.shellThickness;
    if (depth >= config.caves.startDepth && r >= shellOuter) {
      const cf = config.caves.frequency;
      const c = Math.abs(caveA(x * cf, y * cf, z * cf)) + Math.abs(caveB(x * cf, y * cf, z * cf));
      d = Math.min(d, (c - caveThresholdAt(depth)) * 10);
    }
    // Hollow core chamber (no caves inside the shell by the guard above).
    const chamber = r - config.core.chamberRadius;
    if (chamber < d) d = chamber;
    return d;
  };

  return { config, density, caveThresholdAt };
}

/** Backwards-compatible helper: density function only. */
export function createDensityFn(config: PlanetConfig, worldSeed: number): DensityFn {
  return createDensityField(config, worldSeed).density;
}

export interface LayerInfo extends LayerConfig {
  kind: 'layer' | 'core_shell' | 'core_chamber';
}

/** Layer at a planet-local point (includes core shell/chamber pseudo-layers). */
export function layerAt(config: PlanetConfig, x: number, y: number, z: number): LayerInfo {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r <= config.core.chamberRadius) {
    return {
      kind: 'core_chamber',
      name: 'core_chamber',
      fromDepth: config.radius - config.core.chamberRadius,
      toDepth: Infinity,
      hardness: 0,
      color: config.core.chamberColor,
      colorVariation: 0,
    };
  }
  if (r <= config.core.chamberRadius + config.core.shellThickness) {
    return {
      kind: 'core_shell',
      name: 'core_shell',
      fromDepth: config.radius - config.core.chamberRadius - config.core.shellThickness,
      toDepth: config.radius - config.core.chamberRadius,
      hardness: config.core.shellHardness,
      color: [0.25, 0.24, 0.3],
      colorVariation: 0.05,
    };
  }
  const depth = depthAt(config, r);
  const layers = config.layers;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i] as LayerConfig;
    if (depth >= layer.fromDepth) return { ...layer, kind: 'layer' };
  }
  return { ...(layers[0] as LayerConfig), kind: 'layer' };
}

const detailNoises = new Map<string, NoiseFunction3D>();

function detailNoise(salt: string | number): NoiseFunction3D {
  const key = String(salt);
  let noise = detailNoises.get(key);
  if (!noise) {
    noise = createSeededNoise3D(`corelight:color-detail:${key}`);
    detailNoises.set(key, noise);
  }
  return noise;
}

/** Vertex color: layer color with noise variation; grass/dirt by slope at top. */
export function colorAt(
  config: PlanetConfig,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  salt: string | number = 'default',
): Rgb {
  const r = Math.sqrt(x * x + y * y + z * z);
  const depth = depthAt(config, r);
  // Slope = alignment of the surface normal with radial "up".
  let slope = 1;
  if (r > 1e-6) {
    const inv = 1 / r;
    slope = Math.min(1, Math.max(-1, (x * nx + y * ny + z * nz) * inv));
  }
  // Close to the surface, blend grass (flat) and dirt (steep).
  if (depth < 8 && depth > -20) {
    const t = Math.min(1, Math.max(0, (0.75 - slope) / 0.35));
    const a = config.surfaceColors.flat;
    const b = config.surfaceColors.steep;
    const v = 1 + detailNoise(salt)(x * 0.11, y * 0.11, z * 0.11) * 0.06;
    return [
      (a[0] + (b[0] - a[0]) * t) * v,
      (a[1] + (b[1] - a[1]) * t) * v,
      (a[2] + (b[2] - a[2]) * t) * v,
    ];
  }
  const layer = layerAt(config, x, y, z);
  const v = 1 + detailNoise(salt)(x * 0.05, y * 0.05, z * 0.05) * layer.colorVariation;
  return [layer.color[0] * v, layer.color[1] * v, layer.color[2] * v];
}

/** Sample-grid helpers shared by the worker and tests. */
export function sampleIndex(ix: number, iy: number, iz: number, size: number): number {
  return ix + size * (iy + size * iz);
}

export function gradientAt(
  samples: Float32Array,
  size: number,
  ix: number,
  iy: number,
  iz: number,
): { x: number; y: number; z: number } {
  // Caller guarantees a 1-sample border (indices 1..size-2 are safe).
  const c = (dx: number, dy: number, dz: number): number =>
    samples[sampleIndex(ix + dx, iy + dy, iz + dz, size)] as number;
  return {
    x: (c(1, 0, 0) - c(-1, 0, 0)) / 2,
    y: (c(0, 1, 0) - c(0, -1, 0)) / 2,
    z: (c(0, 0, 1) - c(0, 0, -1)) / 2,
  };
}
