// Per-planet streaming octree (ARCHITECTURE.md: Chunks and LOD).
// The root is a single cube of side 32 * 2^lodMaxLevel centered on the
// planet. Nodes below the root use integer coords relative to the root's
// minimum corner (root = 0,0,0), so the centered root stays addressable
// with the planetId:level:x:y:z key scheme. Pure logic, no three.js: this
// runs on the main thread and (via nodeOrigin) in mesh workers.

import { LOD_SPLIT_FACTOR } from '../core/constants.js';
import { distance, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkKey, chunkSizeForLevel, type ChunkCoord } from './chunkKey.js';
import type { DensityFn } from './density.js';

export interface OctreeNode {
  level: number;
  coord: ChunkCoord;
  /** Planet-local minimum corner. */
  min: Vec3d;
  /** Edge length in meters: 32 * 2^level. */
  size: number;
  center: Vec3d;
}

/** Side of the root cube: 32 * 2^lodMaxLevel (Sela: 1024 m). */
export function rootSize(config: PlanetConfig): number {
  return 32 * 2 ** config.lodMaxLevel;
}

/** Planet-local minimum corner of the root (centered on the planet). */
export function rootMin(config: PlanetConfig): Vec3d {
  const half = rootSize(config) / 2;
  return { x: -half, y: -half, z: -half };
}

/** Planet-local minimum corner of any node from its root-relative coord. */
export function nodeOrigin(config: PlanetConfig, level: number, coord: ChunkCoord): Vec3d {
  const min = rootMin(config);
  const size = chunkSizeForLevel(level);
  return {
    x: min.x + coord.x * size,
    y: min.y + coord.y * size,
    z: min.z + coord.z * size,
  };
}

export function nodeKey(planetId: string, level: number, coord: ChunkCoord): string {
  return chunkKey(planetId, level, coord);
}

function makeNode(config: PlanetConfig, level: number, coord: ChunkCoord): OctreeNode {
  const min = nodeOrigin(config, level, coord);
  const size = chunkSizeForLevel(level);
  return {
    level,
    coord: { ...coord },
    min,
    size,
    center: { x: min.x + size / 2, y: min.y + size / 2, z: min.z + size / 2 },
  };
}

export function createRoot(config: PlanetConfig): OctreeNode {
  return makeNode(config, config.lodMaxLevel, { x: 0, y: 0, z: 0 });
}

/** The 8 children of a node (level - 1, each half the size). */
export function childrenOf(config: PlanetConfig, node: OctreeNode): OctreeNode[] {
  if (node.level <= 0) return [];
  const out: OctreeNode[] = [];
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        out.push(
          makeNode(config, node.level - 1, {
            x: node.coord.x * 2 + dx,
            y: node.coord.y * 2 + dy,
            z: node.coord.z * 2 + dz,
          }),
        );
      }
    }
  }
  return out;
}

/**
 * Leaf set for a planet-local camera position. A node splits when
 * distance(camera, nodeCenter) < size * LOD_SPLIT_FACTOR and level > 0
 * (exactly the ARCHITECTURE.md rule). Nodes containing the camera always
 * split: their center is within half the diagonal (0.87 * size) of any
 * interior point, so level-0 detail surrounds the camera everywhere,
 * including caves and the core.
 */
export function updateOctree(config: PlanetConfig, cameraLocal: Vec3d): OctreeNode[] {
  const leaves: OctreeNode[] = [];
  const stack: OctreeNode[] = [createRoot(config)];
  while (stack.length > 0) {
    const node = stack.pop() as OctreeNode;
    if (node.level > 0 && distance(cameraLocal, node.center) < node.size * LOD_SPLIT_FACTOR) {
      for (const child of childrenOf(config, node)) stack.push(child);
    } else {
      leaves.push(node);
    }
  }
  return leaves;
}

/** Every node at `level` (exhaustive: used by the boot pre-generation). */
export function nodesAtLevel(config: PlanetConfig, level: number): OctreeNode[] {
  const perAxis = 2 ** (config.lodMaxLevel - level);
  const out: OctreeNode[] = [];
  for (let x = 0; x < perAxis; x += 1) {
    for (let y = 0; y < perAxis; y += 1) {
      for (let z = 0; z < perAxis; z += 1) {
        out.push(makeNode(config, level, { x, y, z }));
      }
    }
  }
  return out;
}

export type Homogeneous = 'solid' | 'air';

/**
 * Cheap empty test before queueing a mesh job (ARCHITECTURE.md): sample the
 * 8 corners plus the center; if every |density| exceeds the node diagonal,
 * the surface cannot cross the node, so it is certainly all solid or all
 * air and needs no mesh.
 *
 * SOUNDNESS CAVEAT (verified by test probe, seed 1337): the 'solid' branch
 * is NOT airtight. Carved tunnel walls are density cliffs (just inside a
 * worm d -> 0-, just outside d ~= depth + relief, hundreds of meters), so a
 * thin worm can thread a node while all 9 samples read strongly solid.
 * Only the 'air' branch is trusted for skipping (see isDefinitelyAir):
 * large-magnitude negative density only occurs high above the surface in
 * the continuous depth+relief field, far from any carve guard or cliff.
 * The worker's full-grid sampling remains the exact arbiter for the rest.
 */
export function classifyNode(density: DensityFn, node: OctreeNode): Homogeneous | null {
  const margin = node.size * Math.sqrt(3);
  let solid = true;
  let air = true;
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        const d = density(
          node.min.x + dx * node.size,
          node.min.y + dy * node.size,
          node.min.z + dz * node.size,
        );
        if (d <= margin) solid = false;
        if (d >= -margin) air = false;
        if (!solid && !air) return null;
      }
    }
  }
  const center = density(node.center.x, node.center.y, node.center.z);
  if (center <= margin) solid = false;
  if (center >= -margin) air = false;
  if (solid) return 'solid';
  if (air) return 'air';
  return null;
}

/**
 * The only pre-queue skip the streaming manager and boot pre-generation
 * trust. 'air' verdicts are sound (see classifyNode caveat): every interior
 * point of such a node lies in the continuous above-ground field with
 * |density| still far from zero, so no surface can cross it. 'solid'
 * verdicts are always queued and decided exactly by the worker instead.
 */
export function isDefinitelyAir(density: DensityFn, node: OctreeNode): boolean {
  return classifyNode(density, node) === 'air';
}

/** True when two AABBs (min + uniform size) overlap with nonzero volume. */
export function boxesOverlap(aMin: Vec3d, aSize: number, bMin: Vec3d, bSize: number): boolean {
  return (
    aMin.x < bMin.x + bSize &&
    bMin.x < aMin.x + aSize &&
    aMin.y < bMin.y + bSize &&
    bMin.y < aMin.y + aSize &&
    aMin.z < bMin.z + bSize &&
    bMin.z < aMin.z + aSize
  );
}
