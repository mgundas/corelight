// Deterministic resource nodes (M07): placement per LOD0 chunk from the
// chunk key + world seed, so nodes are never stored unless changed (mined).
// Mined-out nodes land in World.depletedNodes and never respawn; everything
// else re-derives identically from seed + chunk. No three.js here: positions
// are world-space doubles, orientation a plain quaternion.

import {
  NODE_MAX_CHARGES,
  NODE_MIN_CHARGES,
  NODE_SPAWN_RANGE_M,
} from '../core/constants.js';
import { createRng } from '../core/rng.js';
import {
  length,
  normalize,
  quatFromTo,
  sub,
  type Quat,
  type Vec3d,
} from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkKey, chunkSizeForLevel, type ChunkCoord } from '../terrain/chunkKey.js';
import { layerAt, type DensityFn } from '../terrain/density.js';
import { nodeOrigin, rootMin } from '../terrain/octree.js';

export interface NodeSpec {
  /** Deterministic id: node_<planet>_<level>_<x>_<y>_<z>_<index>. */
  id: string;
  /** LOD0 chunk key this spec was placed from (drives respawn bookkeeping). */
  chunkKey: string;
  resourceId: string;
  /** World-space doubles. */
  position: Vec3d;
  /** Local +Y maps onto the terrain normal (nodes sit upright on walls). */
  rotation: Quat;
  charges: number;
  maxCharges: number;
}

export function nodeIdFor(planetId: string, coord: ChunkCoord, index: number): string {
  return `node_${planetId}_0_${coord.x}_${coord.y}_${coord.z}_${index}`;
}

/** LOD0 chunk key this node was placed from (for debugging/tests). */
export function nodeChunkKey(planetId: string, coord: ChunkCoord): string {
  return chunkKey(planetId, 0, coord);
}

function boxContains(min: Vec3d, size: number, p: Vec3d): boolean {
  return (
    p.x >= min.x && p.x <= min.x + size && p.y >= min.y && p.y <= min.y + size && p.z >= min.z && p.z <= min.z + size
  );
}

function pointBoxDistance(p: Vec3d, min: Vec3d, size: number): number {
  let d2 = 0;
  if (p.x < min.x) d2 += (min.x - p.x) ** 2;
  else if (p.x > min.x + size) d2 += (p.x - (min.x + size)) ** 2;
  if (p.y < min.y) d2 += (min.y - p.y) ** 2;
  else if (p.y > min.y + size) d2 += (p.y - (min.y + size)) ** 2;
  if (p.z < min.z) d2 += (min.z - p.z) ** 2;
  else if (p.z > min.z + size) d2 += (p.z - (min.z + size)) ** 2;
  return Math.sqrt(d2);
}

/** All LOD0 chunk coords whose box comes within range of a world position. */
export function l0ChunksNear(worldPos: Vec3d, planet: PlanetConfig, range = NODE_SPAWN_RANGE_M): ChunkCoord[] {
  const local = sub(worldPos, planet.center);
  const size = chunkSizeForLevel(0);
  const min = rootMin(planet);
  const perAxis = 2 ** planet.lodMaxLevel;
  const clampAxis = (v: number): number => Math.min(perAxis - 1, Math.max(0, v));
  const lo = {
    x: clampAxis(Math.floor((local.x - range - min.x) / size)),
    y: clampAxis(Math.floor((local.y - range - min.y) / size)),
    z: clampAxis(Math.floor((local.z - range - min.z) / size)),
  };
  const hi = {
    x: clampAxis(Math.floor((local.x + range - min.x) / size)),
    y: clampAxis(Math.floor((local.y + range - min.y) / size)),
    z: clampAxis(Math.floor((local.z + range - min.z) / size)),
  };
  const out: ChunkCoord[] = [];
  for (let x = lo.x; x <= hi.x; x += 1) {
    for (let y = lo.y; y <= hi.y; y += 1) {
      for (let z = lo.z; z <= hi.z; z += 1) {
        const origin = nodeOrigin(planet, 0, { x, y, z });
        if (pointBoxDistance(local, origin, size) <= range) out.push({ x, y, z });
      }
    }
  }
  return out;
}

/** Central-difference surface normal (points toward air). */
export function normalAt(density: DensityFn, local: Vec3d): Vec3d {
  const eps = 0.5;
  const dx = density(local.x + eps, local.y, local.z) - density(local.x - eps, local.y, local.z);
  const dy = density(local.x, local.y + eps, local.z) - density(local.x, local.y - eps, local.z);
  const dz = density(local.x, local.y, local.z + eps) - density(local.x, local.y, local.z - eps);
  // +0 normalizes -0 (exact-zero gradients negate to -0, and JSON saves
  // turn -0 into 0, which would break save round-trip equality).
  const n = normalize({ x: -dx + 0, y: -dy + 0, z: -dz + 0 });
  if (n.x === 0 && n.y === 0 && n.z === 0) {
    const up = normalize(local);
    return up.x === 0 && up.y === 0 && up.z === 0 ? { x: 0, y: 1, z: 0 } : up;
  }
  return n;
}

function pick<T>(rng: () => number, options: T[]): T {
  return options[Math.floor(rng() * options.length)] as T;
}

/**
 * Resource by layer and wall context (PROJECT.md placement rules).
 * Surface: resin/silicate (+biomass on Sela, hydrite on Vorn). Crust walls
 * add lumen crystals and research samples. Mantle: cuprite + research
 * (Vorn adds voidstone). Core shell/chamber: the engine resources.
 */
export function pickResource(
  rng: () => number,
  planetId: string,
  layer: string,
  caveWall: boolean,
): string {
  if (layer === 'core_chamber' || layer === 'core_shell') {
    return planetId === 'vorn' ? 'voidstone' : 'heartglass';
  }
  if (layer === 'mantle') {
    if (planetId === 'vorn' && rng() < 0.25) return 'voidstone';
    return pick(rng, ['cuprite_ore', 'cuprite_ore', 'research_sample']);
  }
  if (layer === 'crust') {
    if (caveWall) return pick(rng, ['lumen_crystal', 'ferrite_ore', 'cuprite_ore', 'research_sample', 'silicate']);
    return pick(rng, ['ferrite_ore', 'ferrite_ore', 'cuprite_ore', 'silicate']);
  }
  // Surface and shallow air-side crossings.
  const plant = planetId === 'vorn' ? 'hydrite' : 'biomass';
  return pick(rng, ['resin', 'resin', 'silicate', 'silicate', plant]);
}

/** March radially inward from above the surface to the first solid sample. */
function findSurfaceSpot(
  density: DensityFn,
  planet: PlanetConfig,
  min: Vec3d,
  size: number,
  rng: () => number,
): { local: Vec3d; normal: Vec3d } | null {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const px = min.x + rng() * size;
    const py = min.y + rng() * size;
    const pz = min.z + rng() * size;
    const dir = normalize({ x: px, y: py, z: pz });
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) continue;
    let prevR = planet.radius + 80;
    let prevD = density(dir.x * prevR, dir.y * prevR, dir.z * prevR);
    for (let r = prevR - 1.5; r > planet.radius - 60; r -= 1.5) {
      const d = density(dir.x * r, dir.y * r, dir.z * r);
      if (prevD < 0 && d >= 0) {
        // Bisect the crossing (surface at 0, midpoint of the bracket).
        let lo = r;
        let hi = prevR;
        for (let i = 0; i < 8; i += 1) {
          const mid = (lo + hi) / 2;
          const md = density(dir.x * mid, dir.y * mid, dir.z * mid);
          if (md >= 0) hi = mid;
          else lo = mid;
        }
        const cross = (lo + hi) / 2;
        const local = { x: dir.x * cross, y: dir.y * cross, z: dir.z * cross };
        if (!boxContains(min, size, local)) break;
        return { local, normal: normalAt(density, local) };
      }
      prevR = r;
      prevD = d;
    }
  }
  return null;
}

/** A random point near a cave wall (|density| small, gradient nonzero). */
function findCaveSpot(
  density: DensityFn,
  planet: PlanetConfig,
  min: Vec3d,
  size: number,
  rng: () => number,
): { local: Vec3d; normal: Vec3d } | null {
  const shellOuter = planet.core.chamberRadius + planet.core.shellThickness;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const local = {
      x: min.x + rng() * size,
      y: min.y + rng() * size,
      z: min.z + rng() * size,
    };
    const r = length(local);
    if (r < shellOuter || r > planet.radius - 4) continue;
    const d = density(local.x, local.y, local.z);
    if (Math.abs(d) > 1.5) continue;
    const normal = normalAt(density, local);
    if (normal.x === 0 && normal.y === 0 && normal.z === 0) continue;
    return { local, normal };
  }
  return null;
}

/**
 * Deterministic node specs for one LOD0 chunk. Same world seed + planet +
 * chunk = identical nodes (positions, resources, charges), so live worlds
 * only store mining outcomes, never placements.
 */
export function nodesForChunk(
  worldSeed: number,
  planet: PlanetConfig,
  coord: ChunkCoord,
  density: DensityFn,
): NodeSpec[] {
  const key = nodeChunkKey(planet.id, coord);
  const rng = createRng(`${worldSeed}:${planet.seed}:${key}`);
  const roll = rng();
  const count = roll < 0.25 ? 0 : roll < 0.65 ? 1 : roll < 0.9 ? 2 : 3;
  const min = nodeOrigin(planet, 0, coord);
  const size = chunkSizeForLevel(0);
  const out: NodeSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    // Alternate surface/cave attempts so walks find surface nodes and
    // cavers find wall crystals; a failed attempt just yields fewer nodes.
    const surfaceTurn = i % 2 === 0;
    const spot = surfaceTurn
      ? (findSurfaceSpot(density, planet, min, size, rng) ?? findCaveSpot(density, planet, min, size, rng))
      : (findCaveSpot(density, planet, min, size, rng) ?? findSurfaceSpot(density, planet, min, size, rng));
    if (!spot) continue;
    const layer = layerAt(planet, spot.local.x, spot.local.y, spot.local.z);
    const caveWall = !surfaceTurn || Math.abs(density(spot.local.x, spot.local.y, spot.local.z)) <= 1.5;
    const charges = NODE_MIN_CHARGES + Math.floor(rng() * (NODE_MAX_CHARGES - NODE_MIN_CHARGES + 1));
    const rotation = quatFromTo({ x: 0, y: 1, z: 0 }, spot.normal);
    out.push({
      id: nodeIdFor(planet.id, coord, i),
      chunkKey: key,
      resourceId: pickResource(rng, planet.id, layer.name, caveWall),
      position: {
        x: planet.center.x + spot.local.x,
        y: planet.center.y + spot.local.y,
        z: planet.center.z + spot.local.z,
      },
      // +0: keep -0 out of saved rotations (JSON turns -0 into 0).
      rotation: { x: rotation.x + 0, y: rotation.y + 0, z: rotation.z + 0, w: rotation.w + 0 },
      charges,
      maxCharges: charges,
    });
  }
  return out;
}
