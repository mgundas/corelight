// Deterministic research sample pods (M11): one possible glowing pod per
// LOD0 chunk, derived from the world seed + chunk key exactly like resource
// nodes. No placements are stored; picked-up pod ids land in
// World.depletedSamples and never respawn.
//
// Placement: gate by the chunk's layer (crust 1/6, mantle 1/3, core chamber
// always), then find a cave-wall crossing (falling back to open cave air).
// Identity derives from the BASE density; the live edited field only
// re-seats the pod so an unrelated dig never changes its id or value.

import {
  SAMPLE_CRUST_CHANCE,
  SAMPLE_MANTLE_CHANCE,
  SAMPLE_VALUE_CORE,
  SAMPLE_VALUE_CRUST,
  SAMPLE_VALUE_MANTLE,
  SAMPLE_VALUE_SURFACE,
} from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { normalize, quatFromTo, sub, type Quat, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkKey, chunkSizeForLevel, type ChunkCoord } from '../terrain/chunkKey.js';
import { layerAt, type DensityFn } from '../terrain/density.js';
import { nodeOrigin } from '../terrain/octree.js';
import { findCaveSpot, normalAt, reseatOnLive } from './nodes.js';

export interface SampleSpec {
  /** Deterministic id: sample_<planet>_<level>_<x>_<y>_<z>. */
  id: string;
  /** LOD0 chunk key this pod was placed from (respawn bookkeeping). */
  chunkKey: string;
  /** Data value when processed. */
  value: number;
  /** World-space doubles. */
  position: Vec3d;
  /** Local +Y maps onto the wall's air direction. */
  rotation: Quat;
}

/** Stable deterministic pod id (one pod max per chunk). */
export function sampleIdFor(planetId: string, coord: ChunkCoord): string {
  return `sample_${planetId}_0_${coord.x}_${coord.y}_${coord.z}`;
}

/** LOD0 chunk key a pod was placed from. */
export function sampleChunkKey(planetId: string, coord: ChunkCoord): string {
  return chunkKey(planetId, 0, coord);
}

/** Data value by layer (PROJECT.md: crust 10, mantle 20, core chamber 40). */
export function sampleValueForLayer(layer: string): number {
  if (layer === 'core_chamber') return SAMPLE_VALUE_CORE;
  if (layer === 'mantle' || layer === 'core_shell') return SAMPLE_VALUE_MANTLE;
  if (layer === 'crust') return SAMPLE_VALUE_CRUST;
  return SAMPLE_VALUE_SURFACE;
}

/** Data value at a world position (node-mined research samples use this). */
export function sampleValueAt(planet: PlanetConfig, worldPos: Vec3d): number {
  const local = sub(worldPos, planet.center);
  return sampleValueForLayer(layerAt(planet, local.x, local.y, local.z).name);
}

/** Per-chunk spawn chance; 0 means the layer holds no sample pods. */
export function sampleChanceForLayer(layer: string): number {
  if (layer === 'core_chamber') return 1;
  if (layer === 'mantle') return SAMPLE_MANTLE_CHANCE;
  if (layer === 'crust') return SAMPLE_CRUST_CHANCE;
  return 0;
}

/** A point inside the hollow core chamber (radial air direction). */
function findCoreSpot(
  density: DensityFn,
  planet: PlanetConfig,
  min: Vec3d,
  size: number,
  rng: () => number,
): { local: Vec3d; normal: Vec3d } | null {
  const limit = planet.core.chamberRadius - 1.5;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const local = {
      x: min.x + rng() * size,
      y: min.y + rng() * size,
      z: min.z + rng() * size,
    };
    const r = Math.hypot(local.x, local.y, local.z);
    if (r > limit) continue;
    if (density(local.x, local.y, local.z) >= 0) continue;
    // Inside the chamber the air lies toward the center.
    return { local, normal: normalize({ x: -local.x, y: -local.y, z: -local.z }) };
  }
  return null;
}

/** A visible point in open cave air (fallback when no wall crossing is found). */
function findAirSpot(
  density: DensityFn,
  planet: PlanetConfig,
  min: Vec3d,
  size: number,
  rng: () => number,
): { local: Vec3d; normal: Vec3d } | null {
  const shellOuter = planet.core.chamberRadius + planet.core.shellThickness;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const local = {
      x: min.x + rng() * size,
      y: min.y + rng() * size,
      z: min.z + rng() * size,
    };
    const r = Math.hypot(local.x, local.y, local.z);
    if (r < shellOuter + 1 || r > planet.radius - 6) continue;
    if (density(local.x, local.y, local.z) >= -1.5) continue;
    return { local, normal: normalAt(density, local) };
  }
  return null;
}

function findSampleSpot(
  density: DensityFn,
  planet: PlanetConfig,
  min: Vec3d,
  size: number,
  rng: () => number,
): { local: Vec3d; normal: Vec3d } | null {
  return (
    findCaveSpot(density, planet, min, size, rng) ??
    findAirSpot(density, planet, min, size, rng)
  );
}

/**
 * Deterministic pod specs for one LOD0 chunk (0 or 1). Same world seed +
 * planet + chunk = identical pod (position, value, id); live edits only
 * re-seat it onto the current surface.
 */
export function sampleForChunk(
  worldSeed: number,
  planet: PlanetConfig,
  coord: ChunkCoord,
  baseDensity: DensityFn,
  liveDensity?: DensityFn,
): SampleSpec[] {
  const key = sampleChunkKey(planet.id, coord);
  const min = nodeOrigin(planet, 0, coord);
  const size = chunkSizeForLevel(0);
  const center = { x: min.x + size / 2, y: min.y + size / 2, z: min.z + size / 2 };
  const centerLayer = layerAt(planet, center.x, center.y, center.z).name;
  const chance = sampleChanceForLayer(centerLayer);
  if (chance <= 0) return [];
  const gateRng = createRng(`${worldSeed}:${planet.seed}:${key}:sample:gate`);
  if (gateRng() >= chance) return [];
  const spotRng = createRng(`${worldSeed}:${planet.seed}:${key}:sample:spot`);
  const baseSpot =
    centerLayer === 'core_chamber'
      ? findCoreSpot(baseDensity, planet, min, size, spotRng)
      : findSampleSpot(baseDensity, planet, min, size, spotRng);
  if (!baseSpot) return [];
  const layer = layerAt(planet, baseSpot.local.x, baseSpot.local.y, baseSpot.local.z).name;
  const live = liveDensity ?? baseDensity;
  const seated = reseatOnLive(live, baseDensity, min, size, baseSpot);
  // Push the pod off the wall into air so its glow is visible from the cave.
  const normal = seated.normal;
  const rotation = quatFromTo({ x: 0, y: 1, z: 0 }, normal);
  const position: Vec3d = {
    x: planet.center.x + seated.local.x + normal.x * 0.45,
    y: planet.center.y + seated.local.y + normal.y * 0.45,
    z: planet.center.z + seated.local.z + normal.z * 0.45,
  };
  return [
    {
      id: sampleIdFor(planet.id, coord),
      chunkKey: key,
      value: sampleValueForLayer(layer),
      position,
      rotation: { x: rotation.x + 0, y: rotation.y + 0, z: rotation.z + 0, w: rotation.w + 0 },
    },
  ];
}
