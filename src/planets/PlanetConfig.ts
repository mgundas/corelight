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
  surfaceColors: { flat: Rgb; steep: Rgb };
  atmosphere: { sky: Rgb; ground: Rgb; height: number };
  lodMaxLevel: number;
}
