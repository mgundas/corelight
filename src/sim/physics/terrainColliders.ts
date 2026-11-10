// Terrain collider ring: trimesh colliders for LOD0 chunks within
// COLLIDER_RANGE_M of the player (ARCHITECTURE.md). Collider data comes
// from collider workers via the injected ColliderSource — never from render
// meshes — and lands in the planet-local Rapier world (frames.ts).

import RAPIER from '@dimforge/rapier3d-compat';
import { COLLIDER_RANGE_M } from '../../core/constants.js';
import { normalize, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { chunkSizeForLevel, parseChunkKey, type ChunkCoord } from '../../terrain/chunkKey.js';
import { colliderKey } from '../../terrain/colliders.js';
import type { ColliderResult } from '../../terrain/colliderPool.js';
import { nodeOrigin, rootMin } from '../../terrain/octree.js';
import { toLocalFrame } from './frames.js';
import { gravityAt } from './gravity.js';

/** Worker-backed (or test-stubbed) source of LOD0 collision meshes. */
export interface ColliderSource {
  request(
    planet: PlanetConfig,
    worldSeed: number,
    coord: ChunkCoord,
    editVersion?: number,
  ): Promise<ColliderResult>;
}

export type GroundState = 'ready' | 'pending';

function pointBoxDistance(p: Vec3d, min: Vec3d, size: number): number {
  let d2 = 0;
  for (const axis of ['x', 'y', 'z'] as const) {
    const v = p[axis];
    if (v < min[axis]) d2 += (min[axis] - v) ** 2;
    else if (v > min[axis] + size) d2 += (v - (min[axis] + size)) ** 2;
  }
  return Math.sqrt(d2);
}

function containingCoord(local: Vec3d, config: PlanetConfig): ChunkCoord {
  const size = chunkSizeForLevel(0);
  const min = rootMin(config);
  const perAxis = 2 ** config.lodMaxLevel;
  const clamp = (v: number): number => Math.min(perAxis - 1, Math.max(0, Math.floor((v - min.x) / size)));
  // The root cube is centered, so min.x == min.y == min.z.
  return { x: clamp(local.x), y: clamp(local.y), z: clamp(local.z) };
}

export class TerrainColliders {
  private readonly source: ColliderSource;
  private readonly worldFor: (planetId: string) => RAPIER.World;
  private readonly colliders = new Map<string, { collider: RAPIER.Collider; planetId: string; coord: ChunkCoord }>();
  private readonly inflight = new Set<string>();
  private readonly empty = new Set<string>();
  /** Edit counter per key (notifyEdited): stale results are dropped. */
  private readonly editVersions = new Map<string, number>();
  /** Edited keys with a fresh rebuild outstanding. */
  private readonly dirty = new Set<string>();

  constructor(
    source: ColliderSource,
    worldFor: (planetId: string) => RAPIER.World,
  ) {
    this.source = source;
    this.worldFor = worldFor;
  }

  get loadedCount(): number {
    return this.colliders.size;
  }

  /**
   * Rebuild colliders for edited LOD0 chunk keys. LOD1+ keys (parents for
   * the render streamer) are ignored: colliders are LOD0 only. Existing
   * colliders stay in place as ghost support (the player never falls on
   * stale ground) and are atomically swapped when fresh data arrives with
   * a matching edit version; keys with no collider yet read as pending so
   * the controller freezes instead of falling through.
   */
  notifyEdited(keys: string[]): void {
    for (const key of keys) {
      try {
        if (parseChunkKey(key).level !== 0) continue;
      } catch {
        continue;
      }
      this.editVersions.set(key, (this.editVersions.get(key) ?? 0) + 1);
      this.dirty.add(key);
      this.empty.delete(key);
    }
  }

  get pendingCount(): number {
    return this.inflight.size;
  }

  /**
   * Request missing chunks around the player, drop ones left far behind.
   * Call every tick with the player position (fire-and-forget worker jobs).
   */
  update(playerWorld: Vec3d, planets: PlanetConfig[], worldSeed: number): void {
    const sample = gravityAt(planets, playerWorld);
    if (!sample.planet) return;
    const planet = sample.planet;
    const local = toLocalFrame(planet, playerWorld);
    const size = chunkSizeForLevel(0);
    const min = rootMin(planet);
    const perAxis = 2 ** planet.lodMaxLevel;

    const needed = new Set<string>();
    const coords: ChunkCoord[] = [];
    // Clamp into the root: beyond the streamed cube the ring collapses to
    // the edge slab, so a player dropped from high above still loads the
    // top chunks (ready/empty) instead of freezing on an empty request set.
    const clampAxis = (v: number): number => Math.min(perAxis - 1, Math.max(0, v));
    const lo = {
      x: clampAxis(Math.floor((local.x - COLLIDER_RANGE_M - min.x) / size)),
      y: clampAxis(Math.floor((local.y - COLLIDER_RANGE_M - min.y) / size)),
      z: clampAxis(Math.floor((local.z - COLLIDER_RANGE_M - min.z) / size)),
    };
    const hi = {
      x: clampAxis(Math.floor((local.x + COLLIDER_RANGE_M - min.x) / size)),
      y: clampAxis(Math.floor((local.y + COLLIDER_RANGE_M - min.y) / size)),
      z: clampAxis(Math.floor((local.z + COLLIDER_RANGE_M - min.z) / size)),
    };
    for (let x = lo.x; x <= hi.x; x += 1) {
      for (let y = lo.y; y <= hi.y; y += 1) {
        for (let z = lo.z; z <= hi.z; z += 1) {
          const coord = { x, y, z };
          const origin = nodeOrigin(planet, 0, coord);
          const worldMin: Vec3d = {
            x: planet.center.x + origin.x,
            y: planet.center.y + origin.y,
            z: planet.center.z + origin.z,
          };
          if (pointBoxDistance(playerWorld, worldMin, size) > COLLIDER_RANGE_M) continue;
          needed.add(colliderKey(planet.id, coord));
          coords.push(coord);
        }
      }
    }
    // Always include the containing chunk: groundState depends on it, and a
    // player dropped from high above must learn "all air, keep falling"
    // (empty -> ready) instead of freezing on an unrequested chunk.
    {
      const here = containingCoord(local, planet);
      const key = colliderKey(planet.id, here);
      if (!needed.has(key)) {
        needed.add(key);
        coords.push(here);
      }
    }

    for (const coord of coords) {
      const key = colliderKey(planet.id, coord);
      // Edited keys rebuild even with a collider in place (ghost support
      // swaps atomically on completion); otherwise loaded keys are done.
      if (this.inflight.has(key) || this.empty.has(key)) continue;
      if (this.colliders.has(key) && !this.dirty.has(key)) continue;
      this.inflight.add(key);
      const requestCoord = { ...coord };
      const wantVersion = this.editVersions.get(key) ?? 0;
      this.source
        .request(planet, worldSeed, requestCoord, wantVersion)
        .then((result) => {
          this.inflight.delete(key);
          if (wantVersion !== (this.editVersions.get(key) ?? 0)) {
            // A newer edit landed while this job ran: drop the stale
            // mesh, stay dirty, the next update re-requests fresh data.
            return;
          }
          this.dirty.delete(key);
          if (result.empty || result.positions.length === 0 || result.indices.length === 0) {
            this.removeCollider(key);
            this.empty.add(key);
            return;
          }
          // Player may have moved on while the worker ran: skip colliders
          // that are already out of range (the next update re-requests).
          const origin = nodeOrigin(planet, 0, requestCoord);
          const worldMin: Vec3d = {
            x: planet.center.x + origin.x,
            y: planet.center.y + origin.y,
            z: planet.center.z + origin.z,
          };
          if (pointBoxDistance(this.lastPlayer, worldMin, size) > COLLIDER_RANGE_M + size) return;
          // Atomic swap: the old collider (ghost support) leaves the same
          // tick the fresh data lands, so the controller never sees a gap.
          this.removeCollider(key);
          const world = this.worldFor(planet.id);
          const collider = world.createCollider(
            RAPIER.ColliderDesc.trimesh(result.positions, result.indices).setTranslation(
              result.origin.x,
              result.origin.y,
              result.origin.z,
            ),
          );
          this.colliders.set(key, { collider, planetId: planet.id, coord: { ...requestCoord } });
        })
        .catch(() => {
          // Worker failed: forget so the next update retries.
          this.inflight.delete(key);
        });
    }

    // Drop colliders left behind (with a one-chunk hysteresis band).
    this.lastPlayer = { ...playerWorld };
    this.collectGarbage(needed, planets);
    // Bound the empty cache: forget far empty keys (re-verify costs one job).
    if (this.empty.size > 512) {
      for (const key of [...this.empty]) {
        if (!needed.has(key)) this.empty.delete(key);
      }
    }
  }

  private lastPlayer: Vec3d = { x: 0, y: 0, z: 0 };

  private removeCollider(key: string): void {
    const entry = this.colliders.get(key);
    if (!entry) return;
    try {
      this.worldFor(entry.planetId).removeCollider(entry.collider, false);
    } catch {
      // World already disposed; nothing to do.
    }
    this.colliders.delete(key);
  }

  private collectGarbage(needed: Set<string>, planets: PlanetConfig[]): void {
    const size = chunkSizeForLevel(0);
    for (const [key, entry] of [...this.colliders]) {
      if (needed.has(key)) continue;
      const planet = planets.find((p) => p.id === entry.planetId);
      let far = true;
      if (planet) {
        const origin = nodeOrigin(planet, 0, entry.coord);
        const worldMin: Vec3d = {
          x: planet.center.x + origin.x,
          y: planet.center.y + origin.y,
          z: planet.center.z + origin.z,
        };
        far = pointBoxDistance(this.lastPlayer, worldMin, size) > COLLIDER_RANGE_M + size;
      }
      if (far) {
        try {
          this.worldFor(entry.planetId).removeCollider(entry.collider, false);
        } catch {
          // World already disposed; nothing to do.
        }
        this.colliders.delete(key);
      }
    }
  }

  /**
   * World-space distance to terrain along a ray, using the same Rapier LOD0
   * colliders as the character controller. Direct per-collider queries stay in
   * the small nearby collider set instead of traversing every loaded render
   * mesh, and they do not need a broadphase refresh. Only terrain colliders
   * are tested, so the player's own capsule can never pull the camera in.
   * Returns null when clear or outside every SOI.
   */
  castTerrainRay(originWorld: Vec3d, dirWorld: Vec3d, planets: PlanetConfig[], maxDist: number): number | null {
    const sample = gravityAt(planets, originWorld);
    if (!sample.planet) return null;
    const dir = normalize(dirWorld);
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) return null;
    const ray = new RAPIER.Ray(toLocalFrame(sample.planet, originWorld), dir);
    let best: number | null = null;
    for (const entry of this.colliders.values()) {
      if (entry.planetId !== sample.planet.id) continue;
      const toi = entry.collider.castRay(ray, maxDist, true);
      if (toi >= 0 && (best === null || toi < best)) best = toi;
    }
    return best;
  }

  /**
   * Whether the player's chunk is simulated. 'pending' means freeze the
   * player (no gravity, no movement) rather than let them fall through
   * unloaded terrain. Chunks known empty (all air) are 'ready': truly
   * nothing to stand on, so gravity applies. Deep space is also 'ready':
   * there is no terrain chunk to wait for, and directed space motion is a
   * later milestone.
   */
  groundState(playerWorld: Vec3d, planets: PlanetConfig[]): GroundState {
    const sample = gravityAt(planets, playerWorld);
    if (!sample.planet) return 'ready';
    const key = colliderKey(sample.planet.id, containingCoord(toLocalFrame(sample.planet, playerWorld), sample.planet));
    if (this.colliders.has(key) || this.empty.has(key)) return 'ready';
    return 'pending';
  }

  dispose(): void {
    for (const [, entry] of this.colliders) {
      try {
        this.worldFor(entry.planetId).removeCollider(entry.collider, false);
      } catch {
        // World already disposed; nothing to do.
      }
    }
    this.colliders.clear();
    this.inflight.clear();
    this.empty.clear();
    this.dirty.clear();
    this.editVersions.clear();
  }
}
