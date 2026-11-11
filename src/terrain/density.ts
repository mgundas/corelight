// Planet density field, exactly per docs/ARCHITECTURE.md:
//   d = depth + surfaceNoise * amplitude, minus cave carving,
//   min() with the hollow core chamber.
// Positive = solid, negative = air, surface at 0. Pure + deterministic.

import type { LayerConfig, PlanetConfig, Rgb } from '../planets/PlanetConfig.js';
import { smoothstep, type Vec3d } from '../core/math.js';
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

export interface CavernStack {
  /** Depth where the first room top starts. */
  start: number;
  /** Room + slab cycle in meters. */
  pitch: number;
  /** Number of cavern floors (scales with planet size). */
  count: number;
  cavernHeight: number;
  slabThickness: number;
}

/**
 * Derive the cavern floor stack from planet size: the count is the usable
 * shell thickness divided by the room+slab pitch, clamped to the config
 * band. Leftover rock stays above the core shell, so rooms can never touch
 * it (the count is reduced first if clamping would overflow).
 */
export function cavernStack(config: PlanetConfig): CavernStack {
  const { caverns } = config;
  const shellOuterDepth = config.radius - config.core.chamberRadius - config.core.shellThickness;
  const usable = shellOuterDepth - caverns.surfaceCapDepth;
  const pitch = caverns.cavernHeight + caverns.slabThickness;
  let count = Math.min(
    caverns.maxFloors,
    Math.max(caverns.minFloors, Math.floor(usable / pitch)),
  );
  while (count > 1 && caverns.surfaceCapDepth + count * pitch > shellOuterDepth) {
    count -= 1;
  }
  return {
    start: caverns.surfaceCapDepth,
    pitch,
    count,
    cavernHeight: caverns.cavernHeight,
    slabThickness: caverns.slabThickness,
  };
}

/**
 * Deterministic anchor pocket centers, one per floor (golden-angle spiral
 * around the pole axis). Blotch coverage alone can leave a floor barren
 * near the explored area; anchors guarantee every floor has a room.
 * Planet-local coordinates at each room's mid-depth.
 */
export function cavernAnchorPoints(config: PlanetConfig): Vec3d[] {
  const { caverns } = config;
  const stack = cavernStack(config);
  const out: Vec3d[] = [];
  for (let i = 0; i < stack.count; i += 1) {
    const az = 0.7 + i * 2.39996;
    const ax = caverns.roomAnchorRadius * Math.cos(az);
    const azc = caverns.roomAnchorRadius * Math.sin(az);
    const midR = config.radius - (stack.start + i * stack.pitch + stack.cavernHeight / 2);
    const ay = Math.sqrt(Math.max(100, midR * midR - ax * ax - azc * azc));
    out.push({ x: ax, y: ay, z: azc });
  }
  return out;
}

export function createDensityField(
  config: PlanetConfig,
  worldSeed: number,
  editDelta?: (x: number, y: number, z: number) => number,
): DensityField {
  const base = `${worldSeed}:${config.seed}`;
  const surfaceNoise = createSeededNoise3D(`${base}:surface`);
  const caveA = createSeededNoise3D(`${base}:caveA`);
  const caveB = createSeededNoise3D(`${base}:caveB`);
  const cavernRough = createSeededNoise3D(`${base}:cavernRough`);
  const cavernPit = createSeededNoise3D(`${base}:cavernPit`);
  const cavernMask = createSeededNoise3D(`${base}:cavernMask`);
  const caveThresholdAt = (depth: number): number => caveThresholdAtDepth(config, depth);
  const stack = cavernStack(config);
  const caverns = config.caverns;
  const anchors = cavernAnchorPoints(config);

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
    // Cavern floors supplement the worm tunnels: pockets of open room on a
    // regular depth cycle, separated by thick slabs the worms thread through.
    // u runs 0..pitch from a room top: the room is air, the slab is rock.
    // Rooms are local pockets, not global shells: a blotch mask (smooth, so
    // pocket edges keep mid-cell crossings) decides where a floor is open.
    const shellOuter = config.core.chamberRadius + config.core.shellThickness;
    let slabness = 0;
    let roomU = -1;
    let roomIdx = -1;
    if (caverns.enabled && depth >= stack.start && r >= shellOuter) {
      const dd = depth - stack.start;
      const idx = Math.floor(dd / stack.pitch);
      if (idx < stack.count) {
        const u = dd - idx * stack.pitch;
        roomU = u;
        roomIdx = idx;
        // 0 inside rooms, 1 inside slabs: worms widen where they cross slabs
        // so floors get irregular diggable openings, not pinholes.
        slabness = smoothstep(caverns.cavernHeight - 3, caverns.cavernHeight + 3, u);
      }
    }
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
    if (depth >= config.caves.startDepth && r >= shellOuter) {
      const cf = config.caves.frequency;
      const c = Math.abs(caveA(x * cf, y * cf, z * cf)) + Math.abs(caveB(x * cf, y * cf, z * cf));
      const threshold = caveThresholdAt(depth) * (1 + caverns.openingBoost * slabness);
      d = Math.min(d, (c - threshold) * 10);
    }
    // Cavern rooms: hollow out room pockets with walkable floors. The floor
    // surface is the slab top displaced by gentle relief plus capped pit
    // bowls; pocket edges pinch the ceiling down to the floor so rooms stay
    // bounded (all smooth, so crossings stay mid-cell). min() keeps the zero
    // set exactly on those displaced surfaces.
    if (roomU >= 0 && roomIdx >= 0) {
      const rf = caverns.roomFrequency;
      // Window calibrated so roomCoverage ≈ fraction of floor area opened
      // (simplex noise concentrates near 0; lo=1-3.5*coverage puts ~15-25%
      // of each floor above the midpoint for coverage 0.15-0.25).
      const lo = 1 - 3.5 * caverns.roomCoverage;
      let mask = smoothstep(
        lo,
        lo + 0.25,
        cavernMask(
          x * rf + roomIdx * 13.7,
          y * rf + roomIdx * 7.3,
          z * rf + roomIdx * 3.1,
        ),
      );
      // Guaranteed pocket per floor from the shared anchor layout (blotches
      // alone can leave a floor barren near the explored area).
      const anchor = anchors[roomIdx] as Vec3d;
      const anchorDist = Math.hypot(x - anchor.x, y - anchor.y, z - anchor.z);
      const anchorMask = 1 - smoothstep(caverns.roomAnchorSize * 0.45, caverns.roomAnchorSize, anchorDist);
      if (anchorMask > mask) mask = anchorMask;
      if (mask > 0) {
        const fr = caverns.floorRoughFrequency;
        const rough = caverns.floorRoughness * fbm3(cavernRough, x * fr, y * fr, z * fr, 3);
        const pr = caverns.pitFrequency;
        const pitm = smoothstep(
          1 - 2 * caverns.pitCoverage,
          1 - 2 * caverns.pitCoverage + 0.2,
          cavernPit(x * pr, y * pr, z * pr),
        );
        // Pits dip the floor but can never eat through the slab.
        const maxDip = caverns.slabThickness - caverns.minSlabLeftover;
        const dip = Math.min(rough + caverns.pitDepth * pitm * pitm, maxDip);
        const floorSurf = caverns.cavernHeight + dip;
        const ceilSurf = cavernRough(x * fr + 7.3, y * fr + 7.3, z * fr + 7.3);
        // Closed where the mask is shut: ceiling meets floor, no zero set.
        const closedCeil = floorSurf + 0.5 + (ceilSurf - floorSurf - 0.5) * mask;
        const room = Math.max(roomU - floorSurf, closedCeil - roomU);
        if (room < d) d = room;
      }
    }
    // Hollow core chamber (no caves inside the shell by the guard above).
    const chamber = r - config.core.chamberRadius;
    if (chamber < d) d = chamber;
    // Player edits (sparse diffs; zero where untouched).
    if (editDelta) d += editDelta(x, y, z);
    return d;
  };

  return { config, density, caveThresholdAt };
}

/** Backwards-compatible helper: density function only. */
export function createDensityFn(config: PlanetConfig, worldSeed: number): DensityFn {
  return createDensityField(config, worldSeed).density;
}

const surfaceNoises = new Map<string, NoiseFunction3D>();

function surfaceNoiseFor(config: PlanetConfig, worldSeed: number): NoiseFunction3D {
  const key = `${worldSeed}:${config.seed}`;
  let noise = surfaceNoises.get(key);
  if (!noise) {
    noise = createSeededNoise3D(`${key}:surface`);
    surfaceNoises.set(key, noise);
  }
  return noise;
}

/**
 * Depth below the unedited surface at a planet-local point:
 * `planet.radius + surfaceNoise(dir) - r`. Positive = underground.
 * WHY: lighting and fog need a cheap per-frame depth without raycasts
 * (M05 spec); this repeats exactly the base term of the density field,
 * so it agrees with the meshed surface to within carve/edit differences.
 */
export function surfaceDepthAt(
  config: PlanetConfig,
  worldSeed: number,
  x: number,
  y: number,
  z: number,
): number {
  const r = Math.sqrt(x * x + y * y + z * z);
  let nx = 0;
  let ny = 1;
  let nz = 0;
  if (r > 1e-6) {
    nx = x / r;
    ny = y / r;
    nz = z / r;
  }
  const f = config.surfaceFrequency;
  const relief = fbm3(surfaceNoiseFor(config, worldSeed), nx * f, ny * f, nz * f, 4) * config.surfaceAmplitude;
  return config.radius + relief - r;
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
