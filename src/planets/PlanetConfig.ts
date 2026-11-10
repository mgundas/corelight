// Planet configuration: all per-planet tuning lives here so Sela and
// Vorn share one generator. Colors are linear-space RGB triples.

import type { Vec3d } from '../core/math.js';

export type Rgb = [number, number, number];

export interface LayerConfig {
  name: string;
  /** Depth below the nominal surface radius where this layer starts. */
  fromDepth: number;
  /** Depth where it ends (use Infinity for the deepest layer). */
  toDepth: number;
  hardness: number;
  color: Rgb;
  /** Relative brightness noise on the layer color, e.g. 0.1 = +/-10%. */
  colorVariation: number;
}

export interface CaveConfig {
  /** Spatial frequency of the worm fields (per meter). */
  frequency: number;
  /** Carve threshold at the surface (thin tunnels). */
  thresholdTop: number;
  /** Carve threshold deep down (wide tunnels). */
  thresholdBottom: number;
  /** No caves above this depth (keeps the surface solid). */
  startDepth: number;
}

export interface CoreConfig {
  chamberRadius: number;
  shellThickness: number;
  shellHardness: number;
  chamberColor: Rgb;
}

/**
 * Cavern-floor stacking (supplements the worm tunnels, which thread the
 * slabs and connect adjacent floors). Floors are derived from planet size:
 * count = clamp(floor(usable / (cavernHeight + slabThickness)), min, max)
 * where usable = radius - chamber - shell - surfaceCap. Leftover rock stays
 * above the core shell, so rooms never touch it.
 */
export interface CavernConfig {
  enabled: boolean;
  /** No cavern rooms above this depth (keeps the surface solid). */
  surfaceCapDepth: number;
  /** Open room height in meters. */
  cavernHeight: number;
  /** Rock slab thickness between rooms in meters. */
  slabThickness: number;
  minFloors: number;
  maxFloors: number;
  /** Gentle floor relief amplitude in meters (walkable, not flat). */
  floorRoughness: number;
  /** Floor relief spatial frequency (per meter). */
  floorRoughFrequency: number;
  /** Fraction of floor area covered by shallow pits (0..1). */
  pitCoverage: number;
  /** Maximum pit dip in meters (capped by minSlabLeftover). */
  pitDepth: number;
  /** Pit blotch spatial frequency (per meter). */
  pitFrequency: number;
  /** Minimum rock left under the deepest pit (pits never breach slabs). */
  minSlabLeftover: number;
  /** Worm widening inside slabs (threshold multiplier bonus, e.g. 0.8). */
  openingBoost: number;
  /** Fraction of each floor level that is open room (0..1, rest stays rock). */
  roomCoverage: number;
  /** Room blotch spatial frequency (per meter, ~room diameter scale). */
  roomFrequency: number;
  /** Lateral distance of the guaranteed anchor pocket from the pole axis. */
  roomAnchorRadius: number;
  /** Anchor pocket radius: fully open inside half, pinched shut outside. */
  roomAnchorSize: number;
}

export interface PlanetConfig {
  id: string;
  name: string;
  /** Planet-specific seed, combined with the world seed for noise. */
  seed: number;
  center: Vec3d;
  radius: number;
  /** Surface gravity in m/s^2 (character feel tuned in M03). */
  gravity: number;
  /** Surface relief amplitude in meters (fbm on the unit direction). */
  surfaceAmplitude: number;
  /** Spatial frequency of the surface relief (per unit direction). */
  surfaceFrequency: number;
  caves: CaveConfig;
  layers: LayerConfig[];
  core: CoreConfig;
  caverns: CavernConfig;
  surfaceColors: { flat: Rgb; steep: Rgb };
  atmosphere: { sky: Rgb; ground: Rgb; height: number };
  lodMaxLevel: number;
}
