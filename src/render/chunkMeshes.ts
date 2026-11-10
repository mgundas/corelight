// Render-side chunk meshes: one THREE.Mesh per worker MeshResult, all
// sharing a smooth-shaded vertex-color material. Positions are stored in
// world-space doubles; every mesh is placed via the floating origin.

import * as THREE from 'three';
import { CHUNK_CACHE_BUDGET } from '../core/constants.js';
import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { chunkSizeForLevel, parseChunkKey } from '../terrain/chunkKey.js';
import { toLocal } from './floatingOrigin.js';
import type { MeshResult } from '../terrain/workerPool.js';

export interface ChunkBox {
  key: string;
  level: number;
  /** World-space minimum corner. */
  min: Vec3d;
  size: number;
}

export class ChunkMeshes {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly meshes = new Map<string, THREE.Mesh>();
  /** Chunk-origin world position per key (for origin re-sync). */
  private readonly worldPos = new Map<string, Vec3d>();
  /** Keys the worker reported empty: cached so streaming never re-queues them. */
  private readonly emptyKeys = new Set<string>();
  /** Insertion order for LRU eviction. */
  private readonly lru: string[] = [];
  /** Visible mesh count per LOD level, maintained on add/remove/evict. */
  private readonly levelCounts: number[] = [];

  constructor() {
    // Smooth (non-flat) shading: the worker-computed vertex normals take
    // effect, softening facets and LOD-boundary shading steps. Entity views
    // keep their own flat-shaded low-poly materials.
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 1,
      metalness: 0,
    });
    this.group.name = 'chunks';
    // The group only positions children absolutely (see syncAll): origin
    // shifts must skip it, or every mesh would move twice.
    this.group.userData['originManaged'] = true;
  }

  get count(): number {
    return this.meshes.size;
  }

  get emptyCount(): number {
    return this.emptyKeys.size;
  }

  has(key: string): boolean {
    return this.meshes.has(key) || this.emptyKeys.has(key);
  }

  /** Remember an empty key without a mesh (worker/boot reported nothing there). */
  markEmpty(key: string): void {
    if (!this.meshes.has(key)) this.emptyKeys.add(key);
  }

  /** Drop empty keys the predicate rejects (bounds the empty-key cache). */
  pruneEmpty(keep: (key: string) => boolean): void {
    for (const key of [...this.emptyKeys]) {
      if (!keep(key)) this.emptyKeys.delete(key);
    }
  }

  /** Cheap mesh counts for the per-frame overlay (no key parsing). */
  meshCounts(): { perLevel: number[]; total: number } {
    return { perLevel: [...this.levelCounts], total: this.meshes.size };
  }

  /** Add a mesh: 'added', 'empty' (cached), or 'duplicate'. */
  add(config: PlanetConfig, result: MeshResult): 'added' | 'empty' | 'duplicate' {
    if (this.meshes.has(result.key) || this.emptyKeys.has(result.key)) return 'duplicate';
    if (result.empty) {
      this.emptyKeys.add(result.key);
      return 'empty';
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
    const mesh = new THREE.Mesh(geometry, this.material);
    // Worker origin is planet-local; world = planetCenter + chunkOrigin.
    const world: Vec3d = {
      x: config.center.x + result.origin.x,
      y: config.center.y + result.origin.y,
      z: config.center.z + result.origin.z,
    };
    this.worldPos.set(result.key, world);
    const local = toLocal(world);
    mesh.position.set(local.x, local.y, local.z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.meshes.set(result.key, mesh);
    this.group.add(mesh);
    this.lru.push(result.key);
    const { level } = parseChunkKey(result.key);
    this.levelCounts[level] = (this.levelCounts[level] ?? 0) + 1;
    this.evictIfNeeded();
    return 'added';
  }

  /** Remove a mesh and dispose its geometry; returns false if absent. */
  remove(key: string): boolean {
    const mesh = this.meshes.get(key);
    if (!mesh) return false;
    this.dropMesh(key, mesh);
    const at = this.lru.indexOf(key);
    if (at >= 0) this.lru.splice(at, 1);
    return true;
  }

  /** World-space boxes of every visible mesh (for bounds debug + GC). */
  boxes(): ChunkBox[] {
    const out: ChunkBox[] = [];
    for (const [key, min] of this.worldPos) {
      const { level } = parseChunkKey(key);
      out.push({ key, level, min: { ...min }, size: chunkSizeForLevel(level) });
    }
    return out;
  }

  setWireframe(enabled: boolean): void {
    this.material.wireframe = enabled;
  }

  /** Reposition every mesh from world doubles (call after origin shifts). */
  syncAll(): void {
    for (const [key, mesh] of this.meshes) {
      const world = this.worldPos.get(key);
      if (!world) continue;
      const local = toLocal(world);
      mesh.position.set(local.x, local.y, local.z);
      mesh.updateMatrix();
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.clear();
    this.worldPos.clear();
    this.lru.length = 0;
    this.levelCounts.length = 0;
    this.material.dispose();
  }

  /** Shared mesh teardown for remove() and LRU eviction. */
  private dropMesh(key: string, mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    this.group.remove(mesh);
    this.meshes.delete(key);
    this.worldPos.delete(key);
    const { level } = parseChunkKey(key);
    const count = (this.levelCounts[level] ?? 0) - 1;
    this.levelCounts[level] = count > 0 ? count : 0;
  }

  private evictIfNeeded(): void {
    while (this.lru.length > CHUNK_CACHE_BUDGET) {
      const key = this.lru.shift() as string;
      const mesh = this.meshes.get(key);
      if (!mesh) continue;
      this.dropMesh(key, mesh);
    }
  }
}
