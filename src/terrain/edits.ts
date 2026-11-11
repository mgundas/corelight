// Sparse player edits to the density field (ARCHITECTURE.md: Edits).
// WHY sparse: terrain is generated, so only diffs are stored — one entry
// per touched LOD0 sample, keyed by chunk. Same seed + same edits =
// identical terrain, in workers and on the main thread.
//
// LOD0 lattice: cell size is 1 m, so planet-local position p maps to global
// lattice coords g = round(p - rootMin). Each LOD0 chunk owns the 33^3
// samples with g in [coord*32, coord*32+32] (edges shared with the next
// chunk's window, borders resolved from neighbors at mesh time).

import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Vec3d } from '../core/math.js';
import { chunkKey, parseChunkKey } from './chunkKey.js';
import { rootMin } from './octree.js';
import type { DensityFn } from './density.js';
import { sampleIndex } from './density.js';
import { deltasForJob as resolveJobDeltas } from './editDeltas.js';

export type EditMode = 'dig' | 'add' | 'flatten';

/** Flatten plane in planet-local coords, captured at stroke start. */
export interface FlattenPlane {
  point: Vec3d;
  normal: Vec3d;
}

export interface ApplySphereOptions {
  /** Samples with hardnessAt(p) > maxHardness are skipped (drill tiers). */
  maxHardness?: number;
  hardnessAt?: (x: number, y: number, z: number) => number;
  /** Required for flatten mode: the plane captured at stroke start. */
  flattenPlane?: FlattenPlane;
  /**
   * Cap on air->solid flips for this stroke bit (the applier's soil).
   * Samples that would flip past the budget are left alone, so add can
   * never spend soil it does not have. Undefined = unlimited.
   */
  soilBudget?: number;
}

export interface EditOutcome {
  /** LOD0 chunk keys whose meshes/colliders must be rebuilt: chunks with
   * touched samples plus neighbors sharing border samples. */
  keys: string[];
  /** Base-density samples flipped solid -> air (soil earned). */
  gained: number;
  /** Base-density samples flipped air -> solid (soil spent). */
  spent: number;
  /** True when at least one in-range sample was skipped by hardness. */
  blocked: boolean;
}

/** Sparse edit deltas resolved into a mesh job's 35^3 sample grid. */
export interface EditAttachment {
  indices: Uint32Array;
  values: Float32Array;
}

export interface SerializedEdits {
  version: 1;
  chunks: Record<string, Array<[number, number]>>;
}

/** Samples owned per LOD0 chunk axis (32 cells + shared far edge). */
const OWNED_PER_CHUNK = 33;
/** Delta clamp (ARCHITECTURE.md: Float32 deltas clamped to [-4, 4]). */
const DELTA_CLAMP = 4;
/** Entries below this magnitude are dropped to keep the store sparse. */
const DELTA_EPSILON = 1e-6;

function clampDelta(v: number): number {
  return Math.min(DELTA_CLAMP, Math.max(-DELTA_CLAMP, v));
}

export class TerrainEdits {
  /** planetId:level:x:y:z -> (33^3 sample index -> delta). LOD0 only. */
  private readonly chunks = new Map<string, Map<number, number>>();

  /** Samples stored (test/debug introspection). */
  get sampleCount(): number {
    let n = 0;
    for (const inner of this.chunks.values()) n += inner.size;
    return n;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Apply a spherical brush in planet-local coords. `density` is the BASE
   * field (no edits): crossings against it drive soil accounting. Returns
   * the affected LOD0 chunk keys (touched chunks + border neighbors).
   *
   * NOTE on the prompt's signature: planetId alone cannot locate chunks
   * (chunk math needs the planet's rootMin/lodMaxLevel) and soil/hardness
   * need the base density, so this takes the planet config + base field.
   */
  applySphere(
    planet: PlanetConfig,
    density: DensityFn,
    center: Vec3d,
    radius: number,
    strength: number,
    mode: EditMode,
    opts: ApplySphereOptions = {},
  ): EditOutcome {
    const outcome: EditOutcome = { keys: [], gained: 0, spent: 0, blocked: false };
    if (radius <= 0 || strength === 0) return outcome;
    if (mode === 'flatten' && !opts.flattenPlane) return outcome;
    const min = rootMin(planet);
    const perAxis = 2 ** planet.lodMaxLevel;
    const latticeMax = perAxis * 32;
    const clampLattice = (g: number): number => Math.min(latticeMax, Math.max(0, g));
    const g0 = {
      x: clampLattice(Math.floor(center.x - min.x - radius - 1)),
      y: clampLattice(Math.floor(center.y - min.y - radius - 1)),
      z: clampLattice(Math.floor(center.z - min.z - radius - 1)),
    };
    const g1 = {
      x: clampLattice(Math.ceil(center.x - min.x + radius + 1)),
      y: clampLattice(Math.ceil(center.y - min.y + radius + 1)),
      z: clampLattice(Math.ceil(center.z - min.z + radius + 1)),
    };
    const touched = new Map<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>();
    for (let gz = g0.z; gz <= g1.z; gz += 1) {
      for (let gy = g0.y; gy <= g1.y; gy += 1) {
        for (let gx = g0.x; gx <= g1.x; gx += 1) {
          const px = min.x + gx;
          const py = min.y + gy;
          const pz = min.z + gz;
          const dx = px - center.x;
          const dy = py - center.y;
          const dz = pz - center.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > radius) continue;
          if (
            opts.hardnessAt &&
            opts.maxHardness !== undefined &&
            opts.hardnessAt(px, py, pz) > opts.maxHardness
          ) {
            outcome.blocked = true;
            continue;
          }
          const falloff = (1 - dist / radius) ** 2;
          const key = this.ownerKey(planet.id, perAxis, gx, gy, gz);
          const local = this.localIndex(perAxis, gx, gy, gz);
          const old = this.chunks.get(key)?.get(local) ?? 0;
          const base = density(px, py, pz);
          let next: number;
          if (mode === 'dig') {
            next = old - strength * falloff;
          } else if (mode === 'add') {
            next = old + strength * falloff;
          } else {
            // Flatten: pull the final density toward the stroke plane. The
            // plane's signed distance s is air-positive (normal points out
            // of the ground), density is solid-positive, so the target
            // final density is -s and the target delta is -s - base.
            const plane = opts.flattenPlane as FlattenPlane;
            const rx = px - plane.point.x;
            const ry = py - plane.point.y;
            const rz = pz - plane.point.z;
            const s = rx * plane.normal.x + ry * plane.normal.y + rz * plane.normal.z;
            const target = -s - base;
            next = old + (target - old) * Math.min(1, strength * falloff);
          }
          next = clampDelta(next);
          const before = base + old;
          const after = base + next;
          const flipsToSolid = before <= 0 && after > 0;
          // Soil budget: never spend what the applier does not have. Over-
          // budget flips are skipped entirely (no write, no remesh flag).
          if (flipsToSolid && outcome.spent >= (opts.soilBudget ?? Infinity)) continue;
          if (before > 0 && after <= 0) outcome.gained += 1;
          else if (flipsToSolid) outcome.spent += 1;
          const inner = this.innerFor(key);
          if (Math.abs(next) < DELTA_EPSILON) {
            inner.delete(local);
            if (inner.size === 0) this.chunks.delete(key);
          } else {
            inner.set(local, next);
          }
          // Bounding box of touched lattice points per chunk: only chunks
          // whose mesh window actually contains a touched sample remesh.
          let box = touched.get(key);
          if (!box) {
            box = {
              min: { x: gx, y: gy, z: gz },
              max: { x: gx, y: gy, z: gz },
            };
            touched.set(key, box);
          } else {
            if (gx < box.min.x) box.min.x = gx;
            if (gy < box.min.y) box.min.y = gy;
            if (gz < box.min.z) box.min.z = gz;
            if (gx > box.max.x) box.max.x = gx;
            if (gy > box.max.y) box.max.y = gy;
            if (gz > box.max.z) box.max.z = gz;
          }
        }
      }
    }
    // Neighbors sharing border samples remesh too: a chunk's 35^3 window
    // reaches 1 m past its territory, so a neighbor qualifies exactly when
    // the touched box overlaps its window. A brush in the chunk middle
    // lists only the owner; one near the edge pulls the face neighbor(s).
    const expanded = new Set<string>();
    for (const [key, box] of touched) {
      const { coord } = parseChunkKey(key);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const cx = coord.x + dx;
            const cy = coord.y + dy;
            const cz = coord.z + dz;
            if (cx < 0 || cy < 0 || cz < 0 || cx >= perAxis || cy >= perAxis || cz >= perAxis) {
              continue;
            }
            // Window in lattice coords: territory +- the 1-sample border.
            const loX = cx * 32 - 1;
            const hiX = cx * 32 + 33;
            const loY = cy * 32 - 1;
            const hiY = cy * 32 + 33;
            const loZ = cz * 32 - 1;
            const hiZ = cz * 32 + 33;
            if (
              box.max.x < loX ||
              box.min.x > hiX ||
              box.max.y < loY ||
              box.min.y > hiY ||
              box.max.z < loZ ||
              box.min.z > hiZ
            ) {
              continue;
            }
            expanded.add(chunkKey(planet.id, 0, { x: cx, y: cy, z: cz }));
          }
        }
      }
    }
    outcome.keys = [...expanded];
    return outcome;
  }

  /**
   * Stored edit delta at a planet-local point (0 when unedited). Trilinear
   * interpolation of the eight neighbouring lattice samples: meshes sample
   * linearly between lattice points, so nearest-sample reads disagree with
   * the meshed surface by up to ~0.3 density after a dig (aim, tethers,
   * nodes and the burial safety all read this field).
   */
  deltaAt(planet: PlanetConfig, planetId: string, x: number, y: number, z: number): number {
    const min = rootMin(planet);
    const perAxis = 2 ** planet.lodMaxLevel;
    const latticeMax = perAxis * 32;
    const fx = x - min.x;
    const fy = y - min.y;
    const fz = z - min.z;
    if (fx < 0 || fy < 0 || fz < 0 || fx > latticeMax || fy > latticeMax || fz > latticeMax) {
      return 0;
    }
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;
    let acc = 0;
    for (let dz = 0; dz <= 1; dz += 1) {
      const gz = z0 + dz;
      if (gz < 0 || gz > latticeMax) continue;
      const wz = dz === 0 ? 1 - tz : tz;
      for (let dy = 0; dy <= 1; dy += 1) {
        const gy = y0 + dy;
        if (gy < 0 || gy > latticeMax) continue;
        const wy = dy === 0 ? 1 - ty : ty;
        for (let dx = 0; dx <= 1; dx += 1) {
          const gx = x0 + dx;
          if (gx < 0 || gx > latticeMax) continue;
          const wx = dx === 0 ? 1 - tx : tx;
          const w = wx * wy * wz;
          if (w === 0) continue;
          const inner = this.chunks.get(this.ownerKey(planetId, perAxis, gx, gy, gz));
          if (!inner) continue;
          const v = inner.get(this.localIndex(perAxis, gx, gy, gz));
          if (v !== undefined) acc += v * w;
        }
      }
    }
    return acc;
  }

  /** Stored deltas for one LOD0 chunk key (undefined when unedited). */
  getDelta(planetId: string, key: string): ReadonlyMap<number, number> | undefined {
    void planetId;
    return this.chunks.get(key);
  }

  /**
   * Resolve stored deltas into a mesh job's 35^3 sample grid
   * (delegates to terrain/editDeltas.ts; see that file for the
   * LOD0-copy/LOD1-average rule). Null when the window holds no edits.
   */
  deltasForJob(
    planet: PlanetConfig,
    level: number,
    coord: { x: number; y: number; z: number },
  ): EditAttachment | null {
    return resolveJobDeltas(this.chunks, planet, level, coord);
  }

  serialize(): SerializedEdits {
    const chunks: Record<string, Array<[number, number]>> = {};
    for (const [key, inner] of this.chunks) {
      if (inner.size > 0) chunks[key] = [...inner] as Array<[number, number]>;
    }
    return { version: 1, chunks };
  }

  /** Replace all stored deltas with a copy of another instance (save restore). */
  copyFrom(other: TerrainEdits): void {
    this.chunks.clear();
    for (const [key, inner] of other.chunks) {
      if (inner.size > 0) this.chunks.set(key, new Map(inner));
    }
  }

  static deserialize(data: unknown): TerrainEdits {
    const edits = new TerrainEdits();
    if (typeof data !== 'object' || data === null) throw new Error('bad edits: not an object');
    const root = data as Record<string, unknown>;
    if (root['version'] !== 1) throw new Error('bad edits: unsupported version');
    const chunks = root['chunks'];
    if (typeof chunks !== 'object' || chunks === null) throw new Error('bad edits: chunks missing');
    for (const [key, entries] of Object.entries(chunks)) {
      parseChunkKey(key);
      if (!Array.isArray(entries)) throw new Error(`bad edits: chunk ${key} not an array`);
      const inner = new Map<number, number>();
      for (const entry of entries) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          !Number.isInteger(entry[0]) ||
          typeof entry[1] !== 'number' ||
          !Number.isFinite(entry[1])
        ) {
          throw new Error(`bad edits: chunk ${key} has a malformed entry`);
        }
        const idx = entry[0] as number;
        if (idx < 0 || idx >= OWNED_PER_CHUNK ** 3) throw new Error(`bad edits: index out of range in ${key}`);
        inner.set(idx, clampDelta(entry[1] as number));
      }
      if (inner.size > 0) edits.chunks.set(key, inner);
    }
    return edits;
  }

  private innerFor(key: string): Map<number, number> {
    let inner = this.chunks.get(key);
    if (!inner) {
      inner = new Map();
      this.chunks.set(key, inner);
    }
    return inner;
  }

  /** Owning LOD0 chunk key for global lattice coords (clamped into range). */
  private ownerKey(planetId: string, perAxis: number, gx: number, gy: number, gz: number): string {
    const clamp = (v: number): number => Math.min(perAxis - 1, Math.max(0, Math.floor(v / 32)));
    return chunkKey(planetId, 0, { x: clamp(gx), y: clamp(gy), z: clamp(gz) });
  }

  /** 33^3 sample index within the owning chunk. */
  private localIndex(perAxis: number, gx: number, gy: number, gz: number): number {
    const clamp = (v: number): number => Math.min(perAxis - 1, Math.max(0, Math.floor(v / 32)));
    const lx = gx - clamp(gx) * 32;
    const ly = gy - clamp(gy) * 32;
    const lz = gz - clamp(gz) * 32;
    return sampleIndex(lx, ly, lz, OWNED_PER_CHUNK);
  }
}
